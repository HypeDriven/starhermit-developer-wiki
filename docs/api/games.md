# Games API

The games subsystem is the core of StarHermit: server-authoritative multiplayer games whose rules run either in a sandboxed JavaScript file or a developer-supplied container. Both runtimes share this player-facing REST API (`api/v1/games/{slug}`) and gameplay WebSocket (`ws/v1/games`). For server authoring, see [Game Scripts](game-scripts.md) or [Container-hosted Game Servers](container-games.md). For a complete script-runtime example, see the [Chess Walkthrough](../tutorials/chess-walkthrough.md) and [HypeDriven/starhermit-chess](https://github.com/HypeDriven/starhermit-chess).

**Base URL:** `https://api.starhermit.com`.

Player endpoints require authentication and work with both full user tokens and game-scoped launch
tokens. The two `/server/...` endpoints are container-only: session reconciliation uses a narrow
server bearer token, while token renewal uses the deployment refresh key.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|

## What `{slug}` is

A game's slug is its **uid** — the same value as its `<uid>.starhermit.com` address, e.g.
`83fd04b1-3cbe-4b09-a251-3733ad4b9d94`. It is derived from the game's immutable id and **nothing
can set it**: not `starhermit.txt`, not the repo name, not an operator. A name a developer could
choose would be something two games could contend for, and would need the platform to arbitrate who
got it; a uid can neither collide nor be asked for.

Do not hard-code it. Read it from the launch token's `game_scope` claim, or — for a
platform-hosted browser game — from `location.hostname`, since the subdomain is the uid.

| GET | `/api/v1/games/{slug}` | Bearer | Game info + caller's stats |
| POST | `/api/v1/games/{slug}/launch-token` | Bearer | Mint a game-scoped launch token |
| GET | `/api/v1/games/{slug}/achievements` | Bearer | The game's achievements + the caller's unlock state |
| GET | `/api/v1/games/{slug}/controls` | Bearer | Get the caller's effective control bindings |
| PUT | `/api/v1/games/{slug}/controls` | Bearer | Replace the caller's control overrides |
| DELETE | `/api/v1/games/{slug}/controls` | Bearer | Reset the caller's controls to manifest defaults |
| GET | `/api/v1/games/{slug}/settings` | Bearer | The caller's stored settings for this game, plus the size limits |
| PUT | `/api/v1/games/{slug}/settings` | Bearer | Replace the caller's whole settings map |
| PATCH | `/api/v1/games/{slug}/settings` | Bearer | Merge into the stored map; `null` removes a key |
| DELETE | `/api/v1/games/{slug}/settings` | Bearer | Clear every setting the caller stored for this game |
| GET | `/api/v1/games/{slug}/settings/{key}` | Bearer | One setting, or `404` |
| PUT | `/api/v1/games/{slug}/settings/{key}` | Bearer | Store one setting |
| DELETE | `/api/v1/games/{slug}/settings/{key}` | Bearer | Remove one setting |
| GET | `/api/v1/games/{slug}/sessions/mine` | Bearer | Caller's active sessions |
| GET | `/api/v1/games/{slug}/sessions/{sessionId}` | Bearer | Session detail (participants only) |
| POST | `/api/v1/games/{slug}/sessions/ai` | Bearer | Create a practice session vs the platform AI |
| GET | `/api/v1/games/{slug}/queues` | Bearer | Match shapes this game accepts |
| POST | `/api/v1/games/{slug}/matchmaking` | Bearer | Enqueue for nearest-elo matchmaking (`?queues=` subset) |
| GET | `/api/v1/games/{slug}/matchmaking` | Bearer | Latest ticket while it is still joinable |
| DELETE | `/api/v1/games/{slug}/matchmaking` | Bearer | Cancel queued tickets |
| GET | `/api/v1/games/{slug}/diagnostics` | JWT (owner) | Live sessions, script metering, queue, webhook health |
| GET | `/api/v1/games/{slug}/webhooks` | JWT (owner) | List webhook endpoints |
| POST | `/api/v1/games/{slug}/webhooks` | JWT (owner) | Create a webhook; secret returned once |
| DELETE | `/api/v1/games/{slug}/webhooks/{id}` | JWT (owner) | Delete a webhook |
| POST | `/api/v1/games/{slug}/webhooks/{id}/resume` | JWT (owner) | Clear the breaker after fixing the endpoint |
| POST | `/api/v1/games/{slug}/invites` | Bearer | Invite a friend to a game |
| GET | `/api/v1/games/{slug}/invites` | Bearer | Incoming pending + all outgoing invites |
| POST | `/api/v1/games/{slug}/invites/{inviteId}/accept` | Bearer | Accept an invite (creates the session) |
| POST | `/api/v1/games/{slug}/invites/{inviteId}/decline` | Bearer | Decline an invite |
| GET | `/api/v1/me/game-invites` | Bearer | All pending invites — every game, both invite systems (max 50) |
| GET | `/api/v1/games/{slug}/replays/mine` | Bearer | Caller's finished sessions (games with replays) |
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
  "replaysEnabled": true,
  "buildId": "s12",
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
- `replaysEnabled` says whether this game's finished sessions are kept — read it rather than assuming, and hide your replay UI when it is `false`. See [Replays](#replays).
- `buildId` names the server logic currently serving the game (`s` + script version, or `c` + image digest prefix). Send it back as `ws/v1/games?build=…` so a stale client is refused with `409 {"error":"build_mismatch"}` before it acts on moved fields. Omitting `build` connects as before.

## Launch tokens

### `POST /api/v1/games/{slug}/launch-token`

Mints a game-scoped JWT (default lifetime 60 minutes) carrying `game_scope={slug}` and no permission claims. A scoped token may re-mint a token for its own game — this is the client refresh pattern — but renewal is bounded by `launch_chain` (default 12 hours from the original user session). Past that ceiling renewal is `403`. Clients should refresh before the token expires; the chess reference client, for example, refreshes every 45 minutes.

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

## Per-player game settings

Where your game keeps **its own options** for a player — master volume, graphics detail, subtitle
size, preferred camera, last chosen loadout — so they follow that player to any machine they sign in
from. A key/value store scoped to one player and one game.

**Nothing declares a schema.** The platform stores your keys and your values and never reads them,
so you add an option by writing it: no manifest entry, no redeploy, no platform release. That also
means the platform cannot validate them for you — a typo in a key name is a new setting, not an
error.

Like the controls API, a game-scoped launch token is accepted (its `game_scope` must match `{slug}`),
so an in-game options screen works with nothing but the token the game already holds. Unlike
controls, no manifest declaration is needed: every game has settings storage from the moment it
exists, including a browser-only game with no server logic at all.

Pick the right store — [cloud saves](catalog.md) hold progress (one opaque archive per title, 10 MB),
and a script or container backend's own player state is server-authoritative and not writable from a
client. Settings are the small, client-owned preferences in between.

### `GET /api/v1/games/{slug}/settings`

Everything the caller has stored for this game. `settings` is empty for a player who has never saved
anything — that is a `200`, not a `404`. Keys come back sorted.

```json
{
  "slug": "83fd04b1-3cbe-4b09-a251-3733ad4b9d94",
  "settings": {
    "audio.master": 0.8,
    "graphics.detail": "ultra",
    "graphics.options": { "shadows": true, "msaa": 4 }
  },
  "count": 3,
  "bytes": 118,
  "updatedAt": "2026-08-07T15:04:11Z",
  "limits": { "maxKeys": 200, "maxKeyLength": 128, "maxTotalBytes": 2097152 }
}
```

`bytes` is what this player's settings currently cost against `limits.maxTotalBytes`. Read the
limits rather than hard-coding them: the allowance is an operator setting, and a game can be granted
its own.

### `PUT /api/v1/games/{slug}/settings`

Replaces the whole map. **Keys the body omits are deleted** — send everything, or use `PATCH`.

```json
{ "settings": { "audio.master": 0.8, "graphics.detail": "ultra" } }
```

An empty `settings` object clears the game's settings for the caller. Returns the same shape as
`GET`.

### `PATCH /api/v1/games/{slug}/settings`

Merges into what is stored, leaving keys it does not mention alone. A `null` value **removes** its
key ([JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396), same semantics). This is what an
options screen should use — it can save the one slider that moved without first reading and
rewriting everything else.

```json
{ "settings": { "audio.music": 0.25, "graphics.options": null } }
```

### `GET` / `PUT` / `DELETE /api/v1/games/{slug}/settings/{key}`

One setting at a time. `GET` returns `{ "key", "value", "updatedAt" }`, or `404` if the caller has
never stored it. `PUT` takes `{ "value": <any JSON> }` and stores the value **verbatim** — including
an explicit `null`, which here is a value like any other, not a delete. `DELETE` returns `204`, and
removing something that is not there is a no-op rather than an error.

```bash
curl -X PUT "https://api.starhermit.com/api/v1/games/$SLUG/settings/audio.master" \
  -H "Authorization: Bearer $LAUNCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 0.35}'
```

### Rules

| Rule | Value |
|---|---|
| Setting names | 1–128 chars of `A-Z a-z 0-9 . _ - :` — namespace freely (`audio.master`, `graphics:shadows`) |
| Values | Any JSON: number, string, boolean, array, object, `null` |
| Settings per player, per game | 200 |
| Bytes per player, per game | **2 MB by default** — an operator may raise or lower it, and may grant one game a different allowance |

A single setting may use the entire byte allowance; there is no separate smaller per-value cap.

| Status | Meaning |
|---|---|
| `400` | Bad setting name, or a body that is not `{"settings": {...}}` / `{"value": ...}` |
| `404` | No game answers to that slug, or (single-key `GET`) nothing is stored under that key |
| `413` | Over the allowance — either too many settings, or too many bytes. The message states the limit |

A batch that contains one bad key writes none of the good ones. Settings are per player and per
game: nothing leaks between two players, or between two of the same player's games. They survive a
game being disabled or delisted, because they are the player's data rather than the game's.

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

Creates a practice session against the platform AI seat: fixed user id `00000000-0000-4000-8000-00000000a1a1`, username **"The House"**. The game's authoritative backend plays the AI — there is no external bot service.

```json
{ "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e" }
```

## Matchmaking

A game declares the shapes of match it accepts (`game.queues` in a script, or `/describe` for a
container). A game that declares none has one implicit 1v1. A client that names no queue gets the
game's first.

### `GET /api/v1/games/{slug}/queues`

```json
[
  { "key": "duos", "teams": 2, "teamSize": 2, "players": 4 }
]
```

### `POST /api/v1/games/{slug}/matchmaking`

Enqueues the caller for nearest-elo pairing. Repeatable `?queues=` query keys name a **subset** of
those shapes (e.g. 1v1 and 2v2, not 3v3). Matching only fills a ticket against a shape it allowed.
An unknown key is `404`; a list empty after validation is `400`. Returns `409` if the caller is
already queued or at their concurrent-session cap.

The search starts in a narrow elo band and widens while the ticket waits (default 100, +10/s).
Statuses: `queued`, `matched`, `cancelled`, `expired` (waited past the cap, default 300 s, without
finding anyone — offer a practice game rather than spin). A party is a [realtime room](realtime.md):
`POST /api/v1/realtime/rooms/{id}/matchmake` (host, lobby) enters the whole roster as one team.

```json
{
  "ticketId": "b3b7c8d2-5c1e-4f3a-9e2d-1a2b3c4d5e6f",
  "status": "queued",
  "sessionId": null,
  "waitedSeconds": 12,
  "searchEloBand": 220,
  "maxWaitSeconds": 300
}
```

### `GET /api/v1/games/{slug}/matchmaking`

Returns the caller's latest ticket, or `404`. A `matched` ticket is reported **only while its
session is still `active`**. After the match ends this is `404` so the lobby offers a new match
instead of pointing at a dead session id.

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
- `<gameSlug>` — the game's slug (`game_scope` claim). Games without an authoritative script or container backend use the GitHub game id (a GUID) instead; the dashboard accepts either.

When the recipient opens the link, the **dashboard** (not the game) does the automated friend-invite part — no new backend endpoints are involved, it composes the existing APIs:

1. Signs them in (OAuth via a live provider), or reuses their existing session. The link intent survives the sign-in round trip.
2. Shows a consent dialog naming the sharer and the game, then **friends the sharer**: it accepts the sharer's pending friend request if one exists, otherwise it sends one (`POST /api/v1/me/friend-requests`).
3. Prompts them to pick a nickname if their account has none (games display profile nicknames — see [Profile](profile.md)).
4. Launches the game (the platform-hosted `https://<game-id>.starhermit.com` copy, with a launch token in the `#game_token=` fragment as usual).
5. Sends the **play invite back to the sharer** with `POST /api/v1/games/{slug}/invites` — so a share link ends as a normal game invite the sharer accepts (dashboard toast, desktop balloon, or the game's own invite list). If the friendship is still a pending request, the dashboard queues the play invite and sends it automatically once the sharer accepts.

What this means for your game client:

- **Offering the link costs one line of string building** — put a "Share invite link" button next to your invite-a-friend UI and copy the URL to the clipboard. See `shareInviteLink()` in the [chess reference implementation](https://github.com/HypeDriven/starhermit-chess).
- **No special handling is needed on the receiving side.** The recipient's invite arrives through the normal invite flow: your `GET .../invites` polling shows the sharer the incoming invite, accepting it creates the session, and the recipient sees the session appear in `GET .../sessions/mine` (show pending outgoing invites so the wait is visible — the chess client's "invited — waiting" cards).
- The dashboard also uses these URLs itself: every playable hosted game's details pane has a **Copy invite link** button, and the Windows client offers the same from a game's context menu.

## Replays

A replay is a finished session's final state document, kept by the platform and served back to the
players who were in it. **Replays are an opt-in feature of a game, off unless the game asks for
them**, because a replay is storage the platform holds for as long as the match's record exists.

Ask for them in your server code — `replays: true` on the `game` object for a
[script](game-scripts.md#replays), `"replays": true` from `/describe` for a
[container server](container-games.md#get-describe) — and publish an update to apply it. A platform
operator can also answer for a particular game either way, so treat the `replaysEnabled` field of
`GET /api/v1/games/{slug}` as the answer rather than assuming your declaration is the last word.

Both endpoints below return `404` for a game whose replays are off, and nothing is kept from that
game's finished sessions — so a client that offers a replay screen should read `replaysEnabled`
first.

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

The full final state JSON as archived by the platform. Participants only. `recordedWith` is what
produced the document (script version, runtime, tick rate), stamped at finish — so a later redeploy
does not make old replays look like the current code wrote them. Matches finished before this
existed report `null`.

```json
{
  "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "players": [ { "userId": "...", "username": "alice" }, { "userId": "...", "username": "bob" } ],
  "finishedAt": "2026-07-20T15:42:37Z",
  "result": { "kind": "white-win", "reason": "checkmate" },
  "state": { "...": "game-specific final session state" },
  "recordedWith": { "scriptVersion": 12, "runtime": "script", "tickRateHz": 0.25 }
}
```

## Session model

- Session `status` is `"active"` or `"finished"`.
- Each session gets a per-session chat conversation (type `"game"`) so opponents can chat and voice-call **without being friends** (see [Chat](chat.md) and [Voice](voice.md)).
- Concurrent-session cap per player defaults to `20`.
- Matchmaking ticket statuses: `queued` | `matched` | `cancelled` | `expired`.
- Invite statuses: `pending` | `accepted` | `declined` | `cancelled`.
- **Sessions are created via matchmaking, invite-accept, the AI endpoint, or a realtime room start** (room-bound sessions — see [Realtime Rooms](realtime.md#room-bound-scripted-sessions)) — there is no "create lobby" endpoint.
- Elo updates come from the authoritative script (`eloUpdates`) or container control channel, are denormalized onto `GamePlayerState.Elo`, and are published to the game's leaderboard (score type `elo`). **Clients can never submit scores to a game leaderboard directly** (see [Leaderboards](leaderboards.md)).

## Gameplay WebSocket

`ws/v1/games?sessionId={guid}` (version-neutral route). Authenticate with the `Authorization` header, `?ticket=`, or `?access_token=`. Participants only (`403`); when connecting with a launch token, its `game_scope` must match the session's game. A finished session is `410 {"error":"session_not_active"}`. Optional `?build=` is the `buildId` from `GET /games/{slug}` — mismatch is `409 {"error":"build_mismatch"}`.

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
{ "type": "game", "data": { "...": "server-authorized message addressed to you" } }
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
- `resumed` — the session changed hands (container restore, or another Api process took the
  ownership lease). Discard local prediction; `lostMs` is the gap since the last durable write.
  The first attach after a handoff is announced once per player.
- `abandoned` — the platform ended the session without a winner or elo update. Reasons:
  `players_left`, `idle_no_players`, `superseded` (the player asked for a new game of this title),
  `server_failure`, `restore_failed`, `operator_ended` (the game's owner ended it). Stored as
  `{ "kind": "abandoned", "reason": "…" }`.

## Owner diagnostics and webhooks

Owner-only. A game-scoped launch token cannot reach these.

### `GET /api/v1/games/{slug}/diagnostics`

A snapshot of live sessions (active, finished, live connections), script metering against CPU /
memory / statement budgets, the matchmaking queue (longest wait and how far it has widened),
webhook endpoint health, and this process's unflushed write buffer.

### Webhooks

`GET/POST/DELETE /api/v1/games/{slug}/webhooks` and `POST .../{id}/resume`. Up to 5 endpoints per
game. Events: `session.created`, `session.finished` (omit `events` to subscribe to both). The
signing secret is returned **once**, on create.

The platform POSTs JSON with:

- `X-Starhermit-Signature: t=<unix>,v1=<hmac-sha256>` over `"<t>.<body>"`
- `X-Starhermit-Event-Id` — the event (idempotency key; repeats across retries)
- `X-Starhermit-Delivery` — this attempt

URL must be https and must not resolve to a private / loopback / CGNAT range (checked at
registration and again before each send). Redirects are not followed. Failed endpoints back off
and are disabled after consecutive failures; `resume` clears the breaker.

### Runtime timing

For JavaScript games, the platform runs `onTick` sweeps at the clamped rate requested through
`game.tickRateHz`; `0` disables ticks, and a game that requests nothing is ticked at **0.25 Hz** —
declare a rate if your gameplay depends on the tick. A container drives its own simulation loop and
declares its requested rate through `/describe`; the platform uses that rate for scheduling and
snapshot policy, not to step the game. See [Game Scripts — Tick rate](game-scripts.md#tick-rate) and
[Container Game Servers](container-games.md#protocol-v1).

## Lifecycle of a game

1. **Mint a launch token** — `POST /api/v1/games/{slug}/launch-token`. Clients should refresh it before expiry (the chess reference client refreshes every 45 minutes).
2. **Fetch game state** — `GET /api/v1/games/{slug}` for info + your stats; `GET .../sessions/mine` for games in progress; `GET .../invites` and `GET /api/v1/me/game-invites` for pending invites; `GET .../replays/mine` for history when `replaysEnabled`; `GET .../achievements` for the achievement screen.
3. **Find an opponent**, one of three ways:
   - **Matchmaking:** `POST .../matchmaking`, then poll `GET .../matchmaking` every 3 s until `status` is `matched` (the response carries `sessionId`). `DELETE .../matchmaking` to cancel.
   - **Invite flow:** pick a friend from `GET /api/v1/me/friends` (see [Friends](friends.md)), `POST .../invites` with `{ "toUserId": "..." }`; the invitee calls `POST .../invites/{inviteId}/accept`, which creates the session. (If your game seats players in a [realtime room](realtime.md) first, invite them to the room instead — same notification, but accepting puts them at the table you are already in.)
   - **AI practice:** `POST .../sessions/ai`.
4. **Load the session** — `GET .../sessions/{sessionId}`.
5. **Connect the WebSocket** — `ws/v1/games?sessionId={guid}` with the launch token, then send whatever initial-sync command the game's backend defines — the chess reference implementation, for example, sends `{"type":"cmd","data":{"type":"sync"}}`.
6. **Play** — exchange `cmd`/`game` frames as defined by the backend, surface `achievement` frames, and handle the container-only `resumed` frame.
7. **Result** — the authoritative backend ends the game; the platform publishes elo updates to the leaderboard and, for a game with [replays](#replays), archives the final state.
8. **Replay** — `GET .../replays/{sessionId}` for the full final state.

### Example: chess command shapes

The following payload shapes are the example: how the chess [reference implementation](https://github.com/HypeDriven/starhermit-chess) fills in `data`. **They are defined by chess's script, not by the platform** — every game defines its own command set and broadcast payloads in its authoritative backend. The client command envelope is `cmd`; common server envelopes include `game`, `error`, `presence`, and `achievement`, with `resumed`/`abandoned` additionally used for container recovery. The contents of `data` are backend-owned.

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
