# API conventions

REST uses `https://api.starhermit.com/api/v1/...`; sockets use `wss://api.starhermit.com/ws/v1/...`.
Hosted games can call `/api/v1/...` and `/ws/v1/...` on their own origin. Native clients use the
public API origin. A development page on another origin needs an allowed CORS origin on the game
host; setting an SDK base URL alone does not authorize that origin.

## Requests and responses

Send JSON with `Content-Type: application/json`, except raw gzip bundle uploads. JSON member names
are camelCase. Send bearer credentials in the REST `Authorization` header.

| Response | How to read it |
|---|---|
| `200` / `201` JSON | Parse the documented object or array; tolerate additional fields |
| `204` | Success with no body; do not call `response.json()` |
| `302` | Browser sign-in/confirmation redirect; navigate rather than fetch OAuth pages |
| `304` | Conditional read unchanged; retain the data you already hold |
| Image, attachment, cloud save | Read bytes, using the response content type and endpoint contract |
| Error | Read status first, then parse the body defensively |

The common error form is `{ "error": "...", "code": "..." }`, with optional fields depending on
the endpoint. `error` is often human-readable; `code` is a stable discriminator where provided.
Terms and some other endpoints put a discriminator directly in `error`. Some endpoints return plain
text, an empty body, or a validation Problem Details object with `title`, `status` and `errors`.
Clients must not assume every unsuccessful response is JSON or has the same fields.

```js
export async function readResponse(response) {
  if (response.status === 204 || response.status === 304) return null;
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text || null; }
  if (!response.ok) {
    const message = (body && typeof body === 'object' && (body.error || body.message || body.title))
      || (typeof body === 'string' && body) || response.statusText;
    throw Object.assign(new Error(message), {
      status: response.status, code: body?.code, body,
      retryAfter: response.headers.get('Retry-After'),
    });
  }
  return body;
}
```

## Time, sizes, and nulls

- `createdAt`, `updatedAt`, `finishedAt`, and similar account/resource timestamps are ISO 8601 strings
  with an offset. Treat absent or `null` optional values as unavailable.
- `ctx.now`, `summary.deadline`, session-list `deadline`, and `/time.serverTime` are integer Unix
  **milliseconds**. Convert with `new Date(value)`, not `Date.parse(value)`.
- Limit values in bytes are bytes, not Base64 characters. A Base64 JSON upload is larger than its
  decoded contents. Use the effective limit reported by an endpoint when available.
- Omission, `null`, and an empty object are not universally equivalent. Settings `PATCH` removes a
  named key with `null`; single-key settings `PUT` stores `null` as a value. Collection `PUT` replaces
  the whole map. Read each endpoint's update rules.
- A settings patch merges **top-level keys**. A supplied object value replaces that key's value;
  it does not recursively merge nested properties.

## Pagination

Paging is one-based where `page`/`pageSize` are supported. Different APIs deliberately have different
response envelopes; do not reuse a parser that assumes a single count-field name.

| Area | Collection shape | Default / maximum page size |
|---|---|---|
| Software titles and builds | `{ items, totalCount, page, pageSize }` | 20 / 100 |
| Chat messages | `{ conversationId, items, totalCount, page, pageSize }` | 50 / 100 |
| Leaderboard entries | `{ items, total, page, pageSize }` | 20 / 100 |
| External software | `{ items, total, page, pageSize }` | 20; request a small positive page size |
| Reports, container crash records, moderation lists | `{ items, total, page, pageSize }` | 20 / 100 |
| Sessions, friends, game listings, achievements | Arrays | Endpoint-specific caps; no generic next-page cursor |
| Moderation withdrawal feed | Cursor-based | Keep returned cursor; recover from `410` as documented |

Response paging metadata reflects the served page where available. [Reference pages](../../README.md#api-reference)
and [machine-readable contracts](contracts.md) describe endpoint-specific query parameters.

## Retry and concurrency

| Situation | Action |
|---|---|
| Account access token rejected with `401` | Refresh once, using one shared refresh request; then sign in if refused |
| Launch token expired | Obtain a new token through sign-in/launcher; expired tokens cannot renew themselves |
| `403 terms_acceptance_required` | Display and explicitly accept current terms, then retry |
| Other `403` | Resolve scope, membership, permissions, or account status; do not refresh in a loop |
| `409` | Resolve duplicate/state/revision conflict; reread before changing a resource |
| Cloud-save `412` | Load the newer version and let the game merge or adopt it |
| `429` or temporary `503` | Honor `Retry-After`, add jitter, and bound retries |
| Network failure during a write | Outcome may be unknown; inspect resource state before repeating the action |

`Retry-After` can be seconds or an HTTP date. Do not invent an idempotency header: the API does not
promise a general idempotency-key mechanism. A retry of session creation or an invitation can create
another resource or conflict with the first. Prefer reads and explicitly idempotent operations for
automatic retries. Refresh rotation, complete uploads, terms consent, and terminal game results each
have their own rules.

For compare-and-swap writes use cloud-save ETags, room `expectedRevision`, or moderation revisions
where supported. A successful write is not necessarily a completed container deployment; verify its
status before sending players to a new build. See [troubleshooting](../troubleshooting.md).
