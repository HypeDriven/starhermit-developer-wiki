# Relay

The relay provides opaque byte fan-out for game netcode: a REST API (`api/v1/relay`) manages sessions, and a WebSocket (`ws/v1/relay`) forwards binary frames verbatim between participants. All REST endpoints require authentication. Errors are returned as `{"error":"..."}` with standard status codes.

The relay is **disabled by default** — requests return `503` when the platform operator has not enabled it.

## REST endpoints

Base: `http://localhost:5000/api/v1/relay` (some local setups use port `5050`).

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

Connect to `ws://localhost:5000/ws/v1/relay?sessionId=<guid>&titleId=<guid>` with a JWT via the `Authorization` header or the `?access_token=` query parameter.

The socket is an **opaque byte fan-out** for game netcode. Any binary frame you send is forwarded verbatim to every other session participant as a binary frame. There is no JSON protocol.

Limits:

- Max message size: 4 KB.
- Rate limit: 1 message per 100 ms per user. A violation closes the socket with `PolicyViolation`.

## Positioning

Use the relay for fast-paced games that want server fan-out without running a game script. It is deliberately dumb transport: the server neither parses nor validates your payloads.

Contrast this with the [scripted games subsystem](games.md), which is server-authoritative and suited to turn-based style play. If your game needs the server to enforce rules and state, use game scripts; if it needs low-overhead byte relay between peers, use the relay.

Because the relay is off by default, check with your platform operator that the relay is enabled before shipping a feature on it.

## See also

- [Games](games.md) — server-authoritative scripted games
- [Game scripts](game-scripts.md) — writing game scripts
- [Voice](voice.md) — voice rooms for in-game audio
- [Chess walkthrough](../tutorials/chess-walkthrough.md) — the reference implementation of a scripted-game integration
