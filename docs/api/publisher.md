# Publisher

The publisher surface: manage publisher organizations and members, create and upload software titles and builds, and manage achievements, entitlements, and leaderboard definitions for your titles.

Base URL: `https://api.starhermit.com`. All routes require a JWT plus the listed permission claims. Roles: `PublisherMember`, `PublisherOwner`. Permission claims are assigned via roles; minted tokens carry the permission claims.

## Publishers and members

Route prefix: `api/v1/publisher`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/publisher` | JWT (`Permission-publisher.content.manage`) | Create a publisher; creator becomes a member with role `"Owner"` → `201` |
| GET | `/api/v1/publisher` | JWT (`Permission-publisher.content.manage`) | List publishers → `Publisher[]` |
| POST | `/api/v1/publisher/{publisherId}/members` | JWT (`Permission-publisher.members.manage`) + **role `Owner`** | Add a member → `204` |
| DELETE | `/api/v1/publisher/{publisherId}/members/{memberUserId}` | JWT (`Permission-publisher.members.manage`) + **role `Owner`** | Remove a member → `204` (owner cannot be removed) |
| GET | `/api/v1/publisher/{publisherId}/members/{memberUserId}` | JWT (`Permission-publisher.members.manage`) + **membership of that publisher** | Get a member → `PublisherMember` |

### Who may change membership

The permission claim says you may manage publisher members somewhere; it does not say *which*
publisher. Both checks therefore apply:

- **Adding and removing members is `Owner`-only.** Membership carries content-manage authority over
  every one of the publisher's titles, so a plain member who could add members could grant that
  authority to anyone. A non-owner gets `401`.
- **Reading a membership requires belonging to that publisher.** A caller outside it gets the same
  `404` as a user who is not a member, so the endpoint reveals nothing about publishers you are not
  part of.

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
| POST | `/api/v1/publisher/software/upload` | JWT (`Permission-publisher.content.manage` **+** `Permission-publisher.binary.publish`) | Get upload URLs for a title → `UploadUrlInfo[]` |
| POST | `/api/v1/publisher/software/build/finalize` | JWT (`Permission-publisher.content.manage` **+** `Permission-publisher.binary.publish`) | Finalize a build from uploaded assets → `204` |
| GET | `/api/v1/publisher/analytics/downloads?publisherId=` | JWT (`Permission-publisher.content.manage`) | Download counts per title |
| GET | `/api/v1/publisher/analytics/launches?publisherId=` | JWT (`Permission-publisher.content.manage`) | Launch counts per title |

### Publishing a build needs the binary-publish grant

The two build endpoints require **`publisher.binary.publish`** on top of
`publisher.content.manage` and membership of the title's publisher. Without it both answer `403`,
while every other endpoint on this page keeps working — you can create and edit titles, define
achievements and leaderboards, and grant entitlements; you just cannot ship an executable.

The reason is what a build is. A build's assets are downloaded by the desktop client and run on the
player's machine with the player's privileges, outside any sandbox Starhermit controls — unlike a
browser game, which runs in the browser's. So the right to publish one is granted per account by a
Starhermit administrator (the `BinaryPublisher` role), not acquired by creating a publisher. No
other role carries it. **Ask an administrator for the grant before building an upload flow against
these endpoints**; it is also removed when a publisher account is suspended.

Browser games need none of this: `/api/v1/me/github-games` submissions, folder uploads and bundle
pushes stay self-serve for any signed-in account.

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

Downloads filter assets by processing and scan status. In the current backend, catalog storage
URLs are generated by a mock storage adapter, checksum processing hashes the URL rather than the
file bytes, and the scan worker marks pending assets clean without scanning. These are integration
placeholders, so the catalog build workflow requires a real storage/verification/scanning integration
before it can deliver production binaries. Hosted game bundle uploads use a separate pipeline; see
[GitHub Games](github-games.md).

### Analytics

Both endpoints return a JSON object mapping title id to count:

```json
{ "<titleId>": 42 }
```

## Achievements

Route `api/v1/publisher`; all achievement-management routes require `Permission-publisher.content.manage`.

These endpoints manage **catalog-title** achievements only. They also require the caller to be a
member of the publisher that owns the title, and they **fail closed for achievements that belong to
an authoritative game** — those are declared by the game's script or container backend and are not
publisher-managed (see [Achievements](achievements.md), [Game Scripts](game-scripts.md#achievements),
and [Container Game Servers](container-games.md#control-channel)).

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

Route `api/v1/publisher/entitlements`; both routes require `Permission-publisher.content.manage`.

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

Route `api/v1/publisher/leaderboards`; all routes require `Permission-publisher.content.manage`.

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

0. **Hold the binary-publish grant**: steps 3 and 5 require `publisher.binary.publish`, which a
   Starhermit administrator grants per account. See
   [Publishing a build needs the binary-publish grant](#publishing-a-build-needs-the-binary-publish-grant).
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
