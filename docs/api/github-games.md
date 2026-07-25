# GitHub Games

Publish a game from a GitHub repository onto [StarHermit](https://starhermit.com), or register an already-hosted web game. For repository games, the platform reads `starhermit.txt`, clones the repo, and serves it at `<slug>.starhermit.com`. Because `/api` and `/ws` are proxied same-origin from that subdomain, a platform-hosted game needs **no CORS or API-base configuration**. A pinned commit controls which repository version is live. The [chess reference implementation](../tutorials/chess-walkthrough.md) is published this way and serves as the reference example of the model.

Base URL: `http://localhost:5000` (some local setups use port `5050`). All routes are under `api/v1/...` and require a JWT unless noted.

## The manifest: `starhermit.txt`

Place `starhermit.txt` at the repo root. Format: `key=value` lines, `#` starts a comment.

```text
name=Your Game
slug=yourgame            # URL-safe id; endpoints live under /api/v1/games/<slug>/…
launch=index.html        # repo-relative HTML entry
owner=<starhermit username or user id>
server=server.js         # optional; omit for a pure browser game; declares the server-side game script (see game-scripts.md)
control.up=KeyW+ArrowUp | Move forward
control.shoot=Space | Shoot
```

- `slug` determines the subdomain (`<slug>.starhermit.com`) and the game API namespace (`/api/v1/games/<slug>/…`).
- `server` is optional. Omit it for a pure browser game. When present, it declares the server-side game script; see [game-scripts.md](game-scripts.md).

### Default control bindings

A game may declare zero or more desktop-browser actions:

```text
control.<action>=<code>[+<code>...][ | <label>]
```

- Actions are lowercase `[a-z0-9_]{1,32}` identifiers and retain manifest order.
- Codes are `KeyboardEvent.code` values; `+` separates alternate keys for one action.
- The optional label is shown in control-remapping UIs and defaults to the action id.
- A manifest may declare up to 32 actions and 4 codes per action. A code cannot be used by
  two actions. Invalid control lines are ignored.
- Games with no `control.*` declarations have no controls API/UI.

Players can override these defaults per game through the
[Games controls API](games.md#per-player-control-bindings).

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/me/github-games` | JWT | Register a game from a repo URL → `201 GitHubGameDto` |
| POST | `/api/v1/me/github-games/{id}/claim` | JWT | Take ownership when your linked GitHub login owns the repo → `GitHubGameDto` |
| GET | `/api/v1/me/github-games` | JWT | List your registered GitHub games → `GitHubGameDto[]` |
| POST | `/api/v1/me/github-games/{id}/transfer` | JWT | Transfer a game to another user → `GitHubGameDto` |
| DELETE | `/api/v1/me/github-games/{id}` | JWT | Remove a registered game → `204` |
| PUT | `/api/v1/me/github-games/{id}/hosting` | JWT | Enable/disable hosting ("Deploy to starhermit") → `GameHostingView` |
| GET | `/api/v1/me/github-games/{id}/deployment` | JWT | Read deployment/hosting state → `GameHostingView` |
| PUT | `/api/v1/me/github-games/{id}/deployment` | JWT | Pin a commit/branch; queues a redeploy → `GameHostingView` |
| GET | `/api/v1/github-games` | JWT | Public browse of shared GitHub games → `SharedGitHubGameDto[]` |
| GET | `/api/v1/github-games/{id}/icon` | Anonymous | Game icon image bytes (favicon or owner avatar); `ResponseCache` 86400 |
| GET | `/api/v1/me/github` | JWT | GitHub identity link status → `{ linked, login }` |

### Register a game

`POST /api/v1/me/github-games`

```json
{
  "repoUrl": "https://github.com/HypeDriven/starhermit-chess",
  "displayName": "StarHermit Chess",
  "launchPath": "index.html"
}
```

Despite its historical name, `repoUrl` accepts three launch sources:

1. A `github.com/<owner>/<repo>` repository. The backend reads its manifest and can deploy it
   to StarHermit hosting.
2. An already-hosted GitHub Pages URL such as `https://owner.github.io/game/`. Repository
   identity is inferred from the URL; the URL itself is launched, with no clone or install.
3. Any other public `http://` or `https://` hosted web-game URL. It is launched directly and
   does not participate in GitHub ownership claiming.

- `displayName` and `launchPath` are optional fallbacks. They are useful for a third-party repo
  without trusted manifest metadata; a direct hosted URL is itself the launch location.
- For verified repository owners the platform validates `starhermit.txt`.
- An optional server script path provisions a scripted game (`gameSlug`); see [game-scripts.md](game-scripts.md).
- Limits: 100 games per user. Registering a duplicate returns `409`.

Registration/deployment statuses include: `InvalidUrl`, `LimitReached`, `Duplicate`, `MissingManualMetadata`, `MissingStarhermitTxt`, `InvalidLaunchPath`, `InvalidServerScriptPath`, `ServerProvisionConflict`, `RemovedByOwner`.

Errors use the standard shape:

```json
{ "error": "..." }
```

### Claim ownership

`POST /api/v1/me/github-games/{id}/claim` → `GitHubGameDto`

Take ownership of a game when your linked GitHub login owns the repository. GitHub identity metadata stores `{"login":"…"}`; link your GitHub account via the OAuth flow (see [auth.md](auth.md)). Check link status with `GET /api/v1/me/github` → `{ linked, login }`.

### Transfer ownership

`POST /api/v1/me/github-games/{id}/transfer`

```json
{ "toUserId": "<user id>" }
```

### Enable hosting

`PUT /api/v1/me/github-games/{id}/hosting` → `GameHostingView` ("Deploy to starhermit")

```json
{ "enabled": true }
```

### Pin a deployment

`PUT /api/v1/me/github-games/{id}/deployment` → `GameHostingView`

```json
{ "commit": "<sha or branch>" }
```

`commit` is optional. Pinning a sha/branch queues a redeploy; poll `GET /api/v1/me/github-games/{id}/deployment` for status.

## DTOs

```json
// GitHubGameDto
{
  "id": "...",
  "repoUrl": "...",
  "ownerLogin": "...",
  "repoName": "...",
  "displayName": "...",
  "launchPath": "index.html",
  "serverScriptPath": "server.js",
  "gameSlug": "yourgame",
  "isVerifiedOwner": true,
  "metadataSource": "...",
  "createdAt": "...",
  "hosting": { "hostingEnabled": true }
}
```

- `serverScriptPath` and `gameSlug` are only present when a server script is declared.
- `SharedGitHubGameDto` extends `GitHubGameDto` with `submittedByUserId` and `submittedByUsername`.

```json
// GameHostingView
{
  "hostingEnabled": true,
  "hostedUrl": "https://yourgame.starhermit.com",
  "deployStatus": "...",
  "pinnedCommitSha": "...",
  "deployedCommitSha": "...",
  "deployError": null,
  "deployedAt": "..."
}
```

`hostedUrl`, `pinnedCommitSha`, `deployedCommitSha`, `deployError`, and `deployedAt` are optional.

## Publish your own game: walkthrough

1. **Choose a source**: push a repo containing `starhermit.txt` at the root (plus an optional `server.js`), or prepare the public URL of an already-hosted browser game.
2. **Link your GitHub identity** via the OAuth flow (see [auth.md](auth.md)); verify with `GET /api/v1/me/github`.
3. **Register the game**: `POST /api/v1/me/github-games` with the repository or hosted-game URL in `repoUrl`.
4. **Repository games only — enable hosting**: `PUT /api/v1/me/github-games/{id}/hosting` with `{ "enabled": true }`.
5. **Repository games only — pin a commit**: `PUT /api/v1/me/github-games/{id}/deployment` with `{ "commit": "<sha>" }`. The pinned commit controls the live version.
6. **Players launch the game**: a deployed repository game is served at `<slug>.starhermit.com`; a direct hosted game opens its submitted URL. Scripted platform games receive a launch token from `POST /api/v1/games/<slug>/launch-token` in the URL fragment (optionally with `&session_id=<guid>` for invite deep-links).

For the full client-side contract — how the game reads the launch token and talks to the API — see the [chess walkthrough](../tutorials/chess-walkthrough.md) of the reference implementation.

## See also

- [games.md](games.md) — game endpoints, launch tokens
- [game-scripts.md](game-scripts.md) — server-side game scripts
- [auth.md](auth.md) — JWT and OAuth identity linking
- [tutorials/chess-walkthrough.md](../tutorials/chess-walkthrough.md) — end-to-end reference implementation
