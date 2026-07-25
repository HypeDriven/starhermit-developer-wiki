# Game Scripts

Every StarHermit game is defined by a **single JavaScript file** executed server-side in a sandboxed [Jint](https://github.com/sebastienros/jint) engine. The script is the sole authority on the game's rules: it validates every player command, mutates state, decides what each client may see, computes Elo, and ends games. Clients have zero authority. This page documents the script contract every game implements; for the REST/WebSocket surface that clients use, see [Games API](games.md). The worked example throughout is chess — the reference implementation at [HypeDriven/starhermit-chess](https://github.com/HypeDriven/starhermit-chess).

## Execution model

- One JS file per game, executed in a **fresh sandboxed Jint engine per invocation**. Nothing persists in memory between calls — all state lives in the documents you return.
- No `Date` access, no own RNG. Clock and randomness come from the host: `ctx.now` (ms epoch) and `ctx.random` (float in `[0, 1)`).
- The platform invokes the script when a player sends a durable command, when a session is created, and on periodic `onTick` sweeps (see [Games API — Tick service](games.md#tick-service)). Realtime `{type:"input", realtime:true}` frames are the exception: they are buffered latest-wins and delivered as a batch to the next tick.

## Entry points

Expose the handlers on `globalThis.game`. Two optional **static** declarations sit alongside them:
`tickRateHz` asks the platform how often to invoke `onTick` (see [Tick rate](#tick-rate)), and
`achievements` registers the game's achievements (see [Achievements](#achievements)):

```js
globalThis.game = {
  tickRateHz: 0, // turn-based: opt out of periodic ticks
  achievements: [
    { key: "first-win", name: "First Win", description: "Win a match.", points: 10 }
  ],
  createSession(ctx) { /* ... */ },
  onPlayerMessage(ctx) { /* ... */ },
  onTick(ctx) { /* ... */ }
};
```

Both declarations are read by evaluating your script **at provision time** (when the game is added
or re-added from its repo), not on every invocation — so they must be static values on the `game`
object, and a change to either needs a re-provision to take effect.

- `createSession(ctx)` — called when a session is created (matchmaking, invite-accept, AI practice, or a realtime room starting — see [Room-bound sessions](#room-bound-sessions)).
- `onPlayerMessage(ctx)` — called for durable client commands received over the gameplay WebSocket. Inputs explicitly marked `realtime:true` bypass this entry point.
- `onTick(ctx)` — called by the platform's timer service at the effective tick rate; latest realtime inputs are available in `ctx.inputs`. A game resolving to 0 Hz does not receive periodic calls, but the function should still be present to satisfy the script contract.

## Context object

```js
ctx = {
  now: 1721473200000,              // ms epoch, from the host clock
  random: 0.7231,                  // float in [0, 1), from the host RNG
  sessionId: "0f8fad5b-...",       // current session id
  players: [                       // session participants
    { id: "7c9e6679-...", name: "alice" },
    { id: "00000000-0000-4000-8000-00000000a1a1", name: "The House", ai: true }
  ],
  sessionState: { /* ... */ },     // this script's session document, or null
  playerStates: {                  // per-player documents (elo, history), or null
    "7c9e6679-...": { elo: 1200, wins: 4, losses: 2, draws: 1, /* ... */ }
  },
  message: {                       // onPlayerMessage only
    from: "7c9e6679-...",          // the authenticated user id — trusted
    data: { type: "move", from: "e2", to: "e4" }  // client payload — untrusted (example: a chess move)
  },
  inputs: [                        // onTick only; omitted when none are pending
    { from: "7c9e6679-...",        // authenticated sender id — trusted
      data: { type: "input", seq: 42, mx: 0.7, mz: -0.2 } }
  ]
}
```

- The AI seat (if present) is flagged with `ai: true` on its player entry.
- Room-bound sessions (started from a realtime room) get two additional ctx fields, `ctx.room` and `ctx.presence`, on **every** invocation — see [Room-bound sessions](#room-bound-sessions).
- **Trust nothing from `ctx.message.data` or `ctx.inputs[].data`.** The trusted identity is the corresponding `from`, which the server attaches from the authenticated connection — the client can never supply or spoof it.
- Inputs opt into batching with `{type:"input", realtime:true, ...}`. Unmarked `input` commands remain durable `onPlayerMessage` calls for backward compatibility. Realtime inputs use one pending slot per sender: movement is latest-wins, while `pass`, `shoot`, and `tackle` action edges are merged so a following movement sample cannot erase them before the next tick. Scripts must clamp and validate every value when consuming the batch.

## Tick rate

The platform runs `onTick` sweeps per active session at a configurable rate. **Your script asks for the rate it wants** by declaring a static `tickRateHz` on the game object, alongside the entry points:

```js
globalThis.game = {
  tickRateHz: 15,          // ask the platform to tick this game 15x/second
  createSession(ctx) { /* ... */ },
  onPlayerMessage(ctx) { /* ... */ },
  onTick(ctx) { /* ... */ }
};
```

- The declaration is read **when your script is provisioned** (when you add or re-add the game from its repo), not on every tick. Change it and re-add the game to apply it.
- It is **clamped to `0`–the platform maximum** (`games.max_tick_rate_hz`, **30 Hz** by default): ask for less than the maximum and you get it; ask for more and you run at the maximum. Ask for **0** and the game is never ticked at all — the right choice for a turn-based game that only reacts to player commands, since it costs the platform nothing. The value is floored to a whole Hz; anything that isn't a number (or a missing declaration) leaves the game on the default.
- Because only the request is stored, lowering the platform maximum immediately slows every game that asked for more — no re-provisioning needed.
- A platform operator can set `GameDefinition.TickRateHz` for your game from the admin dashboard. That override **wins over your declaration and may exceed the global maximum** (only the hard 1–1000 Hz platform ceiling applies) — it is how a game is granted a higher rate than the default allows.
- The scheduler follows the fastest active game and ticks each session at its own rate; games resolving to 0 Hz are skipped entirely.
- Each tick still uses a fresh engine and round-trips `sessionState`, but high-rate realtime `input` messages are held in an in-memory mailbox rather than invoking Jint or persisting state individually. A 30 Hz realtime match therefore normally invokes its script 30 times per second regardless of how many players are sending movement.
- Match snapshots are sent through per-connection latest-wins queues: a slow recipient may skip an obsolete snapshot but cannot delay the simulation or other recipients. Discrete events remain ordered reliable sends.

## Room-bound sessions

A session can be **bound to a realtime room** (`GameSession.RealtimeRoomId`, mirrored by `RealtimeRoom.GameSessionId`): when a [realtime room](realtime.md) for a game with a `server=` script starts, the platform creates one N-player session for the room — one `GameSessionPlayer` per **human** participant (AI seats are not session players; they exist only in the script-facing roster). This is how server-authoritative realtime games (e.g. football) run: rooms provide the lobby/matchmaking, the script runs the match. See [Realtime Rooms — the bridge](realtime.md#room-bound-scripted-sessions) for the room-side lifecycle.

Every invocation (`createSession`, `onPlayerMessage`, `onTick`) of a room-bound session receives two extra ctx fields:

```js
ctx.room = {
  roomId: "0f8fad5b-...",
  metadata: { /* ... */ },        // the room's opaque config.metadata blob
  roster: [                       // frozen match roster, humans AND AI seats,
    { userId: "7c9e6679-...",     //   ordered by team then slot
      name: "alice", team: 0, slot: 0, ai: false },
    { userId: null,               // AI seat — never a session player
      name: "Rafa Vento", team: 0, slot: 1, ai: true }
  ]
};
ctx.presence = {                  // every user who is or was a human participant
  "7c9e6679-...": { online: true, left: false }
};
```

- `presence.online` — the user has a live socket on either connection registry (realtime rooms **or** `ws/v1/games`).
- `presence.left` — the user no longer holds an active seat: they explicitly left and their seat was converted to an AI participant. `left` is permanent; `online` may flap. The script is expected to drive AI takeover / rejoin logic from these flags.
- The roster is re-read on every invocation, so seat conversions (human → AI) show up as they happen.

When a room-bound script returns `result`, the platform finishes the session, **stores the result on the room, and closes the room** — no host-submitted result is involved.

## Return shape

Every entry point returns the same shape (all fields optional except `ok`):

```js
return {
  ok: true,                        // false on failure
  error: "Illegal move",           // goes only to the sender (as a WS "error" frame)
  sessionState: { /* ... */ },     // REPLACES the stored session document
  playerStates: {                  // REPLACES stored per-player documents
    "7c9e6679-...": { elo: 1216, /* ... */ }
  },
  broadcast: [                     // only these messages ever reach clients
    { to: "all", data: { type: "moved", /* ... */ } },
    { to: ["9b2f8c1a-..."], data: { type: "state", /* ... */ } }
  ],
  eloUpdates: {                    // published to the game's leaderboard by the host
    "7c9e6679-...": 1216,
    "9b2f8c1a-...": 1184
  },
  achievements: {                  // server-authoritative unlocks, by player id
    "7c9e6679-...": ["first-win", "flawless"]
  },
  result: { kind: "white-win", reason: "checkmate" }  // ends the session (example: a chess result)
};
```

Key rules:

- `sessionState` and each entry of `playerStates` **replace** the stored documents — always return complete documents, never diffs.
- Only messages listed in `broadcast` are delivered to clients, each addressed to explicit player ids or `"all"`. Nothing else leaks.
- `eloUpdates` is the only way ratings change. The host denormalizes them onto `GamePlayerState.Elo` and publishes them to the game's leaderboard; clients can never submit scores directly (see [Leaderboards](leaderboards.md)).
- `achievements` is the only way achievements are granted. Keys are resolved against the game's own declaration and persisted by the platform — see [Achievements](#achievements).
- End games via `result`. The host then finishes the session and **archives the final `sessionState` as the replay** (served by `GET .../replays/{sessionId}` — see [Games API](games.md#replays)).

## Achievements

Your script is the **only** thing that can unlock your game's achievements. There is no client
endpoint for them: `POST /api/v1/me/achievements/unlock` rejects game-scoped achievements outright,
and the publisher CRUD endpoints refuse to touch them. This makes achievements as server-
authoritative as the rest of the game, and it is the mechanism **any** game with a `server=` script
should use — including one whose gameplay runs elsewhere (see
[which games can use this](achievements.md#which-games-can-use-this)).

### Declare

A static `achievements` array on the `game` object. Only `key` is required:

```js
globalThis.game = {
  achievements: [
    { key: "first-win", name: "First Win", description: "Win a match.", points: 10 },
    { key: "flawless",  name: "Flawless",  description: "Win without conceding.",
      points: 50, secret: true, icon: "https://cdn.example/flawless.png" }
  ],
  // ...entry points
};
```

| Field | Type | Notes |
|---|---|---|
| `key` | string | **Required.** Stable id, ≤ 128 chars, unique within the game. Duplicates after the first are ignored. |
| `name` | string | Defaults to `key`. |
| `description` | string | Defaults to `""`. |
| `icon` | string | Optional URL. |
| `secret` | boolean | Hidden from a player until *they* unlock it. Defaults to `false`. |
| `points` | number | Clamped to 0–10000. Defaults to `0`. |

The array is read at provision time and mirrored into the platform's definition registry:

- Definitions **upsert by `key`** — editing a name, icon, points, or secret flag and re-provisioning updates the existing definition, and everyone who already earned it keeps it.
- A key you stop declaring is deleted **only while nobody has unlocked it**. Earned history is never destroyed, so a retired achievement stays visible to the players who hold it.
- At most **100** achievements per game; extras beyond that are dropped.
- The declaration is **best effort**: a malformed entry is skipped and a script that fails to evaluate yields an empty list rather than failing the provision. Always confirm with `GET /api/v1/games/{slug}/achievements` after re-provisioning.

### Unlock

Return an `achievements` map from **any** entry point — `createSession`, `onPlayerMessage`, or
`onTick`:

```js
onTick(ctx) {
  const state = JSON.parse(JSON.stringify(ctx.sessionState));
  const unlocks = {};
  for (const p of ctx.players) {
    if (!p.ai && state.scores[p.id] >= 10) unlocks[p.id] = ["ten-points"];
  }
  return { ok: true, sessionState: state, achievements: unlocks };
}
```

- Unlocks are **idempotent** — re-asserting a key the player already holds is a no-op, so a script can safely award from a condition it re-evaluates on every tick instead of tracking "already awarded" in its own state.
- Unknown keys (not in your declaration), users who are not participants of this session, and the AI seat are silently ignored.
- At most **32** keys are accepted per player per invocation; further keys in the same array are dropped.
- Rows are persisted with the rest of the invocation's writes, so an unlock cannot survive a failed invocation.

### Delivery

Each newly granted unlock is pushed to the earning player over `ws/v1/games` as a distinct frame —
it is platform truth, not one of your `broadcast` messages:

```json
{ "type": "achievement",
  "data": { "key": "first-win", "name": "First Win", "description": "Win a match.",
            "icon": null, "points": 10, "unlockedAt": "2026-07-25T09:14:02Z" } }
```

Unlocks granted from `createSession` land before any socket exists, so they arrive with no frame —
clients should read `GET /api/v1/games/{slug}/achievements` on load and treat the frame as the
live-update path. Full surface in [Achievements](achievements.md).

## Budgets

Scripts run under operator-tunable budgets:

- ~250 ms CPU per invocation
- 32 MB memory
- A statement cap per invocation
- A per-player state byte budget — all state documents must stay serializable and small

The chess reference script keeps its documents small on purpose — as an example of staying within budget, its per-player doc is

```js
{
  elo: 1200,
  wins: 0, losses: 0, draws: 0,
  lastColorVs: "9b2f8c1a-...",        // for color alternation on rematch
  lastColorOrder: "w",
  recentGames: [ /* up to 30 summaries */ ]
}
```

The concurrent-session cap is 20 per player by default.

## The platform-readable window

Everything in `sessionState` is opaque to the platform **except** one field:

```js
sessionState.summary = {
  turnPlayerId: "7c9e6679-...",
  deadline: "2026-07-21T14:03:11Z",
  status: "active",
  moveCount: 41
};
```

`GET /api/v1/games/{slug}/sessions/mine` reads `summary` to compute `myTurn` and `deadline` for the caller. Keep it accurate on every state change; keep everything else wherever your script likes.

## Worked example: the chess script

Everything in this section is specific to the chess reference implementation — the state shape, board encoding, command set, game-over reasons, Elo constant, AI, and timeouts below are chess's own choices, defined in its script. None of it is platform behavior; your game defines its own equivalents.

Session state:

```js
{
  white: "7c9e6679-...",
  black: "9b2f8c1a-...",
  aiId: "00000000-0000-4000-8000-00000000a1a1",   // present in AI games
  game: {
    board: "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR", // 64 chars
    turn: "w",
    castling: { K: true, Q: true, k: true, q: true },
    epSquare: null,
    halfmoveClock: 0,
    fullmove: 1,
    moves: [ { from: "e2", to: "e4", promo: null, san: "e4", at: 1721473200000 } ],
    positionCounts: { /* fen-key: count, for threefold repetition */ },
    status: "active"
  },
  createdAt: 1721473200000,
  deadline: 1721559600000,
  result: null,
  drawOfferBy: null,
  summary: { turnPlayerId: "...", deadline: "...", status: "active", moveCount: 1 }
}
```

Board encoding: a 64-character string where `index = rank * 8 + file` and `a1` is index 0. `PNBRQK` are white pieces, `pnbrqk` black, `.` is an empty square.

Commands handled by `onPlayerMessage`: `sync`, `move`, `resign`, `offer-draw`, `accept-draw`, `decline-draw` (wire shapes in [Games API](games.md#example-chess-command-shapes)).

Game-over `reason` values: `checkmate`, `stalemate`, `threefold-repetition`, `fifty-move-rule`, `insufficient-material`, `resignation`, `agreement`, `timeout`, `timeout-no-moves`.

Other chess specifics:

- **Elo** uses K=32, computed in `finishGame` when a game ends, and returned via `eloUpdates`.
- **AI play:** when the AI seat is to move, `aiReply` plays **"hal"** — a greedy material-capture engine — inside the same invocation. There is no external bot.
- **Timeouts:** `onTick` adjudicates the 24-hour move clock — if no moves have been played the game is a `timeout-no-moves` draw; otherwise the player to move loses by `timeout`.

## Deployment

Declare the script in your game repository's `starhermit.txt` manifest:

```
server=server.js
```

Publishing flows through the GitHub integration — see [GitHub Games](github-games.md). The platform executes the script; scripts and their budgets are managed by the platform operator.

## Best practices

- **Validate every command.** Treat `ctx.message.data` as hostile: check types, ranges, turn order, and game status before touching state.
- **Keep invocations fast and state small.** You have ~250 ms and a byte budget per player doc; the chess reference script, for example, caps `recentGames` at 30 entries for this reason.
- **Use `ctx.now` / `ctx.random` only.** No `Date`, no `Math.random` — the host owns the clock and the dice.
- **Design `broadcast` messages as the only client contract.** Clients must be able to render the entire game from what the script sends; anything not broadcast does not exist for them.
- **One file, two surfaces.** The same file can double as client-side rules via a separate export: the chess reference implementation, for example, exposes `globalThis.chessRules` for the browser (move preview, validation hints) and `globalThis.game` for the host. One source of truth, zero authority on the client.
- **Always end games via `result`** so the platform archives the replay and publishes Elo updates.

See the [Chess Walkthrough](../tutorials/chess-walkthrough.md) for a line-by-line tour, and [AI Prompts](../tutorials/ai-prompts.md) for help generating your own script.
