# Relay

The relay provides opaque byte fan-out for game netcode: a REST API (`api/v1/relay`) manages sessions, and a WebSocket (`ws/v1/relay`) forwards binary frames verbatim between participants. All REST endpoints require authentication. Errors are returned as `{"error":"..."}` with standard status codes.

Relay availability may vary; unavailable requests return `503`.

## REST endpoints

Base: `https://api.starhermit.com/api/v1/relay`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/?titleId=` | JWT | List active relay sessions for a title |
| POST | `/` | JWT | Create a relay session |
| GET | `/{sessionId}` | JWT | Get a relay session |
| POST | `/{sessionId}/join` | JWT | Join a session (required before the WS) |
| POST | `/{sessionId}/close` | JWT | Close a session (creator only) |

### Create a session

`POST /`

```json
{ "titleId": "<guid>", "maxParticipants": 8 }
```

Returns a `RelaySession`. Limits: max 5 active sessions per title; `maxParticipants` defaults to 8.

### Session shape

`RelaySession`:

```json
{
  "id": "<guid>",
  "titleId": "<guid>",
  "creatorUserId": "<guid>",
  "maxParticipants": 8,
  "currentParticipantCount": 2,
  "status": "Active",
  "createdAt": "2026-07-22T07:00:00Z",
  "closedAt": null,
  "participants": [
    {
      "id": "<guid>",
      "sessionId": "<guid>",
      "userId": "<guid>",
      "connectionId": "<id>",
      "joinedAt": "2026-07-22T07:01:00Z",
      "leftAt": null,
      "status": "Joined"
    }
  ]
}
```

`status` on the session is `"Active"` or `"Closed"`; `closedAt`, `connectionId`, and `leftAt` may be absent/null.

### Join and close

`POST /{sessionId}/join` → `RelaySession`. This REST join is **required** before opening the WebSocket; connecting without it returns `403`.

`POST /{sessionId}/close` → `204` (creator only).

## WebSocket: `ws/v1/relay`

Connect to `wss://api.starhermit.com/ws/v1/relay?sessionId=<guid>&titleId=<guid>` with a JWT via the `Authorization` header or the `?access_token=` query parameter.

The socket is an **opaque byte fan-out** for game netcode. Any binary frame you send is forwarded verbatim to every other session participant as a binary frame. There is no JSON protocol.

Limits:

- Max message size: 4 KB.
- Rate limit: 1 message per 100 ms per user. A violation closes the socket with `PolicyViolation`.

## Positioning

Use the relay for fast-paced games that want server fan-out without running a game script. It is deliberately dumb transport: the server neither parses nor validates your payloads.

Contrast this with the [games subsystem](games.md), which is server-authoritative through a sandboxed script or container backend and suited to anything from turn-based play to realtime simulation. If your game needs the server to enforce rules and state, use an authoritative game runtime; if it needs low-overhead byte relay between peers, use the relay.

Confirm relay availability before shipping a feature that depends on it.

## See also

- [Realtime rooms](realtime.md) — lobbies, matchmaking, AI players and backfill, and role-aware routing for fast-paced games
- [Games](games.md) — server-authoritative games
- [Container Game Servers](container-games.md) — authoritative servers in other languages
- [Game scripts](game-scripts.md) — writing game scripts
- [Voice](voice.md) — voice rooms for in-game audio
- [Chess walkthrough](../tutorials/chess-walkthrough.md) — the reference implementation of a scripted-game integration
