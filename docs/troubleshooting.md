# Troubleshoot an integration

Start with the HTTP status, endpoint, and credential family. Reproduce the smallest request using
the same game ID and credential, then check the resource's current state. Keep tokens and player
save data out of logs and support reports.

## Sign-in and access

| Symptom | Check | Next action |
|---|---|---|
| `401` on REST | Token expiry and whether it is an account or launch token | Refresh an account session once; renew a still-valid launch token or sign in for a fresh launch |
| `403 terms_acceptance_required` | Current document from `/api/v1/terms` | Display it and accept its hash only on the player's action; account and player launch tokens work |
| `403` scoped to another game | `game_scope` versus the game/room/save requested | Use your own game UUID and the exact `game:<gameId>` cloud-save key |
| `403` on `/me/game-invites` from a game | Launch token cannot read the account-wide inbox | Poll `/games/{slug}/invites` and `/realtime/rooms/invites` |
| `403 oauth_session_required` | The action changes account credentials | Sign in through a live provider; a public-key session may revoke only its own key |
| `403` for a suspended account | Returned message | Stop automatic sign-in/refresh retries; direct the player to account support |
| Direct sign-in returns `400` | `returnUrl` must be HTTPS on exactly the game's hosted origin | Use the hosted game URL; a local development URL is not a permitted return destination |
| Sign-in fails intermittently with `Invalid signature.` | Challenge serialization, especially `+` in a nonce | Use the exact [public-key signing bytes](tutorials/public-key-onboarding.md#3-sign-in-with-the-key) |
| Registration returns `429` | Email/IP registration allowance | Honor `Retry-After`; confirm the email before sending another registration |

## Game setup and storage

| Symptom | Check | Next action |
|---|---|---|
| `/games/{slug}` returns `404`, but settings work | Does the game have a script or container backend? | Browser-only games have settings and launch tokens but no authoritative game-info/session surface |
| Controls return `404` | Valid `control.*` lines in the published manifest | Publish the declaration; writes cannot create undeclared actions |
| Rebinding one key resets others | Controls `PUT` replaces all overrides | Send the complete override map, or use SDK `setControl()` which preserves the effective map |
| Settings vanished after `PUT` | Collection `PUT` replaces the whole map | Use `PATCH` for changed top-level keys; a nested object is replaced as one value |
| New player cloud save returns `404` | No save exists for that slot yet | Start fresh only for this result; other failures must block uploads |
| Save write returns `412` | Another device wrote a new version | Reload, validate, and merge/adopt before another conditional write |
| Save returns `413`, `409`, or `507` | Save size, slot count, or account quota | Inspect the returned `code` and `limit`; reduce size or resolve capacity |
| Deadline is missing from the session list | `summary.deadline` type | Return an integer Unix timestamp in milliseconds, not an ISO string |
| Score/achievement did not appear | Key, active definition, participant, value bounds | Verify definitions and server output; invalid writes are ignored; client reports are not proof |
| Matchmaking returns `404` after a match | The matched session may have ended | Return to the lobby and start a new search instead of reopening the old ticket |

## WebSockets

A browser's failed upgrade commonly appears as close code `1006`, hiding the HTTP response.
Before retrying, make a REST call to the same game/session/room to distinguish authentication,
terms, membership, finished-session, and temporary server-start failures. Check build compatibility
through game info when you supply `?build=`. Obtain a fresh connection ticket for every upgrade.

| Close/result | Meaning | Action |
|---|---|---|
| `1000` | Normal close | Stop unless the player explicitly starts another connection |
| `1001` plus resume error | World could not resume yet | Reconnect with backoff after checking session state |
| `1006` | Network loss or rejected upgrade | Check REST state and current credentials; bound retries |
| `1008` | Policy violation or superseded connection | Stop automatic reconnect; offer a deliberate reconnect after fixing the cause |
| `1009` | Message too large | Reduce frame size before connecting again |
| HTTP `409 build_mismatch` | Client/server build mismatch | Reload a compatible build; do not invent a matching build value |
| HTTP `410 session_not_active` | Finished session | Return to lobby or replay; stop reconnecting |
| `error: "Too many commands; slow down."` | Script durable-command allowance | Pace discrete commands; put continuous inputs inside `data` with `type: "input", realtime: true` |

Request a full game state after reconnect; do not blindly replay moves or other non-idempotent
commands. `resumed` means discard prediction and resynchronize. `abandoned` is terminal.
See [WebSocket contracts](api/contracts.md#websocket-contracts).

## Publishing and container startup

| Symptom | Check | Next action |
|---|---|---|
| Upload `413` with `limitBytes` | Effective upload/hosting allowance | Reduce the bundle or resulting merged tree |
| Large HTTP upload `413` without platform error fields | Request-body limit before the API | Use `ws/v1/game-upload`; send `complete` after all bytes |
| Upload `422` | Archive layout, launch file, path safety, manifest | Fix the named error; the API expects raw `.tar.gz`, not multipart |
| Upload succeeded but server is unavailable | Deployment readiness | Poll deployment; accepted bytes do not mean the container is ready |
| Container room start returns temporary `503` | Server may be waking | Keep the lobby and retry with backoff; do not fall back to a client simulation |
| Container requests fail invoke-key validation | Startup environment and exact header comparison | Read the current injected invoke key; report persistent failure with game ID and sanitized logs |
| Persistent deployment failure | Deployment status and owner-visible logs/crashes | Fix the build or configuration and publish a new working release |

For a useful support report include game ID, client/build version, endpoint and method, status/code,
approximate UTC time, reproduction steps, and relevant sanitized logs. Session/room IDs help locate
the resource. Do not attach credentials, private keys, or a player's full save without their consent.
