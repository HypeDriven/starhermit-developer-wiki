# Example game: how Football uses the StarHermit engine

[StarHermit Football](https://github.com/HypeDriven/starhermit-football) is a public, complete
script game. It is realtime 3D football for 1 to 22 players, with AI teammates, a floodlit
stadium, online lobbies, voice and text chat, replays, a leaderboard, achievements and nine
languages. This page takes it apart step by step to show how a real game uses the engine. Each
step names the engine modules involved and links to the game's source, where you can read the
full code.

This walkthrough is written for engine **1.41.0**, the latest release. Every call shown is listed
in the [engine API reference](../engine-api/index.md). Read the
[engine tutorial](starhermit-engine.md) first if you have not built a script game yet.

Source links point at commit
[`33bd9bd`](https://github.com/HypeDriven/starhermit-football/tree/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f).
At that commit the game pins engine 1.39.0 with `engine.minor=39`. It uses nothing newer, so it
runs unchanged on 1.41.0; moving it is a one-line change to `engine.version` (see
[step 12](#12-package-test-and-publish)).

## The shape of the game

| Path | Role |
|---|---|
| `starhermit.txt` | The manifest: name, engine pin, server script, controls, capabilities |
| `server.js` | The one match simulation: run by the platform as the authoritative server, and loaded by the client for offline practice and prediction |
| `engine/src/main.ts` | The entry module: lifecycle callbacks and the screens state machine |
| `engine/src/match.ts`, `logic/` | Match flow, netcode, interpolation and prediction |
| `engine/src/world/` | The stadium, footballers, ball and crowd in the 3D scene |
| `engine/src/screens/`, `hud.ts` | Menus (`starhermit:ui`) and the in-match HUD (`starhermit:draw`) |
| `engine/src/net.ts`, `platform.ts`, `chat.ts`, `voice.ts` | Everything that talks to the StarHermit platform |
| `engine/src/audio.ts`, `i18n.ts`, `quality.ts` | Sound, languages and graphics levels |
| `assets/`, `sfx/` | Images, the string tables and sound clips |

## 1. The manifest

[`starhermit.txt`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/starhermit.txt)
makes the folder a script game, and also declares the server script and the controls:

```text
name=Football
launch=index.html
server=server.js
control.up=KeyW+ArrowUp | Run forward
control.shoot=Space+KeyJ | Shoot (hold) / tap to pass
control.tackle=KeyK | Slide tackle / pressure
engine.api=1
engine.entry=engine/src/main.ts
engine.version=1.39.0
engine.minor=39
engine.capabilities=platform,voice,clipboard,storage
engine.gamepad.shoot=West+RightTrigger
engine.gamepad.pass=South
```

- `launch=index.html` is the loader page that `starhermit package --web` writes. It plays the game
  in browsers on the pinned release's web runtime.
- `server=server.js` is the platform's authoritative match script (step 6).
- `control.*` and `engine.gamepad.*` lines define **actions**. The runtime binds keys and pads to them,
  and players rebind them in the runtime's Options menu. The game never names a key for gameplay.
- `engine.capabilities` asks for the platform (rooms, sockets, leaderboards, replays, chat), voice,
  the clipboard (invite links) and storage (settings). The runtime refuses calls outside them.

The full key list is in [the `starhermit.txt` manifest](../starhermit-txt.md).

## 2. The entry module and the frame loop

[`engine/src/main.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/main.ts)
sets up the renderer at module scope, then registers the four lifecycle callbacks from
[`starhermit:engine`](../engine-api/engine.md):

```ts
import { frame, onFixedUpdate, onRender, onStart, onUpdate, setFixedRate } from "starhermit:engine";
import { ACESFilmicToneMapping, PCFSoftShadowMap, PerspectiveCamera, renderer, scene } from "starhermit:scene";

const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 800);
renderer.camera = camera;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;

onStart(() => {
  setFixedRate(60);
  loadLanguages(); // string tables (step 10)
  sim();           // evaluate server.js once (step 6)
  menuScene.start(); // an AI-vs-AI match behind the menu
  // … platform listeners, settings listeners, invite polling
});

onFixedUpdate((step) => {
  if (match) match.fixedStep(step);
  else if (!replay) menuScene.fixedStep(step);
});

onUpdate((delta) => {
  pollQuality();
  if (match) match.update(Math.min(delta, 0.1));
  // … replay viewer or menu backdrop
});

onRender(() => {
  const fr = frame();
  if (Math.abs(camera.aspect - fr.width / fr.height) > 1e-6) {
    camera.aspect = fr.width / fr.height;
    camera.updateProjectionMatrix();
  }
  hud.draw();
  // … chat, in-match menu or the menu screens
});
```

The pattern to copy:

- **Simulation runs in `onFixedUpdate`**, at a fixed 60 Hz.
- **Per-frame logic runs in `onUpdate`**, with `delta` capped so a stalled frame does not make
  players jump.
- **Drawing runs in `onRender`.** There is only one of each callback, so `main.ts` fans out to the
  current screen: menu, lobby, match, replay or result.

## 3. The 3D world: `starhermit:scene`

The stadium, footballers, ball and officials are ordinary three.js-style objects from
[`starhermit:scene`](../engine-api/scene.md): `Mesh`, `Group`, `MeshStandardMaterial`,
`CylinderGeometry`, `Sprite`, `CanvasTexture` and so on. Code ported from three.js mostly works
unchanged. Some details worth reading:

- [`world/stadium.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/world/stadium.ts)
  builds the pitch, stands, floodlights and fog. It sets the post effects (`renderer.bloom`,
  `renderer.grade`, `renderer.antialias`) and shadows for each graphics level.
- [`world/environment.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/world/environment.ts)
  makes an environment map with `PMREMGenerator` from a `DataTexture`.
- [`world/crest.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/world/crest.ts)
  and `world/nametags.ts` draw team crests and floating nicknames on a
  [`starhermit:canvas`](../engine-api/canvas.md) `OffscreenCanvas`, then use them as
  `CanvasTexture`s and `Sprite`s.

## 4. Thousands of moving parts: `starhermit:world`

Animating 22 footballers joint by joint, plus thousands of crowd members, would be too slow as
per-object script on the native interpreter. Football moves that work into
[`starhermit:world`](../engine-api/world.md) **tables** (rows of typed columns) and **kernels**
(functions the runtime runs over every row natively):

```ts
import { kernel, schedule, table } from "starhermit:world";

const crowd = table("crowd", CROWD_ROWS, {
  bx: "f32", by: "f32", bz: "f32", ph: "f32", fr: "f32", av: "f32",
  q: "quat", s: "f32", sy: "f32", x: "f32", y: "f32", z: "f32",
});
const sway = kernel(crowd, (r, u: { t: number; amp: number; spd: number; sway: number; shake: number }) => {
  const j = Math.sin(u.t * u.spd * r.fr + r.ph);
  r.y = r.by + (j > 0 ? j * j : 0) * u.amp * r.av;
  // …
});
// An eighth of the crowd each frame: the work is sliced across frames.
const swayRun = schedule.update(sway, { t: 0, amp: 0, spd: 0, sway: 0, shake: 0 }, { slices: 8 });
```

The footballer rigs in
[`world/rig.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/world/rig.ts)
use the same approach. A `rigs` table holds each footballer's animation state. A `joints` table,
with a `ref:rigs` column, holds 15 joints per rig, and **bindings** drive the scene nodes from it.
Two kernels scheduled after `onUpdate` compute the poses, and the runtime writes the node
transforms itself. Script work per footballer comes to about a dozen numbers a frame.

## 5. Input: actions, touch and gamepads

[`engine/src/input.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/input.ts)
reads the manifest's actions through [`starhermit:input`](../engine-api/input.md):

- `value(action)` returns how far an action is held (movement is `value("up") - value("down")`).
  `onAction` delivers press and release edges.
- Mouse look uses `requestPointerLock`, `onPointerDelta` and `onPointerLockChange`. The camera's
  right stick comes from `gamepads()`, and `vibrate` gives a short haptic tick.
- On touch screens (`primaryPointer()` is coarse), `setTouchControls` shows a joystick and
  SHOOT/PASS/TACKLE buttons drawn by the runtime. The buttons are bound to the same actions:

```ts
setTouchControls([
  { kind: "stick", up: "up", down: "down", left: "left", right: "right", anchor: "bottom-left", offset: [90, 90], radius: 66 },
  { kind: "button", action: "shoot", label: T("SHOOT").slice(0, 16), anchor: "bottom-right", offset: [66, 66], radius: 46 },
  // … PASS and TACKLE
]);
```

[`screens/controls.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/screens/controls.ts)
lists the current `bindings()` and calls `requestRebind`. The runtime then captures the new key or
button.

## 6. One simulation for client and server: `starhermit:script`

[`server.js`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/server.js)
is a plain classic script with no imports, `Date` or `Math.random`, as the platform's sandbox
requires. It defines two globals:

- `globalThis.game` holds the platform entry points (`createSession`, `onPlayerMessage`, `onTick`)
  and static declarations read at publish time:

  ```js
  globalThis.game = {
    tickRateHz: 30,
    replays: true,
    achievements: [
      { key: 'debut', name: 'Debut', description: 'Finish your first match.', points: 10 },
      { key: 'hat-trick', name: 'Hat-Trick', description: 'Score three goals in one match.', points: 50 },
      // …
    ],
    createSession: function (ctx) { /* seats, AI, seed from ctx.random */ },
    // …
  };
  ```

- `globalThis.FootballSim` holds the same simulation (`createMatch`, `stepMatch`, the AI) for the
  client.

The client loads the same file into its own realm with `loadClassic` from
[`starhermit:script`](../engine-api/script.md)
([`engine/src/sim.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/sim.ts)):

```ts
import { loadClassic } from "starhermit:script";

loadClassic("server.js");
const S = (globalThis as unknown as { FootballSim?: FootballSimApi }).FootballSim;
```

Offline practice steps `FootballSim` locally at 60 Hz with AI in every other seat. Online, the
platform runs `server.js` authoritatively at 30 Hz. The game never maintains two copies of its
rules.

## 7. Online matches: rooms and game sockets

Lobbies use the platform's rooms through [`starhermit:platform`](../engine-api/platform.md)
([`screens/lobby.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/screens/lobby.ts)):

```ts
import * as P from "starhermit:platform";

// Quick play: join any open room, or open one.
let room = await P.rooms.quickJoin();
if (!room) {
  room = await P.rooms.create({ teamCount: 2, seatsPerTeam: teamSize, backfillAfterSeconds: 30, metadata: { game: "football" } });
  room = await P.rooms.open(room.id);
}

// Ranked solo vs AI: every other seat is an AI player, so starting begins the match at once.
room = await P.rooms.create({ teamCount: 2, seatsPerTeam: teamSize, backfillAfterSeconds: 30, aiPlayers: 2 * teamSize - 1, metadata: { game: "football" } });
room = await P.rooms.start(room.id);
```

Friends, invites and seat changes go through `P.friends.list`, `P.rooms.invite`,
`P.rooms.acceptInvite` and `P.rooms.seat`. `P.rooms.mine` lets a player rejoin a match they left.

Once the match starts,
[`engine/src/net.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/net.ts)
opens the game socket with `P.connectGame(sessionId)`:

- It sends inputs at 30 Hz with `sendInput`.
- It asks for a full snapshot with `sendCommand({ type: "sync" })` on every open and on
  `resumed`.
- It listens for `game` (snapshots and events), `achievement` and `stopped`. `stopped` reports why
  the socket stopped: signed out, updated terms, or the match gone.

The runtime holds the player's credentials and reconnects by itself, so the game handles no tokens
and has no retry loop.

[`logic/interp.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/logic/interp.ts)
smooths the server's snapshots with adaptive interpolation.
[`logic/predict.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/logic/predict.ts)
predicts the local footballer's movement and corrects it toward each snapshot. Prediction affects
only what is drawn; the server stays authoritative.

## 8. The rest of the platform

| Feature | Calls | Source |
|---|---|---|
| Signed-in player, sign-in, session end | `P.player()`, `P.onPlayerChange`, `P.requestSignIn`, `P.onSessionEnded` | `platform.ts`, `main.ts` |
| Leaderboard | `P.leaderboards.list`, `P.leaderboards.entries` (board declared in `leaderboards.json`) | `screens/leaderboard.ts` |
| Achievements | Declared in `server.js`, awarded on full time, listed with `P.achievements.list` | `screens/achievements.ts` |
| Replays | `game.replays: true` in `server.js`; `P.replays.list`, `P.replays.get` | `screens/replays.ts`, `replayView.ts` |
| Text chat | `P.sessions.get` (the match's conversation), `P.chat.messages`, `P.chat.subscribe`, `P.chat.post` | `chat.ts` |
| Voice chat | `P.voice.join`, `P.voice.setVolume` and `P.voice.setPan` by distance between footballers, `P.voice.setMuted` | `voice.ts` |
| Invite links | `P.inviteLink` and `clipboard` from `starhermit:engine` | `platform.ts` |
| Bug reports | `P.reportBug` | `screens/settings.ts` |

Every call can reject with a `PlatformError`. Football treats online features as best-effort: a
failure shows "online unavailable" or falls back to silence, and never ends the game. Signed out,
the game still offers offline practice.

## 9. Menus and HUD: `starhermit:ui`, `starhermit:draw`, `starhermit:canvas`

- **Menus** (`screens/*.ts`, the in-match menu and dialogs in `main.ts`) use
  [`starhermit:ui`](../engine-api/ui.md), the engine's immediate-mode UI. Widgets are called every
  frame from `onRender`, and `ui.setTheme` gives them the game's colours. The runtime's own Options
  menu opens with `openMenu`.
- **The HUD** (
  [`hud.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/hud.ts))
  draws the scoreboard, clock and markers with [`starhermit:draw`](../engine-api/draw.md):
  `draw.roundRect`, `draw.text` and `draw.image` (a crest canvas), in call order over the scene.
- **Images** are loaded with `createImageBitmap` from [`starhermit:canvas`](../engine-api/canvas.md),
  for example the menu's key art.

## 10. Settings and languages: `starhermit:storage`, strings

- Per-player settings (mute, voice, language, graphics overrides) live in `settings` from
  [`starhermit:storage`](../engine-api/storage.md). They are kept on the device and in the account.
  `settings.onChange` applies a change made on another device.
- [`i18n.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/i18n.ts)
  loads `assets/strings.json` into the engine's `strings` tables (`strings.load`, `strings.t`,
  `strings.setLanguage`). It picks the language from the saved choice, then the player's
  StarHermit language, then the device's (`preferences`). `l10n/font.ts` loads script fonts with
  `FontFace` for languages that need them.

## 11. Sound and graphics levels

- [`audio.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/audio.ts)
  builds a Web Audio graph with [`starhermit:audio`](../engine-api/audio.md):
  - Authored clips are listed in `sfx/manifest.json` (read with `files.readJson`).
  - A synthesiser covers any event without a clip, plus the crowd and stadium reverb.
  - Short-lived nodes are released as soon as they end, because the host graph is bounded.
- [`quality.ts`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/src/quality.ts)
  follows the player's graphics level (`frame().level`, `levelSettings`). Shadows, bloom and
  anti-aliasing follow that level. The game's own content (pitch detail, crowd density, particles)
  has per-player overrides on top.

## 12. Package, test and publish

- **Type-check** with `tsc -p engine`.
  [`engine/tsconfig.json`](https://github.com/HypeDriven/starhermit-football/blob/33bd9bdc2fa6ab162b718c92b9b9657c3203c62f/engine/tsconfig.json)
  includes the release's `starhermit.d.ts` and sets `"lib": ["ES2022"]`, `"types": []` and
  `"allowImportingTsExtensions": true`.
- **Test.** `npm test` runs `server.js` regression tests. `engine/tests/run.sh` runs the logic
  tests (interpolation, prediction, pose, lobby) under Node. `starhermit <folder> --check`
  validates the package and plays 120 frames headless.
- **Package.** `starhermit package --web .` rewrites `index.html` and `starhermit-files.json`,
  which are committed with every change.
- **Publish.** The game is added on StarHermit from its repository URL. The platform reads
  `starhermit.txt`, runs `server.js` as the match script and creates the leaderboard from
  `leaderboards.json`.

To move Football, or your own game, to engine 1.41.0:

1. Download the 1.41.0 runtime.
2. Set `engine.version=1.41.0`.
3. Run the checks and package again.

Raise `engine.minor` to 41 only when you want host API 1.41's
[new features](../engine-features.md).
