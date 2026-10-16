// graphics-options.js — graphics quality settings for a StarHermit browser game.
//
// Rates the player's GPU on a 0–20 hardware level and picks a starting preset from it, resolves presets
// and per-effect overrides into concrete tiers, keeps the choice in localStorage (ready before the first
// frame) and in the player's StarHermit settings (a separate profile per reported GPU), paces rendering
// (half the display refresh rate on phones and tablets unless the player sets a limit), runs adaptive
// resolution from your frame times, and builds an options panel. It imports no engine: your renderer
// listens for changes and applies the tiers. Guide: https://wiki.starhermit.com/docs/tutorials/graphics-options.html
//
// Copy it into your game unchanged. Edit the quality table by passing `table` / `categories` / `levels`
// to createGraphics(), not by editing this file.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

/** The lowest hardware level (0–20) at which Auto picks each preset. Pass `levels` with your own table. */
export const PRESET_LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

/** Effect → allowed tiers, cheapest first. Pass your own to createGraphics() to add or drop effects. */
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
};

/** Each preset: a tier per category, a render scale, and a cap on the device pixel ratio. */
export const TABLE = {
  low: { scale: 1, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', antialias: 'off' },
  balanced: { scale: 1, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', antialias: 'fxaa' },
  high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', antialias: 'smaa' },
  ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', antialias: 'msaa' },
};

export const STRINGS = {
  quality: 'Quality',
  auto: 'Auto ({tier})',
  fromPreset: 'From preset ({tier})',
  renderScale: 'Render scale',
  adaptive: 'Adaptive resolution',
  maxFps: 'Maximum frame rate',
  autoFps: 'Auto (refresh rate)',
  autoHalfFps: 'Auto (half refresh rate)',
  customFps: 'Custom',
  fpsLimit: 'Maximum FPS (1–1000)',
  showFps: 'Show frame rate',
  unknownGpu: 'Unknown GPU',
  level: 'Level {level}',
  postFailed: 'Post-processing is unavailable on this device, so those effects are off.',
  categories: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', antialias: 'Anti-aliasing' },
  tiers: {
    low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', off: 'Off', on: 'On',
    medium: 'Medium', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
  },
};

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/;
const DISCRETE = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/;

// Known GPUs by hardware level. 0 is a Samsung Galaxy S20 (Adreno 650 / Mali-G77) or weaker, 20 is an
// RTX 5090, and each level is roughly 23% more graphics throughput than the one below (20 ≈ 60× 0).
// Names are whole words of the lower-cased renderer with (TM)/(R) removed; the longest match wins.
const GPU_LEVELS = {
  20: ['rtx 5090'],
  19: ['rtx 4090'],
  18: ['rtx 5080', 'rtx 4080 super', 'rx 7900 xtx', 'rx 9070 xt'],
  17: ['rtx 4080', 'rtx 5070 ti', 'rtx 4070 ti super', 'rx 7900 xt', 'rx 9070', 'apple m3 ultra'],
  16: ['rtx 3090 ti', 'rtx 3090', 'rtx 3080 ti', 'rtx 4070 ti', 'rtx 4070 super', 'rtx 5070', 'rx 7900 gre',
    'rx 6950 xt', 'rx 6900 xt', 'rx 6800 xt', 'rx 7800 xt', 'apple m2 ultra'],
  15: ['rtx 3080', 'rtx 4070', 'rx 6800', 'rx 7700 xt', 'apple m1 ultra', 'apple m4 max'],
  14: ['rtx 3070 ti', 'rtx 3070', 'rtx 2080 ti', 'rtx 4060 ti', 'rtx 5060 ti', 'rx 6750 xt', 'rx 9060 xt',
    'arc a770', 'arc b580', 'apple m3 max'],
  13: ['rtx 3060 ti', 'rtx 2080 super', 'rtx 2080', 'rtx 4060', 'rtx 5060', 'rx 6700 xt', 'rx 6700',
    'rx 7600 xt', 'rx 7600', 'arc a750', 'arc b570', 'radeon 8060s', 'apple m2 max'],
  12: ['rtx 3060', 'rtx 2070 super', 'rtx 2070', 'rtx 2060 super', 'gtx 1080 ti', 'rx 6650 xt', 'rx 6600 xt',
    'rx 5700 xt', 'arc a580', 'apple m1 max'],
  11: ['rtx 2060', 'gtx 1080', 'rx 6600', 'rx 5700', 'rx 5600 xt', 'rx vega 64', 'apple m4 pro'],
  10: ['rtx 3050', 'gtx 1070 ti', 'gtx 1070', 'gtx 1660 ti', 'gtx 1660 super', 'gtx 980 ti', 'rx vega 56',
    'apple m2 pro', 'apple m3 pro'],
  9: ['gtx 1660', 'gtx 1650 super', 'rx 6500 xt', 'rx 5500 xt', 'rx 590', 'apple m1 pro', 'apple m5'],
  8: ['gtx 1060', 'gtx 980', 'rx 580', 'rx 570', 'rx 480', 'arc a380', 'arc 140v', 'arc 140t', 'radeon 890m',
    'apple m4', 'adreno 840'],
  7: ['gtx 1650', 'gtx 970', 'rx 470', 'rx 6400', 'arc graphics', 'arc 130v', 'radeon 880m', 'apple m2',
    'apple m3', 'adreno 830', 'immortalis-g925'],
  6: ['gtx 780', 'arc a310', 'radeon 780m', 'radeon 680m', 'apple m1', 'adreno 750', 'adreno 825',
    'immortalis-g720'],
  5: ['gtx 1050 ti', 'gtx 960', 'gtx 770', 'gtx 680', 'rx 560', 'mx570', 'radeon 760m', 'adreno 740',
    'xclipse 940', 'xclipse 950'],
  4: ['gtx 1050', 'gtx 950', 'gtx 750 ti', 'mx550', 'mx450', 'iris xe', 'xe graphics', 'radeon 660m',
    'adreno x1', 'adreno 735', 'immortalis-g715'],
  3: ['gtx 750', 'rx 550', 'vangogh', 'custom gpu 0405', 'adreno 730', 'adreno 725'],
  2: ['gt 1030', 'mx350', 'mx330', 'mx250', 'mx150', 'iris plus', 'vega 11', 'vega 10', 'vega 8',
    'radeon graphics', 'mali-g715', 'mali-g710', 'xclipse 920'],
  1: ['vega 7', 'vega 6', 'vega 3', 'adreno 720', 'adreno 660', 'mali-g78', 'mali-g615', 'mali-g610'],
  0: ['adreno 650', 'mali-g77', 'adreno', 'mali', 'powervr', 'videocore', 'tegra', 'uhd graphics',
    'hd graphics', 'gt 730', 'gt 710', 'mx130', 'mx110'],
};
const GPU_MATCHERS = Object.entries(GPU_LEVELS)
  .flatMap(([level, names]) => names.map((name) => [name, Number(level)]))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([name, level]) => [new RegExp(`(^|[^a-z0-9])${name}(?![a-z0-9])`), level]);

/** What the browser reports about this machine. `env` defaults to the page (pass a fake in tests). */
export function detectSystem(env = globalThis) {
  const nav = env.navigator || {};
  const mq = (q) => { try { return !!env.matchMedia?.(q).matches; } catch { return false; } };
  const out = {
    gpu: '',
    webgl: false,
    webgl2: false,
    mobile: !!nav.userAgentData?.mobile || mq('(pointer: coarse)'),
    cores: Number(nav.hardwareConcurrency) || 0,
    memoryGb: Number(nav.deviceMemory) || 0, // Chromium only, and never above 8
  };
  try {
    const canvas = env.document.createElement('canvas');
    let gl = canvas.getContext('webgl2');
    out.webgl2 = !!gl;
    gl = gl || canvas.getContext('webgl');
    if (!gl) return out;
    out.webgl = true;
    // Firefox and Safari already report the real renderer, and Firefox warns in the console when the
    // debug extension is requested, so only ask it when RENDERER is Chromium's generic mask.
    let name = String(gl.getParameter(gl.RENDERER) || '');
    if (!name || /^(webkit|mozilla)\b/i.test(name)) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || name);
    }
    out.gpu = name;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // free the probe context
  } catch { /* no DOM or no WebGL: keep the defaults */ }
  return out;
}

/** The hardware level (0–20) for a detectSystem() result. */
export function detectLevel(system) {
  const s = system || {};
  const g = String(s.gpu || '').toLowerCase().replace(/\((tm|r)\)/g, ' ').replace(/\s+/g, ' ');
  if (s.webgl === false || SOFTWARE.test(g)) return 0;
  if (s.webgl2 === false || (s.cores && s.cores <= 2) || (s.memoryGb && s.memoryGb <= 2)) return 0;
  // Firefox names only a GPU family ("…, or similar"), so rate it by class like an unlisted GPU.
  const known = !/or similar/.test(g) && GPU_MATCHERS.find(([re]) => re.test(g));
  let level = known ? known[1] - (/laptop|max-q/.test(g) ? 2 : 0) : s.mobile ? 0 : DISCRETE.test(g) ? 10 : 4;
  // Phones, tablets and low-memory machines: Auto never goes above Balanced (heat and battery).
  if (s.mobile || (s.memoryGb && s.memoryGb <= 4)) level = Math.min(level, PRESET_LEVELS.high - 1);
  return clamp(level, 0, 20);
}

/** The preset for a hardware level: the one with the highest starting level at or below it. */
export function presetForLevel(level, levels = PRESET_LEVELS) {
  const ranked = Object.entries(levels).sort((a, b) => a[1] - b[1]);
  return (ranked.filter(([, min]) => min <= level).pop() || ranked[0])[0];
}

/** The preset Auto starts from for a detectSystem() result. */
export function detectPreset(system, levels = PRESET_LEVELS) {
  return presetForLevel(detectLevel(system), levels);
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset?: 'auto'|<preset>, renderScale?: 0.5–2, adaptive?: bool, showFps?: bool,
 *            maxFps?: 1–1000 (integer; absent = display refresh rate, or half of it when `mobile`),
 *            <category>?: <tier> }.
 */
export function resolve(saved, detected, { table = TABLE, categories = CATEGORIES, mobile = false } = {}) {
  const s = saved || {};
  const presets = Object.keys(table);
  const auto = !presets.includes(s.preset);
  const preset = !auto ? s.preset : presets.includes(detected) ? detected : presets[Math.min(1, presets.length - 1)];
  const row = table[preset];
  const maxFps = fpsLimit(s.maxFps);
  const out = {
    preset,
    auto,
    scale: (row.scale || 1) * clamp(Number(s.renderScale) || 1, 0.5, 2),
    dprCap: row.dprCap || 2,
    adaptive: s.adaptive !== false,
    showFps: !!s.showFps,
    maxFps,
    halfRefresh: !!mobile && !maxFps,
  };
  for (const [cat, tiers] of Object.entries(categories)) out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  return out;
}

/** Saved settings after picking a preset ('auto' or a preset name): overrides cleared, the rest kept. */
export function withPreset(saved, preset) {
  const s = saved || {};
  const out = { preset: preset || 'auto' };
  if (s.renderScale != null) out.renderScale = s.renderScale;
  if (s.adaptive === false) out.adaptive = false;
  if (s.showFps) out.showFps = true;
  if (fpsLimit(s.maxFps)) out.maxFps = fpsLimit(s.maxFps);
  return out;
}

/**
 * The live settings store. Call StarHermit.init() first so a launch token is already read.
 * Options: storageKey (localStorage key prefix, default 'graphics'), cloudKey (StarHermit settings key
 * prefix, default 'graphics'), table, categories, levels (preset → lowest hardware level that picks it,
 * default PRESET_LEVELS), sdk (default window.StarHermit; null for none), storage (default localStorage;
 * null for none), system (default detectSystem()).
 */
export function createGraphics(opts = {}) {
  const table = opts.table || TABLE;
  const categories = opts.categories || CATEGORIES;
  const presets = Object.keys(table);
  const sdk = opts.sdk === undefined ? globalThis.StarHermit : opts.sdk;
  const storage = opts.storage === undefined ? localStorageOrNull() : opts.storage;
  const system = opts.system || detectSystem();
  const level = detectLevel(system);
  const detected = presetForLevel(level, opts.levels || PRESET_LEVELS);
  // Preserve each GPU's choices independently, even when two GPUs resolve to the same quality tier.
  const gpuProfile = graphicsGpuProfile(system.gpu);
  const storageKey = gpuProfile ? `${opts.storageKey || 'graphics'}.gpu.${gpuProfile}` : null;
  const cloudSlot = gpuProfile ? `${opts.cloudKey || 'graphics'}.gpu.${gpuProfile}` : null;
  const handlers = { change: new Set(), info: new Set() };

  let stored = readLocal(); // { saved, at }: `at` (ms) orders this device's copy against the cloud's
  let autoTier = detected; // Auto's preset; steps down for the session when frames stay slow
  let cloud = 'idle'; // idle | loading | ready | failed
  let pushTimer = 0;
  let frames = [];
  let slowWindows = 0;
  let nextRender = null;
  let lastRender = null; // half-refresh pacing
  let lastTick = null;
  let gaps = []; // recent spacing of animation callbacks (ms): the display's refresh interval

  const gfx = {
    system,
    level,
    detected,
    gpuProfile,
    storageKey,
    cloudSlot,
    table,
    categories,
    settings: null,
    adaptiveScale: 1,
    fps: 0,
    info: { pixels: null, postFailed: false },
    get saved() { return stored.saved; },
    get autoTier() { return autoTier; },

    /** on('change', fn(settings, reason)) runs now and after every change; on('info', fn(info)). */
    on(type, fn) {
      handlers[type].add(fn);
      if (type === 'change') fn(gfx.settings, 'init');
      return () => handlers[type].delete(fn);
    },

    /** Merge into the saved settings; a null value (or 'preset' for a category) removes the override. */
    set(patch) {
      const s = { ...stored.saved };
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === 'preset') delete s[k]; else s[k] = v;
      }
      commit(s);
    },

    /** Pick a preset ('auto' or a preset name); clears every per-category override. */
    setPreset(p) {
      if (p === 'auto') autoTier = detected; // re-detect when the player asks for Auto again
      commit(withPreset(stored.saved, presets.includes(p) ? p : 'auto'));
    },

    /** Device pixel ratio for the renderer: capped per preset, × render scale × adaptive scale. */
    pixelRatio(dpr = globalThis.devicePixelRatio || 1) {
      const s = gfx.settings;
      return clamp(Math.round(Math.min(dpr, s.dprCap) * s.scale * gfx.adaptiveScale * 100) / 100, 0.25, 3);
    },

    /** Call on each animation callback with its timestamp (ms); false skips rendering this tick. */
    shouldRender(now) {
      if (!Number.isFinite(now)) return false;
      const { maxFps: limit, halfRefresh } = gfx.settings;
      if (!limit && !halfRefresh) return true; // requestAnimationFrame already follows the display's refresh rate
      if (lastTick != null && (now < lastTick || now - lastTick > 1000)) nextRender = lastRender = null;
      else if (lastTick != null && now > lastTick) gaps = [...gaps.slice(-15), now - lastTick];
      lastTick = now;
      if (!limit) {
        // Every second callback, judged by time so a missed refresh is not skipped again. Skipped ticks
        // are cheap, so callbacks keep arriving once per refresh and `gaps` keeps measuring it.
        const interval = halfInterval();
        if (lastRender != null && interval && now - lastRender < interval * 0.75) return false;
        lastRender = now;
        return true;
      }
      const interval = 1000 / limit;
      if (nextRender == null) {
        nextRender = now + interval;
        return true;
      }
      if (now + 1e-6 < nextRender) return false;
      // Keep the fractional remainder: e.g. 60 FPS on a 144 Hz display must not fall to 48 FPS.
      nextRender += (Math.floor((now - nextRender + 1e-6) / interval) + 1) * interval;
      return true;
    },

    /** Feed every frame's duration (ms). Returns true when the pixel ratio or the Auto preset changed. */
    frame(ms) {
      const s = gfx.settings;
      const budget = s.maxFps ? 1000 / s.maxFps : s.halfRefresh ? halfInterval() : 0;
      if (!Number.isFinite(ms) || !(ms > 0) || ms > Math.max(1000, budget * 2)) return false;
      frames.push(ms);
      if (frames.length < 90) return false;
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      // Clip isolated hitches for adaptation, but report the real FPS, including intentional waits.
      const timing = frames.reduce((a, b) => a + Math.min(b, Math.max(250, budget * 2)), 0) / frames.length;
      frames = [];
      gfx.fps = Math.round(1000 / avg);
      // Deliberate waiting for a manual limit is not evidence that the GPU is struggling.
      const slow = Math.max(26, budget * 1.15);
      const fast = Math.max(14, budget * 0.85);
      const before = gfx.adaptiveScale;
      if (s.adaptive) {
        if (timing > slow) gfx.adaptiveScale = Math.max(0.6, round2(before - 0.1));
        else if (timing < fast) gfx.adaptiveScale = Math.min(1, round2(before + 0.05));
      }
      // Auto only: still slow at the lowest adaptive scale for three windows → one preset lower.
      slowWindows = s.adaptive && s.auto && timing > slow && before === 0.6 ? slowWindows + 1 : 0;
      if (slowWindows >= 3 && presets.indexOf(autoTier) > 0) {
        autoTier = presets[presets.indexOf(autoTier) - 1];
        apply('auto');
        return true;
      }
      updateFps();
      return gfx.adaptiveScale !== before;
    },

    /** Tell the panel what the renderer did: { pixels: [w, h] }, { postFailed: true }. */
    report(info) {
      Object.assign(gfx.info, info);
      for (const fn of handlers.info) fn(gfx.info);
    },

    /** Read the cloud copy now (it also runs at start-up and on sign-in). Resolves when done. */
    sync: pull,
  };

  apply('init');
  gfx.ready = pull();
  // 'auth' also fires on every token renewal: read again only when a different player signs in.
  let player = sdk?.signedIn ? sdk.userId || 'player' : null;
  sdk?.on?.('auth', (e) => {
    const now = e?.signedIn ? e.userId || 'player' : null;
    if (now && now !== player) pull();
    player = now;
  });
  return gfx;

  function commit(saved) {
    stored = { saved, at: Date.now() };
    writeLocal();
    apply('settings');
    if (cloud === 'ready') push();
    else if (cloud === 'failed') pull(); // retry the read; it pushes once it knows ours is newer
    // idle (signed out) keeps it local; loading pushes after the read compares timestamps
  }

  function apply(reason) {
    const previousLimit = gfx.settings?.maxFps;
    gfx.settings = resolve(stored.saved, autoTier, { table, categories, mobile: system.mobile });
    if (previousLimit !== gfx.settings.maxFps) { nextRender = null; lastRender = null; lastTick = null; }
    gfx.adaptiveScale = 1;
    frames = [];
    slowWindows = 0;
    const root = globalThis.document?.documentElement;
    if (root) {
      root.dataset.gfxPreset = gfx.settings.preset;
      root.dataset.gfxAuto = gfx.settings.auto ? '1' : '0';
    }
    updateFps();
    for (const fn of handlers.change) fn(gfx.settings, reason);
  }

  // Load before save: never write the cloud copy until a read has shown ours is newer.
  async function pull() {
    if (!cloudSlot || !sdk?.signedIn || !sdk.slug || typeof sdk.api !== 'function') return;
    cloud = 'loading';
    let remote;
    try {
      const res = await sdk.api(`/api/v1/games/${encodeURIComponent(sdk.slug)}/settings`);
      remote = res?.settings?.[cloudSlot];
    } catch {
      cloud = 'failed';
      return;
    }
    cloud = 'ready';
    const valid = remote && typeof remote.saved === 'object' && remote.saved && Number.isFinite(remote.at);
    if (valid && remote.at > stored.at) {
      stored = { saved: remote.saved, at: remote.at };
      writeLocal();
      apply('cloud');
    } else if (stored.at && (!valid || remote.at < stored.at)) {
      push();
    }
  }

  // Two refresh intervals (the lower quartile of recent callback spacing, so missed refreshes don't
  // count), or 0 — render every callback — until measured or below 50 Hz (e.g. low-power throttling).
  function halfInterval() {
    const refresh = [...gaps].sort((a, b) => a - b)[gaps.length >> 2] || 0;
    return refresh > 0 && refresh <= 20 ? refresh * 2 : 0;
  }

  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sdk.setSetting(cloudSlot, stored), 800);
  }

  function readLocal() {
    if (!storageKey) return { saved: {}, at: 0 };
    try {
      const v = JSON.parse(storage?.getItem(storageKey) || 'null');
      if (v && typeof v.saved === 'object' && v.saved && Number.isFinite(v.at)) return v;
    } catch { /* unreadable: start fresh */ }
    return { saved: {}, at: 0 };
  }

  function writeLocal() {
    if (!storageKey) return;
    try { storage?.setItem(storageKey, JSON.stringify(stored)); } catch { /* storage off: session only */ }
  }

  // Frame-rate readout, bottom-left and click-through so it never covers HUD controls.
  function updateFps() {
    const doc = globalThis.document;
    if (!doc?.body) return;
    let el = doc.getElementById('gfx-fps');
    if (!gfx.settings.showFps) { if (el) el.hidden = true; return; }
    if (!el) {
      el = doc.createElement('div');
      el.id = 'gfx-fps';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));'
        + 'z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.6);'
        + 'color:#fff;font:12px/1.4 ui-monospace,monospace';
      doc.body.append(el);
    }
    el.hidden = false;
    el.textContent = `${gfx.fps ? gfx.fps : '…'} fps · ${gfx.pixelRatio()}×`;
  }
}

/**
 * Build the Graphics controls inside `container` (your settings dialog supplies the frame and title).
 * Options: strings (merged over STRINGS — pass your translations). Returns a function that removes it.
 */
export function mountGraphicsPanel(container, gfx, opts = {}) {
  const t = {
    ...STRINGS,
    ...opts.strings,
    categories: { ...STRINGS.categories, ...opts.strings?.categories },
    tiers: { ...STRINGS.tiers, ...opts.strings?.tiers },
  };
  const tier = (v) => t.tiers[v] || v.charAt(0).toUpperCase() + v.slice(1);
  const fill = (str, v) => str.replace('{tier}', tier(v));
  const doc = container.ownerDocument;
  addPanelStyle(doc);

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(doc.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  const row = (label, control, extra) => el('label', { className: 'gfx-row' }, el('span', { textContent: label }), ...(extra ? [extra] : []), control);
  const select = (key, values) => {
    const s = el('select');
    s.dataset.gfx = key;
    for (const v of values) s.append(el('option', { value: v }));
    return s;
  };

  const presets = Object.keys(gfx.table);
  const preset = select('preset', ['auto', ...presets]);
  const scale = el('input', { type: 'range', min: 50, max: 200, step: 5 });
  scale.dataset.gfx = 'renderScale';
  const scaleOut = el('output');
  const cats = Object.entries(gfx.categories).map(([cat, tiers]) => [cat, select(cat, ['preset', ...tiers])]);
  const adaptive = el('input', { type: 'checkbox' });
  adaptive.dataset.gfx = 'adaptive';
  const showFps = el('input', { type: 'checkbox' });
  showFps.dataset.gfx = 'showFps';
  const fpsMode = select('frameRate', ['auto', 'custom']);
  fpsMode.options[0].textContent = gfx.system.mobile ? t.autoHalfFps : t.autoFps;
  fpsMode.options[1].textContent = t.customFps;
  const maxFps = el('input', { type: 'number', min: 1, max: 1000, step: 1, value: 60 });
  maxFps.dataset.gfx = 'maxFps';
  const fpsRow = row(t.fpsLimit, maxFps);
  const summary = el('p', { className: 'gfx-summary' });
  summary.setAttribute('aria-live', 'polite');
  const note = el('p', { className: 'gfx-note', textContent: t.postFailed, hidden: true });

  const panel = el('div', { className: 'gfx-panel' },
    row(t.quality, preset),
    row(t.renderScale, scale, scaleOut),
    ...cats.map(([cat, s]) => row(t.categories[cat] || cat, s)),
    row(t.adaptive, adaptive),
    row(t.maxFps, fpsMode),
    fpsRow,
    row(t.showFps, showFps),
    summary,
    note);
  container.append(panel);

  preset.addEventListener('change', () => gfx.setPreset(preset.value));
  scale.addEventListener('input', () => { scaleOut.value = `${scale.value}%`; });
  scale.addEventListener('change', () => gfx.set({ renderScale: Number(scale.value) / 100 }));
  for (const [cat, s] of cats) s.addEventListener('change', () => gfx.set({ [cat]: s.value }));
  adaptive.addEventListener('change', () => gfx.set({ adaptive: adaptive.checked ? null : false }));
  showFps.addEventListener('change', () => gfx.set({ showFps: showFps.checked || null }));
  fpsMode.addEventListener('change', () => gfx.set({ maxFps: fpsMode.value === 'auto' ? null : fpsLimit(Number(maxFps.value)) || 60 }));
  maxFps.addEventListener('change', () => {
    if (maxFps.value !== '' && maxFps.checkValidity()) gfx.set({ maxFps: Number(maxFps.value) });
    else maxFps.value = gfx.settings.maxFps || 60;
  });

  const render = () => {
    const r = gfx.settings;
    const saved = gfx.saved;
    preset.options[0].textContent = fill(t.auto, gfx.autoTier);
    for (const o of [...preset.options].slice(1)) o.textContent = tier(o.value);
    preset.value = r.auto ? 'auto' : r.preset;
    const pct = Math.round(clamp(Number(saved.renderScale) || 1, 0.5, 2) * 100);
    scale.value = pct;
    scaleOut.value = `${pct}%`;
    for (const [cat, s] of cats) {
      s.options[0].textContent = fill(t.fromPreset, gfx.table[r.preset][cat]);
      for (const o of [...s.options].slice(1)) o.textContent = tier(o.value);
      s.value = gfx.categories[cat].includes(saved[cat]) ? saved[cat] : 'preset';
    }
    adaptive.checked = r.adaptive;
    showFps.checked = r.showFps;
    fpsMode.value = r.maxFps ? 'custom' : 'auto';
    fpsRow.hidden = !r.maxFps;
    maxFps.disabled = !r.maxFps;
    if (r.maxFps) maxFps.value = r.maxFps;
    const px = gfx.info.pixels;
    summary.textContent = [gfx.system.gpu || t.unknownGpu, t.level.replace('{level}', gfx.level), tier(r.preset),
      px && `${px[0]}×${px[1]} px`].filter(Boolean).join(' · ');
    note.hidden = !gfx.info.postFailed;
  };
  const offChange = gfx.on('change', render);
  const offInfo = gfx.on('info', render);
  return () => { offChange(); offInfo(); panel.remove(); };
}

// Low-specificity defaults (:where) so any rule in your own stylesheet wins.
function addPanelStyle(doc) {
  if (doc.getElementById('gfx-panel-style')) return;
  const style = doc.createElement('style');
  style.id = 'gfx-panel-style';
  style.textContent = `
:where(.gfx-panel) { display: grid; gap: .5rem; }
:where(.gfx-row) { display: flex; align-items: center; gap: .75rem; min-height: 44px; }
:where(.gfx-row[hidden]) { display: none; }
:where(.gfx-row) > span { flex: 1; }
:where(.gfx-row) > select, :where(.gfx-row) > input[type=range], :where(.gfx-row) > input[type=number] { max-width: 60%; min-width: 0; }
:where(.gfx-row) > input[type=number] { width: 6em; }
:where(.gfx-row) > output { min-width: 3.5em; text-align: end; }
:where(.gfx-summary, .gfx-note) { margin: 0; font-size: .85em; opacity: .8; overflow-wrap: anywhere; }`;
  doc.head.append(style);
}

function localStorageOrNull() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function fpsLimit(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? clamp(Math.round(v), 1, 1000) : 0;
}

// A bounded settings-key suffix; normalize harmless differences in browser-reported GPU names.
function graphicsGpuProfile(gpu) {
  const name = String(gpu || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!name) return null; // cannot safely assign saved choices to an unidentified GPU
  let hash = 0xcbf29ce484222325n;
  for (const char of name) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
