# External Libraries

Linking a user's Steam, Epic, or GOG library so their external games can be listed, launched, and tracked. All routes require a JWT.

Base URL: `http://localhost:5000` (some local setups use port `5050`). All routes are under `/api/v1/...`.

## Linking and unlinking

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/me/external-libraries` | JWT | List my linked providers |
| POST | `/api/v1/me/external-libraries/link` | JWT | Link a provider and sync its titles |
| DELETE | `/api/v1/me/external-libraries/{provider}` | JWT | Remove a link and its ownerships |

Linked libraries:

```json
[
  {
    "provider": "steam",
    "externalUserId": "…",
    "createdAt": "…"
  }
]
```

Link body:

```json
{
  "provider": "steam",
  "externalUserId": "…",
  "accessToken": "…",
  "refreshToken": "…"
}
```

Returns 204. Linking also syncs the provider's titles. Library sync currently returns demo titles for `steam`/`epic`/`gog` while the real provider integrations are finalized.

## Owned external software and launching

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/me/external-software?provider=&page=&pageSize=` | JWT | Paged list of my external titles |
| POST | `/api/v1/external-software/{ownershipId}/launch` | JWT | Get a launch URI and record an external launch |

External software list:

```json
{
  "items": [
    {
      "id": "…",
      "provider": "steam",
      "externalSoftwareId": "…",
      "name": "…",
      "softwareTitleId": "…"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

Launch response:

```json
{
  "launchUri": "steam://run/…"
}
```

Launch URI formats by provider: `steam://run/{id}`, `com.epicgames.launcher://apps/{id}?action=launch`, `goggalaxy://openGameView/{id}`. Launching records an external launch activity — see [activity.md](activity.md). External games use the uniform game key `"provider:externalId"` for ratings and feeds — see [catalog.md](catalog.md).

Errors are `{"error": "..."}` with standard status codes.
