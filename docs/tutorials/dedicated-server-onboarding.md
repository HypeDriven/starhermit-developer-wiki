# Publish a Dedicated Game Server and Onboard Players In-game

This tutorial shows how to:

1. Publish or update a dedicated game-server container with StarHermit's bundle-upload API.
2. Keep a long-running container's StarHermit server token renewed.
3. Onboard players from Steam, Epic, GOG, or a standalone build without sending them through an
   OAuth provider or requiring them to visit the StarHermit dashboard.
4. Give those players access to StarHermit sessions, matchmaking, leaderboards, achievements,
   session chat, voice, friends, presence, and replays.

The player-facing API is the same whether the executable came from Steam, Epic, GOG, your own
launcher, or `https://<slug>.starhermit.com`.

## Important boundary: embedded is not silent

StarHermit does not currently expose a privileged "create arbitrary player" endpoint to a game
server. A container's `STARHERMIT_SERVER_TOKEN` deliberately has no player identity and cannot mint
player accounts or impersonate players.

Public-key registration also requires a valid email and a one-time verification link. Therefore:

- You **can** keep registration inside your game's branded UI and avoid Google/GitHub OAuth and the
  StarHermit dashboard.
- You **cannot** silently create a StarHermit account from only a Steam ID, Epic account ID, or GOG
  ID. The player must consent, supply an email, and confirm it once.
- Generate and store each player's private key on their device. Do not generate every player's key
  in your dedicated server, upload private keys, or keep a custodial key database unless you are
  intentionally taking responsibility for all of those accounts.

For a native game, the smoothest supported experience is: an in-game account panel generates the
key, asks for email and consent, opens the verification link in an embedded browser, then stores the
returned tokens in the OS credential vault. The player never needs to navigate the StarHermit site.
A player who cannot provide and verify an email cannot complete this flow with the current API.

## Architecture and trust boundaries

```text
Steam/Epic/GOG/native client
  ├─ owns the player's private key
  ├─ performs public-key registration/login
  ├─ holds player access + rotating refresh token
  ├─ optionally links the external platform identity
  └─ uses a game-scoped launch token for game/social APIs
                  │
                  │ REST + ws/v1/games
                  ▼
StarHermit API ───────── authenticated command ────────► your container
  ├─ creates sessions and matchmaking                     ├─ owns simulation
  ├─ stamps the trusted StarHermit user id                 ├─ never trusts payload identity
  ├─ persists snapshots/results/elo/achievements           └─ uses narrow server token only
  └─ supplies session chat, voice, friends, and replays
```

The game client proves who the player is. StarHermit stamps that identity onto traffic sent to the
container. The container never accepts a Steam ID or user ID supplied inside gameplay JSON as proof
of identity.

## Prerequisites

You need:

- A StarHermit developer account and full access token.
- A registered game you own, with a `gameSlug` and authoritative backend. The bundle endpoint
  updates an existing game; it does not create a game record or reserve a slug.
- Container hosting enabled for your account.
- Docker or another tool capable of producing a Docker-compatible `docker save` archive.
- A container implementing [game protocol v1](../api/container-games.md#protocol-v1).

For initial self-service registration, use a verified GitHub repository with `starhermit.txt` and a
valid `container.image` declaration as described in [GitHub Games](../api/github-games.md). Once the
game exists, bundle pushes can publish later client and server builds directly.

## Part 1: implement the container contract

Your process must listen on `PORT` and implement:

| Endpoint | Responsibility |
|---|---|
| `GET /health` | Return `200` only when sessions can be accepted |
| `GET /describe` | Declare protocol `1`, requested tick rate/capacity, and achievements |
| `POST /sessions` | Create a session or restore one from `snapshot` |
| `GET /sessions/{id}/snapshot` | Return a complete durable restore point |
| `DELETE /sessions/{id}` | Release the session |
| `WS /stream` | Receive authenticated player commands and emit game payloads |
| `WS /control` | Push snapshots, achievements, Elo, results, and backpressure |

Validate `X-Starhermit-Invoke-Key` on every HTTP request and WebSocket upgrade against
`STARHERMIT_INVOKE_KEY`. This authenticates StarHermit to your process.

A minimal declaration is:

```json
{
  "protocol": 1,
  "tickRateHz": 20,
  "maxSessions": 48,
  "achievements": [
    {
      "key": "first-win",
      "name": "First Win",
      "description": "Win a match.",
      "points": 10
    }
  ]
}
```

Gameplay stream frames use:

```text
[1 byte type][16 byte sessionId][16 byte userId][payload...]
```

Type `1` is an inbound command; its user ID was stamped from the authenticated StarHermit player.
Type `2` is an outbound JSON payload addressed to that player, or to everyone when the user ID is
all zeroes.

Durable effects go over `/control`:

```json
{ "type": "snapshot", "sessionId": "...", "state": { "round": 4 } }
{ "type": "achievements", "sessionId": "...", "unlocks": { "<userId>": ["first-win"] } }
{ "type": "elo", "sessionId": "...", "updates": { "<userId>": 1248 } }
{ "type": "result", "sessionId": "...", "result": { "kind": "win", "winner": "<userId>" } }
```

StarHermit filters these updates to session participants and declared achievement keys. A result is
terminal. See [Container-hosted Game Servers](../api/container-games.md) for the full protocol,
snapshot, isolation, and recovery contract.

## Part 2: register the game once

Put a manifest in the verified repository used for initial registration:

```ini
name=Orbit League
# (There is no slug key: the platform assigns your game a uid and uses it as the
# slug — the same value as its <uid>.starhermit.com address. Nothing can choose
# it, so two games can never contend for a name. Your client reads its own slug
# from the launch token's game_scope claim.)
launch=index.html
owner=your-starhermit-name

container.image=ghcr.io/your-github-login/orbit-server@sha256:<64-lowercase-hex>
container.port=8080
container.health=/health
container.memory_mb=1024
container.cpu=1.0
```

Register it:

```bash
API=https://api.starhermit.com
ACCESS_TOKEN='developer-access-token'

curl -sS -X POST "$API/api/v1/me/github-games" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl":"https://github.com/your-github-login/orbit-league"
  }'
```

Save the returned `id` as `GAME_ID` and confirm `gameSlug` is present. If `gameSlug` is null, the
game has no authoritative backend and an uploaded server image will be rejected. Initial
registration may also fail when container hosting is unavailable or restricted.

The registry-backed image in the manifest is enough to deploy the first version. The next section
covers the newly released direct-upload path, useful for CI and for builds you do not want the
platform to clone or pull again.

## Part 3: publish a client and dedicated server bundle

### Build the archive

The upload is one gzip-compressed tar archive with this layout:

```text
client/            optional static web client, including the registered launch file
server/image.tar   optional `docker save` output
starhermit.txt     optional manifest copy
```

At least `client/` or `server/image.tar` must be present.

```bash
rm -rf bundle game-bundle.tar.gz
mkdir -p bundle/client bundle/server

# Optional hosted web client.
cp -R dist/. bundle/client/

# Dedicated server image.
docker build -t orbit-server:release -f Dockerfile.server .
docker save orbit-server:release -o bundle/server/image.tar

# Optional, useful for keeping the artifact self-describing.
cp starhermit.txt bundle/starhermit.txt

tar -C bundle -czf game-bundle.tar.gz .
```

The image must work with a read-only root filesystem, forced non-root user, no capabilities, no
volumes, no internet, and only a small writable `/tmp`. Vendor dependencies into the image.

### Upload it

`POST /api/v1/me/github-games/{id}/bundle` takes the archive as the raw request body, not as a
multipart form:

```bash
curl -sS -X POST "$API/api/v1/me/github-games/$GAME_ID/bundle" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/gzip" \
  --data-binary @game-bundle.tar.gz
```

Example response:

```json
{
  "clientPublished": true,
  "serverImageLoaded": true,
  "imageDigest": "sha256:4e7d...",
  "bytesReceived": 318767104
}
```

The platform:

- atomically swaps in `client/`, so users do not see a partially uploaded build;
- loads `server/image.tar`, computes its immutable digest, and re-pins the deployment;
- queues the old container to be replaced by the uploaded image;
- restores eligible active sessions from their persisted snapshots.

You may upload only the client or only the server image. A game's disk allowance is **4 GB** and can
be tuned per game; because a push replaces a game's content rather than adding to it, that is both
the largest push and the most disk the game can occupy. `413` includes `limitBytes`; an invalid
archive or image returns `422`; and `507` means the server has no room right now — it is checked
before your body is read, so a doomed upload is refused rather than half-landed. Do not put symlinks,
hard links, path traversal, or files outside the documented layout in the archive.

A successful upload does not mean the new process has passed health checks yet. Poll the existing
`GET /api/v1/me/github-games/{id}/deployment` view and test a real session before promoting the
build. Pinning a repository commit later explicitly switches deployment back to repository content.

## Part 4: renew the container's platform token

At startup the container receives:

```text
STARHERMIT_API_BASE
STARHERMIT_GAME_SLUG
STARHERMIT_SERVER_TOKEN
STARHERMIT_SERVER_TOKEN_EXPIRES_IN
STARHERMIT_REFRESH_KEY
STARHERMIT_INVOKE_KEY
```

`STARHERMIT_SERVER_TOKEN` is narrow: it represents the game server, not a player. It expires after
24 hours by default. Schedule renewal at roughly half of
`STARHERMIT_SERVER_TOKEN_EXPIRES_IN`:

```http
POST {STARHERMIT_API_BASE}/api/v1/games/{STARHERMIT_GAME_SLUG}/server/token
X-Starhermit-Refresh-Key: {STARHERMIT_REFRESH_KEY}
```

```json
{ "token": "eyJhbGciOi...", "expiresInSeconds": 86400 }
```

No bearer token is required for this endpoint. That permits recovery even if the old token has
already expired. Replace the in-memory token atomically and schedule the next renewal from the new
`expiresInSeconds`.

Keep the two deployment secrets separate:

- `STARHERMIT_INVOKE_KEY` authenticates StarHermit requests to your container.
- `STARHERMIT_REFRESH_KEY` authenticates your container when renewing its StarHermit token.

Both rotate on every container restart. Never log them, return them in `/describe`, put them in a
snapshot, or send them to a player.

## Part 5: onboard a non-StarHermit player without OAuth

Run this flow in the native game or launcher, not in the dedicated container.

### 1. Generate a per-installation key

Generate an Ed25519 keypair on first launch. Store the private key in the operating system's secure
credential storage (for example, Windows Credential Manager/DPAPI, macOS Keychain, or a platform
secure-storage API). Export the raw 32-byte Ed25519 public key as standard Base64 for `keyData`.

Never upload the private key. If the player uses multiple devices, authenticate the first device and
add each additional public key with `POST /api/v1/me/public-keys`, or let each installation complete
its own registration according to your account-linking policy.

### 2. Ask for consent and email

Inside your game's UI, explain that continuing creates a StarHermit identity used for multiplayer
and social services. Link your privacy notice and StarHermit's terms. Collect an email address.

Begin registration:

```http
POST /api/v1/auth/public-key/register
Content-Type: application/json
```

```json
{
  "email": "player@example.com",
  "keyType": "Ed25519",
  "keyData": "<base64-raw-32-byte-public-key>",
  "userId": null
}
```

A `202` response means the verification message was accepted:

```json
{
  "registrationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "email": "player@example.com",
  "emailSent": true,
  "message": "A verification email has been sent. The key will be attached once you confirm."
}
```

Registration expires after four hours. The endpoint is throttled to one email per address and per
source IP per 24 hours and may return `429` with `Retry-After`. Do not retry in a loop or funnel all
players through a server-side proxy; doing so can make every player share one throttled IP.

### 3. Complete verification inside the game experience

The email links to:

```text
GET /api/v1/auth/public-key/verify?token=<one-time-email-token>
```

The endpoint creates the account, attaches the public key, and returns `userId`, `keyId`,
`accessToken`, and `refreshToken`. Open the link in a secure embedded browser controlled by the
native client if you want the player to stay inside the game experience. Capture the successful
response locally and immediately close or clear the browser view.

Do not route the one-time token or returned token pair through your game server merely to make the
flow look invisible. The refresh token and private key are player credentials. If your platform's
email client forces an external browser, explain that the player must return to the game afterward;
the current API has no registration-status polling or custom callback parameter.

### 4. Log in on later launches

Request a five-minute challenge:

```http
POST /api/v1/auth/public-key/challenge
Content-Type: application/json
```

```json
{
  "keyType": "Ed25519",
  "keyData": "<same-public-key>"
}
```

Sign the UTF-8 JSON serialization of the returned `payload` with the local private key, then send:

```http
POST /api/v1/auth/public-key/complete
Content-Type: application/json
```

```json
{
  "challengeId": "<challengeId>",
  "signature": "<base64-ed25519-signature>",
  "keyType": "Ed25519",
  "keyData": "<same-public-key>"
}
```

The response contains a 15-minute access token and rotating seven-day refresh token. Use
`POST /api/v1/auth/refresh` before expiry and replace both returned tokens atomically. Refresh-token
reuse revokes the token family, so serialize refresh operations across game threads/processes.

### 5. Add a player-facing name and external identity

The generated account starts with a `pk-...` username. Let the player choose a nickname:

```http
PATCH /api/v1/me
Authorization: Bearer <access-token>
Content-Type: application/json

{ "nickname": "RookPilot" }
```

You may associate the account with the platform the executable is running under:

```http
POST /api/v1/me/identities
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "provider": "steam",
  "providerUserId": "76561198000000000",
  "metadata": "{\"displayName\":\"RookPilot\"}"
}
```

Use `steam`, `epic`, `gog`, or your own non-OAuth provider name as appropriate. Obtain the external
ID from that platform's authenticated SDK/session, not from editable player input. This endpoint
associates an identity with the StarHermit account; it is not itself proof of Steam/Epic/GOG
ownership and must not replace the platform's own ticket verification for purchases or bans.
GitHub and Google identities cannot be self-linked here because they require OAuth.

The separate external-library API is optional and currently uses demo synchronization while provider
integrations are finalized; it is not required for dedicated-server play.

## Part 6: enter the game and use StarHermit services

### Mint a least-privilege game token

Use the full access token once to mint a token fenced to your game:

```http
POST /api/v1/games/orbit-league/launch-token
Authorization: Bearer <access-token>
```

```json
{ "token": "eyJhbGciOi...", "expiresInSeconds": 3600 }
```

Use this launch token for gameplay and the allowed session social APIs. Refresh it before expiry.
Keep the full account token out of gameplay code where possible.

### Matchmaking

```http
POST /api/v1/games/orbit-league/matchmaking
Authorization: Bearer <game-token>
```

Poll `GET /api/v1/games/orbit-league/matchmaking` until `status` is `matched`, then connect:

```text
wss://api.starhermit.com/ws/v1/games?sessionId=<sessionId>&access_token=<game-token>
```

Client messages remain JSON:

```json
{ "type": "cmd", "data": { "type": "input", "throttle": 0.8 } }
```

StarHermit converts the command to the container stream and stamps the authenticated StarHermit
user ID. Your container returns authoritative game payloads through type-2 stream frames.

### Leaderboards and achievements

Every authoritative game receives an Elo leaderboard. Your container sends Elo changes and declared
achievement unlocks over `/control`; clients only read the resulting platform state:

```text
GET /api/v1/games/orbit-league/achievements
GET /api/v1/leaderboards/{leaderboardId}/entries
```

A modified Steam/Epic/GOG client cannot directly submit game leaderboard scores or claim a
game-owned achievement.

### Session chat and voice

`GET /api/v1/games/orbit-league/sessions/{sessionId}` returns `chatConversationId`. Session
conversations allow participants to chat and use voice even when they are not friends.

Typical voice flow:

1. `GET /api/v1/voice/rooms?conversationId=<chatConversationId>`.
2. If needed, `POST /api/v1/voice/rooms` with the conversation ID.
3. `POST /api/v1/voice/rooms/{roomId}/join`.
4. Connect `wss://api.starhermit.com/ws/v1/voice?roomId=<roomId>&access_token=<game-token>`.

The same account also enables friends, presence, game invites, replays, and profile identity across
all storefront builds. Keep one StarHermit key/account per human rather than creating a new account
for every match or every storefront launch.

## Production checklist

### Publishing

- [ ] Existing owned game has a non-null `gameSlug`.
- [ ] Container rejects a wrong or missing invoke key.
- [ ] `/health` does not return `200` before state can be accepted.
- [ ] Bundle uses raw `application/gzip`, not multipart encoding.
- [ ] Image works read-only, non-root, offline, and without volumes.
- [ ] Deployment status and a real matchmaking session are tested after upload.
- [ ] Server token refresh runs before half its lifetime and swaps tokens atomically.
- [ ] Neither deployment secret is logged or persisted in snapshots.

### Player onboarding

- [ ] Keypair is generated on the player device and private key uses secure storage.
- [ ] Account creation is disclosed and consented to.
- [ ] Email verification is completed once; `429 Retry-After` is respected.
- [ ] Registration and player tokens do not pass through the dedicated server.
- [ ] Access/refresh tokens are stored securely and refresh rotation is serialized.
- [ ] External IDs come from authenticated Steam/Epic/GOG SDK state.
- [ ] Gameplay uses a game-scoped token after initial account setup.
- [ ] Client handles `achievement`, `resumed`, and `abandoned` gameplay frames.

## Reference pages

- [Authentication](../api/auth.md)
- [Container-hosted Game Servers](../api/container-games.md)
- [GitHub Games and bundle upload](../api/github-games.md#push-a-game-bundle)
- [Games API](../api/games.md)
- [Profile and linked identities](../api/profile.md)
- [Leaderboards](../api/leaderboards.md)
- [Achievements](../api/achievements.md)
- [Chat](../api/chat.md)
- [Voice](../api/voice.md)
