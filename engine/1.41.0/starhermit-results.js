// starhermit-results.js: checks for a platform server script that writes its game's leaderboards (host API 1.37,
// results version 1). Server scripts are one file with no imports, so copy this block into the game's server script
// above `globalThis.game` (`starhermit types DIR` writes the runtime's copy to .starhermit/starhermit-results.js, for a
// build step that prepends it). It runs as the platform runs server scripts (no Date, no Math.random, no imports)
// and on the local platform's authority alike.
//
// The client never writes a board. `leaderboards.submitScore(board, result, { run })` (starhermit:platform) sends a
// claim, which this script checks and then writes or refuses:
//   { type: 'result', v: 1, board, scores: { [board]: number },
//     timing: { playedMs: number | null, frames: number | null }, runSeed?: number, evidence?: JSON }
// and `leaderboards.startRun()` sends { type: 'run-start', v: 1, atMs } when the run's session opens (`atMs`: how far
// into the run that was), so the script measures the run's length on its own clock (`ctx.now`) rather than taking
// the client's word for it. The script answers it with { type: 'run-started', v: 1, seed } (the run's seed, which
// `run.seed` reads and the result names back as `runSeed`), and a result with
//   { type: 'result-ack', v: 1, accepted: [board…], rejected: { [board]: reason } }
// to the sender alone. Each player in a session has their own run and one result; the session ends once every human
// player has had theirs. A script that trusts the raw number is cheatable: anyone can send
// { type: 'result', scores: { best: 1e9 } } from a modified client. Bound every board, and verify a replay
// where the game can re-simulate one (seeded from the run's seed, so a replay binds to its session).
//
//   var results = StarHermitResults.create({
//     boards: { 'high-score': { scoreType: 'integer', min: 0, max: 50000, maxPerSecond: 40, minPlayedMs: 20000 } },
//     requireRun: true,
//     requireSeed: true,
//     replay: function (evidence, claim, ctx) { return simulate(claim.runSeed, evidence.inputs).score; },
//   });
//   globalThis.game = {
//     tickRateHz: 0,
//     createSession: function (ctx) { return results.createSession(ctx); },
//     onPlayerMessage: function (ctx) { return results.handle(ctx) || { ok: false, error: 'Unknown command' }; },
//   };
var StarHermitResults = (function () {
  'use strict';
  var VERSION = 1;
  var KEY = 'starhermitResults';
  var MAX_BOARDS = 16;
  var SLACK_MS = 5000;
  var MAX_START_OFFSET_MS = 30000;
  var MAX_FPS = 500;
  var has = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  var finite = function (value) { return typeof value === 'number' && isFinite(value); };
  var objectLike = function (value) { return value !== null && typeof value === 'object' && !Array.isArray(value); };
  var option = function (value, fallback) { return finite(value) && value >= 0 ? value : fallback; };
  /** A board key a result may name: 1 to 64 characters, and none of an object's own machinery. */
  var boardKey = function (key) {
    return key.length >= 1 && key.length <= 64 && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
  };

  /** The result message in `data` (`ctx.message.data`), checked: null when it is not one. A message of the older
   * shape ({ type: 'result', scores }) reads with no board, timing, run seed or evidence. Keys no board has (empty,
   * over 64 characters, `__proto__`, `constructor`, `prototype`) are dropped. */
  function read(data) {
    if (!objectLike(data) || data.type !== 'result' || !objectLike(data.scores)) return null;
    var scores = {}, count = 0;
    for (var key in data.scores) {
      if (!has(data.scores, key) || !boardKey(key)) continue;
      if (++count > MAX_BOARDS) break;
      scores[key] = data.scores[key];
    }
    var timing = objectLike(data.timing) ? data.timing : {};
    var amount = function (value) { return finite(value) && value >= 0 ? value : null; };
    return {
      v: finite(data.v) ? data.v : 0,
      board: typeof data.board === 'string' ? data.board : null,
      scores: scores,
      playedMs: amount(timing.playedMs),
      frames: amount(timing.frames),
      runSeed: amount(data.runSeed),
      evidence: has(data, 'evidence') ? data.evidence : null,
    };
  }

  /** Why `value` is no score for a board of these `rules` (`scoreType` 'integer', 'decimal' or 'time-ms', `min`,
   * `max`), or null when it is one. A time-ms board's only lower bound is its `min` (0 without one) and a replay:
   * the play time bounds a time from above alone, so set `min` to the fastest time the game allows. */
  function checkScore(rules, value) {
    if (!finite(value)) return 'not-a-number';
    var type = rules.scoreType || 'integer';
    if (type !== 'decimal' && Math.floor(value) !== value) return 'not-an-integer';
    if (type === 'time-ms' && value < 0) return 'below-min';
    if (rules.min != null && value < rules.min) return 'below-min';
    if (rules.max != null && value > rules.max) return 'above-max';
    return null;
  }

  /** Why `value` is implausible after `playedMs` of play, or null: `minPlayedMs` (a run shorter than that never
   * counts) and `maxPerSecond` (with an optional `base`: at most base + maxPerSecond × seconds played), both on
   * `playedMs` exactly, and, for a time-ms board, a time no longer than the play plus `allowanceMs` (the slack and the
   * run's start offset; 5,000 when not given), the one check an allowance loosens. */
  function checkBounds(rules, value, playedMs, allowanceMs) {
    var played = finite(playedMs) && playedMs > 0 ? playedMs : 0;
    if (rules.minPlayedMs != null && played < rules.minPlayedMs) return 'too-short';
    if (rules.maxPerSecond != null && value > (rules.base || 0) + rules.maxPerSecond * (played / 1000)) return 'too-fast';
    if (rules.scoreType === 'time-ms' && rules.timeWithinPlay !== false && played > 0 &&
        value > played + option(allowanceMs, SLACK_MS)) {
      return 'longer-than-play';
    }
    return null;
  }

  /** The play time to judge a claim by, from a player's state (`runStartedAt`, the server's clock): the run's length
   * on the server's clock since its start reached the session (the claimed time when shorter: never more than the
   * server saw), else the claimed time; with `requireRun`, null without a run. */
  function playedMs(state, claim, now, options) {
    var started = state && finite(state.runStartedAt) ? state.runStartedAt : null;
    if (started === null || !finite(now)) return options && options.requireRun ? null : claim.playedMs || 0;
    var server = Math.max(0, now - started);
    return claim.playedMs === null ? server : Math.min(claim.playedMs, server);
  }

  /** A replay's check: `simulate(evidence, claim, ctx)` re-runs the game deterministically and answers the score
   * it reached (a number, for `board`) or every board's (an object). Why the claim fails, or null when the
   * re-simulation reached the claimed score (within `tolerance`). Throwing, or answering nothing, fails it. Through
   * `create`, `claim.runSeed` is the seed the session issued the run (the server's, never the client's word), so a
   * simulation seeded from it re-plays only a run of this session. */
  function verifyReplay(simulate, claim, board, ctx, tolerance) {
    if (claim.evidence === null || claim.evidence === undefined) return 'no-evidence';
    var reached;
    try {
      reached = simulate(claim.evidence, claim, ctx);
    } catch (error) {
      return 'replay-failed';
    }
    if (objectLike(reached)) reached = reached[board];
    if (!finite(reached)) return 'replay-failed';
    return Math.abs(reached - claim.scores[board]) <= (tolerance || 0) ? null : 'replay-mismatch';
  }

  /** The acknowledgement broadcast to the player `to`. */
  function ack(to, accepted, rejected) {
    return { to: [to], data: { type: 'result-ack', v: VERSION, accepted: accepted, rejected: rejected || {} } };
  }

  /** The checks as one. Options: `boards` (each board's rules, as checkScore and checkBounds take them; boards not
   * named are refused); `requireRun` (refuse a claim whose run did not start on this session); `slackMs` (5,000) and
   * `maxStartOffsetMs` (30,000: how late into the run its start reached the session, as `run-start`'s `atMs` says),
   * which loosen only a time-ms board's time-within-play check and the frames check; `maxFps` (500: a result's frames
   * at most this many a second of its run); `replay` (the game's re-simulation, run once a result, see verifyReplay;
   * when given every board needs it unless its rules say `replay: false`); `requireSeed` (refuse a run's result that
   * does not name the seed its session issued: `no-seed`; a wrong one is always `wrong-seed`); `tolerance` (0). A
   * result without timing, frames or a run seed (an older client's) still reads, with those checks skipped. Returns
   * `createSession(ctx)` and `handle(ctx)`, which answers a `run-start` (with `run-started` and the run's seed, a
   * 32-bit integer from `ctx.random`, to the sender) or a `result` message with the whole invocation result, and
   * anything else with null, for the game's own commands. Its state is per player (`ctx.message.from`), under
   * `starhermitResults` in the session state beside the game's own: one run and one result each, and the session
   * ends once every human player in `ctx.players` (the sender alone, without it) has had a result. */
  function create(options) {
    if (!objectLike(options) || !objectLike(options.boards)) throw new TypeError('StarHermitResults.create takes { boards }');
    var boards = options.boards;
    var slackMs = option(options.slackMs, SLACK_MS);
    var maxStartOffsetMs = option(options.maxStartOffsetMs, MAX_START_OFFSET_MS);
    var maxFps = option(options.maxFps, MAX_FPS);
    function own(state) {
      var base = objectLike(state) ? state : {};
      if (!objectLike(base[KEY]) || !objectLike(base[KEY].players)) base[KEY] = { v: VERSION, players: {} };
      return base;
    }
    /** A player's own state (keyed 'p:' + id, so no id names an object's machinery). */
    function playerState(mine, from) {
      var key = 'p:' + from;
      if (!objectLike(mine.players[key])) mine.players[key] = { runStartedAt: null, startOffsetMs: 0, seed: null, ack: null };
      return mine.players[key];
    }
    /** Whether every human player in the session has had a result (the sender alone when `ctx.players` names none). */
    function everyoneDone(mine, ctx) {
      var players = Array.isArray(ctx.players) ? ctx.players : [];
      for (var i = 0; i < players.length; i++) {
        var player = players[i];
        if (!objectLike(player) || player.ai === true || typeof player.id !== 'string') continue;
        var state = mine.players['p:' + player.id];
        if (!objectLike(state) || state.ack === null) return false;
      }
      return true;
    }
    /** Why the whole result fails before any board's checks, or null: a run seed not the session's, or more frames
     * than the run had time for (its server time, start offset and slack; the claimed time without a run). */
    function checkRun(claim, ctx, mine) {
      if (mine.seed !== null) {
        if (claim.runSeed !== null && claim.runSeed !== mine.seed) return 'wrong-seed';
        if (claim.runSeed === null && options.requireSeed) return 'no-seed';
      }
      if (claim.frames !== null) {
        var span = finite(mine.runStartedAt) && finite(ctx.now)
          ? Math.max(0, ctx.now - mine.runStartedAt) + mine.startOffsetMs
          : claim.playedMs;
        if (span !== null && claim.frames > Math.ceil(((span + slackMs) / 1000) * maxFps)) return 'too-many-frames';
      }
      return null;
    }
    function judge(claim, ctx, mine) {
      var accepted = [], rejected = {}, scores = {}, from = ctx.message.from;
      var played = playedMs(mine, claim, ctx.now, options);
      var whole = played === null ? null : checkRun(claim, ctx, mine);
      // The replay runs under the seed the session issued, and once for all the boards.
      if (mine.seed !== null) claim.runSeed = mine.seed;
      var replayed = null;
      var simulate = function (evidence, given, at) {
        if (replayed === null) {
          replayed = { threw: false, value: undefined };
          try {
            replayed.value = options.replay(evidence, given, at);
          } catch (error) {
            replayed.threw = true;
          }
        }
        if (replayed.threw) throw new Error('replay failed');
        return replayed.value;
      };
      for (var key in claim.scores) {
        if (!has(claim.scores, key)) continue;
        var rules = has(boards, key) ? boards[key] : null;
        var value = claim.scores[key];
        var why = rules === null ? 'unknown-board' : played === null ? 'no-run' : whole || checkScore(rules, value);
        if (why === null) why = checkBounds(rules, value, played, slackMs + mine.startOffsetMs);
        if (why === null && typeof options.replay === 'function' && rules.replay !== false) {
          why = verifyReplay(simulate, claim, key, ctx, options.tolerance);
        }
        if (why === null) {
          scores[key] = {};
          scores[key][from] = value;
          accepted.push(key);
        } else {
          rejected[key] = why;
        }
      }
      return { accepted: accepted, rejected: rejected, scores: scores };
    }
    return {
      createSession: function (ctx) {
        var state = own(ctx.sessionState);
        return { ok: true, sessionState: state };
      },
      handle: function (ctx) {
        var data = ctx.message && ctx.message.data;
        if (!objectLike(data) || typeof ctx.message.from !== 'string') return null;
        var from = ctx.message.from;
        var state = own(ctx.sessionState);
        if (data.type === 'run-start') {
          var run = playerState(state[KEY], from);
          // The first start counts: a later one cannot shorten the run or change its seed.
          if (run.runStartedAt === null && run.ack === null && finite(ctx.now)) {
            run.runStartedAt = ctx.now;
            run.startOffsetMs = finite(data.atMs) ? Math.min(Math.max(data.atMs, 0), maxStartOffsetMs) : 0;
            if (finite(ctx.random)) run.seed = Math.floor(ctx.random * 4294967296) % 4294967296;
          }
          var started = { type: 'run-started', v: VERSION, seed: run.seed };
          return { ok: true, sessionState: state, broadcast: [{ to: [from], data: started }] };
        }
        var claim = read(data);
        if (claim === null) return null;
        var mine = playerState(state[KEY], from);
        if (mine.ack !== null) {
          // One result a player: the same answer again, nothing written.
          return { ok: true, sessionState: state, broadcast: [ack(from, mine.ack.accepted, mine.ack.rejected)] };
        }
        var verdict = judge(claim, ctx, mine);
        mine.ack = { accepted: verdict.accepted, rejected: verdict.rejected };
        var out = {
          ok: true,
          sessionState: state,
          scores: verdict.scores,
          broadcast: [ack(from, verdict.accepted, verdict.rejected)],
        };
        if (everyoneDone(state[KEY], ctx)) {
          state.summary = { status: 'finished' };
          out.result = { kind: 'finished', reason: 'result' };
        }
        return out;
      },
    };
  }

  return Object.freeze({
    version: VERSION,
    read: read,
    checkScore: checkScore,
    checkBounds: checkBounds,
    playedMs: playedMs,
    verifyReplay: verifyReplay,
    ack: ack,
    create: create,
  });
})();
