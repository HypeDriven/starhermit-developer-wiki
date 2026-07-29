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
- **Achievements & leaderboards** — server-authoritative achievements for games with a script or container backend, plus client-claimed achievements for catalog titles; see [Achievements](api/achievements.md) and [Leaderboards](api/leaderboards.md).
- **Peer relay** — match-bound opaque byte fan-out with roster authorization and rate limits derived from the game's tick rate; see [Relay](api/relay.md).
- **Realtime rooms** — lobbies, matchmaking, AI players and backfill, and realtime transport for fast-paced games; can also bridge into a room-bound scripted session for server-authoritative play; see [Realtime Rooms](api/realtime.md).
- **Authoritative games** — platform-hosted games whose rules run as a sandboxed JavaScript [Game Script](api/game-scripts.md) or a [Container Game Server](api/container-games.md); clients use the shared [Games API](api/games.md).

## Base URLs and ports

- Public REST API: [https://api.starhermit.com](https://api.starhermit.com), under `api/v1/...`.
- Public WebSockets: `wss://api.starhermit.com/ws/v1/...`.
- Games published on the platform are served at `https://<slug>.starhermit.com` with `/api` and `/ws` available same-origin, so platform-hosted games should use relative paths.

## Versioning

All REST routes are versioned: `api/v1/...`. WebSocket routes live under `ws/v1/...` and are version-neutral.

## Authentication model (overview)

- Access tokens are JWTs with a 15-minute lifetime; refresh tokens rotate and last 7 days. See [Authentication](api/auth.md) for the token format and the refresh/logout endpoints.
- Send the access token as a `Authorization: Bearer <token>` header on every authenticated request. For `/ws/**` paths only, the token is also accepted as an `?access_token=` query parameter, because browsers cannot set headers on WebSocket handshakes.
- Games additionally use **game-scoped launch tokens** — short-lived JWTs minted per game that fence the caller into that game's API surface. See [Authentication](api/auth.md#game-launch-tokens) and [Games](api/games.md).

## Two ways to integrate your game

1. **Platform-hosted game.** You publish a game from a GitHub repo with a `starhermit.txt` manifest — or, if it does not live in a repository, [upload the folder directly](api/github-games.md#add-a-game-from-a-local-folder) and skip git entirely. It may be browser-only, use a sandboxed `server.js`, or point to a digest-pinned container image for server logic. The platform serves the game at `<slug>.starhermit.com` with `/api` and `/ws` proxied same-origin. The script path is demonstrated end-to-end by the chess reference implementation at <https://github.com/HypeDriven/starhermit-chess>. See [GitHub Games](api/github-games.md), [Game Scripts](api/game-scripts.md), [Container Game Servers](api/container-games.md), and the [Integration Walkthrough](tutorials/chess-walkthrough.md).
2. **External game client.** Your own client calls the REST and WebSocket API directly, using JWT auth and, where appropriate, game launch tokens. The API reference pages below document the surface.

## API reference

- [Authentication](api/auth.md)
- [Games](api/games.md)
- [Game Scripts](api/game-scripts.md)
- [Container Game Servers](api/container-games.md)
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
- [Realtime Rooms](api/realtime.md)
- [GitHub Games](api/github-games.md)
- [Publisher](api/publisher.md)

Tutorials: [Integration Walkthrough (chess reference example)](tutorials/chess-walkthrough.md), [Dedicated Server + Embedded Player Onboarding](tutorials/dedicated-server-onboarding.md), [Claim a Game Someone Else Added](tutorials/claim-existing-game.md), and [AI Prompts](tutorials/ai-prompts.md).

## Server clock — `GET /api/v1/time`

Deadlines the platform hands you (a session summary's `deadline`, a script's `ctx.now`) are on the
**server's** clock, so a client rendering a countdown against its own clock will drift. This
endpoint is anonymous on purpose — sync has to work before login — and is explicitly allowed for
game-scoped launch tokens, so a hosted game can call it while fenced into its own surface.

```json
{
  "serverTime": 1785060842000,
  "serverTimeIso": "2026-07-25T09:14:02+00:00",
  "clientTime": 1785060841200,
  "skew": 800
}
```

`clientTime` (unix ms, optional) is echoed back untouched so a response can be matched to its
request; `skew` is the naive `serverTime - clientTime` for clients that don't want the round-trip
math. For a real estimate, do it NTP-style: halve the round trip and compute
`offset = serverTime + rtt/2 - now`.

## Cross-cutting behavior

- **Security headers** are set on all responses.
- **Rate limiting** — chat messages are limited to 10 per minute per user; other endpoints may return 429 as documented per page.
- **Errors** are always returned as `{"error":"..."}` with standard status codes (400/401/403/404/409/422/429). Individual pages note endpoint-specific error cases only.
