// graphics-options.js — graphics quality settings for a StarHermit browser game.
//
// Picks a starting preset from the player's hardware, resolves presets and per-effect overrides into
// concrete tiers, keeps the choice in localStorage (ready before the first frame) and in the player's
// StarHermit settings (follows them to their other machines), runs adaptive resolution from your
// frame times, and builds an options panel. It imports no engine: your renderer listens for changes
// and applies the tiers. Guide: https://wiki.starhermit.com/docs/tutorials/graphics-options.html
//
// Copy it into your game unchanged. Edit the quality table by passing `table` / `categories` to
// createGraphics(), not by editing this file.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

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
  showFps: 'Show frame rate',
  unknownGpu: 'Unknown GPU',
  postFailed: 'Post-processing is unavailable on this device, so those effects are off.',
  categories: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', antialias: 'Anti-aliasing' },
  tiers: {
    low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', off: 'Off', on: 'On',
    medium: 'Medium', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
  },
};

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/;
const DISCRETE = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/;

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

/** The preset Auto starts from for a detectSystem() result. */
export function detectPreset(system) {
  const s = system || {};
  const g = String(s.gpu || '').toLowerCase();
  if (s.webgl === false || SOFTWARE.test(g)) return 'low';
  let p = DISCRETE.test(g) ? 'high' : 'balanced';
  if (s.webgl2 === false || (s.cores && s.cores <= 2) || (s.memoryGb && s.memoryGb <= 2)) p = 'low';
  // Phones, tablets and low-memory machines: Auto never goes above Balanced (heat and battery).
  else if (s.mobile || (s.memoryGb && s.memoryGb <= 4)) p = p === 'high' ? 'balanced' : p;
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset?: 'auto'|<preset>, renderScale?: 0.5–2, adaptive?: bool, showFps?: bool, <category>?: <tier> }.
 */
export function resolve(saved, detected, { table = TABLE, categories = CATEGORIES } = {}) {
  const s = saved || {};
  const presets = Object.keys(table);
  const auto = !presets.includes(s.preset);
  const preset = !auto ? s.preset : presets.includes(detected) ? detected : presets[Math.min(1, presets.length - 1)];
  const row = table[preset];
  const out = {
    preset,
    auto,
    scale: (row.scale || 1) * clamp(Number(s.renderScale) || 1, 0.5, 2),
    dprCap: row.dprCap || 2,
    adaptive: s.adaptive !== false,
    showFps: !!s.showFps,
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
  return out;
}

/**
 * The live settings store. Call StarHermit.init() first so a launch token is already read.
 * Options: storageKey (localStorage key, default 'graphics'), cloudKey (StarHermit settings key
 * prefix, default 'graphics'), table, categories, sdk (default window.StarHermit; null for none),
 * storage (default localStorage; null for none), system (default detectSystem()).
 */
export function createGraphics(opts = {}) {
  const table = opts.table || TABLE;
  const categories = opts.categories || CATEGORIES;
  const presets = Object.keys(table);
  const sdk = opts.sdk === undefined ? globalThis.StarHermit : opts.sdk;
  const storage = opts.storage === undefined ? localStorageOrNull() : opts.storage;
  const storageKey = opts.storageKey || 'graphics';
  const system = opts.system || detectSystem();
  const detected = detectPreset(system);
  // One cloud slot per kind of machine, so a phone never inherits the desktop's Ultra.
  const cloudSlot = `${opts.cloudKey || 'graphics'}.${system.mobile ? 'mobile' : 'desktop'}.${detected}`;
  const handlers = { change: new Set(), info: new Set() };

  let stored = readLocal(); // { saved, at }: `at` (ms) orders this device's copy against the cloud's
  let autoTier = detected; // Auto's preset; steps down for the session when frames stay slow
  let cloud = 'idle'; // idle | loading | ready | failed
  let pushTimer = 0;
  let frames = [];
  let slowWindows = 0;

  const gfx = {
    system,
    detected,
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

    /** Feed every frame's duration (ms). Returns true when the pixel ratio or the Auto preset changed. */
    frame(ms) {
      if (!(ms > 0) || ms > 1000) return false; // pauses and tab switches are not slow frames
      frames.push(Math.min(ms, 250)); // one hitch (a shader compile) must not sink the average
      if (frames.length < 90) return false;
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      frames = [];
      gfx.fps = Math.round(1000 / avg);
      const s = gfx.settings;
      const before = gfx.adaptiveScale;
      if (s.adaptive) {
        if (avg > 26) gfx.adaptiveScale = Math.max(0.6, round2(before - 0.1));
        else if (avg < 14) gfx.adaptiveScale = Math.min(1, round2(before + 0.05));
      }
      // Auto only: still slow at the lowest adaptive scale for three windows → one preset lower.
      slowWindows = s.adaptive && s.auto && avg > 26 && before === 0.6 ? slowWindows + 1 : 0;
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
    gfx.settings = resolve(stored.saved, autoTier, { table, categories });
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
    if (!sdk?.signedIn || !sdk.slug || typeof sdk.api !== 'function') return;
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

  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sdk.setSetting(cloudSlot, stored), 800);
  }

  function readLocal() {
    try {
      const v = JSON.parse(storage?.getItem(storageKey) || 'null');
      if (v && typeof v.saved === 'object' && v.saved && Number.isFinite(v.at)) return v;
    } catch { /* unreadable: start fresh */ }
    return { saved: {}, at: 0 };
  }

  function writeLocal() {
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
  const summary = el('p', { className: 'gfx-summary' });
  summary.setAttribute('aria-live', 'polite');
  const note = el('p', { className: 'gfx-note', textContent: t.postFailed, hidden: true });

  const panel = el('div', { className: 'gfx-panel' },
    row(t.quality, preset),
    row(t.renderScale, scale, scaleOut),
    ...cats.map(([cat, s]) => row(t.categories[cat] || cat, s)),
    row(t.adaptive, adaptive),
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
    const px = gfx.info.pixels;
    summary.textContent = [gfx.system.gpu || t.unknownGpu, tier(r.preset), px && `${px[0]}×${px[1]} px`].filter(Boolean).join(' · ');
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
:where(.gfx-row) > span { flex: 1; }
:where(.gfx-row) > select, :where(.gfx-row) > input[type=range] { max-width: 60%; }
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
