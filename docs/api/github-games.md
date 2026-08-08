# GitHub Games

Publish a game from a GitHub repository onto [StarHermit](https://starhermit.com), or register an already-hosted web game. For repository games, the platform reads `starhermit.txt`, clones the repo, and serves it at `<slug>.starhermit.com`. Because `/api` and `/ws` are proxied same-origin from that subdomain, a platform-hosted game needs **no CORS or API-base configuration**. A pinned commit controls which repository version is live. The [chess reference implementation](../tutorials/chess-walkthrough.md) is published this way and serves as the reference example of the model.

Base URL: `https://api.starhermit.com`. All routes are under `api/v1/...` and require a JWT unless noted.

## The manifest: `starhermit.txt`

Place `starhermit.txt` at the repo root. Format: `key=value` lines, `#` starts a comment.

```text
name=Your Game
# (There is no slug key: the platform assigns your game a uid and uses it as the
# slug — the same value as its <uid>.starhermit.com address. Nothing can choose
# it, so two games can never contend for a name. Your client reads its own slug
# from the launch token's game_scope claim.)
launch=index.html        # repo-relative HTML entry
owner=<starhermit user id>  # UUID from GET /api/v1/me; do not use username/nickname
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
| POST | `/api/v1/me/github-games/upload` | JWT | **Add a game from a local folder** — no repository at all → `201 { game, bytesReceived }` |
| POST | `/api/v1/me/github-games/{id}/claim` | JWT | Take ownership after proving repository control by GitHub link or manifest owner → `GitHubGameDto` |
| GET | `/api/v1/me/github-games` | JWT | List your registered GitHub games → `GitHubGameDto[]` |
| GET | `/api/v1/me/github-games/{id}/stats` | JWT (owner) | **Audience figures for a game you added** → `GameStatsDto` |
| POST | `/api/v1/me/github-games/{id}/transfer` | JWT | Transfer a game to another user → `GitHubGameDto` |
| DELETE | `/api/v1/me/github-games/{id}` | JWT | Remove a registered game → `204` |
| POST | `/api/v1/me/github-games/{id}/bundle` | JWT | Publish a raw `.tar.gz` containing client files and/or a saved container image |
| WS | `/ws/v1/game-upload` | JWT (`?access_token=`) | **The same two uploads over a WebSocket** — the transport to use for anything over ~100 MB |
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
- An optional `server=` script or `container.image=` backend provisions an authoritative game (`gameSlug`); see [game-scripts.md](game-scripts.md) and [container-games.md](container-games.md). Container hosting is open to any signed-in user on starhermit.com; a self-hosted deployment can restrict it to an operator allowlist.
- Limits: 100 games per user. Registering a duplicate returns `409`.

Registration/deployment statuses include: `InvalidUrl`, `LimitReached`, `Duplicate`, `MissingManualMetadata`, `MissingStarhermitTxt`, `InvalidLaunchPath`, `InvalidServerScriptPath`, `InvalidContainerImage`, `ServerProvisionConflict`, `RemovedByOwner`.

Errors use the standard shape:

```json
{ "error": "..." }
```

### Add a game from a local folder

`POST /api/v1/me/github-games/upload` → `201`

The counterpart to registering a URL: **there is no repository**, and nothing is cloned. The folder
travels as one `.tar.gz` on the request body and the platform hosts what it contains. Same archive
format as [pushing a bundle](#push-a-game-bundle), so the same packaging works for both.

```text
client/           the game's files, published as-is
starhermit.txt    name= and launch= instead of the query parameters
```

The manifest is optional to *this endpoint* — the query parameters can supply the same values — and
the StarHermit clients always send one, built from their manifest fields. Shipping the file inside
your build is still worth doing: it makes the build self-describing and prefills those fields, so it
can be re-uploaded without remembering which values it needed. See
[The `starhermit.txt` manifest](../starhermit-txt.md) for the format, and note that **everything
adjacent to the manifest is uploaded** — upload a distributable build, not a source tree.

Send the bytes directly — not multipart form data — with `Content-Type: application/gzip`:

```bash
tar -czf game.tar.gz client/ starhermit.txt

curl -X POST "https://api.starhermit.com/api/v1/me/github-games/upload?displayName=My%20Game" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/gzip" \
  --data-binary @game.tar.gz
```

```json
{
  "game": { "id": "...", "displayName": "My Game", "launchPath": "index.html", "hosting": { "hostingEnabled": true } },
  "bytesReceived": 4194304
}
```

Metadata resolves in this order, so most folders need no query parameters at all:

1. `?displayName=` / `?launchPath=` on the request.
2. `name=` / `launch=` in a `starhermit.txt` at the archive root.
3. `index.html` at the root of `client/` — used as the launch path when nothing else names one.

Notes specific to this route:

- **The game is live as soon as the call returns.** There is no separate hosting or deployment
  step: `deployStatus` is `live` and `deployedCommitSha` is `null`, because there is no commit.
- **The files cannot be regenerated**, so the platform never redeploys them from anywhere. A game
  added this way carries `contentSource: upload`, which is what stops the deployment worker from
  replacing an uploaded build with the contents of a repository. Push a new build with
  [the bundle endpoint](#push-a-game-bundle) or upload the folder again.
- **No repository means no claiming.** `ownerLogin` is empty, so no GitHub login can ever match it;
  `repoUrl` carries a synthetic `upload:<id>` value rather than a URL.
- **A `server/image.tar` is refused here** (`422`). A server image needs a provisioned game to
  attach to, which does not exist until the game does — create the game first, then push the image
  to `/{id}/bundle`.
- A launch path naming a file the archive does not contain is refused (`422`) while the upload is
  still in staging, rather than becoming a 404 for every player.

Limits are the same as any other push: see [Upload limits](#upload-limits).

#### An uploaded folder can bring its own server backend

If the archive's [`starhermit.txt`](../starhermit-txt.md) declares server logic, the upload
provisions it and the created game comes back with a `gameSlug` — the same thing the repository flow
does, without a repository. Pick one style; declaring both is refused.

| Declaration | What happens |
|---|---|
| `server=path/to/server.js` | A script backend. The file travels **inside the folder you upload**, so its source is read straight out of the archive — there is nothing to fetch. See [game-scripts.md](game-scripts.md). |
| `container.image=name@sha256:…` | A container backend, digest-pinned as always. See [container-games.md](container-games.md). The image itself is pushed afterwards to `/{id}/bundle`. |

Refusals here fail the whole create — no half-made game row survives one:

- `server=` naming a file the archive does not contain.
- `server=` pointing outside the client files (`../`).
- Declaring both `server=` and `container.image=`.
- Asking for a container where containers are disabled, or from an owner not approved for them.

### Audience figures for your game

`GET /api/v1/me/github-games/{id}/stats` → `GameStatsDto`

How many people play a game **you added**. Restricted to the game's owner — anyone else gets `404`,
the same answer as a game that does not exist.

```json
{
  "totalPlayers": 42,
  "playingNow": 3,
  "totalSessions": 130,
  "totalPlaytimeMinutes": 8140,
  "lastPlayedAt": "2026-07-29T08:45:24Z",
  "livenessWindowHours": 4
}
```

- **Aggregate only.** You learn the size of your audience, never who is in it.
- `totalPlayers` counts **distinct people**, not sessions — someone who played six times is one
  player.
- `playingNow` counts distinct players whose session has not ended *and* began inside
  `livenessWindowHours`. The window matters: a client that crashed or lost its network never sends
  the session end, and without it those rows would read as people still playing indefinitely.
- `totalPlaytimeMinutes` counts **completed sessions only**, matching the per-user playtime figures
  in [activity.md](activity.md). A session in flight contributes nothing yet.
- `lastPlayedAt` is `null` for a game nobody has played.

Figures come from the same launch ledger every client writes (see [activity.md](activity.md)), so a
game whose players never report launches will read as zero.

### Claim ownership

`POST /api/v1/me/github-games/{id}/claim` → `GitHubGameDto`

Take over an existing listing when you control its repository. Prove ownership either by linking the
personal GitHub login matching the repository owner, or by committing
`owner=<your StarHermit user ID>` to the repository's `starhermit.txt`. `owner` should be the
immutable UUID returned as `id` by `GET /api/v1/me`, **not** a username or nickname. The manifest
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
Anything else in the archive is ignored.

**Uploading an image is itself the declaration.** If the game has no server backend yet — an
uploaded folder that declared none — pushing `server/image.tar` provisions one from the digest just
loaded and gives the game its `gameSlug`. You do not have to name a digest-pinned image in a
manifest first, which was circular: the definition had to exist before it could receive an image,
and the image was the only thing that could describe it.

**A re-push applies the container knobs its manifest declares, and only those.** Include
`starhermit.txt` in the bundle with a changed `container.port`, `container.health`,
`container.memory` or `container.cpu` and the deployment picks it up on restart; leave a knob out and
it keeps whatever you set last time. Omit the manifest entirely and nothing about the deployment
changes except the image.

The StarHermit clients build this bundle for you, from a folder **or a single `.tar`**:

- **Client files** — the game's distribution folder, or a `.tar` of it. A folder is packed under
  `client/`; a `.tar`'s entries are re-homed there (an archive already under `client/` is left
  alone). ustar only — GNU long-name and PAX archives are refused, because re-homing them means
  rewriting the metadata blocks that name the following entry.
- **Dedicated server** — the server's distribution folder, or the `docker save` `.tar` on its own.
  From a folder only the manifest and `image.tar` are uploaded: the image already contains your
  server's own files, so packing the rest would send gigabytes for the platform to discard.

In both cases the [`starhermit.txt`](../starhermit-txt.md) is editable in the dialog. Whatever the
picked build carries prefills the fields, and whatever they hold is written at the bundle root — so
a build with no manifest is publishable, and one that ships as a `.tar` can still have its manifest
updated.

```bash
docker save my-game-server:release -o image.tar
mkdir -p bundle/server
mv image.tar bundle/server/image.tar
cp starhermit.txt bundle/
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

The endpoint updates an existing registered game; it never creates the game record — for that, see
[adding a game from a local folder](#add-a-game-from-a-local-folder). It *can* now mint the game's
`gameSlug`, but only as a side effect of loading a server image into a game that had no backend. See
the [dedicated-server publishing tutorial](../tutorials/dedicated-server-onboarding.md).

### Upload from CI/CD

Do not keep an interactive OAuth token in a repository secret. Sign in through OAuth once and use
that session to add a separately labelled deployment key with `POST /api/v1/me/public-keys`. The CI
job can then sign `/auth/public-key/challenge`, exchange it at `/auth/public-key/complete`, and use
the returned 15-minute access token on this bundle endpoint.

The deployment key acts as its owning account, so that account must own the target game. It cannot
add another key or revoke itself: changing the key list remains OAuth-only. Use one key per
environment so one workflow can be disabled without stopping the others. Archives over roughly
100 MB must use the WebSocket transport below.

See [Upload builds from CI/CD with an OAuth-enrolled public key](../tutorials/ci-cd-build-upload.md)
for key generation, GitHub secret setup, a complete challenge-signing/uploader script, static and
container bundle layouts, and a GitHub Actions workflow.

### Upload over a WebSocket

`GET /ws/v1/game-upload` (upgrade) — **use this for anything over about 100 MB.**

The CDN in front of the API refuses an HTTP request body over roughly **100 MB** with a `413` of its
own. That refusal never reaches the platform, so it carries no `limitBytes` and appears in no log you
can read — a `413` with no `limitBytes` field is the CDN, not your game's allowance, which is two
orders of magnitude larger. Any realistic `docker save` will hit it.

Frames sent after the WebSocket upgrade are not a request body, so the ceiling does not apply.
**Only the transport differs.** The binary frames concatenate into exactly the bytes the HTTP routes
read, go through the same pipeline, and every refusal, allowance and success body is the one the HTTP
route would have produced — so a client can share one code path across both.

```text
wss://api.starhermit.com/ws/v1/game-upload?gameId=$GAME_ID&access_token=$TOKEN
wss://api.starhermit.com/ws/v1/game-upload?displayName=My%20Game&launchPath=index.html&access_token=$TOKEN
```

Pass `gameId` to push to a game you own (the `/{id}/bundle` route); omit it and pass
`displayName`/`launchPath` to create one from a folder (the `/upload` route). The token goes in the
query string because a browser cannot set an `Authorization` header on a WebSocket handshake; it is
checked once, at the handshake, so an upload that outlives its access token still finishes.

| Direction | Frame | Meaning |
|---|---|---|
| server → | `{"type":"ready","mode":"bundle","limitBytes":N,"heartbeatSeconds":15}` | Allowance settled and free space checked. Start sending. `mode` is `bundle` or `create`. |
| → server | *binary* | Archive bytes, chunked however you like — the server never reassembles messages, so 256 KB–1 MB is a fine default. Concatenated, your frames must be exactly the `.tar.gz`. |
| server → | `{"type":"ack","bytesReceived":N}` | Receipt progress, roughly every 8 MB. Drive your progress bar from this. |
| → server | `{"type":"complete"}` | The archive has been sent in full. |
| → server | `{"type":"abort"}` | Give up. Answered with `status: 499`; nothing is published. |
| server → | `{"type":"progress","phase":"publishing","bytesReceived":N}` | Heartbeat every 15s while the upload lands. Ignore them, but expect them. |
| server → | `{"type":"result","status":200,...}` | Success. The rest of the object is the HTTP response body verbatim (`status` is `201` for a create). |
| server → | `{"type":"error","status":413,"error":"...","limitBytes":N}` | Refusal. `status` and the body are what the HTTP route would have answered. |

**Nothing is published until `{"type":"complete"}` arrives.** This is the one behaviour with no HTTP
equivalent, and it is deliberate: the end-of-archive marker lives *inside* a tar's bytes, so the
platform finishes reading a complete-looking archive without the connection ever ending. A socket
that simply dropped after the last byte would otherwise publish exactly like one that finished —
silently replacing a live game with an abandoned push. Closing the socket without the frame uploads
nothing.

The silent window between your last byte and the `result` is real and can be long — a server image
is re-streamed to the daemon and loaded, then client files are copied into the hosting volume. That
is what the `progress` heartbeats are for; do not treat quiet as failure.

### Upload limits

All upload routes — both HTTP endpoints and the WebSocket — share the same rules.

| Limit | Value |
|---|---|
| Disk allowance per game | **4 GB** (operator-tunable per game) |
| Enforcement | applied **while streaming**, so an oversized push is cut off mid-flight |

Per-push and per-game are deliberately the same number: publishing **replaces** a game's content
rather than adding to it, so the largest push is also the most disk a game can occupy.

| Status | Meaning |
|---|---|
| `413` | Over the allowance. Body carries `{ "error", "limitBytes" }`. A `413` **without** `limitBytes` is the CDN's ~100 MB body cap, not this — [use the upload socket](#upload-over-a-websocket). |
| `422` | Malformed archive, or unusable contents (missing launch file, no `client/`, a `server/image.tar` on the create route). Also a **truncated** archive — the ordinary result of a dropped connection mid-upload. |
| `507` | The server does not have room right now. Checked **before the body is read**, on both the staging and hosting volumes, so a doomed upload is refused rather than half-landed. |

Archives may not escape their root or contain links, and only regular files and directories are
extracted — symlinks, hardlinks and device nodes are rejected.

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
- For a game added from a local folder, `repoUrl` is a synthetic `upload:<id>` marker and `ownerLogin`/`repoName` are empty — there is no repository to name, and an empty owner is what makes the listing unclaimable.
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

```json
// GameStatsDto  (GET /api/v1/me/github-games/{id}/stats — owner only)
{
  "totalPlayers": 42,
  "playingNow": 3,
  "totalSessions": 130,
  "totalPlaytimeMinutes": 8140,
  "lastPlayedAt": "2026-07-29T08:45:24Z",
  "livenessWindowHours": 4
}
```

## Publish your own game: walkthrough

There are two routes in. If your game lives in a git repository, follow the numbered steps below.
If it is just a folder on your machine, one call does all of it:
[add a game from a local folder](#add-a-game-from-a-local-folder) registers the game, publishes the
files, and leaves it live — no hosting toggle and no commit pin, because there is no repository to
track.

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
