# StarHermit Developer Wiki

Documentation for the **StarHermit public API** — a game/software
distribution + social platform: users & OAuth auth, friends, text chat, realtime voice,
publishers, a software catalog with builds/assets, entitlements, achievements, leaderboards,
a peer relay, and **scripted server-authoritative multiplayer games** whose rules live in a
single JavaScript file executed server-side.

The reference implementation used throughout this wiki is
[HypeDriven/starhermit-chess](https://github.com/HypeDriven/starhermit-chess) — a
correspondence-chess game (no-build static site + one server-side JS rules file) that uses
launch tokens, elo matchmaking, friend invites, the gameplay WebSocket, in-game chat, voice,
leaderboards, and replays.

## Where to start

- **[Getting started](docs/getting-started.md)** — base URLs, versioning, auth model, and the
  two ways to integrate (scripted platform game published from GitHub, or an external client
  calling the REST/WS API directly).
- **[Tutorial: how the chess reference game uses StarHermit, feature by feature](docs/tutorials/chess-walkthrough.md)** —
  the full lifecycle from launch token to replay viewer, with the exact calls the reference
  client makes.
- **[Tutorial: use AI to wire StarHermit into your game](docs/tutorials/ai-prompts.md)** —
  copy-pasteable prompts for an AI coding assistant, one per feature plus an all-together
  mega-prompt.

## API reference

Conventions shared by all endpoints: REST under `api/v1/...` at `http://localhost:5000`
(some local setups use port `5050`), WebSockets under `ws/v1/...`, JWT bearer auth
(`?access_token=` allowed on `/ws/**`), camelCase JSON, errors as `{"error":"..."}`.

| Area | Page | What's inside |
|---|---|---|
| Auth | [auth.md](docs/api/auth.md) | Public-key registration/login, Google & GitHub OAuth, refresh rotation, launch tokens & game-scope fencing |
| Games | [games.md](docs/api/games.md) | Sessions, elo matchmaking, friend invites, AI practice, replays, `ws/v1/games` protocol |
| Game scripts | [game-scripts.md](docs/api/game-scripts.md) | Authoring the server-side JS rules file (Jint sandbox contract, budgets, elo, replays) |
| Profile | [profile.md](docs/api/profile.md) | `me`, avatars, privacy settings, public keys, linked identities, entitlements, presence heartbeat |
| Friends | [friends.md](docs/api/friends.md) | Friend requests, friend list with online/current-game presence |
| Chat | [chat.md](docs/api/chat.md) | Conversations, messages, invites, `ws/v1/chat` push events, in-game chat pattern |
| Voice | [voice.md](docs/api/voice.md) | Voice rooms, `ws/v1/voice` audio relay + WebRTC signaling |
| Catalog | [catalog.md](docs/api/catalog.md) | Software titles, builds, downloads, cloud saves, wishlist, ratings & reviews |
| Activity | [activity.md](docs/api/activity.md) | Launch sessions, playtime, friends' activity feeds |
| Achievements | [achievements.md](docs/api/achievements.md) | Achievement definitions, unlocks, secret achievements |
| Leaderboards | [leaderboards.md](docs/api/leaderboards.md) | Definitions, entries, friends-only views, script-owned elo boards |
| External libraries | [external-libraries.md](docs/api/external-libraries.md) | Linking Steam/Epic/GOG libraries, external launch URIs |
| Relay | [relay.md](docs/api/relay.md) | Opaque byte fan-out sessions for fast-paced game netcode (`ws/v1/relay`) |
| GitHub games | [github-games.md](docs/api/github-games.md) | Publishing a game from a GitHub repo (`starhermit.txt` manifest, hosting, pinned deployments) |
| Publisher | [publisher.md](docs/api/publisher.md) | Publisher/member management, title & build publishing, achievement/leaderboard/entitlement management |

## Notes

- The admin/moderation surface is **not** part of this API — it is a separate internal
  service and is not covered by this wiki.
- The peer relay is disabled by default; voice is enabled by default.
