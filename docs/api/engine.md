# Engine

Where to get the StarHermit engine, the runtime that plays [script games](../tutorials/starhermit-engine.md).
The platform API is the place to find releases: it lists every release, says which are revoked, and
gives the URLs and hashes of each release's files. Reads are anonymous.

Base URL: `https://api.starhermit.com`. All routes are under `/api/v1/...`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/engine/releases` | Anonymous | Every release, newest version first, revoked ones included |
| GET | `/api/v1/engine/releases/{version}` | Anonymous | One release by its exact version (`X.Y.Z`), or `404` |

```json
{"releases": [{
  "version": "1.41.0", "api": {"major": 1, "minor": 41}, "revoked": false, "date": "2026-11-13T18:26:01Z",
  "web": {"base": "https://wiki.starhermit.com/engine/1.41.0/", "manifestIntegrity": "sha384-<SRI hash>"},
  "native": {"linux-x86_64": {
    "manifestUrl": "https://wiki.starhermit.com/engine/1.41.0/native/linux-x86_64/native.json",
    "manifestSha256": "<SHA-256 of native.json>"}}
}]}
```

`GET /api/v1/engine/releases/{version}` answers one such object without the `releases` wrapper.
URLs point at `wiki.starhermit.com` for recent releases and at `engine.starhermit.com` for older ones;
use them as given.

- `api` is the host API the release offers. Its major is the release's major and the `engine.api` a
  game declares; its minor grows as members are added (a game can require one with `engine.minor`).
- `revoked: true` comes with a `revokedReason`. A revoked release stays listed so clients can say why
  they refuse it.
- `web` is `null` for a release without a web runtime. `manifestIntegrity` is the SRI hash of the web
  runtime's `manifest.json`, the value a loader page pins.
- `native` has one entry per platform (`windows-x86_64`, `linux-x86_64`, `macos-x86_64`,
  `macos-aarch64`), or is `{}`. `manifestSha256` is the hex SHA-256 of that platform's `native.json`;
  check it before trusting the file list inside.

Both routes send `Cache-Control: public, max-age=60` with an `ETag` and answer `304` to a matching
`If-None-Match`. If the platform has not yet read the release list since it started, they answer
`503` with `Retry-After`.

A published release never changes: a fix is the next version. The engine
[tutorial](../tutorials/starhermit-engine.md) describes the newest release; this API says which one
that is.

## Download the engine

Developers download a release's native runtime to write, check, package and play games. Players do
nothing: the StarHermit client and a game's page fetch the release the game pins.

1. Ask the API for the release, the newest or the one your game pins:

   ```sh
   curl -s https://api.starhermit.com/api/v1/engine/releases/1.41.0
   ```

2. Take your platform's `native.<platform>.manifestUrl`, fetch that `native.json` and check its
   SHA-256 against `manifestSha256`.
3. `native.json`'s `downloads` names the developer download with its `size` and `sha256`. The archive
   sits next to `native.json`: replace `native.json` at the end of `manifestUrl` with the archive's
   name. Download it and check its SHA-256.

The same steps as one script (needs `curl`, `jq` and `sha256sum`; on macOS use `shasum -a 256`):

```sh
version=1.41.0 platform=linux-x86_64   # or windows-x86_64, macos-x86_64, macos-aarch64
release=$(curl -fsS "https://api.starhermit.com/api/v1/engine/releases/$version")
manifest_url=$(jq -r --arg p "$platform" '.native[$p].manifestUrl' <<<"$release")
manifest_sha=$(jq -r --arg p "$platform" '.native[$p].manifestSha256' <<<"$release")
curl -fsSO "$manifest_url"
echo "$manifest_sha  native.json" | sha256sum -c -
archive=$(jq -r '.downloads | keys[0]' native.json)
curl -fsSO "${manifest_url%native.json}$archive"
echo "$(jq -r --arg a "$archive" '.downloads[$a].sha256' native.json)  $archive" | sha256sum -c -
```

In PowerShell, `Invoke-RestMethod` reads the release and `Get-FileHash -Algorithm SHA256` gives the
hash to compare. The [tutorial](../tutorials/starhermit-engine.md#2-get-the-engine) covers unpacking
and the first run.

The [standalone developer tools](../../engine/tools/README.md) (automated publishing and a
development MCP server) are released separately from the runtime.

## Integrity

One chain of hashes covers every byte a client runs:

1. The API gives the SHA-256 of a release's `native.json`.
2. `native.json` gives every file's SHA-256 and size, and its developer download's under `downloads`.
3. The StarHermit client fetches only the pieces of a release it does not already hold, checks each,
   puts every file together and checks it before moving the release into place.

A browser game's loader page pins the web runtime's `starhermit.js` and `manifest.json` with SRI
hashes, and the runtime checks every other file it loads against the manifest.

## The web runtime

A game's loader page (`index.html`, written by `starhermit package --web`) loads `starhermit.js` and
`manifest.json` from `https://engine.starhermit.com/engine/X.Y.Z/`, with the same SRI hashes as the
URLs under `web.base`. Use `engine.starhermit.com` in any loader page you write yourself: it keeps
every release, while the URLs under `web.base` hold only recent ones and an old release disappears
from them. Tools from 1.26.0 write `engine.starhermit.com` by default (`--loader-base URL` or
`STARHERMIT_WEB_LOADER_BASE` overrides it). For a hosted game packaged by older tools, the platform
rewrites the two engine URLs when the release is no longer under `web.base`; repackage games hosted
elsewhere. A revoked release is not served from either origin.

## Script games on the platform

When a game's root [`starhermit.txt`](../starhermit-txt.md) declares `engine.version`, the platform
treats it as a script game:

- each publish records the release the files pin, as `hosting.engineVersion`, and sets
  `hosting.deployWarning` (also in a bundle push's answer) when that release is not listed or is
  revoked. A warning never stops a publish.
- every page of the hosted game is served with a Content-Security-Policy that admits scripts only
  from the two engine origins (and the engine's own `blob:` workers), so the only code a script
  game's page can run is the official engine:

```text
default-src 'self'; script-src https://wiki.starhermit.com https://engine.starhermit.com 'wasm-unsafe-eval' blob:; worker-src blob:;
connect-src 'self' https://wiki.starhermit.com https://engine.starhermit.com; img-src 'self' blob: data:; media-src 'self' blob:;
style-src 'self' 'unsafe-inline'; font-src 'self' https://wiki.starhermit.com https://engine.starhermit.com;
frame-ancestors https://dashboard.starhermit.com; base-uri 'self'; form-action 'none'
```

A page of a script game without a browser build (such as the plain page a Windows-only game uploads
for browsers) needs no script and is unaffected.

## Revocations

A release found unsafe is revoked. The StarHermit client does not install or start it and tells the
player, the packaging commands refuse to package a game for it, and the platform warns the owners of
games that pin it when they publish. A revoked release is always followed by a fixed one: re-pin to it
and publish (see [Move to a newer engine](../tutorials/starhermit-engine.md#9-move-to-a-newer-engine)).
