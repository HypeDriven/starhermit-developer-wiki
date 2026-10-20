# StarHermit engine releases

The StarHermit engine — the runtime that plays [script games](tutorials/starhermit-engine.md) — is
published on this wiki as versioned, immutable releases under
[wiki.starhermit.com/engine/](../engine/). Games pin one release exactly with `engine.version` in
their [`starhermit.txt`](starhermit-txt.md); a game's page loads the release's web runtime from
here in the browser, the StarHermit Windows client installs the release's native runtime and plays
the game on it, and developers download a release's runtime from here to build with.

## Versions

A release is `X.Y.Z`. `X` is the **host API's major version**, the `engine.api` a game declares, so
every 1.x.x release runs `engine.api=1` games; the release also records the host API's minor version,
which grows as members are added (a game can require one with `engine.minor`). A published release
never changes: a fix is the next version.

| Release | Host API | Runtimes | Developer download |
|---|---|---|---|
| 1.1.0 | 1.4 | Web; Windows (x86-64) | [starhermit-1.1.0-windows-x86_64.zip](../engine/1.1.0/native/windows-x86_64/starhermit-1.1.0-windows-x86_64.zip) |
| 1.0.0 | 1.4 | Windows (x86-64); no web runtime | [starhermit-1.0.0-windows-x86_64.zip](../engine/1.0.0/native/windows-x86_64/starhermit-1.0.0-windows-x86_64.zip) |

[versions.json](../engine/versions.json) is the authoritative list, newest first, and the engine
area's own page lists the same.

## The engine area

```text
engine/
  versions.json            every release: host API, date, runtimes, revocation
  X.Y.Z/
    native/windows-x86_64/
      native.json          the Windows runtime's files, each with its size, SHA-256 and chunks
      starhermit-X.Y.Z-windows-x86_64.zip
                           the developer download: the same files as one archive
    manifest.json          the web runtime's files, each with its size and sha384
    starhermit.js          the module a game's loader page loads
    starhermit.wasm, *.js  the runtime, its audio mixer and worklets
    starhermit.d.ts        the host API's declarations
    fonts/, licenses/      the runtime's fonts and every licence notice
                           (all of the web runtime only in a release that has one)
  chunks/ab/<sha256>.z     pieces of the native files, shared by every release
  patches/ab/<sha256>.p    binary patches from earlier releases' files
```

Every file is published as it is (no file name starts with `_` or `.`), and GitHub Pages serves it
with `Access-Control-Allow-Origin: *`.

### versions.json

```json
{
  "format": 2,
  "versions": [
    {
      "api": {"major": 1, "minor": 4},
      "date": "2026-10-20T13:55:50Z",
      "native": {
        "windows-x86_64": {"manifest": "1.1.0/native/windows-x86_64/native.json", "sha256": "<SHA-256 of native.json>"}
      },
      "revoked": false,
      "version": "1.1.0",
      "web": {"manifest": "sha384-<SRI hash of manifest.json>"}
    }
  ]
}
```

`web` is `{"manifest": "sha384-…"}`, the SRI hash of the release's web `manifest.json`, or `null` for
a release without a web runtime. `native` pins each platform's `native.json` by its SHA-256. A
release withdrawn because it is unsafe says `"revoked": true` with a `"revokedReason"`; that is the
only change a published entry ever takes.

### native.json

`native.json` lists the files of the engine folder a client installs — `starhermit.exe`,
`release.json` (the release's version, host API and the `launcher` protocol its runtime speaks),
`LICENSE-engine` and the third-party notices — each with its `size`, `sha256` and `chunks`. A chunk
is a stretch of a file, stored zlib-compressed as `chunks/<first two hex digits>/<sha256>.z` and named
by the SHA-256 of its uncompressed bytes; chunk boundaries follow the content, so an unchanged
stretch keeps its chunk from one release to the next. Where it is smaller, a file also lists
`patches` from the same file of earlier releases (`"from"`: the SHA-256 of the earlier file).
`downloads` lists the developer download with its `size` and `sha256`; clients never install it.
In a release with a web runtime the native folder also holds `web-manifest.json`, the release's web
manifest, so the developer download packages games for the web without a network.

### The web runtime

A release's web runtime is the files beside its `manifest.json`, which lists each with its `size` and
`sha384` and records the release's version, host API and build. A game's loader page (`index.html`,
written by `starhermit package --web`) has no script of its own: it loads `starhermit.js` and
`manifest.json` from `https://wiki.starhermit.com/engine/X.Y.Z/` with SRI hashes, and the engine
fetches every other file it needs (`starhermit.wasm`, the audio worklets, the fonts) and checks it
against the manifest. The page runs only the engine — input, the runtime's menus, audio, storage, the
platform session and voice — and the game's TypeScript runs in a worker it starts and can stop.

The web runtime bundles its own fonts, Liberation 2.1.5 (SIL Open Font License 1.1) and DejaVu Sans
2.37 (Bitstream Vera and Arev licences); their notices are in `licenses/` with the others.

## Integrity

One chain of hashes covers every byte a client runs:

1. `versions.json` (or the platform's API below) gives the SHA-256 of a release's `native.json`.
2. `native.json` gives every file's SHA-256 and every chunk's.
3. The client fetches only the chunks it does not already hold, checks each one's stored size,
   inflated size and SHA-256, puts each file together, checks the file's SHA-256 and only then moves
   the release into place. A patch is checked against its own SHA-256, and the patched file against
   the file's; any failure falls back to the chunks.

The developer download is covered by the same chain through its entry in `downloads`. A browser
game's loader page pins the web runtime's `starhermit.js` and `manifest.json` with SRI hashes, and
the runtime checks every other file it loads against the manifest.

## The engine releases API

The platform serves the same list, with every URL on this wiki, so clients ask the API which engine
to fetch:

`GET /api/v1/engine/releases` → every release, newest first:

```json
{"releases": [{
  "version": "1.1.0", "api": {"major": 1, "minor": 4}, "revoked": false, "date": "2026-10-20T13:55:50Z",
  "web": {"base": "https://wiki.starhermit.com/engine/1.1.0/", "manifestIntegrity": "sha384-<SRI hash>"},
  "native": {"windows-x86_64": {
    "manifestUrl": "https://wiki.starhermit.com/engine/1.1.0/native/windows-x86_64/native.json",
    "manifestSha256": "<SHA-256 of native.json>"}}
}]}
```

`GET /api/v1/engine/releases/{version}` → one release, or `404` when it is not listed. Both are
anonymous and cacheable (`Cache-Control: public, max-age=60` with an `ETag`). A revoked release
carries `revokedReason`; `web` is `null` for a release without a web runtime.
While the platform has never read the list (the wiki unreachable since it started) they answer
`503` with `Retry-After`.

## Script games on the platform

When a game's root `starhermit.txt` declares `engine.version`, the platform treats it as a script
game:

- each publish records the release the files pin, as `hosting.engineVersion`, and sets
  `hosting.deployWarning` (also in a bundle push's answer) when that release is not listed or is
  revoked. A warning never stops a publish.
- every page of the hosted game is served with a Content-Security-Policy that admits scripts only
  from this wiki (and the engine's own `blob:` workers), so the only code a script game's page can
  run is the official engine:

```text
default-src 'self'; script-src https://wiki.starhermit.com 'wasm-unsafe-eval' blob:; worker-src blob:;
connect-src 'self' https://wiki.starhermit.com; img-src 'self' blob: data:; media-src 'self' blob:;
style-src 'self' 'unsafe-inline'; font-src 'self' https://wiki.starhermit.com;
frame-ancestors https://dashboard.starhermit.com; base-uri 'self'; form-action 'none'
```

A page of a script game without a browser build (such as the plain page a Windows-only game uploads
for browsers) needs no script and is unaffected.

## Revocations

A revoked release stays listed so that clients can say why they refuse it: the StarHermit client does
not install or start it and tells the player, the packaging commands refuse to package a game for it
when they read `versions.json`, and the platform warns the owners of games that pin it when they
publish. Re-pin to the release that replaces it and publish again
(see [Move to a newer engine](tutorials/starhermit-engine.md#9-move-to-a-newer-engine)).
