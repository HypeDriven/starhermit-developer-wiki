# Voice

StarHermit voice provides per-conversation voice rooms over a REST API (`api/v1/voice`) plus a mixed binary/text WebSocket (`ws/v1/voice`) for audio and WebRTC signaling. All REST endpoints require authentication. Voice is enabled by default but may be turned off by the platform operator. Errors are returned as `{"error":"..."}` with standard status codes.

Rooms anchor to a [chat conversation](chat.md); membership in the conversation gates everything, so chat friendship rules also govern voice (game-session conversations bypass friendship). Limits: 3 active rooms per conversation, max 10 participants per room, codec `"opus"`.

## REST endpoints

Base: `http://localhost:5000/api/v1/voice` (some local setups use port `5050`).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/rooms` | JWT | Create a voice room for a conversation |
| GET | `/rooms?conversationId=` | JWT | List rooms for a conversation |
| GET | `/rooms/{roomId}` | JWT | Get a room |
| POST | `/rooms/{roomId}/join` | JWT | Join a room (required before the WS) |
| POST | `/rooms/{roomId}/leave` | JWT | Leave a room |
| POST | `/rooms/{roomId}/mute` | JWT | Set your mute state |
| POST | `/rooms/{roomId}/close` | JWT | Close a room (creator only) |

### Create a room

`POST /rooms`

```json
{ "conversationId": "<guid>", "maxParticipants": 10 }
```

Returns a `VoiceRoomDto`.

### Room shape

`GET /rooms?conversationId=<guid>` → `VoiceRoomDto[]`; `GET /rooms/{roomId}` → `VoiceRoomDto`:

```json
{
  "id": "<guid>",
  "conversationId": "<guid>",
  "creatorUserId": "<guid>",
  "codec": "opus",
  "status": "active",
  "maxParticipants": 10,
  "createdAt": "2026-07-22T07:00:00Z",
  "participants": [
    {
      "userId": "<guid>",
      "username": "alice",
      "isMuted": false,
      "isConnected": true,
      "joinedAt": "2026-07-22T07:01:00Z"
    }
  ]
}
```

### Join, leave, mute, close

`POST /rooms/{roomId}/join` → `VoiceRoomDto`. This REST join is **required** before opening the WebSocket; connecting without it returns `403`.

`POST /rooms/{roomId}/leave` → `204`.

`POST /rooms/{roomId}/mute` with `{ "muted": true }` → `204`.

`POST /rooms/{roomId}/close` → `204` (creator only).

## WebSocket: `ws/v1/voice`

Connect to `ws://localhost:5000/ws/v1/voice?roomId=<guid>` with a JWT via the `Authorization` header or the `?access_token=` query parameter. A prior REST `join` is required.

The protocol is mixed:

### Binary frames — audio

Binary frames carry audio (e.g. Opus). The server relays each frame to the other participants as:

```
[16-byte senderUserId][audio…]
```

The server prefixes the **authenticated** sender id and never trusts a client-supplied sender. Audio from muted users is dropped. Limits: 100 packets/second per user, max frame 4000 bytes.

### Text frames — client → server control

```json
{ "type": "mute", "muted": true }
```

```json
{ "type": "speaking", "speaking": true }
```

```json
{ "type": "rtc", "to": "<guid>", "payload": { } }
```

`rtc` payloads are opaque WebRTC signaling, forwarded to the addressed participant.

### Server → client events

Envelope: `{ "event": "<name>", "data": { } }`.

| Event | `data` |
|---|---|
| `voice.roster` | `{ "roomId", "participants": [{ "userId", "muted" }] }` — sent to the newcomer |
| `voice.participant_joined` | `{ "roomId", "userId", "muted" }` |
| `voice.participant_left` | `{ "roomId", "userId" }` |
| `voice.mute_changed` | `{ "roomId", "userId", "muted" }` |
| `voice.speaking` | `{ "roomId", "userId", "speaking" }` |
| `voice.rtc` | `{ "roomId", "from", "payload" }` |

## Integration pattern from the chess client

Voice is opt-in per game session. The [chess reference client's](../tutorials/chess-walkthrough.md) `enable()` flow:

1. `GET /api/v1/voice/rooms?conversationId=<chatConversationId>` to find an existing room, else `POST /api/v1/voice/rooms` to create one.
2. `POST /api/v1/voice/rooms/{roomId}/join`.
3. Open `ws/v1/voice?roomId=<guid>`.

Audio runs over WebRTC P2P with perfect negotiation; signaling is exchanged through the `rtc` control messages (`{ "sdp": … }` / `{ "ice": … }` payloads). The server-relayed Opus binary path is the fallback.

Game-scoped launch tokens **may** use the voice REST and WebSocket for rooms attached to their own game sessions.

## See also

- [Chat](chat.md) — rooms anchor to conversations; game sessions expose `chatConversationId`
- [Games](games.md) — game sessions and launch tokens
- [Relay](relay.md) — byte fan-out for game netcode
