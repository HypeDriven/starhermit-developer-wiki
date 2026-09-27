# Tutorial: build a multiplayer kart racer

This tutorial builds the multiplayer layer of an arcade kart racer — up to eight karts, private
lobbies with friends, quick-join with strangers, CPU drivers filling empty grid slots, a countdown,
laps, a finishing order and achievements — on the StarHermit API. It covers the netcode contract
and the platform calls; your engine, track art and handling model are your own.

Everything game-specific here — the `grand-prix` queue, the binary frame layout, the item button,
the physics constants — is an example value. Only the endpoints, frame envelopes and limits are
platform behavior, and each links to its reference page.

## 1. Pick an architecture

A racer is the hardest shape of game for a server tick budget: karts move fast, collide, and
players feel 50 ms of steering lag. StarHermit gives you two ways to run it, both starting from a
[realtime room](../api/realtime.md):

| | **A. Host-routed** | **B. Server-authoritative script** |
|---|---|---|
| Who simulates | The room host's client, at any rate it likes (60 Hz+) | Your `server=` script, at most **30 Hz** |
| Transport | Binary frames on `ws/v1/realtime` | JSON `cmd`/`game` frames on `ws/v1/games` |
| Cheating | The host is trusted | Clients have zero authority |
| Elo, script achievements | No (host posts a clamped result) | Yes — `eloUpdates`, `achievements`, replays |
| Best for | Casual races with friends, full-fidelity physics | Ranked racing with simple arcade physics |

Start with **A** unless you need ranked play; section 7 shows what changes for **B**. A
[container server](../api/container-games.md) could simulate at 60 Hz authoritatively, but container
matchmaking currently only uses the implicit 1v1 queue and room-bound sessions are script-only, so it
does not fit an eight-kart grid today.

## 2. Manifest

Publish the distributable build folder with this `starhermit.txt` at its root (see
[the manifest](../starhermit-txt.md)). The `control.*` lines give players a rebinding UI and your
client a [controls API](../api/games.md#per-player-control-bindings) to read bindings from:

```ini
name=Turbo Hermits
launch=index.html
cover=art/cover.png
control.accelerate=KeyW+ArrowUp | Accelerate
control.brake=KeyS+ArrowDown | Brake / reverse
control.left=KeyA+ArrowLeft | Steer left
control.right=KeyD+ArrowRight | Steer right
control.drift=ShiftLeft+ShiftRight | Drift
control.item=Space | Use item
```

Path A has **no** `server=` line. If a game ships a script, starting a room creates a bound session
and only the script can end the match — the host's `POST .../result` stops being the way races end
(section 7).

## 3. Sign in and read the basics

A platform-hosted game is opened with `#game_token=<jwt>` in the URL — read it once, strip it with
`history.replaceState`, and refresh it before its 60-minute expiry (details in the
[chess walkthrough](chess-walkthrough.md#3-launch-and-authentication) and
[auth](../api/auth.md)). Your slug is the token's `game_scope` claim (or `location.hostname`'s
first label); never hard-code it.

On load, fetch what the menu needs:

```http
GET /api/v1/games/{slug}/controls     # effective key bindings (manifest defaults + overrides)
GET /api/v1/games/{slug}/settings     # camera, volume, last chosen kart — your own keys
GET /api/v1/realtime/rooms/mine       # 200 → the player is still in a race; rejoin it
```

Save menu choices with `PATCH /api/v1/games/{slug}/settings` (`{"settings":{"kart":"hermit-crab"}}`).
Settings follow the player across machines and need no declaration.

## 4. The lobby

A grand prix is free-for-all, so the room has one team of eight seats. Track, lap count and engine
class go in the opaque `metadata`:

```http
POST /api/v1/realtime/rooms
Authorization: Bearer <launch token>

{ "teamCount": 1, "seatsPerTeam": 8, "backfillAfterSeconds": 45,
  "aiPlayers": 0, "name": "Friday cup", "isVisible": true,
  "metadata": { "track": "coral-loop", "laps": 3, "cc": 150 } }
```

With a launch token the room's game comes from the token, so `gameSlug` can be omitted. The creator
is the host at seat `(0, 0)`. From here the lobby is ordinary room flow:

- **Friends** — `POST /rooms/{id}/invites` with `{"toUserId": ...}`. The platform notifies them;
  accepting seats them. Show the six-character `joinCode` so friends can also type it into
  `POST /rooms/join-by-code`.
- **Strangers** — the host calls `POST /rooms/{id}/open`. Players with no room call
  `POST /rooms/quick-join` with `{"seats": 1}` and, on `404`, create and open their own.
- **Track vote / host change of mind** — `PATCH /rooms/{id}` with new `metadata` and the room's
  `revision` as `expectedRevision`.
- **Solo against CPUs** — create with `"aiPlayers": 7`, then `POST /rooms/{id}/start`.

An open room starts on its own when all eight seats fill or `backfillAfterSeconds` passes; the host
can also `POST /rooms/{id}/start`. Every still-empty seat becomes an AI participant — those are your
CPU drivers.

## 5. The race socket (host-routed)

### Connect

Every participant opens the realtime socket with a one-use ticket:

```js
const { ticket } = await api.post("/api/v1/realtime/connection-tickets"); // { ticket, expiresIn }
const ws = new WebSocket(
  `wss://api.starhermit.com/ws/v1/realtime?roomId=${roomId}&ticket=${encodeURIComponent(ticket)}`);
ws.binaryType = "arraybuffer";
```

Text frames are JSON pushes and control frames; binary frames are gameplay. The `roster` push is
your grid: after start it is frozen, AI seats included. With one team, a kart's grid slot is its
participant's `slot`.

```js
ws.onmessage = (e) => {
  if (typeof e.data === "string") return onControl(JSON.parse(e.data)); // roster, presence, event, ready, chat, result
  const bytes = new Uint8Array(e.data);
  const sender = guidFromDotNet(bytes.subarray(0, 16)); // server-stamped, trustworthy
  onGameplay(sender, new DataView(e.data, 16));          // your payload starts at byte 16
};

// The server prefixes the sender's participant id in .NET GUID byte order:
// the first three groups are little-endian.
function guidFromDotNet(b) {
  const h = (i) => b[i].toString(16).padStart(2, "0");
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-` +
         `${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}
```

Never put a player id in your own payload and trust it — the 16-byte prefix is the only identity
that the server guarantees.

### Routing and budget

The platform enforces the shape of host-routed play:

- A **guest's** binary frames reach **only the host** — that is the input channel.
- The **host's** binary frames reach **every guest** — that is the snapshot channel.
- Each frame is at most **8 KB**; each connection may send **30 messages/second** (2× burst for one
  second). Going over closes the socket with `PolicyViolation`.

So the host simulates at whatever rate feels right (60 Hz is typical) but **sends** snapshots at
20 Hz, and guests send inputs at 20 Hz. That leaves headroom for the occasional control frame.

### Frame layouts (example)

Inputs, guest → host, 7 bytes:

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | `1` = input |
| 1 | u16 | `seq` — increments every send |
| 3 | i8 | steer, −127…127 |
| 4 | u8 | throttle, 0…255 |
| 5 | u8 | bits: 0 brake, 1 drift |
| 6 | u8 | `itemPresses` — a counter, not a flag |

`itemPresses` is a running count of item-button presses. At 20 Hz a press shorter than 50 ms would
otherwise fall between samples; with a counter the host fires one item per increment, however the
presses landed.

Snapshots, host → guests, 4 + 22 bytes per kart (176 bytes for a full grid):

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | `2` = snapshot |
| 1 | u16 | host tick |
| 3 | u8 | kart count |
| per kart | u8, f32 ×4, u8, u16, u8, u8 | slot, x, z, heading, speed, lap, checkpoint, item, flags |

Guests render other karts **~100 ms in the past**, interpolating between the two snapshots that
bracket that time, and predict their own kart locally from their inputs, easing toward the host's
position when they disagree. Include the last input `seq` the host applied per kart in `flags` or an
extra field if you want exact reconciliation.

### Countdown, race events, finish

Control frames are JSON, at most 4 KB, and the server stamps `from` with the sender's participant id:

- Guests send `{"type":"ready"}` once the track has loaded.
- The host waits for every connected human to be ready (or a timeout), then sends
  `{"type":"event","kind":"countdown","goInMs":3000}`. Guests start their local countdown on
  receipt — no clock sync needed at this precision.
- Other race beats are also `event` frames: `{"kind":"lap","slot":3,"lap":2}`,
  `{"kind":"finished","slot":3,"place":1,"timeMs":94210}`.
- `chat` is available to everyone, but guests are limited to 10 control frames a minute — plenty for
  `ready` and a few "gg"s, not for gameplay.

When the last human crosses the line (or a timer after the winner runs out), the host submits the
result, which closes the room and pushes `{"type":"result"}` to everyone:

```http
POST /api/v1/realtime/rooms/{id}/result

{ "teamScores": [0],
  "metadata": { "track": "coral-loop",
                "order": [ { "slot": 3, "timeMs": 94210 }, { "slot": 0, "timeMs": 95002 } ],
                "bestLapMs": 30112 } }
```

`teamScores` needs exactly one entry per team (clamped 0–50), which carries nothing useful in a
free-for-all; the finishing order lives in `metadata`. A team race is the same room with
`teamCount: 2` and each team's points in `teamScores`.

### CPU drivers, leavers and host changes

- **AI seats are yours to drive.** The platform reserves the seat and names the driver; the host's
  simulation steers it (a racing line through the checkpoints, with some rubber-banding).
- **A guest who leaves mid-race** (`POST /rooms/{id}/leave`) keeps their kart on the grid: the roster
  push shows the same participant `id` now `isAi: true`, and the host's CPU takes over that kart.
- **A guest who drops** is still in the room; keep their kart coasting and let them reconnect —
  the newest socket supersedes the old one.
- **If the host leaves**, the host role passes to the longest-joined remaining human and the
  roster push shows the new `isHost`. Every guest already holds the latest full snapshot, so the new
  host resumes the simulation from it and starts sending snapshots; guest inputs now route to them.
  Host migration is your code's job — the platform only moves the role.
- **If the host just disconnects**, the room closes after 60 seconds without a host socket.

## 6. Around the race

- **Voice and chat.** Every guest can already `chat` on the realtime socket; for voice, see
  [Voice](../api/voice.md).
- **Rematch.** The room is closed after the result. Have the host create a new room and invite the
  previous roster's humans, or send everyone back to quick-join.
- **Lap-time leaderboards.** A game's platform leaderboard is its elo board, written only by a server
  runtime. A publisher-defined leaderboard accepts `POST /api/v1/leaderboards/{id}/submit`, but that
  score is claimed by the client — fine for a friendly time trial, not for anything with prizes.

## 7. Variant B: server-authoritative racing

For ranked play, move the simulation into a script. The lobby is unchanged; add the script and
matchmaking settings to the manifest:

```ini
server=server.js
matchmaking.max_wait_seconds=20
matchmaking.ai_players=7
```

Now two things create races: **starting a room** creates a room-bound session for its humans, and
**matchmaking** (`POST /api/v1/games/{slug}/matchmaking?queue=grand-prix`) creates one when eight
players are found — or, with the settings above, after 20 seconds with CPUs in up to seven empty
seats. A lobby of friends can queue together with `POST /realtime/rooms/{id}/matchmake`.

Either way, clients take the `sessionId` (the room's `gameSessionId`, or the matched ticket's) and
play over `ws/v1/games?sessionId=…`. The realtime socket, if any, is kept for the roster only.

### The script

The whole simulation runs in `onTick` at the 30 Hz ceiling. Each invocation is a fresh sandbox that
gets `sessionState` in and returns it out, so keep that state small — it is serialized every tick.

```js
const TRACK = { laps: 3, radius: 14,
  checkpoints: [[0, 0], [120, 0], [160, 60], [120, 120], [0, 120], [-40, 60]] };

globalThis.game = {
  tickRateHz: 30,
  replays: true,
  queues: [{ key: "grand-prix", teams: 8, teamSize: 1 }],
  achievements: [
    { key: "chequered-flag", name: "Chequered Flag", description: "Win a race.", points: 10 }
  ],

  createSession(ctx) {
    const karts = racers(ctx).map((r, i) => ({
      id: r.id, name: r.name, ai: r.ai, x: -8 * (i % 2), z: -6 * i, heading: 0, speed: 0,
      cp: 1, lap: 0, boost: 0, boosts: 1, input: {}, finishedAt: null
    }));
    return { ok: true, sessionState: { t: ctx.now, goAt: ctx.now + 4000, karts, order: [] } };
  },

  onPlayerMessage(ctx) {                       // durable commands: discrete actions
    const s = copy(ctx.sessionState);
    const k = s.karts.find((k) => k.id === ctx.message.from);
    if (ctx.message.data?.type === "use-item" && k && k.boosts > 0 && ctx.now >= s.goAt) {
      k.boosts--; k.boost = 1.2;
    }
    return { ok: true, sessionState: s };
  },

  onTick(ctx) {
    const s = copy(ctx.sessionState);
    const dt = Math.min(Math.max((ctx.now - s.t) / 1000, 0), 0.1);
    s.t = ctx.now;
    for (const i of ctx.inputs || []) {        // latest realtime input per player since last tick
      const k = s.karts.find((k) => k.id === i.from);
      if (k) k.input = i.data;
    }
    if (ctx.now >= s.goAt) {
      for (const k of s.karts) if (!k.finishedAt) step(k, k.ai ? aiInput(k) : k.input, dt, s, ctx);
    }
    const snap = s.karts.map((k) => [k.id, r1(k.x), r1(k.z), r2(k.heading), r1(k.speed), k.lap, k.cp]);
    const out = { ok: true, sessionState: s,
      broadcast: [{ to: "all", data: { type: "snap", t: s.t, goAt: s.goAt, karts: snap } }] };
    if (raceOver(s, ctx)) Object.assign(out, finish(s, ctx));
    return out;
  }
};
```

The helpers are ordinary game code. The parts the platform cares about:

- **`racers(ctx)`** reads the grid from whichever start the session had: `ctx.room.roster` for a
  room (AI seats have `userId: null`, so give them ids like `ai-0-5`), `ctx.matchmaking.seats` for a
  matchmade race (skip seats with `id: null`), else `ctx.players`.
- **`step(k, input, dt)`** must **clamp every input value** — `steer` to −1…1, `throttle` to 0…1 —
  because `ctx.inputs[].data` is whatever the client sent. Only `from` is trusted.
- **Randomness and time** come from `ctx.random` and `ctx.now`; there is no `Date` or `Math.random`.
- **`finish(s, ctx)`** returns `result` (which ends the session and, for a room, closes it),
  `achievements` for the winner if human, and `eloUpdates` for human racers — for example pairwise
  elo across the finishing order, read from and written back to `ctx.playerStates`. AI seats cannot
  receive player state, ratings or achievements.
- **`raceOver`** should also end races nobody can finish — every human gone according to
  `ctx.presence` (rooms), or a hard time limit.
- **Replays** keep only the *final* `sessionState`. Keep a compact lap-time table and finishing
  order in it, not a per-tick position log.

### The client

Send steering as a realtime input every tick and discrete actions as durable commands:

```js
// ~30 Hz: latest-wins, batched into the next onTick
send({ type: "cmd", data: { type: "input", realtime: true, seq: ++seq,
                            steer, throttle, brake, drift } });

// on key press: a durable command, runs onPlayerMessage immediately
send({ type: "cmd", data: { type: "use-item" } });
```

Items **must** go through a durable command. Realtime inputs are latest-wins between ticks, and the
platform preserves only the one-shot fields `pass`, `tackle` and `shoot` when a newer sample
replaces an older one — any other button in a realtime input can be overwritten before the tick
sees it.

Render other karts ~100 ms behind the latest `snap`, interpolating. For your own kart, run the same
`step` function locally and correct toward the server's position; exposing the physics from
`server.js` as a second global (the way chess exposes `globalThis.chessRules`) keeps the client and
server stepping identical code. `achievement` frames arrive on the same socket; read
`GET /api/v1/games/{slug}/achievements` on load for anything granted before it opened.

## Checklist

- [ ] `starhermit.txt` at the root of the build output, with `control.*` for the kart actions.
- [ ] Launch token read from the hash, stripped, refreshed; slug from `game_scope`.
- [ ] `GET /realtime/rooms/mine` on load to rejoin a race in progress.
- [ ] One-team room, track in `metadata`; invites, join codes, open + quick-join, solo with `aiPlayers`.
- [ ] Socket opened with a connection ticket; 16-byte sender prefix stripped and used as identity.
- [ ] Host snapshots and guest inputs at ≤ 20 Hz each, frames ≤ 8 KB; item presses as a counter.
- [ ] Ready → countdown → race events as control frames; result with the order in `metadata`.
- [ ] Host drives AI seats and leavers' karts; the new host resumes from the last snapshot.
- [ ] Variant B: `tickRateHz: 30`, clamped inputs, items as durable commands, `result` + `eloUpdates`.

## See also

- [Realtime rooms](../api/realtime.md) — lobbies, seats, the `ws/v1/realtime` contract
- [Game scripts](../api/game-scripts.md) — tick rate, realtime inputs, room-bound sessions
- [Games](../api/games.md) — matchmaking, controls, settings, the gameplay socket
- [`starhermit.txt`](../starhermit-txt.md) — controls, matchmaking deadlines, AI seats
