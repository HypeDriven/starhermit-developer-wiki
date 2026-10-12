# Build your first hosted browser game

[Download Star Collector](../examples/browser-quickstart.zip), a complete small game with two entry
options: account play with cloud saves, and single-player play whose progress is kept only in memory.
[Try unsigned play](../examples/browser-quickstart/index.html) on this wiki; account sign-in becomes
available after you publish your own copy on StarHermit.

You need a StarHermit account to publish. The game itself needs no server backend, dependency
installation, build step, or publisher organization.

## 1. Unzip and play locally

The ZIP contains `index.html`, `app.js`, `style.css`, `starhermit.txt`, and the two helper files.
Serve the extracted folder with a local static server, for example:

```bash
python3 -m http.server 8000 --directory star-collector
```

Here `star-collector` is the folder you extracted into. Open `http://localhost:8000` and choose
**Play single player (progress isn't saved)**. Click the star. Returning to the start or reloading
starts a new untracked run. This mode writes neither local progress nor account progress.

## 2. Publish the distributable folder

The manifest is already at the folder root:

```ini
name=Star Collector Quickstart
launch=index.html
description=A small single-player game with account saves or untracked play.
```

In StarHermit's game publishing UI, add this folder as a new game. The entire selected folder is the
published build. Keep only the files you intend to serve. The API equivalent packages the files
under `client/` and sends a raw gzip archive:

```bash
mkdir -p bundle/client
cp -R star-collector/. bundle/client/
cp star-collector/starhermit.txt bundle/starhermit.txt
# Write the archive outside bundle so it cannot include itself.
tar -C bundle -czf star-collector.tar.gz .

curl --fail-with-body -X POST https://api.starhermit.com/api/v1/me/github-games/upload \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/gzip' \
  --data-binary @star-collector.tar.gz
```

`ACCESS_TOKEN` is your full account token, after explicit current-terms acceptance. The response's
`game.id`, `game.gameSlug`, and hosted subdomain identify your game. Open the returned hosted URL.
For subsequent releases use that game's [bundle endpoint](../api/github-games.md#push-a-game-bundle)
rather than creating another listing. See [CI publishing](ci-cd-build-upload.md) when ready.

## 3. Try the two account entry paths

**Launch from StarHermit:** the launcher supplies `#game_token=<jwt>`. The helper captures it and
removes it from the URL before the game module runs. Choose **Continue with your StarHermit account**.

**Open the hosted URL directly:** choose **Sign in with StarHermit**. The provider chooser lets the
player sign in with an existing account or create one. It returns directly to this game with a scoped
`#access_token=<jwt>`; no account-wide credential is sent to the game.

The game loads progress only when the player chooses account play. If current terms need acceptance,
it displays the document as text and offers **Accept and continue**. Acceptance sends only the hash
of the displayed revision. A changed revision is redisplayed for another explicit decision.

## 4. Check progress and failures

Collect a few stars in account mode, wait for **Saved**, and reload. The count returns after choosing
account play. Open a second tab on the same saved count: save in one, then collect in the other. The
second must show a conflict and offer **Load latest cloud progress** instead of overwriting it.

The save document is `{ version: 1, points: <non-negative integer> }`. The game loads and validates
before writing, uses the loaded ETag for conditional updates, and blocks writes after a failed read.
It saves at each collection and labels data saved only after acknowledgement. See
[the saving recipe](cloud-save-sync.md) for formats, migration and larger documents.

Selecting untracked play discards the game's player token and stops background renewal. No cloud
save, achievement, leaderboard, or local-progress write occurs. Choosing account play again uses
sign-in to get a fresh token.

## 5. Adapt it to your game

Replace the star button and progress schema with your gameplay. Keep the entry choices, token
capture, explicit terms acceptance, load-before-save rule, error handling, and save status.
Declare keyboard actions in the manifest and read the [controls API](../api/games.md#per-player-control-bindings)
when your game needs rebindings. Put volume and graphics preferences in [settings](../api/games.md#per-player-game-settings).

For multiplayer or validated competitive results, add [a script or container](../choosing-an-integration.md).
This quickstart's cloud counter is client-owned progress, not proof of a legitimate score.

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Accessible entry, terms, gameplay, and status UI |
| `app.js` | Entry modes, explicit consent, progress validation, checkpoints, conflicts |
| `starhermit-sdk.js` | Launch-token capture, hosted sign-in, token renewal |
| `cloud-save-store.js` | Raw JSON load/conditional save recipe |
| `starhermit.txt` | Public publishing metadata |

See [credentials](../credentials.md), [API conventions](../api/conventions.md), and
[troubleshooting](../troubleshooting.md) when a request behaves differently than expected.
