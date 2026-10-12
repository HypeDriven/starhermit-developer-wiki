# Choose an integration

Start with where your game runs and who validates gameplay. A hosted browser game does not need a
server backend to use sign-in, cloud saves, settings, controls, or realtime rooms.

| Integration | Gameplay authority | Multiplayer | Progress | Scores and achievements |
|---|---|---|---|---|
| Browser-only, standalone single player | Player's browser | None | Keep in memory in the recommended unsigned mode | No platform writes |
| Hosted browser game with account play | Player's browser | Optional host-routed rooms | Cloud saves for signed-in players | Add a script or container to write game-owned boards and achievements |
| Host-routed realtime room | Host player's client | Lobby, invites, join code, quick-join; binary inputs and snapshots | Client cloud saves, or an optional bound server session | A bound backend can write; it must independently validate what it awards |
| Authoritative script | Your game script | Session matchmaking, friend invites, practice, or room-bound matches | Session and per-player state maintained by your script | Server writes Elo, scores, and achievements |
| Authoritative container | Your game server | Same session API; realtime rooms support larger grids | Complete snapshots and per-player state | Server writes Elo, scores, and achievements |
| Catalog title, such as a native executable | Your chosen client/server architecture | Use the same APIs with account or launch tokens | Cloud-save slot selected by the account client | Catalog boards and achievements have separate publisher and client-claim APIs |

## Three common starting points

**A single-player browser game:** follow [the browser quickstart](tutorials/browser-quickstart.md).
Offer **Sign in with StarHermit** for account progress and **Play single player (progress isn't
saved)** for immediate play. Start without a backend; add one when you need validated competitive
results. Settings and cloud saves do not require a `server=` line.

**Casual multiplayer with friends:** use [realtime rooms](api/realtime.md). The host runs the
simulation, guests send inputs, and the host broadcasts snapshots. Your game implements AI and host
migration. The platform provides seats, identity and routing. Trust in the host is part of this model.

**Ranked or persistent multiplayer:** use [a script](api/game-scripts.md) or
[a container](api/container-games.md), with rooms if you need a lobby. Validate gameplay before
awarding anything. Scripts request a tick rate within the supported ceiling (30 Hz by default);
containers run their own simulation loop. Container direct matchmaking currently has an implicit
1v1 queue, but a room can create an N-player container session.

## Hosting and publishing

| Your build | Publish through | Read next |
|---|---|---|
| Distributable folder | Folder upload; subsequent releases use bundle uploads | [Manifest](starhermit-txt.md), [upload API](api/github-games.md#add-a-game-from-a-local-folder) |
| Public GitHub repository | Register the repository, prove ownership, deploy a selected version | [GitHub games](api/github-games.md) |
| Container image | Register/upload a game, then declare a pinned registry image or push `server/image.tar` | [Container protocol](api/container-games.md), [CI uploads](tutorials/ci-cd-build-upload.md) |
| External/native game client | Call the public API directly; use player credentials | [Public-key onboarding](tutorials/public-key-onboarding.md), [Unity SDK](sdk/unity.md) |
| Catalog executable | Publisher title/build workflow; binary publishing requires a grant | [Publisher](api/publisher.md), [current availability](availability.md) |

A hosted game's UUID is its API slug and subdomain. Display names and repository names are not API
identifiers. See [credentials and identifiers](credentials.md) before wiring requests.

## Pick the right state store

| Data | Store | Writer |
|---|---|---|
| Untracked single-player run | In-memory game state | Local game |
| Client-owned signed-in progress | `game:<gameId>` cloud-save slot | Player's game client |
| Volume, graphics, accessibility, preferences | Per-player game settings | Player's game client |
| Keyboard overrides | Controls API, after manifest declarations | Player's game client |
| Validated match/world state and player statistics | Script return or container snapshot/result | Authoritative game backend |

Cloud saves contain one opaque document per slot, not a history of matches. Replays contain the
finished session state your backend chose to retain, not an automatically recorded video or input
stream. See [saving safely](tutorials/cloud-save-sync.md) and [session lifecycle](session-lifecycle.md).
