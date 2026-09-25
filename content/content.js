// ZFlow Batcher - content script message router and single-item runner
// Orchestrates: editor wait -> options apply -> text type -> submit -> monitor -> download.

window.ZFB = window.ZFB || {};

(function () {
  'use strict';

  const { U } = ZFB;

  let activeRunAbort = false;

  async function init() {
    await ZFB.selectors.ready();
  }
  init();

  async function handlePing() {
    const ed = ZFB.typewriter.findEditor();
    const sub = ZFB.monitor.findSubmitButton();
    const isProject = location.href.includes('/project/');
    return {
      ok: true,
      href: location.href,
      isProject,
      hasEditor: !!ed,
      hasSubmit: !!sub,
      assetsVisible: ZFB.monitor.assetUrls().length,
    };
  }

  async function handleNewProject() {
    const conf = ZFB.selectors.current();
    const rx = conf.newProjectText.map((t) => new RegExp(`\\b${t}\\b`, 'i'));
    const btn = U.findButton(rx);
    if (!btn) return { ok: false, error: 'New Project button not found' };
    U.click(btn);
    try {
      await U.waitFor(() => location.href.includes('/project/'), {
        timeout: 15000,
        label: 'project page navigation',
      });
      return { ok: true, href: location.href };
    } catch (e) {
      return { ok: false, error: e?.message || 'Navigation timeout' };
    }
  }

  async function runItem(item, settings) {
    activeRunAbort = false;
    const log = (msg) => {
      chrome.runtime.sendMessage({ action: 'ZFB_LOG', text: `[item #${item.index || 0}] ${msg}` }).catch(() => {});
    };

    log(`Starting: "${String(item.prompt || '').slice(0, 50)}..."`);

    // 1. Ensure editor is present
    let editor;
    try {
      editor = await U.waitFor(ZFB.typewriter.findEditor, { timeout: 20000, label: 'editor' });
    } catch (e) {
      return { ok: false, error: 'Editor not found. Are you inside an active Flow project?' };
    }

    if (activeRunAbort) return { ok: false, error: 'Aborted by user' };

    // 2. Snapshot current assets so we can identify only the newly generated ones
    const beforeUrls = new Set(ZFB.monitor.assetUrls().map((a) => a.url));

    // 3. Apply settings (model, ratio, duration, count)
    let notes = [];
    if (settings && typeof settings === 'object') {
      try {
        notes = await ZFB.popover.applySettings(settings);
      } catch (e) {
        log(`Settings warning: ${e?.message || e}`);
      }
    }

    if (activeRunAbort) return { ok: false, error: 'Aborted by user' };

    // 4. Type the prompt
    try {
      await ZFB.typewriter.setPrompt(item.prompt);
    } catch (e) {
      return { ok: false, error: `Failed typing prompt: ${e?.message || e}` };
    }
    await U.sleep(400);

    if (activeRunAbort) return { ok: false, error: 'Aborted by user' };

    // 5. Submit
    const submitBtn = await U.waitFor(ZFB.monitor.findSubmitButton, {
      timeout: 8000,
      label: 'generate button',
    });
    if (!submitBtn) {
      return { ok: false, error: 'Generate button not clickable or missing' };
    }
    U.click(submitBtn);
    log('Prompt submitted, awaiting generation...');

    // 6. Await completion
    const expected = Math.max(1, Number(settings?.batch || settings?.count || 1));
    const result = await ZFB.monitor.awaitGeneration(beforeUrls, {
      expected,
      timeoutMs: (Number(settings?.timeoutMinutes) || 8) * 60 * 1000,
      stablePolls: 3,
    });

    if (result.status === 'error') {
      return { ok: false, error: result.message || 'Generation reported error' };
    }

    // 7. Auto-download if requested
    const downloaded = [];
    if (settings?.autoDownload && result.assets && result.assets.length) {
      const slug = U.slug(item.prompt, 40);
      let idx = 1;
      for (const asset of result.assets) {
        const ext = asset.kind === 'video' ? 'mp4' : 'png';
        const filename = `${String(item.index || 0).padStart(3, '0')}_${slug}_${idx}.${ext}`;
        try {
          const resp = await chrome.runtime.sendMessage({
            action: 'DOWNLOAD_ASSET',
            url: asset.url,
            filename,
          });
          if (resp && resp.ok) downloaded.push(filename);
        } catch (_) {}
        idx++;
        await U.sleep(Math.max(200, (Number(settings.downloadDelaySeconds) || 1) * 1000));
      }
    }

    return {
      ok: true,
      assets: result.assets,
      downloaded,
      notes,
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const action = msg && msg.action;
    if (action === 'PING_FLOW') {
      handlePing().then(sendResponse);
      return true;
    }
    if (action === 'NAVIGATE_NEW_PROJECT') {
      handleNewProject().then(sendResponse);
      return true;
    }
    if (action === 'EXECUTE_ITEM') {
      runItem(msg.item || {}, msg.settings || {}).then(sendResponse);
      return true;
    }
    if (action === 'ABORT_ACTIVE_RUN') {
      activeRunAbort = true;
      sendResponse({ ok: true });
      return false;
    }
    if (action === 'RELOAD_SELECTORS') {
      ZFB.selectors.reload().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (action === 'GET_SELECTOR_DEFAULTS') {
      const data = {};
      for (const key of Object.keys(ZFB.selectors.DEFAULTS)) data[key] = ZFB.selectors.DEFAULTS[key];
      sendResponse({
        ok: true,
        overrides: data,
        keys: Object.keys(ZFB.selectors.DEFAULTS),
      });
      return false;
    }
    return false;
  });
})();
