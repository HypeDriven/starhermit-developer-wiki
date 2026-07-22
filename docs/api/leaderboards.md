# Leaderboards

Leaderboard definitions and entries. Reads are anonymous; submitting a score requires a JWT.

Base URL: `http://localhost:5000` (some local setups use port `5050`). All routes are under `/api/v1/...`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/leaderboards` | Anonymous | List definitions (query `scope`, `region`, `titleId`) |
| GET | `/api/v1/leaderboards/{id}` | Anonymous | Get one definition |
| GET | `/api/v1/leaderboards/{id}/entries?scope=&region=&friendsOnly=&page=&pageSize=` | Anonymous | Paged entries; `friendsOnly=true` requires auth |
| POST | `/api/v1/leaderboards/{id}/submit` | JWT | Submit a score |

Definitions are `LeaderboardDefinitionDto[]`:

```json
[
  {
    "id": "…",
    "softwareTitleId": "…",
    "name": "…",
    "scoreType": "…",
    "sortDirection": "…",
    "resetSchedule": "…",
    "minScore": 0,
    "maxScore": 100,
    "scope": "…",
    "region": "…",
    "isActive": true,
    "createdAt": "…",
    "updatedAt": "…"
  }
]
```

Entries response:

```json
{
  "items": [
    {
      "id": "…",
      "userId": "…",
      "username": "…",
      "score": 1500,
      "rank": 1,
      "region": "…",
      "submittedAt": "…"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

Submit body:

```json
{
  "score": 1500
}
```

The score is validated against the definition's `minScore`/`maxScore` and publisher rules; the response is the entry result.

## Scripted games and Elo

Each scripted game has an elo leaderboard; its id comes from `GET /api/v1/games/{slug}` → `leaderboardId` (see [games.md](games.md)). Scores for it are written ONLY by the platform from the game script's `eloUpdates` — direct submit is refused. The chess client reads it with:

```
GET /api/v1/leaderboards/{leaderboardId}/entries?friendsOnly=true&page=1&pageSize=10
```

Game-scoped launch tokens may read their own game's leaderboard. Publisher-side leaderboard CRUD lives in [publisher.md](publisher.md).

Errors are `{"error": "..."}` with standard status codes.
