# Games API

The games subsystem is the core of StarHermit: server-authoritative multiplayer games whose rules run either in a sandboxed JavaScript file or a developer-supplied container. Both runtimes share this player-facing REST API (`api/v1/games/{slug}`) and gameplay WebSocket (`ws/v1/games`). For server authoring, see [Game Scripts](game-scripts.md) or [Container-hosted Game Servers](container-games.md). For a complete script-runtime example, see the [Chess Walkthrough](../tutorials/chess-walkthrough.md) and [HypeDriven/starhermit-chess](https://github.com/HypeDriven/starhermit-chess).

**Base URL:** `https://api.starhermit.com`.

Player endpoints require authentication and work with both full user tokens and game-scoped launch
tokens. The two `/server/...` endpoints are container-only: session reconciliation uses a narrow
server bearer token, while token renewal uses the deployment refresh key.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/games/{slug}` | Bearer | Game info + caller's stats |
| POST | `/api/v1/games/{slug}/launch-token` | Bearer | Mint a game-scoped launch token |
| GET | `/api/v1/games/{slug}/achievements` | Bearer | The game's achievements + the caller's unlock state |
| GET | `/api/v1/games/{slug}/controls` | Bearer | Get the caller's effective control bindings |
| PUT | `/api/v1/games/{slug}/controls` | Bearer | Replace the caller's control overrides |
| DELETE | `/api/v1/games/{slug}/controls` | Bearer | Reset the caller's controls to manifest defaults |
| GET | `/api/v1/games/{slug}/sessions/mine` | Bearer | Caller's active sessions |
| GET | `/api/v1/games/{slug}/sessions/{sessionId}` | Bearer | Session detail (participants only) |
| POST | `/api/v1/games/{slug}/sessions/ai` | Bearer | Create a practice session vs the platform AI |
| POST | `/api/v1/games/{slug}/matchmaking` | Bearer | Enqueue for nearest-elo matchmaking |
| GET | `/api/v1/games/{slug}/matchmaking` | Bearer | Latest non-cancelled matchmaking ticket |
| DELETE | `/api/v1/games/{slug}/matchmaking` | Bearer | Cancel queued tickets |
| POST | `/api/v1/games/{slug}/invites` | Bearer | Invite a friend to a game |
| GET | `/api/v1/games/{slug}/invites` | Bearer | Incoming pending + all outgoing invites |
| POST | `/api/v1/games/{slug}/invites/{inviteId}/accept` | Bearer | Accept an invite (creates the session) |
| POST | `/api/v1/games/{slug}/invites/{inviteId}/decline` | Bearer | Decline an invite |
| GET | `/api/v1/me/game-invites` | Bearer | All pending invites — every game, both invite systems (max 50) |
| GET | `/api/v1/games/{slug}/replays/mine` | Bearer | Caller's finished sessions |
| GET | `/api/v1/games/{slug}/replays/{sessionId}` | Bearer | Full replay state (participants only) |
| WS | `/ws/v1/games?sessionId={guid}` | Bearer | Gameplay WebSocket |
| GET | `/api/v1/games/{slug}/server/sessions/{sessionId}` | Game-server token | Container backend session reconciliation; not available to player tokens |
| POST | `/api/v1/games/{slug}/server/token` | Refresh key | Renew a container's expiring server token |

Errors are returned as `{"error":"..."}` with standard status codes.

## Game info

### `GET /api/v1/games/{slug}`

Returns the game definition plus the caller's stats for that game. `404` if no such game exists.

```json
{
  "slug": "chess",
  "name": "Chess",
  "enabled": true,
  "leaderboardId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "maxConcurrentSessionsPerPlayer": 20,
  "me": {
    "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "elo": 1200,
    "wins": 4,
    "losses": 2,
    "draws": 1,
    "activeSessionCount": 2
  }
}
```

- `leaderboardId` is optional.
- `me.elo` defaults to `1200`; `wins`/`losses`/`draws` are read from the server-runtime-owned per-player document.

## Launch tokens

### `POST /api/v1/games/{slug}/launch-token`

Mints a game-scoped JWT (default lifetime 60 minutes) carrying `game_scope={slug}` and no permission claims. A scoped token may re-mint a token for its own game — this is the client refresh pattern. Clients should refresh before the token expires; the chess reference client, for example, refreshes every 45 minutes.

```json
{
  "token": "eyJhbGciOi...",
  "expiresInSeconds": 3600
}
```

## Achievements

### `GET /api/v1/games/{slug}/achievements`

Every achievement the game's authoritative backend declares, with the caller's unlock state. Secret
achievements stay hidden until the caller unlocks them. Accepts a full user JWT or a game-scoped
launch token. `404` when the slug has no authoritative game definition.

```json
[
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "key": "first-win",
    "name": "First Win",
    "description": "Win a match.",
    "icon": null,
    "secret": false,
    "points": 10,
    "unlocked": true,
    "unlockedAt": "2026-07-25T09:14:02Z"
  }
]
```

Game achievements are **server-authoritative**: only the game's script or container grants them,
and the client-claimed `POST /api/v1/me/achievements/unlock` endpoint refuses them. Live unlocks
arrive on the gameplay socket as `{"type":"achievement"}` frames. Full contracts are in
[Achievements](achievements.md), [Game Scripts](game-scripts.md#achievements), and
[Container Game Servers](container-games.md#control-channel).

## Per-player control bindings

Games can declare desktop-browser controls with `control.*` entries in
[`starhermit.txt`](github-games.md#default-control-bindings). The controls API stores a
separate override for each user and game. Full user JWTs and game-scoped launch tokens are
accepted; a launch token's `game_scope` must match `{slug}`.

### `GET /api/v1/games/{slug}/controls`

Returns the effective bindings in manifest order. `codes` contains the user's override when
one exists, otherwise `defaultCodes`. Returns `404` when the game declares no controls.

```json
{
  "actions": [
    {
      "action": "up",
      "label": "Run forward",
      "defaultCodes": ["KeyW", "ArrowUp"],
      "codes": ["KeyW", "ArrowUp"]
    },
    {
      "action": "shoot",
      "label": "Shoot",
      "defaultCodes": ["Space"],
      "codes": ["KeyJ"]
    }
  ]
}
```

### `PUT /api/v1/games/{slug}/controls`

Replaces the caller's overrides. The `bindings` object may contain a subset of the declared
actions; omitted actions continue to use their defaults.

```json
{
  "bindings": {
    "up": ["KeyW", "ArrowUp"],
    "shoot": ["KeyJ"]
  }
}
```

Each action must be declared by the game. Every action must have 1–4 valid
`KeyboardEvent.code` values, and no code may be assigned to two actions in the resulting
effective map. Invalid actions, codes, or conflicts return `400`.

### `DELETE /api/v1/games/{slug}/controls`

Deletes all of the caller's overrides and restores the manifest defaults. Returns `204`.
Launch-token writes are intentional, so a hosted game may provide its own rebinding screen.

## Sessions

### `GET /api/v1/games/{slug}/sessions/mine`

The caller's active sessions for this game. `myTurn` and `deadline` are parsed from the script state's `summary` object (see [Game Scripts](game-scripts.md#the-platform-readable-window)).

```json
[
  {
    "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
    "status": "active",
    "players": [
      { "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "username": "alice" },
      { "userId": "9b2f8c1a-1111-4222-8333-444455556666", "username": "bob" }
    ],
    "createdAt": "2026-07-20T14:03:11Z",
    "finishedAt": null,
    "myTurn": true,
    "deadline": "2026-07-21T14:03:11Z"
  }
]
```

### `GET /api/v1/games/{slug}/sessions/{sessionId}`

Session detail. Participants only — `403` otherwise.

```json
{
  "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "status": "active",
  "players": [
    { "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "username": "alice" },
    { "userId": "9b2f8c1a-1111-4222-8333-444455556666", "username": "bob" }
  ],
  "createdAt": "2026-07-20T14:03:11Z",
  "finishedAt": null,
  "chatConversationId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "result": null
}
```

### `POST /api/v1/games/{slug}/sessions/ai`

Creates a practice session against the platform AI seat: fixed user id `00000000-0000-4000-8000-00000000a1a1`, username **"The House"**. The game script itself plays the AI — there is no external bot service.

```json
{ "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e" }
```

## Matchmaking

### `POST /api/v1/games/{slug}/matchmaking`

Enqueues the caller for nearest-elo pairing. Returns `409` if the caller is already queued or at their concurrent-session cap. Status is `queued`, or `matched` (with `sessionId`) if a pairing was found immediately.

```json
{
  "ticketId": "b3b7c8d2-5c1e-4f3a-9e2d-1a2b3c4d5e6f",
  "status": "matched",
  "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e"
}
```

### `GET /api/v1/games/{slug}/matchmaking`

Returns the caller's latest non-cancelled ticket (same `GameMatchmakingDto` shape), or `404`.

### `DELETE /api/v1/games/{slug}/matchmaking`

Cancels the caller's queued tickets. Returns `204`.

## Invites

### `POST /api/v1/games/{slug}/invites`

Request body:

```json
{ "toUserId": "9b2f8c1a-1111-4222-8333-444455556666" }
```

The target must be a friend (`403` otherwise — see [Friends](friends.md)); `409` on a duplicate invite or when either player is at the session cap. The invitee also receives a [`game_invite` event](chat.md#game_invite-one-event-for-both-invite-systems) pushed over their chat socket, with `kind: "session"`.

**Which invite should you send?** Accepting this one *creates a new session* for the two players. If the inviter is already sitting in a [realtime room](realtime.md) (a lobby with seats), invite them into that room instead — `POST /api/v1/realtime/rooms/{id}/invites` — so accepting seats them at the table you are actually at. Both notify the invitee the same way, so never send both for one invitation: that notifies twice.

Response:

```json
{
  "inviteId": "e7f1a2b3-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
  "from": { "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "username": "alice" },
  "to": { "userId": "9b2f8c1a-1111-4222-8333-444455556666", "username": "bob" },
  "status": "pending",
  "createdAt": "2026-07-20T14:10:00Z",
  "sessionId": null,
  "notified": true
}
```

`notified` reports whether the push reached a live connection (`false` = the invitee is not connected; the invite still stands and they will see it in their inbox). It is `null` on the list/accept/decline responses, where it does not apply.

### `GET /api/v1/games/{slug}/invites`

```json
{
  "incoming": [ { "inviteId": "...", "from": { "userId": "...", "username": "bob" }, "to": { "userId": "...", "username": "alice" }, "status": "pending", "createdAt": "2026-07-20T14:10:00Z", "sessionId": null } ],
  "outgoing": []
}
```

`incoming` contains pending invites only; `outgoing` contains all of the caller's outgoing invites.

### `POST /api/v1/games/{slug}/invites/{inviteId}/accept`

Accepts the invite and creates the session. Returns the `GameInviteDto` with `status` `accepted` and `sessionId` set.

### `POST /api/v1/games/{slug}/invites/{inviteId}/decline`

Returns `204`.

### `GET /api/v1/me/game-invites`

Every pending invite addressed to the caller (max 50, newest first) — the poll fallback for the push notification, and the one place to ask "what am I invited to?". It spans **both** invite systems: session invites from this page and [realtime-room invites](realtime.md#invites). Entries are exactly the [`game_invite` payloads](chat.md#game_invite-one-event-for-both-invite-systems), so a client renders push and poll results with the same code.

```json
[
  {
    "inviteId": "e7f1a2b3-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
    "kind": "room",
    "gameSlug": "poker",
    "gameName": "StarHermit Poker",
    "roomId": "b1d2c3e4-5f60-4a71-8b92-c3d4e5f60718",
    "from": { "userId": "9b2f8c1a-1111-4222-8333-444455556666", "username": "bob" },
    "createdAt": "2026-07-26T14:10:00Z",
    "acceptPath": "/api/v1/realtime/rooms/invites/e7f1a2b3-4c5d-4e6f-8a9b-0c1d2e3f4a5b/accept",
    "declinePath": "/api/v1/realtime/rooms/invites/e7f1a2b3-4c5d-4e6f-8a9b-0c1d2e3f4a5b/decline"
  },
  {
    "inviteId": "c4a5b6d7-8e9f-4012-8345-6789abcdef01",
    "kind": "session",
    "gameSlug": "chess",
    "gameName": "Chess",
    "roomId": null,
    "from": { "userId": "9b2f8c1a-1111-4222-8333-444455556666", "username": "bob" },
    "createdAt": "2026-07-20T14:10:00Z",
    "acceptPath": "/api/v1/games/chess/invites/c4a5b6d7-8e9f-4012-8345-6789abcdef01/accept",
    "declinePath": "/api/v1/games/chess/invites/c4a5b6d7-8e9f-4012-8345-6789abcdef01/decline"
  }
]
```

Answer each entry at its own `acceptPath`/`declinePath` — the two systems keep separate invite ids, so a room invite id at `/games/{slug}/invites/...` is a `404`. Room invites whose room has already started or closed are omitted; there is nothing left to accept.

### Share links (invite by URL)

The invite flow above requires the two players to already be friends. To invite someone who is **not on the platform yet** (or not a friend yet), a game can hand out a **share link** — a URL to the web dashboard that automates the whole onboarding:

```
https://dashboard.starhermit.com/game-invite/<userId>/<gameSlug>
```

- `<userId>` — the sharing player's user id. A game client already has it: it is the `sub` claim of its launch token (the chess reference implementation exposes it as `Net.userId`).
- `<gameSlug>` — the game's slug (`game_scope` claim). Games without a server script use the GitHub game id (a GUID) instead; the dashboard accepts either.

When the recipient opens the link, the **dashboard** (not the game) does the automated friend-invite part — no new backend endpoints are involved, it composes the existing APIs:

1. Signs them in (Google OAuth), or reuses their existing session. The link intent survives the sign-in round trip.
2. Shows a consent dialog naming the sharer and the game, then **friends the sharer**: it accepts the sharer's pending friend request if one exists, otherwise it sends one (`POST /api/v1/me/friend-requests`).
3. Prompts them to pick a nickname if their account has none (games display profile nicknames — see [Profile](profile.md)).
4. Launches the game (the platform-hosted `https://<game-id>.starhermit.com` copy, with a launch token in the `#game_token=` fragment as usual).
5. Sends the **play invite back to the sharer** with `POST /api/v1/games/{slug}/invites` — so a share link ends as a normal game invite the sharer accepts (dashboard toast, desktop balloon, or the game's own invite list). If the friendship is still a pending request, the dashboard queues the play invite and sends it automatically once the sharer accepts.

What this means for your game client:

- **Offering the link costs one line of string building** — put a "Share invite link" button next to your invite-a-friend UI and copy the URL to the clipboard. See `shareInviteLink()` in the [chess reference implementation](https://github.com/HypeDriven/starhermit-chess).
- **No special handling is needed on the receiving side.** The recipient's invite arrives through the normal invite flow: your `GET .../invites` polling shows the sharer the incoming invite, accepting it creates the session, and the recipient sees the session appear in `GET .../sessions/mine` (show pending outgoing invites so the wait is visible — the chess client's "invited — waiting" cards).
- The dashboard also uses these URLs itself: every playable hosted game's details pane has a **Copy invite link** button, and the Windows client offers the same from a game's context menu.

## Replays

### `GET /api/v1/games/{slug}/replays/mine?limit=`

The caller's finished sessions. `limit` defaults to `10` and is clamped to 1–50.

```json
[
  {
    "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
    "players": [
      { "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "username": "alice" },
      { "userId": "9b2f8c1a-1111-4222-8333-444455556666", "username": "bob" }
    ],
    "finishedAt": "2026-07-20T15:42:37Z",
    "result": { "kind": "white-win", "reason": "checkmate" },
    "moveCount": 41
  }
]
```

### `GET /api/v1/games/{slug}/replays/{sessionId}`

The full final state JSON as archived by the platform. Participants only.

```json
{
  "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "players": [ { "userId": "...", "username": "alice" }, { "userId": "...", "username": "bob" } ],
  "finishedAt": "2026-07-20T15:42:37Z",
  "result": { "kind": "white-win", "reason": "checkmate" },
  "state": { "...": "game-specific final session state" }
}
```

## Session model

- Session `status` is `"active"` or `"finished"`.
- Each session gets a per-session chat conversation (type `"game"`) so opponents can chat and voice-call **without being friends** (see [Chat](chat.md) and [Voice](voice.md)).
- Concurrent-session cap per player defaults to `20`.
- Matchmaking ticket statuses: `queued` | `matched` | `cancelled`.
- Invite statuses: `pending` | `accepted` | `declined` | `cancelled`.
- **Sessions are created via matchmaking, invite-accept, the AI endpoint, or a realtime room start** (room-bound sessions — see [Realtime Rooms](realtime.md#room-bound-scripted-sessions)) — there is no "create lobby" endpoint.
- Elo is computed by the game script (`eloUpdates`), denormalized onto `GamePlayerState.Elo`, and published to the game's leaderboard (score type `elo`). **Clients can never submit scores to a game leaderboard directly** (see [Leaderboards](leaderboards.md)).

## Gameplay WebSocket

`ws/v1/games?sessionId={guid}` (version-neutral route). Authenticate with the `Authorization` header or the `?access_token=` query parameter. Participants only (`403`); when connecting with a launch token, its `game_scope` must match the session's game.

- Text frames only, max 16 KB per frame.
- A newer connection supersedes the old one: the previous connection is closed with `PolicyViolation`.

### Client → server

The `cmd` envelope is the platform contract; the contents of `data` are defined by each game's authoritative backend. For example, the chess reference implementation sends a move like this:

```json
{ "type": "cmd", "data": { "type": "move", "from": "e2", "to": "e4" } }
```

For a script runtime, durable commands run through `onPlayerMessage`; explicitly marked `{ "type": "input", "realtime": true, ... }` data uses latest-wins batching into the next `onTick`. For a container runtime, the platform forwards authenticated commands over its binary stream and the container owns its simulation loop. In both cases the platform supplies the trusted sender identity and clients can never relay state directly. See [Game Scripts — Context object](game-scripts.md#context-object) and [Container Game Servers — Gameplay stream](container-games.md#gameplay-stream).

### Server → client

```json
{ "type": "game", "data": { "...": "script-authorized message addressed to you" } }
{ "type": "error", "error": "Illegal move" }
{ "type": "presence", "userId": "9b2f8c1a-1111-4222-8333-444455556666", "online": true }
{ "type": "achievement", "data": { "key": "first-win", "name": "First Win", "description": "Win a match.", "icon": null, "points": 10, "unlockedAt": "2026-07-25T09:14:02Z" } }
{ "type": "resumed", "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e", "lostMs": 750 }
{ "type": "abandoned", "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e", "reason": "server_failure" }
```

- `game` — a server-authorized message addressed to you.
- `error` — an error from the platform or from your last command.
- `presence` — broadcast to the other participants when someone joins or leaves.
- `achievement` — an achievement the game's script just granted **you**, sent to the earning player
  only. A separate frame type on purpose: this is platform truth, not script-relayed game data.
  Emitted from both runtimes' durable update paths. See
  [Achievements](achievements.md#server-authoritative-game-achievements).
- `resumed` — container games only: the server process restarted and restored this session from a
  snapshot. Discard local prediction; `lostMs` reports the rewind and the game should send a normal
  full-state `game` frame next.
- `abandoned` — container games only: recovery was unsafe or failed, so the platform ended the
  session without a winner or elo update. Known reasons are `server_failure` and `restore_failed`.
  See [failure and recovery](container-games.md#failure-and-recovery).

### Runtime timing

For JavaScript games, the platform runs `onTick` sweeps at the clamped rate requested through
`game.tickRateHz`; `0` disables ticks. A container drives its own simulation loop and declares its
requested rate through `/describe`; the platform uses that rate for scheduling and snapshot policy,
not to step the game. See [Game Scripts — Tick rate](game-scripts.md#tick-rate) and
[Container Game Servers](container-games.md#protocol-v1).

## Lifecycle of a game

1. **Mint a launch token** — `POST /api/v1/games/{slug}/launch-token`. Clients should refresh it before expiry (the chess reference client refreshes every 45 minutes).
2. **Fetch game state** — `GET /api/v1/games/{slug}` for info + your stats; `GET .../sessions/mine` for games in progress; `GET .../invites` and `GET /api/v1/me/game-invites` for pending invites; `GET .../replays/mine` for history; `GET .../achievements` for the achievement screen.
3. **Find an opponent**, one of three ways:
   - **Matchmaking:** `POST .../matchmaking`, then poll `GET .../matchmaking` every 3 s until `status` is `matched` (the response carries `sessionId`). `DELETE .../matchmaking` to cancel.
   - **Invite flow:** pick a friend from `GET /api/v1/me/friends` (see [Friends](friends.md)), `POST .../invites` with `{ "toUserId": "..." }`; the invitee calls `POST .../invites/{inviteId}/accept`, which creates the session. (If your game seats players in a [realtime room](realtime.md) first, invite them to the room instead — same notification, but accepting puts them at the table you are already in.)
   - **AI practice:** `POST .../sessions/ai`.
4. **Load the session** — `GET .../sessions/{sessionId}`.
5. **Connect the WebSocket** — `ws/v1/games?sessionId={guid}` with the launch token, then send whatever initial-sync command the game's backend defines — the chess reference implementation, for example, sends `{"type":"cmd","data":{"type":"sync"}}`.
6. **Play** — exchange `cmd`/`game` frames as defined by the backend, surface `achievement` frames, and handle the container-only `resumed` frame.
7. **Result** — the authoritative backend ends the game; the platform archives the replay and publishes elo updates to the leaderboard.
8. **Replay** — `GET .../replays/{sessionId}` for the full final state.

### Example: chess command shapes

The following payload shapes are the example: how the chess [reference implementation](https://github.com/HypeDriven/starhermit-chess) fills in `data`. **They are defined by each game's script, not by the platform** — every game defines its own command set and broadcast payloads in its own script. The platform envelope is only `cmd` / `game` / `error` / `presence`; the contents of `data` are entirely script-owned.

Client commands (sent as `{"type":"cmd","data":{...}}`):

```json
{ "type": "move", "from": "e2", "to": "e4", "promo": "q" }
{ "type": "resign" }
{ "type": "offer-draw" }
{ "type": "accept-draw" }
{ "type": "decline-draw" }
{ "type": "sync" }
```

(`promo` is optional on `move`.)

Server messages (delivered as `{"type":"game","data":{...}}`):

```json
{
  "type": "state",
  "white": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "black": "9b2f8c1a-1111-4222-8333-444455556666",
  "ratings": { "white": 1200, "black": 1187 },
  "board": "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR",
  "turn": "w",
  "moves": [],
  "status": "active",
  "result": null,
  "deadline": "2026-07-21T14:03:11Z",
  "drawOfferBy": null,
  "ai": false,
  "aiName": null
}
```

```json
{ "type": "moved", "...": "move details + updated state" }
{ "type": "draw-offered" }
{ "type": "draw-declined" }
{ "type": "game-over", "result": { "kind": "white-win", "reason": "checkmate", "at": "2026-07-20T15:42:37Z" }, "view": { "...": "final state view" } }
```

See [Game Scripts](game-scripts.md) for how the script defines these messages, and the [Chess Walkthrough](../tutorials/chess-walkthrough.md) for an end-to-end build.
