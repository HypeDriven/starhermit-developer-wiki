---
title: StarHermit engine releases
---
# StarHermit engine releases

The StarHermit web runtime is the engine that runs StarHermit script games in
browsers. Each directory here is one release,
`https://wiki.starhermit.com/engine/X.Y.Z/`, and it never changes once
published. Games do not carry the engine: their loader page imports one exact
release from here, pinned by hash, so a game's upload holds only its own files
and every game a player opens on starhermit.com shares one cached copy of each
release. A release also holds the native runtimes for Windows and Linux: the
StarHermit Windows client installs the Windows one by version to run every game
pinned to it, and developers download either to write, check and package games.

This area is written by `cargo starhermit release`; do not edit it by hand.

## Releases

| Version | Host API | Built | Manifest (SRI) | Native |
|---|---|---|---|---|
| 1.16.1 | 1.18 | 2026-10-27T09:25:14Z | `sha384-pdzSgLs0KibnQR+GYZqP2LkpiAPClSwWQLTu3jnZmdctGnl1IdKhvpbZIOSe+++S` | linux-x86_64, windows-x86_64 |
| 1.16.0 | 1.18 | 2026-10-27T08:08:29Z | `sha384-JWUFd/Esqyeb5dUno6Ho6CkWZVNStJOcDC12uFlfSumjOi3Kpm4pu7x/IoO2SwX8` | linux-x86_64, windows-x86_64 |
| 1.15.2 | 1.17 | 2026-10-27T07:37:40Z | `sha384-CgN67S4C8pDTCNC9WT1reNs/VuuVMgMoFrpDQQmW1U7LJ5EQI/nhBUIk/vbI49dO` | linux-x86_64, windows-x86_64 |
| 1.15.1 | 1.17 | 2026-10-26T21:49:02Z | `sha384-b/5injjuCs3gbG8UEmNcwjLBdiLTZsx/NP8jUnWD6fH8vwbegW9PePfZg+sgTz8P` | linux-x86_64, windows-x86_64 |
| 1.15.0 | 1.17 | 2026-10-26T21:00:28Z | `sha384-MqzawEdIQy9IvpDJWkOpdYqncjNA1n7L2CIlTrMfQC1hdcn2JF+eQYXmnSNdPh6K` | linux-x86_64, windows-x86_64 |
| 1.14.0 | 1.16 | 2026-10-26T16:19:18Z | `sha384-Mw6WVzO4yDvwyZd15YtZ7uB1g4iVFTWxIOav914pkLeagvowb2bVYXNS+MtL6NeS` | linux-x86_64, windows-x86_64 |
| 1.13.2 | 1.15 | 2026-10-26T14:50:38Z | `sha384-m5UWCRKox9Hfw1jBKI41fuaCMHN9rnVEM+rGcE9deeUefBtiRRXBnEbbOW6c3Qx9` | linux-x86_64, windows-x86_64 |
| 1.13.1 | 1.15 | 2026-10-26T13:54:01Z | `sha384-eQkVHgCLDmrlpY4LQrjMCPQXWKl1grSAvzammyuqz3l6IIw1Udl081GSsWBmk2nY` | linux-x86_64, windows-x86_64 |
| 1.13.0 | 1.15 | 2026-10-26T02:06:41Z | `sha384-6CvFdAD7mwKguwAL6IoCrGSzfgvhBXyCtvzqi3Af+3AqG0eH1+EvJz6Dth0a9f5m` | linux-x86_64, windows-x86_64 |
| 1.12.0 | 1.15 | 2026-10-25T21:44:52Z | `sha384-Z0m/DPLxdpnYEkwKkND0iyOvNkpIkXy3h4CEtaUuyniveyCVJUV5UREjAnm3jMQf` | linux-x86_64, windows-x86_64 |
| 1.11.0 | 1.15 | 2026-10-25T16:36:18Z | `sha384-YBlxtt6zVFPrV4A9EHViUKshb+jZBkW7ehapk+EJLAR3HbvtrAZ5JFfVCVoLAK4I` | linux-x86_64, windows-x86_64 |
| 1.10.0 | 1.14 | 2026-10-25T08:40:14Z | `sha384-xAd1CtyJtIpwkQSaQZ659MueprbQgbausrOUAgcjyYy/ROv+QDl+OvR1alYx4BNc` | linux-x86_64, windows-x86_64 |
| 1.9.1 | 1.13 | 2026-10-23T12:32:49Z | `sha384-73sVqbxVzc5h6sVQgk7/lvEK6GzBPcwlBU8/GLHc9SKH6M1zwW2OTdtP8iLruBim` | linux-x86_64, windows-x86_64 |

Removed to keep the wiki within GitHub Pages' 1 GB (versions.json lists them as revoked): 1.9.0, 1.8.1, 1.8.0, 1.7.0, 1.6.0, 1.5.1, 1.5.0, 1.4.1, 1.4.0, 1.3.0, 1.2.0, 1.1.0, 1.0.0.

[versions.json](versions.json) lists the same, newest first. Release `X.Y.Z`
offers host API `X` with the minor shown; `Y.Z` grow with features and fixes.
Games pin a release exactly and run on that release only, so a new runtime
reaches a game when its developer re-pins after testing. A release found unsafe
is marked revoked in versions.json with the reason; games cannot be packaged for
it any more.

## Layout

```
engine/
  versions.json        every release, newest first: its web manifest's SRI hash, its native runtimes
  X.Y.Z/
    manifest.json      the release, its host API, every file's size and sha384, the build
    starhermit.js      the module a game's loader page loads
    starhermit.wasm    the runtime
    *.js               the runtime's other modules and worklets
    starhermit.d.ts    the host API's declarations, for type-checking games
    licenses/          the license notices of everything in the runtime
    native/windows-x86_64/native.json
                       the Windows runtime's host API and build, and its files
                       (starhermit.exe, its notices, release.json, the web manifest),
                       each with its size, SHA-256 and chunks
    native/windows-x86_64/starhermit-X.Y.Z-windows-x86_64.zip
                       the developer download: the same files as one archive,
                       listed in native.json with its size and SHA-256
    native/linux-x86_64/native.json
                       the same for the Linux runtime (starhermit, its notices,
                       release.json, the web manifest), and what it requires of
                       the system: the newest glibc, the libraries it links and loads
    native/linux-x86_64/starhermit-X.Y.Z-linux-x86_64.tar.gz
                       its developer download (starhermit executable, 0755)
  chunks/ab/<sha256>.z every native file's chunks, zlib-compressed, named by the SHA-256
                       of their bytes and shared by all releases
  patches/ab/<sha256>.p
                       binary patches from the same file of earlier releases, named by
                       their SHA-256
```

A release without a web runtime (released with `--no-web`) has `native/` only
and `"web": null` in versions.json; games cannot be packaged for the web
against it. A client that holds one release fetches only the chunks of the next one it
lacks, or a file's patch from the build it holds where native.json lists one
(smaller where code moved). versions.json pins each release's native.json by its
SHA-256. A chunk or patch is never changed, nor removed while a release lists it.

## Developing games

For automated publishing and a development MCP server, download the
[standalone developer tools](tools/README.html). They run on macOS
(Apple Silicon and Intel), Linux and Windows without Rust, Cargo, or
access to the engine's source repository.

Each native runtime has a developer download beside its native.json: the
runtime (`starhermit.exe` on Windows, `starhermit` on Linux) with its
`release.json` and license notices, the engine a game needs to be written,
checked and packaged. The newest:

- windows-x86_64: [starhermit-1.16.1-windows-x86_64.zip](1.16.1/native/windows-x86_64/starhermit-1.16.1-windows-x86_64.zip)
- linux-x86_64: [starhermit-1.16.1-linux-x86_64.tar.gz](1.16.1/native/linux-x86_64/starhermit-1.16.1-linux-x86_64.tar.gz)

Unpack it and run `starhermit new <game>` for a game pinned to the release,
`starhermit types <game>` for the host API's declarations, `starhermit check
<game>` to check it and `starhermit <game>` to play it. On Linux, unpack it with
`tar -xzf starhermit-X.Y.Z-linux-x86_64.tar.gz` and run
`./starhermit-X.Y.Z-linux-x86_64/starhermit`; it needs glibc 2.35 or newer
(Ubuntu 22.04, Debian 12 or later; the newest version each release needs is in
its native.json), and to open a window Wayland or X11 with Vulkan or OpenGL ES
3.0 drivers. Checking and packaging need none of them.

## Using a release

```
starhermit package --native <game>
```

writes the game's file index (`starhermit-files.json`), by which the
StarHermit Windows client installs the game when it is uploaded as a folder,
and checks that the release the game pins (`engine.version`) is published
with a native runtime and not revoked.

```
starhermit package --web <game> --engine-version 1.16.1 --out <upload>
```

(the runtime of that release; `cargo starhermit package --web` is the same,
for a release with a web runtime) writes the game's loader page and file index
and checks the game against the release's manifest. The loader page is markup and
one script, this release's `starhermit.js`, pinned with its SRI hash beside the
manifest's; the runtime checks every other file it loads against the manifest,
so a changed or damaged file stops the game with an error instead of running it.

## Publishing a release

1. In a clone of the wiki repository:
   `cargo starhermit release --version X.Y.Z --into <wiki>/engine --from <runtime files> --native windows-x86_64=<starhermit.exe> --native linux-x86_64=<starhermit>`,
   the Windows runtime built from the same checkout with MSVC and the static C
   runtime, and the Linux runtime built for `x86_64-unknown-linux-gnu` (as
   `cargo starhermit package --script --release --target linux` builds it),
   which must link glibc's and GCC's runtime libraries only and need glibc 2.35
   at most. It refuses a release that exists, checks every published release
   against its manifest, native.json and chunks first, and refuses any file
   Jekyll would change or leave out.
2. Commit `engine/X.Y.Z/`, the new files of `engine/chunks/` and
   `engine/patches/`, `engine/versions.json` and `engine/README.md`, and push:
   GitHub Pages publishes the release's files as they are.

Never change or rewrite a published release: games pin its hashes, and a
changed file stops them. Fix a release by publishing the next one, and mark the
old one revoked if games must leave it.

GitHub Pages publishes at most 1 GB for the whole wiki. When a release would
pass `--site-limit-mb` (default 1000, with the rest of the wiki measured and a
50 MB margin), it removes the oldest releases until the site fits, revoked ones
first, never the newest nor one named with `--keep X.Y.Z` or `--keep-file PATH`
(one version per line): name every version a live game pins, or nothing is
removed and the release is refused. A removed release's directory and the
chunks and patches no remaining release lists go; versions.json keeps it,
revoked, with `"removed": true`. `cargo starhermit release prune --into
<wiki>/engine --dry-run` shows what would go without a release; then commit
with `git add --all engine`.
