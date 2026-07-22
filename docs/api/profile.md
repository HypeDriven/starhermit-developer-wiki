# Profile

The profile API covers the authenticated user's own account (`/api/v1/me/...`), public lookups of other users, public keys, linked identities, privacy settings, entitlements, and the presence heartbeat. The `MeController` uses absolute routes and requires authorization at the class level; presence is handled by the `PresenceController`.

Errors are returned as `{"error":"..."}` with standard status codes (400/401/403/404/409/422/429).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/me` | JWT (`Permission-user.profile.read`) | Get your own profile |
| PATCH | `/api/v1/me` | JWT (`Permission-user.profile.update`) | Update username, email, metadata, or nickname |
| PUT | `/api/v1/me/avatar` | JWT (`Permission-user.profile.update`) | Upload your avatar |
| GET | `/api/v1/me/avatar` | JWT (`Permission-user.profile.read`) | Get your avatar |
| GET | `/api/v1/users/{id}/avatar` | JWT | Get any user's avatar |
| GET | `/api/v1/users/{id}/profile` | JWT | Get any user's public profile |
| GET | `/api/v1/me/public-keys` | JWT (`Permission-user.profile.read`) | List your public keys |
| POST | `/api/v1/me/public-keys` | JWT (`Permission-user.profile.update`) | Add a public key |
| DELETE | `/api/v1/me/public-keys/{keyId}` | JWT (`Permission-user.profile.update`) | Soft-revoke a public key |
| GET | `/api/v1/me/identities` | JWT (`Permission-user.profile.read`) | List your linked identities |
| POST | `/api/v1/me/identities` | JWT (`Permission-user.profile.update`) | Link an identity (non-OAuth providers only) |
| DELETE | `/api/v1/me/identities/{identityId}` | JWT (`Permission-user.profile.update`) | Unlink an identity |
| GET | `/api/v1/me/privacy` | JWT (`Permission-user.profile.read`) | Get your privacy settings |
| PUT | `/api/v1/me/privacy` | JWT (`Permission-user.profile.update`) | Replace your privacy settings |
| GET | `/api/v1/me/entitlements` | JWT (`Permission-user.profile.read`) | List your software entitlements |
| POST | `/api/v1/me/heartbeat` | JWT | Presence heartbeat (throttled `LastSeenAt` write) |

## Your own profile

### `GET /api/v1/me`

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "username": "pk-a1b2c3d4e5f6",
  "nickname": "Al",
  "email": "dev@example.com",
  "metadata": "{}",
  "createdAt": "2026-07-01T12:00:00Z",
  "updatedAt": "2026-07-20T09:30:00Z",
  "privacy": {
    "onlineStatus": 1,
    "currentlyPlaying": 1,
    "recentLaunchActivity": 0,
    "hoursPlayed": 0,
    "recentDownloads": 0,
    "achievements": 2,
    "friendDiscoverability": 1,
    "profileVisibility": 2
  }
}
```

### `PATCH /api/v1/me`

All fields optional. Constraints: `username` 1–32 characters and unique; `nickname` ≤64 characters, non-unique; `metadata` ≤4096 characters. Returns 204 on success, 409 on conflict (e.g. username taken).

```json
{
  "username": "newname",
  "email": "new@example.com",
  "metadata": "{}",
  "nickname": "New Nick"
}
```

### Avatars

`PUT /api/v1/me/avatar` accepts a PNG image, square, ≤512×512 pixels, ≤1 MB:

```json
{ "imageBase64": "iVBORw0KGgoAAAANSUhEUg..." }
```

Returns 204. `GET /api/v1/me/avatar` returns your avatar as `image/png` bytes.

### Other users

- `GET /api/v1/users/{id}/avatar` — PNG avatar for any user.
- `GET /api/v1/users/{id}/profile`:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "username": "pk-a1b2c3d4e5f6",
  "nickname": "Al"
}
```

## Public keys

### `GET /api/v1/me/public-keys`

```json
[
  {
    "id": "9b2f5c74-1d2e-4a6b-8c0d-1e2f3a4b5c6d",
    "keyType": "Ed25519",
    "keyData": "MCowBQYDK2VwAyEA...",
    "createdAt": "2026-07-01T12:00:00Z",
    "isRevoked": false,
    "metadata": null
  }
]
```

### `POST /api/v1/me/public-keys`

```json
{
  "keyType": "Ed25519",
  "keyData": "MCowBQYDK2VwAyEA..."
}
```

Returns the created key.

### `DELETE /api/v1/me/public-keys/{keyId}`

Soft-revokes the key. Returns 204.

## Linked identities

### `GET /api/v1/me/identities`

```json
[
  {
    "id": "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
    "provider": "github",
    "providerUserId": "12345678",
    "createdAt": "2026-07-01T12:00:00Z",
    "metadata": "{\"login\":\"octocat\"}"
  }
]
```

### `POST /api/v1/me/identities`

```json
{
  "provider": "steam",
  "providerUserId": "76561198000000000",
  "metadata": null
}
```

Providers `github` and `google` (and any configured OAuth provider) are **rejected** here — those identities are linkable only via the OAuth flow; see [Authentication](auth.md).

### `DELETE /api/v1/me/identities/{identityId}`

Returns 204.

## Privacy settings

`GET /api/v1/me/privacy` returns your `PrivacySettings`; `PUT /api/v1/me/privacy` replaces them (returns 204):

```json
{
  "onlineStatus": 1,
  "currentlyPlaying": 1,
  "recentLaunchActivity": 0,
  "hoursPlayed": 0,
  "recentDownloads": 0,
  "achievements": 2,
  "friendDiscoverability": 1,
  "profileVisibility": 2
}
```

Each field is a `PrivacyLevel` enum: `0` = Private, `1` = FriendsOnly, `2` = Public.

## Entitlements

### `GET /api/v1/me/entitlements`

```json
[
  {
    "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "softwareTitleId": "6e7f8a9b-0c1d-4e2f-8a3b-4c5d6e7f8a9b",
    "softwareTitleName": "StarHermit Chess",
    "grantedAt": "2026-07-01T12:00:00Z",
    "grantedBy": "store",
    "isRevoked": false,
    "revokedAt": null,
    "revokedBy": null
  }
]
```

## Presence heartbeat

### `POST /api/v1/me/heartbeat`

Returns 204. Writes `LastSeenAt` server-side, throttled — this is the presence signal used by friends and chat.

## Game-scoped launch tokens

Of the endpoints on this page, a game-scoped launch token may only call:

- `GET /api/v1/users/{id}/avatar`
- `GET /api/v1/users/{id}/profile`
- `GET /api/v1/me/friends` (see [Friends](friends.md))

Everything else returns 403 under the game-scope fencing described in [Authentication](auth.md).

## Display-name convention

The chess client displays **nicknames**, never usernames, and falls back to `"Player " + id.slice(0,8)` when no nickname is set. External game clients should follow the same convention when rendering opponents.
