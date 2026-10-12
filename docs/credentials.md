# Credentials and identifiers

Use the least-privileged credential that can perform the action. Being signed in does not replace
resource checks: callers still need the relevant friendship, entitlement, membership, or ownership.

## Which credential can call what?

| Surface | Anonymous | Account access token | Player launch token | Container server token |
|---|---|---|---|---|
| Terms and server time | Yes | Yes | Yes | Time only |
| Sign-in and token refresh | Public-key/OAuth flows; refresh needs its own refresh token | Sign-in flows | Use game sign-in for a new chain | Renew with the deployment refresh key |
| Accept displayed terms | No | Yes | Yes, for this player | No |
| Own profile, identities, account privacy | No | According to permissions and authentication method | No | No |
| Public user profile/avatar | No | Yes | Yes | No |
| Friends list and heartbeat | No | Yes | Yes | No |
| Friend requests; account-wide invite inbox | No | Yes | No | No |
| Game settings, controls, reports, launch-token renewal | No | Yes | Own game only | No |
| Game sessions, matchmaking, achievements, replays | No | Yes, with required membership | Own game, with required membership | Session reconciliation only |
| Realtime rooms and their invites | No | Yes | Own game only | No |
| Cloud saves | No | Account's slots | Exactly `game:<gameId>` and its `/info` | No |
| Leaderboard definitions and entries | Public reads; friends filter needs auth | Yes | Own game's boards by ID; use `/games/{slug}/leaderboards` to discover | No |
| Session chat/voice | No | Conversation membership | Conversations attached to own game's sessions | No |
| Account-wide chat push socket | No | Yes | No | No |
| Bound peer relay | No | Match membership | Own game's match membership | No |
| Game icon/cover | Yes | Yes | Any game's public art | No |
| Game release notes | No | Yes | Own game only | No |
| Publishing, owner management, diagnostics/webhooks | No | Ownership/permissions required | No | No |
| Moderation | No | Player/owner actions | Own game's player actions | Own game's supported server actions; no player flags |

Generation APIs are [reserved and unavailable](availability.md#reserved-generation-routes).
A token does not make them usable. Endpoint-specific rules on the reference pages take precedence
over this overview; [REST contracts](api/contracts.md) identify the credential families per operation.

## Token lifetimes

| Credential | Default lifetime | Renewal |
|---|---|---|
| Account access token | 15 minutes | Exchange the rotating refresh token; replace both returned tokens |
| Account refresh token | 7 days | Single-use rotation; concurrent refreshes must share one request |
| Player game launch token | 60 minutes | Renew while valid, within the default 12-hour launch chain |
| Container server token | 24 hours | Dedicated deployment refresh key; read the reported lifetime |
| WebSocket connection ticket | About 30 seconds | One upgrade only; obtain a fresh ticket for each attempt |

Read returned lifetimes. A player launch token is not an account token and has no refresh token.
It cannot recover itself after expiry. Offer game sign-in or a return to the launcher.
An open socket may outlive token expiry, but reconnect requires a current credential.

The launcher supplies `#game_token=<jwt>`; direct hosted-game sign-in returns
`#access_token=<jwt>`. Read and remove these before routers or other scripts consume the fragment.
Decode claims only to build URLs and display identity; the API validates the credential.

Use `Authorization: Bearer <token>` for REST. Browser sockets use a fresh `?ticket=` from
`POST /api/v1/realtime/connection-tickets`, or supported `?access_token=`. Tickets inherit the
caller's scope and do not grant access to other resources. Never place account credentials in your
public build or pass them into a game's URL. See [authentication](api/auth.md).

## Authentication method matters

An OAuth-authenticated account session can enroll keys, revoke other keys, change the account email,
and remove provider identities. A public-key account session can use ordinary account APIs and
revoke its **own** key through `/me/public-keys/current`, but cannot manage other credentials.
A launch token cannot manage account keys, even when it was minted from a public-key session.

[Current terms acceptance](api/profile.md#terms-acceptance) is a player action supported by account
and launch tokens. Display the document and submit its hash only on explicit acceptance.

## Identifiers are not interchangeable

| Identifier | Meaning | Example use |
|---|---|---|
| Game ID / slug / `game_scope` | Hosted game's immutable UUID | `/games/{slug}`, `<gameId>.starhermit.com`, `game:<gameId>` save key |
| Catalog title ID | Separate `SoftwareTitle` UUID | `/software/{titleId}`, catalog entitlements |
| User ID / `sub` | StarHermit account UUID | Invite target; script `ctx.message.from` |
| Session ID | Authoritative match or world UUID | `/sessions/{sessionId}`, gameplay socket |
| Room ID | Realtime lobby/world room UUID | `/realtime/rooms/{roomId}`; may expose a separate `gameSessionId` |
| Participant ID | A seat in a realtime room | Server prefix on realtime binary frames; not the account ID |
| Conversation ID | Chat conversation UUID | Session `chatConversationId`, voice room creation |
| Voice room ID / relay ID | Separate transport resources | Voice or relay socket query |
| Achievement/board key | Stable name within one game | Server grants and score writes |
| Achievement/board ID | Definition UUID | Owner editing or player reads by ID |

A name such as `chess` in older examples is illustrative. Use the actual UUID returned by your game's
listing or its launch token. Realtime and container binary GUIDs use .NET byte order; see
[WebSocket contracts](api/contracts.md#websocket-contracts) for a worked conversion.
