# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The **public developer documentation for the StarHermit platform**, served at wiki.starhermit.com by GitHub
Pages over this repo (`CNAME`; Jekyll converts `docs/x.md` to `/docs/x.html`). `_config.yml`
applies the shared granite layout in `_layouts/wiki.html`, with CSS/JS under `assets/`.
No application build or CI — pushing the repository publishes it.

English Markdown is the source of truth. Nine static machine-translated locales live under `l10n/`,
with UI data in `_data/locales.json` and localized SVGs in `docs/images/<language>/`. After changing
public prose, run `npm run localize:refresh` (sends prose to Google Translate); use `npm run localize`
for offline regeneration from `scripts/localization-cache.json`. Do not edit generated pages directly.

It documents the *public contract* of `../starhermit` as an integration guide for any game or external
client. `../starhermit-chess` is the reference example used throughout; it is an illustration, not the
subject.

`spec.md` at the repo root is the **running specification** — the shape of the documentation set (pages,
tutorials, shared conventions). A SessionStart hook loads it into every session here.

## `spec.md` is part of every change

**Every task that changes the documentation set updates `spec.md` in the same change** — a new or removed
page, a retitled area, a change to how the site is published. A change is not done until the spec matches
it. The API detail belongs in the pages themselves, not in `spec.md`.

## Working rules

- **Document what the platform actually does.** When a page changes because the platform changed, check
  `../starhermit/spec.md` says the same thing. When the platform changes first, the matching page here is
  part of that work, not a follow-up — the platform's convention is that features ship documented.
- Keep the shared conventions accurate on every page: REST under `api/v1/...` at
  `https://api.starhermit.com`, WebSockets under `ws/v1/...`, JWT bearer with `?access_token=` allowed on
  `/ws/**`, camelCase JSON, errors as `{"error":"..."}`.
- Sibling game projects read `docs/api/*` from this checkout rather than fetching the live site, so a local
  edit is immediately load-bearing for them.
- Update `README.md`'s reference table whenever a page is added, removed or repurposed; it is the landing
  page's index.
