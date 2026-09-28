# Leaderboards

Leaderboard definitions and entries. Reads are anonymous; submitting a score requires a JWT.

Base URL: `https://api.starhermit.com`. All routes are under `/api/v1/...`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/leaderboards` | Anonymous | List definitions (query `scope`, `region`, `titleId`) |
| GET | `/api/v1/leaderboards/{id}` | Anonymous | Get one definition |
| GET | `/api/v1/leaderboards/{id}/entries?scope=&region=&friendsOnly=&page=&pageSize=` | Anonymous | Paged entries; `friendsOnly=true` requires auth |
| POST | `/api/v1/leaderboards/{id}/submit` | JWT | Submit a score (catalog boards only) |
| GET | `/api/v1/games/{slug}/leaderboards` | Bearer | Your game's own active boards (launch token accepted) |
| GET/POST | `/api/v1/me/github-games/{id}/leaderboards` | JWT (game owner) | List / create your game's boards |
| PUT/DELETE | `/api/v1/me/github-games/{id}/leaderboards/{leaderboardId}` | JWT (game owner) | Update / delete one |

Definitions are `LeaderboardDefinitionDto[]`:

```json
[
  {
    "id": "…",
    "softwareTitleId": "…",
    "gameDefinitionId": null,
    "key": null,
    "name": "…",
    "scoreType": "…",
    "sortDirection": "…",
    "resetSchedule": "weekly",
    "currentPeriodStartedAt": "2026-10-12T00:00:00+00:00",
    "nextResetAt": "2026-10-19T00:00:00+00:00",
    "minScore": 0,
    "maxScore": 100,
    "scope": "…",
    "region": "…",
    "isActive": true,
    "createdAt": "…",
    "updatedAt": "…"
  }
]
```

Entries response:

```json
{
  "items": [
    {
      "id": "…",
      "userId": "…",
      "username": "…",
      "score": 1500,
      "rank": 1,
      "region": "…",
      "submittedAt": "…"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

Submit body:

```json
{
  "score": 1500
}
```

The score is validated against the definition's `minScore`/`maxScore` and publisher rules; the response is the entry result.

## Authoritative games and Elo

Each authoritative game has an elo leaderboard; its id comes from `GET /api/v1/games/{slug}` → `leaderboardId` (see [games.md](games.md)). Scores are written ONLY by the platform from the script's `eloUpdates` or the container control channel — direct submit is refused. Game clients read entries through the standard paged endpoint; for example, the chess reference implementation requests:

```
GET /api/v1/leaderboards/{leaderboardId}/entries?friendsOnly=true&page=1&pageSize=10
```

Game-scoped launch tokens may read their own game's leaderboard. Publisher-side leaderboard CRUD lives in [publisher.md](publisher.md).

### Resetting a player's rating

The game's owner can put one player's rating back to the starting **1200** — for a smurf, a boosted
account, or a rating a bug corrupted:

```
DELETE /api/v1/me/github-games/{id}/players/{userId}/elo      → 200 { "userId": "…", "elo": 1200 }
```

It resets the rating matchmaking pairs on, removes the player's row from the elo board (it returns
with their next rated match), and sets a top-level numeric **`elo`** in your script's player document
to 1200 — because your script computes the next rating from its own document, resetting only the
platform's copy would be undone by the next match. Everything else in the document (wins, history)
is left alone. If your script keeps its rating under any other name, it is **not** rewritten: keep
it in `playerStates[id].elo` to get resets for free. A match already in progress may still report a
rating computed before the reset. `404` when the game is not yours or the player has no rating in
it. The rating is also subject to the [elo rules](games.md#limits).

## Reset schedules

Any leaderboard — a game's own board, or a catalog title's — can start over on a schedule:

| `resetSchedule` | Starts over |
|---|---|
| `daily` | every day at 00:00 UTC |
| `weekly` | every Monday at 00:00 UTC |
| `monthly` | on the 1st of each month at 00:00 UTC |
| omitted, `null` or `"never"` | never |

Any other value is a `400`. The definition reports `currentPeriodStartedAt` and `nextResetAt` (both
`null` for a board that never resets), so a client can show "resets in 2 days".

A reset is applied when the board is **read**: the entries endpoint shows only scores submitted since
the current period began, and ranks are computed within the period. Nothing is deleted at the
boundary, so the reset takes effect at exactly 00:00 UTC. It also means the schedule can be changed
at any time — it changes which entries are shown, not which are kept. Previous periods are not
readable through the API.
## Your game's own leaderboards

Beside its elo board, a game with a `server=` script or `container.image=` backend can have
leaderboards of its own — high score, fastest lap, most kills — created by **the game's owner**.
You don't need a publisher account: owning the game makes you its publisher.

Like the elo board, **only your game's server writes to them.** Your script returns
`scores: { "<key>": { "<userId>": score } }` from any hook (see
[Game Scripts — Leaderboards](game-scripts.md#leaderboards)), or your container sends a
[`scores` control message](container-games.md#control-channel). `POST /leaderboards/{id}/submit` is
refused, so a modified client cannot post a score.

### Create one — `POST /api/v1/me/github-games/{id}/leaderboards`

```json
{
  "key": "high-score",
  "name": "High score",
  "scoreType": "integer",
  "sortDirection": "desc",
  "minScore": 0,
  "maxScore": 1000000,
  "isActive": true
}
```

Returns `201` with a `LeaderboardDefinitionDto` whose `gameDefinitionId` and `key` are set.

| Field | Meaning |
|---|---|
| `key` | **Required.** The name your server submits under: 1–64 letters, digits, `.`, `_`, `-`. Unique per game. |
| `name` | **Required.** Display name, at most 200 characters. |
| `scoreType` | `integer` (default), `decimal`, or `time-ms` (a non-negative whole number of milliseconds) |
| `sortDirection` | `desc` (default — higher is better) or `asc` (lower is better, e.g. lap times) |
| `minScore` / `maxScore` | Optional bounds; a score outside them is ignored |
| `isActive` | Default `true`. An inactive board accepts no scores and is not listed to players. |
| `resetSchedule` | Optional: `daily`, `weekly` or `monthly` — see [Reset schedules](#reset-schedules). Default: never resets. |

**`key`, `scoreType` and `sortDirection` cannot change after creation**: your server submits by key,
and the scores already stored were chosen by the other two. Need a different one? Create a new board.
`PUT .../leaderboards/{leaderboardId}` accepts `name`, `minScore`, `maxScore`, `isActive` and
`resetSchedule` (send `"never"` to stop resetting); `DELETE` removes the board **and its entries** —
set `isActive: false` to retire it and keep them. A game may have at most **2048** boards.

### How scores are kept

- **One entry per player: their best.** "Best" follows the board's `sortDirection`. Submitting a
  worse score changes nothing, so report after every match without checking first. On a board with
  a reset schedule, it is the best **this period**: the first score after a reset always counts,
  however good the player's score last period was.
- Only players in the session can be scored; the AI seat and anybody else are ignored.
- A score that breaks the board's rules (out of range, a fraction on an `integer` board, a negative
  `time-ms`) is ignored, as is a key with no active board. Nothing is reported back to your server.

### Show them in your game

`GET /api/v1/games/{slug}/leaderboards` lists the game's active boards with their `id` and `key`,
and works with the game's launch token. Read entries with the standard paged endpoint above —
`GET /api/v1/leaderboards/{id}/entries` — which the launch token may also reach for these boards.

Step-by-step: [Tutorial: leaderboards and achievements for your game](../tutorials/game-leaderboards-achievements.md).

Errors are `{"error": "..."}` with standard status codes.
