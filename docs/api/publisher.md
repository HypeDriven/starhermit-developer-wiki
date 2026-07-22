# Publisher

The publisher surface: manage publisher organizations and members, create and upload software titles and builds, and manage achievements, entitlements, and leaderboard definitions for your titles.

Base URL: `http://localhost:5000` (some local setups use port `5050`). All routes require a JWT plus the listed permission claims. Roles: `PublisherMember`, `PublisherOwner`. Permission claims are assigned via roles; minted tokens carry the permission claims.

## Publishers and members

Route prefix: `api/v1/publisher` (PublisherController).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/publisher` | JWT (`Permission-publisher.content.manage`) | Create a publisher; creator becomes a member with role `"Owner"` → `201` |
| GET | `/api/v1/publisher` | JWT (`Permission-publisher.content.manage`) | List publishers → `Publisher[]` |
| POST | `/api/v1/publisher/{publisherId}/members` | JWT (`Permission-publisher.members.manage`) | Add a member → `204` |
| DELETE | `/api/v1/publisher/{publisherId}/members/{memberUserId}` | JWT (`Permission-publisher.members.manage`) | Remove a member → `204` (owner cannot be removed) |
| GET | `/api/v1/publisher/{publisherId}/members/{memberUserId}` | JWT (`Permission-publisher.members.manage`) | Get a member → `PublisherMember` |

### Create a publisher

`POST /api/v1/publisher`

```json
{
  "name": "HypeDriven",
  "description": "..."
}
```

The creator becomes a member with role `"Owner"`.

### Add a member

`POST /api/v1/publisher/{publisherId}/members`

```json
{ "userId": "<user id>" }
```

### DTOs

```json
// Publisher
{
  "id": "...",
  "name": "...",
  "description": "...",
  "ownerUserId": "...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

```json
// PublisherMember
{
  "id": "...",
  "publisherId": "...",
  "userId": "...",
  "role": "...",
  "joinedAt": "..."
}
```

## Software titles and builds

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/publisher/software` | JWT (`Permission-publisher.content.manage`) | Create/update a software title (body = full `SoftwareTitle`; membership in the title's actual publisher enforced) |
| POST | `/api/v1/publisher/software/upload` | JWT (`Permission-publisher.content.manage`) | Get upload URLs for a title → `UploadUrlInfo[]` |
| POST | `/api/v1/publisher/software/build/finalize` | JWT (`Permission-publisher.content.manage`) | Finalize a build from uploaded assets → `204` |
| GET | `/api/v1/publisher/analytics/downloads?publisherId=` | JWT (`Permission-publisher.content.manage`) | Download counts per title |
| GET | `/api/v1/publisher/analytics/launches?publisherId=` | JWT (`Permission-publisher.content.manage`) | Launch counts per title |

### Get upload URLs

`POST /api/v1/publisher/software/upload`

```json
{ "titleId": "<title id>" }
```

Response — `UploadUrlInfo[]`:

```json
[
  {
    "type": "executable",
    "uploadUrl": "...",
    "fieldKey": "..."
  }
]
```

`type` is one of `"executable"`, `"data"`, `"metadata"`.

### Finalize a build

`POST /api/v1/publisher/software/build/finalize` → `204`

```json
{
  "titleId": "<title id>",
  "buildId": "<optional build id>",
  "version": "1.0.0",
  "releaseNotes": "...",
  "assets": [
    { "type": "executable", "checksum": "...", "fieldKey": "..." }
  ]
}
```

Newly uploaded assets are processed and malware-scanned before release; only approved assets are downloadable.

### Analytics

Both endpoints return a JSON object mapping title id to count:

```json
{ "<titleId>": 42 }
```

## Achievements

PublisherAchievementsController — route `api/v1/publisher`, class-level `Permission-publisher.content.manage`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/publisher/titles/{titleId}/achievements` | JWT | Create an achievement → `AchievementDto` |
| GET | `/api/v1/publisher/titles/{titleId}/achievements` | JWT | List a title's achievements → `AchievementDto[]` |
| GET | `/api/v1/publisher/achievements/{id}` | JWT | Get one achievement → `AchievementDto` |
| PUT | `/api/v1/publisher/achievements/{id}` | JWT | Update (all fields nullable) → `AchievementDto` |
| DELETE | `/api/v1/publisher/achievements/{id}` | JWT | Delete → `204` |

### Create an achievement

`POST /api/v1/publisher/titles/{titleId}/achievements`

```json
{
  "key": "first_win",
  "name": "First Win",
  "description": "Win your first game.",
  "icon": "...",
  "secret": false,
  "points": 10,
  "visibility": "...",
  "criteria": "..."
}
```

`icon`, `visibility`, and `criteria` are optional. On `PUT`, all fields are nullable. See [achievements.md](achievements.md) for the player-facing surface.

## Entitlements

PublisherEntitlementsController — route `api/v1/publisher/entitlements`, class-level `Permission-publisher.content.manage`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/publisher/entitlements/grant` | JWT | Grant a user a title → `204` |
| POST | `/api/v1/publisher/entitlements/revoke` | JWT | Revoke a title from a user → `204` |

Body for both:

```json
{
  "userId": "<user id>",
  "softwareTitleId": "<title id>"
}
```

## Leaderboards

PublisherLeaderboardsController — route `api/v1/publisher/leaderboards`, class-level `Permission-publisher.content.manage`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/publisher/leaderboards/` | JWT | Create a leaderboard definition → `LeaderboardDefinitionDto` |
| GET | `/api/v1/publisher/leaderboards/{id}` | JWT | Get a definition → `LeaderboardDefinitionDto` |
| PUT | `/api/v1/publisher/leaderboards/{id}` | JWT | Update (all fields nullable) → `LeaderboardDefinitionDto` |
| DELETE | `/api/v1/publisher/leaderboards/{id}` | JWT | Delete → `204` |

### Create a leaderboard

`POST /api/v1/publisher/leaderboards/`

```json
{
  "name": "Global Elo",
  "scoreType": "...",
  "sortDirection": "...",
  "resetSchedule": "...",
  "minScore": 0,
  "maxScore": 4000,
  "scope": "...",
  "region": "...",
  "isActive": true,
  "softwareTitleId": "<optional title id>"
}
```

`resetSchedule`, `minScore`, `maxScore`, `region`, and `softwareTitleId` are optional. On `PUT`, all fields are nullable. See [leaderboards.md](leaderboards.md) for the player-facing surface.

## Publish a build: flow

1. **Create a publisher**: `POST /api/v1/publisher` with `{ name, description }`.
2. **Create the title**: `POST /api/v1/publisher/software` with the full `SoftwareTitle` body.
3. **Get upload URLs**: `POST /api/v1/publisher/software/upload` with `{ titleId }`.
4. **Upload files** to the returned `uploadUrl`s.
5. **Finalize the build**: `POST /api/v1/publisher/software/build/finalize` with the uploaded assets' `{ type, checksum, fieldKey }` entries.
6. **Assets are scanned**: the platform processes and malware-scans new assets; only approved assets become downloadable.
7. **Users claim and download** the title through the catalog — see [catalog.md](catalog.md).

Errors across this surface use the standard shape `{ "error": "..." }` with standard status codes.

## See also

- [catalog.md](catalog.md) — how players browse, claim, and download titles
- [achievements.md](achievements.md) — player-facing achievements
- [leaderboards.md](leaderboards.md) — player-facing leaderboards
- [auth.md](auth.md) — JWT, roles, and permission claims
