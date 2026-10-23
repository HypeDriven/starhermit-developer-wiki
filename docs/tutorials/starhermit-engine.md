# Tutorial: build a game with the StarHermit engine

The **StarHermit engine is the recommended way to create games for publishing on StarHermit**.
You build the game once, and the same package is automatically playable in a browser and natively
across all platforms supported by the engine. Native play offers additional performance and features.
Availability depends on the engine release: 1.1.0 and later have a Windows runtime and a web runtime
(1.0.0 was Windows-only), and 1.8.1 and later also a Linux runtime for developers. This page describes engine **1.9.0**; what each release changed is listed
under [Engine releases](../engine-releases.md#release-notes).

The StarHermit engine runs **script games**: a whole game written in TypeScript (or JavaScript) and
played by one prebuilt engine executable, the StarHermit runtime, without compiling any native code.
You write the game's logic against the engine's built-in modules — a 3D scene, input, a HUD, audio,
storage and the StarHermit platform — and the runtime does the rest: windowing, rendering on the
GPU, sound, the options menu, sign-in and online play. Players open the game on starhermit.com in
their browser, where its page loads the engine your game asks for from this wiki, or play it natively
in the [StarHermit Windows client](https://starhermit.com), which installs that engine.

This tutorial builds **Star Catcher**, a small game in which you steer a basket to catch falling
stars, and takes it from an empty folder to a published game:

1. [What a script game is](#1-what-a-script-game-is)
2. [Get the engine](#2-get-the-engine)
3. [Create the game](#3-create-the-game)
4. [Write the first version](#4-write-the-first-version)
5. [Run it natively](#5-run-it-natively)
6. [Many things at once: `starhermit:world`](#6-many-things-at-once-starhermitworld)
7. [Players, saves and online play](#7-players-saves-and-online-play)
8. [Publish it](#8-publish-it)
9. [Move to a newer engine](#9-move-to-a-newer-engine)
10. [Limits and the licence](#10-limits-and-the-licence)

## 1. What a script game is

A script game is a folder (a **package**) with a [`starhermit.txt`](../starhermit-txt.md) at its
root, your TypeScript modules and your assets. Three `engine.*` lines in the manifest make it one:

```ini
engine.api=1
engine.entry=src/main.ts
engine.version=1.9.0
```

`engine.api` is the major version of the host API your code is written against, `engine.entry` the
module the runtime starts, and `engine.version` the exact engine release the game is built and
tested for. Releases are published on this wiki under [Engine releases](../engine-releases.md); the
game never contains the engine itself, so an upload holds only your own files.

The runtime treats every game as untrusted: your code reaches the machine only through the host API
(its own package files, its own storage, the platform for its own game id), never files, processes,
arbitrary network connections or the player's credentials. In return a game cannot crash the runtime
or hang the window: a call that runs for three seconds brings up the runtime's own "not responding"
screen, and an uncaught error ends the game on an error screen the player can restart from.

## 2. Get the engine

**Players** do nothing: in a browser, the game's page loads the release the game pins from this wiki
and checks it against the hashes the page carries; in the StarHermit Windows client, Play downloads
the release (once, shared by every game that pins it), checks every file against the release's
published hashes and starts it.

**Developers** download the runtime of a release from the engine area:

- [starhermit-1.9.0-windows-x86_64.zip](../../engine/1.9.0/native/windows-x86_64/starhermit-1.9.0-windows-x86_64.zip)
  (Windows 10 or 11, 64-bit), 9.5 MB.
- [starhermit-1.9.0-linux-x86_64.tar.gz](../../engine/1.9.0/native/linux-x86_64/starhermit-1.9.0-linux-x86_64.tar.gz)
  (64-bit Linux with glibc 2.35 or newer: Ubuntu 22.04, Debian 12 or later), 9.6 MB.

The archive holds one folder, `starhermit-1.9.0-windows-x86_64`, with `starhermit.exe`, the
`release.json` that tells the runtime which release it is, the release's `web-manifest.json`,
`LICENSE-engine` and the third-party notices. It is the same engine the client installs, and it
packages games for the release's web runtime without a network. Its size and SHA-256 are listed under
`downloads` in the release's [native.json](../../engine/1.9.0/native/windows-x86_64/native.json); to
check your copy in PowerShell, compare that `sha256` with:

```powershell
Get-FileHash .\starhermit-1.9.0-windows-x86_64.zip -Algorithm SHA256
```

Unpack the archive and open a terminal in the unpacked folder:

```powershell
.\starhermit.exe --version
```

```text
starhermit 1.9.0 (host API 1.13, launcher 1; engine release 1.9.0)
```

On Linux, unpack the archive and run `starhermit` from its folder (its
[native.json](../../engine/1.9.0/native/linux-x86_64/native.json) lists the archive's SHA-256 the same
way; check it with `sha256sum`):

```sh
tar -xzf starhermit-1.9.0-linux-x86_64.tar.gz
./starhermit-1.9.0-linux-x86_64/starhermit --version
```

`--version`, `new`, `types`, `check` and `package` need nothing more. To play a game in a window the
runtime needs Wayland or X11 with Vulkan or OpenGL ES 3.0 drivers, and ALSA or PulseAudio for sound;
`native.json`'s `requires` lists every library it uses. Players still play native uploads in the
StarHermit Windows client; the Linux runtime is for writing, checking and packaging games.

The commands below are written as `starhermit`; run them as `.\starhermit.exe` (Windows) or
`./starhermit` (Linux) from that folder, or add the folder to your `PATH`.

## 3. Create the game

```powershell
starhermit new star-catcher --title "Star Catcher"
```

```text
Created Star Catcher in star-catcher: a script game pinned to engine 1.9.0
Play it: starhermit star-catcher
Check it: starhermit check star-catcher
For a native upload (the StarHermit client plays it): starhermit package --native star-catcher
For the web: starhermit package --web star-catcher --out <upload>
```

The new folder holds a playable starting point — a cube that hops when you press Space:

```text
star-catcher/
  starhermit.txt             the manifest, pinned to the runtime's own release (engine.version=1.9.0)
  tsconfig.json              TypeScript settings for checking the game
  src/main.ts                the entry module
  .starhermit/starhermit.d.ts  the host API's declarations, for your editor and the type checker
```

`.starhermit/` starts with a dot, so it is never part of the package.
`starhermit types star-catcher` writes the declarations again, for example after you move to a newer
runtime. Every module, member, unit, limit and error of the host API is documented in that file.

The runtime does not type-check: it removes TypeScript's types as it loads each module. Check them
yourself with TypeScript 5 or newer; with Node.js installed, `npx` runs it without installing
anything in the game folder:

```powershell
cd star-catcher
npx --package typescript tsc -p .
```

Development files stay out of the package: dot-names (such as `.starhermit/` and `.git/`),
`node_modules/`, `tsconfig.json`, `jsconfig.json`, `package.json`, npm, yarn and pnpm lock files,
source maps (`*.js.map`, `*.ts.map` and the like) and `Thumbs.db`/`desktop.ini`. Everything else in
the folder is part of the package. To leave out more, add a `.starhermitignore` at the game's root
with gitignore-style rules (`*` and `?` within a name, `**` for any number of folders, a trailing `/`
for a folder, `!` to keep a file a default rule leaves out; the last matching rule decides):

```text
notes/
levels/**/draft-*.json
!package.json
```

A game that reads or imports a left-out file fails with an error naming the rule, in development as
well, so `starhermit check` catches it before you upload.

## 4. Write the first version

Replace the generated `starhermit.txt` with the game's manifest:

```ini
name=Star Catcher
description=Catch the falling stars before the time runs out.
launch=index.html
engine.api=1
engine.entry=src/main.ts
engine.version=1.9.0
engine.capabilities=platform,storage
control.left=KeyA+ArrowLeft | Move left
control.right=KeyD+ArrowRight | Move right
control.start=Space+Enter | Start a round
engine.gamepad.left=LeftStickLeft+DpadLeft
engine.gamepad.right=LeftStickRight+DpadRight
engine.gamepad.start=South
cache..=0
```

The `control.*` lines declare the game's actions with their default keys (the platform's
[controls](game-controls.md) format) and `engine.gamepad.*` their gamepad defaults. Players rebind
them in the runtime's Options menu, so the game reads **actions**, never keys. A game declares up to
128 actions: the platform keeps the first 32 with the player's account, and the runtime keeps the
bindings of the rest in the player's synced settings. `engine.group.<action>=Heading` starts a group
at that action (up to the next group), which the controls screen shows under the heading, for example
`engine.group.left=Movement` (host API 1.6). `engine.capabilities`
asks for what the game uses beyond drawing and input: `platform` for the signed-in player and online
features, `storage` for data kept on the player's device and account. `launch=index.html` names the
page that plays the game in browsers, which the engine writes when you [publish](#8-publish-it).

Then replace `src/main.ts`:

```ts
// Star Catcher: catch the falling stars in the basket before the time runs out.
import { frame, onFixedUpdate, onRender, onStart, setFixedRate } from "starhermit:engine";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  SphereGeometry,
  renderer,
  scene,
} from "starhermit:scene";
import { onAction, value } from "starhermit:input";
import { storage } from "starhermit:storage";
import { player } from "starhermit:platform";
import * as draw from "starhermit:draw";

// -- The scene ----------------------------------------------------------------
const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
camera.position.set(0, 4, 12);
camera.lookAt(0, 3, 0);
renderer.camera = camera;
scene.background = new Color(0x0b1020);

const sun = new DirectionalLight(0xfff4e0, 1.2);
sun.position.set(3, 8, 5);
scene.add(sun, sun.target, new AmbientLight(0x6070a0, 0.5));

const basket = new Mesh(new BoxGeometry(2, 0.4, 1), new MeshStandardMaterial({ color: 0x4fa3ff, roughness: 0.4 }));
scene.add(basket);

const starGeometry = new SphereGeometry(0.3, 16, 12);
const starMaterial = new MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb000, emissiveIntensity: 0.6 });
const stars = Array.from({ length: 3 }, () => {
  const mesh = new Mesh(starGeometry, starMaterial);
  scene.add(mesh);
  return { mesh, x: 0, y: 0, previousY: 0, speed: 0 };
});
type Star = (typeof stars)[number];

// -- The rules ----------------------------------------------------------------
const WIDTH = 6; // the basket moves between -WIDTH and WIDTH
const ROUND = 60; // seconds a round lasts
let basketX = 0;
let previousX = 0;
let score = 0;
let timeLeft = 0; // 0 between rounds
const saved = storage.getJson("best");
let best = typeof saved === "number" ? saved : 0;

function drop(star: Star): void {
  star.x = (Math.random() * 2 - 1) * WIDTH;
  star.y = star.previousY = 8 + Math.random() * 4;
  star.speed = 2 + Math.random() * 2 + score * 0.05;
}

onStart(() => {
  setFixedRate(60);
  for (const star of stars) drop(star);
});

onAction((event) => {
  if (event.action === "start" && event.pressed && timeLeft === 0) {
    score = 0;
    timeLeft = ROUND;
    for (const star of stars) drop(star);
  }
});

onFixedUpdate((step) => {
  previousX = basketX;
  for (const star of stars) star.previousY = star.y;
  if (timeLeft === 0) return;
  // An action's value is 0 to 1, so a stick steers gently and a key fully.
  const steer = value("right") - value("left");
  basketX = Math.max(-WIDTH, Math.min(WIDTH, basketX + steer * 9 * step));
  for (const star of stars) {
    star.y -= star.speed * step;
    if (star.y < 0.6 && star.y > 0 && Math.abs(star.x - basketX) < 1.2) {
      score += 1;
      drop(star);
    } else if (star.y < -1) {
      drop(star);
    }
  }
  timeLeft = Math.max(0, timeLeft - step);
  if (timeLeft === 0 && score > best) {
    best = score;
    storage.setJson("best", best);
  }
});

// -- Drawing ------------------------------------------------------------------
onRender((alpha) => {
  // Between two fixed steps: draw where things are at this moment.
  basket.position.set(previousX + (basketX - previousX) * alpha, 0.2, 0);
  for (const star of stars) {
    star.mesh.position.set(star.x, star.previousY + (star.y - star.previousY) * alpha, 0);
  }
  hud();
});

function hud(): void {
  const { width, height, scale } = frame();
  const size = 22 * scale;
  const name = player()?.displayName ?? "Guest";
  draw.text(`${name}   score ${score}   best ${best}`, 16 * scale, 16 * scale, { size, color: "#e8ecf4" });
  if (timeLeft > 0) {
    draw.text(`${Math.ceil(timeLeft)} s`, width - 16 * scale, 16 * scale, { size, color: "#ffd34d", align: "end" });
  } else {
    draw.rect(0, height / 2 - 40 * scale, width, 80 * scale, [0, 0, 0, 0.5]);
    draw.text("Press Space to play", width / 2, height / 2 - 12 * scale, { size, color: "#ffffff", align: "center" });
  }
}
```

What each part does:

- **The scene.** `starhermit:scene` follows three.js: a camera, lights, meshes made of a geometry
  and a material, `scene.add`. Distances are meters, angles radians, and colors sRGB.
- **The rules.** `onFixedUpdate` runs at the fixed rate `setFixedRate(60)` asks for, 60 times a
  second whatever the frame rate, so the game plays the same on every machine. `value("right")` is
  the action's value from 0 to 1, so a gamepad stick steers gently and a key steers fully, and
  `onAction` hears each press, here to start a round.
- **Drawing.** `onRender` runs once per frame with `alpha`, how far the frame is between the last two
  fixed steps; positions drawn between `previous` and current values move smoothly at any refresh
  rate. `starhermit:draw` draws the HUD over the scene in window pixels; `frame().scale` converts
  logical pixels for high-DPI displays.
- **The best score** stays on the player's device through `starhermit:storage`, kept apart for
  each player.

## 5. Run it natively

```powershell
starhermit check star-catcher
```

```text
package=Directory files=3 bytes=6378 name="Star Catcher" api=1 entry=src/main.ts capabilities=platform,storage actions=left,right,start
left out: tsconfig.json (default rule tsconfig.json)
web=linked modules=2
runnable=true engine="TypeScript" frames=120 probes=0
PASS package src/main.ts: valid; 120 frames headless
```

`check` validates the package (manifest, paths, sizes) and plays 120 frames without a window, so a
syntax error, an unknown import or an exception at start-up shows here with its file, line and column.
It prints the game's `console` output as it goes (`[game] log src/main.ts:12:5: text`, at most 1,000
lines; `--quiet` hides it), fails a game that would bring up the "not responding" screen, and links
your modules the way browsers load them, so a game that would not load in a browser fails here too
(see [Native and browser differences](#native-and-browser-differences)).
Then play it:

```powershell
starhermit star-catcher
```

Press Space to start a round and the arrow keys (or A and D, or a gamepad) to steer. **F1** always
opens the runtime's own menu: graphics, audio, controls (rebinding), the account and quitting. Your
game cannot draw over that menu or read it, and no game can bind F1.

While developing, add `--dev` (`starhermit star-catcher --dev`): the runtime then prints the game's
`console` output in the same form and points errors at your TypeScript lines.

## 6. Many things at once: `starhermit:world`

Natively, your game's TypeScript runs in the engine's own script interpreter, which keeps every game
inside its time and memory budgets; in browsers it runs in the browser's JavaScript engine, in a
worker the page can stop. Decisions and a few dozen objects cost little there, but per-entity
work — moving thousands of particles, a crowd, a flock — would mean thousands of interpreted steps
every frame. For that the engine has `starhermit:world`:

- **tables** keep entity data in typed columns (numbers and vectors) in the game's memory;
- **kernels** are ordinary functions of one row that the runtime compiles and runs natively over
  every row of a table, without entering script;
- the **schedule** runs kernels every frame, and **bindings** draw a table as one `InstancedMesh`
  (or drive scene nodes), composing every instance natively.

Your script makes the decisions; the runtime does the per-row arithmetic. Add a night sky of 4,000
twinkling sparkles behind the game as `src/sky.ts`:

```ts
// The night sky behind the game: 4,000 twinkling sparkles. Their data lives
// in a starhermit:world table, a kernel moves every one of them natively each
// frame, and an instance binding draws the table as one InstancedMesh, so the
// game's script runs no per-sparkle code at all.
import { InstancedMesh, MeshBasicMaterial, SphereGeometry, scene } from "starhermit:scene";
import { bind, kernel, schedule, table } from "starhermit:world";

const COUNT = 4_000;

// One row per sparkle: where it hangs, how it twinkles, and what the kernel
// writes each frame (its height and size).
const sky = table("sky", COUNT, {
  base: "vec3",
  phase: "f32",
  rate: "f32",
  y: "f32",
  size: "f32",
});
sky.spawn(COUNT);

// Filled once from script, through typed arrays over the table's memory.
const base = sky.column("base");
const phase = sky.column("phase");
const rate = sky.column("rate");
for (let i = 0; i < COUNT; i++) {
  base[i * 3] = (Math.random() * 2 - 1) * 40;
  base[i * 3 + 1] = Math.random() * 24 - 2;
  base[i * 3 + 2] = -10 - Math.random() * 30;
  phase[i] = Math.random() * Math.PI * 2;
  rate[i] = 0.5 + Math.random() * 2;
}

// An ordinary function of one row. The runtime compiles it and runs it over
// every live row without entering script.
const twinkle = kernel(sky, (r, u: { drift: number }, f) => {
  r.y = r.base.y + Math.sin(f.time * u.drift + r.phase) * 0.3;
  r.size = 0.04 + 0.04 * Math.abs(Math.sin(f.time * r.rate + r.phase));
});

const mesh = new InstancedMesh(new SphereGeometry(1, 6, 4), new MeshBasicMaterial({ color: 0xcfd8ff }), COUNT);
scene.add(mesh);

/** Starts the sky: the kernel runs after every onUpdate, and the binding
 * composes the mesh's instances from the columns after every onRender. */
export function startSky(): void {
  schedule.update(twinkle, { drift: 0.4 });
  bind.instances(mesh, sky, { position: ["base.x", "y", "base.z"], scale: "size" });
}
```

and start it from `src/main.ts`: import it with the other imports, and call it in `onStart`:

```ts
import { startSky } from "./sky.js";
```

```ts
onStart(() => {
  setFixedRate(60);
  startSky();
  for (const star of stars) drop(star);
});
```

The import names `./sky.js`, TypeScript's convention for a module written as `sky.ts`; the runtime
resolves it the same way. Kernels accept a subset of the language — numbers and booleans, arithmetic,
`Math`, `if`, bounded `for` loops, the row's columns and the uniforms you pass — and the runtime
rejects anything else with a `SyntaxError` at the kernel's line when it compiles it, rather than
running it slowly. The declarations of `starhermit:world` describe the subset, event queues that
kernels emit to, tables with history for smooth fixed-step motion, and node bindings.

## 7. Players, saves and online play

**The player.** `player()` from `starhermit:platform` is the signed-in player, or `null` for a
guest; Star Catcher shows their name in its HUD. When the StarHermit Windows client starts your game,
the player is signed in from the first frame, with the client's account: the client hands the
runtime a launch token for your game over a private channel, renews it while the game runs, and the
game never sees it (no host call returns a token, key or cookie). Players never sign in inside a
game; signing in and out happens in the client.

**In browsers** the platform opens the game's page with a launch token for your game, which the
engine takes out of the page's address before your code runs and renews within the platform's 12-hour
limit; your game sees only `player()`, exactly as natively. A guest who chooses **Sign in** in the
runtime's Account dialog goes to StarHermit's own sign-in page and comes back signed in. Voice uses the
browser's microphone after the browser's own permission prompt.

**Development runs.** Started from a terminal, a package cannot claim a platform identity by itself,
so `starhermit star-catcher` plays as a guest. Once your game is published, a development launch
names it:

```powershell
starhermit star-catcher --game <your game's id>
```

and you sign in through **F1 → Account…**, the runtime's own dialog (a key on this computer and one
emailed confirmation, as in [public-key onboarding](public-key-onboarding.md)). Storage, settings,
saves and online play then follow that game and account.

**Saves and settings.** `starhermit:storage` has three stores, all private to your game: `storage`
(key/value data on the device, as Star Catcher uses), `settings` (the game's options, kept with the
player's account under the platform's [per-player settings](../api/games.md#per-player-game-settings)), and `saves` (the
game's save, on the device and in the player's [cloud save slot](cloud-save-sync.md) with conflict
handling).

**Online play.** Everything the platform offers a game is in `starhermit:platform` for your game's
own id: friends and presence, invites, [realtime rooms](../api/realtime.md), matchmaking, the
[game socket](../api/games.md) (`connectGame`), leaderboards, achievements, replays, chat and voice.
For server-authoritative multiplayer, declare a [game script](../api/game-scripts.md):

```ini
server=server.js
```

The platform runs it as the authority for your game's sessions; `starhermit:script`'s
`authority("server.js", …)` runs the same file on a local worker for offline practice, exactly as
the platform does, so offline and online play share one code path. Leaderboard scores, achievements
and match results are written only by the server script, never by the game itself; create the boards
as described in [leaderboards and achievements](game-leaderboards-achievements.md).

### Coming from a JavaScript SDK build

A game that already runs on StarHermit as a browser build using the JavaScript SDK keeps its players'
progress when it moves to the engine (host API 1.8, so add `engine.minor=8`). The engine shows a cloud
save it did not write as **foreign**: `saves.state()` is `"foreign"`, `saves.foreign()` gives the
slot's `bytes` exactly as stored (and its `text` when it is text), and nothing is uploaded until the
game converts it and saves with `replaceForeign`, which replaces only the version it was shown. The
game's older settings keys (outside `game.`) are read through `settings.legacyKeys()` and
`settings.legacy(key)`, and removed with `settings.removeLegacy(key)` once migrated. `decompress` and
`compress` (gzip, zlib or raw DEFLATE) give the same bytes natively and in browsers:

```ts
import { saves, settings } from "starhermit:storage";
import { decompress } from "starhermit:engine";

saves.onStatus((_, state) => {
  if (state !== "foreign") return;
  const old = saves.foreign()!;
  // For example, a save written as gzip-compressed JSON:
  const text = new TextDecoder().decode(decompress(old.bytes, "gzip"));
  saves.save(convert(JSON.parse(text)), { schema: 1, replaceForeign: true });
});
settings.onLegacy(() => {
  for (const key of settings.legacyKeys() ?? []) importOldSetting(key, settings.legacy(key));
});
```

If the browser build registered a service worker that serves from its cache first, returning
players keep getting the cached old build until that worker is gone. Ship a replacement at the
same path (for example `sw.js`) in the engine upload. It takes over at once, clears the old caches,
unregisters itself and reloads its pages onto the engine loader. `navigate()` works only after
`clients.claim()`:

```js
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await self.clients.claim();
  for (const key of await caches.keys()) await caches.delete(key);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
})()));
```

Your menus can keep their look. The engine's UI takes styles much as CSS does (host API 1.13, so
`engine.minor=13`): gradients, borders, rounded or cut corners, shadows and glows, image and
nine-slice frames, hover, pressed and focus looks, transitions and keyframe animations, grids and
flex rows. Convert the browser build's style sheet once with `starhermit css`, which writes the
styles as JSON and lists what it could not map (ids, sibling selectors, `@media` and so on) to port
by hand, then register them at start:

```sh
starhermit css web/style.css --out assets/ui-style.json --fonts Barlow
```

```ts
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
ui.setTokens(css.tokens);
ui.setAnimations(css.animations);
ui.setStyles(css.styles);

// In the frame: a class per widget, and a flex or grid container's layout.
// `.tool.active` in the CSS became the class's `selected` state.
ui.row("speed", () => {
  if (ui.style("tool").button("Pause", { selected: paused })) paused = !paused;
}, css.layouts[".speed"]);
```

A style's `rotate` turns everything its box draws, text and images included, as a CSS transform
does. On touch screens a finger never leaves a widget hovered, and `pressed` shows only while the
finger is down on it. Both need `engine.minor=13` in `starhermit.txt`: without it (or with an older
minor) text and images stay upright and a finger acts as a mouse, as in 1.8.

The player's interface size, text size, high contrast and reduced motion still apply over your
styles. What maps from CSS, and how, is in the UI spec's "From CSS" section.

## 8. Publish it

A published script game is an ordinary StarHermit game whose files are your package. Players find
it on starhermit.com and in their library: the page plays it in the browser, and the StarHermit
Windows client installs it with the engine it pins and plays it natively.

**Package it.** One command, run after every change as the last step before uploading, writes the
upload into a folder of its own: the package's files (without the development files left out above)
plus the two files the platform and the client need:

```powershell
starhermit package --web star-catcher --out upload
```

```text
Web package: upload (5 files, 8620 bytes to upload; the platform takes at most 50 MiB)
Left out (not part of the package): tsconfig.json (default rule tsconfig.json)
Engine 1.9.0 from https://wiki.starhermit.com/engine (manifest sha384-QLGhNG4uEVSr7+gOwj0l7kmqAbTO+K+QGtOAN/qB4cYZy95kLa6m69hY/eNDuXs5)
Not checked against versions.json (read offline): https://wiki.starhermit.com/engine/versions.json says whether 1.9.0 is still current
```

- `index.html`, the **loader page** `launch=index.html` names: markup only, no script of its own. It
  loads the release's `starhermit.js` and `manifest.json` from this wiki pinned by their SRI hashes,
  and the engine checks every other file it loads against that manifest, so the page can run only
  that exact release. Package again rather than edit it.
- `starhermit-files.json`, the **file index**: every file with its size and SHA-256. The browser
  engine reads the package by it, and the client installs and updates the game by it.

It checks the package against the platform's upload rules (no `api/` or `ws/` folders, at most
9,998 paths and 50 MiB) and the release your game pins, which must be published with a web runtime
and not revoked. The runtime checks its own release offline; `--engine-version X.Y.Z --manifest <a copy of that
release>` packages for another one. A game must not have its own `index.html`; the command refuses to
replace it. Without `--out`, `package --web` writes the two files into the game's own folder.
`starhermit package --native star-catcher` writes the same file index into the game's folder without
the loader, for a game that is played only in the client (with any plain page named by `launch=`).
An index written into the game's folder lists the development files the folder holds under
`"excluded"`, and the StarHermit client leaves them out of the upload (client 0.2.7 or later).

**Upload it.** The `upload` folder is the upload, exactly as it is: the browser engine and the client
check every file against the index, so upload its files unchanged, with the same `starhermit.txt`
both inside the folder and at the bundle's root (the platform publishes the root copy in the folder's
place). As in [Add a game from a local folder](../api/github-games.md#add-a-game-from-a-local-folder):

```bash
mkdir -p bundle/client
cp -R upload/. bundle/client/
cp upload/starhermit.txt bundle/starhermit.txt
tar -C bundle -czf star-catcher.tar.gz .

curl --fail-with-body -X POST https://api.starhermit.com/api/v1/me/github-games/upload \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/gzip' \
  --data-binary @star-catcher.tar.gz
```

`ACCESS_TOKEN` is your account's access token (see [upload builds from CI/CD](ci-cd-build-upload.md)
for signing in without a browser). The answer's `game.id` is your game's id, and the game is live at once at
`https://<id>.starhermit.com/`. For every later version, package again and push the same kind
of bundle to the game with [`POST /api/v1/me/github-games/{id}/bundle`](../api/github-games.md#push-a-game-bundle);
players' clients then download only the files whose hashes changed. If a file is changed after
packaging, the browser engine refuses to start and its error screen names the file with the size
and SHA-256 the index lists and the ones it found: package again and upload what the command wrote.
`starhermit check` warns when a folder's index is out of date. A `server=` script in the
folder gets the game its backend as the upload is published.

**From a repository.** A game [published from GitHub](../api/github-games.md) works the same way:
commit the packaged folder (`starhermit.txt` with its `engine.*` lines, `index.html` and
`starhermit-files.json`) at the repository root. The client installs and updates a repository game
with git, fetching only what each commit adds.

**The page's lock.** The platform serves every page of a game whose `starhermit.txt` declares
`engine.version` with a Content-Security-Policy that admits scripts only from this wiki, so the only
code a script game's page can run is the official engine (see
[Engine releases](../engine-releases.md#script-games-on-the-platform)). Your TypeScript runs in a
worker the engine starts; the page itself runs only the engine: input, the runtime's menus, audio,
storage and the platform session.

## 9. Move to a newer engine

A game runs on exactly the release it pins: nothing upgrades it behind your back, and a published
release never changes. To move to a newer one, download its runtime, run your game and its checks
on it, then re-pin by changing `engine.version` in `starhermit.txt`, package again and publish. Players' clients download the new engine once (only what changed from releases they already
hold) and your game's changed files.

The release's major version is the host API's: `engine.api=1` games move freely within 1.x.x. A game
that needs host API members added in a minor version can say so with `engine.minor=N`; an older
runtime then refuses it with a message instead of failing later.

A release found unsafe is **revoked**: [versions.json](../../engine/versions.json) marks it with the
reason, the client refuses to install or start it (and tells the player why), and the packaging
commands refuse it whenever they read versions.json. A revoked release is always followed by a fixed one; re-pin to it and publish.

## 10. Limits and the licence

The runtime keeps every game within budgets, which a package may lower with `engine.limits.*` but
never raise, except its image budget: `engine.limits.image_mib` (host API 1.9) raises the default 56 MiB up
to 512 MiB, within `gpu_mib`. Script time is measured natively in instructions of a reference machine (**fuel**);
browsers have no fuel but the same "not responding" limits:

| Phase | Fuel | "Not responding" after |
|---|---|---|
| Module evaluation (module-scope code of the entry and its imports) | 60 s in all; it cannot pause | 9 s, together with `onStart` |
| `onStart` and its promise jobs | 256 ms a slice (8 × `fuel_ms`) | 9 s, together with module evaluation |
| A frame: events, timers, `onFixedUpdate`, `onUpdate`, `onRender`, promise jobs | 32 ms per call (`fuel_ms`) | 3 s for the whole frame |
| `onSuspend`, `onResume` | 32 ms | 3 s |

A call that uses up its fuel is paused, not ended: it continues on the next frames while the game
draws nothing new. Once a phase runs past its limit, the runtime's "not responding" screen lets the
player wait or stop the game (60 s while the game has called `engine.setBusy`). An error for time names
the phase, the time it ran and the limit, for example `module evaluation of src/main.ts ran past its
time budget (it ran 61234 ms; the limit is 60000 ms of the reference machine's instructions)`. Slice
long work across frames (`fuelLeft()` says what is left of this call's fuel), or announce it with
`setBusy`.

The other limits: a 256 MiB script heap and 1,024 call frames, 64 MiB of storage, canvases of at most
4,096 pixels a side and 8,388,608 pixels (4096 × 2048), 128 actions, BigInts of at most 2<sup>20</sup> bits,
at most 512 MiB and 65,536 files in a package and, for uploads, the platform's 50 MiB and 9,998 paths
(a game the platform allows more passes `--max-upload-mib` and `--max-upload-paths` to the packaging
commands, or `--game-id` to read its limits). Large assets can stay off the upload as **remote files**:
`engine.remote.files=` and `engine.remote.urls=` in `starhermit.txt` name files your own HTTPS hosts serve
(or `engine.remote.urls=platform`: StarHermit serves them, and `cargo starhermit publish` uploads them),
the packaging commands pin each by size and SHA-256, and the runtime fetches and checks them
(`files.fetch` in `starhermit:engine`; see the host API's declarations).
Going past a limit where an operation can fail (an allocation, a host call) throws a `RangeError`;
running out of heap or call depth ends the game on the error screen. The host API's declarations
list every limit.

### Native and browser differences

Natively your code runs in the engine's interpreter, in browsers in the browser's JavaScript engine
(V8 in Chrome and Edge). Both are strict ECMAScript 2022, BigInt included, and `starhermit check`
runs the game natively *and* links its modules as browsers get them. What still differs:

- **Modules that import each other.** In browsers, an import read before its module ran is
  `undefined`; `check` fails on such a read in a module's top-level code (read it inside a function
  instead). `export * from` a module of such a cycle fails `check`: name the exports. A `let`
  exported again from a module of a cycle is a copy in browsers, so later assignments are not seen
  through it: import it from its own module.
- **Loading.** `import()` needs a string literal (`check` fails on a computed specifier).
- **Code from strings.** `eval` fails the load natively; `new Function(...)` throws an `EvalError` on
  both.
- **Built-ins only browsers have**: `Proxy`, `WeakRef`, `FinalizationRegistry`, `Atomics`,
  `structuredClone`, the iterator helpers, `Array.fromAsync`, the new `Set` methods, the worker's
  globals (`self`, `crypto`, `atob`, `URL`, `WebAssembly`, …) and some of `Intl` (`ListFormat`,
  `Segmenter`, `DisplayNames`, `Locale`). `check` warns of every use with its file and line;
  `typeof` tests are fine.
- **Regular expressions.** The `v` flag and the legacy `RegExp.$1` statics are browser-only.
- **Dates.** Natively local time is UTC (`getTimezoneOffset()` is 0); browsers use the player's time
  zone. Format wall-clock times with `timeZone: "UTC"` to show the same on both.
- **Limits.** Natively a string holds at most 2<sup>28</sup> − 16 code units, an array 2<sup>26</sup>
  elements and a BigInt 2<sup>20</sup> bits (more in browsers); a stack overflow natively ends the game rather
  than throwing a catchable `RangeError`. `Math.random` sequences differ.
- **Audio start.** In browsers audio waits for the player's first press: until then
  `context.state` is `"suspended"` and `currentTime` stands still, then it is `"running"` and
  `statechange` fires. Natively it is `"running"` from the start.
- **Browser defaults.** While the game runs, its page keeps the browser's right-click menu, text
  selection, copy and paste, dropped files and shortcuts such as Ctrl+S, Ctrl+F, zoom and the menu
  bar's Alt from the game, and a key your game binds reaches it with Ctrl, Alt or Cmd too. F11, F12,
  reload and the browser's tab keys still work, and text fields keep paste.
- **Closing.** `onQuit` runs once, after the frame in progress (and after `onSuspend` if the window
  or tab was hidden first); only what it writes to `storage` (and `settings` on the device) is kept.
  Natively it has a second; in browsers a page going away (a closed tab, a reload, a link followed)
  waits 0.2 s, and only for games with the `storage` capability. Save to the cloud during frames,
  not in `onQuit`.
- **Host API values.** No host API takes a BigInt, and `JSON.stringify` refuses one (`TypeError`):
  convert with `Number(x)` or `String(x)` before saving or passing it.

The engine is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
with this additional permission, quoted from its `LICENSE-engine`:

> Additional permission: Hype Driven Development Inc. also permits use of this software for any
> purpose, including commercial purposes, to make, distribute and run a game built with it, for as
> long as that game is published on StarHermit.com, publicly available to play there, and kept in
> running order there. For any other use that the license below does not permit, contact
> info@hypedriven.com.

The full text is the `LICENSE-engine` file in the download and beside every installed engine; the
third-party components keep their own licences, in its `notices` folder. Your game's own code and
assets are yours.

## Checklist

- [ ] `starhermit.txt` has `engine.api`, `engine.entry` and `engine.version`, and the capabilities
      the game uses.
- [ ] `starhermit check` passes, and `npx --package typescript tsc -p .` reports no errors.
- [ ] `check` prints no `warning` about browser-only built-ins, and what else the game keeps out of the
      package is listed in `.starhermitignore`.
- [ ] The game's UI fits at a larger interface and text size (F1 › Accessibility): it follows them, so
      size anything placed by hand from `ui.preferences().scale` and measure UI text with
      `ui.measureText`.
- [ ] `launch=index.html` names the loader page.
- [ ] `starhermit package --web --out upload` ran after the last change, and that folder was uploaded
      unchanged.
