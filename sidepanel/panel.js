// ZFlow Batcher - side panel brain: queue, runner, retry, settings, logs.
// Everything is local (chrome.storage.local). No accounts, no license, no updater.

'use strict';

const $ = (id) => document.getElementById(id);

const MODELS = {
  image: ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'],
  video: ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality'],
};

const DEFAULT_SETTINGS = {
  mode: 'image',
  model: 'Nano Banana 2',
  ratio: '16:9',
  duration: '8s',
  batch: 1,
  autoDownload: true,
  promptDelaySeconds: 5,
  downloadDelaySeconds: 2,
  retryRounds: 2,
  timeoutMinutes: 8,
  refreshAfter: 0,
  newProjectAfter: 0,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  queue: [],
  running: false,
  stopRequested: false,
  pauseRequested: false,
  flowTabId: null,
  flowAlive: false,
};

// ─── Logging ──────────────────────────────────────────────────────────────
function logLine(text, cls = '') {
  const box = $('logsContainer');
  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  const time = new Date().toLocaleTimeString();
  div.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(text)}`;
  box.appendChild(div);
  while (box.children.length > 600) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === 'ZFB_LOG' && typeof msg.text === 'string') {
    logLine(msg.text, 'log-info');
  }
});

// ─── Persistence ──────────────────────────────────────────────────────────
async function loadPersisted() {
  const data = await chrome.storage.local.get(['zfb_settings', 'zfb_queue']);
  if (data.zfb_settings) state.settings = { ...DEFAULT_SETTINGS, ...data.zfb_settings };
  if (Array.isArray(data.zfb_queue)) state.queue = data.zfb_queue;
}

const persist = debounce(async () => {
  await chrome.storage.local.set({ zfb_settings: state.settings, zfb_queue: state.queue });
}, 300);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ─── Flow tab presence ────────────────────────────────────────────────────
async function refreshFlowStatus() {
  const pill = $('flowStatusPill');
  const txt = $('flowStatusText');
  const helper = $('flowHelperBar');
  const tabs = await chrome.tabs.query({ url: 'https://flow.google.com/*' });
  if (!tabs.length) {
    state.flowTabId = null;
    state.flowAlive = false;
    pill.className = 'status-pill status-disconnected';
    txt.textContent = 'No Flow tab';
    helper.classList.remove('hidden');
    return;
  }
  helper.classList.add('hidden');
  const tab = tabs.find((t) => t.active) || tabs[0];
  state.flowTabId = tab.id;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'PING_FLOW' });
    state.flowAlive = !!(res && res.ok);
    if (state.running) {
      pill.className = 'status-pill status-working';
      txt.textContent = 'Running';
    } else {
      pill.className = 'status-pill status-connected';
      txt.textContent = res.isProject ? 'Flow project ready' : 'Flow (not in project)';
    }
  } catch (_) {
    state.flowAlive = false;
    pill.className = 'status-pill status-disconnected';
    txt.textContent = 'Reload Flow tab (scripts asleep)';
  }
}

function toTab(action, payload = {}) {
  if (!state.flowTabId) return Promise.reject(new Error('no flow tab open'));
  return chrome.tabs.sendMessage(state.flowTabId, { action, ...payload });
}

// ─── Queue parsing (TXT / CSV / textarea) ─────────────────────────────────
function parseLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || (ch === '\r' && src[i + 1] === '\n')) {
      row.push(cell); cell = '';
      rows.push(row); row = [];
      i++;
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const prompts = [];
  let start = 0;
  if (rows.length && /prompt/i.test(String(rows[0][0] || ''))) start = 1;
  for (const r of rows.slice(start)) {
    const p = String(r[0] || '').trim();
    if (p) prompts.push(p);
  }
  return prompts;
}

function addPrompts(prompts) {
  let added = 0;
  for (const p of prompts) {
    state.queue.push({
      id: `${Date.now()}_${added}_${Math.random().toString(36).slice(2, 7)}`,
      prompt: p,
      status: 'pending',
      error: '',
      downloaded: [],
    });
    added++;
  }
  logLine(`Added ${added} prompt(s) to queue.`, added ? 'log-success' : 'log-dim');
  renderQueue();
  persist();
}

function renderQueue() {
  const list = $('queueList');
  $('queueCount').textContent = state.queue.length;
  const counts = { pending: 0, running: 0, success: 0, failed: 0 };
  for (const it of state.queue) counts[it.status] = (counts[it.status] || 0) + 1;
  $('statTotal').textContent = state.queue.length;
  $('statPending').textContent = counts.pending + counts.running;
  $('statSuccess').textContent = counts.success;
  $('statFailed').textContent = counts.failed;

  if (!state.queue.length) {
    list.innerHTML = '<div class="empty-state">No prompts queued. Add some above.</div>';
    return;
  }
  list.innerHTML = '';
  state.queue.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'queue-item';
    const badge = { pending: '·', running: '…', success: '✓', failed: '✗' }[item.status] || '?';
    const badgeCls = { pending: 'q-status-pending', running: 'q-status-running', success: 'q-status-success', failed: 'q-status-failed' }[item.status];
    const note = item.status === 'failed' && item.error
      ? `<div class="q-note q-note-error">${escapeHtml(item.error)}</div>`
      : item.downloaded.length
        ? `<div class="q-note">${item.downloaded.length} file(s) downloaded</div>`
        : '';
    el.innerHTML = `
      <div class="queue-item-status ${badgeCls}">${badge}</div>
      <div class="q-body">
        <div class="q-prompt">${idx + 1}. ${escapeHtml(item.prompt)}</div>
        ${note}
      </div>
      <div class="q-actions">
        ${item.status === 'failed' ? `<button class="btn-xs" data-retry="${item.id}">Retry</button>` : ''}
        ${item.status === 'success' ? `<a class="btn-xs" style="text-decoration:none" href="#" data-open="${escapeHtml(item.downloaded[0] || '')}">File</a>` : ''}
        <button class="q-btn-del" data-del="${item.id}" title="Remove">✕</button>
      </div>`;
    list.appendChild(el);
  });
}

// ─── Runner ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureContent() {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await toTab('PING_FLOW');
      if (res && res.ok) return res;
    } catch (_) { /* content script waking up */ }
    await sleep(1500);
  }
  throw new Error('Flow tab not responding - reload the flow.google.com page.');
}

async function waitWhilePausedOrStopped() {
  while (state.pauseRequested && !state.stopRequested) await sleep(400);
  if (state.stopRequested) throw new Error('__stopped__');
}

async function runOne(item) {
  const idx = state.queue.indexOf(item) + 1;
  item.status = 'running';
  item.error = '';
  renderQueue();
  persist();

  await ensureContent();
  await waitWhilePausedOrStopped();

  const delay = Number(state.settings.promptDelaySeconds) || 0;
  if (delay > 0) {
    logLine(`Cooling down ${delay}s before prompt #${idx}...`, 'log-dim');
    const step = 1000;
    let left = delay * 1000;
    while (left > 0) {
      if (state.stopRequested) throw new Error('__stopped__');
      await sleep(Math.min(step, left));
      left -= step;
    }
  }

  const settings = {
    model: state.settings.model,
    ratio: state.settings.ratio,
    batch: Number(state.settings.batch) || 1,
    duration: state.settings.mode === 'video' ? state.settings.duration : null,
    autoDownload: state.settings.autoDownload,
    downloadDelaySeconds: state.settings.downloadDelaySeconds,
    timeoutMinutes: state.settings.timeoutMinutes,
  };

  const res = await toTab('EXECUTE_ITEM', { item: { index: idx, prompt: item.prompt }, settings });
  if (!res) throw new Error('no response from content script');
  if (!res.ok) throw new Error(res.error || 'generation failed');

  item.status = 'success';
  item.downloaded = res.downloaded || [];
  logLine(`Prompt #${idx} done. ${res.assets?.length || 0} asset(s)${state.settings.autoDownload ? `, ${item.downloaded.length} downloaded` : ''}.`, 'log-success');
}

async function runQueue(stepOnce = false) {
  if (state.running) return;
  state.running = true;
  state.stopRequested = false;
  state.pauseRequested = false;
  syncRunButtons();

  let processedThisSession = 0;
  try {
    await ensureContent();
    const rounds = Math.max(0, Number(state.settings.retryRounds) || 0);
    let round = 0;

    while (!state.stopRequested) {
      const targets = state.queue.filter((i) => (round === 0 ? i.status === 'pending' : i.status === 'failed'));
      if (!targets.length) break;

      if (round > 0) {
        logLine(`Retry round ${round}/${rounds}: re-queueing ${targets.length} failed prompt(s).`, 'log-info');
        targets.forEach((t) => { t.status = 'pending'; });
        renderQueue();
        await sleep(15000);
      }

      for (const item of targets) {
        if (state.stopRequested) break;
        await waitWhilePausedOrStopped();

        const refreshAfter = Number(state.settings.refreshAfter) || 0;
        const newProjectAfter = Number(state.settings.newProjectAfter) || 0;
        if (newProjectAfter > 0 && processedThisSession > 0 && processedThisSession % newProjectAfter === 0) {
          logLine('Creating a new Flow project...', 'log-info');
          const np = await toTab('NAVIGATE_NEW_PROJECT').catch(() => null);
          if (np && !np.ok) logLine(`New project skipped: ${np.error}`, 'log-dim');
        } else if (refreshAfter > 0 && processedThisSession > 0 && processedThisSession % refreshAfter === 0) {
          logLine('Refreshing Flow tab...', 'log-info');
          await chrome.tabs.reload(state.flowTabId);
          await sleep(4000);
        }

        try {
          await runOne(item);
        } catch (e) {
          const msg = e?.message || String(e);
          if (msg === '__stopped__') throw e;
          item.status = 'failed';
          item.error = msg;
          logLine(`Prompt #${state.queue.indexOf(item) + 1} failed: ${msg}`, 'log-error');
        }
        processedThisSession++;
        renderQueue();
        persist();
        setBadge(`${state.queue.filter((i) => i.status === 'success').length}/${state.queue.length}`);

        if (stepOnce) throw new Error('__stepdone__');
      }

      round++;
      if (round > rounds) break;
    }

    const okN = state.queue.filter((i) => i.status === 'success').length;
    const failN = state.queue.filter((i) => i.status === 'failed').length;
    logLine(`Queue finished: ${okN} success, ${failN} failed.`, failN ? 'log-error' : 'log-success');
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg === '__stopped__') logLine('Stopped by user.', 'log-error');
    else if (msg === '__stepdone__') logLine('Step complete.', 'log-dim');
    else logLine(`Runner error: ${msg}`, 'log-error');
  } finally {
    state.running = false;
    state.pauseRequested = false;
    state.queue.forEach((i) => { if (i.status === 'running') i.status = 'pending'; });
    syncRunButtons();
    renderQueue();
    persist();
    setBadge('');
  }
}

function setBadge(text) {
  chrome.runtime.sendMessage({ action: 'SET_BADGE', text }).catch(() => {});
}

function syncRunButtons() {
  $('btnStart').classList.toggle('hidden', state.running);
  $('btnPause').classList.toggle('hidden', !state.running);
  $('btnStop').classList.toggle('hidden', !state.running);
}

// ─── Settings form ────────────────────────────────────────────────────────
function renderSettingsForm() {
  const s = state.settings;
  document.querySelectorAll('input[name="genMode"]').forEach((r) => { r.checked = r.value === s.mode; });
  fillModels();
  $('settingModel').value = s.model;
  document.querySelectorAll('input[name="ratio"]').forEach((r) => { r.checked = r.value === s.ratio; });
  document.querySelectorAll('input[name="duration"]').forEach((r) => { r.checked = r.value === s.duration; });
  document.querySelectorAll('input[name="batch"]').forEach((r) => { r.checked = Number(r.value) === Number(s.batch); });
  $('chkAutoDownload').checked = !!s.autoDownload;
  $('settingPromptDelay').value = s.promptDelaySeconds;
  $('settingDownloadDelay').value = s.downloadDelaySeconds;
  $('settingAutoRetry').value = s.retryRounds;
  $('settingTimeoutMin').value = s.timeoutMinutes;
  $('videoDurationGroup').classList.toggle('hidden', s.mode !== 'video');
}

function fillModels() {
  const sel = $('settingModel');
  const mode = document.querySelector('input[name="genMode"]:checked')?.value || state.settings.mode;
  sel.innerHTML = '';
  for (const m of MODELS[mode] || []) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  }
  if (![...MODELS[mode]].includes(state.settings.model)) {
    sel.value = MODELS[mode][0];
  }
}

function readSettingsForm() {
  const s = state.settings;
  s.mode = document.querySelector('input[name="genMode"]:checked')?.value || 'image';
  s.model = $('settingModel').value;
  s.ratio = document.querySelector('input[name="ratio"]:checked')?.value || '16:9';
  s.duration = document.querySelector('input[name="duration"]:checked')?.value || '8s';
  s.batch = Number(document.querySelector('input[name="batch"]:checked')?.value) || 1;
  s.autoDownload = $('chkAutoDownload').checked;
  s.promptDelaySeconds = Number($('settingPromptDelay').value) || 0;
  s.downloadDelaySeconds = Number($('settingDownloadDelay').value) || 0;
  s.retryRounds = Number($('settingAutoRetry').value) || 0;
  s.timeoutMinutes = Number($('settingTimeoutMin').value) || 8;
  return s;
}

// ─── Selectors override tab ───────────────────────────────────────────────
async function loadSelectorsTab() {
  const data = await chrome.storage.local.get(['zfb_selector_overrides']);
  $('selectorsJson').value = JSON.stringify(data.zfb_selector_overrides || {}, null, 2);
}

async function loadDefaultsIntoSelectors() {
  try {
    const res = await toTab('GET_SELECTOR_DEFAULTS');
    if (!res?.ok) throw new Error(res?.error || 'content script unavailable');
    $('selectorsJson').value = JSON.stringify(res.overrides || {}, null, 2);
    $('defaultKeysInfo').textContent = `Default hook keys: ${(res.keys || []).join(', ')}`;
    logLine('Loaded current default selectors from the Flow tab.', 'log-success');
  } catch (e) {
    logLine(`Could not read defaults: ${e?.message || e}. Open a flow.google.com tab first.`, 'log-error');
  }
}

// ─── Wiring ───────────────────────────────────────────────────────────────
function wire() {
  // tabs
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
    });
  });

  $('btnOpenFlow').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://flow.google.com/' });
  });

  $('btnStart').addEventListener('click', () => runQueue(false));
  $('btnStep').addEventListener('click', () => runQueue(true));
  $('btnPause').addEventListener('click', () => {
    state.pauseRequested = !state.pauseRequested;
    $('btnPause').lastElementChild.textContent = state.pauseRequested ? 'Resume' : 'Pause';
    logLine(state.pauseRequested ? 'Pause requested (waits for current prompt).' : 'Resumed.', 'log-info');
  });
  $('btnStop').addEventListener('click', async () => {
    state.stopRequested = true;
    state.pauseRequested = false;
    toTab('ABORT_ACTIVE_RUN').catch(() => {});
    logLine('Stop requested.', 'log-error');
  });

  // queue input
  $('btnAddToQueue').addEventListener('click', () => {
    addPrompts(parseLines($('rawInputText').value));
    $('rawInputText').value = '';
  });
  $('btnClearInput').addEventListener('click', () => { $('rawInputText').value = ''; });
  $('btnPasteClipboard').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      $('rawInputText').value += ($('rawInputText').value ? '\n' : '') + text;
    } catch (_) {
      logLine('Clipboard blocked - use Ctrl+V in the box.', 'log-dim');
    }
  });

  const readFile = (file) => new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(String(fr.result || ''));
    fr.readAsText(file);
  });

  $('fileInputTxt').addEventListener('change', async (e) => {
    for (const f of e.target.files) addPrompts(parseLines(await readFile(f)));
    e.target.value = '';
  });
  $('fileInputCsv').addEventListener('change', async (e) => {
    for (const f of e.target.files) addPrompts(parseCsv(await readFile(f)));
    e.target.value = '';
  });

  const drop = $('rawInputText');
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      const text = await readFile(f);
      if (/\.csv$/i.test(f.name)) addPrompts(parseCsv(text));
      else addPrompts(parseLines(text));
    }
  });

  $('queueList').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.del) {
      state.queue = state.queue.filter((i) => i.id !== t.dataset.del);
      renderQueue(); persist();
    } else if (t.dataset.retry) {
      const item = state.queue.find((i) => i.id === t.dataset.retry);
      if (item) { item.status = 'pending'; item.error = ''; renderQueue(); persist(); }
    } else if (t.dataset.open && t.dataset.open) {
      chrome.downloads.search({ filenameRegex: t.dataset.open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }, (res) => {
        if (res && res[0]) chrome.downloads.open(res[0].id);
      });
    }
  });

  $('btnClearDone').addEventListener('click', () => {
    state.queue = state.queue.filter((i) => i.status !== 'success');
    renderQueue(); persist();
  });
  $('btnClearAllQueue').addEventListener('click', () => {
    if (!confirm('Reset the whole queue?')) return;
    state.queue = [];
    renderQueue(); persist();
  });

  // settings
  document.querySelectorAll('input[name="genMode"]').forEach((r) => {
    r.addEventListener('change', () => {
      fillModels();
      $('videoDurationGroup').classList.toggle('hidden', r.value !== 'video');
    });
  });
  $('btnSaveSettings').addEventListener('click', () => {
    Object.assign(state.settings, readSettingsForm());
    persist();
    logLine('Settings saved.', 'log-success');
  });

  // selectors
  $('btnSaveSelectors').addEventListener('click', async () => {
    try {
      const obj = JSON.parse($('selectorsJson').value || '{}');
      await chrome.storage.local.set({ zfb_selector_overrides: obj });
      toTab('RELOAD_SELECTORS').catch(() => {});
      logLine('Selector overrides saved. Active on the Flow page immediately.', 'log-success');
    } catch (e) {
      logLine(`Invalid JSON: ${e.message}`, 'log-error');
    }
  });
  $('btnResetSelectors').addEventListener('click', async () => {
    await chrome.storage.local.remove('zfb_selector_overrides');
    toTab('RELOAD_SELECTORS').catch(() => {});
    $('selectorsJson').value = '{}';
    logLine('Selector overrides cleared (defaults restored).', 'log-info');
  });
  $('btnLoadDefaults').addEventListener('click', loadDefaultsIntoSelectors);

  $('btnClearLogs').addEventListener('click', () => { $('logsContainer').innerHTML = ''; });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

(async function main() {
  wire();
  await loadPersisted();
  renderSettingsForm();
  renderQueue();
  loadSelectorsTab();
  await refreshFlowStatus();
  setInterval(refreshFlowStatus, 5000);
  logLine(`Queue restored: ${state.queue.length} item(s).`, 'log-dim');
})();
