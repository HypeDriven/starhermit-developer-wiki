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
- `docs/starhermit-txt.md` — the manifest every published game needs, where it must sit in the uploaded
  folder, and why that folder should be the distributable build (everything beside the manifest is
  uploaded and served).
- `docs/getting-started.md` — base URLs, versioning, the auth model, and the ways to integrate: a
  platform game published from GitHub or uploaded as a folder, with an optional script or container
  server, or an external client calling the REST/WS API directly.
- `docs/api/*.md` — one page per area: `auth`, `games`, `game-scripts`, `container-games`, `profile`,
  `friends`, `chat`, `voice`, `catalog`, `activity`, `achievements`, `leaderboards`,
  `external-libraries`, `relay`, `realtime`, `github-games`, `publisher`.
- `docs/tutorials/*.md` — `chess-walkthrough` (the full lifecycle from launch token to replay viewer),
  `ai-prompts` (copy-pasteable prompts for an AI coding assistant, one per feature plus a mega-prompt),
  `dedicated-server-onboarding` (push a container bundle, renew its server token, onboard
  Steam/Epic/GOG/native players via public-key registration without OAuth), `ci-cd-build-upload`
  (enrol a labelled machine key from an OAuth session, authenticate a pipeline by signed challenge,
  and upload client or container builds over HTTP/WebSocket), and `claim-existing-game` (prove
  repository control and take over an existing listing).

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
