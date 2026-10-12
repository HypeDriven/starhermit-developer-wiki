# Load and save progress safely

Use cloud saves for a signed-in player's client-owned progress. The unsigned single-player option
keeps progress in memory and does not read or write account saves. Preferences belong in
[game settings](../api/games.md#per-player-game-settings), not the progress document.

A launch token can access exactly `game:<gameId>`, where `gameId` is its `game_scope`. The platform
stores opaque bytes, with one save per slot. Validate the format your game expects. See
[Cloud saves](../api/catalog.md#cloud-saves) for quotas and conditional headers.

## A small complete JSON recipe

Copy [`cloud-save-store.js`](../sdk/cloud-save-store.js) into your build. This example stores raw
UTF-8 JSON bytes; the platform serves them with `application/zip` but does not require a ZIP format.
Use a different reader for ZIP saves, including the [browser SDK's ZIP saves](../sdk/javascript.md#cloud-saves).
Do not change formats without a migration plan for existing players.

```js
import { CloudSaveStore } from './cloud-save-store.js';

const store = new CloudSaveStore({
  gameId: StarHermit.slug,
  token: () => StarHermit.token, // Always obtain the current renewed token.
});
const valid = value => value?.version === 1 && Number.isSafeInteger(value.points) && value.points >= 0;
let progress = { version: 1, points: 0 };
let saving = false;

async function startAccountGame() {
  // Keep gameplay/saving disabled until this resolves.
  const remote = await store.load(valid);
  progress = remote ?? { version: 1, points: 0 };
  render(progress);
}

async function saveCheckpoint() {
  if (saving) return; // Coalesce checkpoints; do not issue overlapping writes.
  saving = true;
  showSync('Saving…');
  try {
    await store.save(progress);
    showSync('Saved');
  } catch (error) {
    if (error.status === 412) {
      // Keep local progress in memory. Offer Reload cloud or an explicit merge.
      showConflict(() => startAccountGame());
    } else showSync('Save failed; retry after resolving the error');
  } finally {
    saving = false;
  }
}
```

`render`, `showSync`, and `showConflict` are your UI. Await `startAccountGame()` before enabling
play or saving. On load failure, retain the player's current local state, display the failure,
and keep uploads blocked. A `404` is the empty-slot case; `401`, `403`, `5xx`, malformed JSON,
or an unsupported save version are not empty slots.

The recipe does not renew credentials. The browser SDK renews launch tokens while they remain
valid. Resolve pending terms or reauthenticate through the game's entry flow before retrying a read.

## Conditions and conflicts

| What was loaded | Header on the next write | If another device writes |
|---|---|---|
| Existing save with ETag | `If-Match: <etag>` | `412 precondition_failed` |
| No save (`404`) | `If-None-Match: *` | `412 precondition_failed` |
| Nothing loaded successfully | No write | Keep retrying the read or let the player stay in untracked play |

Use the version from the **data you loaded**, not a later metadata check. Retain the new ETag returned
by each successful write. A `412` blocks further saves until the game loads the current version and
the player adopts or merges it. Do not silently remove the condition and overwrite another device.
The API offers no save history to undo that overwrite.

If two devices must independently update counters or inventory, a single last-write-wins document
may not fit the game. Use server-authoritative state and define validated game commands instead.

## Save format and migration

Include a format version and validate types, ranges, and required fields before adopting remote
progress. Write a migration for supported older versions. Keep a newer unknown version intact;
do not reset it to defaults and upload over it. Cloud data is client-controlled, so never treat it
as proof of a competitive score or paid entitlement.

The default decoded-save limit is 10 MiB. Base64 adds roughly one third to the request body.
`413 cloud_save_too_large`, `409 cloud_save_slots_exhausted`, and `507 cloud_save_quota_exceeded`
are different capacity failures; inspect `code` and `limit`. Honor `Retry-After` on `429`.

## Checkpoints and page exit

Save at meaningful checkpoints and offer a visible Save action. Debounce rapid changes and serialize
writes so each one uses the last acknowledged version. Keep a dirty indicator until acknowledged.
A failed request is not a confirmed save; after an ambiguous write, reload before another write.

A page-exit upload is best effort. Browser `fetch(..., { keepalive: true })` shares a small in-flight
body allowance, commonly 64 KiB; a 10 MiB save cannot rely on it. A tab may close before any request
finishes. Use ordinary foreground saves for durability, and do not label unacknowledged progress as
saved. The quickstart saves its small document at every point collection.

## Verify in your game

1. Start with an empty slot; collect progress, save, reload, and confirm it returns.
2. Refuse reads with a network error, `403`, or invalid data; confirm no upload follows.
3. Open two tabs on one version. Save in A, then B: B must surface a conflict and preserve its local state.
4. Test an older/newer format and a missing acknowledgement without overwriting unknown data.
5. Enter untracked single-player mode and verify that play makes no cloud-save requests.

See [the runnable quickstart](browser-quickstart.md), [API conventions](../api/conventions.md), and
[troubleshooting](../troubleshooting.md#game-setup-and-storage).
