# StarHermit developer wiki — running specification

> **This is the running specification: it describes what this documentation set covers today.** It is
> loaded into every Claude Code session at start. Any task that changes the docs must update this
> document in the same change — see [Keeping this document current](#keeping-this-document-current).

The public developer documentation for the StarHermit platform, served at **wiki.starhermit.com**
(GitHub Pages over this repo; `CNAME` carries the hostname, and Jekyll's default conversion is what
turns `docs/x.md` into `/docs/x.html`). The site serves Markdown and static assets without an application build. `_config.yml` applies the
shared `_layouts/wiki.html` layout with a dark-by-default granite palette, an optional persisted light
mode, responsive navigation, and a generated page outline. CSS and JavaScript live under `assets/`;
relative Markdown links are converted by `jekyll-relative-links`. Static accessible SVG diagrams in
`docs/images/` illustrate integration choices, hosted-game sign-in, cloud-save concurrency, multiplayer
routing, client publication, session lifecycle, and game language settings, and remain viewable in source Markdown. `npm test` validates
document links, API contracts, helpers and examples; `npm run test:browser` checks the runnable
quickstart. Pushing the repository publishes it through GitHub Pages.

The header language dropdown covers English plus Simplified Chinese (Mandarin), Hindi, Spanish,
Modern Standard Arabic, French, Bengali, Portuguese, Indonesian, and Urdu, selected by total first-
and second-language speakers in the Ethnologue 2026 ranking. Local SVG country flags under
`assets/flags/` accompany native language labels in a keyboard-accessible disclosure dropdown,
which also works without JavaScript. Flags render as images rather than relying on emoji fonts.
English remains at its existing URLs;
the nine other locales have static pages at `/<language>/` and `/<language>/docs/...html`, generated
under `l10n/`. All 48 public documents, navigation labels, accessibility labels, and seven SVG diagrams
are translated. Arabic and Urdu use right-to-left layouts; code remains left-to-right. Heading IDs,
code examples, API identifiers, downloadable examples, and contracts retain their original values.
Links and the language selector keep readers on the corresponding page and preserve section anchors.
The selected language persists; revisiting the English landing page restores it, while deep links
retain their explicit language. Static links also support readers without JavaScript.

Translations are labeled as machine translations and link to the English original. `_data/localization-overrides.json`
contains reviewed interface and terminology overrides. `_data/locales.json`
holds locale/UI strings, and `_data/localization.json` tracks English source hashes and the ranking
source. `npm run localize` regenerates HTML/SVG offline from the committed translation cache;
`npm run localize:refresh` sends changed public prose to Google Translate and refreshes the cache.
Code is excluded from translation. `npm test` checks complete coverage, source freshness, unchanged
code/anchors, and localized links; `npm run test:wiki` checks the responsive language selector and RTL.

It documents the *public contract* of `../starhermit`: an integration guide for **any** game or external
client targeting the platform, not a description of the backend's internals. The reference example used
throughout is `HypeDriven/starhermit-chess` (`../starhermit-chess`) — one concrete implementation of the
patterns, not the subject of the docs.

## Structure

- `README.md` — the landing page: what StarHermit is, where to start, and the API-reference index table.
- `docs/choosing-an-integration.md`, `docs/credentials.md`, `docs/troubleshooting.md`,
  `docs/session-lifecycle.md`, and `docs/availability.md` — architecture choices, credential/identifier
  compatibility, symptom-based recovery, session membership and retention (with a static accessible SVG diagram),
  and service availability/trust.
- `docs/api/conventions.md` and `docs/api/contracts.md` — shared HTTP, timestamp, pagination, update
  and retry rules, plus the public machine-readable contract downloads under `docs/contracts/`.
  The OpenAPI file indexes public developer REST routes, request models and success shapes,
  keeping reserved generation routes explicitly unavailable. JSON Schema definitions cover socket
  text frames; binary layouts distinguish participant and user prefixes and container headers.
- `docs/examples/browser-quickstart/` and its ZIP — complete no-build game with account sign-in,
  explicit terms consent, validated conditional cloud saves and untracked in-memory single-player play.
  `scripts/build-quickstart.py` refreshes its vendored helpers and deterministic archive.
- `docs/tutorials/starhermit-engine.md` and `docs/engine-releases.md` — the StarHermit engine for script
  games, recommended for publishing on StarHermit: one package for browser and native play across
  supported platforms, with additional native performance and features and release-specific runtime
  availability. The tutorial builds a small TypeScript game (scene, input, HUD, storage) step by step: what a
  script game is, getting the engine (the client installs releases; developers download a release's
  Windows, Linux or macOS runtime from `engine/`), `starhermit new`/`types`/`check` and TypeScript checking, running
  natively, per-entity work with `starhermit:world` tables, kernels and bindings, the platform (sign-in
  from the client, `--game <id>` development launches, saves, online play with `server=`), publishing
  (`starhermit package --web --out` for the loader page and file index, `--native` for a client-only game,
  development files left out and `.starhermitignore`, folder upload or repository, the page's script lock),
  re-pinning and revocations, limits by phase, native and browser differences, and the licence.
  The reference page has per-release notes and covers `engine/` (versions.json format 2, native.json, chunks and patches, the
  developer download, the web runtime with its loader and bundled fonts), the integrity chain, `GET /api/v1/engine/releases`, and what the platform does
  for a game that declares `engine.version` (deploy record and warning, Content-Security-Policy).
- `docs/native-performance.md` — native performance guidance for engine games: JavaScript on the engine's
  JIT-free interpreter versus V8, WebAssembly speed and platform ahead-of-time compilation (engine 1.26.1), where heavy
  per-frame work belongs (`runtime()`, workers), GPU-bound scenes, workers' lifetime and measuring. The
  engine session keeps its figures current.
- `engine/tools/README.md` — standalone developer-tool downloads and guide for macOS
  (Apple Silicon and Intel), Linux and Windows: package validation, web/native packaging,
  automated publishing with the developer’s own credentials, and stdio development MCP.
  Immutable archives and checksums live under `engine/tools/<version>/`; `latest.json`
  lists reviewed downloads. These releases are independent of pinned game runtimes.
  Native runtimes, macOS included from engine 1.26.2, come from engine releases rather than the
  tools, and MCP never publishes.
- `engine/` — the engine area, written only by the engine's `cargo starhermit release` (never by hand):
  `versions.json`, one immutable directory per release (`<version>/native/windows-x86_64/native.json`
  and the developer download `starhermit-<version>-windows-x86_64.zip`; a web runtime's files in a
  release that has one), the shared content-addressed `chunks/` (and `patches/`), and a README that
  renders as `/engine/`. Its files are published verbatim (no `_`/`.` names, no front matter but the
  README's) and it is not translated; release 1.0.0 is Windows-only, 1.1.0 has the web runtime and
  Windows.
- `docs/starhermit-txt.md` — the manifest every published game needs (including `control.*` declarations), where it must sit in the uploaded
  folder, and why that folder should be the distributable build (everything beside the manifest is
  uploaded and served). It also documents matchmaking start deadlines, AI-seat limits and empty-seat behavior,
  folder cache lifetimes, exact additional CORS origins, how upload modes replace or preserve hosting policies, and the
  `engine.*` keys of a StarHermit engine game.
- `docs/getting-started.md` — base URLs, versioning, the auth model (including WebSocket connection
  tickets), recommended account/untracked entry options, and the ways to integrate: a platform game published from GitHub or uploaded as a folder,
  with an optional script or container server, or an external client calling the REST/WS API directly.
- `docs/api/*.md` — one page per area: `auth`, `games`, `game-scripts`, `container-games`, `profile`,
  `friends`, `chat`, `voice`, `catalog`, `activity`, `achievements`, `leaderboards`,
  `external-libraries`, `relay`, `realtime`, `github-games`, `publisher`, `moderation` (shared content hashes, checks and availability, screened evidence, owner review,
  withdrawal recovery and production readiness), `reports` (player crash and
  bug reports: filing with a launch token, owner triage, attachments and limits), `plucks` (the PLK
  currency: sourced history, access and item sales, player-confirmed orders, revenue) and
  `game-links` (approved external links: declarations, URL rules, review, the runtime check). The
  container-games page also covers the owner's server logs and crash records.
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
  REST/WebSocket enforcement and recovery examples, including explicit consent through a player launch token. Getting started, authentication and the
  onboarding/CI tutorials explain how acceptance affects their flows. Realtime rooms covers
  human-party matchmaking with deadline starts; matchmaking and container pages state the
  current container queue limitation, and catalog/publisher pages identify the preview distribution limitations without internal pipeline detail. The walkthrough and AI prompts support direct sign-in, bounded token renewal
  and the current script context contract.
- `docs/sdk/*.md` — one page per maintained client SDK: `unity` (the `com.starhermit.sdk` Unity package —
  install, client construction, credentials, a map from each API page to its typed service, sockets,
  errors and retries, credential storage, and forward compatibility, including a current-terms
  example using raw JSON with the existing acceptance method), and `javascript` (the single-file browser client
  `docs/sdk/starhermit-sdk.js`, shipped beside its page: loading and `init`, sign-in and identity, cloud saves
  with the load-before-save rule and the failed-read write block, settings and controls, multiplayer/social
  calls (pointing at the graphics-options tutorial for a Graphics menu), serialized control updates, correctly marked realtime inputs, REST checks before reconnect, stopping
  on policy closes, and single-player leaderboards through the shipped `docs/sdk/score-script.js` and `submitScores`, reconnecting sockets — renew the launch token before every reconnect, and relaunch once renewal is
  refused — events, and keeping a vendored copy current). These pages describe how to reach
  the documented API from an engine; they do not restate the API itself.
- `docs/sdk/cloud-save-store.js` — the standalone raw-JSON save recipe: validates before adoption,
  conditional writes, read/conflict failure blocks, and ambiguous-write recovery.
- `docs/tutorials/game-localization.md` — the recommended ten-language game localization policy;
  native labels and local SVG flags, a Language section alongside Graphics/Audio/Controls, Automatic
  versus explicit selection, translation packs/fallbacks, RTL/shaping, and `ui.language` per-player
  settings with error-aware reads/writes. Covers the read-only platform language endpoint for games,
  dashboard profile get/set access, and account preference before device fallback in Automatic mode.
  Includes a settings-menu SVG and browser UI/API examples.
- `docs/tutorials/*.md` — `browser-quickstart` (download, local play, publication, account and untracked
  entry paths, terms and conflict checks), `cloud-save-sync` (format validation/migration, ETags,
  conflicts, quotas, checkpoints and page-exit limits), `chess-walkthrough` (the full lifecycle from launch token to replay viewer),
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
  `docs/sdk/graphics-options.js` module: a 0–20 hardware level from the reported GPU — a Galaxy S20 or
  weaker at 0, an RTX 5090 at 20, about 23% per level; Safari's masked "Apple GPU" is estimated from
  screen size or ASTC support — that picks the Auto preset, a runtime step-down, per-effect
  overrides, adaptive resolution, automatic display-refresh rendering (half the refresh rate on phones
  and tablets) or a persistent manual maximum FPS
  with a render-loop pacing hook, a ready-made panel, `localStorage` plus per-player-settings persistence keyed
  by GPU identity, restoring that GPU's choices on return and using defaults for an unseen GPU,
  and a three.js renderer wiring example), `audio-options` (baseline volume and opt-in voice controls,
  device/CPU/memory-aware Auto concurrent-sound recommendations (16 on phones and tablets), bounded playback across all buses,
  microphone lifecycle and settings persistence; ships pure `docs/sdk/audio-options.js` helpers with
  validation/detection tests), and `claim-existing-game` (prove repository control and take over
  an existing listing).

Conventions the pages share and state: REST under `api/v1/...` at `https://api.starhermit.com`,
WebSockets under `ws/v1/...`, JWT bearer auth with `?access_token=` allowed on `/ws/**`, camelCase JSON,
and defensive parsing of JSON, plain-text, empty and validation-problem error responses.
The public pages describe client-visible behavior, limits and recovery actions, not deployment internals.

Maintenance scripts regenerate the distributable example and REST contract from a supplied source
checkout plus reviewed response overrides. Tests validate contracts, links, example assets, public-key signing bytes and device-key examples,
  and SDK behavior; source comparison can additionally verify the public operation inventory when available.

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
