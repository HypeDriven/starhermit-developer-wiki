# Realtime Rooms

Realtime rooms are generalized lobbies for fast-paced multiplayer games: room creation, friend invites, quick-join matchmaking, AI players on demand plus AI-seat backfill, and a role-aware realtime transport (`ws/v1/realtime`). The subsystem is deliberately game-agnostic — rooms are scoped per game slug, the room `metadata` is an opaque per-game JSON blob, and `teamCount = 1` models free-for-all games.

A match runs one of two ways:

- **Host-routed (default)** — the platform server is a smart transport, not a simulator: the room creator's client is the **host** and runs the authoritative game simulation; other clients (guests) send inputs to the host and receive the host's snapshots. The server enforces routing, roles, capacity, rate limits, and identity — clients cannot spoof each other, and only the server-assigned host can broadcast.
- **Room-bound session (server-authoritative)** — for games that ship a `server=` script or a [container](container-games.md): when the room starts, the platform creates a bound N-player session ([scripted](game-scripts.md#room-bound-sessions) or container) that runs the simulation server-side. Gameplay then flows over `ws/v1/games` and the realtime WS is used for lobby/roster only. See [the bridge](#room-bound-sessions) below.

Contrast this with the [peer relay](relay.md) (opaque fan-out bound to an existing room/session roster, disabled by default) and plain [scripted games](games.md) (server-authoritative, with session matchmaking and invites but no room lobby). Realtime rooms are **enabled by default**.

All REST endpoints require authentication and work with both a full user token and a game-scoped launch token. Errors are returned as `{"error":"..."}` with standard status codes.

## Data model

**Room** lifecycle: `Lobby` → `Open` (matchmaking) → `Playing` (roster frozen, empty seats backfilled with AI up to the room's allowance) → `Closed`. A room created with [`joinInProgress`](#join-in-progress) keeps taking players while `Playing`.

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
    "aiPlayers": 0,
    "backfillAiPlayers": null,
    "joinInProgress": false,
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
  "name": "Friday night",
  "joinCode": "K7MP2X",
  "isVisible": false,
  "revision": 1,
  "createdAt": "2026-07-22T07:00:00Z",
  "openedAt": null,
  "startedAt": null,
  "closedAt": null,
  "result": null
}
```

- `config.metadata` is an opaque JSON blob the platform never interprets.
- `config.aiPlayers` is how many AI players the creator asked the match to start with — they are seated when the room is created (see [below](#ai-players)). It records the request; the `participants` roster is authoritative for who actually holds a seat.
- AI participants have `userId: null`, `isAi: true`, and a server-generated random nickname, unique within the room.
- `(team, slot)` is a participant's seat coordinate; humans are seated in join order.
- `gameSessionId` is the bound game session, set when the room starts for a game with a server backend — a `server=` script or a [container](container-games.md) (see [the bridge](#room-bound-sessions)); `null` otherwise. It is also included in roster pushes.
- `result` is the outcome, set when the room closes — host-submitted for host-routed games, script-returned for room-bound sessions.
- `joinCode` is six characters (read-alike pairs removed). It is the invitation for `join-by-code`. Listings never include it.
- `isVisible` lists the room in `GET /rooms`. Being open (quick-joinable) and being listed are independent.
- `revision` bumps only when the host edits configuration (`PATCH`), never when a seat fills. Pass it as `expectedRevision` on `PATCH` for compare-and-swap (`409` on conflict).

**Invite**: `{ "id", "roomId", "gameSlug", "fromUserId", "fromUsername", "toUserId", "status", "createdAt", "notified" }` with `status` one of `pending` | `accepted` | `declined` | `expired` (invites expire when the room closes or starts before they are answered). `notified` appears on the response to `POST /rooms/{id}/invites` and reports whether the invitee's notification reached a live connection; it is `null` when listing.

## REST endpoints

Base: `https://api.starhermit.com/api/v1/realtime` — so
`POST /rooms` below is `POST /api/v1/realtime/rooms`.

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/rooms` | anyone | Create a lobby, optionally with AI players; caller becomes host |
| GET | `/rooms?gameSlug=[&includeInProgress=true]` | anyone | Browse open, listed rooms that still have a seat — and, when asked, running join-in-progress rooms (no code, no roster; max 50) |
| POST | `/rooms/join-by-code` | anyone | Take a seat with the room's join code (works on unlisted / still-Lobby rooms) |
| PATCH | `/rooms/{id}` | host | Rename, list/unlist, replace metadata, switch `joinInProgress`, set the backfill allowance (`expectedRevision` CAS) |
| POST | `/rooms/{id}/matchmake` | host, lobby | Queue the whole roster as one party/team |
| GET | `/rooms/{id}` | participants + invitees | Room + roster |
| POST | `/api/v1/realtime/connection-tickets` | anyone | One-time `?ticket=` for the realtime (and other) sockets |
| POST | `/rooms/{id}/invites` | participants | Invite a friend; notifies them (`409` on duplicate) |
| GET | `/rooms/invites` | anyone | Caller's pending room invites (cross-game) |
| POST | `/rooms/invites/{inviteId}/accept` | invitee | Join the room (seat assigned) |
| POST | `/rooms/invites/{inviteId}/decline` | invitee | Decline (`204`) |
| POST | `/rooms/{id}/open` | host | Open to matchmaking; starts the backfill countdown |
| POST | `/rooms/quick-join` | anyone | Join the oldest open room with a free seat for the game, optionally matching filters |
| POST | `/rooms/{id}/start` | host | Backfill empty seats with AI, status → `Playing` |
| POST | `/rooms/{id}/leave` | participants | Leave; in Lobby/Open the seat is removed, in Playing the seat converts to an AI participant — or, in a join-in-progress room, is vacated |
| POST | `/rooms/{id}/seats` | host | Re-balance seats before the match starts |
| POST | `/rooms/{id}/result` | host | Submit the result; room → `Closed` |
| GET | `/rooms/mine` | anyone | Caller's active room, if any (reconnect) |
| GET | `/rooms/joined[?gameSlug=]` | anyone | Every room the caller holds a seat in, worlds included (an empty list when none) |

### Create a room — `POST /rooms`

```json
{ "gameSlug": "my-game", "teamCount": 2, "seatsPerTeam": 5, "backfillAfterSeconds": 30, "aiPlayers": 0, "backfillAiPlayers": 4, "name": "Friday night", "isVisible": false, "metadata": { "map": "arena" } }
```

- `gameSlug` is required for full user tokens. With a game-scoped launch token the slug is taken from the token's `game_scope` (a mismatching body value is rejected with `403`).
- Caps: `teamCount` 1–2, `seatsPerTeam` 1–100, total seats ≤ 100 (one team of 100, or two of 50). `backfillAfterSeconds` defaults to `30` and must be
  at least `1` (`400` otherwise); there is **no maximum** beyond the size of a 32-bit integer. A long
  countdown only holds while somebody stays connected, though: an `Open` room with nobody on
  `ws/v1/realtime` closes after 60 minutes (see [Automatic room lifecycle](#automatic-room-lifecycle)),
  so a countdown longer than that is reached only if a participant keeps a socket open.
  Large rooms are bandwidth-bound, not seat-bound: every guest's frames go to the host, and every host frame is copied to every guest — see [Sizing a large room](#sizing-a-large-room).
- `aiPlayers` defaults to `0`. Range `0`–`(teamCount × seatsPerTeam) − 1` — the host always needs a seat, so a fully-AI room is a `400`.
- `backfillAiPlayers` caps how many seats still empty when the match starts are given to AI — see [Backfill allowance](#backfill-allowance). Omitted or `null` fills them all.
- `joinInProgress` (default `false`) keeps the room taking players after it starts — see [Join in progress](#join-in-progress).
- One active room per user: creating or joining while you are in any non-`Closed` room returns `409`.
- The creator becomes the host, seated at team 0, slot 0. Returns the room.

#### AI players

`aiPlayers` says how many AI players the **match should start with**. They are not a promise redeemed later — the server seats them immediately, so the room you get back already contains them:

- They are ordinary participants (`isAi: true`, `userId: null`, unique nickname) and appear in the roster and in every `roster` push from the moment the room exists.
- They **occupy seats**, so they reduce the capacity left for humans: invites and quick-join fill only what remains, and `POST /rooms/invites/{id}/accept` returns `409` once no free seat is left. You get exactly the number of AI you asked for — never more from matchmaking.
- Placement fills the **emptiest team first** (ties go to the lower team index), lowest free slot. So a `teamCount: 2, seatsPerTeam: 1` room with `aiPlayers: 1` puts the AI opposite the host, and bigger rooms stay balanced. Re-seat them however you like with `POST /rooms/{id}/seats` before the match starts.
- They are separate from start-time backfill, which fills seats nobody took when the room starts — up to the room's [backfill allowance](#backfill-allowance).

#### Backfill allowance

When a room starts — at its backfill deadline, as soon as it fills, or on the host's force-start —
seats nobody took are given to AI players. `backfillAiPlayers` decides how many:

| `backfillAiPlayers` | At start |
|---|---|
| omitted / `null` (default) | every empty seat becomes an AI player |
| `0` | no AI: the match starts with the empty seats left empty |
| `n` | at most `n` empty seats become AI; any beyond that stay empty |

Capped AI go to the **emptiest team first** (ties to the lower team index), so a `2 × 3` room with
one host and `backfillAiPlayers: 3` starts 2-vs-2. Range `0`–`teamCount × seatsPerTeam`, else `400`.
The host can change it before the match with `PATCH /rooms/{id}` (`"backfillAiPlayers": 2`), or
return to filling every seat with `"backfillAllEmptySeats": true`. It does not affect `aiPlayers`,
who are seated when the room is created.

If your game is meant to be played underfilled — a free-for-all that is fine with six of eight
players — use `0` and let your game handle the empty seats. With the default, a room never starts
with an empty seat.

**Playing solo against the computer** is therefore two calls — create the room with every other seat as AI, then start it:

```http
POST /api/v1/realtime/rooms
{ "gameSlug": "chess", "teamCount": 2, "seatsPerTeam": 1, "aiPlayers": 1 }

POST /api/v1/realtime/rooms/{id}/start
```

AI seats are identities and seat reservations, not a bot service — nothing on the platform plays them for you. A host-routed game drives them in its own simulation; a game with a `server=` script finds them in `ctx.room.roster` flagged `ai: true` and plays them inside the script (see [Game Scripts](game-scripts.md#room-bound-sessions)).

### Invites

`POST /rooms/{id}/invites` with `{ "toUserId": "<guid>" }`. Invites are **friends-only** (`403` otherwise; the same friendship rule as game invites), participants only, and only while the room takes joins: in `Lobby`/`Open`, or `Playing` with [`joinInProgress`](#join-in-progress). `409` if the user is already in the room or already has a pending invite; `400` when inviting yourself. Returns the invite.

**The invitee is notified for you.** Sending a room invite emits a [`game_invite` push](chat.md#game_invite-one-event-for-both-invite-systems) on the invitee's chat socket and adds the invite to `GET /api/v1/me/game-invites`, so a friend who is in the StarHermit dashboard (or anywhere but your game) still hears about it. You do **not** need to also send a games-API invite — that would notify twice. The response's `notified` tells you whether the push reached a live connection; `false` just means the invitee is not connected right now and will see the invite from their inbox instead.

Because one notification covers both invite systems, its payload carries `kind: "room"` plus `roomId` and the `acceptPath`/`declinePath` for **this** invite. Answer a room invite at the realtime endpoints below — a room invite id is not valid at `/games/{slug}/invites/...` and vice versa.

`GET /rooms/invites` lists the caller's pending room invites across all games (launch tokens see only their own game's). Use it as the room-invite inbox a game client polls. The unified invite inbox at `GET /api/v1/me/game-invites` returns these too.

`POST /rooms/invites/{inviteId}/accept` seats the caller and returns the room. **Party pinning**: invite-joins are seated on the host's team while space lasts, then overflow to other teams. `409` if the room is full, already started/closed, or the caller is in another active room ([worlds](#worlds-do-not-count-as-your-room) excepted). Accepting an invite to a room the caller already sits in just accepts it.

`POST /rooms/invites/{inviteId}/decline` → `204`.

### Matchmaking

`POST /rooms/{id}/open` (host only): `Lobby` → `Open`, sets `openedAt`, and starts the backfill countdown. Idempotent while already `Open`; `409` once `Playing`/`Closed`.

An `Open` room does not wait out its countdown once **every seat is taken** — by humans or by AI players configured at creation. It starts there and then, so the response to `open` (or to the join that filled the last seat) can already be a `Playing` room with `startedAt` set. A room created with AI in every seat but the host's therefore starts the moment it is opened.

`GET /rooms?gameSlug=` browses that game's open, listed rooms that still have a seat, oldest-open first, capped at 50. Each row has name, host name, player/capacity counts, `freeSeats`, metadata, `startedAt` and `joinInProgress` — **no join code and no roster**. Add `includeInProgress=true` to also list running [join-in-progress](#join-in-progress) rooms with a vacant seat, after every room still filling.

`POST /rooms/join-by-code` with `{ "joinCode": "K7MP2X" }` takes a seat. Codes are whitespace- and case-insensitive. Unlike quick-join this works on an unlisted room still in `Lobby`. The code is released when the room closes.

`PATCH /rooms/{id}` (host): `{ "name", "isVisible", "metadata", "joinInProgress", "backfillAiPlayers", "backfillAllEmptySeats", "expectedRevision" }`. Omitted fields are left alone; send `name: ""` to clear the name. A `Playing` room can still be renamed, listed or unlisted, have its metadata replaced and switch `joinInProgress`; backfill settings are refused (`409`) once the match has started.

`POST /rooms/{id}/matchmake` (host, `Lobby` only) queues the room's **human** roster as one
party/team; pre-seated AI participants are not party members. With the default policy, party size
must equal the selected queue's `teamSize`. With a [manifest start deadline](../starhermit-txt.md#starting-matchmaking-before-every-human-seat-is-filled),
a smaller party can occupy a larger team at the deadline; remaining seats become AI up to the
game's configured cap, then stay empty. Parties stay together and tickets are not combined into one team.

Use `?queue=duos` for one shape or repeat `?queues=` to allow a subset, as in the Games API:

```http
POST /api/v1/realtime/rooms/{id}/matchmake?queues=duos&queues=trios
Authorization: Bearer <token>
```

Returns the [matchmaking ticket](games.md#post-apiv1gamesslugmatchmaking), including `status` and
`sessionId` when matched. The host polls `GET /api/v1/games/{slug}/matchmaking` and cancels with
`DELETE` on that path. An already-queued room or a party that fits none of the allowed shapes
returns `409`. This authoritative matchmaking flow is separate from opening a room for quick-join
and its room-level backfill countdown.

`POST /rooms/quick-join` with `{ "gameSlug": "my-game", "seats": 1 }` places the caller in the **oldest open room with a free seat** for that game slug — AI seats count as taken, so a room whose remaining seats are all AI is skipped. `404` when no room qualifies — the client should then create its own room and open it. Only single-seat quick-join is supported (`seats` must be `1`).

**Filters.** Add any of these to join only a room that fits; every filter given must hold, and
none given is the behaviour above:

```json
{ "gameSlug": "my-game", "seats": 1, "teamCount": 2, "seatsPerTeam": 4, "metadata": { "mode": "ranked", "map": "arena" }, "includeInProgress": true }
```

| Filter | Matches a room whose… |
|---|---|
| `teamCount` | team count is exactly this |
| `seatsPerTeam` | seats per team is exactly this |
| `metadata` | metadata contains **every** property given, with an equal value. Properties you do not name are ignored, so `{"mode":"ranked"}` matches `{"mode":"ranked","map":"desert"}`. Values compare as JSON: numbers by value (`1` equals `1.0`), objects regardless of key order, arrays in order. Must be an object (`400` otherwise). |

`includeInProgress: true` also considers listed, running [join-in-progress](#join-in-progress) rooms with a vacant seat; rooms still filling come first either way. Without it a running match is never joined, so a client that predates join-in-progress never lands in one. A `metadata` filter carrying an id your game put in the room's metadata is how a client joins **one particular** listed room, since listings carry no join code.

The oldest matching open room with a free seat wins. When none matches, the `404` says
`"No open room with free seats matches those filters."` — the usual cue to create and open a room
with that metadata yourself, so the next player's filtered quick-join finds it.

### Start, seats, leave, result

`POST /rooms/{id}/start` (host only): fills **still-empty** seats — all of them, or up to the room's [backfill allowance](#backfill-allowance) — with AI participants (`isAi: true`, `userId: null`, unique random nickname) — AI players seated at creation keep their id, nickname, and seat — freezes the roster, sets `status: "Playing"`, and returns the frozen roster. If the game has a server backend (a `server=` script or a container), this also creates the room-bound session (see [the bridge](#room-bound-sessions)); the returned room and roster push carry `gameSessionId`. A **container** session that cannot be created — most often a deployment still waking from idle — leaves the room unstarted: `start` answers that error (retry it), and a full room or the backfill sweep retries on its next pass. A script failure still starts the room host-routed. **Idempotent** — starting a `Playing` room returns the roster again. A room may start automatically when its backfill deadline passes.

`POST /rooms/{id}/seats` (host only, `Lobby`/`Open` only) re-seats participants:

```json
{ "seats": [ { "participantId": "<guid>", "team": 1, "slot": 0 } ] }
```

`400` for seats outside the room's team/slot bounds or unknown participants; `409` if two participants would share a seat.

`POST /rooms/{id}/leave` behaves per room status:

- **Lobby/Open**: the seat is removed. If the **host** leaves, the host role transfers to the longest-serving remaining human participant; if no humans remain, the room is `Closed`.
- **Playing, [join-in-progress](#join-in-progress) room**: the seat is **vacated** (not given to AI), the player is removed from the bound session (their `ws/v1/games` sockets close) and the game is told. When the last human leaves and the bound session is still active, the room is **not** closed: the world stays listed and joinable, and the first player back takes the host role.
- **Playing (AI takeover)**: the match continues — the leaver's seat becomes an AI seat: `isAi: true`, `userId: null`, with a fresh unique nickname and the same participant `id`, `team`, `slot`, and `joinedAt`. The leaver is immediately freed (the one-active-room rule no longer counts them, so they can create or join another room) while the roster push tells every client an AI now occupies that seat. If the leaver is the **host** and at least one other human remains, the host role transfers to the longest-joined remaining human and the room stays `Playing` (client-side host migration is the game's concern); if no humans remain, the room is `Closed`.

Returns the room.

`POST /rooms/{id}/result` (host only, `Playing` only) records the outcome, closes the room, and fans the result out over the WebSocket. **Host-routed games only** — a room with a bound scripted session ends when the script returns `result`, which closes the room automatically (see [the bridge](#room-bound-sessions)).

```json
{ "teamScores": [3, 1], "metadata": { "durationSeconds": 360 } }
```

`teamScores` must have exactly one entry per team; each score is sanity-clamped to 0–50. The clamped result is stored on the room's `result` and pushed to connected participants as a `{"type":"result"}` control frame.

`GET /rooms/mine` returns the caller's current non-`Closed` room (for reconnects), or `404`. A player
who also belongs to [worlds](#worlds-do-not-count-as-your-room) gets the room that occupies them, else the
world they joined most recently.

`GET /rooms/joined` lists **every** room the caller holds a seat in, newest first — their worlds as
well as the one room that occupies them — as full rooms (roster and join code included). A launch
token sees only its own game's rooms; with a full token, `?gameSlug=` narrows it. It answers an empty
list, not a `404`, so a client can ask on every start without a logged error.

### Join in progress

A room created (or `PATCH`ed) with `"joinInProgress": true` keeps taking players after `start`.
Invites, `join-by-code` and quick-join with `includeInProgress: true` then work on a `Playing` room
with a **vacant** seat — nobody in it, not an AI — so such a room is normally started with
`"backfillAiPlayers": 0`. Without the flag a started room refuses every join, as before.

- **The game decides.** If the room is bound to a game session, the newcomer is admitted to that
  session before the seat is kept: the platform asks a script's `game.onMembershipChange(ctx)` or a
  container's [`POST /sessions/{id}/members`](container-games.md#post-sessionssessionidmembers). A game
  that refuses (or has neither) gets the seat back and the join is a `409`; an accepted invite stays
  pending. Once admitted, the player is a session player in every sense — valid on `ws/v1/games`,
  in restores and reconnects.
- **Leaving vacates the seat** and removes the player from the session, and the game is told.
- **The world outlives its visitors.** When the last human leaves and the session is still active,
  the room stays open, listed and joinable; the first player back becomes host. A room bound to an
  active session is also not closed for its host going offline (see
  [the 60-second host rule](#the-60-second-host-rule-and-room-bound-sessions)). The session's own
  lifecycle decides when it is over — a [persistent](../tutorials/persistent-sessions.md) game pauses
  instead of ending — and the room closes with it.
- **Finding one.** `GET /rooms?includeInProgress=true` lists running join-in-progress rooms with a vacant
  seat; `POST /rooms/quick-join` with `includeInProgress: true` joins one (add a `metadata` filter to
  pick a particular room). Quick-join passes over rooms the caller already sits in.

#### Worlds do not count as your room

A player may be in **one active room at a time**: creating, joining by code, quick-joining or
accepting an invite is a `409 "You are already in an active room."` while they hold a seat in another
room that is not closed. A seat in a **world** does not count: a `Playing`, `joinInProgress` room bound
to an active session of a [persistent](../tutorials/persistent-sessions.md) game. A world lasts as long
as its session and its room stays open after the last visitor leaves, so a seat in one is membership,
not a lobby the player is sitting in — they can belong to several worlds, in any games, and still use
one ordinary room. A join-in-progress match that is not persistent still counts: it ends, and while
it runs the player is in it. A second seat in the same room is refused (`409`) on every path. List a
player's worlds with [`GET /rooms/joined`](#start-seats-leave-result).

## WebSocket: `ws/v1/realtime`

Connect to `wss://api.starhermit.com/ws/v1/realtime?roomId=<guid>` with a JWT via the `Authorization` header, `?ticket=` from `POST /api/v1/realtime/connection-tickets`, or `?access_token=`. Prefer the ticket: it is one-use and seconds-lived. **Participants only** (`403` otherwise); a launch token's `game_scope` must equal the room's `gameSlug`. The newest connection supersedes the user's previous one — the old socket is closed with `PolicyViolation` ("Superseded by a newer connection").

### Binary frames (gameplay)

Binary frames are the gameplay channel for **host-routed** games (room-bound scripted sessions play over `ws/v1/games` instead — see [the bridge](#room-bound-sessions)). The server **never parses** their payloads — host authority is the game's contract — but it enforces routing and identity:

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

## Sizing a large room

A room holds up to 100 players, but the practical limit is bandwidth. The binary channel is
host-routed:

- every guest frame goes to the host;
- every host frame is copied to every guest;
- each frame carries a 16-byte sender prefix.

Two things follow:

- **The host's download grows with the number of guests.** It receives every guest's input.
- **Platform egress grows with the square of the room size.** A host snapshot that describes every
  player grows with the player count, and it is copied to every guest.

Worked example: 100 players. Each guest sends 30 inputs/s of 32 bytes. The host sends 20
snapshots/s at 12 bytes per player, about 1.2 KB each. Per-message TLS/TCP/WebSocket overhead is
taken as about 70 bytes.

| Link | Rate |
|---|---|
| Each guest, upload | ~26 kbit/s |
| Each guest, download | ~0.21 Mbit/s |
| Host, upload | ~0.21 Mbit/s |
| **Host, download** | **~2.8 Mbit/s, as ~3,000 messages/s** |
| **Platform egress for the room** | **~23 Mbit/s (~10.5 GB per hour)** |

The same game at other sizes shows the quadratic growth in platform egress:

| Players | 8 | 22 | 50 | 100 |
|---|---|---|---|---|
| Platform egress | ~0.4 Mbit/s | ~1.8 Mbit/s | ~6.9 Mbit/s | ~23 Mbit/s |

The per-connection limits bound the worst case, not the typical one. A 100-player room in which
every connection sends 8 KB frames at 30/s is about **390 Mbit/s** of platform egress.

For a large room:

- **Keep guest input rates low** (10–20 Hz), and send inputs only when they change. The host
  receives every guest's input, and handling thousands of messages per second is usually a harder
  limit for a browser host than the bandwidth.
- **Keep snapshots small.** Quantize positions, send deltas against the last acknowledged state,
  and spread entities that rarely change across several snapshots. A single frame is at most
  8 KB, which leaves about 80 bytes per player at 100 players.
- **The room channel cannot target one guest.** Host frames go to everyone, so every guest
  receives the whole world. If your game needs per-player interest management (only nearby
  players, fog of war), run it on a [container game server](container-games.md) instead. A
  container can address frames to individual players, and the host is no longer a player's home
  connection.

## Automatic room lifecycle

- An `Open` room starts automatically when its backfill deadline passes; empty seats become uniquely named AI participants, up to the room's [backfill allowance](#backfill-allowance).
- An `Open` room also starts automatically as soon as every seat is taken — by humans, by AI players configured at creation, or a mix — without waiting for that deadline.
- A `Playing` room closes when its host has no active WebSocket connection for more than 60 seconds — unless it is bound to a game session that is still active (see below). Connected guests receive a final roster push showing the room closed.
- A `Lobby` or `Open` room closes after more than 60 minutes without connected participants.

A participant who merely loses their connection is not affected: reconnecting the socket (newest connection supersedes) and `GET /rooms/mine` both keep working while the room is alive.

### The 60-second host rule and room-bound sessions

**A server-run match does not belong to its host.** A `Playing` room bound to a game session that is
still `active` is never closed for its host being offline: the host role moves to a connected human
if there is one, and otherwise nothing happens. The session's lifecycle decides when the match is
over, and closes the room when it is. The rule below applies to host-routed rooms (no session), and
to a bound room once its session has ended.

**Only a `ws/v1/realtime` socket counts as the host's connection.** A host who is connected to the
bound session on `ws/v1/games` but has closed (or never opened) the realtime socket is "away" for
this rule, and the room closes 60 seconds later. A game that plays over `ws/v1/games` must keep the
host's realtime socket open for the whole match, even if it only uses it for roster pushes. The clock
starts when the host's last realtime socket closes; a host who never connected is measured from the
room's `startedAt`.

**Closing the room does not end its room-bound session.** The sweep closes the room (roster push,
every seat freed, pending invites expired) and nothing else:

- The session stays `active`. Its players can keep playing on `ws/v1/games`, and the script keeps
  running at its tick rate.
- From the next invocation on, `ctx.room.roster` is **empty** and every human in `ctx.presence` has
  `left: true`, because closing the room frees every seat. `online` still reflects `ws/v1/games`
  sockets. A script that treats "everyone left" as the end of the match should return `result` then.
- If the script later returns `result`, the session finishes as usual, but the room's `result` stays
  `null`: the room was already closed, so the result is stored on the session only.
- If the script never returns `result`, the session is retired like any other game session: 5 minutes
  after the last `ws/v1/games` socket closes, or after 24 hours with no player action (see
  [Games — Session model](games.md#session-model)).

In short: if your match must survive the host stepping away from the room socket, don't rely on the
room; if it must end with the room, end it in the script when `ctx.presence` shows everyone left.

## Security summary

- Every endpoint works with a full JWT **or** a game-scoped launch token; a launch token's `game_scope` must match the room's `gameSlug`, so two games can never see or join each other's rooms.
- Reads are participant-only (plus pending invitees); `open`, `seats`, `start`, and `result` are host-only; invites are friends-only.
- Validation: seat/team caps, an AI count that always leaves the host a seat, one active room per user (worlds excepted), one occupant per seat, idempotent start, result scores clamped to 0–50, invites expire with the room.
- Transport: server-tagged sender ids, role-based routing, frame size caps, per-connection rate limits, no server-side parsing of binary payloads.

## Room-bound sessions

For a game with a server backend — a `server=` script in its manifest, or a [container](container-games.md) — a realtime room can run its match **server-authoritatively** instead of on the host client. The points below are written for scripts; a container receives the same roster through its `POST /sessions` ctx (`room`, `presence`) and membership changes through `POST /sessions/{id}/members`. This combines rooms (lobby, invites, matchmaking, backfill) with server-side simulation, validated inputs, and script-owned results.

- **Session creation on room start.** When the room enters `Playing`, the platform creates an N-player [game session](games.md) for the human participants. AI seats exist only in the script-facing roster. The room response and roster pushes expose `gameSessionId` so clients know which gameplay socket to open.
- **Gameplay moves to `ws/v1/games`.** Clients connect to `ws/v1/games?sessionId=<gameSessionId>` and exchange `cmd`/`game` frames with the script, exactly like any scripted game; the realtime WS stays connected for roster/presence only. The session ticks at the supported rate requested by its script via `game.tickRateHz` — a script that requests nothing is ticked at 0.25 Hz, which no realtime game wants, so declare one (see [Game Scripts](game-scripts.md#tick-rate)).
- **Extended script ctx.** Every invocation for a room-bound session (`createSession`, `onPlayerMessage`, `onTick`) additionally receives `ctx.room` (room id, metadata, and the frozen roster — humans *and* AI seats, ordered by team then slot) and `ctx.presence` (`{ "<userId>": { online, left } }` for every user who is or was a human participant). Details in [Game Scripts — Room-bound sessions](game-scripts.md#room-bound-sessions).
- **Server-authoritative achievements.** Every hook of a bound session can grant achievements by returning `achievements: {userId: [keys]}`, exactly as in any scripted game — including from `createSession`, which fires the moment the room starts. Unlocks are pushed to the earning player over `ws/v1/games` as `{"type":"achievement"}` frames. See [Achievements](achievements.md#server-authoritative-game-achievements).
- **The script ends the match.** When the script returns `result`, the platform finishes the session, stores the result on the room, and closes the room (final roster push included). `POST /rooms/{id}/result` is not used for room-bound games.
- **Failure isolation.** A room stays playable if session creation fails — the bridge is best-effort at start and the room falls back to host-routed behavior.
- **A host-routed game can bind a session purely for achievements.** The binary gameplay channel is never gated on a bound session, so a game that simulates on the host client can still ship a `server=` script whose only job is authoritative achievement (and elo) grants, while the fast path keeps flowing over `ws/v1/realtime`.

## How a game uses it

1. **Create**: the lobby creator calls `POST /rooms` with its team layout, an opaque `metadata` blob, and however many `aiPlayers` the match should start with, and becomes host. Filling every other seat with AI here is the whole solo-versus-computer flow.
2. **Invite**: the host lists friends (`GET /api/v1/me/friends`) and sends `POST /rooms/{id}/invites`. The platform notifies each invitee (`game_invite` push + `GET /api/v1/me/game-invites`), so they can accept from the dashboard without having your game open; invitees already in the game see the same invites by polling `GET /rooms/invites`. Accepting seats them on the host's team.
3. **Open**: the host calls `POST /rooms/{id}/open`. Solo players call `POST /rooms/quick-join` and land in the oldest open room with a free seat (on `404` they create and open their own room).
4. **Connect**: everyone opens `ws/v1/realtime?roomId=…` and watches `roster`/`presence` pushes as seats fill.
5. **Start**: at the backfill deadline, as soon as every seat is taken, or when the host force-starts, remaining empty seats become AI participants (up to the [backfill allowance](#backfill-allowance)) and the roster freezes. **Host-routed game**: guests send inputs as binary frames (they reach only the host); the host broadcasts snapshots. **Room-bound scripted game**: everyone connects `ws/v1/games?sessionId=<gameSessionId>` and plays against the script with `cmd`/`game` frames.
6. **Leave mid-match**: in a [join-in-progress](#join-in-progress) room the seat is vacated for the next player. Otherwise a player who leaves during `Playing` is replaced where they sat by an AI participant (same seat, new server-generated nickname) and can immediately queue again; if the host leaves, the host role passes to the longest-joined remaining human. A host who drops their connection has 60 seconds to reconnect before the match closes.
7. **Finish**: host-routed — the host POSTs the result; the server clamps scores, stores the result, pushes it to all sockets, and closes the room. Room-bound — the script returns `result` and the platform stores it and closes the room.

## See also

- [Relay](relay.md) — opaque byte fan-out bound to a game session or realtime-room roster; availability may vary
- [Games](games.md) — server-authoritative scripted games
- [Authentication](auth.md) — launch tokens and game-scope fencing
- [Friends](friends.md) — the friend list used by the invite picker
