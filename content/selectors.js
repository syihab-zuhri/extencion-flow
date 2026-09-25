// ZFlow Batcher - local selector registry.
// This file replaces the old "remote core engine" concept: every DOM hook the
// automation relies on lives HERE, in plain text, and can be overridden per
// install via the side panel (stored in chrome.storage.local). No network,
// no license server, no hidden payload.

window.ZFB = window.ZFB || {};

(function () {
  'use strict';

  const STORAGE_KEY = 'zfb_selector_overrides';

  const DEFAULTS = {
    // Prompt editor (ProseMirror / contenteditable)
    editor: [
      '.ProseMirror[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
    ],

    // Submit / generate button near the editor
    submit: ['[aria-label*="Generate" i]', '[aria-label*="Create" i]'],
    submitText: ['generate', 'create', 'start generation', 'run'],

    // Control chips inside the editor toolbar (they open popovers)
    modelTriggerText: [
      'nano banana', 'banana pro', 'banana lite', 'imagen', 'veo', 'omni', 'flash', 'model',
    ],
    ratioTriggerText: ['16:9', '9:16', '1:1', '4:3', '3:4', '5:4', 'aspect', 'ratio'],
    countTriggerText: ['variations', 'images', 'count', 'batch'],
    durationTriggerText: ['4s', '5s', '6s', '8s', 'duration', 'length'],

    // Where options appear after clicking a trigger
    optionScopes: [
      '[role="dialog"]', '[role="menu"]', '[role="listbox"]', '[role="popover"]',
      'cdk-overlay-pane', '.overlay-panel',
    ],
    optionItems: ['[role="menuitem"]', '[role="option"]', 'button', '[role="button"]', 'li'],

    // "Something is rendering" signals inside project tiles
    busy: [
      '[role="progressbar"]', '.progress-bar', '.loader', '.spinner',
      'mat-progress-bar', 'mat-spinner',
    ],
    busyText: ['generating', 'creating', 'rendering', 'queued', 'upscaling', '%'],

    // Error banners/toasts
    errorText: [
      'something went wrong', 'try again', 'an error occurred', 'generation failed',
      'quota', 'out of credits', 'unable to generate', 'rate limit',
    ],

    // Generated assets inside the project canvas
    assetImage: 'img[src*="googleusercontent"], img[src^="blob:"], img[src^="data:image"]',
    assetVideo: 'video[src], video source[src]',

    // New project control (landing page)
    newProjectText: ['new project', 'create project'],
  };

  // Model aliases used when matching popover option labels for the Settings tab.
  const MODEL_ALIASES = {
    'Nano Banana Pro': ['nano banana pro', 'banana pro'],
    'Nano Banana 2': ['nano banana 2', 'banana 2'],
    'Nano Banana 2 Lite': ['nano banana lite', 'banana lite', 'flash image'],
    'Omni 1.1 Flash': ['omni flash', 'omni 1.1'],
    'Veo 3.1 - Lite': ['veo lite'],
    'Veo 3.1 - Fast': ['veo fast'],
    'Veo 3.1 - Quality': ['veo quality', 'veo 3.1'],
  };

  let merged = null;
  let loaded = null;

  function merge(overrides) {
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
      const custom = overrides && overrides[key];
      if (Array.isArray(custom) && custom.length) {
        out[key] = custom.concat(DEFAULTS[key]); // custom wins (tried first)
      } else if (typeof custom === 'string' && custom) {
        out[key] = [custom].concat(DEFAULTS[key]);
      } else {
        out[key] = DEFAULTS[key];
      }
    }
    out.assetImage = (overrides && overrides.assetImage) || DEFAULTS.assetImage;
    out.assetVideo = (overrides && overrides.assetVideo) || DEFAULTS.assetVideo;
    return out;
  }

  async function load() {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    merged = merge(stored && stored[STORAGE_KEY]);
    return merged;
  }

  ZFB.selectors = {
    STORAGE_KEY,
    DEFAULTS,
    MODEL_ALIASES,

    ready() {
      if (!loaded) loaded = load();
      return loaded;
    },

    current() {
      return merged || DEFAULTS;
    },

    reload() {
      loaded = load();
      return loaded;
    },

    async saveOverrides(obj) {
      await chrome.storage.local.set({ [STORAGE_KEY]: obj || {} });
      return ZFB.selectors.reload();
    },
  };
})();
