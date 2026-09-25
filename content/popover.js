// ZFlow Batcher - editor popover controls (model / ratio / count / duration)
// Each control is a chip button inside the editor toolbar that opens an
// overlay list of options. We match by visible text aliases, never by
// obfuscated class names, and every miss is a soft-skip (logged, not fatal).

window.ZFB = window.ZFB || {};

(function () {
  'use strict';

  const { U } = ZFB;

  function aliasRx(aliases) {
    return aliases.map((a) => new RegExp(String(a).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  function editorScope() {
    const ed = ZFB.typewriter.findEditor();
    if (!ed) return document;
    let node = ed;
    for (let i = 0; i < 8 && node.parentElement; i++) {
      node = node.parentElement;
      const hasControls = node.querySelector('button');
      const isWholePage = node === document.body || node.clientWidth > window.innerWidth * 0.95;
      if (hasControls && !isWholePage) return node;
    }
    return document;
  }

  function findTrigger(rxList) {
    const scope = editorScope();
    const buttons = Array.from(scope.querySelectorAll('button, [role="button"]')).filter(
      (b) => U.isVisible(b) && !b.disabled
    );
    const hit = buttons.find((b) => rxList.some((rx) => rx.test(U.text(b))));
    return hit || U.findButton(rxList);
  }

  function optionNodes() {
    const conf = ZFB.selectors.current();
    const found = [];
    for (const sel of conf.optionScopes) {
      try {
        for (const box of document.querySelectorAll(sel)) {
          if (!U.isVisible(box)) continue;
          for (const itemSel of conf.optionItems) {
            for (const item of box.querySelectorAll(itemSel)) {
              if (U.isVisible(item) && U.norm(item.textContent)) found.push(item);
            }
          }
        }
      } catch (_) { /* skip bad selector */ }
    }
    return found;
  }

  async function pick(rxList, label) {
    const trigger = findTrigger(rxList);
    if (!trigger) {
      return { applied: false, reason: `${label} control not found` };
    }
    U.click(trigger);
    let options = [];
    try {
      options = await U.waitFor(() => {
        const opts = optionNodes();
        return opts.length ? opts : null;
      }, { timeout: 2500, label: `${label} popover` });
    } catch (_) {
      document.body.click();
      return { applied: false, reason: `${label} popover did not open` };
    }

    const wanted = label === 'model' ? optionNodes() : options;
    const target = wanted.find((o) => rxList.some((rx) => rx.test(U.text(o))));
    if (!target) {
      document.body.click();
      return { applied: false, reason: `${label} option not in popover` };
    }
    U.click(target);
    await U.sleep(250);
    return { applied: true };
  }

  async function applySettings(settings) {
    const notes = [];

    if (settings.model) {
      const aliases = ZFB.selectors.MODEL_ALIASES[settings.model] || [settings.model];
      const r = await pick(aliasRx(aliases), 'model');
      notes.push(r.applied ? `model -> ${settings.model}` : `model skipped (${r.reason})`);
    }

    if (settings.ratio) {
      const r = await pick(aliasRx([settings.ratio]), 'ratio');
      notes.push(r.applied ? `ratio -> ${settings.ratio}` : `ratio skipped (${r.reason})`);
    }

    const count = Number(settings.count || settings.batch || 1);
    if (count > 1) {
      const r = await pick(aliasRx([String(count)]), 'count');
      notes.push(r.applied ? `count -> x${count}` : `count skipped (${r.reason})`);
    }

    if (settings.duration) {
      const r = await pick(aliasRx([String(settings.duration)]), 'duration');
      notes.push(r.applied ? `duration -> ${settings.duration}` : `duration skipped (${r.reason})`);
    }

    return notes;
  }

  ZFB.popover = { applySettings, aliasRx };
})();
