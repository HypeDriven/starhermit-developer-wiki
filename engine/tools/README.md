---
title: StarHermit developer tools
---
# StarHermit developer tools

Create publishable script-game packages, upload them to StarHermit, and
give your coding assistant a local MCP connection. These tools require no
Rust installation or engine source checkout. The game may have its own
build dependencies, such as Node.js.

Download the archive for your computer from
https://wiki.starhermit.com/engine/tools/README.html and compare its SHA-256
with the checksum beside it. Unpack it and put its directory on PATH, or
use the executable's full path in the commands below. macOS downloads are
provided separately for Apple Silicon (`macos-aarch64`) and Intel
(`macos-x86_64`). They are not Apple-notarized, and no download is
Authenticode or Developer ID signed. The Apple Silicon build is
cross-compiled; report problems.


## Downloads

Developer tools 1.28.0 (macOS, Linux and Windows) are separate from the engine
runtime a game pins.

| Computer | Download | SHA-256 |
|---|---|---|
| macOS, Apple Silicon | [starhermit-tools-1.28.0-macos-aarch64.tar.gz](1.28.0/starhermit-tools-1.28.0-macos-aarch64.tar.gz) | [checksum](1.28.0/starhermit-tools-1.28.0-macos-aarch64.tar.gz.sha256) |
| macOS, Intel | [starhermit-tools-1.28.0-macos-x86_64.tar.gz](1.28.0/starhermit-tools-1.28.0-macos-x86_64.tar.gz) | [checksum](1.28.0/starhermit-tools-1.28.0-macos-x86_64.tar.gz.sha256) |
| Linux, x86-64 | [starhermit-tools-1.28.0-linux-x86_64.tar.gz](1.28.0/starhermit-tools-1.28.0-linux-x86_64.tar.gz) | [checksum](1.28.0/starhermit-tools-1.28.0-linux-x86_64.tar.gz.sha256) |
| Windows, x86-64 | [starhermit-tools-1.28.0-windows-x86_64.zip](1.28.0/starhermit-tools-1.28.0-windows-x86_64.zip) | [checksum](1.28.0/starhermit-tools-1.28.0-windows-x86_64.zip.sha256) |

[latest.json](latest.json) lists download sizes and SHA-256 hashes, and
each download's version.

## Check and package a game

```
starhermit-tools --version
starhermit-tools check my-game
starhermit-tools package --web my-game --out upload --remote-out remote-objects
```

The game directory contains `starhermit.txt` and the files the game needs.
`engine.version` pins a published engine release; the tool reads its
manifest from the public wiki and writes a hash-pinned loader and file
index. `--engine-version X.Y.Z` selects a compatible release explicitly.
Files declared by `engine.remote.files` are written to `remote-objects`;
when `engine.remote.urls=platform`, publishing uploads them first.

`check` validates the manifest, package paths and file structure. It does
not execute scripts. Test the packaged web game in a browser before
publishing. Developers can additionally download the matching native
runtime from an engine release (Windows, Linux, and from engine 1.26.2
macOS 11 or later on Intel and Apple Silicon) and use
`starhermit check my-game` for a headless execution check. The macOS
runtimes are ad-hoc signed and not notarized, and they have not yet been
tested on real Apple hardware. A tarball downloaded in a browser is
quarantined: run `xattr -d com.apple.quarantine starhermit` or allow it
in System Settings.

## Publish

Use your own registered deployment key, following the public-key onboarding
and CI/CD guides in the developer wiki. Set `STARHERMIT_PUBLIC_KEY` and
`STARHERMIT_PRIVATE_KEY` in your shell or your CI secret store. Alternatively,
set `STARHERMIT_ACCESS_TOKEN` to an account access token. Do not put these
values in the game, commit them, or add them to MCP configuration.

```
starhermit-tools publish --game-id YOUR-GAME-ID --upload upload --remote-out remote-objects
```

This replaces the game's deployed files. `--mode merge` patches an existing
upload instead. To create a new game, replace `--game-id YOUR-GAME-ID` with
`--new`. `--socket` selects the upload WebSocket; large uploads select it
automatically. `--display-name` and `--description` override the uploaded
manifest's name and description. The publisher reports the hosted URL
and writes a publish report beside the upload.

The account must own the game. A credential error or denied limit is an
error; do not work around it with somebody else's credentials. Remote
objects already held by the game are reused; interrupted object uploads
resume. A new game may be created before a subsequent object upload fails;
use its reported game ID to retry rather than creating another.

`STARHERMIT_API_BASE` selects another HTTPS deployment.
`STARHERMIT_CA_FILE` selects a PEM trust bundle, for example a development
CA; TLS verification is always enabled. Normal use needs neither variable.

## Connect a coding assistant with MCP

Add a stdio MCP server to your assistant's configuration, using absolute
paths appropriate to your computer:

```json
{
  "mcpServers": {
    "starhermit": {
      "command": "/absolute/path/to/starhermit-tools",
      "args": ["mcp", "--package", "/absolute/path/to/my-game"]
    }
  }
}
```

The server offers `check_package`, `package_web`, and `package_native`.
If the game has a Node.js build script, append `--build-script` and its
absolute path to the MCP arguments to expose a `build` tool. This runs
that configured script; it does not accept arbitrary commands from MCP.
`package_web` takes optional `outDir`, `remoteOut`, and `engineVersion`;
relative output paths are relative to the game directory. By default it
writes `starhermit-build/upload` and `starhermit-build/remote` beside the
game directory. `package_native` writes the game's native file index for
installation by a supported StarHermit client, which installs the engine
runtime for the player's platform (macOS included, from engine 1.26.2). Neither tool publishes anything.

With a native runtime installed, append `--runtime` and its
absolute executable path to the MCP arguments to enable `run_checks`.
That tool executes the game's code in the configured runtime. Publishing
is available only as an explicit CLI command and is never an MCP tool.
