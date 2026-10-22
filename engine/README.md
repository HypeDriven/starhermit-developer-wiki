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
release. A release also holds the native runtime for Windows, which the
StarHermit Windows client installs by version to run every game pinned to it.

This area is written by `cargo starhermit release`; do not edit it by hand.

## Releases

| Version | Host API | Built | Manifest (SRI) | Native |
|---|---|---|---|---|
| 1.6.0 | 1.10 | 2026-10-22T01:40:23Z | `sha384-NKRlD4xQw7FJPj8LgLFOoPrTNoYXCBjfIwxk8g4Tibr1rOoXT9VbPgJZxBx3mmXa` | windows-x86_64 |
| 1.5.1 | 1.9 | 2026-10-21T23:35:08Z | `sha384-qvfHenvAWELGPzPXIpPYLPNFQ5xBa7uIM5Ck/W0UdrPkZ0psUBIWXTGHrfGKDbUA` | windows-x86_64 |
| 1.5.0 | 1.9 | 2026-10-21T21:33:16Z | `sha384-2CaL5iDauLNsUqqBT917ByKkpYj1FCjd4hCx8cAURAuCJdFzMNY7wkE0OWypMSAA` | windows-x86_64 |
| 1.4.1 | 1.8 | 2026-10-21T19:53:59Z | `sha384-UaBp278J70QO5xuz4bR58dPFW7Rjjt6BdvAM+SXQUeWPedaeOpzFvs5F1/SgRWA9` | windows-x86_64 |
| 1.4.0 | 1.8 | 2026-10-21T18:24:00Z | `sha384-lznIP4UnJ/9yj1cgHeiiTPMANJ/BNG6SRkAXPM+YqD9G/l/1LwyLuSHZJUOiX9EL` | windows-x86_64 |
| 1.3.0 | 1.7 | 2026-10-21T14:13:48Z | `sha384-HcXR/Hw5WOTmr+uUEt6gGd3dH8DBcwsWQ1I/7O0GLvQ82Hzxz9SzgFFdDishwP8Z` | windows-x86_64 |
| 1.2.0 | 1.6 | 2026-10-21T11:33:26Z | `sha384-ytl5Z3FrO2ap1Q0OnYyENS7PjjjRrtBYyxtRYQM0yGUa3ok4JCjEg7JYOD47CcNE` | windows-x86_64 |
| 1.1.0 | 1.4 | 2026-10-20T13:55:50Z | `sha384-liw5ISwUXU5hWOBFSCLqjQNn31KEDCA9s7Oj/2eRMjh81Mcu08GK8W29UBKfbrna` | windows-x86_64 |
| 1.0.0 | 1.4 | 2026-10-20T12:49:23Z | none (native only) | windows-x86_64 |

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
SHA-256. A chunk or patch is never changed or removed while a release lists it.

## Developing games

A release with a Windows runtime has a developer download beside its
native.json: the runtime (`starhermit.exe`) with its `release.json` and
license notices, the engine a game needs to be written, checked and packaged.
The newest: [starhermit-1.6.0-windows-x86_64.zip](1.6.0/native/windows-x86_64/starhermit-1.6.0-windows-x86_64.zip).

Unpack it and run `starhermit new <game>` for a game pinned to the release,
`starhermit types <game>` for the host API's declarations, `starhermit check
<game>` to check it and `starhermit <game>` to play it.

## Using a release

```
starhermit package --native <game>
```

writes the game's file index (`starhermit-files.json`), by which the
StarHermit Windows client installs the game when it is uploaded as a folder,
and checks that the release the game pins (`engine.version`) is published
with a native runtime and not revoked.

```
starhermit package --web <game> --engine-version 1.6.0 --out <upload>
```

(the runtime of that release; `cargo starhermit package --web` is the same,
for a release with a web runtime) writes the game's loader page and file index
and checks the game against the release's manifest. The loader page is markup and
one script, this release's `starhermit.js`, pinned with its SRI hash beside the
manifest's; the runtime checks every other file it loads against the manifest,
so a changed or damaged file stops the game with an error instead of running it.

## Publishing a release

1. In a clone of the wiki repository:
   `cargo starhermit release --version X.Y.Z --into <wiki>/engine --from <runtime files> --native windows-x86_64=<starhermit.exe>`,
   the Windows runtime built from the same checkout with MSVC and the static C
   runtime. It refuses a release that exists, checks every published release
   against its manifest, native.json and chunks first, and refuses any file
   Jekyll would change or leave out.
2. Commit `engine/X.Y.Z/`, the new files of `engine/chunks/` and
   `engine/patches/`, `engine/versions.json` and `engine/README.md`, and push:
   GitHub Pages publishes the release's files as they are.

Never change, delete or rewrite a published release: games pin its hashes, and a
changed file stops them. Fix a release by publishing the next one, and mark the
old one revoked if games must leave it.
