# StarHermit developer wiki — running specification

> **This is the running specification: it describes what this documentation set covers today.** It is
> loaded into every Claude Code session at start. Any task that changes the docs must update this
> document in the same change — see [Keeping this document current](#keeping-this-document-current).

The public developer documentation for the StarHermit platform, served at **wiki.starhermit.com**
(GitHub Pages over this repo; `CNAME` carries the hostname, and Jekyll's default conversion is what
turns `docs/x.md` into `/docs/x.html`). No build step, no site config, no CI — pushing markdown
publishes it.

It documents the *public contract* of `../starhermit`: an integration guide for **any** game or external
client targeting the platform, not a description of the backend's internals. The reference example used
throughout is `HypeDriven/starhermit-chess` (`../starhermit-chess`) — one concrete implementation of the
patterns, not the subject of the docs.

## Structure

- `README.md` — the landing page: what StarHermit is, where to start, and the API-reference index table.
- `docs/starhermit-txt.md` — the manifest every published game needs (including `control.*` declarations), where it must sit in the uploaded
  folder, and why that folder should be the distributable build (everything beside the manifest is
  uploaded and served). It also documents matchmaking start deadlines, AI-seat limits and empty-seat behavior,
  folder cache lifetimes, exact additional CORS origins, and how upload modes replace or preserve hosting policies.
- `docs/getting-started.md` — base URLs, versioning, the auth model (including WebSocket connection
  tickets), and the ways to integrate: a platform game published from GitHub or uploaded as a folder,
  with an optional script or container server, or an external client calling the REST/WS API directly.
- `docs/api/*.md` — one page per area: `auth`, `games`, `game-scripts`, `container-games`, `profile`,
  `friends`, `chat`, `voice`, `catalog`, `activity`, `achievements`, `leaderboards`,
  `external-libraries`, `relay`, `realtime`, `github-games`, `publisher`.
  The games page has a Limits section: `ws/v1/games` frame size, connection and message-rate
  limits (realtime inputs vs durable commands, container relay), and the elo rules (absolute
  ratings, no platform cap per match, participants only, owner reset); it also documents share
  links' pass-through query string. Leaderboards covers reset schedules and the owner's
  per-player rating reset; realtime covers the backfill allowance, quick-join filters and join in progress.
  The achievements, leaderboards, game-scripts, container-games, github-games and publisher pages
  all state that a game's owner is its publisher for leaderboards and achievements, and that only
  the game's server writes to them.
  The catalog page covers saving to Cloud Saves from inside a game with its launch token (its own
  `game:<id>` slot, separate from the desktop client's save-folder slot), and the auth page lists it in the fence.
  The authentication page includes direct-browser game sign-in: a provider chooser, return URL
  validation, game-scoped token handling and a copyable Sign in button example.
  The profile page documents current-terms discovery, explicit acceptance, account status fields,
  REST/WebSocket enforcement and recovery examples. Getting started, authentication and the
  onboarding/CI tutorials explain how acceptance affects their flows. Realtime rooms covers
  human-party matchmaking with deadline starts; matchmaking and container pages state the
  current container queue limitation, and catalog/publisher pages identify the mock storage and
  processing pipeline. The walkthrough and AI prompts support direct sign-in, bounded token renewal
  and the current script context contract.
- `docs/sdk/*.md` — one page per maintained client SDK: `unity` (the `com.starhermit.sdk` Unity package —
  install, client construction, credentials, a map from each API page to its typed service, sockets,
  errors and retries, credential storage, and forward compatibility, including a current-terms
  example using raw JSON with the existing acceptance method), and `javascript` (the single-file browser client
  `docs/sdk/starhermit-sdk.js`, shipped beside its page: loading and `init`, sign-in and identity, cloud saves
  with the load-before-save rule and the failed-read write block, settings and controls, multiplayer/social
  calls (pointing at the graphics-options tutorial for a Graphics menu), single-player leaderboards through the shipped `docs/sdk/score-script.js` and `submitScores`, reconnecting sockets — renew the launch token before every reconnect, and relaunch once renewal is
  refused — events, and keeping a vendored copy current). These pages describe how to reach
  the documented API from an engine; they do not restate the API itself.
- `docs/tutorials/*.md` — `chess-walkthrough` (the full lifecycle from launch token to replay viewer),
  `ai-prompts` (copy-pasteable prompts for an AI coding assistant, one per feature plus a mega-prompt),
  `dedicated-server-onboarding` (push a container bundle, renew its server token, onboard
  Steam/Epic/GOG/native players via public-key registration without OAuth), `public-key-onboarding`
  (the full key-only account flow for a native client: key formats per type, registration and its
  24-hour throttles, the exact challenge bytes to sign, polling sign-in until the emailed link is
  opened, refresh, terms and nickname, second devices, emailed revoke-all, and the OAuth-only limits;
  its `js` blocks concatenate into one tested module), `ci-cd-build-upload`
  (enrol a labelled machine key from an OAuth session, authenticate a pipeline by signed challenge
  with the server’s exact JSON escaping (including Base64 nonce plus signs),
  and upload client or container builds over HTTP/WebSocket), `kart-racer` (a multiplayer racing game
  on realtime rooms: host-routed binary netcode with host migration, plus a server-authoritative
  script variant with matchmaking and client-side prediction), `persistent-sessions` (opt a script or
  container game into sessions that pause when empty and resume on join, game time via `ctx.pausedMs`,
  the client rejoin/retry flow, and ending a world), `game-leaderboards-achievements` (a game's owner
  as its publisher: creating game-scoped leaderboards and achievements through
  `/me/github-games/{id}/…`, posting `scores` and unlocking from a script or container, reading them
  in the client with a launch token, and retiring/season-rolling boards), `game-controls` (declaring
  `control.*` actions, publishing them on each publish path, verifying, a client input map and
  rebinding screen, and a troubleshooting table for the controls API's 404/400s), `graphics-options` (the shipped
  `docs/sdk/graphics-options.js` module: hardware-detected Auto preset with a runtime step-down, per-effect
  overrides, adaptive resolution, a ready-made panel, `localStorage` plus per-player-settings persistence keyed
  by device kind and detected preset, and a three.js renderer wiring example), and `claim-existing-game` (prove repository control and take over
  an existing listing).

Conventions the pages share and state: REST under `api/v1/...` at `https://api.starhermit.com`,
WebSockets under `ws/v1/...`, JWT bearer auth with `?access_token=` allowed on `/ws/**`, camelCase JSON,
and errors as `{"error":"..."}`.

## What this documentation is for

The platform's convention is that **features ship documented**: a change to the public surface in
`../starhermit` is expected to land with the matching page here. That makes this repo the outward-facing
half of the platform's contract, and the reason sibling game projects (`../crown-and-chasm`,
`../starhermit-football`, `../starhermit-poker`) read `docs/api/*` locally rather than fetching the live
site.

## Keeping this document current

**Every task that changes the documentation set updates this file as part of the same change** — a new or
removed page, a retitled area, a change to how the site is published. A change is not done until the
spec matches it.

1. This file describes the *shape* of the documentation. The API detail lives in the pages themselves;
   don't mirror it here.
2. The pages must describe the platform as it actually behaves. When a page changes because the platform
   changed, check `../starhermit/spec.md` says the same thing — and when the platform changes first, the
   matching page here is part of that work, not a follow-up.
3. Edit in place, don't append a changelog; delete what stopped being true.
