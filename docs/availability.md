# Feature availability and trust

Use the endpoint's response and discovery fields as the answer for the deployment you target.
A published route or SDK wrapper does not guarantee that every optional service is available.

## Availability

| Feature | Public integration status | What clients should do |
|---|---|---|
| Hosted game publishing, sign-in, saves, settings, controls | Available with the documented account/game requirements | Use the matching token and handle effective quotas |
| Authoritative scripts and realtime rooms | Available; game definitions choose supported behavior | Check queue shapes, `gameSessionId`, persistence, and replay availability |
| Container servers | Available on StarHermit; hosting permissions can vary on other deployments | Confirm deployment readiness before play |
| Voice and peer relay | Deployment-dependent | Handle unavailable-service responses and leave text/gameplay usable |
| OAuth providers | Configured per deployment | Read `/auth/oauth/providers`; never hard-code a provider list |
| Replays and join-in-progress | Game-dependent | Read `replaysEnabled` and room configuration |
| Catalog purchases | Not available yet | Free-title claiming works; paid claims return `402` |
| Catalog binary distribution | Current catalog pipeline is a preview | Do not rely on catalog upload/download URLs for production distribution; use a supported hosted-game publishing flow |
| External Steam/Epic/GOG library sync | Preview with demonstration titles | Do not treat returned demonstration ownership as proof of a purchase |
| Content moderation checks | Discover through `/games/{slug}/moderation`; currently unavailable on the public deployment | Keep shared content hidden without a current allow; handle `503 overloaded` |
| Generation | Reserved routes, unavailable | Do not depend on generation jobs, payments, providers, or marketplace access |

Limits in the reference pages are defaults unless a deployment-specific value is explicitly stated.
Use returned limits and `Retry-After`. A `503 overloaded` with `Retry-After: 300` means retry advice,
not a promise the service will become available five minutes later.

## Reserved generation routes

The player/server generation prefix is `/api/v1/games/{slug}/generation`: discovery, quotes, and
job create/read/delete routes are reserved. Account/owner and public provider routes are also
reserved. Valid callers currently receive `503` with:

```json
{ "error": "overloaded", "code": "overloaded", "retryAfterSeconds": 300 }
```

Authentication and game scope still apply. No usable generation result, purchase, or provider
connection is promised. These reservations are listed separately in the [REST contract](api/contracts.md).

## What makes a result trustworthy?

| Pattern | Platform guarantees | What your game must validate |
|---|---|---|
| Host-routed room | Authenticated sender, assigned host, seats and routing | Simulation and host honesty; clients may be modified |
| Script/container awards | Only the game's backend writes game-owned scores and achievements; recipients must be participants | Whether gameplay actually earned the award |
| Client-reported single-player score with bounds | Server checks numeric type/range before writing | A plausible number is not proof of a legitimate run |
| Catalog client-claimed achievement | Account and entitlement checks | Client-observed unlock condition; a modified client can claim it |
| Cloud save or settings | Authenticated player's own scoped data | Document validation, game rules, and whether progress may be trusted for competition |
| External identity association | The identity was associated with the account | Verify storefront tickets/ownership through the storefront when required |

The provided `score-script.js` accepts client-reported values within configured bounds. It is useful
for casual single-player boards, but does not prevent invented in-range results. For competitive
play, simulate authoritative rules or verify a replay of recorded inputs before awarding scores.
Never infer anti-cheat guarantees merely from an API refusing direct score submissions.

Likewise, a backend attached only to award achievements cannot verify gameplay it never observes.
Define what evidence it accepts, validate it, and make that trust model clear to players when it
matters. See [choosing an integration](choosing-an-integration.md).
