# Tutorial: graphics options with auto-detected quality

Give your browser game a **Graphics** menu that picks a sensible quality level for the player's machine
on first launch, lets them override it, and remembers their choice across devices through StarHermit.

[`graphics-options.js`](../sdk/graphics-options.js) is a single ES module, with no dependencies, that
handles the bookkeeping:

- **Auto** picks one of four presets (Low, Balanced, High, Ultra) from the GPU, memory, CPU cores and
  device type, and steps down for the session if frames stay slow.
- Players can override each effect (shadows, ambient occlusion, bloom, anti-aliasing, or your own),
  set a 50–200% render scale, and toggle adaptive resolution and a frame-rate readout.
- Settings are saved to `localStorage` so they apply before the first frame, and to the player's
  [per-game settings](../api/games.md#per-player-game-settings) so they follow the player to their
  other machines.
- It includes a ready-made options panel built from the same quality table.

It imports no engine. Your renderer listens for changes and applies the tiers. This page wires it to
three.js. Other engines use the same five calls (see [Other engines](#other-engines)).

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

On creation the store probes a throwaway WebGL context once (`gfx.system`) and maps it to a preset
(`gfx.detected`):

| Signal | Preset |
|---|---|
| No WebGL, or a software renderer (SwiftShader, llvmpipe, Microsoft Basic Render) | Low |
| No WebGL2, 2 or fewer CPU cores, or 2 GB of memory or less | Low |
| Discrete GPU (NVIDIA, AMD Radeon RX/Pro, Apple M-series) | High |
| Anything else (integrated Intel/AMD, mobile GPUs, Safari's masked "Apple GPU") | Balanced |
| Phone or tablet (coarse pointer), or 4 GB of memory or less | at most Balanced |

Auto never selects Ultra; players opt into it. The GPU name comes from `RENDERER`, and the
`WEBGL_debug_renderer_info` extension is requested only when Chromium masks the name. Firefox logs a
console warning when that extension is requested, and it already reports the real name.

While the game runs, Auto also watches frame times. If adaptive resolution has already dropped to its
floor and frames still average over 26 ms for three more 90-frame windows, Auto steps down one preset
for the rest of the session. Choosing **Auto** in the panel again re-detects. A preset the player
picked by hand never changes on its own.

### Where the settings live

| Store | Key | Why |
|---|---|---|
| `localStorage` | your `storageKey` | Read synchronously, so the first frame already uses the player's settings |
| [Per-player settings](../api/games.md#per-player-game-settings) | `graphics.desktop.<detected preset>` or `graphics.mobile.<detected preset>` | Follows the player to another machine of the same kind |

The cloud key includes the device type and the detected preset, so choosing Ultra on a desktop with
a discrete GPU never pushes Ultra onto the same player's phone or an integrated-GPU laptop. Each value
is `{ "saved": {…}, "at": <ms timestamp> }`. The two copies are reconciled the same way as
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

Three hooks connect the store to a three.js renderer:

- `gfx.on('change', fn)` for shadows and effect toggles.
- A post-processing chain rebuilt from the current tiers.
- `gfx.frame(ms)` and `gfx.pixelRatio()` in the render loop, which drive adaptive resolution.

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
  gfx.frame(now - last); // adaptive resolution + Auto step-down
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
  ignored, and a single slow frame counts as at most 250 ms so one hitch cannot lower the scale.

### Other engines

Whatever draws your frames, the integration is the same five calls:

| Call | Use |
|---|---|
| `gfx.on('change', (settings, reason) => …)` | Apply tiers. Runs once immediately (`'init'`), then on `'settings'`, `'cloud'` and `'auto'`. Returns an unsubscribe function. |
| `gfx.settings` | `{ preset, auto, scale, dprCap, adaptive, showFps, <category>: <tier> }` |
| `gfx.frame(ms)` | Every frame. Returns `true` when the pixel ratio or the Auto preset changed. |
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

**Translations.** The panel's English strings are exported as `STRINGS`. Pass your own with the same
shape. Only the keys you give are replaced:

```js
mountGraphicsPanel(el, gfx, {
  strings: {
    quality: 'Qualität', auto: 'Automatisch ({tier})', fromPreset: 'Laut Voreinstellung ({tier})',
    renderScale: 'Renderskalierung', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
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

- Headless browsers render with a software GPU, so Auto resolves to **Low** and tests stay fast.
- Drive the real panel. Every control has a `data-gfx` attribute (`preset`, `renderScale`,
  `adaptive`, `showFps`, or the category name):

```js
const preset = () => page.evaluate(() => document.documentElement.dataset.gfxPreset);
await page.locator('select[data-gfx=preset]').selectOption('high');
assert.equal(await preset(), 'high');
await page.reload();
assert.equal(await preset(), 'high'); // persisted
```

- The pure functions `detectPreset(system)`, `resolve(saved, detected)` and `withPreset(saved, preset)`
  run under Node for unit tests. `createGraphics({ sdk, storage, system })` also accepts fakes for all
  three.
