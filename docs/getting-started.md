# Getting Started

[StarHermit](https://starhermit.com) is a game- and software-distribution platform with a built-in social layer, exposed over REST and WebSockets. This page gives you the lay of the land: what the platform does, where it listens, how authentication and versioning work, and the two ways your own game can integrate with it.

## What StarHermit provides

- **Users & authentication** — public-key registration (no passwords) and OAuth sign-in; see [Authentication](api/auth.md).
- **Profiles & presence** — user profiles, avatars, privacy settings, entitlements, and presence heartbeats; see [Profile](api/profile.md).
- **Friends** — friend requests and friendship state; see [Friends](api/friends.md).
- **Text chat** — conversations and messages; see [Chat](api/chat.md).
- **Realtime voice** — voice rooms; see [Voice](api/voice.md).
- **Publishers** — publisher accounts that own catalog entries; see [Publisher](api/publisher.md).
- **Software catalog** — software titles with builds and downloadable assets; see [Catalog](api/catalog.md).
- **Entitlements** — per-user grants of catalog software (part of [Profile](api/profile.md)).
- **Achievements & leaderboards** — see [Achievements](api/achievements.md) and [Leaderboards](api/leaderboards.md).
- **Peer relay** — see [Relay](api/relay.md).
- **Games & game scripts** — server-authoritative, scripted games hosted by the platform; see [Games](api/games.md) and [Game Scripts](api/game-scripts.md).

## Base URLs and ports

- Hosted platform: [https://starhermit.com](https://starhermit.com). Games published on it are served at `https://<slug>.starhermit.com` with `/api` and `/ws` proxied same-origin, so platform-hosted games use relative paths and never need to configure a base URL.
- Local development: REST base `http://localhost:5000` (the default local port is 5000; some local setups use 5050). The `localhost` URLs throughout this wiki refer to a locally running backend.
- WebSockets use the same host and port, under `ws/v1/...`.

## Versioning

All REST routes are versioned: `api/v1/...`. WebSocket routes live under `ws/v1/...` and are version-neutral.

## Authentication model (overview)

- Access tokens are JWTs with a 15-minute lifetime; refresh tokens rotate and last 7 days. See [Authentication](api/auth.md) for the token format and the refresh/logout endpoints.
- Send the access token as a `Authorization: Bearer <token>` header on every authenticated request. For `/ws/**` paths only, the token is also accepted as an `?access_token=` query parameter, because browsers cannot set headers on WebSocket handshakes.
- Games additionally use **game-scoped launch tokens** — short-lived JWTs minted per game that fence the caller into that game's API surface. See [Authentication](api/auth.md#game-launch-tokens) and [Games](api/games.md).

## Two ways to integrate your game

1. **Scripted platform game.** You publish a game from a GitHub repo: a `starhermit.txt` manifest plus a `server.js` game script. The platform serves the game at `<slug>.starhermit.com` with `/api` and `/ws` proxied same-origin to the StarHermit backend, and runs your script server-side so game logic is server-authoritative. This path is demonstrated end-to-end by the chess reference implementation at <https://github.com/HypeDriven/starhermit-chess>. See [GitHub Games](api/github-games.md), [Game Scripts](api/game-scripts.md), and the [Integration Walkthrough](tutorials/chess-walkthrough.md).
2. **External game client.** Your own client calls the REST and WebSocket API directly, using JWT auth and, where appropriate, game launch tokens. The API reference pages below document the surface.

## API reference

- [Authentication](api/auth.md)
- [Games](api/games.md)
- [Game Scripts](api/game-scripts.md)
- [Profile](api/profile.md)
- [Friends](api/friends.md)
- [Chat](api/chat.md)
- [Voice](api/voice.md)
- [Catalog](api/catalog.md)
- [Activity](api/activity.md)
- [Achievements](api/achievements.md)
- [Leaderboards](api/leaderboards.md)
- [External Libraries](api/external-libraries.md)
- [Relay](api/relay.md)
- [GitHub Games](api/github-games.md)
- [Publisher](api/publisher.md)

Tutorials: [Integration Walkthrough (chess reference example)](tutorials/chess-walkthrough.md), [AI Prompts](tutorials/ai-prompts.md).

## Swagger UI

In the Development environment, Swagger UI is available at `/swagger` with three docs: `api-v1`, `publisher-v1`, and `ws-v1`. Note that the grouping is nominal — each doc contains the full API surface.

## Infrastructure endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Anonymous | HTML landing page |
| GET | `/health` | Anonymous | Health check |
| GET | `/health/details` | Anonymous | Detailed health check |

## Cross-cutting behavior

- **Security headers** are set on all responses.
- **Rate limiting** — chat messages are limited to 10 per minute per user; other endpoints may return 429 as documented per page.
- **Errors** are always returned as `{"error":"..."}` with standard status codes (400/401/403/404/409/422/429). Individual pages note endpoint-specific error cases only.
