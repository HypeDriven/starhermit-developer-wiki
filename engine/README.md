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
| 1.22.0 | 1.24 | 2026-10-28T14:33:31Z | `sha384-TVVjpAjsqiKZhmm74QC5XYz8f6cdh/4+LoXJntAsnXWm91oqv0WH+7w/tQAJf1VG` | linux-x86_64, windows-x86_64 |
| 1.21.0 | 1.23 | 2026-10-28T10:48:59Z | `sha384-n1aSvtsvXkQvR4NrU0va8XorELrRdW/Opzqqmcw3xrfwLuTBcg4U9a2OhQ7lvJAH` | linux-x86_64, windows-x86_64 |
| 1.20.2 | 1.22 | 2026-10-28T09:14:33Z | `sha384-FGdoWw1lhzExmZJRywXuMlW5eTz28MljtBCVyDXWjyHNV/K+8KKImS7tbEdD8hD9` | linux-x86_64, windows-x86_64 |
| 1.20.1 | 1.22 | 2026-10-28T06:16:43Z | `sha384-+rRnWJrcv/J5V4ZCUL8kVbwQ+7cSKuDkZy4jfBsdCg9mEMOZ4gJiFaMQzdBZ/Wdm` | linux-x86_64, windows-x86_64 |
| 1.20.0 | 1.22 | 2026-10-28T04:55:35Z | `sha384-SwnDJKgc2C8EWgBjY2Tv9SHr+jV2EG/QarKpKtsleDpa+hu4G3Q+a/+NJluXA7J8` | linux-x86_64, windows-x86_64 |
| 1.19.3 | 1.21 | 2026-10-28T02:43:32Z | `sha384-QAOZL8uarYeoi0PmGzaMVQUEdQgnKBDyCWHYmvfSljs3gckvtGszb9JcvHGiXg6T` | linux-x86_64, windows-x86_64 |
| 1.19.2 | 1.21 | 2026-10-28T00:11:24Z | `sha384-Bvsf1zY9lsSTtVNdqs45UUjtOnHKjC6ZzZ0tNWkqZwg2xbw2TPy7dKSjhOk8VtA9` | linux-x86_64, windows-x86_64 |
| 1.19.1 | 1.21 | 2026-10-27T21:11:47Z | `sha384-PkSph+S8KH+6UXDRVsT0RFVg6OcRljDWJIPZVryGWwkoRmKgiwd47GcNflWSisTy` | linux-x86_64, windows-x86_64 |
| 1.19.0 | 1.21 | 2026-10-27T20:29:55Z | `sha384-PXDDvNBRvm24pWLFFchi7MOTRXjzg6NWxfdsCXE+iOBzIb+5KFc+T2h+56MFbQ6l` | linux-x86_64, windows-x86_64 |
| 1.18.0 | 1.20 | 2026-10-27T19:59:25Z | `sha384-JpS3QdRSJSIwkV88Qc61drf7x+56kaJj9Q9PQLD6nj/ZftVyfrxsNXGEPVwCXmvg` | linux-x86_64, windows-x86_64 |
| 1.17.1 | 1.19 | 2026-10-27T15:39:42Z | `sha384-RJebhetSkOcH0oBoCEnQAWPcHhB/nJ8yDiqAZZDeCr+uiHCFPBmvW0NDIvk6EV47` | linux-x86_64, windows-x86_64 |
| 1.17.0 | 1.19 | 2026-10-27T14:34:06Z | `sha384-Pe4/dpMXwkTNFq0+g0lu0/iIkZ15SQeb9cRBO+HuWJm8FIiizOgjax71GRCidl45` | linux-x86_64, windows-x86_64 |

Removed to keep the wiki within GitHub Pages' 1 GB (versions.json lists them as revoked): 1.16.5, 1.16.4, 1.16.3, 1.16.2, 1.16.1, 1.16.0, 1.15.2, 1.15.1, 1.15.0, 1.14.0, 1.13.2, 1.13.1, 1.13.0, 1.12.0, 1.11.0, 1.10.0, 1.9.1, 1.9.0, 1.8.1, 1.8.0, 1.7.0, 1.6.0, 1.5.1, 1.5.0, 1.4.1, 1.4.0, 1.3.0, 1.2.0, 1.1.0, 1.0.0.

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

- windows-x86_64: [starhermit-1.22.0-windows-x86_64.zip](1.22.0/native/windows-x86_64/starhermit-1.22.0-windows-x86_64.zip)
- linux-x86_64: [starhermit-1.22.0-linux-x86_64.tar.gz](1.22.0/native/linux-x86_64/starhermit-1.22.0-linux-x86_64.tar.gz)

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
starhermit package --web <game> --engine-version 1.22.0 --out <upload>
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
