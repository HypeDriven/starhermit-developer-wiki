# Software Catalog

The software catalog covers browsing and claiming titles, listing builds, downloading, cloud saves, wishlist, and ratings. Reads are anonymous; writes require a JWT.

Base URL: `http://localhost:5000` (some local setups use port `5050`). All routes are under `/api/v1/...`.

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

The URL targets the latest build's first downloadable asset, and is signed and time-limited. The call records a download activity.

## Cloud saves

One slot per game, 10 MB maximum, last write wins. All routes require a JWT.

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
