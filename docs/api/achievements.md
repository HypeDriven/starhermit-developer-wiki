# Achievements

Achievement definitions for catalog-distributed titles, plus per-user unlocks. Definitions are read anonymously; unlocking requires a JWT and an entitlement to the title.

Base URL: `http://localhost:5000` (some local setups use port `5050`). All routes are under `/api/v1/...`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/software/{titleId}/achievements` | Anonymous | Achievement definitions for a title |
| GET | `/api/v1/me/achievements?titleId=` | JWT | My unlocked achievements |
| POST | `/api/v1/me/achievements/unlock` | JWT | Unlock an achievement |

Definitions are returned as `AchievementDto[]`. Secret achievements are hidden unless unlocked by the caller:

```json
[
  {
    "id": "…",
    "key": "…",
    "name": "…",
    "description": "…",
    "icon": "…",
    "secret": false,
    "points": 10,
    "visibility": "…",
    "criteria": "…"
  }
]
```

My unlocks are returned as `UserAchievementDto[]`:

```json
[
  {
    "id": "…",
    "achievementDefinitionId": "…",
    "key": "…",
    "name": "…",
    "description": "…",
    "icon": "…",
    "points": 10,
    "unlockedAt": "…"
  }
]
```

Unlock body:

```json
{
  "achievementDefinitionId": "…"
}
```

Returns 204. Requires an entitlement to the title (see [catalog.md](catalog.md)).

Publisher-side management — defining, updating, and deleting achievement definitions — lives in [publisher.md](publisher.md).

Note: the chess reference game does NOT use achievements; they are for catalog-distributed titles (see [../tutorials/chess-walkthrough.md](../tutorials/chess-walkthrough.md)).

Errors are `{"error": "..."}` with standard status codes.
