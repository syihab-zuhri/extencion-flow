// ZFlow Batcher - background service worker
// Owns: side-panel toggle, asset downloads, badge progress. No remote calls, ever.

const PANEL_PATH = 'sidepanel/panel.html';
const DOWNLOAD_ROOT = 'zflow-batcher';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// The side panel is a single global panel; bind it to the whole window so it
// stays available when the user switches tabs.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true }).catch(() => {});
});

function ok(data) {
  return { ok: true, ...data };
}
function err(message) {
  return { ok: false, error: String(message || 'unknown error') };
}

async function handleDownload(msg) {
  const { url, filename, saveAs } = msg || {};
  if (typeof url !== 'string' || !/^https?:/i.test(url)) {
    return err('invalid url');
  }
  const safeName = String(filename || 'asset').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  try {
    const id = await chrome.downloads.download({
      url,
      filename: `${DOWNLOAD_ROOT}/${safeName}`,
      conflictAction: 'uniquify',
      saveAs: !!saveAs,
    });
    return ok({ id });
  } catch (e) {
    return err(e?.message || e);
  }
}

async function handleCancelDownload(msg) {
  try {
    await chrome.downloads.cancel(Number(msg?.id));
    return ok({});
  } catch (e) {
    return err(e?.message || e);
  }
}

async function handleBadge(msg) {
  const text = typeof msg?.text === 'string' ? msg.text : '';
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
    await chrome.action.setBadgeText({ text: text.slice(0, 6) });
    return ok({});
  } catch (e) {
    return err(e?.message || e);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const action = msg && msg.action;
  if (action === 'DOWNLOAD_ASSET' || action === 'DOWNLOAD_URL') {
    handleDownload(msg).then(sendResponse);
    return true;
  }
  if (action === 'CANCEL_DOWNLOAD') {
    handleCancelDownload(msg).then(sendResponse);
    return true;
  }
  if (action === 'SET_BADGE') {
    handleBadge(msg).then(sendResponse);
    return true;
  }
  if (action === 'PING_BG') {
    sendResponse(ok({ at: Date.now() }));
    return false;
  }
  return false;
});
