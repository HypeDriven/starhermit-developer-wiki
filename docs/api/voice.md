# Voice

StarHermit voice provides per-conversation voice rooms over a REST API (`api/v1/voice`) plus a mixed binary/text WebSocket (`ws/v1/voice`) for audio and WebRTC signaling. All REST endpoints require authentication. Voice availability may vary. Error bodies vary; see [API conventions](conventions.md#requests-and-responses).

Rooms anchor to a [chat conversation](chat.md); membership in the conversation gates everything, so chat friendship rules also govern voice (game-session conversations bypass friendship). Limits: 3 active rooms per conversation, up to 32 participants per room (the default when you omit `maxParticipants`; your value is clamped to 2–32). Each room declares a `codec` the creator sets and clients may rely on: `pcm` by default — the 20 ms/16 kHz/mono/s16 convention the relay forwards opaquely — or `opus` for a room whose participants all run an Opus-capable client. The label is forwarded, never a transform the server applies.

## REST endpoints

Base: `https://api.starhermit.com/api/v1/voice`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/rooms` | JWT | Create a voice room for a conversation |
| POST | `/rooms/join-or-create` | JWT | Return the conversation's oldest active room with a free seat, or create one — chosen atomically |
| GET | `/rooms?conversationId=` | JWT | List rooms for a conversation |
| GET | `/rooms/{roomId}` | JWT | Get a room |
| POST | `/rooms/{roomId}/join` | JWT | Join a room (required before the WS) |
| POST | `/rooms/{roomId}/leave` | JWT | Leave a room |
| POST | `/rooms/{roomId}/mute` | JWT | Set your own mute state |
| POST | `/rooms/{roomId}/participants/{userId}/server-mute` | JWT (creator) | Host mute the participant cannot lift |
| POST | `/rooms/{roomId}/close` | JWT | Close a room (creator only) |

### Create a room

`POST /rooms`

```json
{ "conversationId": "<guid>", "maxParticipants": 8, "codec": "opus" }
```

`maxParticipants` (optional, clamped to 2–32; defaults to 32) and `codec` (optional, `pcm` or `opus`; anything else is read as `pcm`) are both set once at creation. Returns a `VoiceRoomDto`.

### Join or create a room

`POST /rooms/join-or-create` with the same body returns a `VoiceRoomDto` for the conversation's **oldest active room that still has a free seat**, or creates one when none does — decided atomically under the conversation's room lock, so two members who turn voice on at the same instant land in one room rather than two they can't hear each other across. `maxParticipants`/`codec` apply only when it creates. You still call `/rooms/{roomId}/join` on the returned room before opening the WebSocket.

### Room shape

`GET /rooms?conversationId=<guid>` → `VoiceRoomDto[]`; `GET /rooms/{roomId}` → `VoiceRoomDto`:

```json
{
  "id": "<guid>",
  "conversationId": "<guid>",
  "creatorUserId": "<guid>",
  "codec": "opus",
  "status": "Active",
  "maxParticipants": 8,
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

`POST /rooms/{roomId}/join` → `VoiceRoomDto`. This REST join is **required** before opening the WebSocket; connecting without it returns `403`. Rejoining clears the participant's **own** mute (`isMuted`); a host's `isServerMuted` survives leave and reconnect.

`POST /rooms/{roomId}/leave` → `204`.

`POST /rooms/{roomId}/mute` with `{ "muted": true }` → `204`. This is the participant's own mute and cannot clear a host mute.

`POST /rooms/{roomId}/participants/{userId}/server-mute` with `{ "muted": true }` → `204` (creator only). Audio is dropped if either mute is set.

`POST /rooms/{roomId}/close` → `204` (creator only).

State your mute on connect rather than inheriting whatever the row remembers.

## WebSocket: `ws/v1/voice`

Connect to `wss://api.starhermit.com/ws/v1/voice?roomId=<guid>` with a JWT via the `Authorization` header, `?ticket=`, or `?access_token=`. A prior REST `join` is required.

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

```json
{ "type": "deafen", "deafened": true }
```

`rtc` payloads are opaque WebRTC signaling, forwarded to the addressed participant.
`deafen` suppresses incoming relayed binary audio for this socket; it does not automatically mute
outgoing audio or a separate peer connection. Apply those locally when the player chooses Deafen.

The REST participant shape exposes own mute, not host mute. The initial voice roster and join events
include `serverMuted`; there is no separate host-mute-changed push event. If your game uses P2P
audio, its host-mute signaling and enforcement must be part of your own media integration.

When the last voice socket disconnects, voice-room membership ends. Call REST `join` again before
reconnecting and restore intended mute before sending audio.

### Server → client events

Envelope: `{ "event": "<name>", "data": { } }`.

| Event | `data` |
|---|---|
| `voice.roster` | `{ "roomId", "participants": [{ "userId", "muted", "serverMuted" }] }` — sent to the newcomer |
| `voice.participant_joined` | `{ "roomId", "userId", "muted", "serverMuted" }` |
| `voice.participant_left` | `{ "roomId", "userId" }` |
| `voice.mute_changed` | `{ "roomId", "userId", "muted" }` |
| `voice.deafened` | `{ "roomId", "userId", "deafened" } |
| `voice.speaking` | `{ "roomId", "userId", "speaking" }` |
| `voice.rtc` | `{ "roomId", "from", "payload" }` |

## Example integration pattern (from the chess reference implementation)

Voice is opt-in per game session. A typical client `enable()` flow:

1. `POST /api/v1/voice/rooms/join-or-create` with `{ "conversationId": "<chatConversationId>" }` — one call that returns the room everyone else turning voice on converges into. (You can still `GET /rooms?conversationId=` then `POST /rooms` by hand, but two clients doing that at once make two rooms.)
2. `POST /api/v1/voice/rooms/{roomId}/join`.
3. Open `ws/v1/voice?roomId=<guid>`.

In the [chess reference implementation](../tutorials/chess-walkthrough.md), audio runs over WebRTC P2P with perfect negotiation; signaling is exchanged through the `rtc` control messages (`{ "sdp": … }` / `{ "ice": … }` payloads), with the server-relayed Opus binary path as the fallback.

Game-scoped launch tokens **may** use the voice REST and WebSocket for rooms attached to their own game sessions.

## See also

- [Audio options](../tutorials/audio-options.md) — baseline volume, microphone and push-to-talk controls,
  with an auto-detected playback cap
- [Chat](chat.md) — rooms anchor to conversations; game sessions expose `chatConversationId`
- [Games](games.md) — game sessions and launch tokens
- [Relay](relay.md) — byte fan-out for game netcode

See [credential compatibility](../credentials.md) and [machine-readable contracts](contracts.md).
