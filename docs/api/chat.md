# Chat

StarHermit chat covers direct messages, group rooms, and game-session conversations, over a REST API (`api/v1/chat`) plus a server-to-client WebSocket push channel (`ws/v1/chat`). All REST endpoints require authentication. Errors are returned as `{"error":"..."}` with standard status codes.

## REST endpoints

Base: `http://localhost:5000/api/v1/chat` (some local setups use port `5050`).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/conversations` | JWT | Create a conversation (1 friend = direct, ≥2 = group) |
| PATCH | `/conversations/{id}` | JWT | Rename a conversation (any member) |
| POST | `/conversations/{id}/invites` | JWT | Invite a user into a group |
| GET | `/invites` | JWT | List your pending chat invites |
| POST | `/invites/{id}/accept` | JWT | Accept a chat invite |
| POST | `/invites/{id}/decline` | JWT | Decline a chat invite |
| GET | `/rooms/joinable` | JWT | List open rooms with ≥1 friend inside |
| POST | `/conversations/{id}/join` | JWT | Join an open room (must be friends with a member) |
| POST | `/conversations/{id}/participants` | JWT | Add participants to a conversation |
| DELETE | `/conversations/{id}/participants/{userId}` | JWT | Remove a participant (self: any member; others: group creator only) |
| POST | `/conversations/{id}/leave` | JWT | Leave a conversation |
| GET | `/conversations` | JWT | List your conversations |
| GET | `/conversations/{id}` | JWT | Get a conversation |
| GET | `/conversations/{id}/messages?page=&pageSize=` | JWT | Get paged message history |
| POST | `/conversations/{id}/messages` | JWT | Send a message (rate-limited) |
| PUT | `/conversations/{conversationId}/messages/{messageId}` | JWT | Edit a message |
| DELETE | `/conversations/{conversationId}/messages/{messageId}` | JWT | Delete a message (tombstone) |

### Create a conversation

`POST /conversations`

```json
{
  "participantIds": ["<guid>"],
  "name": "Friday night lobby",
  "friendUserId": "<guid>",
  "joinPolicy": "closed"
}
```

All fields are optional. One friend participant creates a **direct** conversation; two or more create a **group**. `joinPolicy` is `"open"` or `"closed"` (default `"closed"`). Returns a `ConversationDto`.

### Rename a conversation

`PATCH /conversations/{id}` with `{ "name": "New name" }` → `ConversationDto`. Any member may rename; a system note with `kind: "system_rename"` is broadcast.

### Invites

`POST /conversations/{id}/invites` with `{ "toUserId": "<guid>" }` → `ChatInviteDto`. Invites are the only way into a closed room.

`GET /invites` → `ChatInviteDto[]`:

```json
[
  {
    "id": "<guid>",
    "conversationId": "<guid>",
    "conversationName": "Friday night lobby",
    "fromUserId": "<guid>",
    "fromUsername": "alice",
    "toUserId": "<guid>",
    "status": "pending",
    "createdAt": "2026-07-22T07:00:00Z"
  }
]
```

`POST /invites/{id}/accept` and `POST /invites/{id}/decline` → `ChatInviteDto`.

### Joining rooms

`GET /rooms/joinable` → `JoinableRoomDto[]` — open rooms that have at least one of your friends inside:

```json
[
  {
    "id": "<guid>",
    "name": "Friday night lobby",
    "joinPolicy": "open",
    "createdAt": "2026-07-22T07:00:00Z",
    "participants": [{ "userId": "<guid>", "username": "alice" }]
  }
]
```

`POST /conversations/{id}/join` → `ConversationDto`. Joins an open room; you must be friends with a member.

### Participants

`POST /conversations/{id}/participants` with `{ "participantIds": ["<guid>"] }` → `ConversationDto`.

`DELETE /conversations/{id}/participants/{userId}` → `204`. Any member may remove themselves; removing others requires being the group creator.

`POST /conversations/{id}/leave` → `204`.

### Reading conversations

`GET /conversations` → `ConversationDto[]`.

`GET /conversations/{id}` → `ConversationDto`:

```json
{
  "id": "<guid>",
  "type": "group",
  "name": "Friday night lobby",
  "createdByUserId": "<guid>",
  "joinPolicy": "closed",
  "createdAt": "2026-07-22T07:00:00Z",
  "participants": [{ "userId": "<guid>", "username": "alice" }],
  "otherParticipant": { "userId": "<guid>", "username": "bob" }
}
```

`type` is one of `direct`, `group`, `game`. `name`, `createdByUserId`, and `otherParticipant` may be absent.

### Messages

`GET /conversations/{id}/messages?page=1&pageSize=50` → `PagedMessagesDto`:

```json
{
  "conversationId": "<guid>",
  "page": 1,
  "pageSize": 50,
  "totalCount": 123,
  "items": []
}
```

`POST /conversations/{id}/messages` with `{ "content": "hello" }` → `MessageDto`. Rate-limited to 10 messages/minute per user; exceeding it returns `429`.

`PUT /conversations/{conversationId}/messages/{messageId}` with `{ "content": "edited" }` → `MessageDto`.

`DELETE /conversations/{conversationId}/messages/{messageId}` → `204`. Deletion is a tombstone: the message remains with `isDeleted: true`.

`MessageDto`:

```json
{
  "id": "<guid>",
  "conversationId": "<guid>",
  "senderId": "<guid>",
  "senderUsername": "alice",
  "content": "hello",
  "kind": "text",
  "metadata": { "key": "value" },
  "sentAt": "2026-07-22T07:00:00Z",
  "editedAt": null,
  "isDeleted": false
}
```

`kind` is `"text"` or `"system_rename"`; `content`, `metadata` (a `Dictionary<string,string>`), and `editedAt` may be absent/null.

## WebSocket: `ws/v1/chat`

Connect to `ws://localhost:5000/ws/v1/chat` with a JWT via the `Authorization` header or the `?access_token=` query parameter.

This is a **pure server→client push channel**: client frames are ignored (only `Close` is honored). Each frame is an envelope:

```json
{ "type": "<event>", "payload": { } }
```

| Event `type` | Payload |
|---|---|
| `conversation_created` | `ConversationDto` |
| `conversation_renamed` | `ConversationDto` |
| `participants_added` | `ConversationDto` |
| `participant_removed` | `ConversationDto` |
| `chat_invite` | `ChatInviteDto` |
| `chat_invite_responded` | `ChatInviteDto` |
| `new_message` | `MessageDto` |
| `message_updated` | `MessageDto` |
| `message_deleted` | `MessageDto` |
| `game_invite` | `{ "inviteId", "gameSlug", "gameName", "from": { "userId", "username" }, "createdAt" }` |

## In-game chat

A game-scoped launch token **cannot** open `ws/v1/chat` — it is blocked because the socket streams all of a user's conversations. Launch tokens **may** use the chat REST API on conversations attached to their own game sessions: the session detail returns a `chatConversationId`, the conversation has type `"game"`, its participants are the two players, and friendship rules are bypassed.

The pattern used by the [chess reference client](../tutorials/chess-walkthrough.md) is therefore: load history over REST and poll every 5 seconds instead of using the socket.

```http
GET /api/v1/chat/conversations/{chatConversationId}/messages?page=1&pageSize=50
Authorization: Bearer <launch-token>
```

```http
POST /api/v1/chat/conversations/{chatConversationId}/messages
Authorization: Bearer <launch-token>
Content-Type: application/json

{ "content": "good game" }
```

## See also

- [Voice](voice.md) — voice rooms anchor to chat conversations
- [Friends](friends.md) — friendship gates direct chats and room joins
- [Games](games.md) — game sessions and their `chatConversationId`
