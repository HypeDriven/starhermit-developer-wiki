# StarHermit engine releases

The StarHermit engine — the runtime that plays [script games](tutorials/starhermit-engine.md) — is
published on this wiki as versioned, immutable releases under
[wiki.starhermit.com/engine/](../engine/). Games pin one release exactly with `engine.version` in
their [`starhermit.txt`](starhermit-txt.md); a game's page loads the release's web runtime from
here in the browser, the StarHermit Windows client installs the release's native runtime and plays
the game on it, and developers download a release's runtime from here to build with.

## Versions

A release is `X.Y.Z`. `X` is the **host API's major version**, the `engine.api` a game declares, so
every 1.x.x release runs `engine.api=1` games; the release also records the host API's minor version,
which grows as members are added (a game can require one with `engine.minor`). A published release
never changes: a fix is the next version.

| Release | Host API | Runtimes | Developer download |
|---|---|---|---|
| 1.8.1 | 1.12 | Web; Windows (x86-64); Linux (x86-64) | [starhermit-1.8.1-windows-x86_64.zip](../engine/1.8.1/native/windows-x86_64/starhermit-1.8.1-windows-x86_64.zip), [starhermit-1.8.1-linux-x86_64.tar.gz](../engine/1.8.1/native/linux-x86_64/starhermit-1.8.1-linux-x86_64.tar.gz) |
| 1.8.0 | 1.12 | Web; Windows (x86-64) | [starhermit-1.8.0-windows-x86_64.zip](../engine/1.8.0/native/windows-x86_64/starhermit-1.8.0-windows-x86_64.zip) |
| 1.7.0 | 1.11 | Web; Windows (x86-64) | [starhermit-1.7.0-windows-x86_64.zip](../engine/1.7.0/native/windows-x86_64/starhermit-1.7.0-windows-x86_64.zip) |
| 1.6.0 | 1.10 | Web; Windows (x86-64) | [starhermit-1.6.0-windows-x86_64.zip](../engine/1.6.0/native/windows-x86_64/starhermit-1.6.0-windows-x86_64.zip) |
| 1.5.1 | 1.9 | Web; Windows (x86-64) | [starhermit-1.5.1-windows-x86_64.zip](../engine/1.5.1/native/windows-x86_64/starhermit-1.5.1-windows-x86_64.zip) |
| 1.5.0 | 1.9 | Web; Windows (x86-64) | [starhermit-1.5.0-windows-x86_64.zip](../engine/1.5.0/native/windows-x86_64/starhermit-1.5.0-windows-x86_64.zip) |
| 1.4.1 | 1.8 | Web; Windows (x86-64) | [starhermit-1.4.1-windows-x86_64.zip](../engine/1.4.1/native/windows-x86_64/starhermit-1.4.1-windows-x86_64.zip) |
| 1.4.0 | 1.8 | Web; Windows (x86-64) | [starhermit-1.4.0-windows-x86_64.zip](../engine/1.4.0/native/windows-x86_64/starhermit-1.4.0-windows-x86_64.zip) |
| 1.3.0 | 1.7 | Web; Windows (x86-64) | [starhermit-1.3.0-windows-x86_64.zip](../engine/1.3.0/native/windows-x86_64/starhermit-1.3.0-windows-x86_64.zip) |
| 1.2.0 | 1.6 | Web; Windows (x86-64) | [starhermit-1.2.0-windows-x86_64.zip](../engine/1.2.0/native/windows-x86_64/starhermit-1.2.0-windows-x86_64.zip) |
| 1.1.0 | 1.4 | Web; Windows (x86-64) | [starhermit-1.1.0-windows-x86_64.zip](../engine/1.1.0/native/windows-x86_64/starhermit-1.1.0-windows-x86_64.zip) |
| 1.0.0 | 1.4 | Windows (x86-64); no web runtime | [starhermit-1.0.0-windows-x86_64.zip](../engine/1.0.0/native/windows-x86_64/starhermit-1.0.0-windows-x86_64.zip) |

[versions.json](../engine/versions.json) is the authoritative list, newest first, and the engine
area's own page lists the same.

The documentation always describes the newest release. Pages here may be cached for up to ten
minutes after a release is published; [versions.json](../engine/versions.json) says which release is
newest.

## Release notes

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
only change a published entry ever takes.

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
