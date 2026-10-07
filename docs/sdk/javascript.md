# JavaScript SDK (browser games)

[`starhermit-sdk.js`](starhermit-sdk.js) is a single-file, dependency-free client for browser games
published on StarHermit. It reads the launch token, keeps it renewed, and wraps everything a
game-scoped launch token can reach: identity, cloud saves, per-player settings and controls,
invites, matchmaking, sessions and the gameplay socket, achievements, leaderboards, replays, chat,
voice and realtime rooms.

| | |
|---|---|
| File | [`docs/sdk/starhermit-sdk.js`](starhermit-sdk.js) — copy it into your game unchanged |
| Global | `window.StarHermit` (also `module.exports` under Node, for tests) |
| Dependencies | none — it uses the browser's own `fetch`, `WebSocket` and (to read compressed saves) `DecompressionStream` |
| API baseline | REST v1 and WebSocket v1, launch-token surface only |

The SDK is a client, not a second implementation of the platform. Scores and achievement unlocks
are written only by the game's server (a script result or a container control message) — a client
can never post them, and the SDK only reads them. Everything else stays server-authoritative
exactly as documented on the [API pages](../../README.md#api-reference).

**Every method is safe standalone.** With no launch token (the game opened from a local file, a
dev server or any non-StarHermit host) calls resolve to `null` or `[]` without touching the
network, so a game keeps its local behaviour and makes no requests.

## Install

Copy the file next to your game's other static scripts — wherever your build ships them — and load
it before your own code:

```html
<script src="starhermit-sdk.js"></script>
<script>
  StarHermit.init();          // as early as possible: it reads and strips the token from the URL fragment
</script>
```

Call `init()` once, before any router touches `location.hash`. Options:
`init({ base, gameId, autoRefresh, launcherUrl })` — `base` points REST calls at another origin during
local development (platform-hosted games use same-origin), `gameId` is only needed for sign-in when the
game is not served from `<id>.starhermit.com`, `autoRefresh: false` leaves token renewal to a game that
runs its own chain, and `launcherUrl` overrides where `relaunch()` sends the player (default
`https://dashboard.starhermit.com/`).

## Sign-in and identity

| Need | Call |
|---|---|
| Is a player signed in? | `StarHermit.signedIn`, `StarHermit.userId`, `StarHermit.slug` |
| React to sign-in / sign-out / expiry | `StarHermit.on('auth', ({ signedIn, reason }) => …)` |
| Show a **Sign in** button | only when `StarHermit.canSignIn()` (true on `*.starhermit.com` without a token); on click `StarHermit.signIn()` |
| Player name / avatar | `await StarHermit.profile()` → `{ userId, username, nickname, displayName }`; `StarHermit.avatarUrl()` |
| Friends | `await StarHermit.friends()` |

The SDK handles both launch shapes — `#game_token=<jwt>[&session_id=…]` from the library or an
invite, and `#access_token=<jwt>` returning from direct sign-in — and renews the token through
`POST /api/v1/games/{slug}/launch-token` before it expires (see
[launch tokens](../api/auth.md)). The display name is the profile `nickname`; `/api/v1/me` is not
reachable with a launch token.

## Cloud saves

The game's slot is `game:<slug>` ([catalog: saving from inside a game](../api/catalog.md)); the SDK
builds the path, zips the payload and handles the `/info` check.

```js
const remote = await StarHermit.loadJSON();          // null: empty slot, signed out — or a failed read
if (StarHermit.saveLoadFailed()) showSyncError();    // tell those apart when it matters
else if (remote && isNewer(remote, local)) adopt(remote);

StarHermit.saveJSON(state);                          // debounced (2 s) checkpoint upload
addEventListener('pagehide', () => StarHermit.flushSave(true));   // keepalive flush
StarHermit.on('saved', ok => setSyncIndicator(ok));
```

**Load before you save.** Compare and adopt the cloud copy before any write that could reach
`saveJSON` — including settings, nickname or checkpoint writes at boot — or a stale local copy can
overwrite a newer save made on another device. Hold early saves until the start-up load settles.

The SDK protects the other half of that race: when a read fails (network or server error, as
opposed to an empty slot) it sets `saveLoadFailed()`, emits `saveerror`, and refuses writes until
`/info` confirms the slot is empty or a later `loadSave()` succeeds. A refused write resolves
`false` and emits `saved` with `false`.

Lower level: `loadSave()` / `writeSave(text)` for raw strings, `saveInfo()` for
`{ exists, sizeBytes, updatedAt }`.

## Settings and controls

| Need | Call |
|---|---|
| Per-player preferences (volume, graphics preset, language, accessibility…) | `getSettings()`, `getSetting(key)`, `setSetting(key, value)`, `patchSettings({…})` (a `null` value removes the key), `deleteSetting(key)`, `clearSettings()` |
| Keyboard bindings declared in `starhermit.txt` as `control.<action>=…` | `await loadBindings(defaults)` → `{ action: codes[] }` with the player's overrides applied |
| A rebinding screen | `getControls()`, `setControl(action, codes)`, `setControls(bindings)`, `resetControls()` |

Route `keydown` through `event.code` and the bindings from `loadBindings`. See
[add controls to your game](../tutorials/game-controls.md) and the
[`starhermit.txt` manifest](../starhermit-txt.md).

## Multiplayer, invites and social

These need a game with a server (a [script](../api/game-scripts.md) or a
[container](../api/container-games.md)).

| Area | Calls |
|---|---|
| Sessions | `mySessions()`, `getSession(id)`, `startAiSession()`; `StarHermit.launchSessionId` after an invite launch |
| Gameplay socket | `const conn = connect(sessionId, { onGame, onError, onPresence, onAchievement, onResumed, onAbandoned, onOpen, onClose, onAuthLost })`, then `conn.send(data)`; reconnects with back-off, renewing the token first, and stops on 4403/4404 or when renewal is refused (see [reconnecting](#reconnecting-and-expired-tokens)) |
| Matchmaking | `queues()`, `joinQueue([keys])`, `matchStatus()`, `cancelMatch()`, `waitForMatch(opts)` |
| Invites | `sendInvite(toUserId[, sessionId])` (with a `sessionId` the friend joins that running session), `invites()`, `acceptInvite(id)`, `declineInvite(id)`; `inviteLink(query)` for a share link |
| Post a run to your leaderboards | `submitScores({ boardKey: number })` → accepted keys (see [single-player leaderboards](#single-player-leaderboards)) |
| Achievements and leaderboards (read-only) | `achievements()`, `linkedAchievements(otherSlug)`, `leaderboards()`, `leaderboard(key, opts)`, `leaderboardEntries(boardId, opts)`; unlock toasts via `on('achievement', …)` |
| Replays | `myReplays(limit)`, `getReplay(id)` |
| Session chat | `chatMessages(id)`, `sendChat(id, text)`, `pollChat(id, onMessages, intervalMs)` — REST and polling only for launch tokens |
| Voice / realtime rooms | `StarHermit.voice.*` (REST; WebRTC signalling is left to the game), `StarHermit.realtime.*` (rooms plus `ws/v1/realtime`) |

Anything not wrapped is one call away: `StarHermit.api(path, { method, body })` sends an
authenticated JSON request (resolves `null` on 404/204 or when signed out, rejects
`{ status, message }` on other failures, renews once on 401).

## Single-player leaderboards

A client can never post a score — only the game's server can — so a single-player game needs a
small platform script to own its boards. [`score-script.js`](score-script.js) is one: copy it next
to your game, declare it in [`starhermit.txt`](../starhermit-txt.md) as `server=score-script.js`, and
edit only its `BOARDS` block, which lists each board as you
[create it](../tutorials/game-leaderboards-achievements.md#1-create-the-leaderboards):

```js
var BOARDS = {
  "high-score": { "name": "High score", "scoreType": "integer", "sortDirection": "desc", "minScore": 0, "maxScore": 1000000 }
};
```

When a run ends, post it and show the player's place:

```js
const accepted = await StarHermit.submitScores({ 'high-score': total });   // [] when signed out or refused
if (accepted.includes('high-score')) {
  const board = await StarHermit.leaderboard('high-score', { pageSize: 100 });
  const me = board.items.find(e => e.userId === StarHermit.userId);
  showRank(me && me.rank);
}
```

`submitScores` opens a practice session (`POST .../sessions/ai`), sends `{type:'result', scores}` on
the gameplay socket, and resolves the board keys the script accepted; it also emits `scores` with
that list. The script drops a score that is not a number of the board's type or falls outside its
`minScore`/`maxScore`, posts the rest through its `scores` return, and ends the session. The client
still reports the result, so the range is your guard: set it to what the game can really produce,
or verify the run in the script (replaying recorded inputs, for instance) when cheating matters.

## Reconnecting and expired tokens

A socket carries the launch token in its URL, and a handshake with an expired token is refused before
the upgrade — the browser reports only close code `1006`, exactly like a network drop. So a failed
reconnect may be an auth failure, and retrying the same URL can never recover. Renewal works only
while the current token is valid and within 12 hours of the original launch; after that only the
launcher can mint a new token.

`connect()` handles this itself: before every reconnect it renews the token through
`POST /api/v1/games/{slug}/launch-token` (unless it was renewed since the socket opened) and reopens
with the new one. A network or server error while renewing backs off and renews again — it never
reopens the old URL. When renewal is refused or the token has expired, the SDK signs out (`auth` with
`reason: 'expired'`), stops reconnecting and calls `onAuthLost()`:

```js
const conn = StarHermit.connect(sessionId, {
  onGame, onClose,
  onAuthLost: () => showReconnectPanel(),   // e.g. "Session expired — Back to StarHermit"
});
backButton.onclick = () => StarHermit.relaunch();
```

`relaunch()` sends the player back for a fresh launch token: through sign-in when the game was opened
that way (`StarHermit.launchKind === 'sign-in'`), otherwise to the launcher. Inside the launcher's
game frame it navigates the top window, which browsers allow only from a user gesture, so call it
from a click; it returns `false` when the navigation was refused.

Sockets your game opens itself (`realtime.socketUrl(roomId)`, `voice.socketUrl(roomId)`) need the
same rule. Before reopening one, call `renewForReconnect()` and act on its result:

```js
async function reopen() {
  const r = await StarHermit.renewForReconnect();
  if (r === 'renewed') ws = new WebSocket(StarHermit.realtime.socketUrl(roomId)); // fresh token in the URL
  else if (r === 'retry') setTimeout(reopen, backoff());                         // renewal itself failed
  else showReconnectPanel();                                                     // 'relaunch'
}
```

Concurrent renewals share one request, so calling it from several sockets at once is safe.

## Events

`StarHermit.on(type, fn)` returns an unsubscribe function; `off(type, fn)` also works.

| Event | Payload |
|---|---|
| `auth` | `{ signedIn, userId }` on sign-in; `{ signedIn: false, reason }` on sign-out or expiry (`reason: 'expired'` when renewal is refused — offer `relaunch()`) |
| `saved` | `true` / `false` after each cloud write |
| `saveerror` | `{ op: 'load' }` after a failed read; `{ op: 'write', blocked: true }` for a refused write |
| `achievement` | an unlock pushed on the gameplay socket |
| `scores` | the board keys accepted by `submitScores` (`[]` when nothing was posted) |

## Keeping your copy current

Treat the file as vendored: copy it unchanged, never edit your copy, and replace it wholesale when
this page's file changes. Make sure your build or packaging step ships it alongside the game's
other static files.
