# StarHermit engine releases

The StarHermit engine — the runtime that plays [script games](tutorials/starhermit-engine.md) — is
published on this wiki as versioned, immutable releases under
[wiki.starhermit.com/engine/](../engine/). Games pin one release exactly with `engine.version` in
their [`starhermit.txt`](starhermit-txt.md); a game's page loads the release's web runtime from
from the engine origin in the browser, the StarHermit Windows client installs the release's native
runtime and plays the game on it, and developers download a release's runtime from here to build with.

## Load the engine from engine.starhermit.com

**A game's page should load its engine from `https://engine.starhermit.com/engine/X.Y.Z/`, not from
this wiki.** The wiki holds only recent releases: it is capped at 1 GB, so the oldest versions are
removed as new ones are published, and a page that loads its engine from the wiki stops working
when its version goes. `engine.starhermit.com` serves every release the wiki lists, within about ten
minutes of publication, and keeps every release removed for space. The files there are byte for byte
the ones the wiki published, so the same SRI hashes pin them.

- **The release list stays here.** `versions.json` is read only from
  `https://wiki.starhermit.com/engine/versions.json`. It decides which releases exist and which are
  revoked, and `engine.starhermit.com` deliberately does not serve it.
- **A loader page you write yourself** imports `https://engine.starhermit.com/engine/X.Y.Z/starhermit.js`
  and names `https://engine.starhermit.com/engine/X.Y.Z/manifest.json` in `#starhermit-config`, with the
  same `integrity` values as the wiki URLs.
- **Packaged games:** from developer tools 1.26.0, `starhermit package --web` writes this loader on
  `https://engine.starhermit.com/engine/X.Y.Z/` by default. It still reads `versions.json` and the
  manifest from the wiki. If the archive does not serve the release's manifest yet (shortly after
  publication), it writes wiki URLs and warns you to package again. `--loader-base URL` (or
  `STARHERMIT_WEB_LOADER_BASE`) overrides the default, for example to keep wiki URLs. Packages from
  older tools carry wiki URLs, and the platform rewrites a hosted game's two engine URLs to
  `engine.starhermit.com` when the wiki has removed its version. Games hosted elsewhere get no
  rewrite, so repackage them with tools 1.26.0 or later.
- **Revoked releases are not kept.** A release withdrawn as unsafe is served from neither origin.
  Pin a newer one.

## Developer tools

The [standalone developer tools](../engine/tools/README.md) provide automated
publishing and script-game development MCP on macOS (Apple Silicon and Intel),
Linux and Windows. No Rust installation or private repository access is needed.
Tool releases are independent of the game runtime a game pins.

## Versions

A release is `X.Y.Z`. `X` is the **host API's major version**, the `engine.api` a game declares, so
every 1.x.x release runs `engine.api=1` games; the release also records the host API's minor version,
which grows as members are added (a game can require one with `engine.minor`). A published release
never changes: a fix is the next version.

| Release | Host API | Runtimes | Developer download |
|---|---|---|---|
| 1.26.2 | 1.28 | Web; Windows (x86-64); Linux (x86-64); macOS (x86-64, arm64) | [starhermit-1.26.2-windows-x86_64.zip](../engine/1.26.2/native/windows-x86_64/starhermit-1.26.2-windows-x86_64.zip), [starhermit-1.26.2-linux-x86_64.tar.gz](../engine/1.26.2/native/linux-x86_64/starhermit-1.26.2-linux-x86_64.tar.gz), [starhermit-1.26.2-macos-x86_64.tar.gz](../engine/1.26.2/native/macos-x86_64/starhermit-1.26.2-macos-x86_64.tar.gz), [starhermit-1.26.2-macos-aarch64.tar.gz](../engine/1.26.2/native/macos-aarch64/starhermit-1.26.2-macos-aarch64.tar.gz) |
| 1.26.1 | 1.28 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.26.1-windows-x86_64.zip](../engine/1.26.1/native/windows-x86_64/starhermit-1.26.1-windows-x86_64.zip), [starhermit-1.26.1-linux-x86_64.tar.gz](../engine/1.26.1/native/linux-x86_64/starhermit-1.26.1-linux-x86_64.tar.gz) |
| 1.26.0 | 1.28 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.26.0-windows-x86_64.zip](../engine/1.26.0/native/windows-x86_64/starhermit-1.26.0-windows-x86_64.zip), [starhermit-1.26.0-linux-x86_64.tar.gz](../engine/1.26.0/native/linux-x86_64/starhermit-1.26.0-linux-x86_64.tar.gz) |
| 1.25.0 | 1.27 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.25.0-windows-x86_64.zip](../engine/1.25.0/native/windows-x86_64/starhermit-1.25.0-windows-x86_64.zip), [starhermit-1.25.0-linux-x86_64.tar.gz](../engine/1.25.0/native/linux-x86_64/starhermit-1.25.0-linux-x86_64.tar.gz) |
| 1.24.0 | 1.26 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.24.0-windows-x86_64.zip](../engine/1.24.0/native/windows-x86_64/starhermit-1.24.0-windows-x86_64.zip), [starhermit-1.24.0-linux-x86_64.tar.gz](../engine/1.24.0/native/linux-x86_64/starhermit-1.24.0-linux-x86_64.tar.gz) |
| 1.23.0 | 1.25 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.23.0-windows-x86_64.zip](../engine/1.23.0/native/windows-x86_64/starhermit-1.23.0-windows-x86_64.zip), [starhermit-1.23.0-linux-x86_64.tar.gz](../engine/1.23.0/native/linux-x86_64/starhermit-1.23.0-linux-x86_64.tar.gz) |
| 1.22.0 | 1.24 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.22.0-windows-x86_64.zip](../engine/1.22.0/native/windows-x86_64/starhermit-1.22.0-windows-x86_64.zip), [starhermit-1.22.0-linux-x86_64.tar.gz](../engine/1.22.0/native/linux-x86_64/starhermit-1.22.0-linux-x86_64.tar.gz) |
| 1.21.0 | 1.23 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.21.0-windows-x86_64.zip](../engine/1.21.0/native/windows-x86_64/starhermit-1.21.0-windows-x86_64.zip), [starhermit-1.21.0-linux-x86_64.tar.gz](../engine/1.21.0/native/linux-x86_64/starhermit-1.21.0-linux-x86_64.tar.gz) |
| 1.20.2 | 1.22 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.20.2-windows-x86_64.zip](../engine/1.20.2/native/windows-x86_64/starhermit-1.20.2-windows-x86_64.zip), [starhermit-1.20.2-linux-x86_64.tar.gz](../engine/1.20.2/native/linux-x86_64/starhermit-1.20.2-linux-x86_64.tar.gz) |
| 1.20.1 | 1.22 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.20.1-windows-x86_64.zip](../engine/1.20.1/native/windows-x86_64/starhermit-1.20.1-windows-x86_64.zip), [starhermit-1.20.1-linux-x86_64.tar.gz](../engine/1.20.1/native/linux-x86_64/starhermit-1.20.1-linux-x86_64.tar.gz) |
| 1.20.0 | 1.22 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-29 (wiki size limit) |
| 1.19.3 | 1.21 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-29 (wiki size limit) |
| 1.19.2 | 1.21 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-29 (wiki size limit) |
| 1.19.1 | 1.21 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-29 (wiki size limit) |
| 1.19.0 | 1.21 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-29 (wiki size limit) |
| 1.18.0 | 1.20 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-29 (wiki size limit) |
| 1.17.1 | 1.19 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-29 (wiki size limit) |
| 1.17.0 | 1.19 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.16.5 | 1.18 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.16.4 | 1.18 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.16.3 | 1.18 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.16.2 | 1.18 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.16.1 | 1.18 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.16.0 | 1.18 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.15.2 | 1.17 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-28 (wiki size limit) |
| 1.15.1 | 1.17 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.15.0 | 1.17 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.14.0 | 1.16 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.13.2 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.13.1 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.13.0 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.12.0 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.11.0 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.10.0 | 1.14 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.9.1 | 1.13 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.9.0 | 1.13 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.8.1 | 1.12 | Web; Windows (x86-64); Linux (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.8.0 | 1.12 | Web; Windows (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.7.0 | 1.11 | Web; Windows (x86-64) | Removed 2026-10-27 (wiki size limit) |
| 1.6.0 | 1.10 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.5.1 | 1.9 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.5.0 | 1.9 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.4.1 | 1.8 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.4.0 | 1.8 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.3.0 | 1.7 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.2.0 | 1.6 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.1.0 | 1.4 | Web; Windows (x86-64) | Removed 2026-10-26 (wiki size limit) |
| 1.0.0 | 1.4 | Windows (x86-64); no web runtime | Removed 2026-10-26 (wiki size limit) |

[versions.json](../engine/versions.json) is the authoritative list, newest first, and the engine
area's own page lists the same.

The documentation always describes the newest release. Pages here may be cached for up to ten
minutes after a release is published; [versions.json](../engine/versions.json) says which release is
newest.

## Release notes

### 1.26.2

Host API 1.28, as 1.26.0: re-pin to 1.26.2 (`engine.version=1.26.2`); nothing changes for games.

- **macOS runtimes**: the first release with native runtimes for macOS, on Intel (`macos-x86_64`) and Apple Silicon
  (`macos-aarch64`), for the StarHermit macOS client; they need macOS 11 or later. Developer downloads:
  [starhermit-1.26.2-macos-x86_64.tar.gz](../engine/1.26.2/native/macos-x86_64/starhermit-1.26.2-macos-x86_64.tar.gz)
  (SHA-256 `460a39263a749407400cff4b1ecc093034f68fc138b2a8b881ad7bf0b8314c27`) and
  [starhermit-1.26.2-macos-aarch64.tar.gz](../engine/1.26.2/native/macos-aarch64/starhermit-1.26.2-macos-aarch64.tar.gz)
  (SHA-256 `6888857b3ef1608968484ad68f0b256da22273b9cc1b0f7a77233af9bd5cfb0c`).
- They are signed ad hoc and **not notarized**. That is fine when the client installs them, but a tarball downloaded
  in a browser carries Gatekeeper's quarantine and is blocked until it is cleared
  (`xattr -dr com.apple.quarantine starhermit-1.26.2-macos-*`).
- They have **not yet been tested on real Apple hardware or with a GPU**: the build host is an Intel virtual machine
  without Metal, so the x86_64 runtime was run headless and the arm64 runtime was only checked statically.

### 1.26.1

Host API 1.28, as 1.26.0: re-pin to 1.26.1 (`engine.version=1.26.1`); nothing changes for games.

- **WebAssembly ahead-of-time compilation**: natively, a WebAssembly module a game instantiates can run code the
  platform compiled and signed for it, fetched in the background and cached; until it arrives, and for anything not
  verified, the module is interpreted as before, with the same results, traps and fuel. `versions.json` gains an
  `aot` revocation list. `STARHERMIT_WASM_AOT=0` turns it off; browsers and checks never use it.
- **Fix**: a WebAssembly trap no longer leaves the call depth off, which could reach the call limit early in a game
  catching many traps.

### 1.26.0

Host API 1.28: pin `engine.version=1.26.0` and add `engine.minor=28` for the changes marked (1.28); everything else
applies to every game. Games declaring 1.27 or older behave as before.

- **Color maps' `colorSpace`** (1.28): `map`, `emissiveMap`, a texture `scene.background` and a texture
  environment follow the texture's `colorSpace` as three.js r185 does: `SRGBColorSpace` is decoded, while
  `LinearSRGBColorSpace` and `NoColorSpace` (the default) are used as stored. Older minors keep every color map sRGB.
- **CSS styles** (1.28): `ui.stylesFromCss` and `starhermit css` convert custom properties and `var()`, percentage
  sizes, `max-width`/`max-height`, `font-variant: small-caps` and `flex-wrap`.
- **Native display**: native games start in borderless fullscreen unless the player chose otherwise.
- **Web**: sign-in works inside the StarHermit client's frame; the loader page no longer flickers with scrollbars
  when its viewport changes; a stored fullscreen mode waits for the player's first press.
- **Tools**: `package --web` loaders take the engine from the engine archive, which keeps every release.
- **Fix**: synthesized small capitals keep their word spaces.

### 1.25.0

Host API 1.27: pin `engine.version=1.25.0` and add `engine.minor=27` for the changes marked (1.27); everything else
applies to every game. Games declaring 1.26 or older behave as before.

- **Worker lifetime** (1.27): a `starhermit:script` worker the game no longer references lives on while it has a
  listener or a message still to run, as a browser's Web Worker does, until `terminate()`, it stops, or the game
  ends. Older minors keep terminating a collected worker and log a one-time warning when it had listeners.
- **Graphics quality**: the web's Auto now picks the level native's does on the same GPU (a steadier benchmark,
  and slow presented frames count as missed deadlines in browsers).
- **Speed**: per-pass culling reaches WebGL 2 and WebGPU, so a batch is left out of the passes it is culled from.

### 1.24.0

Host API 1.26: pin `engine.version=1.24.0` and add `engine.minor=26` for the changes marked (1.26); everything else
applies to every game. Games declaring 1.25 or older behave as before.

- **Worker package files** (1.26): `starhermit:script` workers read the game's package files through a `files`
  global with `starhermit:engine`'s reads, natively and in browsers.
- **Levels of detail and shadow cascades** (1.26): three.js r185's `LOD`; engine extensions
  `InstancedMesh.setLevels(...)` (per-instance levels, natively) and `directionalLight.shadow.cascades` (1–4
  maps split over the view as CSM does).
- **Output color space** (1.26): `renderer.outputColorSpace` and `ColorManagement` as three.js r185 has them;
  `LinearSRGBColorSpace` writes linear light on every backend.
- **UI layout** (1.26): wrapping rows with `gap`, percentage sizes, `maxWidth`/`maxHeight`, custom properties with
  `var()`, small-caps text and `ui.lastRect()`.
- **Material hooks** (1.26): `pass_kind()` and `is_shadow_pass()` tell a hook which pass it runs in.
- **Speed**: shadow maps and prepasses draw only what reaches them; skinned meshes' first culling spheres are made
  natively; faster array literals, destructuring and Map/Set lookups in script; WebGL 2 frames no longer wait on
  `getError`, and native Wayland draws ahead of the frame callback.
- **Fixes**: `o[4294967295]` reads as an ordinary key; Map and Set methods reject the other's receiver;
  `package --web` always packages `starhermit-remote.json`.
- **Development**: `--local-container URL` runs a container game's sessions on the developer's own server with
  the local platform host.

### 1.23.0

Host API 1.25: pin `engine.version=1.23.0` and add `engine.minor=25` for the changes marked (1.25); everything else
applies to every game. Games declaring 1.24 or older behave as before.

- **Skeletal animation** (1.25): `Bone`, `Skeleton` and `SkinnedMesh` as three.js r185 has them, skinned in every
  material's vertex stage on every backend (hooks, shadows and prepasses included); GLTFLoader loads skins and
  animation clips.
- **WebAssembly** (1.25): the `WebAssembly` global natively and in `starhermit:script` workers, in the engine's own
  sandboxed interpreter (WebAssembly 2.0 core and fixed-width SIMD, no JIT); memory limited by
  `engine.limits.wasm_mib` (default 256 MiB). Integer results match browsers bit for bit.
- **Float data textures** (1.25): `FloatType` and `HalfFloatType` DataTextures reach ShaderMaterial and hook WGSL
  unclamped, stored as half floats.
- **Binary worker messages** (1.25): worker messages may hold ArrayBuffers, typed arrays and DataViews, copied or
  moved with a transfer list.
- **Rooms** (1.25): `rooms.joined()` lists the rooms the player holds a seat in; `rooms.browse()` summaries carry
  `metadata`; a game server still waking reaches scripts as `unavailable` with `code` `"server_starting"` and
  `retryAfter`.
- **Fixes and speed**: `TextEncoder.prototype.encodeInto` natively; many `TextureLoader` loads at once no longer
  exceed the decoded-asset budget; checks keep workers in step with the simulated clock; native Wayland skips frames
  the compositor would not show; textures changing every frame update in place on Vulkan and OpenGL ES.
- **Development**: a loopback web page takes `?quality=LEVEL`.

### 1.22.0

Host API 1.24: pin `engine.version=1.22.0` and add `engine.minor=24` for the changes marked (1.24); everything else
applies to every game. Games declaring 1.23 or older behave as before.

- **External links** (1.24): a manifest declares up to 16 `engine.link.<id>=<https URL>` lines, and `openLink(id)`
  from `starhermit:engine` opens one while handling the player's press, after the runtime's own confirmation, only
  once a StarHermit administrator has approved that exact URL. Unreviewed links open, with a warning, only in
  development runs.
- **Material parameters** (1.24): copied as three.js r185's `setValues` copies them, so one Color passed to two
  materials (or two fields) is no longer shared. Older games keep sharing it and are warned once in the console.
- **Clearer 3D errors**: a refused 3D batch, pass data or instance names the field and value, and a non-finite
  material value or uniform is named by material and property. An emissive colour times its intensity past the
  half-float range is drawn at its largest instead of refusing the pass.
- **Faster scripts**: IsoCity's tick and IsoCoaster's guest update 1.6×, chess searches 1.07–1.17× faster; fused
  instructions charge a little less fuel. No behaviour changes.
- **Accessibility**: in browsers a screen reader's activation of a widget works after a finger tap.

### 1.21.0

Host API 1.23: pin `engine.version=1.21.0` and add `engine.minor=23` for the changes marked (1.23); everything else
applies to every game. Games declaring 1.22 or older render exactly as before.

- **Light units** (1.23): every light and material lights as three.js r155+ does (physically correct lights), so a
  three.js port no longer divides intensities by π; ambient and hemisphere light no longer light metals; glTF
  `KHR_lights_punctual` intensities are taken as the file gives them.
- **Shadows** (1.23): three.js r185's shadows: each light's own `shadow.camera`, `normalBias` in world units, three's
  defaults (512 maps, bias 0), its PCF filter, `shadow.intensity`, `material.shadowSide`, and the game's `mapSize`
  whatever the graphics level. Point-light shadows, VSM and shadow-map caching are not yet matched.
- **Text fields** (1.23): a styled text field takes its style's sizes (padding, border, text size, min and fixed
  width and height), as a CSS input does.
- **Environments**: `PMREMGenerator.fromScene` takes any scene (a sky dome and sun sprite, say), drawn as three does;
  unlit materials exactly, lit ones approximately.
- **UI**: `ui.pointerCaptured()` says whether this frame's press or tap went to the UI (a finger's touch reach
  included).
- **Emoji**: ⚖️ and ✖️ draw in colour with U+FE0F (833 glyphs).

### 1.20.2

Host API 1.22, as 1.20.1: re-pin to 1.20.2 (`engine.version=1.20.2`). Everything here applies to every game.

- **Scene**: `material.depthFunc` with three's constants (`NeverDepth` … `NotEqualDepth`), honoured at every minor; unset,
  it follows the minor's default (LessEqual from 1.20, Less before). Set `LessDepth` to keep first-drawn-wins for
  coplanar faces in one mesh under 1.20+.
- **UI**: `ui.select` options take an HTML option's `label`.
- **Emoji**: 🪴 and ◻ (831 glyphs).

### 1.20.1

Host API 1.22, as 1.20.0: re-pin to 1.20.1 (`engine.version=1.20.1`). Everything here applies to every game.

- **Canvas emoji**: `fonts.load(font, text)`, `fonts.check`, `fonts.status`, and a `fonts.ready` that waits for the
  emoji font, as on the web's `document.fonts`. A canvas that bakes emoji once awaits `fonts.load` first (before it,
  emoji drawn before the lazily loaded font arrived stayed blank). Colour glyphs too large to rasterize draw scaled.
- **Fix (scene)**: lines crossing the camera's near plane draw as lines on every backend (software rasterizers drew
  them as large filled shapes); a line mesh's budget charge is unchanged.
- **UI**: a text weight may be a number from 1 to 1000, as in CSS.
- **Emoji**: 〰 U+3030 (829 glyphs).
- **Docs**: the canvas work budget and what each drawing operation costs.

### 1.20.0

Host API 1.22: pin `engine.version=1.20.0` and add `engine.minor=22` for the changes marked (1.22); everything else
applies to every game. Games declaring 1.21 or older behave exactly as before.

- **Slider fill** (1.22): a slider style's `fill` part covers the track from its minimum to the value (from the right
  in right-to-left layouts); CSS `accent-color` and `::-moz-range-progress` reach it.
- **glTF lights** (1.22): `GLTFLoader` builds `KHR_lights_punctual` point, spot and directional lights as three r185
  does, with intensities in the engine's light units (spec, "light units"). A file that requires the extension now
  loads for every game (without lights below 1.22) instead of failing.
- **Rooms**: `RoomSocket.sendReady(false)` withdraws ready.
- **Accessibility**: `ui.announce` never throws for many announcements in one frame; it keeps the newest four and
  warns once.
- **Fix (audio)**: in browsers, `context.currentTime` could stay at 0 for good when the audio worklet's first report
  came before it had rendered, so a game waiting for the clock never played sound.
- **Docs**: porting rules for three.js room environments by release (spec, "environment ports").

### 1.19.3

Host API 1.21, as 1.19.2, fixes only: re-pin to 1.19.3 (`engine.version=1.19.3`).

- **Fix (scene)**: `Raycaster.intersectObject(s)` tests meshes in double precision, as three.js does in JavaScript,
  so rays from far away no longer miss small objects and rays near a `CircleGeometry`'s centre no longer slip between
  its triangles.
- **Docs**: light units. At every minor, punctual lights use three's legacy (pre-r155) scaling: from three r155+,
  divide ambient, hemisphere, directional, point and spot light intensities by π (spec, "light units").

### 1.19.2

Host API 1.21, as 1.19.1, fixes only: re-pin to 1.19.2 (`engine.version=1.19.2`).

- **Fix (text)**: synthesized bold (serif and monospace in browsers, and any family without a bold face) emboldens
  each glyph's outline evenly, as Chrome does, instead of drawing the text again shifted right, so bold text no longer
  smears into its neighbours. Advances and `measureText` are unchanged; native and browsers draw it identically.
- **Emoji**: 🏊 🛹 🐄 (828 glyphs).
- **Docs**: play scripts' `tap` is a mouse click; phone-layout tests use `touch` for a finger.

### 1.19.1

Host API 1.21, as 1.19.0, fixes only: re-pin to 1.19.1 (`engine.version=1.19.1`).

- **Fix (UI)**: the runtime's dialogs dim the whole window again, square corners included (a styled dialog backdrop
  took the theme's corner radius, so the game showed undimmed in the corners); games' styled dialog backdrops are
  square by default too. Native render checks' screen probes pass at every `# viewport` scale.
- **Fix (input)**: `input.touchControlsVisible()` and `primaryPointer()` are right from the game's module scope on a
  touch-first device, not only from the first frame.
- **Checks**: play-script `key` and `hold` steps hide the touch controls as a player's keys do; the one-file-dialog-a-
  second limit follows a check's clock.

### 1.19.0

Host API 1.21: pin `engine.version=1.19.0` and add `engine.minor=21` for the changes marked (1.21); everything else
applies to every game. Games declaring 1.20 behave exactly as on 1.18.0.

- **Images**: a canvas drawn to the overlay frees its image with the canvas (short-lived canvases ran out of the
  120-image budget), and a full budget recycles images not drawn this frame. `engine.limits.images` raises the count
  up to 1,024 (1.21). Hitting the limit is a catchable error that names it.
- **Overlay**: up to 65,536 items and 524,288 vertices a frame; the docs give batching guidance.
- **Timers** (1.21): a `setInterval` faster than the frame rate runs as often as in a browser.
- **`crypto`**: `crypto.randomUUID()` and `crypto.getRandomValues()` natively and in workers; browsers keep their own.
- **Emoji**: 114 more StarHermit Emoji glyphs (825): transport, buildings and office objects.
- **Play scripts**: `drag`, `swipe` and `pinch` steps.
- **Fixes**: a radial gradient fills a fully rounded box again; a camera other than the window's projects from its
  own aspect in `project()`, `unproject()` and `Raycaster.setFromCamera` on every minor.

### 1.18.0

Host API 1.20: pin `engine.version=1.18.0` and add `engine.minor=20` for three.js parity and the other changes marked
(1.20) below; everything else applies to every game.

- **three.js r185 parity** (1.20): `starhermit:scene` follows three.js's defaults and conventions. Transparent
  materials write depth by default; `material.transparent` alone decides the transparent list, sorted as three
  sorts it; the depth test is `LessEqual`; cameras project from their own `aspect` and `left`/`right`/`top`/`bottom`;
  a Color background is never tone mapped; attenuated points scale by the canvas height. Games declaring 1.19 or
  older draw exactly as before.
  **Migrating to 1.20:** as in three.js, nothing sets a camera's shape for you. Set `camera.aspect` (or an
  orthographic camera's `left`/`right`) from `engine.frame()`'s size, and again when the window resizes, then call
  `updateProjectionMatrix()`. A game that never sets it draws squeezed on phones and other non-default shapes.
- **Curves and tubes**: three's 3D curves (`CatmullRomCurve3`, the Bézier and line curves), `TubeGeometry`,
  `ExtrudeGeometry`'s `extrudePath`, and `BufferGeometry.setFromPoints`, bit-exact with three r185.
- **Files**: `files.open` picks several files or a whole folder, and `files.onDrop` takes dropped files and folders,
  each confirmed by the player in a trusted summary.
- **Input and UI**: `input.touchControlsVisible()`; from 1.20 the arrows and Enter stay the game's until a widget has
  focus, and `primaryPointer()` is `"coarse"` from the start on touch-first devices. Game UIs reach screen readers
  and browser automation (`getByRole`).
- **Runtime menus** take the StarHermit client's look.
- **Fixes**: Restart or Stop on a busy machine could leave the game stuck stopping; shadows on WebGL 2 no longer
  stripe at biases that are clean natively; `input.bindings()` works in `onStart`; text-style emoji symbols draw
  without another emoji first; workers have `Date`, `Math.random` and `performance.now`.
- **Play scripts**: `repeat FRAMES until TEXT … end`, `file`/`drop` answers to the Files dialog, and native render
  checks honour `# viewport WxH@N`; checks can join the local platform with `--local-platform --player NAME`.

### 1.17.1

Host API 1.19, as 1.17.0, fixes only: re-pin to 1.17.1 (`engine.version=1.17.1`).

- **Fix (rooms)**: a `RoomSocket` roster push merges into the room as last known, keeping its `joinCode`,
  `metadata`, name and team shape (pushes carry only status, session and participants).
- **Emoji**: keycaps (`2️⃣ #️⃣`, 0–9, `#`, `*`) draw as one StarHermit Emoji key, natively and in browsers alike; a
  stray U+20E3 no longer draws as an empty box.
- **Fix (scene)**: with an `OrthographicCamera`, specular and reflections take the fixed view axis, as three.js does
  (a flat metal surface showed a hotspot).
- **Fix (draw)**: `draw.box` inline styles take Textures (a `CanvasTexture` background), as `ui` styles do.
- **Faster (UI)**: repeating radial gradients take about six times fewer vertices; the docs give the overlay's
  vertex budget.

### 1.17.0

Host API 1.19: pin `engine.version=1.17.0` and add `engine.minor=19` for the change marked below; everything else
applies to every game.

- **Colour emoji**: StarHermit Emoji, the engine's own emoji font (699 glyphs of original art, under the engine's
  licence), draws emoji in colour in `draw.text`, `ui` text and canvas `fillText`, natively and in browsers. It loads
  only when text first needs it; until then emoji keep their room and draw nothing. Single emoji only in this
  version: a ZWJ sequence draws its emoji one by one, skin tones draw the default tone, and flags are not drawn.
- **Rooms**: `rooms.connect(roomId, { targeted: true })` lets the host send `sendData(payload, to)` and
  `sendEvent(kind, fields, to)` to named participants (at most 100), checked before sending. Participants, rosters
  and leaderboard entries carry `displayName`. A room refused because the player is in another room rejects with
  `active-room-elsewhere` (1.19; older games keep `conflict`). A server script's `game.rooms = "host"` keeps its
  rooms host-routed.
- **Leaderboards**: `leaderboards.list()` works for signed-out players. Reads only: scores come only from the game's
  server.
- **Fix (UI)**: text larger than 256 window pixels (96-point text at a 3× pixel ratio) draws instead of being left
  out of the overlay, and the generic `serif` and `monospace` families draw bold.

### 1.16.5

Host API 1.18, as 1.16.4, fixes only: re-pin to 1.16.5 (`engine.version=1.16.5`).

- **Fix (UI)**: a `ui.image` or `draw.image` region reaching past its texture draws the part inside it, in its share
  of the box, as canvas `drawImage` does (1.16.4 left such a region out); a rectangle drawn from its far corner
  draws as the same rectangle. `ui.pointerOver()` is false over a `ui.target`, as documented.
- **Faster (scene)**: `computeBoundingBox`/`computeBoundingSphere`, `Box3.setFromBufferAttribute` and attribute
  transforms (`translate`, `scale`, `rotate`, `applyMatrix4`) run as native loops, identical to three r185: a
  200,000-vertex bounding sphere takes 3 ms instead of about 300.
- **Checks**: play scripts' `click TEXT` scrolls a widget found only scrolled out of view into view first;
  `performance.now()` keeps advancing through a call paused on its fuel; a check fails when part of a frame could
  not be drawn.

### 1.16.4

Host API 1.18, as 1.16.3, fixes only: re-pin to 1.16.4 (`engine.version=1.16.4`).

- **Fix (UI)**: one invalid draw no longer blanks the game's whole overlay for the frame (top bar and widgets
  included), natively and in browsers. A cover-fitted image's texture region a rounding hair outside 0–1, at some
  window sizes (phones at 390×844 @3×, dialogs at @2×), drew a black frame; each bad draw is now mended or left out
  alone, with a console warning once. `draw.image`'s `source` follows canvas `drawImage`: clipped to the image, the
  destination shrinking with it.
- **Fix (rooms)**: a `RoomSocket` hears the roster as it connects and acts on the room's host from the start, so a
  host's `sendEvent` works at once; `rooms.leave` stops the room's socket with `stopped("ended")`; and reconnects back
  off instead of retrying several times a second.

### 1.16.3

Host API 1.18, as 1.16.2, fixes only: re-pin to 1.16.3 (`engine.version=1.16.3`). Games declaring `engine.minor=18`
with transparent materials should.

- **Fix (scene)**: transparent meshes of games declaring `engine.minor=18` draw after every opaque mesh again, by
  render order then distance as three.js sorts them. Since 1.16.0 they were drawn among the opaque meshes, so a
  transparent surface without depth writes could be covered by what lies under it (water in a basin). They still
  cast shadows.

### 1.16.2

Host API 1.18, as 1.16.1, fixes only: re-pin to 1.16.2 (`engine.version=1.16.2`) to get it. Multiplayer games should.

- **Fix (rooms)**: a `RoomSocket` reads the platform's realtime roster pushes as production sends them, so
  `on("roster")` fires as players join and leave, and the room's host is recognised as host (its `sendEvent` was
  refused and it was paced as a guest). Every roster push was dropped before; one that cannot be read is now a
  console warning.

### 1.16.1

Host API 1.18, as 1.16.0, fixes only: re-pin to 1.16.1 (`engine.version=1.16.1`) to get it.

- **Fix (UI)**: 1.16.0's rule that the topmost widget takes the pointer now applies only to games declaring
  `engine.minor=18`. Games declaring an older minor keep the earlier rule, so a game that draws effects over its UI in
  a full-window placed widget is clickable again. From 18, a placed container that paints nothing (no background or
  style) lets the pointer through between its interactive widgets: that is the way to draw over the UI without taking
  the pointer.

### 1.16.0

Host API 1.18: pin `engine.version=1.16.0` and add `engine.minor=18` for the new members and the behaviour changes
marked below; the fixes apply to every game.

- **three.js parity** (1.18): r185's full math (vectors, quaternions, matrices, colours, `Box3`, `Plane`, `Ray`,
  `Frustum`, `MathUtils`…), `object.clone()` (instance a loaded glTF model as often as you like), `BufferAttribute`
  accessors, `computeBoundingBox`, and rays that hit invisible meshes whose layers match.
- **Geometries and materials** (1.18): Icosahedron, Octahedron, Dodecahedron, Tetrahedron, Lathe, TorusKnot,
  Wireframe and RoundedBox geometries; `flatShading`, `bumpMap` and `wireframe`; `ShadowMaterial`; transparent meshes
  cast shadows; `scene.background` takes textures and skies (cube, equirect, PMREM) with blurriness, intensity and
  rotation; meshes honour `drawRange`.
- **Lighting fixes**: no more speckles or white frames from a light at the camera or lined up with the view; the
  background shows in render-target panes; `envMapIntensity` applies to `scene.environment`. With 1.18, environments
  are filtered as three.js r16x's PMREM, and `new RoomEnvironment()` without a renderer is r155–r162's dim room (pass
  the renderer for the bright one).
- **GLTFLoader**: samplers (repeat and smooth filtering by default), every core material map, `EXT_texture_webp`,
  large textures halved instead of dropped, and one warning per model naming what it did not apply. JPEG images are
  not decoded yet.
- **Drawing** (1.18): `draw.circle`, `ellipse`, `arc` and strokes, outlined `text`, and `blend` modes.
- **Browser audio**: the "Unknown audio request", "output unavailable", "append timed out" and "play rejected"
  failures are fixed, a lost output recovers by itself, and streams keep pace on slow pages. Natively the Auto sound
  limit never drops below 16, and per-frame `fade`/`setPitch`/`setPan` no longer count against the operation limit.
- **TypeScript** that broke only in browsers (multi-line arrow return types and other erasure cases) now loads there.
- **UI**: a chained style always goes to its own widget (styled images), the topmost widget takes the pointer, and
  touch controls draw at their radius.
- **Images**: going past the image budget throws a catchable RangeError instead of ending the game, and many images
  loading at once all succeed in browsers.
- **Tools**: `--dev` runs read `.starhermitignore`d files, `check` summarises left-out files, play scripts take
  `=TEXT`, and checks play audio on their simulated clock.

### 1.15.2

Host API 1.17, as 1.15.1, fixes only: re-pin to 1.15.2 (`engine.version=1.15.2`) to get them.

- **Fix (iPhone)**: Safari on iPhone can give touches large negative pointer ids, which stopped a game with "invalid
  touch event" at the first touch. The browser host now maps each finger to a small id of its own.
- **Fix (checks)**: in `starhermit check` and `--render-check`, a game whose modules take long to evaluate can again
  slice its first frame's work by `performance.now()` (in 1.15.1 such a slice could run past the 3 s frame limit).

### 1.15.1

Host API 1.17, as 1.15.0, fixes only: re-pin to 1.15.1 (`engine.version=1.15.1`) to get it.

- **Fix (checks)**: in `starhermit check` and `--render-check`, `performance.now()` advances with the real time spent
  within a frame again, so a game slicing start-up work by time ("until 8 ms passed, then yield") stops as it does in a
  window. In 1.15.0 such games failed the check's 3 s frame limit. Play in a window or a browser was not affected.

### 1.15.0

Host API 1.17: pin `engine.version=1.15.0` and add `engine.minor=17` for the new members and the behaviour changes
marked below; the fixes apply to every game.

- **Key art over 3D scenes**: package images and sounds decode on wall time, not one step per frame. Over a slow 3D
  scene in a browser's software rendering, style image fills and `TextureLoader` images showed their fallback for a
  minute or more.
- **Shapes and lines** (1.17): three.js's 2D curves, `Path`, `Shape`, `ShapePath.toShapes`, `ShapeGeometry`,
  `ExtrudeGeometry` and `EdgesGeometry` with three.js r185's own vertices, UVs and groups; material arrays
  (`new Mesh(geometry, [a, b])` draws each of the geometry's `groups`); `Line`, `LineSegments` and `LineLoop` with
  `LineBasicMaterial`, one pixel wide.
- **Trusted time** (1.17): `platform.serverTime()` and `serverNow()` read the platform's clock, for guests too, so
  daily challenges no longer follow the device clock.
- **Guests read leaderboards**: `leaderboards.entries(id)` works signed out; `list()` still needs a player.
- **Play scripts**: clicks only on what is in view, one matching rule for `until`, `expect` and `click` (exact, then
  ignoring case, then containing), widgets before plain text, `click TEXT #N`, `click X Y`, a settle wait, a
  fixed-step clock so `hold` is the same in every run, and `ui.target(text, rect)` (1.17) for canvas-drawn buttons.
- **Focus and keyboard**: `ui.setFocus` takes `ui.id()` names and works in scroll areas; `ui.capturingKeys()` is true
  while a text field has focus. With 1.17: typing in the game's UI presses no actions, arrows stay out of text
  fields unless the player navigates there (`textField(..., { arrows: false })`), and `ui.dialog` with no title
  draws no heading.
- **Touch controls** show at once on phones and tablets, stay visible when the set changes, take quick taps, and
  `onTouch` marks fingers on them (`control`, 1.17).
- **Fixes**: no false "not responding" screen when a browser page is slow to draw; `onOverlay` is always balanced;
  letter-spaced or tabular text keeps the letters of ligatures; a key held as a runtime screen opens no longer
  blocks clicks.

### 1.14.0

Host API 1.16: pin `engine.version=1.14.0` and add `engine.minor=16` for the new members and the new CSS conversion;
the fixes apply to every game.

- **three.js view offsets**: `PerspectiveCamera` and `OrthographicCamera` take `setViewOffset(fullWidth, fullHeight,
  x, y, width, height)`, `clearViewOffset()` and `view`, with three.js's projection: keep the subject centred beside
  a side panel, or draw a tile of a larger image. Picking, culling and shadows follow it.
- **RoomEnvironment**: `scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture`
  works after changing imports, and lights scenes within 1.5% of three.js's own room. Only a `RoomEnvironment` is
  accepted; `near`, `far` and `options.size` are ignored.
- **CSS conversion** (`engine.minor=16` for `ui.stylesFromCss`; `starhermit css` by default, `--minor N` for an older
  one): `h1`–`h6` become the classes `.h1`–`.h6` (`ui.style("h2").heading(text)`), an id selector with no class
  becomes a class of its name, and `box-sizing` is read from `*, *::before, *::after`, `html` with `inherit`, and
  browsers' border-box buttons; what it cannot decide is listed in `dropped`.
- **Fixes**: a widget's own `size` and `font` win over its style class's text; `ui.spacer()` returns a rectangle
  spanning its column's width (its row's height), usable as a region; `bindingLabel` gives the same label natively,
  in `--render-check` and in browsers (`"D"`, `"Space"`, `"Arrow Up"`); `--render-check` prints the game's console
  lines as `check` does.
- **Know**: `frame()` is 0 × 0 before the first frame (module scope and `onStart`), in a window, in browsers and in
  checks alike; size layout and cameras in `onUpdate` or `onRender`.

### 1.13.2

Host API 1.15, as 1.13.1, fixes only: re-pin to 1.13.2 (`engine.version=1.13.2`) and run `starhermit types` to get it.

- **Fix (declarations)**: the `starhermit.d.ts` that `starhermit types` writes type-checks without `skipLibCheck`;
  since 1.10.0 `tsc` reported `Cannot find name 'AntialiasMode'` in it.

### 1.13.1

Host API 1.15, as 1.13.0, fixes only: re-pin to 1.13.1 (`engine.version=1.13.1`) to get it.

- **Fix (native)**: HTTPS no longer fails when a server asks for an optional client certificate, as
  api.starhermit.com now does; the engine answers without one and carries on, as browsers and curl do.

### 1.13.0

Host API 1.15, as 1.11.0 and 1.12.0: pin `engine.version=1.13.0`; nothing new to declare, and every change applies
to every game.

- **Classic scripts follow sloppy mode natively**: a `loadClassic`, `sandbox`, `authority` or `worker` script
  without `"use strict"` now creates a global when it assigns an undeclared name, gets `globalThis` as `this` in a
  function called without one (a primitive `this` is boxed), may repeat parameter names, and reads
  `arguments.callee`, as in browsers and on the platform. Legacy octal, `with`, block functions used outside their
  block and `arguments` aliasing stay strict natively: start such files with `"use strict"`.
- **Faster numeric scripts natively**: operators, element reads and comparisons take their operands straight from
  locals; a 1024×768 height pass takes 0.98 s instead of 1.04 s and spends about a fifth less fuel. Results are the
  same.
- **Fix (native)**: `a + b` or `a < b` with an object on the left could lose the left side's string when the right
  side's `valueOf` triggered a garbage collection.

### 1.12.0

Host API 1.15, as 1.11.0: pin `engine.version=1.12.0`; nothing new to declare, and every change applies to every
game.

- **Faster scripts natively** on branchy grid code and calls: conditions with `&&`, `||` and `!` jump on each
  operand, more instruction sequences run as one (`x + y * w`, `table[i]`), and calls of plain functions skip the
  interpreter's general call path. A 1024×768 height pass takes 1.04 s instead of 1.37 s; object-heavy code runs
  about as before. Results are the same.
- **Fuel buys more work**: a fused instruction counts as one, so branchy code spends about 29% fewer units; the
  rate is unchanged.
- **Lost socket messages (native)**: a platform socket (rooms, game and realtime sockets, the voice relay) could
  drop a message that arrived as the runtime checked an idle socket, most often the first one as it opened;
  `cargo starhermit publish --socket` then sometimes waited three minutes.
- **Classic scripts** (`loadClassic`, `sandbox`, `authority`, `worker`) without `"use strict"` ignore a failed
  assignment and answer `false` for a refused `delete` natively, as in browsers, instead of throwing.
- **Linux voice capture**: giving up on a slow PulseAudio connection no longer waits up to 8 s for its teardown.

### 1.11.0

Host API 1.15: pin `engine.version=1.11.0`; declare `engine.minor=15` for the compact vertex formats and the
new usage fields. Everything else applies to every game.

- **Big frames no longer fail**: meshes and images a frame makes past 96 MiB wait and go over the next frames,
  first in, first out, instead of throwing; objects draw once their mesh and images have arrived. Loading code
  that staged uploads across frames can go. `engine.usage().waitingUploads` and `waitingUploadBytes` (1.15)
  read 0 once everything is sent.
- **Compact vertices** (1.15): Int16 positions, normalized Int8 normals, Uint8 colors and Uint16 UVs stay compact
  on the GPU and in the mesh budget (16 bytes a vertex where floats take 48); unindexed geometry draws without
  an index list; a geometry with no attributes drawn with `setDrawRange(0, N)` and a `boundingSphere` gives a
  vertex hook N vertices at no mesh cost.
- **No hitches from dropped resources**: the runtime no longer collects garbage from scratch every 512 scene
  resources (about 100 ms at a 240 MiB heap); it releases dropped resources in short steps, and a creation a
  budget would refuse first reclaims them.
- **Faster scripts natively**: numeric code runs about 1.8× faster in the engine's interpreter. Module
  evaluation's budget is now 60 s by the clock, and a busy call's overdraft inside a callback is a time.
- **Direct3D 12** shares buffer blocks between small meshes and instance buffers, as Vulkan does (4,096 small
  meshes take 1 MiB of video memory rather than 16-256 MiB).
- **Linux sound**: a slow PulseAudio lookup no longer delays the ALSA fallback past 2 s.

### 1.10.0

Host API 1.14: pin `engine.version=1.10.0` and declare `engine.minor=14` to use what is new; games on older
minors keep their behaviour.

- **Ten graphics levels**: Options › Graphics offers Auto and `quantum`, `atomic`, `molecular`, `cellular`,
  `terrestrial`, `planetary`, `stellar`, `galactic`, `cosmic` and `infinite`, phone to fastest desktop. Auto
  detects one (GPU, memory, a short benchmark), starts at most at `stellar` and steps down under load. Read it
  with `frame().level`, `levelIndex` and `graphics`, and the level's budgets with `levelSettings()`;
  `frame().quality` still gives the four tiers. Players' saved Low, Balanced, High and Ultra load as quantum,
  molecular, terrestrial and galactic. With `engine.minor=14` the level caps shadow map sizes and MSAA samples.
- **What a device cannot run is disabled, with the reason**: levels above its ceiling (`frame().levelCeiling`),
  VSync in browsers, render scale where a script game draws at the window's size, exclusive fullscreen without
  a video mode switch, frame limits above the display. `ui.select` options take `disabled` and `description`
  for your own menus. A choice saved on a stronger device is kept and used again there.
- **Streamed music**: `audio.stream(path, options)` plays Ogg Opus or Vorbis as it decodes, without a clip,
  from package files or remote files that play while they download (each 256 KiB piece checked) and stay
  cached for offline play. At most 4 at once. Repackage a game with remote Ogg files so its index lists the
  pieces.
- **Bigger scenes**: raise `engine.limits.mesh_mib` (124 MiB standing, up to 1,536), `engine.limits.meshes`
  (1,008, up to 4,096), `engine.limits.instanced_meshes` (1,024, up to 4,096) and, natively,
  `engine.limits.heap_mib` (256, up to 1,024), within `gpu_mib`. Meshes under 65,536 vertices upload 16-bit
  indices and count at what they upload. The collector now works in short paced steps (a 256 MiB heap's worst
  pause fell from about 110 to 20 ms), and a device that cannot give memory ends the game as out of script
  memory rather than crashing.
- **Longer loading**: `setBusy(label, { seconds })` asks for up to 600 s before the not-responding screen; a
  call keeps the longest allowance it asked for, and a shorter one counts from the next call.
- **What `onQuit` saves goes out**: its `saves.save`, the account's settings and platform calls' writes are
  sent as the game closes, natively and in browsers (where the page sends at most 16 requests and 64 KiB with
  `keepalive`; a larger save uploads next session).

The Windows runtime is built from engine a5ba81ec, the same code as the release's commit (7e778bf3) but for
diagnostics: Microsoft Defender's machine-learning scan flagged builds of the release commit as
Trojan:Win32/Bearfoos.B!ml, a false positive. Its `--version` reads `starhermit 1.9.1 (host API 1.14, …;
engine release 1.10.0)`.

### 1.9.1

Host API 1.13, as 1.9.0: re-pin to 1.9.1 (`engine.version=1.9.1`) to get these.

- **Custom shaders checked as browsers check them**: a material's WGSL is now held to the rules WebGPU
  enforces, natively and in `starhermit check`, with the part, line and column. That covers a name declared
  twice in one scope, a value hiding a builtin it is then used as (`let min = …; min(a, b)`), reserved words
  as names (`target`, `filter`, `set`, `type`, `self`, `common`, `active`, …, uniforms' and textures' names
  too), a builtin's value left unused, `break` or `continue` outside a loop and constant expressions that
  overflow or divide by zero. Such code used to draw natively and nothing in browsers. If `check` now refuses
  your material, rename or fix what the message names. Constant integer math inside float expressions computes
  as WGSL does everywhere (`1 / 2 * 0.5` is 0).
- **Refused shaders reported in browsers**: a material or `renderer.post` program the browser's WebGPU refuses
  is logged once in the game's log with WebGPU's message at your line, and `shaderError` reports it.
- **Firefox and Safari**: console lines and error screens carry their file, line and column; running out of
  memory ends the game with "ran out of script memory"; sounds loaded in a burst are playable at once in
  Firefox; and the first tone of a game's first oscillator starts on time in every browser.
- **Back/forward cache**: a page the browser gives back loads again, and the game starts anew with what it
  stored (it showed the game stopped).
- **Known in Safari**: `onQuit` does not run when the page closes or navigates. Keep what must last saved as
  it changes, or in `onSuspend`. Known in Firefox: a game that takes all the memory the browser allows can
  freeze the tab.
- **Tooling**: `starhermit new` writes `engine.minor=13` for a game pinned to the runtime's own release, so new
  games get 1.9's UI behavior. Native downloads (remote files, `cargo starhermit publish`) reuse HTTPS
  connections, about 3.5× faster for many files.
- **Rust games**: the UI handles a finger as script games' does (`ui::PointerInput`).

### 1.9.0

Host API 1.13. Games pinned to an earlier release keep running on it. Re-pin to 1.9.0 (`engine.version=1.9.0`)
for the lifecycle fixes; add `engine.minor=13` for the new UI behavior.

- **Rotated UI content** (`engine.minor=13`): a style's `rotate` turns everything its box draws, as a CSS
  transform does: text with its shadows, glows, strokes and gradient fills, images, nine-slices, decoration
  images and blurred shadows, with smooth edges. Layout, hit-testing and focus stay where the box is. A
  game-drawn widget's own `draw` stays upright. Games declaring an older minor, or none, keep text, images
  and blurred shadows upright.
- **Fingers in the game's UI** (`engine.minor=13`): `hovered` and `hoverWithin` never match a finger, and
  `pressed` matches only while the finger is down on the widget, so nothing stays lit after a tap. Taps get
  touch-sized targets and a drag in a scroll area scrolls it. Mouse and pen are unchanged.
- **`onSuspend` and `onResume` in browsers**: a hidden tab or minimized browser now suspends the game as a
  minimized window does natively; `onSuspend` runs after the frame in progress and what it writes to storage
  is kept, and `onResume` runs before the next frame when the page shows.
- **`onQuit`**: it mostly never ran, natively or in browsers, because a closing window or page usually finds a
  frame in progress. It now runs once, after that frame (after `onSuspend` if the game was hidden first), and
  its storage writes are kept. Natively it has a second; in browsers a page going away waits 0.2 s for games
  with the `storage` capability. Cloud saves, the account's copy of settings and platform calls made in
  `onQuit` still do not go out: save during frames.
- **Fixes**: a minimized window's first frame after it comes back no longer takes one long time step.

### 1.8.1

Host API 1.12, as 1.8.0: re-pin to 1.8.1 (`engine.version=1.8.1`) to get these; no code changes are needed.

- **Short sounds in browsers**: sounds on the synthesis graph (`starhermit:audio`'s `context`) that started at
  `context.currentTime` and lasted less than a few seconds were never heard in browsers: the graph's commands
  reached the mixer seconds late. They now arrive at once, and `currentTime` is the mixer's time on both
  runtimes, also right after a hidden tab or minimized window comes back. If your game is silent or misses short
  effects in browsers on 1.8.0 or earlier, re-pin to 1.8.1.
- **Linux runtime**: a developer download, `starhermit-1.8.1-linux-x86_64.tar.gz`, for 64-bit Linux with glibc
  2.35 or newer. Its `native.json` lists what it requires. Native uploads are still played by the Windows client.
- **Browser defaults**: while a game runs, its page keeps the browser's right-click menu, selection, copy and
  paste, dropped files, middle-click autoscroll, the mouse's back and forward buttons and shortcuts such as
  Ctrl+S, Ctrl+F, Ctrl+P, zoom, F1, F3 and Alt from the game, and keys the game binds reach it with Ctrl, Alt or
  Cmd too. F11, F12, reload and the browser's tab keys still work. A page embedding a game in a larger document
  can keep the browser's behavior with `browserDefaults: "page"`.
- **Out of memory in browsers**: a game that uses up the browser's memory ends with "the game ran out of script
  memory" instead of breaking the page.
- **Fixes**: native `http://` requests try every address a name resolves to (`localhost` on Windows); the
  Windows download's `starhermit.exe` keeps its executable bit when unzipped on Linux or WSL.

### 1.8.0

Host API 1.12. Games pinned to an earlier release keep running on it; re-pin (with `engine.minor=12` for the
new members) to use these.

- **Styles for the game UI**: register looks once with `ui.setStyles` by widget kind and class, with
  `ui.setTokens` values, and name classes per widget with `ui.style(...)`. Gradient, image and nine-slice
  fills, per-side borders, rounded or cut corners, shadows and glows, decorations, backdrop blur, and text
  with letter spacing, shadows, outlines and gradient fills. State blocks (hover, pressed, focus-visible,
  checked, selected, disabled, first, last, odd, even, enter, exit) and `inside` rules work as in CSS, and
  `parts` style sliders, checkboxes, selects, tabs, meters and dialogs. Sizes are border-box.
- **Motion**: transitions between looks, keyframe animations with staggered children, enter and exit
  animations, and scale and rotate. Reduced motion makes them instant or still.
- **Layout and widgets**: grids with ruled and striped rows, stacks, anchored placement, `justify` and
  spacers, stretch, fill and grow, margins; buttons built from content, `ui.widget` for widgets drawn by
  hand that keep focus, navigation and screen readers, tooltips, meters, radio groups, switches and
  `ui.document`.
- **From CSS**: `ui.stylesFromCss` and the `starhermit css FILE` command convert a browser build's style
  sheet into styles, animations, tokens and layouts, listing what has no style.
- **Cursors**: `input.setCursor` sets the pointer by CSS cursor name, or to the game's own image up to
  64x64.
- The player's interface size, text size, high contrast and reduced motion still apply over styles.
- **Fixes**: a Texture used only in a style is kept in browsers (its fill drew nothing); fonts added with
  `canvas.fonts` draw in every frame; `engine.preferences()` agrees with `ui.preferences()` every frame;
  `renderer.capture()` takes up to 4 captures at once and always settles; slider clicks and drags land on
  steps, and the Options menu's sliders and footer behave at large sizes and on slow pages.

### 1.7.0

Host API 1.11. Games pinned to an earlier release keep running on it; re-pin (with `engine.minor=11` for the
new members) to use these.

- **Display-space grade**: `renderer.grade.space = "display"` grades the color the screen shows, per channel
  after tone mapping, as a web build's canvas grade does: saturation, contrast about display 0.5, shadow and
  highlight tints, a `night` (desaturate and a moonlight tint that spares warm and bright pixels, with
  `spareSaturation` and `brightScale`), a highlight `lift`, and `flashSpace: "display"` for a flash the night
  doesn't tint. It costs nothing extra on any quality tier. The default `"linear"` grade is unchanged.
- **Small render targets**: `RGFormat` and `RedFormat` with `UnsignedByteType` (RG8, R8) at 2 and 1 bytes a
  pixel, every blend equation clamped to 0–1.
- **The game UI follows the player's settings**, as documented: interface size, text size, high contrast (over
  `setTheme`, a label's `color` and a container's `background`) and reduced motion. `ui.preferences()` says
  what applies this frame and `ui.measureText()` measures text as the UI lays it out. A game that sizes its UI
  by hand should check it at larger sizes.
- **Large text**: a frame whose text outgrows the glyph atlas now grows it (to 1024, then 2048 px) instead of
  drawing none of that frame's text.
- **Audio in browsers**: `context.state` is `"suspended"` until the player's first press starts audio, then
  `"running"`, with `statechange` and `resume()` resolving. A `setValueAtTime` or `setTargetAtTime` replaces one
  at the same time right before it, so updating a parameter every frame no longer hits the event limit while
  the clock stands still.
- **Windows**: the runtime carries version information and the StarHermit icon, so Task Manager lists a game
  under "StarHermit" (not a wrong name with a blank icon).

### 1.6.0

Host API 1.10. Games pinned to an earlier release keep running on it; re-pin (with `engine.minor=10` for the
new members) to use these.

- **Faster UI**: unchanged labels keep their layout across frames, and widget rectangles reach scripts without
  JSON. A UI-heavy frame of about 800 widgets dropped from about 4 ms to 0.7 ms in browsers and from about 3 ms
  to 0.75 ms natively, with pixel-identical output.
- **Leaner script heap**: the native interpreter's tables give memory back after a burst of garbage (after 8
  mostly empty collections in a row, to twice their use); in a big battle the heap's peaks dropped from about
  205 MiB to under 185 MiB.
- **Materials**: uniforms up to 16 KiB per material, and `textureLoad(tex, coords, 0)` for exact texel reads
  (clamped into the texture on every runtime).
- **Render targets and blending**: two- and one-channel half-float targets (`RGFormat`, `RedFormat` with
  `HalfFloatType`) at half or a quarter of RGBA16F's memory; `CustomBlending` with blend equations and factors
  (reverse subtract, min, max) and `SubtractiveBlending`; `renderer.render` into a target uses materials as they
  are at the call.
- **Texture memory**: a DataTexture's pixels can leave the script heap once uploaded (`image.data = null`, or
  in `onUpdate`); it keeps drawing and survives device or context loss.
- **Scene usage**: `engine.usage()` and `engine.budgets()` count nodes, objects, instances, instanced meshes,
  sprites, materials, programs and lights against their limits.

### 1.5.1

Host API 1.9, fixes only: re-pin from 1.5.0 with no other change.

- **Copying works**: `clipboard.writeText` puts the text on the system clipboard natively (Windows, X11,
  Wayland) and in browsers; it passed its checks before but the text never arrived.
- **Pasting natively**: Ctrl+V, Shift+Insert or the Paste key paste into a focused text field. Only the runtime
  reads the clipboard, on the player's gesture; the game sees the pasted text as typing.
- **`frustumCulled = false` is never culled**: a mesh a vertex hook places keeps its shadow even when the hook
  puts it nearer the light than its bounds say, and a NaN, infinite or empty bounding sphere culls nothing
  instead of throwing.

### 1.5.0

Host API 1.9. Games pinned to an earlier release keep running on it; re-pin (with `engine.minor=9` for these)
to use them.

- **Files the player picks**: `files.saveAs(name, data, {type})` and `files.open({accept})` open a trusted
  dialog only while handling the player's press (or within 5 seconds of it): the runtime's own file picker
  natively, the browser's download and file chooser on the web. The game sees names and bytes, never paths;
  at most 64 MiB, and program, script and page names are refused.
- **Captures**: `renderer.capture({ui})` returns a PNG of the game's own frame (with its 2D overlay if asked),
  never the runtime's menus; a photo mode is `files.saveAs("photo.png", await renderer.capture())`.
- **Screen readers**: `ui.announce(text, { politeness })` speaks what a drawn board cannot (UI Automation,
  AT-SPI, a live region in browsers), at most 500 characters and a few a second.
- **Invite links**: `platform.launchContext()` gives the session a launch was for (an accepted invite, a
  notification), so the game can open that table instead of its lobby.
- **Image budget**: `engine.limits.image_mib` raises a game's image budget from 56 MiB up to 512 MiB, within
  `gpu_mib`.
- **Materials and lighting**: 5 textures per custom material, render targets without depth and with mipmaps,
  instanced meshes on their own 262,144-instance budget, light and fog hooks, a full-screen post pass with the
  scene's colour and depth, fog that starts behind the camera, shadow softness and a grade flash.
- **Faster scripts**: interpreter allocation from reused pools, cheaper `for…of` and Map/Set; object-heavy
  game code about 10–20% faster natively. In browsers, host calls with short strings are about 3× cheaper.
- `engine.stats().heapBytes` and `heapLimitBytes` are absent in browsers rather than 0.

### 1.4.1

Host API 1.8, fixes only: re-pin from 1.4.0 with no other change.

- **Text fields in browsers**: a focused `ui.textField` (and the runtime's own fields) takes typing, paste and
  input method compositions in browsers, where no text reached it; natively the input method is on only while
  a field has focus, with its candidates at the caret.
- **Audio clips in browsers**: every clip a game loads reaches the mixer, however many it loads at the start
  (they queue and upload a few at a time in order) instead of most being silently lost; a clip that could not
  be made throws when played.
- **No console error without a cloud save**: the runtime asks whether a save exists before downloading it, so
  a player with no save yet no longer causes a 404 in the console.
- **Local platform** (`--dev --local-platform`): a refused command answers its sender with the platform's error
  frame, and server scripts get the live context (room, presence, ratings and teams, matchmaking).

### 1.4.0

Host API 1.8. Games pinned to an earlier release keep running on it; re-pin to use these.

- **Carry a JS SDK build's players over**: a cloud save the engine did not write (a JS SDK build's) is no
  longer an error. `saves.foreign()` gives its `{ text, bytes }`, the save state is `"foreign"`, and nothing is
  uploaded until the game migrates it and calls `saves.save(data, { replaceForeign: true })`, which replaces
  only the version it was shown. `settings.legacyKeys()`, `legacy(key)`, `removeLegacy(key)` and `onLegacy`
  read and remove the game's own older settings keys (outside `game.`).
- **Compression**: `compress` and `decompress` (`"gzip"`, `"deflate"`, `"deflate-raw"`) in `starhermit:engine`,
  bounded and with the same bytes natively and in browsers; `atob` and `btoa` natively too.
- **Platform-hosted remote files**: `engine.remote.urls=platform` serves a game's remote files from StarHermit
  under the game's own origin, and `cargo starhermit publish` uploads only the objects the game lacks.
- **Render targets**: `WebGLRenderTarget` with `renderer.setRenderTarget` and `render` (icons, ground marks),
  the scene's depth for custom materials (soft particles), and more texture sampling in material hooks.
- **UI**: no lost clicks when a press and release fall between two frames (a quick tap on a slow frame);
  `ui.scrollArea` can be scrolled and read by the script; per-widget text size, family and weight, and the
  generic families `serif`, `monospace` and `cursive`.
- **Browsers**: `loadClip`, `loadBuffer`, `createImageBitmap(path)` and `FontFace.load()` no longer make the
  page wait for an unfetched file, `files.fetch` fetches package files and keeps them, and at most 16 fetches
  run at once (the rest queue).
- **Classic scripts in browsers**: games that load classic scripts (`loadClassic`) now start in browsers; the
  page's globals such as `fetch`, `WebSocket` and `location` can be assigned by a game as natively.
- **Ranged reads**: `files.readBytes(path, offset, length)` reads part of a package or remote file.
- **Scripts**: `Intl.NumberFormat` with `style: "currency"` natively (symbols, accounting, CLDR 48), and
  `formatToParts`. A server script declaring `tickRateHz: 0` needs no `onTick` in `authority()`, as on the
  platform.

### 1.3.0

Host API 1.7. Games pinned to an earlier release keep running on it; re-pin to use these.

- **Faster, leaner scripts**: the native interpreter keeps values in one machine word and caches property
  lookups, and `x | 0`, `x >>> 0` and shifts by constants run as single instructions. Object-heavy games use
  about half the heap, and map generation runs about 1.2–1.3× faster. A game past its heap limit is collected
  and its tables shrunk before it is ended; `STARHERMIT_HEAP_CENSUS=<seconds>` with `--dev` prints what the
  heap holds.
- **Remote files** (host API 1.7): `engine.remote.files=`, `engine.remote.urls=` and
  `engine.remote.redirects=` mark files the game's own HTTPS hosts serve. The packaging commands leave them out
  of the upload and pin each by size and SHA-256 in `starhermit-remote.json` (`--remote-out DIR` writes their
  objects by hash). The runtime fetches, checks and caches them; `files.fetch(paths, onProgress)` makes them
  ready, `files.status(path)` says where a file is, and loaders fetch what they load.
- **Upload limits**: `--max-upload-mib` and `--max-upload-paths` (or `STARHERMIT_MAX_UPLOAD_MIB` / `_PATHS`)
  pass a game's raised limits, and with `--game-id` the tools read the limits the platform reports.
- **glTF**: Draco-compressed meshes (`KHR_draco_mesh_compression`) and `KHR_mesh_quantization` load through
  `GLTFLoader`.
- **Geometry and materials** (host API 1.7): `BufferAttribute.onUpload` drops a geometry's arrays from the
  heap once they reach the GPU; compact `Int8`, `Uint8` and `Int16` attributes; four custom vec4s per instance
  (`setCustomAt(i, v, slot)`); premultiplied and multiply blending; culling by `boundingSphere` and
  `frustumCulled = false`. Vertex colours outside 0–1 no longer drop a mesh silently.
- **Web**: the page's start-up clear no longer issues an empty draw, so WebGPU stops warning of a zero vertex
  count.

### 1.2.0

Host API 1.6. Games pinned to 1.1.0 keep running on 1.1.0; re-pin to use these.

- **BigInt** natively, as in browsers: `1n << 64n` and the rest of ES2022 BigInt (`BigInt.asIntN`,
  `asUintN`, `BigInt64Array`, `BigUint64Array`, DataView's BigInt accessors). A BigInt holds at most
  2<sup>20</sup> bits natively. Host APIs and `JSON.stringify` refuse BigInts (`TypeError`).
- **Modules in browsers**: a module that imports a binding and exports it again now loads when the
  two modules import each other (it failed with "Export '…' is not defined in module"), as do
  `export { x } from` and `import()` in such a cycle.
- **`starhermit check`** links the modules as browsers get them and fails, with file and line, where a
  browser would not load the game; warns of built-ins only browsers have; prints the game's `console`
  output (`--quiet` hides it); and fails a game that would bring up the "not responding" screen.
- **Time budgets**: module evaluation has 60 s of fuel (it was 2 s), `TypedArray` `set` and `fill`
  cost only what they write, and an error for time names the phase, the time it ran and the limit.
  The budgets by phase are in the [tutorial](tutorials/starhermit-engine.md#10-limits-and-the-licence).
- **Up to 128 rebindable actions** (the platform keeps the first 32 with the account, the runtime keeps
  the rest in the player's synced settings), and `engine.group.<action>=Heading` groups them on the
  controls screen.
- **Packages leave out development files** (`node_modules/`, `tsconfig.json`, `package.json`, lock
  files, source maps, …) and whatever a `.starhermitignore` lists. `package --web --out DIR` writes
  an upload without them; an index written in place lists them under `"excluded"`.
- **The page**: a file changed after packaging is named on the error screen with its listed and
  actual size and SHA-256; the loader names the game's icon (no `/favicon.ico` request); a browser
  without WebGPU or WebGL 2 gets a clear message.
- **Custom materials** (host API 1.6): game WGSL vertex and surface hooks on the standard, physical,
  Lambert and basic materials and a `ShaderMaterial`, checked and sandboxed by the engine; an
  additive surface hook on `MeshBasicMaterial` gives glow.
- **Scenes and tools** (host API 1.5): `GLTFLoader` in `starhermit:scene`, `engine.setBusy(label)`
  for long work that cannot be sliced, the script heap in `engine.stats()`, and a sampling profiler
  (`STARHERMIT_SAMPLE` with `--dev`).
- **Faster scripts**: typed-array loops 25–30% faster and `Math` built-ins computed inline.

### 1.1.0

The web runtime: games play in browsers from this wiki's engine files, pinned by SRI, with online
play, voice and bundled Liberation and DejaVu fonts; `starhermit package --web` writes one folder
for browsers and the client.

### 1.0.0

The first release: the Windows (x86-64) runtime, without a web runtime.

## The engine area

```text
engine/
  versions.json            every release: host API, date, runtimes, revocation
  X.Y.Z/
    native/windows-x86_64/
      native.json          the Windows runtime's files, each with its size, SHA-256 and chunks
      starhermit-X.Y.Z-windows-x86_64.zip
                           the developer download: the same files as one archive
    manifest.json          the web runtime's files, each with its size and sha384
    starhermit.js          the module a game's loader page loads
    starhermit.wasm, *.js  the runtime, its audio mixer and worklets
    starhermit.d.ts        the host API's declarations
    fonts/, licenses/      the runtime's fonts and every licence notice
                           (all of the web runtime only in a release that has one)
  chunks/ab/<sha256>.z     pieces of the native files, shared by every release
  patches/ab/<sha256>.p    binary patches from earlier releases' files
```

Every file is published as it is (no file name starts with `_` or `.`), and GitHub Pages serves it
with `Access-Control-Allow-Origin: *`.

### versions.json

```json
{
  "aot": {"revokedCompilers": [], "revokedKeys": [], "updated": "2026-10-29T14:18:41Z"},
  "format": 2,
  "versions": [
    {
      "api": {"major": 1, "minor": 4},
      "date": "2026-10-20T13:55:50Z",
      "native": {
        "windows-x86_64": {"manifest": "1.1.0/native/windows-x86_64/native.json", "sha256": "<SHA-256 of native.json>"}
      },
      "revoked": false,
      "version": "1.1.0",
      "web": {"manifest": "sha384-<SRI hash of manifest.json>"}
    }
  ]
}
```

`web` is `{"manifest": "sha384-…"}`, the SRI hash of the release's web `manifest.json`, or `null` for
a release without a web runtime. `native` pins each platform's `native.json` by its SHA-256. A
release withdrawn because it is unsafe says `"revoked": true` with a `"revokedReason"`; that is the
only change a published entry ever takes, except removal: to keep the wiki within GitHub Pages' 1 GB the
oldest releases leave the engine area, and their entries stay listed as revoked with `"removed": true`
(1.0.0 to 1.6.0 were removed this way on 2026-10-26, 1.7.0 to 1.15.1 on 2026-10-27, 1.15.2 to 1.17.0 on 2026-10-28, 1.17.1, 1.18.0, 1.19.0, 1.19.1, 1.19.2, 1.19.3 and 1.20.0 on 2026-10-29).

`aot` (from 1.26.1) is the revocation list for WebAssembly code the platform compiles ahead of time: native
runtimes refuse compiled code from a listed compiler version or signing key, and with no list ever read they
interpret everything. `updated` is information only.

### native.json

`native.json` lists the files of the engine folder a client installs — `starhermit.exe`,
`release.json` (the release's version, host API and the `launcher` protocol its runtime speaks),
`LICENSE-engine` and the third-party notices — each with its `size`, `sha256` and `chunks`. A chunk
is a stretch of a file, stored zlib-compressed as `chunks/<first two hex digits>/<sha256>.z` and named
by the SHA-256 of its uncompressed bytes; chunk boundaries follow the content, so an unchanged
stretch keeps its chunk from one release to the next. Where it is smaller, a file also lists
`patches` from the same file of earlier releases (`"from"`: the SHA-256 of the earlier file).
`downloads` lists the developer download with its `size` and `sha256`; clients never install it.
In a release with a web runtime the native folder also holds `web-manifest.json`, the release's web
manifest, so the developer download packages games for the web without a network.

### The web runtime

A release's web runtime is the files beside its `manifest.json`, which lists each with its `size` and
`sha384` and records the release's version, host API and build. A game's loader page (`index.html`,
written by `starhermit package --web`) has no script of its own: it loads `starhermit.js` and
`manifest.json` from `https://engine.starhermit.com/engine/X.Y.Z/` (or, from older tools,
`https://wiki.starhermit.com/engine/X.Y.Z/`) with SRI hashes, and the engine
fetches every other file it needs (`starhermit.wasm`, the audio worklets, the fonts) and checks it
against the manifest. The page runs only the engine — input, the runtime's menus, audio, storage, the
platform session and voice — and the game's TypeScript runs in a worker it starts and can stop.

The web runtime bundles its own fonts, Liberation 2.1.5 (SIL Open Font License 1.1) and DejaVu Sans
2.37 (Bitstream Vera and Arev licences); their notices are in `licenses/` with the others.

## Integrity

One chain of hashes covers every byte a client runs:

1. `versions.json` (or the platform's API below) gives the SHA-256 of a release's `native.json`.
2. `native.json` gives every file's SHA-256 and every chunk's.
3. The client fetches only the chunks it does not already hold, checks each one's stored size,
   inflated size and SHA-256, puts each file together, checks the file's SHA-256 and only then moves
   the release into place. A patch is checked against its own SHA-256, and the patched file against
   the file's; any failure falls back to the chunks.

The developer download is covered by the same chain through its entry in `downloads`. A browser
game's loader page pins the web runtime's `starhermit.js` and `manifest.json` with SRI hashes, and
the runtime checks every other file it loads against the manifest.

## The engine releases API

The platform serves the same list, with every URL on this wiki, so clients ask the API which engine
to fetch:

`GET /api/v1/engine/releases` → every release, newest first:

```json
{"releases": [{
  "version": "1.1.0", "api": {"major": 1, "minor": 4}, "revoked": false, "date": "2026-10-20T13:55:50Z",
  "web": {"base": "https://wiki.starhermit.com/engine/1.1.0/", "manifestIntegrity": "sha384-<SRI hash>"},
  "native": {"windows-x86_64": {
    "manifestUrl": "https://wiki.starhermit.com/engine/1.1.0/native/windows-x86_64/native.json",
    "manifestSha256": "<SHA-256 of native.json>"}}
}]}
```

`GET /api/v1/engine/releases/{version}` → one release, or `404` when it is not listed. Both are
anonymous and cacheable (`Cache-Control: public, max-age=60` with an `ETag`). A revoked release
carries `revokedReason`; `web` is `null` for a release without a web runtime.
While the platform has never read the list (the wiki unreachable since it started) they answer
`503` with `Retry-After`.

## Script games on the platform

When a game's root `starhermit.txt` declares `engine.version`, the platform treats it as a script
game:

- each publish records the release the files pin, as `hosting.engineVersion`, and sets
  `hosting.deployWarning` (also in a bundle push's answer) when that release is not listed or is
  revoked. A warning never stops a publish.
- every page of the hosted game is served with a Content-Security-Policy that admits scripts only
  from the two engine origins (and the engine's own `blob:` workers), so the only code a script
  game's page can run is the official engine:

```text
default-src 'self'; script-src https://wiki.starhermit.com https://engine.starhermit.com 'wasm-unsafe-eval' blob:; worker-src blob:;
connect-src 'self' https://wiki.starhermit.com https://engine.starhermit.com; img-src 'self' blob: data:; media-src 'self' blob:;
style-src 'self' 'unsafe-inline'; font-src 'self' https://wiki.starhermit.com https://engine.starhermit.com;
frame-ancestors https://dashboard.starhermit.com; base-uri 'self'; form-action 'none'
```

A page of a script game without a browser build (such as the plain page a Windows-only game uploads
for browsers) needs no script and is unaffected.

## Revocations

A revoked release stays listed so that clients can say why they refuse it: the StarHermit client does
not install or start it and tells the player, the packaging commands refuse to package a game for it
when they read `versions.json`, and the platform warns the owners of games that pin it when they
publish. Re-pin to the release that replaces it and publish again
(see [Move to a newer engine](tutorials/starhermit-engine.md#9-move-to-a-newer-engine)).
