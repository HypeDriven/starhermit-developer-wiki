# Tutorial: persistent sessions — games that pause when everyone leaves

Normally the platform ends a match nobody is playing: once every player has disconnected and nobody
has come back within five minutes, the session finishes as `abandoned` with reason `players_left`
(see [Games API — Gameplay WebSocket](../api/games.md#server-to-client)). That is right for a chess
game or a race, and wrong for a farm, a city builder, a shared dungeon or any world a group of
players returns to over days.

A game can ask for **persistent sessions** instead. A persistent session is never ended for being
empty:

1. The last player leaves.
2. After about 15 seconds with nobody connected, the platform **pauses** the session. Nothing runs:
   a script game gets no `onTick` calls, and a container game's session is removed from the
   container.
3. The session stays paused for as long as nobody is there — hours, weeks.
4. The first player to connect on `ws/v1/games` **resumes** it, before their first command is
   handled. Play carries on from where it stopped.

This page shows how to turn it on, how to keep your game's clocks from jumping across a pause, and
what your client needs to do.

## 1. Opt in

Persistence is a per-game declaration, read when your game is published or updated — publish an
update after changing it. It must be a literal `true` or `false`; anything else counts as no
declaration, and a game that declares nothing behaves as before.

**Script game** — a static `persistent` on the `game` object (see
[Game Scripts](../api/game-scripts.md#persistent-sessions)):

```js
globalThis.game = {
  persistent: true,
  tickRateHz: 1,
  createSession(ctx) { /* ... */ },
  onPlayerMessage(ctx) { /* ... */ },
  onTick(ctx) { /* ... */ }
};
```

**Container game** — `persistent` in your `GET /describe` answer (see
[Container Game Servers](../api/container-games.md#get-describe)):

```json
{ "protocol": 1, "tickRateHz": 20, "maxSessions": 48, "persistent": true }
```

Nothing changes about how sessions are created: matchmaking, invites, the AI endpoint and realtime
rooms all produce persistent sessions for a persistent game.

## 2. Keep game time still while paused

The platform does not rewrite `ctx.now` — it stays the real wall clock, so any absolute time you
show players (a deadline, a "harvest ready at") keeps meaning what it says. Instead, persistent
sessions get one extra context field:

```js
ctx.pausedMs   // total milliseconds this session has spent paused, so far
```

It only grows, and only on persistent sessions (other games never see the field). Subtract it and you
have a **game clock** that stops while nobody is there:

```js
function gameTime(ctx) {
  return ctx.now - (ctx.pausedMs || 0);
}

globalThis.game = {
  persistent: true,
  tickRateHz: 1,

  createSession(ctx) {
    return { ok: true, sessionState: { lastTick: gameTime(ctx), crops: [] } };
  },

  onTick(ctx) {
    var state = ctx.sessionState;
    var t = gameTime(ctx);
    var dt = t - state.lastTick;      // never includes the time the world was paused
    state.crops.forEach(function (crop) { crop.growth += dt; });
    state.lastTick = t;
    return { ok: true, sessionState: state };
  },

  onPlayerMessage(ctx) { /* ... */ }
};
```

Store your own timestamps in game time (`gameTime(ctx)`), not in `ctx.now`, and compare them only
against game time. If you *want* the world to move on while nobody is watching — crops that grow
overnight — use `ctx.now` instead and catch up on the first tick after a resume. Either way it is your
choice; the platform only reports what happened.

Two details of the timing:

- During the ~15 seconds between the last player leaving and the pause, the session is still
  ticked normally. A player whose connection drops and comes straight back does not cause a pause.
- After a resume, the next `onTick` comes one tick interval later. The paused time is not replayed
  as a backlog of missed ticks.

A container receives `pausedMs` in the same place: in the `POST /sessions` body it is sent when
the session is restored after a pause.

## 3. Your client

A paused session is still an active session, so the client flow is the one you already have:

- **List worlds to rejoin** with `GET /api/v1/games/{slug}/sessions/mine`. Each entry has a
  `pausedAt` timestamp while it is paused and `null` while someone is in it, so you can show "paused
  since…" or "2 friends playing now" (see [Games API — Sessions](../api/games.md#get-apiv1gamesslugsessionsmine)).
- **Rejoin** by opening `ws/v1/games?sessionId=…` exactly as before. The resume happens during the
  connect. There is no special "resumed" frame for it — the game is simply running when your first
  command arrives — so request or wait for your game's normal full-state message, as you would on
  any reconnect.
- **Handle a failed resume.** If the platform cannot resume the session — most likely a container
  game whose server is still starting — you receive `{"type":"error","error":"…"}` and the socket
  is closed with code `1001`. The session stays paused and nothing is lost. Reconnect after a short
  backoff (a few seconds, growing), and show "starting the world…" rather than an error.
- `presence` frames work as usual, so the other players see who is in the world right now.

## 4. Ending a persistent session

Because emptiness no longer ends it, a persistent session finishes only when:

- **your game reports a `result`** (script return value or container control message), or
- the game's owner ends it (`DELETE /api/v1/me/github-games/{id}/sessions/{sessionId}`).

Asking for a new game does **not** retire the player's paused ones, and paused sessions still count
against the concurrent-session cap per player (20 by default). **Give players a way to finish or
leave a world** — an "abandon world" command your script answers with a `result`, for example.
Otherwise a player who has filled their cap cannot start anything new.

```js
onPlayerMessage(ctx) {
  var msg = ctx.message.data;
  if (msg.type === "close-world" && ctx.message.from === ctx.sessionState.ownerId) {
    return { ok: true, sessionState: ctx.sessionState, result: { kind: "closed" } };
  }
  /* ... */
}
```

## 5. Container games: parking

For a container game a pause is a **park**:

1. The platform asks for a final snapshot (`GET /sessions/{id}/snapshot`) and stores it durably.
2. It tears the session down (`DELETE /sessions/{id}`). Your container stops simulating it, and if
   it has no other sessions the deployment can be stopped after its idle period.
3. On the next join it recreates the session with `POST /sessions`, carrying the stored `snapshot`
   and the updated `pausedMs` — the same request as a crash restore — waking a stopped deployment
   first if needed.

So the snapshot you return must be enough to rebuild the whole world, not just to resume a few
seconds of play. If that final snapshot fails, the session is parked from its last periodic
checkpoint. Unlike a crash, a park-and-restore is not counted against your restart budget, and
players get no `resumed` frame: nobody was there to see the state rewind.

## Checklist

- [ ] `persistent: true` declared (script) or returned from `/describe` (container), and an update published.
- [ ] Game timers use `ctx.now - ctx.pausedMs`, or deliberately use `ctx.now` and catch up.
- [ ] The client lists `sessions/mine`, shows `pausedAt`, and rejoins over `ws/v1/games`.
- [ ] The client retries with backoff after an `error` followed by close code `1001` on connect.
- [ ] Players have a way to end a world, so they never get stuck at the session cap.
- [ ] (Container) snapshots rebuild the entire world.
