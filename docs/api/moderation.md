# Content moderation

Games check shared text, JSON documents and PNG/JPEG/WebP images before showing them to other
players. Only a current `allow` authorizes sharing. `review`, `block`, unknown, pending, failed,
expired and incompatible-policy results all keep content hidden.

**Moderation checks are currently unavailable on the public deployment.** Read discovery before
enabling sharing. Checks return `503 overloaded` with `Retry-After: 300`; this does not promise
availability after five minutes. Keep content hidden until you receive a current allow decision.
Generation is also [unavailable](../availability.md#reserved-generation-routes).

The contract below describes supported moderation calls and their behavior when available. Only
accessible, screened evidence is returned through the owner review APIs.

## Callers and routes

The player prefix is `/api/v1/games/{slug}/moderation`. JWTs and launch tokens carry the player;
a launch token must match this game. A live container server token must also match the game. Native
clients use the API base URL; browser games can use their game origin's `/api` proxy.

| Method | Suffix | Caller | Result |
|---|---|---|---|
| GET | (root) | Player or server | Availability, effective limits, supported content and current policy |
| POST | `/check` | Player or server | `200` complete batch or `202` pending check |
| GET | `/checks/{checkId}` | Attributed player or creating game server | `200` status; `410` after result retention |
| POST | `/decisions/lookup` | Player or server | `200` known/unknown qualified hashes |
| POST | `/flags` | Player | `201` flag receipt; servers cannot file flags |
| GET | `/removed?since=&pageSize=` | Player or server | Paged withdrawals and next cursor |

Players cannot check as another player. A server normally sends `sessionId` and `participantUserId`;
the participant must be in an active session of this game, and their check rate is charged. For a
persistent world's recheck with nobody online, send `attribution: "game"` and omit both fields.
This consumes a separate server rate and the game budget, records no player and permits polling
only by the game's authorized server identity. Token refresh does not change that logical identity.

## Availability

`GET /api/v1/games/{slug}/moderation` returns:

```json
{
  "checksAvailable": false,
  "contentReportingAvailable": false,
  "disabledReason": "moderation_not_configured",
  "policyVersion": "<current effective version>",
  "supportedKinds": ["text", "image"],
  "supportedContexts": ["chat", "name", "generated-content", "user-content"],
  "limits": { "moderation.check.items": 20, "moderation.decision.allow_ttl_seconds": 3600 },
  "acceptedPreviousPolicyVersion": null,
  "previousPolicyValidUntil": null,
  "deliveredContentGraceSeconds": 0
}
```

`limits` contains the effective moderation registry values, beyond the two illustrated. Player
values include that player's overrides; server discovery reveals game allowances, never another
player's. A zero game item budget also disables checking (`game_budget_disabled`). Use the returned policy-overlap and grace values; the defaults provide neither.

## Check exact content

```http
POST /api/v1/games/{slug}/moderation/check
Authorization: Bearer <launch-token>
Content-Type: application/json
```

```json
{
  "items": [
    { "id": "story", "kind": "text", "context": "user-content", "text": "abc" }
  ]
}
```

Item IDs are unique within a batch and at most 128 characters. Text carries only `text`; images
carry `contentType` and strict standard padded `dataBase64`, without whitespace. Declared image
types must match their headers, and bytes and pixels are bounded. WAV, Ogg Vorbis,
glTF models and fonts are unsupported (`415 unsupported_kind`); audio support is deferred.

The hash is `sha256:` followed by 64 lowercase hex digits of SHA-256 over the exact content bytes:

- For text, JSON-decode the string and encode its Unicode scalar values as UTF-8 without a BOM.
  Preserve whitespace, line endings and Unicode normalization; reject unpaired surrogates.
- A JSON document submitted as text is hashed as its exact document string, without parsing,
  reordering or reserializing it.
- For an image, hash the decoded bytes before resizing, transcoding or metadata changes.

The three ASCII bytes `abc` hash to
`sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
Adding a newline changes the hash. The request envelope, item ID, context, media type and base64
encoding are not hash input. The platform computes submitted hashes; receiving games must also
hash the bytes they actually hold and compare the identifier.

A complete item has `status: "complete"`, `contentHash`, `decision`, categories, revision,
`checkedAt` and `decisionPolicyVersion`. Only an allow carries `validUntil`. The response envelope
has the current effective `policyVersion`. Validation refuses the whole batch if any item is
malformed. An accepted item can fail separately, with `status: "failed"`, a code and no decision.

The synchronous deadline defaults to two seconds. Unfinished items produce `202` with `checkId`,
`pollAfterSeconds`, `expiresAt` and `Retry-After`. Poll the check; pending items have no decision.
The background deadline defaults to 60 seconds, then an unfinished item fails with `timeout` and
its ordinary input is erased. Terminal results remain readable for one hour by default.

Polling a completed item consults the live qualified decision, current policy and retention.
An old check cannot renew a withdrawn approval. Current blocks/reviews are returned as such;
stale, expired or absent decisions yield a failed item with no renewed validity.

## Lookup and withdrawal recovery

```json
{
  "hashes": ["sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  "kind": "text",
  "context": "user-content"
}
```

Send this to `/decisions/lookup`. Image lookups also name `contentType`. Approval is qualified by
game, kind, validated media type and context. Entries are `known` with a decision, revision,
`decisionPolicyVersion` and allow validity, or `unknown` with `not_checked`, `policy_changed` or
`expired`. Human blocks remain effective after policy changes and ordinary decision retention.

Allow validity defaults to one hour and can be lowered by the operator. Revalidate before expiry;
there is no enabled grace period for an outage and no accepted previous baseline version. Changing
a game policy invalidates earlier approvals immediately. A human allow survives a recheck only
for identical findings that still pass the current baseline under the same policy.

Poll `/removed` before distributing a shared pack and regularly during play. Hide matching hashes
and stop distribution on a withdrawal; removals include both upheld flags and reclassification
from allow to review/block. Feed entries include qualifiers, scope, decision, revision, policy,
removal time and a safe reason. Cursors are opaque ordering markers; use the returned cursor rather than deriving one from a time.

An expired cursor returns `410 cursor_expired`. Fetch a fresh cursor without `since`, batch-lookup
all loaded shared hashes, and resume only when validated. Absence from the feed is never approval.
A saved local copy does not authorize redistribution. The feed defaults to 90 days of history;
durable human blocks outlive it.

## Flags and owner review

A player sends `/flags` a `reason` (at most 64 characters), optional bounded `note`, and content,
a target player, or both. Content evidence uses the same item shape as a check. If `contentHash`
is also supplied, the platform recomputes it and requires equality. A bare hash is not evidence;
job/check references are not implemented. A player-target flag requires a `sessionId` whose roster
includes both reporter and target. Filing a flag neither changes a decision nor automatically
blocks anyone.

Content evidence is reserved and stored in quarantine before classification for routing. Delayed,
failed or unavailable screening never opens owner access. A current owner-safe screening permits
listing/detail/download/triage. Staff findings hide the flag and restrict existing flags and reviews
of the same evidence. Without a classifier, content flags return `403 content_reporting_disabled`
without retry advice or retained evidence; player-only flags remain usable.

Owner routes require a full JWT and game ownership, under `/api/v1/me/github-games/{id}/moderation`:

| Method | Suffix | Behavior |
|---|---|---|
| GET / PUT | `/policy` | Read/set rating and stricter category thresholds with `expectedVersion` |
| GET | `/flags` / `/flags/{flagId}` | Paged screened metadata / one accessible flag |
| GET | `/flags/{flagId}/evidence` | Controlled download; `410` after evidence expiry |
| PATCH | `/flags/{flagId}` | `action: "uphold"` or `"dismiss"`, optional note and `expectedRevision` |
| GET | `/reviews` / `/reviews/{reviewId}` | Paged held-review metadata / one accessible review |
| GET | `/reviews/{reviewId}/content` | Controlled download; `410 review_expired` when unavailable |
| PATCH | `/reviews/{reviewId}` | `action: "allow"` or `"block"`, optional note and `expectedRevision` |

Lists take `status`, `page` and `pageSize` (default 20, maximum 100). Only an owner's stricter policy
hold that currently passes the platform baseline may be allowed; baseline holds require platform
review outside the game-owner API. Restricted evidence is never owner-visible.
A stale revision is `409 revision_conflict`. Deciding a review erases its held content; expiry also
prevents downloading or approving it. Dismissing a flag does not undo another block, and no owner
route lifts a human block.

Evidence is an `application/octet-stream` attachment with `nosniff`, sandbox CSP and `no-store`.
Keep notes/reasons as untrusted text in your review UI. Do not render them as markup or use them as
attachment URLs.

## Default limits and errors

Operators can tune game limits; player rates also support per-user overrides. Read discovery for
the actual values in force.

| Limit | Default |
|---|---|
| Items / lookup hashes per request | 20 / 100 |
| Text / image / total content bytes | 64 KiB / 5 MiB / 10 MiB |
| Image pixels | 20 million |
| Player checks / game-attributed server checks per minute | 30 / 30 |
| Caller reads per minute | 60 |
| Checked or screening items per game per day | 10,000 |
| Flags per player per game per day / open flags per game | 20 / 1,000 |
| Flag note bytes | 4 KiB |
| Pending / retained flag evidence per game | 64 MiB / 256 MiB |
| Pending / retained flag evidence across platform | 1 GiB / 4 GiB |
| Concurrent classifier calls across platform | 8 |
| Check delivery / allow validity | 1 hour / 1 hour |
| Ordinary review hold / flag retention | 7 days / 30 days |

Queue/storage exhaustion refuses new evidence rather than evicting active cases. Respect the
accessibility and expiry reported by each evidence/review endpoint.

Errors are `{ error, code, retryAfterSeconds? }`. `400` covers malformed content/qualifiers, `401`
missing authentication, `403` scope/delegation or baseline restrictions, `404` absent/inaccessible
records, `409` hash/revision/policy conflicts, `410` expired content/checks/cursors, `413` byte/item/
pixel limits, and `415` unsupported kinds/types. `429` covers rates/budgets/queues/storage with
`Retry-After`. Classifier outages are `503 moderation_unavailable`; the current unconfigured
placeholder remains `503 overloaded`. No error, retry or payment substitutes for an allow decision.

Shared [API conventions](conventions.md) describe response parsing, timestamps, pagination, and retries.

See [credential compatibility](../credentials.md) and [machine-readable contracts](contracts.md).
