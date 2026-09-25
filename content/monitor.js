// ZFlow Batcher - generation monitor
// Detects: submit button availability, "busy" rendering state, new assets
// appearing (diffed against a pre-submit snapshot), and error toasts.

window.ZFB = window.ZFB || {};

(function () {
  'use strict';

  const { U } = ZFB;

  function findSubmitButton() {
    const conf = ZFB.selectors.current();
    const byAria = U.findVisible(conf.submit);
    if (byAria) return byAria;
    const rx = conf.submitText.map((t) => new RegExp(`\\b${t}\\b`, 'i'));
    const byText = U.findButton(rx);
    if (byText) return byText;
    // Last resort: a small icon-only button adjacent to the editor.
    const ed = ZFB.typewriter.findEditor();
    if (!ed) return null;
    let node = ed;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      const cands = Array.from(node.querySelectorAll('button')).filter(
        (b) => U.isVisible(b) && !b.disabled && b !== ed && /send|generate|create|play|arrow/i.test(
          (b.getAttribute('aria-label') || '') + ' ' + (b.className || '') + ' ' + (b.innerHTML.match(/<svg[^>]*>.*?<\/svg>/i) ? 'svg' : '')
        )
      );
      if (cands.length) return cands[cands.length - 1];
    }
    return null;
  }

  function assetUrls() {
    const conf = ZFB.selectors.current();
    const urls = [];
    try {
      for (const img of document.querySelectorAll(conf.assetImage)) {
        const src = img.currentSrc || img.src;
        if (!src) continue;
        const ok = img.complete && img.naturalWidth > 100;
        if (ok) urls.push({ url: src, kind: 'image' });
      }
    } catch (_) { /* noop */ }
    try {
      for (const v of document.querySelectorAll(conf.assetVideo)) {
        const src = v.currentSrc || v.src;
        if (src && src !== window.location.href) urls.push({ url: src, kind: 'video' });
      }
    } catch (_) { /* noop */ }
    const seen = new Set();
    return urls.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
  }

  function busyVisible() {
    const conf = ZFB.selectors.current();
    if (U.findVisible(conf.busy)) return true;
    return U.findButton(conf.busyText.map((t) => new RegExp(`\\b${t}\\b`, 'i'))) !== null
      || Array.from(document.querySelectorAll('div,span,p')).some((el) => {
        if (!U.isVisible(el)) return false;
        if (el.children.length > 2) return false;
        const t = U.norm(el.textContent).toLowerCase();
        if (!t || t.length > 60) return false;
        return conf.busyText.some((k) => t.includes(k.toLowerCase()));
      });
  }

  function errorText() {
    const conf = ZFB.selectors.current();
    const hits = Array.from(document.querySelectorAll('div,span,p,[role="alert"]')).filter((el) => {
      if (!U.isVisible(el) || el.children.length > 2) return false;
      const t = U.norm(el.textContent).toLowerCase();
      return t && t.length < 140 && conf.errorText.some((k) => t.includes(k));
    });
    return hits.length ? U.norm(hits[0].textContent) : null;
  }

  /**
   * Wait until generation finishes.
   * @param {Set<string>} before snapshot of asset urls taken BEFORE submitting
   * @param {object} opts { expected, timeoutMs, stablePolls }
   */
  async function awaitGeneration(before, opts = {}) {
    const expected = Math.max(1, Number(opts.expected) || 1);
    const timeoutMs = Number(opts.timeoutMs) || 10 * 60 * 1000;
    const stablePolls = Number(opts.stablePolls) || 3;
    const started = U.now();
    let stable = 0;
    let latest = [];

    for (;;) {
      await U.sleep(1500);
      const fresh = assetUrls().filter((a) => !before.has(a.url));
      const err = errorText();
      const busy = busyVisible();

      if (err && !fresh.length && !busy) {
        return { status: 'error', message: err, assets: [] };
      }

      if (fresh.length >= expected && !busy) {
        const same = JSON.stringify(fresh.map((a) => a.url)) === JSON.stringify(latest.map((a) => a.url));
        latest = fresh;
        stable = same ? stable + 1 : 0;
        if (stable >= stablePolls) return { status: 'done', assets: fresh };
      } else {
        latest = fresh;
        stable = 0;
      }

      if (U.now() - started > timeoutMs) {
        if (latest.length) return { status: 'done', assets: latest, note: 'timeout, using what appeared' };
        return { status: 'error', message: `generation timed out after ${Math.round(timeoutMs / 1000)}s`, assets: [] };
      }
    }
  }

  ZFB.monitor = { findSubmitButton, assetUrls, busyVisible, errorText, awaitGeneration };
})();
