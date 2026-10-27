# StarHermit engine releases

The StarHermit engine — the runtime that plays [script games](tutorials/starhermit-engine.md) — is
published on this wiki as versioned, immutable releases under
[wiki.starhermit.com/engine/](../engine/). Games pin one release exactly with `engine.version` in
their [`starhermit.txt`](starhermit-txt.md); a game's page loads the release's web runtime from
here in the browser, the StarHermit Windows client installs the release's native runtime and plays
the game on it, and developers download a release's runtime from here to build with.

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
| 1.15.2 | 1.17 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.15.2-windows-x86_64.zip](../engine/1.15.2/native/windows-x86_64/starhermit-1.15.2-windows-x86_64.zip), [starhermit-1.15.2-linux-x86_64.tar.gz](../engine/1.15.2/native/linux-x86_64/starhermit-1.15.2-linux-x86_64.tar.gz) |
| 1.15.1 | 1.17 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.15.1-windows-x86_64.zip](../engine/1.15.1/native/windows-x86_64/starhermit-1.15.1-windows-x86_64.zip), [starhermit-1.15.1-linux-x86_64.tar.gz](../engine/1.15.1/native/linux-x86_64/starhermit-1.15.1-linux-x86_64.tar.gz) |
| 1.15.0 | 1.17 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.15.0-windows-x86_64.zip](../engine/1.15.0/native/windows-x86_64/starhermit-1.15.0-windows-x86_64.zip), [starhermit-1.15.0-linux-x86_64.tar.gz](../engine/1.15.0/native/linux-x86_64/starhermit-1.15.0-linux-x86_64.tar.gz) |
| 1.14.0 | 1.16 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.14.0-windows-x86_64.zip](../engine/1.14.0/native/windows-x86_64/starhermit-1.14.0-windows-x86_64.zip), [starhermit-1.14.0-linux-x86_64.tar.gz](../engine/1.14.0/native/linux-x86_64/starhermit-1.14.0-linux-x86_64.tar.gz) |
| 1.13.2 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.13.2-windows-x86_64.zip](../engine/1.13.2/native/windows-x86_64/starhermit-1.13.2-windows-x86_64.zip), [starhermit-1.13.2-linux-x86_64.tar.gz](../engine/1.13.2/native/linux-x86_64/starhermit-1.13.2-linux-x86_64.tar.gz) |
| 1.13.1 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.13.1-windows-x86_64.zip](../engine/1.13.1/native/windows-x86_64/starhermit-1.13.1-windows-x86_64.zip), [starhermit-1.13.1-linux-x86_64.tar.gz](../engine/1.13.1/native/linux-x86_64/starhermit-1.13.1-linux-x86_64.tar.gz) |
| 1.13.0 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.13.0-windows-x86_64.zip](../engine/1.13.0/native/windows-x86_64/starhermit-1.13.0-windows-x86_64.zip), [starhermit-1.13.0-linux-x86_64.tar.gz](../engine/1.13.0/native/linux-x86_64/starhermit-1.13.0-linux-x86_64.tar.gz) |
| 1.12.0 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.12.0-windows-x86_64.zip](../engine/1.12.0/native/windows-x86_64/starhermit-1.12.0-windows-x86_64.zip), [starhermit-1.12.0-linux-x86_64.tar.gz](../engine/1.12.0/native/linux-x86_64/starhermit-1.12.0-linux-x86_64.tar.gz) |
| 1.11.0 | 1.15 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.11.0-windows-x86_64.zip](../engine/1.11.0/native/windows-x86_64/starhermit-1.11.0-windows-x86_64.zip), [starhermit-1.11.0-linux-x86_64.tar.gz](../engine/1.11.0/native/linux-x86_64/starhermit-1.11.0-linux-x86_64.tar.gz) |
| 1.10.0 | 1.14 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.10.0-windows-x86_64.zip](../engine/1.10.0/native/windows-x86_64/starhermit-1.10.0-windows-x86_64.zip), [starhermit-1.10.0-linux-x86_64.tar.gz](../engine/1.10.0/native/linux-x86_64/starhermit-1.10.0-linux-x86_64.tar.gz) |
| 1.9.1 | 1.13 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.9.1-windows-x86_64.zip](../engine/1.9.1/native/windows-x86_64/starhermit-1.9.1-windows-x86_64.zip), [starhermit-1.9.1-linux-x86_64.tar.gz](../engine/1.9.1/native/linux-x86_64/starhermit-1.9.1-linux-x86_64.tar.gz) |
| 1.9.0 | 1.13 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.9.0-windows-x86_64.zip](../engine/1.9.0/native/windows-x86_64/starhermit-1.9.0-windows-x86_64.zip), [starhermit-1.9.0-linux-x86_64.tar.gz](../engine/1.9.0/native/linux-x86_64/starhermit-1.9.0-linux-x86_64.tar.gz) |
| 1.8.1 | 1.12 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.8.1-windows-x86_64.zip](../engine/1.8.1/native/windows-x86_64/starhermit-1.8.1-windows-x86_64.zip), [starhermit-1.8.1-linux-x86_64.tar.gz](../engine/1.8.1/native/linux-x86_64/starhermit-1.8.1-linux-x86_64.tar.gz) |
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
(1.0.0 to 1.6.0 were removed this way on 2026-10-26, 1.7.0 and 1.8.0 on 2026-10-27).

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
`manifest.json` from `https://wiki.starhermit.com/engine/X.Y.Z/` with SRI hashes, and the engine
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
  from this wiki (and the engine's own `blob:` workers), so the only code a script game's page can
  run is the official engine:

```text
default-src 'self'; script-src https://wiki.starhermit.com 'wasm-unsafe-eval' blob:; worker-src blob:;
connect-src 'self' https://wiki.starhermit.com; img-src 'self' blob: data:; media-src 'self' blob:;
style-src 'self' 'unsafe-inline'; font-src 'self' https://wiki.starhermit.com;
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
