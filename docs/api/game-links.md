# External links

A StarHermit-engine game (host API 1.24) can open a web page, but only one that StarHermit staff
have approved for your game. Your game opens a link by id and never passes a URL, so it cannot add
anything to one.

## Declare your links

In `starhermit.txt`:

```
engine.minor=24
engine.link.discord=https://discord.gg/abc
engine.link.store=https://example.com/game
```

- You can declare up to 16 links. Each id is 1–32 characters of `a-z 0-9 -` and may appear only once.
- Any `engine.link.*` key needs `engine.minor=24`, so older runtimes refuse the game.
- Your scripts call `openLink("discord")`. The runtime shows its own confirmation, with the link's
  full host and URL, and opens the page only if the player chooses Open.

## What a link may be

A link must be `https`, with no port, no `user@`, no IP address and no local name (`localhost`,
`.local`, `.internal`). Its host must be ASCII, with internationalised names written as punycode,
and have at least two labels. It may not contain backslashes, spaces, encoded slashes (`%2f`,
`%5c`) or `.`/`..` path segments. The platform keeps the canonical form: the scheme and host in
lower case, and `/` for an empty path. Everything else is kept exactly as you wrote it.

**A package with a link that breaks a rule is refused when you publish**, with
`422 invalid_link: engine.link.<id> is not an allowed link (<rule>)`, before anything goes live.

## Review

Each new link starts `pending`, and the runtime opens nothing until staff approve it. Some links are
rejected automatically: URL shorteners and redirect services, whose destination someone else
controls, and direct downloads of programs and archives (`.exe`, `.dmg`, `.apk`, `.zip` and
similar). Tracking parameters such as `utm_*` are flagged for the reviewer.

An approval belongs to your game and that exact URL. A later version listing the same URL, under
any id, keeps it. Changing the URL needs a new review. Staff can revoke an approval, or block a
whole host, at any time.

See your links and their status at `GET /api/v1/me/github-games/{id}/links`:

```json
[ { "id": "discord", "url": "https://discord.gg/abc", "status": "approved", "autoReason": null, "note": null } ]
```

The runtime checks `GET /api/v1/games/{slug}/links/{id}` at each open, with the player's launch
token. The answer is `{ id, url, status }`, where `status` is `approved`, `pending`, `rejected` or
`revoked`, or `404 link_unknown` for an id your deployed manifest does not declare.

While you develop locally (`--dev` natively, or a loopback page in the browser, with no launch
token), the runtime opens declared links behind a warning that they are unreviewed.
