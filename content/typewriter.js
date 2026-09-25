// ZFlow Batcher - rich-text editor input
// Google Flow's prompt box is a ProseMirror contenteditable that ignores naive
// .textContent writes. This module drives it the way a real user's clipboard
// would: focus -> select-all -> synthetic paste event, with execCommand and
// beforeinput fallbacks, then verifies the DOM actually accepted the text.

window.ZFB = window.ZFB || {};

(function () {
  'use strict';

  const { U } = ZFB;

  function findEditor() {
    return U.findVisible(ZFB.selectors.current().editor);
  }

  function selectAllIn(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function pasteText(el, text) {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    el.dispatchEvent(ev);
    return !ev.defaultPrevented;
  }

  function typedEquals(el, text) {
    const got = U.norm(el.innerText || el.textContent);
    const want = U.norm(text);
    if (!want) return got.length === 0;
    return got.startsWith(want.slice(0, 40)) || got === want;
  }

  async function setPrompt(text) {
    const el = await U.waitFor(findEditor, { timeout: 20000, label: 'prompt editor' });
    el.focus();
    await U.sleep(60);

    // Replace whatever is there.
    selectAllIn(el);
    document.execCommand('delete');
    await U.sleep(40);

    const methods = [
      () => pasteText(el, text),
      () => document.execCommand('insertText', false, text),
      () => {
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: text,
        }));
        document.execCommand('insertText', false, text);
      },
    ];

    for (const attempt of methods) {
      attempt();
      try {
        await U.waitFor(() => (typedEquals(el, text) ? el : null), { timeout: 1500, label: 'typed text' });
        return true;
      } catch (_) {
        selectAllIn(el);
        document.execCommand('delete');
        await U.sleep(60);
      }
    }
    throw new Error('editor rejected the prompt text');
  }

  async function clearPrompt() {
    const el = findEditor();
    if (!el) return;
    el.focus();
    selectAllIn(el);
    document.execCommand('delete');
  }

  ZFB.typewriter = { setPrompt, clearPrompt, findEditor };
})();
