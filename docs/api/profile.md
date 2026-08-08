# Profile

The profile API covers the authenticated user's own account (`/api/v1/me/...`), public lookups of other users, public keys, linked identities, privacy settings, entitlements, and the presence heartbeat. All routes require authorization.

Errors are returned as `{"error":"..."}` with standard status codes (400/401/403/404/409/422/429).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/me` | JWT (`Permission-user.profile.read`) | Get your own profile |
| PATCH | `/api/v1/me` | JWT (`Permission-user.profile.update`) | Update username, email, metadata, or nickname |
| POST | `/api/v1/me/terms/accept` | JWT (`Permission-user.profile.update`) | Record acceptance of a specific terms revision |
| PUT | `/api/v1/me/avatar` | JWT (`Permission-user.profile.update`) | Upload your avatar |
| GET | `/api/v1/me/avatar` | JWT (`Permission-user.profile.read`) | Get your avatar |
| GET | `/api/v1/users/{id}/avatar` | JWT | Get any user's avatar |
| GET | `/api/v1/users/{id}/profile` | JWT | Get any user's public profile |
| GET | `/api/v1/me/public-keys` | JWT (`Permission-user.profile.read`) | List your public keys |
| POST | `/api/v1/me/public-keys` | **OAuth-authenticated** JWT (`Permission-user.profile.update`) | Add a public key immediately |
| DELETE | `/api/v1/me/public-keys/{keyId}` | **OAuth-authenticated** JWT (`Permission-user.profile.update`) | Revoke one key and its sessions |
| DELETE | `/api/v1/me/public-keys/all` | **OAuth-authenticated** JWT (`Permission-user.profile.update`) | Revoke every active key and its sessions |
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
  "termsAcceptedHash": "9f86d081884c7d65...",
  "termsAcceptedAt": "2026-07-30T11:02:44Z",
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

All fields optional. Constraints: `username` 1–32 characters and unique; `nickname` ≤64 characters,
non-unique; `metadata` ≤4096 characters. Changing `email` additionally requires an
OAuth-authenticated session because the account email can approve credential links; a public-key or
email-verification session gets `403` for that field but may still update the others. Returns 204 on
success, 409 on conflict (for example, a username is already taken).

```json
{
  "username": "newname",
  "email": "new@example.com",
  "metadata": "{}",
  "nickname": "New Nick"
}
```

### `POST /api/v1/me/terms/accept`

Records that this account accepted your terms of service. The body is the **hash of the terms text
that was shown** (≤64 characters), not a boolean — so acceptance is tied to a specific revision, and
publishing new terms is a matter of comparing hashes rather than resetting a flag on every account.

```json
{ "hash": "9f86d081884c7d65..." }
```

Returns `{ "termsAcceptedHash", "termsAcceptedAt" }`; both also appear on `GET /api/v1/me`, where
they are `null` for an account that has never accepted. A missing or over-long hash is `400`.
Requires `Permission-user.profile.update`, so a game-scoped launch token cannot accept terms on a
player's behalf.

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

A registered key is an API credential: its holder can complete the
[public-key challenge flow](auth.md#public-key-login) and receive an ordinary access/refresh-token
pair. This makes a separately labelled key suitable for a desktop client or deployment pipeline.

**Only a session created directly by Google or GitHub OAuth may change the key list.** A public-key,
email-verification, game-launch, or game-server session gets `403`, even if it otherwise carries the
profile-update permission. This prevents one stolen key from enrolling replacements or revoking the
owner's keys. Listing remains available to any full account session.

### `GET /api/v1/me/public-keys`

The list includes revoked rows as an audit trail:

```json
[
  {
    "id": "9b2f5c74-1d2e-4a6b-8c0d-1e2f3a4b5c6d",
    "keyType": "Ed25519",
    "keyData": "<base64-raw-32-byte-public-key>",
    "label": "orbit-league-production",
    "fingerprint": "4d9f3c...",
    "createdAt": "2026-07-01T12:00:00Z",
    "lastUsedAt": "2026-07-30T09:00:00Z",
    "isRevoked": false,
    "revokedAt": null,
    "metadata": null
  }
]
```

### `POST /api/v1/me/public-keys`

Requires an OAuth-authenticated session and attaches the key immediately; unlike anonymous
registration, no email round trip is needed.

```json
{
  "keyType": "Ed25519",
  "keyData": "<base64-raw-32-byte-public-key>",
  "label": "orbit-league-production"
}
```

`label` is optional (128 characters maximum). Accepted key types are `Ed25519`, `ECDSA-P256`, and
`RSA-PSS`; material must be standard Base64: a raw 32-byte public key for Ed25519, an encoded P-256
curve point for ECDSA, or a public SPKI for RSA. RSA keys must be 2048–8192 bits. The platform
canonicalizes valid material and limits an account to 20 active keys by default. `fingerprint` is
the lowercase SHA-256 hex digest of the canonical `keyType:keyData` string.

Returns `201` with the created key. Invalid material returns `400`; an already-active key or a full
key list returns `409` (the latter includes `limit`). Active key material is unique platform-wide.

### `DELETE /api/v1/me/public-keys/{keyId}`

Requires an OAuth-authenticated session. Revocation is idempotent and ends refresh sessions minted
by the key; access tokens naming it are refused on their next request. Returns:

```json
{ "revoked": [{ "id": "...", "isRevoked": true }], "sessionsEnded": 1 }
```

An unknown key on this account returns `404`.

### `DELETE /api/v1/me/public-keys/all`

The compromise-response operation: revoke every active key and end all sessions they authenticated.
It has an explicit `/all` path so an accidentally empty key ID cannot become a bulk revocation.
Returns the same `{ revoked, sessionsEnded }` shape.

For a complete machine-deployment example, see
[Upload builds from CI/CD with an OAuth-enrolled public key](../tutorials/ci-cd-build-upload.md).

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

Removing an OAuth-managed identity requires an OAuth-authenticated session, so a stolen public key
cannot remove the owner's route back into the account. Returns 204.

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

Game UIs typically display **nicknames** rather than usernames when rendering opponents, falling back to something like `"Player " + id.slice(0,8)` when no nickname is set. The chess reference implementation follows this convention; other game clients should do the same.
