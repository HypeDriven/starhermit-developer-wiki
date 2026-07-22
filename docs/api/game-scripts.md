# Game Scripts

Every StarHermit game is defined by a **single JavaScript file** executed server-side in a sandboxed [Jint](https://github.com/sebastienros/jint) engine. The script is the sole authority on the game's rules: it validates every player command, mutates state, decides what each client may see, computes Elo, and ends games. Clients have zero authority. This page documents the script contract every game implements; for the REST/WebSocket surface that clients use, see [Games API](games.md). The worked example throughout is chess — the reference implementation at [HypeDriven/starhermit-chess](https://github.com/HypeDriven/starhermit-chess).

## Execution model

- One JS file per game, executed in a **fresh sandboxed Jint engine per invocation**. Nothing persists in memory between calls — all state lives in the documents you return.
- No `Date` access, no own RNG. Clock and randomness come from the host: `ctx.now` (ms epoch) and `ctx.random` (float in `[0, 1)`).
- The platform invokes the script when a player sends a command, when a session is created, and on periodic `onTick` sweeps (see [Games API — Tick service](games.md#tick-service)).

## Entry points

Expose three functions on `globalThis.game`:

```js
globalThis.game = {
  createSession(ctx) { /* ... */ },
  onPlayerMessage(ctx) { /* ... */ },
  onTick(ctx) { /* ... */ }
};
```

- `createSession(ctx)` — called when a session is created (matchmaking, invite-accept, or AI practice).
- `onPlayerMessage(ctx)` — called for every client command received over the gameplay WebSocket.
- `onTick(ctx)` — called by the platform's timer service (per-game default every 300 s; platform sweep default 60 s, min 15 s).

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
  }
}
```

- The AI seat (if present) is flagged with `ai: true` on its player entry.
- **Trust nothing from `ctx.message.data`.** The only trusted identity is `ctx.message.from`, which the server attaches from the authenticated connection — the client can never supply or spoof it.

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
  result: { kind: "white-win", reason: "checkmate" }  // ends the session (example: a chess result)
};
```

Key rules:

- `sessionState` and each entry of `playerStates` **replace** the stored documents — always return complete documents, never diffs.
- Only messages listed in `broadcast` are delivered to clients, each addressed to explicit player ids or `"all"`. Nothing else leaks.
- `eloUpdates` is the only way ratings change. The host denormalizes them onto `GamePlayerState.Elo` and publishes them to the game's leaderboard; clients can never submit scores directly (see [Leaderboards](leaderboards.md)).
- End games via `result`. The host then finishes the session and **archives the final `sessionState` as the replay** (served by `GET .../replays/{sessionId}` — see [Games API](games.md#replays)).

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
