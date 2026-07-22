# Authentication

StarHermit has **no password authentication**. There are two sign-in flows: public-key authentication (Ed25519, ECDSA-P256, or RSA-PSS, with email-verified registration) and OAuth (Google OIDC and GitHub). All auth routes live under `api/v1/auth` and are anonymous. This page also covers token lifecycles and the game-scoped launch tokens used by games.

Errors are returned as `{"error":"..."}` with standard status codes (400/401/403/404/409/422/429).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/public-key/register` | Anonymous | Begin public-key registration; sends a verification email |
| GET | `/api/v1/auth/public-key/verify` | Anonymous | Complete registration from the emailed link |
| POST | `/api/v1/auth/public-key/challenge` | Anonymous | Request a login challenge to sign |
| POST | `/api/v1/auth/public-key/complete` | Anonymous | Submit a signed challenge to log in |
| POST | `/api/v1/auth/refresh` | Anonymous | Rotate a refresh token for a new token pair |
| POST | `/api/v1/auth/logout` | Anonymous | Revoke a refresh token |
| GET | `/api/v1/auth/oauth/{provider}/authorize` | Anonymous | Redirect to the OAuth provider |
| GET | `/api/v1/auth/oauth/{provider}/callback` | Anonymous | OAuth callback; redirects to the frontend with tokens |
| POST | `/api/v1/games/{slug}/launch-token` | JWT | Mint a game-scoped launch token (see below) |

## Public-key registration

### `POST /api/v1/auth/public-key/register`

Begins public-key registration and sends a verification email. The pending registration record expires after 4 hours. If `userId` is set, the email must match that account. Throttled to 1 email per address and per IP per 24 hours — when throttled, the response is 429 with a `Retry-After` header.

Request:

```json
{
  "email": "dev@example.com",
  "keyType": "Ed25519",
  "keyData": "MCowBQYDK2VwAyEA...",
  "userId": null
}
```

Response — 202:

```json
{
  "registrationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "email": "dev@example.com",
  "emailSent": true,
  "message": "Verification email sent."
}
```

### `GET /api/v1/auth/public-key/verify?token=`

Completes registration from the emailed link. Creates the user (username `pk-<hex12>`, role `User`), attaches the key, and marks the email verified.

Response:

```json
{
  "userId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "keyId": "9b2f5c74-1d2e-4a6b-8c0d-1e2f3a4b5c6d",
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "dGhpcyBpcyBh..."
}
```

## Public-key login

### `POST /api/v1/auth/public-key/challenge`

Issues a login challenge (valid 5 minutes). The client signs the serialized `payload` JSON.

Request:

```json
{
  "keyType": "Ed25519",
  "keyData": "MCowBQYDK2VwAyEA..."
}
```

Response:

```json
{
  "challengeId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "payload": {
    "challengeId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "fingerprint": "SHA256:abc123...",
    "issuer": "starhermit",
    "audience": "starhermit",
    "expiry": "2026-07-22T07:24:44Z",
    "nonce": "f2e1d0c9b8a7...",
    "clientTimestamp": "2026-07-22T07:19:44Z"
  },
  "expiresIn": 300
}
```

### `POST /api/v1/auth/public-key/complete`

Verifies the signature against a registered, non-revoked key and returns a token pair.

Request:

```json
{
  "challengeId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "signature": "base64-signature...",
  "keyType": "Ed25519",
  "keyData": "MCowBQYDK2VwAyEA..."
}
```

Response:

```json
{
  "userId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "dGhpcyBpcyBh..."
}
```

## Token lifecycle

### `POST /api/v1/auth/refresh`

Rotating refresh: the old token is revoked and replaced. Reuse of a revoked refresh token revokes the whole token family.

Request:

```json
{ "refreshToken": "dGhpcyBpcyBh..." }
```

Response:

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "bmV3IHJlZnJlc2g..."
}
```

### `POST /api/v1/auth/logout`

Revokes the given refresh token. Returns 200.

```json
{ "refreshToken": "dGhpcyBpcyBh..." }
```

## OAuth

Providers: `google`, `github`.

### `GET /api/v1/auth/oauth/{provider}/authorize?link=&client=`

Returns a 302 redirect to the provider and sets an `oauth_state` cookie (HttpOnly, SameSite=Lax, 10 minutes). `link=true` links the identity to the currently logged-in user; `client` picks a named redirect from configuration.

### `GET /api/v1/auth/oauth/{provider}/callback?code=&state=`

Returns a 302 redirect to the frontend URL with the tokens in the fragment:

```
#access_token=…&refresh_token=…&token_type=Bearer&expires_in=900
```

Finds-or-creates the user (username `oauth-{provider}-{guid}`, role `User`), or links the identity to the current user (linking requires recent authentication, within 5 minutes). GitHub identity metadata stores `{"login":"…"}` — this is used for repository-ownership checks in [GitHub Games](github-games.md).

## Tokens

- **Access token** — JWT, 15-minute lifetime (`expires_in=900`). Claims include `sub` (the user id) plus `permission` and role claims. Revocation takes effect immediately.
- **Refresh token** — An opaque rotating token with a 7-day lifetime. Each refresh issues a new refresh token and revokes the old one; reusing a revoked token revokes the entire token family.

## Game launch tokens

`POST /api/v1/games/{slug}/launch-token` (JWT) mints a game-scoped JWT:

```json
{
  "token": "eyJhbGciOi...",
  "expiresInSeconds": 3600
}
```

The token carries a `game_scope` claim and defaults to a 60-minute lifetime. Full details are in [Games](games.md).

### Game-scope fencing

A game-scoped token can only reach:

- its own `/api/v1/games/{scope}` tree,
- `/ws/v1/games`,
- `GET /api/v1/me/friends`,
- `GET /api/v1/users/{id}/avatar` and `GET /api/v1/users/{id}/profile`,
- its game's leaderboard,
- the chat/voice REST and WebSocket endpoints attached to its own game sessions.

`/ws/v1/chat` is blocked for launch tokens. Everything else returns 403.

## Typical login flow (curl)

Public-key login, from challenge to authenticated call:

```bash
# 1. Request a challenge
curl -s -X POST http://localhost:5000/api/v1/auth/public-key/challenge \
  -H "Content-Type: application/json" \
  -d '{"keyType":"Ed25519","keyData":"MCowBQYDK2VwAyEA..."}'
# → { "challengeId": "...", "payload": { ... }, "expiresIn": 300 }

# 2. Sign the serialized payload JSON with your private key, then complete
curl -s -X POST http://localhost:5000/api/v1/auth/public-key/complete \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"...","signature":"base64-signature...","keyType":"Ed25519","keyData":"MCowBQYDK2VwAyEA..."}'
# → { "userId": "...", "accessToken": "...", "refreshToken": "..." }

# 3. Call the API with the access token
curl -s http://localhost:5000/api/v1/me \
  -H "Authorization: Bearer eyJhbGciOi..."

# 4. When the access token expires (after 15 min), rotate the refresh token
curl -s -X POST http://localhost:5000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"dGhpcyBpcyBh..."}'

# 5. On logout, revoke the refresh token
curl -s -X POST http://localhost:5000/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"dGhpcyBpcyBh..."}'
```

OAuth login is browser-driven: open `/api/v1/auth/oauth/google/authorize` (or `github`), complete the provider consent, and the callback lands the user on the frontend with `#access_token=…&refresh_token=…` in the URL fragment.
