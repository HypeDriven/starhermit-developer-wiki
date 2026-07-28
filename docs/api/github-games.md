# GitHub Games

Publish a game from a GitHub repository onto [StarHermit](https://starhermit.com), or register an already-hosted web game. For repository games, the platform reads `starhermit.txt`, clones the repo, and serves it at `<slug>.starhermit.com`. Because `/api` and `/ws` are proxied same-origin from that subdomain, a platform-hosted game needs **no CORS or API-base configuration**. A pinned commit controls which repository version is live. The [chess reference implementation](../tutorials/chess-walkthrough.md) is published this way and serves as the reference example of the model.

Base URL: `https://api.starhermit.com`. All routes are under `api/v1/...` and require a JWT unless noted.

## The manifest: `starhermit.txt`

Place `starhermit.txt` at the repo root. Format: `key=value` lines, `#` starts a comment.

```text
name=Your Game
slug=yourgame            # URL-safe id; endpoints live under /api/v1/games/<slug>/…
launch=index.html        # repo-relative HTML entry
owner=<starhermit username or user id>
# Choose at most one authoritative backend, or omit both for a browser-only game:
server=server.js         # sandboxed JavaScript; see game-scripts.md
# container.image=ghcr.io/owner/game@sha256:<64 lowercase hex>; see container-games.md

control.up=KeyW+ArrowUp | Move forward
control.shoot=Space | Shoot
```

- `slug` determines the subdomain (`<slug>.starhermit.com`) and the game API namespace (`/api/v1/games/<slug>/…`).
- `server` declares a sandboxed JavaScript backend; see [game-scripts.md](game-scripts.md).
- `container.image` declares a container backend; see [container-games.md](container-games.md). It must be digest-pinned, hosted in the verified GitHub owner's namespace on an allowlisted registry, and may be accompanied by `container.port`, `container.health`, `container.memory_mb`, `container.cpu`, and non-secret `container.env.*` values.
- Both backend keys are optional for a pure browser game, but they are mutually exclusive with each other.

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
| POST | `/api/v1/me/github-games/{id}/claim` | JWT | Take ownership after proving repository control by GitHub link or manifest owner → `GitHubGameDto` |
| GET | `/api/v1/me/github-games` | JWT | List your registered GitHub games → `GitHubGameDto[]` |
| POST | `/api/v1/me/github-games/{id}/transfer` | JWT | Transfer a game to another user → `GitHubGameDto` |
| DELETE | `/api/v1/me/github-games/{id}` | JWT | Remove a registered game → `204` |
| POST | `/api/v1/me/github-games/{id}/bundle` | JWT | Publish a raw `.tar.gz` containing client files and/or a saved container image |
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
- An optional `server=` script or `container.image=` backend provisions an authoritative game (`gameSlug`); see [game-scripts.md](game-scripts.md) and [container-games.md](container-games.md). Container hosting may be restricted to approved developers.
- Limits: 100 games per user. Registering a duplicate returns `409`.

Registration/deployment statuses include: `InvalidUrl`, `LimitReached`, `Duplicate`, `MissingManualMetadata`, `MissingStarhermitTxt`, `InvalidLaunchPath`, `InvalidServerScriptPath`, `InvalidContainerImage`, `ServerProvisionConflict`, `RemovedByOwner`.

Errors use the standard shape:

```json
{ "error": "..." }
```

### Claim ownership

`POST /api/v1/me/github-games/{id}/claim` → `GitHubGameDto`

Take over an existing listing when you control its repository. Prove ownership either by linking the
personal GitHub login matching the repository owner, or by committing
`owner=<your StarHermit user ID or username>` to the repository's `starhermit.txt`. The manifest
method supports organization-owned repositories, which are not inferred from personal GitHub org
membership.

On success, the existing listing keeps its ID/history, becomes managed by the claimant, refreshes
repository-controlled metadata and backend declarations, and queues hosting where available. The
previous submitter loses owner-scoped management access. Claiming a listing you already manage
re-synchronizes it rather than returning a conflict.

GitHub identity metadata stores `{"login":"…"}`; link your GitHub account via the OAuth flow (see
[auth.md](auth.md)). Check link status with `GET /api/v1/me/github` → `{ linked, login }`. See the
[step-by-step claiming tutorial](../tutorials/claim-existing-game.md) for discovery, both proof
methods, validation, takeover, and troubleshooting.

### Transfer ownership

`POST /api/v1/me/github-games/{id}/transfer`

```json
{ "toUserId": "<user id>" }
```

### Push a game bundle

`POST /api/v1/me/github-games/{id}/bundle` publishes built output without asking StarHermit to
clone it again. The caller must own the registered game. Send the `.tar.gz` bytes directly—not
multipart form data—with `Content-Type: application/gzip`:

```text
client/            optional static client files; must include the registered launch file
server/image.tar   optional output from `docker save`
starhermit.txt     optional manifest copy for bundle portability
```

At least `client/` or `server/image.tar` must be present. Client files are swapped atomically. A
server image is loaded, digest-pinned by the platform, and queues the container deployment to
restart on that image. An uploaded image takes precedence over the manifest's registry reference.

```bash
docker save my-game-server:release -o image.tar
mkdir -p bundle/server
mv image.tar bundle/server/image.tar
tar -C bundle -czf game-bundle.tar.gz .

curl -X POST "https://api.starhermit.com/api/v1/me/github-games/$GAME_ID/bundle" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/gzip" \
  --data-binary @game-bundle.tar.gz
```

```json
{
  "clientPublished": false,
  "serverImageLoaded": true,
  "imageDigest": "sha256:...",
  "bytesReceived": 318767104
}
```

The upload limit defaults to 2 GiB and may be changed per game. An oversized stream returns `413`
with `{ "error", "limitBytes" }`; malformed or unusable archives return `422`. Archives may not
escape their root or contain links. The endpoint updates an existing registered game; it does not
create the game record or slug. See the [dedicated-server publishing tutorial](../tutorials/dedicated-server-onboarding.md).

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

- `serverScriptPath` is present only for a JavaScript backend. `gameSlug` may be present for either a script or container backend. The current DTO does not expose a container image reference.
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

1. **Choose a source**: push a repo containing `starhermit.txt` at the root (optionally declaring either a `server.js` script or container image), or prepare the public URL of an already-hosted browser game.
2. **Link your GitHub identity** via the OAuth flow (see [auth.md](auth.md)); verify with `GET /api/v1/me/github`.
3. **Register the game**: `POST /api/v1/me/github-games` with the repository or hosted-game URL in `repoUrl`.
4. **Repository games only — enable hosting**: `PUT /api/v1/me/github-games/{id}/hosting` with `{ "enabled": true }`.
5. **Repository games only — pin a commit**: `PUT /api/v1/me/github-games/{id}/deployment` with `{ "commit": "<sha>" }`. The pinned commit controls the live version.
6. **Players launch the game**: a deployed repository game is served at `<slug>.starhermit.com`; a direct hosted game opens its submitted URL. Games with either authoritative backend receive a launch token from `POST /api/v1/games/<slug>/launch-token` in the URL fragment (optionally with `&session_id=<guid>` for invite deep-links).

For the full client-side contract — how the game reads the launch token and talks to the API — see the [chess walkthrough](../tutorials/chess-walkthrough.md) of the reference implementation.

## See also

- [games.md](games.md) — game endpoints, launch tokens
- [game-scripts.md](game-scripts.md) — sandboxed JavaScript game servers
- [container-games.md](container-games.md) — container-hosted game servers
- [auth.md](auth.md) — JWT and OAuth identity linking
- [tutorials/chess-walkthrough.md](../tutorials/chess-walkthrough.md) — end-to-end reference implementation
- [tutorials/claim-existing-game.md](../tutorials/claim-existing-game.md) — take over an existing listing you own
