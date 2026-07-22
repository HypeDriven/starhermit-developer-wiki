# Use AI to wire StarHermit into your game

This page is a set of copy-pasteable prompts for an AI coding assistant — Kimi Code, Claude Code, Copilot Chat, or similar — working **inside your own game repository**. Each prompt assumes the AI can read your codebase, so it can match your language, framework, and file layout instead of producing generic snippets.

How to use them:

- Replace the `[bracketed]` placeholders with your own values.
- Work one section at a time, in roughly the order listed.
- **Give the AI the relevant wiki page as context.** Each section names the page; paste its contents into the conversation or point the tool at the file. The prompts reference exact endpoints, and the reference pages are the source of truth for field names.
- Verify each feature against a running backend (`http://localhost:5000`) before moving on — see the tips at the end.

These prompts work for any game. For reference code, point the AI at the chess reference implementation — [HypeDriven/starhermit-chess](https://github.com/HypeDriven/starhermit-chess) — a complete worked example of every pattern on this page.

## 1. Project bootstrap: manifest + same-origin net layer

Context page: [github-games.md](../api/github-games.md), [auth.md](../api/auth.md), [games.md](../api/games.md).

```text
Read docs/api/github-games.md and docs/api/auth.md (pasted below), then:

1. Create a starhermit.txt manifest at the repo root with keys name, slug,
   launch, owner, and server. Use slug "[my-game]" and launch "index.html".
2. Create a net module (match this repo's language/module style) that:
   - Reads the JWT from the URL hash fragment #game_token=<jwt> exactly once,
     then strips it from the URL with history.replaceState. Also parse an
     optional &session_id=<guid> from the same hash.
   - Decodes the JWT payload (base64url, no signature verification) and
     exposes the `sub` claim (user id) and `game_scope` claim (game slug).
   - Builds all API URLs as same-origin relative paths:
     /api/v1/games/<slug> + suffix. Never hard-code the slug; always use
     the game_scope claim.
   - Attaches `Authorization: Bearer <token>` to every request.
   - Refreshes the token every 45 minutes by calling
     POST /api/v1/games/<slug>/launch-token with the current token, and
     swaps in the returned { token } (it expires after expiresInSeconds
     = 3600 seconds).
   - Builds WebSocket URLs as ws(s)://<host>/<path>?access_token=<token>,
     choosing wss when the page is served over https.

The game will be served at <slug>.starhermit.com with /api and /ws proxied
same-origin, so there is no CORS handling and no API-base configuration.
```

## 2. Matchmaking flow

Context page: [games.md](../api/games.md).

```text
Read docs/api/games.md (pasted below). Implement a "Find match" button in
[my lobby screen] that uses the net module's game-path helper:

1. POST /api/v1/games/<slug>/matchmaking.
2. If the response is { status: "matched", sessionId }, navigate straight
   to the session screen for that sessionId.
3. If it is { ticketId, status: "queued" }, show a "searching…" state and
   poll GET /api/v1/games/<slug>/matchmaking every 3 seconds until it
   reports matched, then navigate.
4. A cancel button sends DELETE /api/v1/games/<slug>/matchmaking and
   returns to the idle state. Also cancel on page unload.
5. After 30 seconds still unmatched, reveal a "Play against the AI" button
   that calls POST /api/v1/games/<slug>/sessions/ai, cancels the
   matchmaking ticket, and navigates to the returned sessionId.

Handle 4xx responses by returning to the idle state with an error message.
There is no lobby-creation endpoint — sessions only come from matchmaking,
invite-accept, or sessions/ai — so do not invent one.
```

## 3. Gameplay socket

Context page: [games.md](../api/games.md), [game-scripts.md](../api/game-scripts.md).

```text
Read docs/api/games.md and docs/api/game-scripts.md (pasted below).
Implement a GameController module for [my game screen]:

1. On entering a session, GET /api/v1/games/<slug>/sessions/{sessionId}
   and keep the response (it includes chatConversationId for later).
2. Connect to ws(s)://<host>/ws/v1/games?sessionId=<id>&access_token=<token>.
3. Every frame is a JSON envelope. Outgoing: {"type":"cmd","data":<command>}.
   Incoming: {"type":"game","data":…}, {"type":"error","error":…}, and
   {"type":"presence","userId","online"}.
4. On every socket open, immediately send
   {"type":"cmd","data":{"type":"sync"}} — the server answers with a full
   state broadcast. Never assume local state survives a reconnect.
5. On close, reconnect with exponential backoff starting at 1 second,
   doubling up to a 30-second ceiling, and re-send the sync on each open.
6. Route incoming frames: "game" frames go to a state handler that updates
   the UI, "error" frames to a toast/log, "presence" frames to an
   online/offline indicator for the opponent.
7. Do not put any user id in outgoing commands — the platform passes the
   authenticated sender to the server script; payloads are never trusted
   for identity.

Wire it to [my existing board/UI component] with a minimal render of the
latest state broadcast.
```

## 4. Authoring the server script

Context page: [game-scripts.md](../api/game-scripts.md) — this one is mandatory; the contract lives there.

```text
Read docs/api/game-scripts.md (pasted below) carefully — it defines the
exact script contract. Write server.js for my game, which is [one-paragraph
description of your game's rules]. The script runs in the platform's Jint
host (JavaScript, no Node APIs, no imports, no network, no clock):

1. Expose globalThis.game with createSession, onPlayerMessage, and onTick,
   matching the signatures in game-scripts.md.
2. Determinism: use ONLY ctx.now() for time and ctx.random() for
   randomness. Never use Date, Math.random, or any ambient API.
3. Every handler returns an object shaped per the contract:
   { ok, error, sessionState, playerStates, broadcast, eloUpdates, result }.
   Validate every command against the current state and the sender; reject
   illegal input with { ok: false, error: "…" }.
4. Define the command set the client may send (the "data" of cmd frames)
   and the broadcast set the client will receive. Treat these as the
   client contract and document them in a comment at the top of the file.
5. Maintain a summary object { turnPlayerId, deadline, status, moveCount }
   so the platform's sessions list can show whose turn it is.
6. When the game ends, return a result object (so the platform records a
   replay) and eloUpdates for the rated players.
7. Also expose the pure rules functions as globalThis.[myGame]Rules so the
   browser client can reuse this same file for rendering and replays —
   one file, one source of truth, zero rules authority on the client.
```

## 5. Friend invites

Context page: [friends.md](../api/friends.md), [games.md](../api/games.md).

```text
Read docs/api/friends.md and docs/api/games.md (pasted below). Add an
"Invite a friend" dialog to [my lobby screen]:

1. GET /api/v1/me/friends to list friends — this endpoint is allowed for
   game-scoped tokens. Render nicknames (see the profiles prompt).
2. Selecting a friend sends POST /api/v1/games/<slug>/invites with body
   { "toUserId": "<friend user id>" }. Show "invite sent" state.
3. Poll GET /api/v1/games/<slug>/invites on the lobby screen to show
   incoming invites with accept/decline buttons:
   POST /api/v1/games/<slug>/invites/{id}/accept returns a sessionId —
   navigate to it. POST …/invites/{id}/decline returns 204.
4. On startup, if the launch hash contained &session_id=<guid>, skip the
   lobby and navigate straight to that session — that is how accepted
   invite deep-links arrive.
```

## 6. In-game chat

Context page: [chat.md](../api/chat.md).

```text
Read docs/api/chat.md (pasted below). Add a chat panel to [my game screen]
using the chatConversationId from the session response:

1. Load history with
   GET /api/v1/chat/conversations/{id}/messages?page=1&pageSize=50.
2. Send with POST /api/v1/chat/conversations/{id}/messages and body
   { "content": "<text>" }.
3. Poll the GET endpoint every 5 seconds for new messages. Do NOT use
   the ws/v1/chat socket — it is blocked for game-scoped tokens.
4. The session conversation is type "game" with both players as
   participants, so chat works between non-friends with no extra setup.
5. Render messages with sender nicknames resolved via the profile helper,
   and keep the input disabled while a send is in flight.
```

## 7. Voice chat

Context page: [voice.md](../api/voice.md).

```text
Read docs/api/voice.md (pasted below). Add an opt-in voice toggle (default
OFF) to [my game screen], disabled entirely when the game state marks the
session as an AI game:

1. On enable: GET /api/v1/voice/rooms?conversationId=<chatConversationId>;
   if no room exists, POST /api/v1/voice/rooms with
   { "conversationId": "<chatConversationId>" }. Then
   POST /api/v1/voice/rooms/{roomId}/join.
2. Connect ws(s)://<host>/ws/v1/voice?roomId=<id>&access_token=<token>.
3. Media is WebRTC peer-to-peer with perfect negotiation. Exchange
   signaling over the socket as
   {"type":"rtc","to":<userId>,"payload":{"sdp":…}} and
   {"type":"rtc","to":<userId>,"payload":{"ice":…}}; incoming signaling
   arrives as voice.rtc events.
4. Send {"type":"mute","muted":…} and {"type":"speaking","speaking":…}
   for local state; render voice.roster, voice.participant_joined,
   voice.participant_left, voice.mute_changed, and voice.speaking events
   as the participant list with mute/speaking indicators.
5. If P2P connection fails, fall back to server-relayed opus binary
   frames: [16-byte sender id][audio payload].
6. On disable or leaving the session: close peer connections, leave the
   room, and close the socket.
```

## 8. Leaderboard & stats

Context page: [leaderboards.md](../api/leaderboards.md), [games.md](../api/games.md).

```text
Read docs/api/leaderboards.md (pasted below). Add a leaderboard panel and
a player-stats card to [my lobby screen]:

1. GET /api/v1/games/<slug> and read leaderboardId, plus the me object:
   { userId, elo, wins, losses, draws, activeSessionCount }. Render the
   stats card from me — that is all the stats the game exposes.
2. GET /api/v1/leaderboards/{leaderboardId}/entries?friendsOnly=true&page=1&pageSize=10
   for a friends leaderboard; add a toggle to the same endpoint without
   friendsOnly for the global board, with prev/next paging.
3. Never write scores from the client — entries are published by the
   platform from the server script's eloUpdates. This panel is read-only.
4. Resolve each entry's user id to a nickname via the profile helper.
```

## 9. Replays

Context page: [games.md](../api/games.md).

```text
Read docs/api/games.md (pasted below). Build a replay viewer:

1. List my recent games with GET /api/v1/games/<slug>/replays/mine?limit=10.
2. Opening one calls GET /api/v1/games/<slug>/replays/{sessionId}, which
   returns { sessionId, players, finishedAt, result, state } — the
   shapes of result and state are defined by my game's script.
3. Step through my game's move log from state one move at a time (the
   chess reference implementation stores it at state.game.moves; my
   script defines its own shape), applying each to the shared rules
   module from server.js running
   client-side — the same file the platform executes — so playback can
   never drift from the real rules. Add first/prev/next/last controls and
   auto-play.
4. Show the result block as a header (outcome, reason, and whatever
   else my script's result object carries — the chess reference
   implementation, for example, includes elo before/after).
5. The viewer is entirely local after the initial GET — no per-move
   requests.
```

## 10. Profiles

Context page: [profile.md](../api/profile.md).

```text
Read docs/api/profile.md (pasted below). Add a profile helper module used
everywhere a user id is rendered:

1. GET /api/v1/users/{id}/profile returns { id, username, nickname }.
2. GET /api/v1/users/{id}/avatar returns image/png or 404.
3. Display NICKNAMES, never usernames. If the profile is missing or the
   nickname is empty, fall back to "Player " + id.slice(0, 8).
4. Cache profiles and avatars in memory (and avatars as object URLs) for
   the session so repeated renders of the same opponent don't refetch.
5. Apply the helper everywhere user ids appear: session lists, leaderboard,
   chat messages, replay headers, presence indicators.
```

## 11. Cloud saves (non-scripted / external games)

Context page: [games.md](../api/games.md). Skip this section if your game is fully server-scripted — session state already lives on the platform.

```text
Read docs/api/games.md (pasted below). Add save syncing to [my game],
which runs its own logic client-side:

1. Save: serialize the save slot, zip it, base64-encode it, and
   PUT /api/v1/me/cloud-saves/{gameKey}. The payload must stay ≤ 10 MB.
2. Load: GET /api/v1/me/cloud-saves/{gameKey} on startup; 404 means no
   save yet — start fresh.
3. There is exactly ONE slot per game and writes are last-write-wins.
   Debounce saves (e.g. on meaningful progress and on page hide), and on
   load conflict prefer the remote save unless the user explicitly keeps
   local.
4. Surface sync status (saved / saving / failed) in the UI.
```

## 12. Achievements (catalog titles)

Context page: [achievements.md](../api/achievements.md), [catalog.md](../api/catalog.md). Skip unless your game is distributed through the catalog.

```text
Read docs/api/achievements.md (pasted below). Wire achievements into
[my game]:

1. Unlock with POST /api/v1/me/achievements/unlock at the moment each
   achievement's condition is met; treat "already unlocked" responses as
   success, and queue retries offline if the call fails.
2. List the player's achievements with
   GET /api/v1/me/achievements?titleId=<my title id> and render them in
   [my profile/awards screen], locked vs unlocked.
3. Keep the achievement definitions (ids, names, descriptions) in one
   config module so the unlock call sites stay readable.
```

## 13. The all-together mega-prompt

When you want the assistant to wire the whole flow in one session, use this — but still expect it to work feature-by-feature, and checkpoint (run and verify) after each one:

```text
You are working in my game repository. I am integrating it with the
StarHermit platform. I have pasted four reference pages below:
docs/api/games.md, docs/api/game-scripts.md, docs/api/chat.md, and
docs/api/voice.md. They are the source of truth for every endpoint path
and field name — do not invent API surface beyond them.

Build the complete loop, in this order, stopping for me to verify each
step before continuing:

1. Bootstrap: starhermit.txt manifest (name/slug/launch/owner/server) and
   a net module — read #game_token once and strip it with
   history.replaceState, decode sub + game_scope, same-origin relative
   /api/v1/games/<slug> paths, Authorization headers, 45-minute launch
   token refresh via POST …/launch-token, WS URLs with ?access_token=.
2. Lobby: GET /api/v1/games/<slug> (leaderboardId + me stats),
   GET …/sessions/mine (render myTurn/deadline), friends leaderboard via
   GET /api/v1/leaderboards/{id}/entries?friendsOnly=true, recent replays
   via GET …/replays/mine?limit=10, pending invites via GET …/invites.
3. Matchmaking: POST …/matchmaking, poll GET every 3 s, DELETE to cancel,
   30-second fallback to POST …/sessions/ai.
4. Friend invites: GET /api/v1/me/friends, POST …/invites { toUserId },
   accept/decline, and &session_id= deep-link handling from the launch
   hash.
5. Gameplay: ws(s)://<host>/ws/v1/games?sessionId=…&access_token=… with
   the cmd/sync pattern, 1s→30s exponential-backoff reconnect with re-sync,
   game/error/presence routing.
6. Server script: globalThis.game per game-scripts.md implementing
   [my game's rules], ctx.now/ctx.random only, summary object, result +
   eloUpdates on game end, shared rules exposed client-side.
7. Chat: session conversation via chatConversationId, REST GET/POST
   messages with 5 s polling (ws/v1/chat is blocked for scoped tokens).
8. Voice: opt-in toggle, rooms REST + /ws/v1/voice, WebRTC perfect
   negotiation over rtc messages, mute/speaking, roster events, disabled
   for AI games.
9. Replays: GET …/replays/mine and GET …/replays/{sessionId}, stepped
   locally through the shared rules.
10. Profiles: nickname/avatar resolution with caching and the
    "Player <id8>" fallback, applied everywhere.

Constraints: no build step beyond what this repo already has; no client
rules authority; no score submission from clients; match my existing code
style. After each numbered step, give me a curl command or small test page
to verify it against http://localhost:5000.
```

## Practical tips

- **Keep prompts scoped to one feature.** The mega-prompt works, but one-feature prompts with a verification step between them fail less and are easier to debug when they do.
- **Always hand the AI the exact wiki page.** The prompts reference endpoint paths, but the reference pages carry the field names and error shapes. Paste the page or point the tool at the file — don't paraphrase it from memory.
- **Ask for a verification artifact per feature.** A small throwaway test page or a curl script exercised against a running backend at `http://localhost:5000` (or `5050` in some local setups) catches integration mistakes immediately.
- **Launch tokens expire after 60 minutes.** For local testing, copy the local-dev panel pattern from the reference implementation (`index.html` in the [chess example repo](https://github.com/HypeDriven/starhermit-chess)): a small auth panel that takes a user JWT + slug + optional API base and mints a launch token itself, caching it under its own storage keys (the chess example uses `localStorage['chess.apiBase']` and `sessionStorage['chess.gameToken']` — substitute your own slug). It saves you from re-minting tokens through the launcher on every test run.
- **Refresh cadence matters.** If your test sessions run long, make sure the 45-minute refresh is actually wired before you blame the backend for 401s.

For the narrative version of how these pieces fit together in a shipped game, see the [chess walkthrough](chess-walkthrough.md) — the reference example; for first deploy, the [getting started guide](../getting-started.md).
