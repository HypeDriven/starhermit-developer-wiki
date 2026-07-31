# The `starhermit.txt` Manifest

`starhermit.txt` is a small plain-text file that tells StarHermit what your game is called, how to
launch it, and what kind of server (if any) it runs. It is the one file the platform looks for in
everything you publish.

**It belongs at the root of what you upload** — both for a game's client files and for a dedicated
server.

You do not strictly have to author the file yourself. The Windows client and the web dashboard both
show the manifest as **editable fields**: whatever your build already carries prefills them, and
whatever they hold when you press Upload is written into the bundle as the manifest. So a build with
no `starhermit.txt` is still publishable, and a `.tar` — which you cannot edit in place — is as
editable as a folder. Shipping the file inside your build is still worth doing: it travels with the
artifact, so the values are right the next time anyone uploads it.

## The rule that surprises people

> **Everything sitting next to the manifest is uploaded.**

The folder you pick is not a project directory the platform digs through for a build — the folder's
contents **are** the published game, copied as-is. Every file and every subfolder adjacent to
`starhermit.txt`, at any depth, goes up and is served to players.

So pick your **distributable build output**, not your source tree. Uploading a working directory
means shipping your source, your notes, your unminified assets and your half-finished experiments to
every player, and burning your game's 4 GB allowance on files nobody loads.

A handful of names are always skipped, because they are never part of a published game:
`.git`, `node_modules`, `.DS_Store`, `Thumbs.db`. Everything else is fair game — including
`README.md`, `.env` files, `*.psd` sources and `*.map` files. If you would not hand it to a player,
do not leave it next to the manifest.

## Where it goes

### A game client

```text
my-game-dist/
  starhermit.txt        <- belongs at this level
  index.html            <- your launch file
  game.js
  assets/
    sprites.png
    music.ogg
```

Pick `my-game-dist/`. The contents become the game, served at
`https://<slug>.starhermit.com/`, and `index.html` is what a player loads.

**Or pick a single `.tar` of exactly that layout** — "Add from .tar" in the desktop client, the
`.tar` field in the dashboard. The client reads the archive's entries, re-homes them into the bundle
for you, and prefills the manifest fields from a `starhermit.txt` inside it. Use `--format=ustar`:

```bash
tar --format=ustar -cf my-game.tar -C my-game-dist .
```

Archives using GNU long-name or PAX extended headers are refused. Those formats store an entry's real
path in a *separate* metadata block, so re-homing them means rewriting metadata — and getting that
subtly wrong would publish a corrupt game. If your build hits the ustar path limits (100 bytes for a
name, 155 for its directory prefix), shorten the deepest folder names or upload the folder instead.

### A dedicated server

```text
my-server-dist/
  starhermit.txt        <- belongs at this level
  image.tar            <- docker save output of your server image
```

Pick `my-server-dist/` — **or pick `image.tar` on its own**, since the manifest can come from the
dialog's fields instead. Unlike the client folder, a server distribution has exactly two meaningful
files: the manifest, and the container image produced by

```bash
docker save my-server:latest > image.tar
```

Anything else in a server folder is left behind rather than uploaded — the platform runs your
container, so the image already contains your server's files. Keeping the manifest here anyway means
a server build is self-describing and can be re-uploaded on its own.

## Format

Lines of `key=value`. Blank lines are ignored, `#` starts a comment, and whitespace around keys and
values is trimmed. Keys are case-insensitive; unknown keys are ignored, so a typo fails quietly —
check your spelling against the tables below.

```text
# My Game - browser-only
name=My Game
launch=index.html
```

### Keys every game may set

| Key | Aliases | Meaning |
|---|---|---|
| `name` | — | The display name players see. Required unless you pass a display name in the upload form. |
| `launch` | `launch_path`, `html` | Path to the entry `.html`, relative to the manifest. Defaults to `index.html` when a file by that name sits at the root. |
| `owner` | `username`, `user` | The owning StarHermit **user ID (UUID)**. Use the immutable user ID from `GET /api/v1/me`, not a username. Lets you [claim a listing someone else added](tutorials/claim-existing-game.md). |

### Keys for a game with server logic

Pick **one** server style. Declaring both `server=` and `container.image=` is refused.

| Key | Meaning |
|---|---|
| `server` (alias `server_script`) | Path to a JavaScript file that runs as the authoritative server in StarHermit's sandbox. See [Game Scripts](api/game-scripts.md). |
| `container.image` | A **digest-pinned** image (`name@sha256:<64 hex>`) to run as the server. Tags are refused. See [Container Game Servers](api/container-games.md). |
| `container.port` | Port your container listens on. |
| `container.memory` | Memory limit for the container. |
| `container.cpu` | CPU limit for the container. |
| `container.health` | Path the platform probes for readiness. |
| `container.env.<NAME>` | An environment variable passed to your container. |

## How to create one

1. Open a plain-text editor — Notepad, TextEdit, VS Code, anything. Not Word.
2. Type the keys your game needs, one per line (start from an example below).
3. Save it as `starhermit.txt` in the folder you are going to upload, encoded as UTF-8.

On Windows, Notepad's "Text Documents" save type appends `.txt` to whatever you type, so naming the
file `starhermit.txt` yields `starhermit.txt.txt`. Either choose **All Files** in the save dialog, or
turn on File Explorer's **File name extensions** view and rename it afterwards. A file named
`starhermit.txt.txt` is not found and the upload is refused.

The name is exact: all lower case, no spaces. `Starhermit.txt` and `starhermit.TXT` work because the
lookup is case-insensitive, but `starhermit.text`, `starhermit.cfg` and `manifest.txt` do not.

## Examples

### Browser-only game

```text
name=Asteroid Garden
launch=index.html
```

### Static site whose entry point is not at the root

```text
name=Tower Rush
launch=public/game.html
```

### Game with a sandboxed JavaScript server

```text
name=Correspondence Chess
launch=index.html
server=server.js
```

### Game with a container server

```text
name=Voxel Skirmish
launch=index.html
container.image=ghcr.io/octocat/voxel-server@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
container.port=8080
container.memory=512m
container.health=/healthz
container.env.LOG_LEVEL=info
```

### Claiming a listing you own

Set `owner` to the immutable StarHermit user ID returned as `id` by `GET /api/v1/me`—not the
profile username or nickname:

```text
name=My Game
launch=index.html
owner=3fa85f64-5717-4562-b3fc-2c963f66afa6
```

## Publishing from a GitHub repository instead

If your game lives in a `github.com` repository, put `starhermit.txt` at the **repository root** and
submit the repo URL — the platform reads the manifest straight from the repo and no upload is
involved. Everything above applies unchanged, except that "everything adjacent" means everything in
the repository, which is a good reason to keep build output and sources in separate repos (or to use
the folder upload for your built output).

See [GitHub Games](api/github-games.md) for the repository flow, and
[Add a game from a local folder](api/github-games.md#add-a-game-from-a-local-folder) for the upload
endpoints the clients call.

## Limits

One game may occupy **4 GB**, and that is also the ceiling on a single upload — publishing replaces a
game's content rather than adding to it, so the largest push is also the most a game can hold. Deeply
nested paths are refused: the archive format caps a path at 100 characters for the file name plus 155
for its directory prefix, so shorten very long folder chains.

## Troubleshooting

| What you see | Why |
|---|---|
| The client says your build has no manifest | No `starhermit.txt` at the root of what you picked (a copy deeper inside does not count). This is a prompt, not a refusal — fill in the dialog's fields and one is written for you. |
| Your `.tar` is refused as "extended headers" | It uses GNU long-name or PAX blocks. Re-create it with `tar --format=ustar`, or upload the folder. |
| You edited a field but the old value is live | The manifest inside your build is unchanged; only the bundle got the new one. Update the file in your build so the next upload starts from the right values. |
| "A display name is required" | No `name=` line, and no display name typed into the form. |
| "A launch path is required" | No `launch=` line and no `index.html` at the folder root. |
| "The upload's files do not contain the launch file" | `launch=` names a file that is not in the folder. Check the spelling and that it is relative to the manifest, not absolute. |
| Your game published but is missing files | Those files were not adjacent to the manifest. The upload starts at the folder holding `starhermit.txt`; nothing above it is included. |
| `container.image` refused | It is not digest-pinned. Use `name@sha256:<64 hex>`, not a tag. |
