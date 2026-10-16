# Tutorial: graphics options with auto-detected quality

Give your browser game a **Graphics** menu that picks a sensible quality level for the player's machine
on first launch, lets them override it, and remembers their choice across devices through StarHermit.

For the corresponding Audio section, see [audio options with an auto-detected sound limit](audio-options.md).
For a Language section, see [localize your game and add language settings](game-localization.md).

[`graphics-options.js`](../sdk/graphics-options.js) is a single ES module, with no dependencies, that
handles the bookkeeping:

- **Auto** rates the GPU on a hardware level from 0 (a Samsung Galaxy S20 or weaker) to 20 (an
  RTX 5090), picks one of four presets (Low, Balanced, High, Ultra) from that level, memory, CPU cores
  and device type, and steps down for the session if frames stay slow.
- Players can override each effect (shadows, ambient occlusion, bloom, anti-aliasing, or your own),
  set a 50–200% render scale, choose a manual maximum FPS instead of automatic display refresh
  (half the refresh rate on phones and tablets), and toggle adaptive resolution and a frame-rate readout.
- Settings are saved to `localStorage` so they apply before the first frame, and to the player's
  [per-game settings](../api/games.md#per-player-game-settings) so they follow the player to their
  other machines.
- It includes a ready-made options panel built from the same quality table.

It imports no engine. Your renderer listens for changes and applies the tiers. This page wires it to
three.js. Other engines use the same hooks (see [Other engines](#other-engines)).

1. [Add the files](#1-add-the-files)
2. [Create the store and the panel](#2-create-the-store-and-the-panel)
3. [Apply the settings to your renderer](#3-apply-the-settings-to-your-renderer)
4. [Fit it to your game](#4-fit-it-to-your-game)
5. [Test it](#5-test-it)

## 1. Add the files

Copy [`starhermit-sdk.js`](../sdk/starhermit-sdk.js) and
[`graphics-options.js`](../sdk/graphics-options.js) next to your game's scripts, unchanged. Call
`StarHermit.init()` **before** your module runs, so the launch token has been read by the time the
graphics store checks whether a player is signed in:

```html
<script src="starhermit-sdk.js"></script>
<script>StarHermit.init();</script>
<script type="module" src="main.js"></script>
```

Without a launch token (local development, any other host), the store keeps everything in
`localStorage` and makes no requests.

## 2. Create the store and the panel

```js
import { createGraphics, mountGraphicsPanel } from './graphics-options.js';

const gfx = createGraphics({ storageKey: 'mygame.graphics' });
mountGraphicsPanel(document.getElementById('graphics-options'), gfx);
```

`mountGraphicsPanel` fills the element with the controls. Your settings dialog supplies the frame, the
title and the Close button. Every change applies immediately and is saved.

### How Auto picks a preset

On creation the store probes a throwaway WebGL context once (`gfx.system`), rates the reported GPU on
a hardware level from 0 to 20 (`gfx.level`), and maps that level to a preset (`gfx.detected`). Level 0
is a Samsung Galaxy S20 (Adreno 650 or Mali-G77) or anything weaker; level 20 is an RTX 5090. Each
level is roughly 23% more graphics throughput than the one below, so level 20 is about 60× level 0:

| Level | × level 0 | Examples | Auto preset |
|---|---|---|---|
| 20 | 60 | RTX 5090 | Ultra |
| 19 | 49 | RTX 4090 | Ultra |
| 18 | 40 | RTX 5080, RTX 4080 Super, RX 7900 XTX, RX 9070 XT | Ultra |
| 17 | 32 | RTX 4080, RTX 5070 Ti, RTX 4070 Ti Super, RX 7900 XT, Apple M3 Ultra | Ultra |
| 16 | 26 | RTX 3090, RTX 4070 Super, RTX 5070, RX 7800 XT, Apple M2 Ultra | High |
| 15 | 22 | RTX 3080, RTX 4070, RX 6800, Apple M4 Max | High |
| 14 | 18 | RTX 3070, RTX 4060 Ti, RTX 5060 Ti, Arc B580, Apple M3 Max | High |
| 13 | 14 | RTX 3060 Ti, RTX 4060, RX 7600, Arc A750, Apple M2 Max | High |
| 12 | 12 | RTX 3060, RTX 2070, GTX 1080 Ti, RX 6600 XT, Apple M1 Max | High |
| 11 | 9.5 | RTX 2060, GTX 1080, RX 5700, Apple M4 Pro | High |
| 10 | 7.7 | RTX 3050, GTX 1070, GTX 1660 Ti, Apple M2 Pro / M3 Pro | High |
| 9 | 6.3 | GTX 1660, GTX 1650 Super, RX 6500 XT, Apple M1 Pro, Apple M5 | Balanced |
| 8 | 5.1 | GTX 1060, RX 580, Intel Arc 140V, Radeon 890M, Apple M4, Adreno 840 | Balanced |
| 7 | 4.2 | GTX 1650, Intel Arc (Core Ultra), Radeon 880M, Apple M2 / M3, Adreno 830 | Balanced |
| 6 | 3.4 | Radeon 780M / 680M, Apple M1, Adreno 750, Immortalis-G720 | Balanced |
| 5 | 2.8 | GTX 1050 Ti, Radeon 760M, Adreno 740, Xclipse 940 | Balanced |
| 4 | 2.3 | GTX 1050, Intel Iris Xe, Snapdragon X (Adreno X1), Adreno 735 | Balanced |
| 3 | 1.8 | Steam Deck, Adreno 730 / 725 | Low |
| 2 | 1.5 | Radeon Vega 8 or a generic "Radeon Graphics", Iris Plus, GeForce MX250, Mali-G710, Xclipse 920 | Low |
| 1 | 1.2 | Adreno 660, Mali-G78, Radeon Vega 3–7 | Low |
| 0 | 1 | Galaxy S20 (Adreno 650, Mali-G77) or weaker, Intel UHD / HD Graphics | Low |

The levels are approximate, relative to each other; the table in the module lists more models. Then:

| Signal | Level |
|---|---|
| No WebGL, or a software renderer (SwiftShader, llvmpipe, Microsoft Basic Render) | 0 |
| No WebGL2, 2 or fewer CPU cores, or 2 GB of memory or less | 0 |
| A laptop part ("Laptop GPU", "Max-Q") | two below the desktop part |
| A GPU not in the table: on a phone or tablet | 0 |
| A GPU not in the table: discrete (NVIDIA, AMD Radeon RX/Pro, Apple M-series) | 10 |
| A GPU not in the table: anything else (integrated, unknown) | 4 |
| Phone or tablet (coarse pointer), or 4 GB of memory or less | at most 9 (Balanced) |

The GPU name comes from `RENDERER`, and the `WEBGL_debug_renderer_info` extension is requested only
when Chromium masks the name. Firefox logs a console warning when that extension is requested, and it
already reports a name, but only a GPU family ending in "or similar", so Firefox is rated as a GPU not
in the table. Safari, and every browser on iPhone and iPad, reports any Apple GPU as "Apple GPU": iPhones
and iPads therefore start at level 0 and Macs in Safari at level 4. Players can always pick a higher preset.

While the game runs, Auto also watches frame times. If adaptive resolution has already dropped to its
floor and frames still average over 26 ms for three more 90-frame windows, Auto steps down one preset
for the rest of the session. Choosing **Auto** in the panel again re-detects. A preset the player
picked by hand never changes on its own.

### Maximum frame rate

**Maximum frame rate** defaults to **Auto (refresh rate)**: the browser schedules rendering
with the display's refresh rate. On a phone or tablet the default is **Auto (half refresh rate)**
instead, which renders every second display refresh (30 FPS at 60 Hz, 60 FPS at 120 Hz) to limit heat
and battery drain. Browsers do not report the refresh rate, so the store measures it from the spacing
of animation callbacks; where they arrive below 50 Hz (for example, a browser throttling them in a
low-power mode), every callback renders.

Choose **Custom** and enter an integer from **1 to 1000 FPS** to override either default; on a phone,
enter the display's refresh rate for full-rate rendering. The limit applies immediately, is saved
locally and to the same cloud profile as the other graphics settings, and survives quality-preset
changes. Return to **Auto** to remove the limit. This choice is independent of the **Auto** quality preset.

The renderer must call `gfx.shouldRender(now)` in its animation loop, as shown below. A limit is a
ceiling, not a promised frame rate: rendering still cannot exceed the browser's animation callbacks
or the machine's performance. Setting 144 FPS on a 60 Hz display therefore still renders at most 60 FPS.

For a custom menu, use `gfx.set({ maxFps: 45 })` and `gfx.set({ maxFps: null })` to restore Auto.
Resolved `gfx.settings.maxFps` is `0` for Auto, and `gfx.settings.halfRefresh` is `true` when Auto is
pacing at half the refresh rate. Invalid saved values fall back to Auto; positive numbers are rounded
and clamped to 1–1000.

### Where the settings live

| Store | Key | Why |
|---|---|---|
| `localStorage` | `<storageKey>.gpu.<GPU profile>` | Read synchronously, so the first frame already uses this GPU's settings |
| [Per-player settings](../api/games.md#per-player-game-settings) | `graphics.gpu.<GPU profile>` | Follows the player to another machine reporting the same GPU |

Each GPU gets an independent profile, covering every graphics choice including the maximum FPS.
For example, set Ultra and 90 FPS on GPU A, then launch on GPU B: B starts with hardware-detected
defaults unless you previously saved choices for B. Returning to A restores Ultra and 90 FPS.
Two GPUs that both detect as High still have separate profiles. A change to the detected quality
tier on the same GPU does not discard its saved choices.

The profile is a stable 16-character hash of the browser-reported GPU name, normalized for case
and whitespace. `storageKey` and `cloudKey` supply prefixes; `gfx.storageKey`, `gfx.cloudSlot`, and
`gfx.gpuProfile` expose the active keys and profile. GPU detection happens when the store is created;
create a fresh store on the next game launch to select another GPU's profile.

If no GPU name is available, choices apply for the session without local or cloud persistence.
If the browser masks multiple GPUs with the same name, they share a profile because it cannot
distinguish them. Older unscoped local settings and device-class cloud settings are left untouched
and are not imported, since they do not identify which GPU the choices belong to.

Each value is `{ "saved": {…}, "at": <ms timestamp> }`. The two copies are reconciled the same way as
[cloud saves](../sdk/javascript.md#cloud-saves):

- **Read before writing.** At start-up (and when a different player signs in), the store reads
  `GET /api/v1/games/{slug}/settings`. The copy with the newer `at` wins. If the cloud copy wins, the
  store adopts it and fires a `change` with reason `'cloud'`. If the local copy is newer, the store
  pushes it.
- **A failed read blocks writes.** The local copy keeps working. The next change the player makes
  retries the read before anything is written, so a stale device cannot overwrite a newer choice it
  could not see.
- Changes are pushed with `setSetting` after 800 ms without further changes. Token renewals (which
  also fire the SDK's `auth` event) do not trigger another read.

## 3. Apply the settings to your renderer

Four hooks connect the store to a three.js renderer:

- `gfx.on('change', fn)` for shadows and effect toggles.
- A post-processing chain rebuilt from the current tiers.
- `gfx.frame(ms)` and `gfx.pixelRatio()` in the render loop, which drive adaptive resolution.
- `gfx.shouldRender(now)` before drawing, which enforces the manual FPS limit and half-refresh pacing.

Create the renderer with `antialias: false`. MSAA then comes from the post chain's render target, so
every anti-aliasing tier can be switched without recreating the WebGL context.

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// canvas, scene, camera and a shadow-casting DirectionalLight `sun` are your game's own.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
let composer = null;
let size = {};

gfx.on('change', (s) => {
  const mapSize = SHADOW_MAP[s.shadows];
  renderer.shadowMap.enabled = mapSize > 0;
  sun.castShadow = mapSize > 0;
  if (mapSize && sun.shadow.mapSize.x !== mapSize) {
    sun.shadow.mapSize.set(mapSize, mapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  scene.traverse((o) => [].concat(o.material || []).forEach((m) => { m.needsUpdate = true; })); // shadow on/off recompiles
  size = {}; // resize and rebuild the post chain on the next frame
});

function buildPost(s, w, h, ratio) {
  composer?.dispose();
  composer = null;
  if (gfx.info.postFailed || (s.ao === 'off' && s.bloom === 'off' && s.antialias === 'off')) return;
  try {
    const pw = Math.round(w * ratio), ph = Math.round(h * ratio);
    const target = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: s.antialias === 'msaa' ? 4 : 0 });
    const c = new EffectComposer(renderer, target);
    c.setPixelRatio(ratio);
    c.setSize(w, h);
    c.addPass(new RenderPass(scene, camera));
    if (s.ao !== 'off') {
      const ao = new GTAOPass(scene, camera, pw, ph);
      ao.updateGtaoMaterial({ samples: s.ao === 'high' ? 16 : 8 });
      c.addPass(ao);
    }
    if (s.bloom === 'on') c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, 0.9));
    c.addPass(new OutputPass());
    if (s.antialias === 'smaa') c.addPass(new SMAAPass());
    if (s.antialias === 'fxaa') {
      const fxaa = new ShaderPass(FXAAShader);
      fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
      c.addPass(fxaa);
    }
    composer = c;
  } catch {
    gfx.report({ postFailed: true }); // the panel shows a note; don't console.warn
  }
}

let last = performance.now();
renderer.setAnimationLoop((now) => {
  // Update your simulation here using its own elapsed time or fixed timestep.
  // Keep simulation/input independent of skipped render ticks.
  if (!gfx.shouldRender(now)) return;
  gfx.frame(now - last); // elapsed time between rendered frames, including the FPS limit
  last = now;
  const w = canvas.clientWidth, h = canvas.clientHeight, ratio = gfx.pixelRatio();
  if (w !== size.w || h !== size.h || ratio !== size.ratio) {
    size = { w, h, ratio };
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    buildPost(gfx.settings, w, h, ratio);
    gfx.report({ pixels: [Math.round(w * ratio), Math.round(h * ratio)] });
  }
  try {
    if (composer) composer.render();
    else renderer.render(scene, camera);
  } catch {
    composer = null;
    gfx.report({ postFailed: true });
  }
});
```

Notes:

- The `three/addons/` files must come from the **same three.js release** as `three` itself. Mixing
  releases breaks the post chain. The code above targets current releases. On older ones, `SMAAPass`
  takes `(width, height)`.
- Low turns every post-processing effect off, so the game renders straight to the canvas at a
  device pixel ratio of at most 1. That keeps Low as cheap as the game was before any of this.
- `gfx.pixelRatio()` returns `min(devicePixelRatio, preset cap) × preset scale × render scale ×
  adaptive scale`, clamped to 0.25–3. The caps are 1 for Low, 1.5 for Balanced and 2 for High and
  Ultra.
- Adaptive resolution averages 90 frames. Above 26 ms it lowers the scale by 0.1 (down to 0.6). Below
  14 ms it raises the scale by 0.05 (up to 1). Frames longer than 1 s (paused or background tabs) are
  ignored, and a single slow frame counts as at most 250 ms for adaptation so one hitch cannot lower
  the scale. The FPS readout uses the actual elapsed times.
  With a manual limit or half-refresh pacing, the slow threshold is at least 115% of the target frame
  interval and the fast threshold is at least 85%, so a deliberate 30 FPS limit does not lower quality on its own.
  For very low limits, both the pause cutoff and hitch cutoff are at least two target intervals.
  Feed `gfx.frame` only rendered frames; retain the last rendered timestamp when a tick is skipped.

### Other engines

Whatever draws your frames, the integration uses the same hooks:

| Call | Use |
|---|---|
| `gfx.on('change', (settings, reason) => …)` | Apply tiers. Runs once immediately (`'init'`), then on `'settings'`, `'cloud'` and `'auto'`. Returns an unsubscribe function. |
| `gfx.settings` | `{ preset, auto, scale, dprCap, adaptive, showFps, maxFps, halfRefresh, <category>: <tier> }`; `maxFps: 0` means automatic display refresh, halved when `halfRefresh` is `true`. |
| `gfx.level` | The detected hardware level, 0–20, for scaling your own budgets (particle counts, draw distance). It does not change when Auto steps down. |
| `gfx.shouldRender(now)` | Every animation callback, with its timestamp in milliseconds. Skip drawing if it returns `false`. Keep simulation/input updates independent. |
| `gfx.frame(ms)` | Every rendered frame, with time since the previous rendered frame. Returns `true` when the pixel ratio or the Auto preset changed. |
| `gfx.pixelRatio()` | The ratio to render at |
| `gfx.report({ pixels, postFailed })` | Tells the panel the output size, or that effects are unavailable |

For a 2D canvas game, multiply the canvas backing size by `gfx.pixelRatio()`, and map your own
effects (particles, glow, parallax layers) to categories as described below.

## 4. Fit it to your game

**Your own effects.** Pass a quality table that lists only what your game actually draws. Each preset
row needs a tier for every category, plus `scale` and `dprCap`:

```js
import { createGraphics, CATEGORIES, TABLE } from './graphics-options.js';

const gfx = createGraphics({
  storageKey: 'mygame.graphics',
  categories: { ...CATEGORIES, particles: ['off', 'low', 'high'] },
  table: {
    low: { ...TABLE.low, particles: 'off' },
    balanced: { ...TABLE.balanced, particles: 'low' },
    high: { ...TABLE.high, particles: 'high' },
    ultra: { ...TABLE.ultra, particles: 'high' },
  },
});
```

The panel builds one select per category, so a new category appears automatically. Name it with
`strings.categories.particles`.

**Your own presets.** A table whose presets have other names also needs `levels`: each preset's lowest
hardware level. Auto picks the preset with the highest starting level at or below `gfx.level`:

```js
const gfx = createGraphics({
  table: { fast: { ...TABLE.low }, standard: { ...TABLE.balanced }, cinematic: { ...TABLE.ultra } },
  levels: { fast: 0, standard: 6, cinematic: 15 },
});
```

**Translations.** The panel's English strings are exported as `STRINGS`. Pass your own with the same
shape. Only the keys you give are replaced:

```js
mountGraphicsPanel(el, gfx, {
  strings: {
    quality: 'Qualität', auto: 'Automatisch ({tier})', fromPreset: 'Laut Voreinstellung ({tier})',
    renderScale: 'Renderskalierung', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    maxFps: 'Maximale Bildrate', autoFps: 'Automatisch (Bildschirmfrequenz)',
    autoHalfFps: 'Automatisch (halbe Bildschirmfrequenz)', level: 'Stufe {level}',
    customFps: 'Benutzerdefiniert', fpsLimit: 'Maximale FPS (1–1000)',
    categories: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', particles: 'Partikel' },
    tiers: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', off: 'Aus', on: 'An' },
  },
});
```

**Styling.** The panel uses the classes `.gfx-panel`, `.gfx-row`, `.gfx-summary` and `.gfx-note`. Its
built-in rules are wrapped in `:where()`, so any rule in your own stylesheet overrides them. Rows are
at least 44 px tall for touch. The frame-rate readout (`#gfx-fps`) sits in the bottom-left corner,
inside the safe area, and does not capture clicks.

**Reading the result elsewhere.** `<html>` carries `data-gfx-preset` (the active preset) and
`data-gfx-auto` (`1` or `0`), which CSS and tests can key off.

## 5. Test it

- Headless browsers render with a software GPU, so Auto resolves to level 0 (**Low**) and tests stay fast.
- Drive the real panel. Every control has a `data-gfx` attribute (`preset`, `renderScale`,
  `adaptive`, `frameRate`, `maxFps`, `showFps`, or the category name):

```js
const preset = () => page.evaluate(() => document.documentElement.dataset.gfxPreset);
await page.locator('select[data-gfx=preset]').selectOption('high');
assert.equal(await preset(), 'high');
await page.reload();
assert.equal(await preset(), 'high'); // persisted
await page.locator('select[data-gfx=frameRate]').selectOption('custom');
await page.locator('input[data-gfx=maxFps]').fill('45');
await page.locator('input[data-gfx=maxFps]').press('Tab');
await page.reload();
assert.equal(await page.locator('input[data-gfx=maxFps]').inputValue(), '45');
await page.locator('select[data-gfx=frameRate]').selectOption('auto');
```

- The pure functions `detectLevel(system)`, `presetForLevel(level, levels)`, `detectPreset(system)`,
  `resolve(saved, detected, { mobile })` and `withPreset(saved, preset)` run under Node for unit tests.
  `createGraphics({ sdk, storage, system })` also accepts fakes for all three; pass a `system` with a
  phone's `gpu` and `mobile: true` to test the mobile defaults.
- `node --test tests/graphics-options.test.mjs` verifies hardware levels, validation, per-GPU persistence
  and restoration, frame pacing on different display refresh rates (including half-refresh pacing on
  phones), live switching, and adaptive quality with an FPS limit.
