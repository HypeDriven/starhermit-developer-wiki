# Claim a Game Someone Else Added

If someone has already added your public GitHub game to StarHermit, you do not need to create a
second listing. Claim the existing listing to become its verified owner and manage its metadata,
hosting, deployment, server backend, and future transfers.

Claiming is protected by repository control. Knowing the game ID or repository URL is not enough.
You must prove control in one of two ways:

1. Link the personal GitHub account that owns the repository; or
2. Commit your immutable StarHermit user ID as `owner=` in the repository's `starhermit.txt`.

The second method is especially useful for organization-owned repositories, because the current
GitHub-login check matches personal repository owners and does not infer organization membership.

## What claiming changes

A successful claim:

- keeps the existing game/listing ID and its accumulated history;
- changes the listing's managing StarHermit user to you;
- marks the listing as `isVerifiedOwner: true`;
- refreshes trusted metadata and controls from `starhermit.txt` where applicable;
- provisions or refreshes a declared script/container backend;
- enables platform hosting where available and queues deployment as `pending`;
- removes management access from the person who originally submitted that listing.

Claiming does not give the previous submitter access to your GitHub account, and it does not merge
StarHermit user accounts. It transfers management of that specific listing.

## Before you begin

You need:

- A StarHermit account and full user access token—not a game-scoped launch token.
- Write access to the repository if using the `owner=` proof method.
- The existing StarHermit listing ID.
- For a cloned repository game, a valid `starhermit.txt` at the repository root.

Only `github.com/<owner>/<repo>` repositories and their GitHub Pages sites participate in this claim
flow. An arbitrary hosted URL has no GitHub repository ownership to prove and cannot be claimed this
way.

Examples below use:

```bash
API=https://api.starhermit.com
ACCESS_TOKEN='your-full-user-access-token'
OWNER='your-github-login'
REPO='your-game-repository'
```

Access tokens last 15 minutes. Refresh yours before starting if it is near expiry.

## Step 1: find the existing listing

List shared games:

```bash
curl -sS "$API/api/v1/github-games" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Each item includes the immutable listing `id`, normalized `repoUrl`, `ownerLogin`, `repoName`, the
current submitter, and ownership status:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "repoUrl": "https://github.com/octocat/orbit-league",
  "ownerLogin": "octocat",
  "repoName": "orbit-league",
  "displayName": "Orbit League",
  "isVerifiedOwner": false,
  "submittedByUserId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "submittedByUsername": "someone-else"
}
```

Match on both `ownerLogin` and `repoName`; do not select a game only because its display name is
similar. With `jq`:

```bash
GAME_ID=$(
  curl -sS "$API/api/v1/github-games" \
    -H "Authorization: Bearer $ACCESS_TOKEN" |
  jq -r --arg owner "$OWNER" --arg repo "$REPO" \
    '.[] | select((.ownerLogin | ascii_downcase) == ($owner | ascii_downcase)
               and (.repoName | ascii_downcase) == ($repo | ascii_downcase)) | .id' |
  head -n1
)

printf 'Listing ID: %s\n' "$GAME_ID"
```

Stop if the result is empty. Do not call claim with an ID copied from an unrelated listing.

## Step 2: choose how to prove ownership

### Option A: link the repository owner's GitHub account

Use this when the repository is owned directly by your personal GitHub login.

From StarHermit's account/settings flow, start GitHub OAuth in **link** mode while signed into the
StarHermit account that should manage the game. Linking is different from accidentally creating a
second StarHermit account with GitHub sign-in.

The API flow begins at:

```text
GET /api/v1/auth/oauth/github/authorize?link=true
```

It is browser-driven and uses a short-lived state cookie. Linking requires recent StarHermit
authentication. Complete GitHub authorization in the same browser session that started it.

Verify the result:

```bash
curl -sS "$API/api/v1/me/github" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Expected:

```json
{ "linked": true, "login": "octocat" }
```

The returned login must match the existing listing's `ownerLogin`, case-insensitively. A personal
GitHub login does not prove membership of an organization that owns the repository. For an
organization-owned repository, use Option B.

### Option B: add `owner=` to `starhermit.txt`

This proves control because only someone able to publish repository content can add the value.
Set `owner` to your immutable StarHermit user ID (UUID), **not** your username or nickname.

Get your ID:

```bash
STARHERMIT_USER_ID=$(
  curl -sS "$API/api/v1/me" \
    -H "Authorization: Bearer $ACCESS_TOKEN" |
  jq -r '.id'
)
```

At the repository root, create or update `starhermit.txt`:

```ini
name=Orbit League
# (There is no slug key: the platform assigns your game a uid and uses it as the
# slug — the same value as its <uid>.starhermit.com address. Nothing can choose
# it, so two games can never contend for a name. Your client reads its own slug
# from the launch token's game_scope claim.)
launch=index.html
owner=3fa85f64-5717-4562-b3fc-2c963f66afa6
```

Replace the example owner with `STARHERMIT_USER_ID`. Do not put your username or nickname here;
those can change, while the user ID is the stable ownership identifier.

For an authoritative game, retain exactly one backend declaration:

```ini
# JavaScript runtime:
server=server.js

# OR container runtime, never both:
# container.image=ghcr.io/your-org/orbit-server@sha256:<64-lowercase-hex>
```

Commit and push the manifest to the repository/version StarHermit can read:

```bash
git add starhermit.txt
git commit -m "Declare StarHermit game ownership"
git push
```

Before claiming, open the repository's raw `starhermit.txt` URL in an unauthenticated browser and
confirm the new value is publicly readable. Claiming reads the repository at request time; an
unpushed local change cannot prove anything.

## Step 3: validate the manifest

For a normal cloned repository game, claiming requires:

- `starhermit.txt` at the repository root;
- non-empty `name=`;
- `launch=` pointing to a repository-relative `.html` or `.htm` file;
- a valid optional `server=` path ending in `.js`/`.mjs`, or a valid `container.image=` declaration;
- never both server runtimes at once.

A GitHub Pages listing keeps its hosted URL as the launch target and does not require a manifest
when personal GitHub ownership is proven, although a valid manifest name can still update its
display name.

If the game declares a container, its image must satisfy the registry, owner namespace, and digest
rules in [Container-hosted Game Servers](../api/container-games.md). Container hosting can also be
restricted by the platform operator.

## Step 4: claim the listing

The claim request has no body:

```bash
curl -sS -X POST \
  "$API/api/v1/me/github-games/$GAME_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

A successful `200` returns the updated game:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "repoUrl": "https://github.com/octocat/orbit-league",
  "ownerLogin": "octocat",
  "repoName": "orbit-league",
  "displayName": "Orbit League",
  "launchPath": "index.html",
  "gameSlug": "orbit-league",
  "isVerifiedOwner": true,
  "metadataSource": "starhermit.txt",
  "hosting": {
    "hostingEnabled": true,
    "deployStatus": "pending"
  }
}
```

The ID should be the same one found in Step 1. Do not create a new listing after a successful claim.

Claiming a listing you already manage is intentionally allowed. It re-reads the manifest,
re-provisions the backend, and requeues hosting, so the same call can be used to resynchronize an
owner-managed game after repository changes.

## Step 5: verify takeover and deployment

Confirm the game now appears in your managed list:

```bash
curl -sS "$API/api/v1/me/github-games" \
  -H "Authorization: Bearer $ACCESS_TOKEN" |
jq --arg id "$GAME_ID" '.[] | select(.id == $id)'
```

Check deployment state:

```bash
curl -sS \
  "$API/api/v1/me/github-games/$GAME_ID/deployment" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

A claim commonly queues a deployment, so `pending` immediately after the claim is normal. Poll with
backoff until it reaches the environment's live/success state or exposes `deployError`.

After takeover, management endpoints available to you include:

```text
PUT    /api/v1/me/github-games/{id}/deployment  pin a commit/branch and redeploy
POST   /api/v1/me/github-games/{id}/bundle      upload built client/container output
PUT    /api/v1/me/github-games/{id}/hosting     requeue hosting where supported
POST   /api/v1/me/github-games/{id}/transfer    transfer management deliberately
DELETE /api/v1/me/github-games/{id}             remove the game
```

The original submitter no longer sees this listing under `GET /api/v1/me/github-games` and cannot
use these owner-scoped management endpoints for it.

## Troubleshooting

### `403`: link the repository owner or add `owner=`

The linked GitHub login does not match `ownerLogin`, or the manifest `owner` does not exactly match
your StarHermit user ID.

- Check `GET /api/v1/me/github`.
- Check the exact `ownerLogin` returned by the public listing.
- For organization repositories, use `owner=<your StarHermit user ID>` in the repo.
- Confirm you pushed the manifest and its raw URL is publicly readable.

### `404`: no shared game with that ID

The ID is wrong, or the listing was removed. Repeat Step 1. Removed listings are not claimable.

### `400`: missing or invalid `starhermit.txt`

For a cloned repository, ensure the root manifest has valid `name` and HTML `launch` values. Also
validate optional script/container declarations. The claim does not trust metadata originally
entered by a non-owner; it replaces it with repository-controlled metadata.

### Claim fails around the slug/backend

The manifest slug may already belong to another verified owner, the server script may be invalid,
or container provisioning may be unavailable. Correct the manifest or resolve the conflicting slug,
then call claim again.

### GitHub was linked but the wrong StarHermit account owns the link

Sign into the intended StarHermit account and complete the OAuth **link** flow there. Do not claim
from a temporary second StarHermit account and then rely on account merging; the API transfers game
management, not user identities.

## Security notes

- Never accept a claim link or listing ID as proof of repository ownership.
- Do not put GitHub access tokens, container credentials, or other secrets in `starhermit.txt`.
- Always use the immutable StarHermit user ID in `owner=`; do not use a username or nickname.
- Review the existing listing and repository URL before claiming; display names are not unique.
- If you later transfer the game, the recipient becomes the manager but verified-owner status is
  reset. They must run the claim flow themselves if they control the repository.

## Reference pages

- [GitHub Games API](../api/github-games.md)
- [Authentication and GitHub OAuth](../api/auth.md#oauth)
- [Game Scripts](../api/game-scripts.md)
- [Container-hosted Game Servers](../api/container-games.md)
- [Dedicated Server Publishing](dedicated-server-onboarding.md)
