# Relay

The relay provides opaque byte fan-out for game netcode: a REST API (`api/v1/relay`) manages
sessions, and `ws/v1/relay` forwards binary frames verbatim between participants. Every relay is
bound to exactly one existing match—a [game session](games.md) or a [realtime room](realtime.md)—and
uses that match's roster for authorization.

All REST endpoints require authentication. Errors are returned as `{"error":"..."}` with standard
status codes. Relay availability may vary; unavailable requests return `503`.

## REST endpoints

Base: `https://api.starhermit.com/api/v1/relay`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/?titleId=` | JWT | List active relay sessions for this title whose bound match includes the caller |
| POST | `/` | JWT | Create a relay bound to one match |
| GET | `/{sessionId}` | JWT | Get a relay session |
| POST | `/{sessionId}/join` | JWT | Join the relay; caller must be in its bound match |
| POST | `/{sessionId}/close` | JWT | Close a relay (creator only) |

## Match binding

Relay membership is not an independent, open lobby. The match roster is the source of truth:

- A relay has either `gameSessionId` or `realtimeRoomId`, never both and never neither.
- The creator must belong to that game session or hold an active, non-left seat in that realtime
  room.
- Every later join is checked against the same roster.
- Opening the WebSocket requires both an active relay-participant row and current membership in the
  bound match. Leaving a realtime room therefore prevents a later/replacement relay connection.
- Listing by `titleId` returns only relays bound to matches the caller belongs to; it is not a
  directory of every live match for that title.

This is a required request-shape change. Legacy unbound relay rows cannot authorize a socket; create
a new bound relay instead.

## Create a session

`POST /api/v1/relay`

Bind to an authoritative game session:

```json
{
  "titleId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "maxParticipants": 8,
  "gameSessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "realtimeRoomId": null
}
```

Or bind to a realtime room:

```json
{
  "titleId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "maxParticipants": 8,
  "gameSessionId": null,
  "realtimeRoomId": "b1d2c3e4-5f60-4a71-8b92-c3d4e5f60718"
}
```

`maxParticipants` defaults to `8`. At most five active relay sessions may exist per title by
default. The call is rejected if the binding count is not exactly one or the caller is not in the
selected match.

The relay does not create the game session or room. Create/join that match through the
[Games API](games.md) or [Realtime Rooms API](realtime.md) first, then pass its ID here.

## Session shape

```json
{
  "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "titleId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "creatorUserId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "gameSessionId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "realtimeRoomId": null,
  "isBound": true,
  "maxParticipants": 8,
  "currentParticipantCount": 1,
  "status": "Active",
  "createdAt": "2026-07-28T11:30:00Z",
  "closedAt": null,
  "participants": [
    {
      "id": "e7f1a2b3-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
      "sessionId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
      "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "connectionId": null,
      "joinedAt": "2026-07-28T11:30:01Z",
      "leftAt": null,
      "status": "Connected"
    }
  ]
}
```

Exactly one binding ID is non-null and `isBound` is therefore `true`. Session `status` is
`"Active"` or `"Closed"`; `closedAt`, `connectionId`, and `leftAt` may be absent or null.

## Join and close

`POST /api/v1/relay/{sessionId}/join` returns the updated `RelaySession`. This REST join is required
before opening the WebSocket. A free relay slot is not enough: the caller must still be a member of
the bound match.

`POST /api/v1/relay/{sessionId}/close` returns `204` and is creator-only.

## WebSocket: `ws/v1/relay`

Connect to:

```text
wss://api.starhermit.com/ws/v1/relay?sessionId=<relay-id>&titleId=<title-id>
```

Authenticate with an `Authorization: Bearer <token>` header or `?access_token=` query parameter.
The handshake returns `403` unless the user joined the relay and is still authorized by its bound
match.

The socket is opaque byte fan-out. Every binary frame is forwarded unchanged to every other
connected participant. There is no JSON framing and the platform does not interpret game data.
Maximum message size is 4 KiB by default.

### Tick-rate-aware rate limit

> **Connection-drop rule:** if a client sends relay commands/frames faster than the allowed rate,
> StarHermit closes that client's relay WebSocket with `PolicyViolation`. This is not a queue or a
> best-effort frame drop—the client connection is terminated and must reconnect.

The old flat limit of one message per 100 ms no longer applies to configured sessions. Each
sender's minimum interval is derived from the bound match's effective game tick rate:

```text
minimum interval ms = (1000 / effectiveTickRateHz) × 0.90
```

The 10% headroom allows ordinary timer and network jitter. Examples:

| Effective rate | Minimum sender interval |
|---:|---:|
| 20 Hz | 45 ms |
| 30 Hz | 30 ms |
| 60 Hz | 15 ms |
| 120 Hz | 7.5 ms |

For a game session, the rate comes from its game definition. For a realtime room, the room's
`gameSlug` is resolved to a game definition. The normal effective-rate precedence applies:
operator override, then the game's requested rate, then the global setting. If no definition can be
resolved—or the game opted out of server ticks with `0`—the global/default rate is used rather than
making relay traffic unlimited. Rates are bounded by the platform ceiling.

A client must pace commands to this interval or slower. Sending two commands/frames closer together
than the minimum interval is treated as flooding: StarHermit drops that client's connection by
closing its relay WebSocket with `PolicyViolation`. Senders are limited independently, so one
client's violation does not disconnect the other players.

## Recommended client flow

1. Create or join the actual game session/realtime room.
2. Have one match member create a relay with that match ID.
3. Share the returned relay ID only through the match's authenticated state or roster messages.
4. Each other match member calls `POST /api/v1/relay/{relayId}/join`.
5. Each member opens `ws/v1/relay` and paces frames to the game's effective tick rate; sending
   faster drops that client's WebSocket connection.
6. The creator closes the relay when the match ends.

Do not use relay IDs as authorization secrets. The platform authorizes against the bound roster;
the IDs only identify resources.

## Positioning

Use the relay for fast-paced games that need low-overhead peer fan-out. It is deliberately dumb
transport: binding secures who may participate, but the platform still does not parse or validate
payloads, elect an authoritative peer, or resolve cheating.

For server-enforced rules and state, use the [Games API](games.md) with a sandboxed script or
[container backend](container-games.md). Realtime rooms provide lobbies, seats, matchmaking, and
host-aware routing; the relay can now bind to one of those rooms instead of duplicating its roster.

Confirm relay availability before shipping a feature that depends on it.

## See also

- [Realtime Rooms](realtime.md) — lobbies, matchmaking, AI players, and role-aware routing
- [Games](games.md) — authoritative sessions and effective tick rates
- [Container Game Servers](container-games.md) — authoritative servers in other languages
- [Game Scripts](game-scripts.md) — sandboxed server logic and requested tick rates
- [Voice](voice.md) — voice rooms for in-game audio
