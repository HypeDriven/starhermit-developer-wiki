# Achievements

An achievement belongs to exactly **one owner**, and the owner decides who is allowed to unlock it:

| Owner | Declared by | Unlocked by | Use it for |
|---|---|---|---|
| **An authoritative game** | `game.achievements` in a script, or `achievements` from a container's `/describe` | **The game's server runtime only** — server-authoritative | Games with a `server=` script or `container.image=` backend |
| **A catalog title** (`SoftwareTitle`) | A publisher, via the [publisher API](publisher.md#achievements) | The player's client, via `POST /api/v1/me/achievements/unlock` (entitlement required) | Distributed titles whose client is the only thing that knows the player earned something |

The two are mutually exclusive and the platform enforces the split:

- `POST /api/v1/me/achievements/unlock` **refuses game-scoped achievements** — a client can never claim one.
- The publisher CRUD endpoints refuse them too — a game's achievements are owned by its script, not by a publisher.

Base URL: `https://api.starhermit.com`. All routes are under `/api/v1/...`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/games/{slug}/achievements` | Bearer | An authoritative game's achievements + the caller's unlock state |
| GET | `/api/v1/software/{titleId}/achievements` | Anonymous | A catalog title's achievement definitions |
| GET | `/api/v1/me/achievements?titleId=` | JWT | The caller's unlocks (all owners, or one title) |
| POST | `/api/v1/me/achievements/unlock` | JWT | Client-claimed unlock — **catalog titles only** |

Errors are `{"error": "..."}` with standard status codes, except `POST /me/achievements/unlock`, which returns its `400` reason as a plain-text body rather than the JSON error envelope.

## Server-authoritative game achievements

This is the mechanism **any** game should use when it has a script or container backend. The
server runtime is the only writer, so an unlock cannot be forged by a modified client, a replayed
request, or a hostile peer.

### 1. Declare them in your script

Add a static `achievements` array to the `game` object — see
[Game Scripts — Achievements](game-scripts.md#achievements) for the full contract:

```js
globalThis.game = {
  achievements: [
    { key: "first-win",  name: "First Win",  description: "Win a match.", points: 10 },
    { key: "flawless",   name: "Flawless",   description: "Win without conceding.",
      points: 50, secret: true, icon: "https://cdn.example/flawless.png" }
  ],
  createSession(ctx) { /* ... */ },
  onPlayerMessage(ctx) { /* ... */ },
  onTick(ctx) { /* ... */ }
};
```

The declaration is read **when the game is published or updated** from its repository. Publish an update to apply a change.

### 2. Unlock them from any lifecycle hook

Return an `achievements` map — user id → array of keys — from `createSession`, `onPlayerMessage`,
or `onTick`:

```js
return {
  ok: true,
  sessionState: state,
  achievements: { [winnerId]: ["first-win", "flawless"] },
  result: { kind: "win", winner: winnerId }
};
```

Unlocks are **idempotent** — returning a key the player already holds is a no-op, so a script may
re-assert an achievement on every tick without worrying about duplicates.

### 3. The player is notified over the gameplay socket

Each newly granted unlock is pushed to the earning player only, on `ws/v1/games`, as its own frame
type (platform truth, not a script-relayed `game` message):

```json
{
  "type": "achievement",
  "data": {
    "key": "first-win",
    "name": "First Win",
    "description": "Win a match.",
    "icon": null,
    "points": 10,
    "unlockedAt": "2026-07-25T09:14:02Z"
  }
}
```

Unlocks granted from `createSession` are persisted before anyone has a socket, so they arrive with
no frame — read them from the list endpoint on load.

### Container backends

A container declares the same achievement fields in `GET /describe`, then sends an
`achievements` message on its control WebSocket. The platform applies the same key, participant,
idempotency, and delivery rules. See [Container Game Servers](container-games.md#control-channel).

### `GET /api/v1/games/{slug}/achievements`

Every achievement the game declares, with the caller's unlock state. `404` if the slug has no
authoritative game definition (a game without a script or container backend has no game-owned
achievements — see [Which games can use this](#which-games-can-use-this)). Secret achievements are hidden until the
caller unlocks them. Ordered by creation, then key.

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

Works with a full user JWT or a game-scoped launch token.

### Which games can use this

The mechanism is available to a game that declares either a `server=` script or a
`container.image=` backend in [`starhermit.txt`](github-games.md#the-manifest-starhermittxt). The
server runtime makes the unlock authoritative. Script-backed use cases include:

- **Scripted platform games** — unlock from `onPlayerMessage` / `onTick` as the match plays out.
- **Room-bound realtime games** — a [realtime room](realtime.md#room-bound-scripted-sessions) for a
  game with a `server=` script creates a bound session when it starts, and every hook of that
  session can grant achievements.
- **Single-player and practice games** — a session against the AI seat
  (`POST /api/v1/games/{slug}/sessions/ai`) runs the same script and the same unlock path.
- **Host-routed realtime games** — a game whose gameplay runs over the
  [realtime room binary channel](realtime.md#binary-frames-gameplay) can still ship a server script
  purely as its achievement authority: the room start creates the bound session, and the script
  awards from `createSession` / `onTick` / durable `cmd` messages sent over `ws/v1/games` while the
  fast path keeps flowing over `ws/v1/realtime`.

Container-backed sessions can also declare and grant achievements through their protocol. A game
with **no authoritative backend** (a pure browser game, or one built only on the [peer relay](relay.md))
has no server-authoritative unlock path. Client-claimed unlocking is available only to
catalog-distributed titles, below.

### Limits and rules

| Rule | Value |
|---|---|
| Declared achievements per game | 100 (extras ignored) |
| Achievement key length | 128 characters |
| Unlock keys accepted per player, per invocation | 32 |
| `points` | clamped to 0–10000; defaults to 0 |
| `name` | defaults to the `key` when omitted |

- A malformed declaration entry is **skipped**. A script that fails to evaluate yields an empty
  list; a container's declaration is read after it passes health checks. Verify with
  `GET /api/v1/games/{slug}/achievements` after deployment.
- Definitions upsert by `key`. A key your backend stops declaring is deleted **only if nobody has
  unlocked it** — earned history is never destroyed.
- Unlocks for users who are not participants of the session, and for the AI seat, are ignored.

## Catalog title achievements

For software distributed through the catalog, where the client is the only thing that observes the
unlock condition. Definitions are read anonymously; unlocking requires a JWT and a non-revoked
entitlement to the title.

### `GET /api/v1/software/{titleId}/achievements`

`AchievementDto[]`. Secret achievements are hidden unless unlocked by the caller (and their
`criteria` is withheld until then). Game-scoped achievements never appear here.

```json
[
  {
    "id": "…",
    "key": "…",
    "name": "…",
    "description": "…",
    "icon": "…",
    "secret": false,
    "points": 10,
    "visibility": "…",
    "criteria": "…"
  }
]
```

### `POST /api/v1/me/achievements/unlock`

```json
{ "achievementDefinitionId": "…" }
```

Returns `204`. Returns `400` when the achievement does not exist, when the caller has no entitlement
to the title (see [catalog.md](catalog.md)), or when the achievement is **game-scoped** — those are
granted by the game's script only. Re-unlocking something already held returns `204`.

Publisher-side management — defining, updating, and deleting title achievements — lives in
[publisher.md](publisher.md#achievements).

## `GET /api/v1/me/achievements`

The caller's unlocks as `UserAchievementDto[]`. **With no `titleId` this returns every unlock the
user holds, game-scoped and title-scoped alike**; pass `?titleId=` to narrow it to one catalog title.

```json
[
  {
    "id": "…",
    "achievementDefinitionId": "…",
    "key": "…",
    "name": "…",
    "description": "…",
    "icon": "…",
    "points": 10,
    "unlockedAt": "…"
  }
]
```

For a game's own achievement screen prefer `GET /api/v1/games/{slug}/achievements`, which also
returns the definitions the player has *not* yet unlocked.
