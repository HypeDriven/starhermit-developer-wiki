# Authentication

StarHermit has **no password authentication**. There are two sign-in flows: public-key authentication (Ed25519, ECDSA-P256, or RSA-PSS, with email-verified registration) and OAuth. All auth routes live under `api/v1/auth` and are anonymous except where noted. This page also covers token lifecycles, game-scoped launch tokens, and WebSocket connection tickets.

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
| POST | `/api/v1/auth/public-key/revoke-request` | Anonymous | Email a link that revokes every active key on the matching account |
| GET | `/api/v1/auth/public-key/revoke/confirm` | Emailed one-time token | Confirm that revocation; issues no session |
| GET | `/api/v1/auth/games/{gameId}/sign-in` | Anonymous | Sign in or create an account, then return directly to a hosted game |
| GET | `/api/v1/auth/oauth/providers` | Anonymous | Live OAuth providers this deployment can actually sign people in with |
| GET | `/api/v1/auth/oauth/{provider}/authorize` | Anonymous | Redirect to the OAuth provider |
| GET | `/api/v1/auth/oauth/{provider}/callback` | Anonymous | OAuth callback; redirects to the frontend with tokens |
| GET | `/api/v1/auth/oauth/link/confirm` | Emailed one-time token | Confirm an identity link held for account-owner approval |
| POST | `/api/v1/games/{slug}/launch-token` | JWT | Mint a game-scoped launch token (see below) |
| POST | `/api/v1/realtime/connection-tickets` | JWT | One-time ticket for opening a `/ws/**` socket |

## After sign-in: current terms

Successful sign-in does not imply permission to use protected APIs. Account holders must
[accept the current StarHermit terms](profile.md#terms-acceptance) before protected REST calls or
WebSocket upgrades succeed. Account clients can check `GET /api/v1/me`, fetch `GET /api/v1/terms`,
and record explicit acceptance with `POST /api/v1/me/terms/accept`. Both OAuth and public-key
account sessions support this flow. Refreshing credentials does not resolve pending acceptance.

A directly opened browser game can receive a scoped token before the account has accepted.
If a game call returns `403` with `error: "terms_acceptance_required"`, direct the player to their
StarHermit account UI to accept and then retry. The game token cannot accept terms, even though
it can read `GET /api/v1/terms`. Do not treat this response as an expired-token sign-in loop.

## Public-key registration

### `POST /api/v1/auth/public-key/register`

Begins public-key registration and sends a verification email. The pending registration record expires after 4 hours. If `userId` is set, the email must match that account. Throttled to 1 email per address and per IP per 24 hours — when throttled, the response is 429 with a `Retry-After` header.

When `userId` is set and the pair does not check out, the response is `403` with a single message
regardless of *why*: an unknown account and a wrong address answer identically. This endpoint takes
no credentials — it has to, since it is how a new key gets attached — so distinguishing them would
make it an oracle for which user ids exist and then for their addresses. A caller who owns the
account already knows which of the two they got wrong.

Request:

```json
{
  "email": "dev@example.com",
  "keyType": "Ed25519",
  "keyData": "<base64-raw-32-byte-public-key>",
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
  "keyData": "<base64-raw-32-byte-public-key>"
}
```

Response:

```json
{
  "challengeId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "payload": {
    "challengeId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "fingerprint": "4d9f3c...",
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
  "keyData": "<base64-raw-32-byte-public-key>"
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

#### When refresh stops working

A refresh token records the account state it was issued under, and refresh checks it. Two answers
your client must handle rather than retry:

| Status | Meaning | What the client should do |
|---|---|---|
| `401` | The session was revoked platform-side — a "sign out everywhere", or a compromise response. The whole token family is burned, including the token just presented. | Discard both tokens and start a fresh sign-in. |
| `403` | The account is **suspended**. | Stop. Signing in again will not help; the same `403` comes back from every sign-in route until the suspension is lifted. |

The `403` is deliberately distinct from `401`, because the two need opposite reactions: one means
"authenticate again", the other means "authenticating again is pointless". A suspended account is
refused by *every* credential-minting route — refresh, public-key completion, the OAuth callback,
and game launch tokens — not only by refresh.

### `POST /api/v1/auth/logout`

Revokes the given refresh token. Returns 200.

```json
{ "refreshToken": "dGhpcyBpcyBh..." }
```

## OAuth

The platform ships seven providers: `google`, `github`, `discord`, `twitch`, `gitlab`, `linkedin`,
`bitbucket`. **Only providers this deployment has credentials for are live.** A client must not
hard-code the list.

### `GET /api/v1/auth/oauth/providers`

Anonymous. Returns the live providers in the order they should be offered:

```json
{
  "providers": [
    {
      "provider": "google",
      "displayName": "Google",
      "authorizeUrl": "/api/v1/auth/oauth/google/authorize",
      "linksExistingAccountsByEmail": true
    }
  ]
}
```

`linksExistingAccountsByEmail` is whether a sign-in at that provider can find an account the person
already has (the operator's trust setting for that provider). Asking to authorize a name that is not
live is `404`, not a redirect into the provider's own error page.

### `GET /api/v1/auth/oauth/{provider}/authorize?link=&client=`

Returns a 302 redirect to the provider and sets an `oauth_state` cookie (HttpOnly, SameSite=Lax, 10
minutes). `link=true` starts linking the identity to the currently logged-in user; linking requires
recent authentication (within 5 minutes). `client` selects a supported client redirect. For a
directly opened game, use `gameId` and optional `returnUrl` instead; see
[Sign in from a directly opened browser game](#sign-in-from-a-directly-opened-browser-game).

### `GET /api/v1/auth/oauth/{provider}/callback?code=&state=`

For ordinary account sign-in, returns a 302 redirect to the frontend URL with the tokens in the
fragment (game sign-in instead returns a scoped token directly to the game, as described below):

```
#access_token=…&refresh_token=…&token_type=Bearer&expires_in=900
```

If the provider refuses the token exchange, the callback answers `409` naming the provider's error
**code** (the description stays in the server log).

A normal sign-in finds or creates the user (username `oauth-{provider}-{guid}`, role `User`) and the
new session records `auth_method=oauth`. A sign-in whose `(provider, providerUserId)` is unknown is
**adopted onto an existing account** only when the provider's assertion is trusted, exactly one
account already holds that verified email, and that account has no identity from this provider yet.
Anything else provisions a separate account. Adoption emails the account naming the provider.

This matters because only an OAuth-authenticated session
may perform high-impact credential changes:

- add or revoke account public keys;
- change the account email;
- remove an OAuth-managed identity.

Game-scoped tokens can never perform these operations. A refresh token retains the original
session's authentication method, so refreshing an OAuth session does not remove this capability and
refreshing a public-key session does not add it.

When `link=true`, the callback does not automatically promote the session merely because it visited
an OAuth provider. A link started from an OAuth session is attached immediately. A link started from
a public-key, email-verification, or legacy session is held until the account owner opens the
confirmation sent to the account's verified email; the redirect fragment reports
`link=pending_email_confirmation`. The one-time email leads to
`GET /api/v1/auth/oauth/link/confirm?token=…`. This prevents a stolen public key from linking the
attacker's provider account and turning that into a permanent OAuth sign-in.

GitHub identity metadata stores `{"login":"…"}` — this is used for repository-ownership checks in
[GitHub Games](github-games.md).

### OAuth-enrolled public keys for automation

An OAuth session can call `POST /api/v1/me/public-keys` to attach a labelled machine key immediately.
Later, CI signs the normal public-key challenge and uses its short-lived access token to upload an
owned game's bundle; the private key never leaves the CI secret store. See
[the CI/CD build-upload tutorial](../tutorials/ci-cd-build-upload.md) for setup, a signing helper, and
a GitHub Actions workflow.

## Tokens

- **Access token** — JWT, 15-minute lifetime (`expires_in=900`). Claims include `sub` (the user id) plus `permission` and role claims. Revocation takes effect immediately.
- **Refresh token** — An opaque rotating token with a 7-day lifetime. Each refresh issues a new refresh token and revokes the old one; reusing a revoked token revokes the entire token family.

## Sign in from a directly opened browser game

A hosted game opened outside the dashboard can show a **Sign in** button linking to:

```text
https://api.starhermit.com/api/v1/auth/games/{gameId}/sign-in
```

`gameId` is the game's immutable UUID (the subdomain in `{gameId}.starhermit.com`). Starhermit
shows its enabled sign-in providers. Continuing signs in an existing player or creates a new
account using the normal OAuth account-matching rules, then redirects **straight back to the
game**, without visiting the dashboard.

The optional `returnUrl` preserves a specific game page, query string or hash route. It must be
an absolute HTTPS URL on exactly that game's hosted origin; other games, external hosts,
credentials in the URL and alternate ports are rejected with `400`. Omit it to return to the
published launch file. Unknown, removed, unhosted or never-published games return `404`. Both
repository deployments and uploaded games are supported; arbitrary external/local URLs are not.

Navigate the browser to the **public API origin** above, rather than fetching the page or starting
through the game's `/api` proxy. The OAuth state cookie and provider callback must use the same
API host. Use this flow when the game has no valid launcher-provided or previously obtained token.

### Button and return-token example

```html
<button id="starhermit-sign-in">Sign in</button>
<script type="module">
const api = 'https://api.starhermit.com';
const gameId = 'YOUR_GAME_UID';
const signIn = document.querySelector('#starhermit-sign-in');
let gameToken = null; // Or your existing launcher-provided game token.

// Read this before your game router or third-party scripts consume the fragment.
const auth = new URLSearchParams(location.hash.slice(1));
if (auth.has('access_token')) {
  gameToken = auth.get('access_token');
  const originalHash = auth.get('game_fragment');
  history.replaceState(null, '', location.pathname + location.search +
    (originalHash ? '#' + originalHash : ''));
}
signIn.hidden = Boolean(gameToken);
signIn.addEventListener('click', () => {
  const url = new URL(`/api/v1/auth/games/${gameId}/sign-in`, api);
  url.searchParams.set('returnUrl', location.href);
  location.assign(url.href);
});

// Pass gameToken to your game's API client as Authorization: Bearer <gameToken>.
// This example keeps it in memory; a reload can require sign-in again.
</script>
```

The return fragment is:

```text
#access_token=…&token_type=Bearer&expires_in=3600
```

`access_token` is a **game-scoped launch token**, not an account-wide access token. No refresh token
is issued. `expires_in` uses the deployment's configured launch-token lifetime (default 3600
seconds). An original return URL fragment is encoded in the optional `game_fragment` field;
restore it after capturing the token and removing authentication data from browser history.
Do not log or forward the token.

Renew before expiry using `POST /api/v1/games/{gameId}/launch-token` with the current token as
Bearer authorization, then replace it with the returned `token`. The usual renewal-chain ceiling
applies (default 12 hours). If the token expires or renewal is refused, clear it and show Sign in
again. See [Game launch tokens](#game-launch-tokens).

### Choosing a provider yourself

Games may instead read `GET /api/v1/auth/oauth/providers` and navigate to an offered `authorizeUrl`
on the public API origin, adding `gameId` and optionally `returnUrl`. The authorization step
validates and stores the target in the existing ten-minute OAuth state; callback query parameters
cannot change it. The initiating browser's cookie is still required, and the game is checked again
before issuing a token. Suspended accounts cannot receive a token.

Do not combine game sign-in with `client` or `link` (`400`). A `returnUrl` without `gameId` is also
`400`. Normal dashboard and desktop sign-in continue using their configured frontend destinations
and ordinary account token pairs.

## Game launch tokens

`POST /api/v1/games/{slug}/launch-token` (JWT) mints a game-scoped JWT:

```json
{
  "token": "eyJhbGciOi...",
  "expiresInSeconds": 3600
}
```

The token carries a `game_scope` claim and defaults to a 60-minute lifetime. Renewal copies a
`launch_chain` start time forward; past 12 hours (default) renewal is `403` and the holder must go
back to a full account session. Full details are in [Games](games.md).

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
curl -s -X POST https://api.starhermit.com/api/v1/auth/public-key/challenge \
  -H "Content-Type: application/json" \
  -d '{"keyType":"Ed25519","keyData":"<base64-raw-32-byte-public-key>"}'
# → { "challengeId": "...", "payload": { ... }, "expiresIn": 300 }

# 2. Sign the serialized payload JSON with your private key, then complete
curl -s -X POST https://api.starhermit.com/api/v1/auth/public-key/complete \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"...","signature":"base64-signature...","keyType":"Ed25519","keyData":"<base64-raw-32-byte-public-key>"}'
# → { "userId": "...", "accessToken": "...", "refreshToken": "..." }

# 3. Call the API with the access token
curl -s https://api.starhermit.com/api/v1/me \
  -H "Authorization: Bearer eyJhbGciOi..."

# 4. When the access token expires (after 15 min), rotate the refresh token
curl -s -X POST https://api.starhermit.com/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"dGhpcyBpcyBh..."}'

# 5. On logout, revoke the refresh token
curl -s -X POST https://api.starhermit.com/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"dGhpcyBpcyBh..."}'
```

OAuth login is browser-driven: read `GET /api/v1/auth/oauth/providers`, open a live provider's
`authorizeUrl`, complete consent, and the callback lands the user on the frontend with
`#access_token=…&refresh_token=…` in the URL fragment.

## Emailed key revocation

For an owner who cannot reach `DELETE /me/public-keys` (no OAuth session, or locked out by a stolen
key). `POST /api/v1/auth/public-key/revoke-request` with `{ "email": "…" }` holds a request and
emails a link. `GET /api/v1/auth/public-key/revoke/confirm?token=…` revokes **every** active key on
that account and ends the sessions they authenticated. Both are unauthenticated, answer `202` with
the same body whatever they find, and **issue no session**.

## WebSocket connection tickets

`POST /api/v1/realtime/connection-tickets` exchanges the caller's bearer token for a one-time ticket
valid about 30 seconds. Pass it as `?ticket=` on any `/ws/v1/*` handshake. It carries the caller's
claims verbatim (including `game_scope` and `pk`), is refused on REST, and is spent on first use.
Any authenticated caller may ask, including a game-scoped launch token. `?access_token=` still works
until clients have moved.

## Embedded onboarding for native/storefront games

A Steam, Epic, GOG, or standalone client can generate a key on the player's device and present the
public-key registration flow inside its own UI, avoiding OAuth and a visit to the StarHermit
dashboard. Registration is not silent: the player must consent, provide an email, and follow the
one-time verification link. A game server token cannot create or impersonate players. See the
[dedicated-server and embedded-onboarding tutorial](../tutorials/dedicated-server-onboarding.md).
