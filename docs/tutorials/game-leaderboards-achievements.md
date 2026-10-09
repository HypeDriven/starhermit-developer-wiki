# Tutorial: leaderboards and achievements for your game

If you own a game on StarHermit, you are its publisher. You can give it **leaderboards** (high score,
fastest run, longest streak) and **achievements** without a publisher account or any special
permission. Owning the game is all it takes.

There is one rule behind everything on this page: **you define them, your game's server writes
them.** A player's client can never post a score or claim an achievement for these, so a modified
client cannot reach the top of your board. That is why the game needs an authoritative backend: a
`server=` script or a `container.image=` in [`starhermit.txt`](../starhermit-txt.md).

This tutorial builds both for a small arcade game, *Star Collector*: a run ends when the player
crashes, and it has a points total and a run time.

1. [Before you start](#before-you-start)
2. [Create the leaderboards](#1-create-the-leaderboards)
3. [Create the achievements](#2-create-the-achievements)
4. [Post scores and unlock achievements from your script](#3-post-scores-and-unlock-achievements-from-your-script)
5. [The same from a container](#3b-the-same-from-a-container)
6. [Show them in your game](#4-show-them-in-your-game)
7. [Look after them](#5-look-after-them)

## Before you start

You need:

- **A game with a server backend** that you own: one you added from your own repository, uploaded
  as a folder, or [claimed](claim-existing-game.md). A browser-only game answers `409` to every call
  below, with a message saying why.
- **A full user access token**, not a game's launch token. Launch tokens are fenced to the game's
  player surface and cannot reach `/me/...`.
- **Your game's id** (it is also its `<id>.starhermit.com` address):

```bash
ACCESS_TOKEN='your-full-user-access-token'
API=https://api.starhermit.com

curl -s "$API/api/v1/me/github-games" -H "Authorization: Bearer $ACCESS_TOKEN" |
  jq '.[] | {id, displayName, gameSlug}'
```

```bash
GAME_ID='the-id-from-above'
```

`gameSlug` is what your client calls the game in `/api/v1/games/{slug}/...`. Every game you added
or uploaded has one, browser-only games included, so it does not tell you whether there is a server:
`GET /api/v1/games/{slug}` does — it answers `404` until the game has a backend.

## 1. Create the leaderboards

Star Collector gets two boards: most points (higher is better) and fastest run to 100 points (lower
is better).

```bash
curl -s -X POST "$API/api/v1/me/github-games/$GAME_ID/leaderboards" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "key": "high-score", "name": "High score",
        "scoreType": "integer", "sortDirection": "desc",
        "minScore": 0, "maxScore": 1000000 }'

curl -s -X POST "$API/api/v1/me/github-games/$GAME_ID/leaderboards" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "key": "fastest-100", "name": "Fastest to 100",
        "scoreType": "time-ms", "sortDirection": "asc" }'
```

Each call returns `201` and the board, including its `id` and `key`. Your server uses the **key**,
so choose it carefully. The key, `scoreType` and `sortDirection` cannot be changed later.

| `scoreType` | Accepts |
|---|---|
| `integer` | whole numbers |
| `decimal` | any number |
| `time-ms` | whole, non-negative milliseconds |

Set `minScore`/`maxScore` to what your game can actually produce. A score outside them is dropped,
which is a cheap guard against a bug in your own server logic.

## 2. Create the achievements

You can give a game achievements in two ways, and you can use both at once:

| | Declared in code | Created through the API |
|---|---|---|
| Where | `game.achievements` in your script, or `/describe` in your container | `POST /me/github-games/{id}/achievements` |
| Changed by | publishing an update | an API call, taking effect immediately |
| Good for | the achievements your code is built around | adding or rewording some without a release |

Both kinds are unlocked the same way, by your server returning the key. Here we create two through
the API:

```bash
curl -s -X POST "$API/api/v1/me/github-games/$GAME_ID/achievements" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "key": "century", "name": "Century",
        "description": "Collect 100 stars in one run.", "points": 10 }'

curl -s -X POST "$API/api/v1/me/github-games/$GAME_ID/achievements" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "key": "untouchable", "name": "Untouchable",
        "description": "Reach 500 points without losing a shield.",
        "points": 50, "secret": true }'
```

A `secret` achievement stays hidden from players until they have unlocked it.

To see everything the game has, including achievements your code declares, list them:

```bash
curl -s "$API/api/v1/me/github-games/$GAME_ID/achievements" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.[] | {key, origin, unlocks}'
```

`origin` is `declared` for achievements from your code and `owner` for achievements you created
here. You can edit and delete only `owner` ones. A `declared` one would be put back by your next
update, so the API refuses (`409`) and you change it in code instead.

## 3. Post scores and unlock achievements from your script

Your script reports both kinds of result in its return value. It can do this from any hook:
`createSession`, `onPlayerMessage` or `onTick`.

- `scores`: board key → player id → number.
- `achievements`: player id → keys to unlock.

```js
'use strict';

function endRun(ctx, s, playerId) {
  var run = s.runs[playerId];
  var scores = { "high-score": {} };
  scores["high-score"][playerId] = run.points;
  if (run.reached100At) {
    scores["fastest-100"] = {};
    scores["fastest-100"][playerId] = run.reached100At - run.startedAt;
  }

  var unlocked = [];
  if (run.stars >= 100) unlocked.push("century");
  if (run.points >= 500 && !run.lostShield) unlocked.push("untouchable");
  var achievements = {};
  achievements[playerId] = unlocked;

  run.over = true;
  return {
    ok: true,
    sessionState: s,
    scores: scores,
    achievements: achievements,
    broadcast: [{ to: [playerId], data: { type: "run-over", points: run.points } }]
  };
}

globalThis.game = {
  tickRateHz: 10,

  createSession(ctx) {
    var runs = {};
    ctx.players.forEach(function (p) {
      runs[p.id] = { points: 0, stars: 0, lostShield: false, startedAt: ctx.now,
                     reached100At: null, over: false };
    });
    return { ok: true, sessionState: { runs: runs } };
  },

  onPlayerMessage(ctx) {
    var s = ctx.sessionState;
    var from = ctx.message.from;
    var run = s.runs[from];
    var msg = ctx.message.data || {};
    if (!run || run.over) return { ok: false, error: "No run in progress" };

    // The client reports what happened; the script decides what it is worth.
    if (msg.type === "collect") {
      run.stars += 1;
      run.points += 5;
      if (run.points >= 100 && !run.reached100At) run.reached100At = ctx.now;
      return { ok: true, sessionState: s };
    }
    if (msg.type === "shield-lost") {
      run.lostShield = true;
      return { ok: true, sessionState: s };
    }
    if (msg.type === "crash") return endRun(ctx, s, from);
    return { ok: false, error: "Unknown command" };
  },

  onTick(ctx) { return { ok: true }; }
};
```

Things you do **not** need to handle:

- **Worse scores.** Each player keeps their best score on each board, judged by the board's
  `sortDirection`. Report every run and the platform keeps the best.
- **Repeat unlocks.** Unlocking something a player already has does nothing, so return the key
  whenever the condition holds.
- **Anyone else's id.** Scores and unlocks for people who are not in the session, including the AI
  seat, are ignored.

Unknown keys, inactive boards and out-of-range scores are dropped silently. Your script gets no
error for them, so check your boards once, as in [section 4](#4-show-them-in-your-game).

A real game should have the server work out points and times from its own authoritative state, not
trust `collect` messages as they are. This example is kept short to show the reporting.
[Game Scripts](../api/game-scripts.md#leaderboards) has the full return-shape contract.

## 3b. The same from a container

A container game sends the same two things on its control WebSocket:

```json
{ "type": "scores", "sessionId": "…",
  "scores": { "high-score": { "<userId>": 740 }, "fastest-100": { "<userId>": 41250 } } }

{ "type": "achievements", "sessionId": "…",
  "unlocks": { "<userId>": ["century"] } }
```

`scores` can also be included in any response envelope your container returns from `/sessions`. The
same rules apply: participants only, best score kept, unknown keys ignored. See
[Container Game Servers](../api/container-games.md#control-channel).

## 4. Show them in your game

Your client reads everything with the launch token it already holds. Nothing here needs the
owner's token.

**Find the boards.**

```js
const boards = await api(`/api/v1/games/${slug}/leaderboards`);
// [{ id, key: "high-score", name: "High score", sortDirection: "desc", ... }, ...]
const high = boards.find(b => b.key === "high-score");
```

Only active boards are listed.

**Read a board.**

```js
const page = await api(`/api/v1/leaderboards/${high.id}/entries?page=1&pageSize=10`);
// { items: [{ rank, username, score, ... }], total, page, pageSize }
const friends = await api(`/api/v1/leaderboards/${high.id}/entries?friendsOnly=true&pageSize=10`);
```

For a `time-ms` board, format the score as a time: `41250` → `0:41.25`.

**Achievements.**

- `GET /api/v1/games/{slug}/achievements` lists every achievement with the player's `unlocked`
  state. Secrets stay hidden until they are earned.
- The unlock itself arrives live on `ws/v1/games` as
  `{"type":"achievement","data":{key,name,description,points,...}}`. Show a toast when it does.
  The list call on load catches anything unlocked while the socket was closed.

See [Achievements](../api/achievements.md#3-the-player-is-notified-over-the-gameplay-socket) for
the frame.

## 5. Look after them

**Rename a board or change its bounds.**

```bash
curl -s -X PUT "$API/api/v1/me/github-games/$GAME_ID/leaderboards/$BOARD_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "All-time high score", "maxScore": 2000000 }'
```

New bounds apply to new scores only.

**Retire a board but keep its scores.** Send `{ "isActive": false }`. The board stops accepting
scores and disappears from the game's list. Its entries can still be read by id.

**Reset on a schedule.** Give a board `"resetSchedule": "daily"`, `"weekly"` or `"monthly"` (on
create, or later with `PUT`) and it starts over at 00:00 UTC each period — perfect for a "this
week's best" board beside an all-time one. Nothing to do in your script: report scores as usual, and
each player's first score of a new period counts. See
[Reset schedules](../api/leaderboards.md#reset-schedules).

**Start a fresh season by hand.** For a one-off season rather than a schedule, create a new board
(`high-score-s2`), point your script at it, and retire the old one.

**Delete a board.** `DELETE .../leaderboards/{id}` removes the board and all of its entries, and
cannot be undone.

**Edit an achievement.** `PUT .../achievements/{achievementId}` with any of `name`,
`description`, `icon`, `secret` and `points`. The key never changes.

**Delete an achievement.** This works only for one you created that nobody has unlocked yet.
Earned achievements are permanent.

**Move an achievement into code.** Declare the same key in `game.achievements` and publish. The
declaration takes over the existing achievement, and players who have it keep it.

| Response | Meaning |
|---|---|
| `404` | The game is not yours, or the board or achievement does not belong to it |
| `409` "…server backend…" | The game has no `server=` or `container.image=` |
| `409` "already has…" | The key is taken, by a board or by a declared or created achievement |
| `409` "declared by the game's server" | Change that achievement in your code |
| `409` "already unlocked" | Players hold it, so it cannot be deleted |
| `400` | A key with other characters, a missing name, or `minScore` > `maxScore` |

Limits: 2048 leaderboards and 200 created achievements per game, plus up to 100 declared ones.

## Checklist

- [ ] The game has a `server=` script or `container.image=`, and `gameSlug` is set in `GET /me/github-games`.
- [ ] Each board has a stable key and the right `scoreType` and `sortDirection` (they cannot change later).
- [ ] The server returns `scores` and `achievements` (script) or sends the control messages (container), worked out from authoritative state.
- [ ] The client finds boards with `GET /games/{slug}/leaderboards`, never hard-codes their ids, and reads entries by id.
- [ ] The client loads `GET /games/{slug}/achievements` and shows a toast on the `achievement` frame.
- [ ] Old boards are retired with `isActive: false` rather than deleted, unless you really want the scores gone.
