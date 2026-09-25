// ZFlow Batcher - Flow Studio Bridge Client (ADR-009)
// Connects to local Flow Studio desktop app over loopback WebSocket.
// Receives DISPATCH jobs, runs them through the existing content runner,
// and streams back PROGRESS and RESULT frames in real-time.

(function () {
  'use strict';

  const STORAGE_KEY = 'zfb_bridge_config';
  const DEFAULT_PORT = 48210;
  const RECONNECT_DELAY_MS = 4000;

  const bridgeState = {
    enabled: false,
    port: DEFAULT_PORT,
    token: '',
    connected: false,
    ws: null,
    reconnectTimer: null,
    activeJobs: new Map(),
  };

  function log(msg, cls = '') {
    if (typeof window.logLine === 'function') {
      window.logLine(`[Bridge] ${msg}`, cls);
    } else {
      console.log('[ZFB-Bridge]', msg);
    }
  }

  async function loadConfig() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    if (data && data[STORAGE_KEY]) {
      const cfg = data[STORAGE_KEY];
      bridgeState.enabled = !!cfg.enabled;
      bridgeState.port = Number(cfg.port) || DEFAULT_PORT;
      bridgeState.token = String(cfg.token || '').trim();
    }
    return bridgeState;
  }

  async function saveConfig(cfg) {
    bridgeState.enabled = !!cfg.enabled;
    bridgeState.port = Number(cfg.port) || DEFAULT_PORT;
    bridgeState.token = String(cfg.token || '').trim();
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        enabled: bridgeState.enabled,
        port: bridgeState.port,
        token: bridgeState.token,
      },
    });
    if (bridgeState.enabled) {
      connect();
    } else {
      disconnect();
    }
  }

  function sendFrame(frame) {
    if (bridgeState.ws && bridgeState.ws.readyState === WebSocket.OPEN) {
      try {
        bridgeState.ws.send(JSON.stringify(frame));
        return true;
      } catch (e) {
        log(`Failed sending frame: ${e?.message || e}`, 'log-error');
      }
    }
    return false;
  }

  function reportProgress(jobId, phase, note = null) {
    sendFrame({
      type: 'progress',
      jobId,
      phase,
      note: note || undefined,
    });
  }

  function reportResult(jobId, ok, { error = null, files = [], assets = [] } = {}) {
    sendFrame({
      type: 'result',
      jobId,
      ok: !!ok,
      error: error || undefined,
      files,
      assets,
    });
  }

  async function handleDispatch(job) {
    const { jobId, prompt, kind, model, aspectRatio, duration, variations, autoDownload, downloadPrefix } = job || {};
    log(`Received job ${jobId}: "${String(prompt || '').slice(0, 40)}..."`, 'log-info');

    reportProgress(jobId, 'accepted', 'Dispatched to queue');

    // Reuse the existing runner in panel.js by queueing and/or executing
    const settings = {
      mode: kind || 'image',
      model: model || 'Nano Banana 2',
      ratio: aspectRatio || '16:9',
      duration: duration || '8s',
      batch: variations || 1,
      autoDownload: autoDownload !== false,
      timeoutMinutes: 8,
    };

    reportProgress(jobId, 'typed', 'Typing into Flow editor');

    try {
      if (typeof window.toTab !== 'function') {
        throw new Error('Panel runner helper not ready');
      }

      reportProgress(jobId, 'submitted', 'Awaiting generation');
      const res = await window.toTab('EXECUTE_ITEM', {
        item: { index: 1, prompt },
        settings,
      });

      if (!res || !res.ok) {
        const errMsg = res?.error || 'Generation failed on Flow page';
        log(`Job ${jobId} failed: ${errMsg}`, 'log-error');
        reportResult(jobId, false, { error: errMsg });
        return;
      }

      const files = res.downloaded || [];
      const assetUrls = (res.assets || []).map((a) => a.url);
      log(`Job ${jobId} succeeded! ${files.length} downloaded.`, 'log-success');
      reportProgress(jobId, 'downloading', `${files.length} file(s) saved`);
      reportResult(jobId, true, { files, assets: assetUrls });
    } catch (e) {
      const errMsg = e?.message || String(e);
      log(`Job ${jobId} exception: ${errMsg}`, 'log-error');
      reportResult(jobId, false, { error: errMsg });
    }
  }

  function handleMessage(event) {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch (_) {
      log('Malformed frame received from Flow Studio', 'log-error');
      return;
    }

    if (frame.type === 'ready') {
      bridgeState.connected = true;
      log('Paired & authenticated with Flow Studio!', 'log-success');
      updateUi();
      return;
    }

    if (frame.type === 'dispatch') {
      handleDispatch(frame);
      return;
    }

    if (frame.type === 'cancel') {
      log(`Cancel requested for ${frame.jobId}`, 'log-dim');
      return;
    }
  }

  function connect() {
    if (!bridgeState.enabled) return;
    if (bridgeState.ws && (bridgeState.ws.readyState === WebSocket.OPEN || bridgeState.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearTimeout(bridgeState.reconnectTimer);
    const url = `ws://127.0.0.1:${bridgeState.port}`;
    log(`Connecting to Flow Studio at ${url}...`, 'log-dim');

    try {
      bridgeState.ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    bridgeState.ws.onopen = () => {
      log('WebSocket opened, sending hello...', 'log-dim');
      const manifest = chrome.runtime.getManifest();
      sendFrame({
        type: 'hello',
        role: 'zflow-batcher',
        version: manifest.version || '1.0.0',
        token: bridgeState.token,
      });
    };

    bridgeState.ws.onmessage = handleMessage;

    bridgeState.ws.onclose = () => {
      if (bridgeState.connected) {
        log('Disconnected from Flow Studio', 'log-error');
      }
      bridgeState.connected = false;
      bridgeState.ws = null;
      updateUi();
      scheduleReconnect();
    };

    bridgeState.ws.onerror = () => {
      // Quiet on error; reconnect loop handles it
    };
  }

  function disconnect() {
    clearTimeout(bridgeState.reconnectTimer);
    if (bridgeState.ws) {
      try { bridgeState.ws.close(); } catch (_) {}
      bridgeState.ws = null;
    }
    bridgeState.connected = false;
    updateUi();
  }

  function scheduleReconnect() {
    if (!bridgeState.enabled) return;
    clearTimeout(bridgeState.reconnectTimer);
    bridgeState.reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  }

  function updateUi() {
    const pill = document.getElementById('bridgeStatusPill');
    const txt = document.getElementById('bridgeStatusText');
    if (!pill || !txt) return;

    if (!bridgeState.enabled) {
      pill.className = 'status-pill status-disconnected';
      txt.textContent = 'Bridge Disabled';
    } else if (bridgeState.connected) {
      pill.className = 'status-pill status-connected';
      txt.textContent = 'Bridge Connected';
    } else {
      pill.className = 'status-pill status-working';
      txt.textContent = 'Bridge Connecting...';
    }
  }

  window.ZFB_BRIDGE = {
    state: bridgeState,
    loadConfig,
    saveConfig,
    connect,
    disconnect,
    updateUi,
  };
})();
