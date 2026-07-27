# Realtime Rooms

Realtime rooms are generalized lobbies for fast-paced multiplayer games: room creation, friend invites, quick-join matchmaking, AI-seat backfill, and a role-aware realtime transport (`ws/v1/realtime`). The subsystem is deliberately game-agnostic — rooms are scoped per game slug, the room `metadata` is an opaque per-game JSON blob, and `teamCount = 1` models free-for-all games.

A match runs one of two ways:

- **Host-routed (default)** — the platform server is a smart transport, not a simulator: the room creator's client is the **host** and runs the authoritative game simulation; other clients (guests) send inputs to the host and receive the host's snapshots. The server enforces routing, roles, capacity, rate limits, and identity — clients cannot spoof each other, and only the server-assigned host can broadcast.
- **Room-bound scripted session (server-authoritative)** — for games that ship a `server=` script: when the room starts, the platform creates a bound N-player [scripted session](game-scripts.md#room-bound-sessions) that runs the simulation server-side at the game's tick rate. Gameplay then flows over `ws/v1/games` and the realtime WS is used for lobby/roster only. See [the bridge](#room-bound-scripted-sessions) below.

Contrast this with the [peer relay](relay.md) (dumb fan-out, no rooms/lobbies, disabled by default) and plain [scripted games](games.md) (server-authoritative, but no lobbies/matchmaking of their own). Realtime rooms are **enabled by default**.

All REST endpoints require authentication and work with both a full user token and a game-scoped launch token. Errors are returned as `{"error":"..."}` with standard status codes.

## Data model

**Room** lifecycle: `Lobby` → `Open` (matchmaking) → `Playing` (roster frozen, empty seats backfilled with AI) → `Closed`.

```json
{
  "id": "<guid>",
  "gameSlug": "my-game",
  "hostUserId": "<guid>",
  "status": "Lobby",
  "gameSessionId": null,
  "config": {
    "teamCount": 2,
    "seatsPerTeam": 5,
    "backfillAfterSeconds": 30,
    "metadata": { "map": "arena" }
  },
  "participants": [
    {
      "id": "<guid>",
      "userId": "<guid>",
      "username": "ada",
      "isAi": false,
      "isHost": true,
      "team": 0,
      "slot": 0,
      "joinedAt": "2026-07-22T07:00:00Z",
      "leftAt": null
    }
  ],
  "createdAt": "2026-07-22T07:00:00Z",
  "openedAt": null,
  "startedAt": null,
  "closedAt": null,
  "result": null
}
```

- `config.metadata` is an opaque JSON blob the platform never interprets.
- AI participants have `userId: null`, `isAi: true`, and a server-generated random nickname, unique within the room.
- `(team, slot)` is a participant's seat coordinate; humans are seated in join order.
- `gameSessionId` is the bound scripted session, set when the room starts for a game with a `server=` script (see [the bridge](#room-bound-scripted-sessions)); `null` otherwise. It is also included in roster pushes.
- `result` is the outcome, set when the room closes — host-submitted for host-routed games, script-returned for room-bound sessions.

**Invite**: `{ "id", "roomId", "gameSlug", "fromUserId", "fromUsername", "toUserId", "status", "createdAt", "notified" }` with `status` one of `pending` | `accepted` | `declined` | `expired` (invites expire when the room closes or starts before they are answered). `notified` appears on the response to `POST /rooms/{id}/invites` and reports whether the invitee's notification reached a live connection; it is `null` when listing.

## REST endpoints

Base: `https://api.starhermit.com/api/v1/realtime` — so
`POST /rooms` below is `POST /api/v1/realtime/rooms`.

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/rooms` | anyone | Create a lobby; caller becomes host |
| GET | `/rooms/{id}` | participants + invitees | Room + roster |
| POST | `/rooms/{id}/invites` | participants | Invite a friend; notifies them (`409` on duplicate) |
| GET | `/rooms/invites` | anyone | Caller's pending room invites (cross-game) |
| POST | `/rooms/invites/{inviteId}/accept` | invitee | Join the room (seat assigned) |
| POST | `/rooms/invites/{inviteId}/decline` | invitee | Decline (`204`) |
| POST | `/rooms/{id}/open` | host | Open to matchmaking; starts the backfill countdown |
| POST | `/rooms/quick-join` | anyone | Join the oldest open room with a free seat for the game |
| POST | `/rooms/{id}/start` | host | Backfill empty seats with AI, status → `Playing` |
| POST | `/rooms/{id}/leave` | participants | Leave; in Lobby/Open the seat is removed, in Playing the seat converts to an AI participant |
| POST | `/rooms/{id}/seats` | host | Re-balance seats before the match starts |
| POST | `/rooms/{id}/result` | host | Submit the result; room → `Closed` |
| GET | `/rooms/mine` | anyone | Caller's active room, if any (reconnect) |

### Create a room — `POST /rooms`

```json
{ "gameSlug": "my-game", "teamCount": 2, "seatsPerTeam": 5, "backfillAfterSeconds": 30, "metadata": { "map": "arena" } }
```

- `gameSlug` is required for full user tokens. With a game-scoped launch token the slug is taken from the token's `game_scope` (a mismatching body value is rejected with `403`).
- Caps: `teamCount` 1–2, `seatsPerTeam` 1–11, total seats ≤ 32. `backfillAfterSeconds` defaults to `30`.
- One active room per user: creating or joining while you are in any non-`Closed` room returns `409`.
- The creator becomes the host, seated at team 0, slot 0. Returns the room.

### Invites

`POST /rooms/{id}/invites` with `{ "toUserId": "<guid>" }`. Invites are **friends-only** (`403` otherwise; the same friendship rule as game invites), participants only, and only while the room is in `Lobby`/`Open`. `409` if the user is already in the room or already has a pending invite; `400` when inviting yourself. Returns the invite.

**The invitee is notified for you.** Sending a room invite emits a [`game_invite` push](chat.md#game_invite-one-event-for-both-invite-systems) on the invitee's chat socket and adds the invite to `GET /api/v1/me/game-invites`, so a friend who is in the StarHermit dashboard (or anywhere but your game) still hears about it. You do **not** need to also send a games-API invite — that would notify twice. The response's `notified` tells you whether the push reached a live connection; `false` just means the invitee is not connected right now and will see the invite from their inbox instead.

Because one notification covers both invite systems, its payload carries `kind: "room"` plus `roomId` and the `acceptPath`/`declinePath` for **this** invite. Answer a room invite at the realtime endpoints below — a room invite id is not valid at `/games/{slug}/invites/...` and vice versa.

`GET /rooms/invites` lists the caller's pending room invites across all games (launch tokens see only their own game's). Use it as the room-invite inbox a game client polls. The unified invite inbox at `GET /api/v1/me/game-invites` returns these too.

`POST /rooms/invites/{inviteId}/accept` seats the caller and returns the room. **Party pinning**: invite-joins are seated on the host's team while space lasts, then overflow to other teams. `409` if the room is full, already started/closed, or the caller is in another active room.

`POST /rooms/invites/{inviteId}/decline` → `204`.

### Matchmaking

`POST /rooms/{id}/open` (host only): `Lobby` → `Open`, sets `openedAt`, and starts the backfill countdown. Idempotent while already `Open`; `409` once `Playing`/`Closed`.

`POST /rooms/quick-join` with `{ "gameSlug": "my-game", "seats": 1 }` places the caller in the **oldest open room with a free seat** for that game slug. `404` when no room qualifies — the client should then create its own room and open it. Only single-seat quick-join is supported (`seats` must be `1`).

### Start, seats, leave, result

`POST /rooms/{id}/start` (host only): fills every empty seat with an AI participant (`isAi: true`, `userId: null`, unique random nickname), freezes the roster, sets `status: "Playing"`, and returns the frozen roster. If the game has a `server=` script, this also creates the room-bound scripted session (see [the bridge](#room-bound-scripted-sessions)); the returned room and roster push carry `gameSessionId`. **Idempotent** — starting a `Playing` room returns the roster again. A room may start automatically when its backfill deadline passes.

`POST /rooms/{id}/seats` (host only, `Lobby`/`Open` only) re-seats participants:

```json
{ "seats": [ { "participantId": "<guid>", "team": 1, "slot": 0 } ] }
```

`400` for seats outside the room's team/slot bounds or unknown participants; `409` if two participants would share a seat.

`POST /rooms/{id}/leave` behaves per room status:

- **Lobby/Open**: the seat is removed. If the **host** leaves, the host role transfers to the longest-serving remaining human participant; if no humans remain, the room is `Closed`.
- **Playing (AI takeover)**: the match continues — the leaver's seat becomes an AI seat: `isAi: true`, `userId: null`, with a fresh unique nickname and the same participant `id`, `team`, `slot`, and `joinedAt`. The leaver is immediately freed (the one-active-room rule no longer counts them, so they can create or join another room) while the roster push tells every client an AI now occupies that seat. If the leaver is the **host** and at least one other human remains, the host role transfers to the longest-joined remaining human and the room stays `Playing` (client-side host migration is the game's concern); if no humans remain, the room is `Closed`.

Returns the room.

`POST /rooms/{id}/result` (host only, `Playing` only) records the outcome, closes the room, and fans the result out over the WebSocket. **Host-routed games only** — a room with a bound scripted session ends when the script returns `result`, which closes the room automatically (see [the bridge](#room-bound-scripted-sessions)).

```json
{ "teamScores": [3, 1], "metadata": { "durationSeconds": 360 } }
```

`teamScores` must have exactly one entry per team; each score is sanity-clamped to 0–50. The clamped result is stored on the room's `result` and pushed to connected participants as a `{"type":"result"}` control frame.

`GET /rooms/mine` returns the caller's current non-`Closed` room (for reconnects), or `404`.

## WebSocket: `ws/v1/realtime`

Connect to `wss://api.starhermit.com/ws/v1/realtime?roomId=<guid>` with a JWT via the `Authorization` header or the `?access_token=` query parameter. **Participants only** (`403` otherwise); a launch token's `game_scope` must equal the room's `gameSlug`. The newest connection supersedes the user's previous one — the old socket is closed with `PolicyViolation` ("Superseded by a newer connection").

### Binary frames (gameplay)

Binary frames are the gameplay channel for **host-routed** games (room-bound scripted sessions play over `ws/v1/games` instead — see [the bridge](#room-bound-scripted-sessions)). The server **never parses** their payloads — host authority is the game's contract — but it enforces routing and identity:

- The server **prefixes every frame with the sender's 16-byte participant id** (the participant GUID in .NET byte order). Clients must strip the first 16 bytes and must never trust a sender id inside the payload.
- **Host → room**: the host's frames are fanned out to every other connected participant (snapshots).
- **Guest → host only**: a guest's frames are delivered to the host and nobody else (inputs).
- Frame size cap: **8 KB**. Rate limit: **30 messages/second per connection**, token bucket with a 2× burst allowance for 1 second. A violation closes the socket with `PolicyViolation`.

### JSON text control frames

Small JSON frames (≤ **4 KB**) carry lobby and match events:

```json
{ "type": "event" | "chat" | "ready", "...": "..." }
```

- The **host** may send `event`, `chat`, and `ready`; frames are broadcast to every other participant.
- **Guests** may only send `ready` and `chat` (also broadcast), rate-limited to **10 per minute**.
- The server **re-tags every control frame** with the sender's participant id: a client-supplied `from` is stripped and replaced with `"from": "<participantId>"`.
- An unparseable frame, an unknown `type`, or a type the sender's role may not send closes the socket with `PolicyViolation`.

### Server pushes

The server pushes JSON text frames on its own:

- `{"type":"presence","userId":"<guid>","online":true|false}` — on every connect/disconnect.
- `{"type":"roster","roomId":"<guid>","status":"Playing","participants":[ ... ]}` — to the connecting socket, and to the whole room on joins, leaves, seat changes, opens, and starts. The roster push after `start` is the frozen match roster, AI seats included, and carries `gameSessionId` when the room has a bound scripted session.
- `{"type":"result","roomId":"<guid>","teamScores":[3,1],"metadata":{...}}` — when the host submits the result, or when a bound script returns one.

### Close codes

| Code | When |
|---|---|
| `NormalClosure` | Client-initiated close |
| `MessageTooBig` | Frame over the 8 KB (binary) / 4 KB (text) cap |
| `PolicyViolation` | Rate-limit violation, disallowed/invalid control frame, connection superseded by a newer one |

## Automatic room lifecycle

- An `Open` room starts automatically when its backfill deadline passes; empty seats become uniquely named AI participants.
- A `Playing` room closes when its host has no active WebSocket connection for more than 60 seconds. Connected guests receive a final roster push showing the room closed.
- A `Lobby` or `Open` room closes after more than 60 minutes without connected participants.

A participant who merely loses their connection is not affected: reconnecting the socket (newest connection supersedes) and `GET /rooms/mine` both keep working while the room is alive.

## Security summary

- Every endpoint works with a full JWT **or** a game-scoped launch token; a launch token's `game_scope` must match the room's `gameSlug`, so two games can never see or join each other's rooms.
- Reads are participant-only (plus pending invitees); `open`, `seats`, `start`, and `result` are host-only; invites are friends-only.
- Validation: seat/team caps, one active room per user, idempotent start, result scores clamped to 0–50, invites expire with the room.
- Transport: server-tagged sender ids, role-based routing, frame size caps, per-connection rate limits, no server-side parsing of binary payloads.

## Room-bound scripted sessions

For a game that declares a `server=` script in its manifest, a realtime room can run its match **server-authoritatively** instead of on the host client. This combines rooms (lobby, invites, matchmaking, backfill) with server-side simulation, validated inputs, and script-owned results.

- **Session creation on room start.** When the room enters `Playing`, the platform creates an N-player [game session](games.md) for the human participants. AI seats exist only in the script-facing roster. The room response and roster pushes expose `gameSessionId` so clients know which gameplay socket to open.
- **Gameplay moves to `ws/v1/games`.** Clients connect to `ws/v1/games?sessionId=<gameSessionId>` and exchange `cmd`/`game` frames with the script, exactly like any scripted game; the realtime WS stays connected for roster/presence only. The session ticks at the supported rate requested by its script via `game.tickRateHz` (see [Game Scripts](game-scripts.md#tick-rate)).
- **Extended script ctx.** Every invocation for a room-bound session (`createSession`, `onPlayerMessage`, `onTick`) additionally receives `ctx.room` (room id, metadata, and the frozen roster — humans *and* AI seats, ordered by team then slot) and `ctx.presence` (`{ "<userId>": { online, left } }` for every user who is or was a human participant). Details in [Game Scripts — Room-bound sessions](game-scripts.md#room-bound-sessions).
- **Server-authoritative achievements.** Every hook of a bound session can grant achievements by returning `achievements: {userId: [keys]}`, exactly as in any scripted game — including from `createSession`, which fires the moment the room starts. Unlocks are pushed to the earning player over `ws/v1/games` as `{"type":"achievement"}` frames. See [Achievements](achievements.md#server-authoritative-game-achievements).
- **The script ends the match.** When the script returns `result`, the platform finishes the session, stores the result on the room, and closes the room (final roster push included). `POST /rooms/{id}/result` is not used for room-bound games.
- **Failure isolation.** A room stays playable if session creation fails — the bridge is best-effort at start and the room falls back to host-routed behavior.
- **A host-routed game can bind a session purely for achievements.** The binary gameplay channel is never gated on a bound session, so a game that simulates on the host client can still ship a `server=` script whose only job is authoritative achievement (and elo) grants, while the fast path keeps flowing over `ws/v1/realtime`.

## How a game uses it

1. **Create**: the lobby creator calls `POST /rooms` with its team layout and an opaque `metadata` blob, and becomes host.
2. **Invite**: the host lists friends (`GET /api/v1/me/friends`) and sends `POST /rooms/{id}/invites`. The platform notifies each invitee (`game_invite` push + `GET /api/v1/me/game-invites`), so they can accept from the dashboard without having your game open; invitees already in the game see the same invites by polling `GET /rooms/invites`. Accepting seats them on the host's team.
3. **Open**: the host calls `POST /rooms/{id}/open`. Solo players call `POST /rooms/quick-join` and land in the oldest open room with a free seat (on `404` they create and open their own room).
4. **Connect**: everyone opens `ws/v1/realtime?roomId=…` and watches `roster`/`presence` pushes as seats fill.
5. **Start**: at the backfill deadline or when the host force-starts, empty seats become AI participants and the roster freezes. **Host-routed game**: guests send inputs as binary frames (they reach only the host); the host broadcasts snapshots. **Room-bound scripted game**: everyone connects `ws/v1/games?sessionId=<gameSessionId>` and plays against the script with `cmd`/`game` frames.
6. **Leave mid-match**: a player who leaves during `Playing` is replaced where they sat by an AI participant (same seat, new server-generated nickname) and can immediately queue again; if the host leaves, the host role passes to the longest-joined remaining human. A host who drops their connection has 60 seconds to reconnect before the match closes.
7. **Finish**: host-routed — the host POSTs the result; the server clamps scores, stores the result, pushes it to all sockets, and closes the room. Room-bound — the script returns `result` and the platform stores it and closes the room.

## See also

- [Relay](relay.md) — simpler opaque byte fan-out (no lobbies); availability may vary
- [Games](games.md) — server-authoritative scripted games
- [Authentication](auth.md) — launch tokens and game-scope fencing
- [Friends](friends.md) — the friend list used by the invite picker
