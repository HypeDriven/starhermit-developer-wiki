# Activity

The activity API covers launch sessions, playtime, and the activity feed — for both catalog titles and external (non-catalog) games. All routes require a JWT unless noted.

Base URL: `http://localhost:5000` (some local setups use port `5050`). All routes are under `/api/v1/...`.

## Catalog launch sessions and playtime

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/activity/launches/{id}/end` | JWT | End a catalog launch session (204) |
| GET | `/api/v1/activity/software/{softwareTitleId}/playtime` | JWT | My total playtime for a title |
| GET | `/api/v1/activity/software/{softwareTitleId}/friends-playtime?top=5` | JWT | Friends' playtime for a title |

Launch sessions are started by `POST /api/v1/software/{id}/launch` (see [catalog.md](catalog.md)) and ended here. Playtime response:

```json
{
  "softwareTitleId": "…",
  "totalMinutes": 120,
  "totalSeconds": 7200
}
```

`friends-playtime` returns `FriendPlaytimeDto[]`:

```json
[
  {
    "userId": "…",
    "username": "…",
    "minutes": 60,
    "seconds": 3600
  }
]
```

## External launches and playtime

For non-catalog games (linked external libraries — see [external-libraries.md](external-libraries.md)):

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/activity/external-launches` | JWT | Start a session for a non-catalog game |
| POST | `/api/v1/activity/external-launches/{id}/end` | JWT | End that session (204) |
| GET | `/api/v1/activity/external/playtime?provider=&externalId=` | JWT | My total playtime for an external game |
| GET | `/api/v1/activity/external/friends-playtime?provider=&externalId=&top=5` | JWT | Friends' playtime for an external game |

`POST /api/v1/activity/external-launches` body (`provider` ≤ 64 chars, `externalSoftwareId` ≤ 256 chars, `name` optional):

```json
{
  "provider": "steam",
  "externalSoftwareId": "…",
  "name": "…"
}
```

Response:

```json
{
  "launchId": "…"
}
```

External playtime response:

```json
{
  "provider": "steam",
  "externalId": "…",
  "totalMinutes": 120,
  "totalSeconds": 7200
}
```

## Activity feeds

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/activity/game-feed?key=&limit=20` | JWT | Friends' sessions and rating events for one game key |
| GET | `/api/v1/activity/friends?since=&until=&limit=` | JWT | Friends' activity |
| GET | `/api/v1/activity/public?since=&until=&limit=` | Anonymous | Public activity |
| GET | `/api/v1/me/activity?since=&until=&limit=` | JWT | My own activity |

The game feed returns `GameFeedItemDto[]` for one game key (a catalog guid or `"provider:externalId"`, see [catalog.md](catalog.md)):

```json
[
  {
    "type": "launch",
    "userId": "…",
    "username": "…",
    "timestamp": "…",
    "minutes": 45,
    "stars": 4
  }
]
```

`friends`, `public`, and `me/activity` return `ActivityDto[]`:

```json
[
  {
    "id": "…",
    "userId": "…",
    "username": "…",
    "type": "launch",
    "timestamp": "…",
    "softwareTitleId": "…",
    "titleName": "…",
    "metadata": "…"
  }
]
```

Activity `type` values: `"download"`, `"launch"`, `"external_launch"`. Privacy settings can hide launch/download activity — see [profile.md](profile.md).

Errors are `{"error": "..."}` with standard status codes.
