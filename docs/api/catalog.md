# Software Catalog

The software catalog covers browsing and claiming titles, listing builds, downloading, cloud saves, wishlist, and ratings. Reads are anonymous; writes require a JWT.

Base URL: `https://api.starhermit.com`. All routes are under `/api/v1/...`.

## Browsing and claiming titles

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/software` | Anonymous | Search and page the catalog |
| GET | `/api/v1/software/{id}` | Anonymous | Get one title, or 404 |
| GET | `/api/v1/software/{id}/builds?page=&pageSize=` | Anonymous | Paged list of builds for a title |
| POST | `/api/v1/software/{id}/claim` | JWT | Self-claim a free title, granting an entitlement |
| POST | `/api/v1/software/{id}/launch` | JWT | Start a launch session (requires entitlement) |

`GET /api/v1/software` accepts query parameters `q` (full-text), `category`, `tag`, `publisherId`, `platform`, `releaseStatus`, `sort`, `page`, and `pageSize`. Valid `sort` values: `name`, `name_desc`, `created`, `created_desc`, `updated`, `updated_desc`. It returns a `PagedResult`:

```json
{
  "items": [
    {
      "id": "…",
      "name": "…",
      "description": "…",
      "publisherId": "…",
      "category": "…",
      "platform": "…",
      "releaseStatus": "…",
      "tags": ["…"],
      "priceCents": 0,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "totalCount": 1,
  "page": 1,
  "pageSize": 20
}
```

`GET /api/v1/software/{id}/builds` returns a `PagedResult` of `SoftwareBuild`:

```json
{
  "items": [
    {
      "id": "…",
      "titleId": "…",
      "version": "…",
      "releaseDate": "…",
      "releaseNotes": "…",
      "metadata": "…",
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "totalCount": 1,
  "page": 1,
  "pageSize": 20
}
```

`POST /api/v1/software/{id}/claim` works only for free titles (`priceCents == 0`); it grants the caller an entitlement and returns 204. For paid titles it returns 402 with:

```json
{"error": "purchasing is not available yet"}
```

`POST /api/v1/software/{id}/launch` requires an entitlement (403 otherwise) and returns a `LaunchSession`:

```json
{
  "launchId": "…",
  "startTime": "…"
}
```

It records a launch activity, which is hidden if the user's privacy settings say so (see [profile.md](profile.md)). End the session with `POST /api/v1/activity/launches/{id}/end` — see [activity.md](activity.md). A user's entitlements are listed via `GET /api/v1/me/entitlements` (see [profile.md](profile.md)).

## Downloads

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/software/{id}/download` | JWT | Get a signed download URL (requires entitlement) |

Requires an entitlement (403 otherwise). Returns:

```json
{
  "downloadUrl": "…"
}
```

The URL targets the latest build's first downloadable asset. The call records a download activity.
The current backend uses a mock file-storage adapter that appends `token=mock-download-token`;
it does not issue a real expiring signature. A deployment needs a real storage integration for
production catalog downloads; see [the publisher pipeline limitation](publisher.md#finalize-a-build).

## Cloud saves

One slot per game, 10 MB maximum, last write wins. All routes require a JWT — a full user token,
or a game's launch token for that game's own slot (below).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/me/cloud-saves/{gameKey}/info` | JWT | Save metadata: `{ exists, sizeBytes, updatedAt? }` |
| GET | `/api/v1/me/cloud-saves/{gameKey}` | JWT | `application/zip` bytes, 404 if none |
| PUT | `/api/v1/me/cloud-saves/{gameKey}` | JWT | Upload a save (zip ≤ 10 MB, `gameKey` ≤ 300 chars) |

PUT body:

```json
{
  "dataBase64": "…"
}
```

PUT response:

```json
{
  "gameKey": "…",
  "sizeBytes": 0,
  "updatedAt": "…"
}
```


### Saving from inside a game (launch token)

A game running with its launch token can read and write the player's save for **that game**.
Your game saves itself wherever it runs — a browser, or the StarHermit desktop app, which runs
hosted games in a browser too — so the save follows the player between them.

The key is `game:<gameId>`, where `<gameId>` is your game's id — the same value as its slug, its
`<gameId>.starhermit.com` address, and the `game_scope` claim of the launch token:

```js
const key = `game:${gameScope}`;            // e.g. "game:3fa85f64-5717-4562-b3fc-2c963f66afa6"

// Load on startup — 404 means no save yet.
const res = await fetch(`/api/v1/me/cloud-saves/${key}`, { headers: { Authorization: `Bearer ${launchToken}` } });
const save = res.status === 404 ? null : new Uint8Array(await res.arrayBuffer());

// Save at checkpoints, not every frame.
await fetch(`/api/v1/me/cloud-saves/${key}`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${launchToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ dataBase64: base64(zipBytes) }),
});
```

- **Only that exact key.** Any other key — another game's, a store game's, or a different spelling
  of yours (upper case, the bare id) — is `403` for a launch token. That includes `github:<gameId>`,
  the separate slot the desktop app uses when a player syncs a local save folder for your game, so
  that sync can never overwrite the save your game writes.
- **Any format.** The platform never opens the save; store whatever your game can read back (it is
  served as `application/zip` regardless). Up to 10 MB.
- **Last write wins** and there is no history: two tabs or devices playing at once overwrite each
  other. Load on start, save at checkpoints and on page hide.
- A game with no hosted listing (an operator-provisioned game) has no slot.

Small, frequently-changing preferences belong in [per-player settings](games.md#per-player-game-settings)
instead; they are also reachable with the launch token and support partial updates.

## Wishlist

All routes require a JWT.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/me/wishlist` | JWT | `{ titleIds: guid[] }` |
| PUT | `/api/v1/me/wishlist/{titleId}` | JWT | Add to wishlist, 204 (idempotent) |
| DELETE | `/api/v1/me/wishlist/{titleId}` | JWT | Remove from wishlist, 204 |

## Ratings

All routes require a JWT. The uniform game key is a catalog guid, or `"provider:externalId"` for external games (see [external-libraries.md](external-libraries.md)).

| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/api/v1/me/ratings` | JWT | Upsert my rating for a game |
| POST | `/api/v1/ratings/query` | JWT | Batch-fetch rating summaries |
| GET | `/api/v1/ratings/reviews?key=&top=` | JWT | Reviews for a game (`top` default 10) |

PUT body:

```json
{
  "gameKey": "…",
  "stars": 4,
  "review": "…"
}
```

`stars` is 0–5; `review` is optional. Response is a `RatingSummaryDto`:

```json
{
  "gameKey": "…",
  "average": 4.5,
  "count": 12,
  "myStars": 4
}
```

`POST /api/v1/ratings/query` body and response:

```json
{
  "keys": ["…", "…"]
}
```

returns `RatingSummaryDto[]`. `GET /api/v1/ratings/reviews` returns `GameReviewDto[]`:

```json
[
  {
    "userId": "…",
    "username": "…",
    "stars": 4,
    "review": "…",
    "timestamp": "…"
  }
]
```

Errors are `{"error": "..."}` with standard status codes. Related: [achievements.md](achievements.md), [leaderboards.md](leaderboards.md).
