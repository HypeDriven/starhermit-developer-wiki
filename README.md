# StarHermit Developer Wiki

Documentation for the public API of **[StarHermit](https://starhermit.com)** — a game/software
distribution + social platform: users & OAuth auth, friends, text chat, realtime voice,
publishers, a software catalog with builds/assets, entitlements, achievements, leaderboards,
a peer relay, and **server-authoritative multiplayer games** whose rules run either in a
sandboxed JavaScript file or a developer-supplied container. This wiki is a general integration
guide for **any** game targeting the platform.

The reference example used throughout this wiki is
[HypeDriven/starhermit-chess](https://github.com/HypeDriven/starhermit-chess) — a
correspondence-chess game (no-build static site + one server-side JS rules file) that uses
launch tokens, elo matchmaking, friend invites, the gameplay WebSocket, in-game chat, voice,
leaderboards, and replays — playable live at [chess.starhermit.com](https://chess.starhermit.com).
It is one concrete implementation of the patterns described here,
not the subject of the docs.

## Where to start

- **[Getting started](docs/getting-started.md)** — base URLs, versioning, auth model, and the
  the ways to integrate (a platform game published from GitHub or uploaded as a folder, with an
  optional script or container server, or an external client calling the REST/WS API directly).
- **[Tutorial: end-to-end integration walkthrough (using the chess reference example)](docs/tutorials/chess-walkthrough.md)** —
  the full lifecycle from launch token to replay viewer, with the exact calls a game client
  makes, illustrated by the chess reference implementation.
- **[Tutorial: use AI to wire StarHermit into your game](docs/tutorials/ai-prompts.md)** —
  copy-pasteable prompts for an AI coding assistant, one per feature plus an all-together
  mega-prompt.
- **[Tutorial: publish a dedicated server and onboard players in-game](docs/tutorials/dedicated-server-onboarding.md)** —
  push a container bundle, renew its server token, and use public-key registration to onboard
  Steam/Epic/GOG/native players without OAuth or a StarHermit dashboard visit.
- **[Tutorial: claim a game someone else added](docs/tutorials/claim-existing-game.md)** —
  prove repository control, take over the existing listing, and manage its hosting and deployments.

## API reference

Conventions shared by all endpoints: REST under `api/v1/...` at `https://api.starhermit.com`,
WebSockets under `ws/v1/...`, JWT bearer auth
(`?access_token=` allowed on `/ws/**`), camelCase JSON, errors as `{"error":"..."}`.

| Area | Page | What's inside |
|---|---|---|
| Auth | [auth.md](docs/api/auth.md) | Public-key registration/login, Google & GitHub OAuth, refresh rotation, launch tokens & game-scope fencing |
| Games | [games.md](docs/api/games.md) | Sessions, elo matchmaking, friend invites, per-player controls, AI practice, replays, `ws/v1/games` protocol |
| Game scripts | [game-scripts.md](docs/api/game-scripts.md) | Authoring the server-side JS rules file (Jint sandbox contract, budgets, tick rate, elo, achievements, replays) |
| Container game servers | [container-games.md](docs/api/container-games.md) | Shipping authoritative game logic as a digest-pinned container (protocol, streams, snapshots, isolation, recovery) |
| Profile | [profile.md](docs/api/profile.md) | `me`, avatars, privacy settings, public keys, linked identities, entitlements, presence heartbeat |
| Friends | [friends.md](docs/api/friends.md) | Friend requests, friend list with online/current-game presence |
| Chat | [chat.md](docs/api/chat.md) | Conversations, messages, unread state, invites, `ws/v1/chat` push events, in-game chat pattern |
| Voice | [voice.md](docs/api/voice.md) | Voice rooms, `ws/v1/voice` audio relay + WebRTC signaling |
| Catalog | [catalog.md](docs/api/catalog.md) | Software titles, builds, downloads, cloud saves, wishlist, ratings & reviews |
| Activity | [activity.md](docs/api/activity.md) | Launch sessions, playtime, friends' activity feeds |
| Achievements | [achievements.md](docs/api/achievements.md) | Server-authoritative game achievements (script or container), client-claimed catalog-title achievements, secret achievements |
| Leaderboards | [leaderboards.md](docs/api/leaderboards.md) | Definitions, entries, friends-only views, server-runtime-owned elo boards |
| External libraries | [external-libraries.md](docs/api/external-libraries.md) | Linking Steam/Epic/GOG libraries, external launch URIs |
| Relay | [relay.md](docs/api/relay.md) | Match-bound opaque byte fan-out with roster authorization and tick-aware rate limits (`ws/v1/relay`) |
| Realtime rooms | [realtime.md](docs/api/realtime.md) | Lobbies, friend invites, quick-join matchmaking, AI-seat backfill, host-authoritative frame routing (`ws/v1/realtime`) |
| GitHub games | [github-games.md](docs/api/github-games.md) | Publishing from GitHub, a hosted URL, **a local folder**, or an uploaded client/container bundle (`starhermit.txt`, hosting, deployments, **your audience figures**) |
| Publisher | [publisher.md](docs/api/publisher.md) | Publisher/member management, title & build publishing, achievement/leaderboard/entitlement management |

## Notes

- Availability of relay, voice, and realtime room features may vary.
