# Friends

The friends API manages friend requests and accepted friendships. All routes are under `api/v1/me` on the `FriendsController` and require authorization. Friendship state gates game invites, and it also controls access to open chat rooms and voice rooms.

Errors are returned as `{"error":"..."}` with standard status codes (400/401/403/404/409/422/429).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/me/friend-requests` | JWT | Send a friend request |
| GET | `/api/v1/me/friend-requests` | JWT | List pending incoming friend requests |
| POST | `/api/v1/me/friend-requests/{requestId}/accept` | JWT | Accept a friend request |
| POST | `/api/v1/me/friend-requests/{requestId}/decline` | JWT | Decline a friend request |
| DELETE | `/api/v1/me/friends/{friendUserId}` | JWT | Unfriend a user |
| GET | `/api/v1/me/friends` | JWT | List accepted friendships with presence |

## Friend requests

### `POST /api/v1/me/friend-requests`

```json
{ "toUserId": "3fa85f64-5717-4562-b3fc-2c963f66afa6" }
```

Returns 204.

### `GET /api/v1/me/friend-requests`

Pending incoming requests:

```json
[
  {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "senderUserId": "9b2f5c74-1d2e-4a6b-8c0d-1e2f3a4b5c6d",
    "senderUsername": "pk-a1b2c3d4e5f6",
    "createdAt": "2026-07-20T09:30:00Z"
  }
]
```

### `POST /api/v1/me/friend-requests/{requestId}/accept`

Returns 204; the two users become friends.

### `POST /api/v1/me/friend-requests/{requestId}/decline`

Returns 204.

## Friends

### `GET /api/v1/me/friends`

Accepted friendships. `online` comes from presence, `currentGame` from an active launch:

```json
[
  {
    "userId": "9b2f5c74-1d2e-4a6b-8c0d-1e2f3a4b5c6d",
    "username": "pk-a1b2c3d4e5f6",
    "online": true,
    "currentGame": "chess"
  }
]
```

### `DELETE /api/v1/me/friends/{friendUserId}`

Unfriends the user. Returns 204.

## How friendship gates other features

- **Game invites** can only be sent to friends — see [Games](games.md).
- **Chat** — friendship gates joining open chat rooms; chat rules require friendship for non-game conversations. See [Chat](chat.md).
- **Voice** — voice room access requires membership of the backing chat conversation, so the chat friendship rules apply transitively. See [Voice](voice.md).
- **Per-session game conversations bypass the friendship rules** — players in the same game session can use its attached chat/voice without being friends.

## Game-scoped launch tokens

A game-scoped launch token may call `GET /api/v1/me/friends` — this is what powers the chess invite-friend picker. The other friend endpoints return 403 for launch tokens; see the game-scope fencing rules in [Authentication](auth.md).
