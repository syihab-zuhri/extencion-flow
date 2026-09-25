// ZFlow Batcher - shared content-script utilities (isolated world)
// All modules hang off window.ZFB so later scripts can reach them.
window.ZFB = window.ZFB || {};

(function () {
  'use strict';

  const U = {
    sleep(ms) {
      return new Promise((r) => setTimeout(r, Math.max(0, ms | 0)));
    },

    now() {
      return Date.now();
    },

    norm(s) {
      return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    },

    isVisible(el) {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    },

    text(el) {
      return U.norm(el && (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''));
    },

    // Buttons whose visible text/aria matches any of the given regex sources.
    findButton(patterns, root) {
      const scope = root || document;
      const rxList = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p, 'i')));
      const nodes = Array.from(scope.querySelectorAll('button, [role="button"]'));
      return nodes.find((b) => {
        if (!U.isVisible(b) || b.disabled) return false;
        const t = U.text(b);
        return rxList.some((rx) => rx.test(t));
      }) || null;
    },

    findVisible(sel, root) {
      const scope = root || document;
      const list = Array.isArray(sel) ? sel : [sel];
      for (const s of list) {
        try {
          const el = Array.from(scope.querySelectorAll(s)).find((n) => U.isVisible(n));
          if (el) return el;
        } catch (_) {
          /* invalid selector from overrides - ignore */
        }
      }
      return null;
    },

    click(el) {
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const opts = { bubbles: true, cancelable: true, view: window };
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const ev = type.startsWith('pointer')
          ? new PointerEvent(type, { ...opts, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 })
          : new MouseEvent(type, { ...opts, clientX: x, clientY: y, button: 0 });
        el.dispatchEvent(ev);
      }
      return true;
    },

    async waitFor(fn, { timeout = 15000, interval = 250, label = 'condition' } = {}) {
      const end = U.now() + timeout;
      for (;;) {
        const v = fn();
        if (v) return v;
        if (U.now() > end) throw new Error(`timeout waiting for ${label}`);
        await U.sleep(interval);
      }
    },

    slug(s, max = 48) {
      return String(s || 'prompt')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, max) || 'prompt';
    },
  };

  ZFB.U = U;
})();
