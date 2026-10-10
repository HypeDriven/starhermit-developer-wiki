# Crash and Bug Reports

Players can report a crash or a bug from inside any game that has a slug — browser-only games
included — using the game's launch token or a full user token. The game's owner reads, triages and
deletes them through `/api/v1/me/github-games/{id}/reports`.

For a container game's own server output and crash records, see
[Container-hosted Game Servers — Your server's output and crash reports](container-games.md#your-servers-output-and-crash-reports).

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/games/{slug}/reports` | Launch token for that game, or JWT | File a crash or bug report |
| GET | `/api/v1/games/{slug}/reports/mine` | Launch token for that game, or JWT | Your 50 newest reports for this game, with their status |
| GET | `/api/v1/me/github-games/{id}/reports` | JWT (owner) | List reports: `?kind=crash\|bug&status=open\|acknowledged\|resolved&page=&pageSize=` (≤100) |
| GET | `/api/v1/me/github-games/{id}/reports/{reportId}` | JWT (owner) | One report, with its attachment list |
| GET | `/api/v1/me/github-games/{id}/reports/{reportId}/attachments/{attachmentId}` | JWT (owner) | An attachment, always as a download |
| PATCH | `/api/v1/me/github-games/{id}/reports/{reportId}` | JWT (owner) | Set `status` |
| DELETE | `/api/v1/me/github-games/{id}/reports/{reportId}` | JWT (owner) | Delete a report → `204` |

## File a report

```http
POST /api/v1/games/{slug}/reports
Authorization: Bearer <launch-token>
Content-Type: application/json
```

```json
{
  "kind": "crash",
  "title": "Crash entering the second level",
  "description": "TypeError: cannot read properties of undefined (reading 'tiles')\n    at loadLevel (game.js:812)",
  "clientVersion": "1.4.2",
  "platform": "web",
  "buildId": "a1b2c3d",
  "sessionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "attachments": [
    { "fileName": "console.log", "contentType": "text/plain", "dataBase64": "…" }
  ]
}
```

- `kind` is `crash` or `bug`; `title` is required (≤200 characters).
- Everything else is optional. `userAgent` defaults to the request's `User-Agent` header.
- Response: `201 { "id", "kind", "status": "open", "createdAt" }`.

| Status | Meaning |
|---|---|
| `400` | Malformed: unknown `kind`, missing `title`, invalid base64, or not JSON |
| `404` | Unknown or removed game |
| `413` | Description, attachment count or attachment bytes over the game's limits |
| `429` | Over the daily report limit for this game; see `Retry-After` |

## Limits

Operators can change each of these for the whole platform and for individual games; the daily limit
can also be set for one player.

| Limit | Default |
|---|---|
| Reports per player per game per day | 20 |
| Description length | 20,000 characters |
| Attachments per report | 4 |
| Attachment bytes per report | 2 MiB |
| Reports kept per game | 2,000 |
| Bytes kept per game | 256 MiB |
| Retention | 90 days |

When a game reaches its storage limit, the oldest reports — resolved ones first — are removed to
make room. A single report bigger than the whole per-game byte limit is refused with `413`.

## Triage reports (game owner)

The list returns `{ "items", "total", "page", "pageSize" }`; each item carries the reporter's name,
`kind`, `status`, `title`, client details and its attachment count. Move a report through
`open` → `acknowledged` → `resolved` with:

```http
PATCH /api/v1/me/github-games/{id}/reports/{reportId}
Content-Type: application/json

{ "status": "resolved" }
```

Attachments are served as downloads (`Content-Disposition: attachment`, `nosniff`, a sandboxing
CSP). Only inert types keep their declared content type — text, JSON, PNG, JPEG, WebP, GIF, zip and
gzip; anything else, markup included, is served as `application/octet-stream`.

## From the JavaScript SDK

```js
StarHermit.reportBug('Score did not save', 'Finished level 3, score shows 0', { clientVersion: '1.4.2' });
StarHermit.captureCrashes({ clientVersion: '1.4.2' });   // opt-in: uncaught errors become crash reports
```

See the [JavaScript SDK](../sdk/javascript.md#crash-and-bug-reports).
