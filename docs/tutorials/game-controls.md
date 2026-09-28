# Tutorial: add controls to your game

StarHermit can store **key bindings** for your game: you declare the actions and their default keys,
and each player can rebind them. Their choice follows them to any machine they sign in on. Your game
reads the player's bindings from the controls API and can offer its own "rebind keys" screen.

If your game calls the controls API and gets this:

```text
404 {"error":"This game declares no controls."}
```

the platform has **no declared actions** for the build it is serving. Nothing you send to the API can
fix that: controls are declared in your game's [`starhermit.txt`](../starhermit-txt.md) and read when
the game is published. This page shows how to declare them, publish them, check that they arrived,
and use them from your client.

1. [Declare the actions](#1-declare-the-actions)
2. [Publish them](#2-publish-them)
3. [Check they arrived](#3-check-they-arrived)
4. [Use them in your game](#4-use-them-in-your-game)
5. [Troubleshooting](#troubleshooting)

## 1. Declare the actions

Add one `control.<action>=` line per action to `starhermit.txt`:

```text
name=Space Hopper
launch=index.html

control.left=KeyA+ArrowLeft | Move left
control.right=KeyD+ArrowRight | Move right
control.jump=Space+KeyW | Jump
control.fire=KeyJ | Fire
control.pause=Escape | Pause
```

Each line has three parts:

```text
control.<action>=<code>[+<code>...][ | <label>]
```

| Part | Rules |
|---|---|
| `<action>` | Your game's name for the action: 1–32 characters of lowercase letters, digits and `_` (`move_left`, not `move-left`). Unique per manifest. |
| `<code>` | A [`KeyboardEvent.code`](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values) value, such as `KeyA`, `ArrowLeft`, `Space`, `Digit1`, `ShiftLeft`, `Enter` or `Escape`. Join 1–4 codes for the same action with `+`. |
| `<label>` | Optional. Shown in rebinding screens; at most 64 characters. Defaults to the action name. |

Things to know:

- **Use `code`, not `key`.** Write `KeyA`, not `a`, and `Space`, not `" "`. Codes name the physical
  key, so the bindings work on any keyboard layout. The platform only checks that a code is 1–32
  letters and digits, so `a` or `space` is accepted but no key ever produces it. Spelling and case
  must match exactly.
- **A key belongs to one action.** A code already used by an earlier line makes the later line
  invalid.
- **Up to 32 actions** per game. Lines after the 32nd are ignored.
- **The order is kept.** Actions come back from the API in manifest order, so list them the way
  your settings screen should show them.
- **An invalid line is skipped silently.** The game still publishes. If every line is invalid,
  the game has no controls and the API answers `404`. [Check after publishing](#3-check-they-arrived).

## 2. Publish them

Declarations are read **when the game is published**. Editing `starhermit.txt` in your repository
or on disk changes nothing until you publish a build that contains it:

| How your game is published | What makes new controls live |
|---|---|
| From a GitHub repository | Your next deploy. Push the change, then deploy the latest version (**Update deployed version** in the dashboard, or `PUT /api/v1/me/github-games/{id}/deployment`). |
| Uploaded folder or bundle | Upload a new build (`POST /api/v1/me/github-games/{id}/bundle`, or `ws/v1/game-upload`) whose `starhermit.txt` has the lines. |
| Adding a new game | The first upload or submission reads them immediately. |

A replacing upload restates your controls from its own manifest. Remove every `control.*` line and
the game has none. A [`?mode=merge`](../api/github-games.md#partial-updates-modemerge) patch that
carries no `starhermit.txt` keeps the current controls.

**Players' own rebindings survive a new build.** A player's saved binding for an action that no
longer exists is ignored.

## 3. Check they arrived

Every endpoint below works with a full user token or your game's launch token. `{slug}` is your
game's slug: the launch token's `game_scope` claim, or `gameSlug` in
`GET /api/v1/me/github-games`.

```bash
curl -s "https://api.starhermit.com/api/v1/games/$SLUG/controls" \
  -H "Authorization: Bearer $TOKEN" | jq
```

```json
{
  "actions": [
    { "action": "left",  "label": "Move left",  "defaultCodes": ["KeyA", "ArrowLeft"],  "codes": ["KeyA", "ArrowLeft"] },
    { "action": "right", "label": "Move right", "defaultCodes": ["KeyD", "ArrowRight"], "codes": ["KeyD", "ArrowRight"] },
    { "action": "jump",  "label": "Jump",       "defaultCodes": ["Space", "KeyW"],      "codes": ["Space", "KeyW"] },
    { "action": "fire",  "label": "Fire",       "defaultCodes": ["KeyJ"],               "codes": ["KeyJ"] },
    { "action": "pause", "label": "Pause",      "defaultCodes": ["Escape"],             "codes": ["Escape"] }
  ]
}
```

Missing actions mean their lines were invalid; compare them against the rules above. A `404`
means none survived, or the build that declares them has not been published yet.

## 4. Use them in your game

`codes` is the player's effective binding: their override if they set one, otherwise your default.
Build a lookup from it and match `event.code`:

```js
const auth = { Authorization: `Bearer ${launchToken}` };

// Your built-in defaults, in the same shape the API returns.
const DEFAULT_ACTIONS = [
  { action: "left", label: "Move left", codes: ["KeyA", "ArrowLeft"] },
  { action: "jump", label: "Jump", codes: ["Space", "KeyW"] },
  /* ... */
];

function toControls(actions) {
  const byCode = new Map();
  for (const a of actions) for (const code of a.codes) byCode.set(code, a.action);
  return { actions, byCode };
}

async function loadControls(slug) {
  try {
    const res = await fetch(`/api/v1/games/${slug}/controls`, { headers: auth });
    if (res.ok) return toControls((await res.json()).actions);
  } catch { /* offline: fall through */ }
  return toControls(DEFAULT_ACTIONS);                   // 404, error, or outside StarHermit
}

let controls = await loadControls(gameScope);

window.addEventListener("keydown", (e) => {
  const action = controls.byCode.get(e.code);   // e.code, never e.key
  if (action) { e.preventDefault(); onAction(action, true); }
});
window.addEventListener("keyup", (e) => {
  const action = controls.byCode.get(e.code);
  if (action) onAction(action, false);
});
```

The built-in defaults keep the game playable offline, outside StarHermit, or if the controls
request fails. Keep them in step with your `control.*` lines.

**A rebinding screen.** List `actions` with their `label`. When the player presses a new key, save
only the actions they changed:

```js
async function saveBinding(slug, action, codes) {
  const res = await fetch(`/api/v1/games/${slug}/controls`, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ bindings: { [action]: codes } }),
  });
  if (!res.ok) throw new Error((await res.json()).error);   // e.g. a key already in use
  return res.json();                                         // the new effective map
}
```

`PUT` replaces the player's overrides with the actions you send, so include every action the player
has changed, not just the latest one. The rest stay on your defaults. `DELETE` on the same path
resets everything to the defaults.

The platform refuses a save (`400`) that would leave one key on two actions **after** the player's
changes are merged with your defaults. For example, binding `jump` to `KeyJ` while `fire` still
uses its default `KeyJ` is refused. Show the error, or move the conflicting action in the same
save.

## Troubleshooting

| Response | Cause | Fix |
|---|---|---|
| `404` "This game declares no controls." | No valid `control.*` line in the **published** build. | Add lines to `starhermit.txt`, check them against [the rules](#1-declare-the-actions), and [publish a new build](#2-publish-them). |
| `404` "No game with that slug." | The slug is wrong, or the game has no slug. | Use the launch token's `game_scope` or `gameSlug` from `GET /me/github-games`. A game gets a slug when a verified owner adds it from a repository, or when it declares a `server=` script or `container.image=`. A browser-only game created by folder upload has none yet, so it cannot use the controls API. |
| `403` "This token is scoped to the game '…'." | A launch token used with another game's slug. | Call with the slug in the token's `game_scope`. |
| `400` "Unknown action '…' — not declared in the game's manifest." | `PUT` named an action the manifest does not declare. | Use `action` values from `GET …/controls`. |
| `400` "'…' is bound to both '…' and '…'." | After merging with your defaults, one key would trigger two actions. | Move the other action in the same `PUT`, or pick another key. |
| `400` "'…' is not a valid KeyboardEvent.code value." | A code with spaces or punctuation. | Send `event.code` values. |
| `400` "Action '…' must bind 1–4 codes." | An empty list, or more than four. | Send 1–4 codes; `DELETE` to reset. |
| An action is missing from the response | Its line was invalid: an uppercase letter or `-` in the action name, `,` instead of `+`, more than 4 codes, a code already used, or past the 32nd action. | Fix the line and publish again. |
| A binding never fires | The code is accepted but no key produces it, such as `a` or `space`. | Use exact `KeyboardEvent.code` spelling: `KeyA`, `Space`. |

See also: [Games API — Per-player control bindings](../api/games.md#per-player-control-bindings),
[`starhermit.txt`](../starhermit-txt.md#controls).
