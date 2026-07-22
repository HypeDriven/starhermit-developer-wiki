# How the reference chess game uses StarHermit, feature by feature

The [starhermit-chess](https://github.com/HypeDriven/starhermit-chess) repository is the canonical reference implementation of a platform-hosted StarHermit game: a correspondence-chess game (24 hours per move, elo-rated) built as a no-build static browser game in vanilla HTML/JS/CSS. This tutorial walks the game's lifecycle — publish, launch, menu, matchmaking, play, chat, voice, ratings, replays — and for each feature shows the exact calls the reference client makes and the file that makes them.

Read it alongside the API reference pages it links to. If you are building your own game, the checklist at the end condenses everything into what you need to replicate.

## 1. What the reference implementation is

The repo is a plain static site — no bundler, no framework, no build step:

| File | Role |
| --- | --- |
| `index.html` | The whole page: board, menu, chat, voice UI, plus a local-dev auth panel |
| `app.js` | App bootstrap, main menu, matchmaking, invites, replays, profiles |
| `net.js` | HTTP layer: scoped game paths, launch tokens, token refresh |
| `game.js` | In-game controller: gameplay WebSocket, chat, voice |
| `ui.js` | Board and menu rendering |
| `style.css` | Styles |
| `server.js` | The rules — see below |
| `starhermit.txt` | Publish manifest |

`server.js` deserves special attention. It is **both** things at once:

- The **server-authoritative script** the platform executes (via its Jint host) by exposing `globalThis.game`. Every move is validated here, on the server, per the contract in [game-scripts.md](../api/game-scripts.md).
- The client's **shared rules engine**, exposed as `globalThis.chessRules`, which the browser uses for board rendering, move previews, and replay playback.

One file, one source of truth, **zero rules authority on the client**. The client never decides whether a move is legal — it renders what the server broadcasts. This is the single most important architectural idea in the reference game.

## 2. Publishing

Publishing starts with the `starhermit.txt` manifest at the repo root. It declares the game's `name`, `slug`, `launch` entry point, `owner`, and `server` script:

```text
name=StarHermit Chess
slug=chess
launch=index.html
owner=HypeDriven
server=server.js
```

The platform clones the repo, serves the static files at `<slug>.starhermit.com` (so `chess.starhermit.com`), and proxies `/api` and `/ws` to the backend **same-origin**. That one decision removes an entire category of work: no CORS, no API-base configuration, no environment detection — the client just uses relative paths.

Full flow: [github-games.md](../api/github-games.md) and [publisher.md](../api/publisher.md).

## 3. Launch & auth

A player never logs in inside the game. The platform launcher handles it:

1. The launcher calls `POST /api/v1/games/chess/launch-token` with the user's full platform JWT.
2. It gets back a short-lived, **game-scoped** token:

```json
{ "token": "<jwt>", "expiresInSeconds": 3600 }
```

3. It opens the game at `index.html#game_token=<jwt>`, optionally with `&session_id=<guid>` appended for invite deep-links.

The client reads the hash **once**, then strips it with `history.replaceState` so the token never lingers in the URL bar or history (`app.js`, `App.init`). It decodes the JWT payload for two claims:

- `sub` — the user's id
- `game_scope` — the game slug

That second claim matters: **the client never hard-codes `"chess"`**. Every API URL is built as `/api/v1/games/<slug>` plus a suffix (`net.js`, `Net.gamePath`), so the same code works for any game, any slug, any deployment.

**Refresh.** The scoped token is allowed to re-call `launch-token` for its own game, so the client refreshes every 45 minutes (`net.js`, `Net.startRefresh`) — comfortably inside the 60-minute lifetime.

**Local dev fallback.** When there is no `#game_token` in the hash, `index.html` shows an auth panel that takes a user JWT, a slug, and an optional API base, and calls `Net.launchToken(jwt, slug)` itself. Two storage keys drive this: `localStorage['chess.apiBase']` and `sessionStorage['chess.gameToken']`. This is how you test against a backend running at `http://localhost:5000` (or `5050` in some local setups) without the launcher.

Auth reference: [auth.md](../api/auth.md), [games.md](../api/games.md).

## 4. Main menu data

When the menu loads (`app.js`, `refreshMenu`), the client fires a small batch of GETs:

**Game info + my stats:**

```http
GET /api/v1/games/chess
```

```json
{
  "slug": "chess",
  "name": "StarHermit Chess",
  "enabled": true,
  "leaderboardId": "<guid>",
  "maxConcurrentSessionsPerPlayer": 20,
  "me": {
    "userId": "<guid>",
    "elo": 1420,
    "wins": 31,
    "losses": 18,
    "draws": 4,
    "activeSessionCount": 3
  }
}
```

The `me` block is the entire player card — elo, record, and how many of the 20 allowed concurrent sessions are in use.

**My sessions:**

```http
GET /api/v1/games/chess/sessions/mine
```

```json
[
  {
    "sessionId": "<guid>",
    "status": "active",
    "players": [ /* ... */ ],
    "createdAt": "…",
    "finishedAt": null,
    "myTurn": true,
    "deadline": "…"
  }
]
```

`myTurn` and `deadline` are what make a correspondence game's session list useful — the player sees at a glance which games are waiting on them and when each move is due.

**Friends leaderboard:**

```http
GET /api/v1/leaderboards/{leaderboardId}/entries?friendsOnly=true&page=1&pageSize=10
```

using the `leaderboardId` from the game-info response.

**Recent replays:**

```http
GET /api/v1/games/chess/replays/mine?limit=10
```

**Pending invites:**

```http
GET /api/v1/games/chess/invites
```

References: [games.md](../api/games.md), [leaderboards.md](../api/leaderboards.md).

## 5. Getting into a game — three ways

There is no "create lobby" endpoint. Sessions are created **only** by matchmaking, invite-accept, or the AI endpoint.

### a. Matchmaking

`App.startMatchmaking` in `app.js`:

```http
POST /api/v1/games/chess/matchmaking
```

The response is either a ticket:

```json
{ "ticketId": "<guid>", "status": "queued" }
```

or an immediate match:

```json
{ "status": "matched", "sessionId": "<guid>" }
```

While queued, the client polls `GET /api/v1/games/chess/matchmaking` every 3 seconds; `DELETE /api/v1/games/chess/matchmaking` cancels the ticket. After 30 seconds unmatched, a **"Play against hal"** button appears, and `POST /api/v1/games/chess/sessions/ai` returns `{ "sessionId" }` — the player is never stuck staring at a spinner.

### b. Friend invite

`App.inviteFriend` in `app.js`. First list friends — this endpoint is explicitly allowed for game-scoped tokens:

```http
GET /api/v1/me/friends
```

Then send the invite:

```http
POST /api/v1/games/chess/invites
{ "toUserId": "<guid>" }
```

The recipient accepts (or declines) from their own client:

```http
POST /api/v1/games/chess/invites/{id}/accept   → { "sessionId": "<guid>" }
POST /api/v1/games/chess/invites/{id}/decline  → 204
```

Accepting is what creates the session. The `&session_id=` launch-hash deep-link (§3) drops the invited player straight into it.

### c. The rule

Sessions are created only by matchmaking, invite-accept, or `sessions/ai`. Design your lobby UI around those three doors — don't go looking for a lobby-creation call, because there isn't one.

## 6. Playing

This is `game.js`, `GameController`.

**Fetch the session:**

```http
GET /api/v1/games/chess/sessions/{sessionId}
```

```json
{
  "sessionId": "<guid>",
  "status": "active",
  "players": [ /* ... */ ],
  "createdAt": "…",
  "finishedAt": null,
  "chatConversationId": "<guid>",
  "result": null
}
```

Note `chatConversationId` — you will need it for chat (§7) and voice (§8).

**Connect the gameplay socket:**

```text
ws(s)://<host>/ws/v1/games?sessionId=<id>&access_token=<token>
```

On `open`, the client immediately sends a sync command:

```json
{ "type": "cmd", "data": { "type": "sync" } }
```

On any disconnect it reconnects with exponential backoff from 1 second up to a 30-second ceiling, and **re-sends the sync on every open**. The sync command makes reconnection stateless and idempotent: whatever the client missed, the server re-broadcasts.

**The envelope.** Every frame is a thin JSON envelope:

- Client → server: `{"type":"cmd","data":<command>}`
- Server → client: `{"type":"game","data":…}`, `{"type":"error","error":…}`, `{"type":"presence","userId","online"}`

**Chess commands** (the `data` payload of a `cmd` frame):

```json
{ "type": "sync" }
{ "type": "move", "from": "e2", "to": "e4", "promo": "q" }
{ "type": "resign" }
{ "type": "offer-draw" }
{ "type": "accept-draw" }
{ "type": "decline-draw" }
```

`promo` is only present on promotion moves.

**Broadcasts** (the `data` payload of a `game` frame):

- `state` — the full snapshot:

```json
{
  "type": "state",
  "white": "<userId>",
  "black": "<userId>",
  "ratings": { "white": 1420, "black": 1388 },
  "board": "RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr",
  "turn": "white",
  "moves": [ { "from": "e2", "to": "e4", "promo": null, "san": "e4", "at": "…" } ],
  "status": "active",
  "result": null,
  "deadline": "…",
  "drawOfferBy": null,
  "ai": false,
  "aiName": null
}
```

The `board` is a 64-character string, `index = rank * 8 + file` with `a1 = 0`, using `PNBRQK` for white, `pnbrqk` for black, `.` for empty squares.

- `moved` — a single move was applied.
- `draw-offered` / `draw-declined`.
- `game-over` — `{ "result": { "kind", "reason", "at" }, "view" }`, where `reason` is one of `checkmate`, `stalemate`, `threefold-repetition`, `fifty-move-rule`, `insufficient-material`, `resignation`, `agreement`, `timeout`, `timeout-no-moves`.

**Identity is never taken from payloads.** The client sends commands with no user id, and the script never trusts one from the wire — the platform passes the authenticated sender to the script. There is nothing to spoof.

See [game-scripts.md](../api/game-scripts.md) for the script contract behind all of this.

## 7. In-game chat

`initChat` in `game.js` uses the session's `chatConversationId` from §6:

```http
GET  /api/v1/chat/conversations/{id}/messages?page=1&pageSize=50
POST /api/v1/chat/conversations/{id}/messages
     { "content": "good luck!" }
```

The real-time chat socket `ws/v1/chat` is **blocked for game-scoped tokens**. The client tries it once, gets refused, and falls back to polling the REST endpoint every 5 seconds — plan on polling from the start in your own game.

Chat works even though the two players may not be friends: the session conversation (type `"game"`) is created with both players as participants, so the usual chat permission rules are already satisfied.

Reference: [chat.md](../api/chat.md).

## 8. Voice

Voice is opt-in and **off by default** (`game.js`, `VoiceController`). When a player enables it:

1. Find or create the room bound to the session's conversation:

```http
GET  /api/v1/voice/rooms?conversationId=<chatConversationId>
POST /api/v1/voice/rooms
     { "conversationId": "<chatConversationId>" }
```

2. Join it:

```http
POST /api/v1/voice/rooms/{roomId}/join
```

3. Connect the voice socket:

```text
ws(s)://<host>/ws/v1/voice?roomId=<id>&access_token=<token>
```

Media is **WebRTC peer-to-peer with perfect negotiation**; the socket only carries signaling and control:

- Signaling: `{"type":"rtc","to":<userId>,"payload":{"sdp":…}}` or `{"type":"rtc","to":<userId>,"payload":{"ice":…}}`
- Control: `{"type":"mute","muted":…}`, `{"type":"speaking","speaking":…}`
- Server events: `voice.roster`, `voice.participant_joined`, `voice.participant_left`, `voice.mute_changed`, `voice.speaking`, `voice.rtc`

If P2P fails, the fallback is server-relayed opus binary frames: a 16-byte sender id followed by the audio payload.

Voice is **disabled in AI games** — the client checks `view.ai` from the state broadcast and never offers the toggle.

Reference: [voice.md](../api/voice.md).

## 9. Elo & leaderboard

Chess never submits a score. When a game ends, the **script** returns `eloUpdates` and the **platform** publishes them to the game's leaderboard. Clients can never write leaderboard entries directly — this is what makes the ratings trustworthy.

The client side is therefore trivial: read the entries (§4) and render them. See [leaderboards.md](../api/leaderboards.md).

## 10. Replays

`App.loadReplays` / `App.openReplay` in `app.js`:

```http
GET /api/v1/games/chess/replays/mine?limit=10
GET /api/v1/games/chess/replays/{sessionId}
```

A replay payload:

```json
{
  "sessionId": "<guid>",
  "players": [ /* ... */ ],
  "finishedAt": "…",
  "result": {
    "kind": "win",
    "reason": "checkmate",
    "at": "…",
    "white": "<userId>",
    "black": "<userId>",
    "moveCount": 41,
    "eloBefore": { "white": 1420, "black": 1388 },
    "eloAfter": { "white": 1436, "black": 1372 }
  },
  "state": { "game": { "moves": [ /* ... */ ] } }
}
```

The viewer steps `state.game.moves` through the shared `chessRules` engine locally — the same `server.js` rules file, running in the browser — so replays need no server round-trips and can never drift from the real rules. This is the second payoff of the one-file-two-roles design from §1.

## 11. Profiles & avatars

Other players are resolved through (`app.js`, `App.profileFor`):

```http
GET /api/v1/users/{id}/profile  → { "id": "…", "username": "…", "nickname": "…" }
GET /api/v1/users/{id}/avatar   → image/png, or 404
```

Two UI rules the reference client follows:

- Render **nicknames**, never usernames.
- Fall back to `"Player " + id.slice(0, 8)` when a profile is missing or a nickname is empty.

Reference: [profile.md](../api/profile.md).

## 12. The AI opponent

`POST /api/v1/games/chess/sessions/ai` creates a session where the platform flags one seat `ai: true` in `createSession`. The script itself plays that seat: "hal", a greedy material-capture engine that replies **within the same invocation** that processes the human's move.

AI games are rated normally, and hal has its own persistent elo, which makes it a genuine ladder opponent rather than a throwaway bot.

## 13. What chess deliberately does NOT use

The reference game touches none of these:

- **Achievements** — aimed at catalog titles that unlock platform-wide awards: [achievements.md](../api/achievements.md).
- **Catalog / entitlements** — for games distributed and sold through the catalog: [catalog.md](../api/catalog.md).
- **Relay** — the high-frequency relay channel for fast-paced, real-time games where the per-command script round-trip is too slow: [relay.md](../api/relay.md).
- **External libraries** — script sandbox escapes for heavier logic: [external-libraries.md](../api/external-libraries.md).

A turn-based board game needs none of them. If your game is real-time, catalog-distributed, or needs binary payloads, those pages are where to look next.

## 14. Checklist for your own game

- [ ] Add a `starhermit.txt` manifest (`name`, `slug`, `launch`, `owner`, `server`).
- [ ] Read `#game_token` from the URL hash once, then strip it with `history.replaceState`.
- [ ] Decode the JWT for `sub` (user id) and `game_scope` (slug) — never hard-code your slug.
- [ ] Build all API paths as same-origin relative URLs: `/api/v1/games/<slug>` + suffix.
- [ ] Refresh the launch token every 45 minutes via `POST …/launch-token`.
- [ ] Use the `cmd` / `sync` WebSocket pattern: envelope everything, sync on every open, reconnect with 1s→30s backoff.
- [ ] Design your script's commands and broadcasts **as the client contract** — the client renders broadcasts and sends commands, nothing more.
- [ ] Return a summary object `{ turnPlayerId, deadline, status, moveCount }` so the sessions list can show whose turn it is.
- [ ] End games by returning a `result` — that one return value is what powers both replays and elo.

Get these right and your game has auth, matchmaking, sessions, ratings, and replays with zero backend code of your own. The [getting started guide](../getting-started.md) walks the first deploy end to end.
