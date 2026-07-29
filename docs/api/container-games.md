# Container-hosted Game Servers

A StarHermit game can ship its authoritative server logic as a container image instead of a
sandboxed JavaScript file. This lets the server use Rust, Go, C++, or any other runtime that can
serve HTTP and WebSockets. The browser-facing [Games API](games.md) stays the same: clients still
use game-scoped launch tokens, REST sessions, and `ws/v1/games` JSON frames.

Container hosting may be limited to approved developers while the feature is rolling out.

After initial game registration, developers can also push a built `.tar.gz` containing
`server/image.tar` (`docker save` output) through
`POST /api/v1/me/github-games/{id}/bundle`. The platform loads and digest-pins the image and queues
a deployment restart. See [GitHub Games — Push a game bundle](github-games.md#push-a-game-bundle)
and the [dedicated-server tutorial](../tutorials/dedicated-server-onboarding.md).

## Manifest

Declare the image in the repository's `starhermit.txt`:

```ini
name=Void Marshals
# (There is no slug key: the platform assigns your game a uid and uses it as the
# slug — the same value as its <uid>.starhermit.com address. Nothing can choose
# it, so two games can never contend for a name. Your client reads its own slug
# from the launch token's game_scope claim.)
launch=index.html

container.image=ghcr.io/octocat/vm-server@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
container.port=8080
container.health=/health
container.memory_mb=1024
container.cpu=1.0
container.env.LOG_LEVEL=info
```

Only `container.image` is required. The port and health path default to `8080` and `/health`.
Memory and CPU are requests, not guarantees; the platform clamps them to operator limits.
`container.env.*` is for non-secret configuration only.

A submission is rejected unless:

- The image is digest-pinned as `name@sha256:<64 lowercase hex>`. Mutable tags are not accepted.
- The registry is allowlisted and the image is under the verified repository owner's namespace;
  currently this means `ghcr.io/<github-owner>/...`.
- The manifest declares exactly one server runtime. `server=` and `container.image=` are mutually
  exclusive.
- Environment names are valid and do not begin with the reserved `STARHERMIT_` prefix.

Never put credentials in `starhermit.txt`; it is a public repository file.

## Protocol v1

The container serves HTTP/1.1 on `container.port`. Every platform HTTP request and WebSocket upgrade includes `X-Starhermit-Invoke-Key`, whose value
matches the injected `STARHERMIT_INVOKE_KEY`; reject a request when it is absent or wrong.

| Endpoint | Purpose |
|---|---|
| `GET <container.health>` | Return `200` when the server is ready |
| `GET /describe` | Declare protocol version, tick rate, capacity, and achievements |
| `POST /sessions` | Start a session, or restore it when `snapshot` is present |
| `GET /sessions/{sessionId}/snapshot` | Return the current durable state |
| `DELETE /sessions/{sessionId}` | Tear down a session |
| `WS /control` | Deployment-wide outbound control channel |
| `WS /stream` | Gameplay frames in both directions |

One container hosts all live sessions for one game. Keep session state keyed by `sessionId` and do
not assume the process will survive for the life of a match.

### `GET /describe`

```json
{
  "protocol": 1,
  "tickRateHz": 20,
  "maxSessions": 48,
  "achievements": [
    { "key": "first-blood", "name": "First Blood", "description": "Score first.", "points": 10 }
  ]
}
```

`protocol` must be `1`. `tickRateHz` and `maxSessions` are requests and may be clamped. Achievement
entries use the same fields and limits as [script-declared achievements](game-scripts.md#declare);
only declared keys can later be granted.

### `POST /sessions`

The request is the same context shape a JavaScript game receives:

```json
{
  "now": 1769500000000,
  "random": 0.418,
  "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "players": [
    { "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "name": "alice" }
  ],
  "sessionState": null,
  "playerStates": {
    "7c9e6679-7425-40de-944b-e07fc1f90ae7": null
  }
}
```

Field semantics match the [script context](game-scripts.md#context-object). Respond with the
standard result envelope, for example:

```json
{ "ok": true, "sessionState": { "round": 1 } }
```

On recovery the request also contains `snapshot`, holding the last state persisted by the platform,
and `restoredFrom`, a Unix-millisecond timestamp. Reconstruct a playable session from the snapshot.

### `GET /sessions/{sessionId}/snapshot`

Return the standard envelope with a complete `sessionState` restore point:

```json
{ "ok": true, "sessionState": { "round": 3, "scores": [2, 1] } }
```

The platform checkpoints active sessions periodically. A snapshot response may also include
`playerStates`, `eloUpdates`, `achievements`, or `result`; they pass through the same validation and
persistence rules as a script result.

## Gameplay stream

`WS /stream` uses binary messages in both directions:

```text
[1 byte type][16 byte sessionId][16 byte userId][payload...]
```

GUIDs use their 16-byte .NET wire representation.

- **Type 1, platform → container:** player command. The platform stamps the authenticated user id;
  the payload is the JSON value from the client's `cmd.data`.
- **Type 2, container → platform:** game payload. Address one participant with their user id, or use
  an all-zero user id to broadcast. The payload must be valid JSON; clients receive it inside
  `{"type":"game","data":...}`.

Sessions are pinned to stream connections to preserve ordering. Never accept or derive player
identity from command JSON—the authenticated header is authoritative.

## Control channel

Send JSON text messages on `WS /control` for durable effects:

```json
{ "type": "snapshot",     "sessionId": "...", "state": { "round": 3 } }
{ "type": "achievements", "sessionId": "...", "unlocks": { "<userId>": ["first-blood"] } }
{ "type": "elo",          "sessionId": "...", "updates": { "<userId>": 1312 } }
{ "type": "result",       "sessionId": "...", "result": { "kind": "win", "winner": "..." } }
{ "type": "backpressure", "load": 0.75 }
```

The platform accepts effects only for sessions routed to this deployment, filters recipients to
session participants, limits achievement keys to the declaration, and applies state budgets.
`result` ends the session; later effects for that session are ignored. `backpressure.load` is
clamped to `0..1` and helps the platform account for current deployment load.

Push a snapshot after semantically important events, such as a goal or round transition, rather
than relying only on periodic checkpoints.

## Container environment and server API

| Variable | Meaning |
|---|---|
| `STARHERMIT_PROTOCOL` | Protocol version (`1`) |
| `STARHERMIT_GAME_SLUG` | This game's slug |
| `STARHERMIT_INVOKE_KEY` | Secret expected in `X-Starhermit-Invoke-Key`; authenticates the platform to your container |
| `STARHERMIT_REFRESH_KEY` | Separate secret used only to renew the server token |
| `STARHERMIT_API_BASE` | Platform API base URL reachable from the isolated network |
| `STARHERMIT_SERVER_TOKEN` | Expiring bearer token for the narrow server-to-server API |
| `STARHERMIT_SERVER_TOKEN_EXPIRES_IN` | Lifetime of the injected server token, in seconds |
| `PORT` | Port on which the container must listen |

A server token has no player identity and cannot call player endpoints. It is fenced to
`GET /api/v1/time` and this game's `/api/v1/games/{slug}/server/...` prefix.

### Renew the server token

The injected server token expires (24 hours by default). Refresh it well before
`STARHERMIT_SERVER_TOKEN_EXPIRES_IN` elapses:

```http
POST /api/v1/games/{slug}/server/token
X-Starhermit-Refresh-Key: <STARHERMIT_REFRESH_KEY>
```

```json
{ "token": "eyJhbGciOi...", "expiresInSeconds": 86400 }
```

This endpoint is intentionally called without the expired bearer token. The dedicated refresh key
is compared against the live deployment and works even after the old token expires. It is distinct
from `STARHERMIT_INVOKE_KEY`: the invoke key authenticates platform calls to your process, while the
refresh key authenticates your process to the platform. Both rotate whenever the container starts.
Schedule renewal at roughly half the reported lifetime and replace the token atomically.

### Reconcile a session

`GET /api/v1/games/{slug}/server/sessions/{sessionId}` with
`Authorization: Bearer <STARHERMIT_SERVER_TOKEN>` returns the platform's current session view:

```json
{
  "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "status": "active",
  "players": [
    { "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "username": "alice" }
  ],
  "createdAt": "2026-07-27T16:00:00Z",
  "finishedAt": null,
  "chatConversationId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "result": null
}
```

Use this after restoration when the container needs to confirm whether the platform still considers
a session active. A token for another game, or a player launch token, is forbidden.

## Isolation

The game container has no internet access. It can reach only the StarHermit API through
`STARHERMIT_API_BASE`; it cannot reach other games, platform services, or the host. Vendor all
runtime dependencies into the image.

The root filesystem is read-only, except for a small `/tmp`; the process runs as a forced non-root
user with no Linux capabilities, no volumes, and CPU, memory, and process limits. Do not install
packages at startup or persist match state only to local disk.

## Failure and recovery

If the process dies, the platform restarts the deployment and recreates its live sessions from their
last snapshots. Connected players receive a platform frame:

```json
{ "type": "resumed", "sessionId": "...", "lostMs": 750 }
```

Clients should discard local prediction and wait for the game's normal full-state payload. A session
is abandoned instead of restored when no usable snapshot exists, it is too old, or the session has
restarted too often. The platform finishes it without a winner or elo change and sends:

```json
{ "type": "abandoned", "sessionId": "...", "reason": "server_failure" }
```

`reason` is `server_failure` when recovery is unsafe or the replacement never starts, and
`restore_failed` when recreating the session fails. A repeatedly crashing deployment is disabled.

Design `POST /sessions` restoration and snapshot cadence as part of the game protocol, not as an
optional optimization.

## See also

- [GitHub Games](github-games.md) — repository registration and deployment
- [Games API](games.md) — unchanged player-facing REST and WebSocket surface
- [Game Scripts](game-scripts.md) — the alternative JavaScript runtime and shared context/result shapes
- [Achievements](achievements.md) — player-facing achievement reads and notifications
