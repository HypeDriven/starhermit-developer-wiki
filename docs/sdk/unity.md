# Unity SDK

The **Starhermit Unity SDK** ([HypeDriven/starhermit-unity-sdk](https://github.com/HypeDriven/starhermit-unity-sdk))
is a Unity Package Manager package with typed, asynchronous C# clients for the platform. It handles
HTTP requests, JSON parsing, token refresh and WebSocket reconnection.

| | |
|---|---|
| Package | `com.starhermit.sdk`, version 0.1.0 |
| Namespace | `Starhermit` |
| API baseline | REST v1 and WebSocket v1 |
| Newer REST features | Use `client.Raw` and model `RawJson` when this SDK version has no typed member |
| WebSocket protocols | all 6, one connection class each |
| Licence | MIT |

The SDK is a client, not a second implementation of the platform. Authorization, friendship,
entitlement, room membership, score validation, game outcomes and storage budgets stay
server-authoritative exactly as documented on the pages below — the SDK surfaces the server's answer
and its published limits rather than deciding or caching its own.

This page is the integration guide. Full package documentation lives in the repository under
`Packages/com.starhermit.sdk/Documentation~`.

## Requirements

- Unity 2021.3 LTS or newer, API compatibility level **.NET Standard 2.1**, C# 9.
- Mono and IL2CPP, with managed stripping from Disabled through **High** (the package ships its own
  `Runtime/link.xml`).
- No reflection, no dynamic code generation, no mandatory native plugin.

Every module compiles for every build target. Where a target genuinely lacks a capability — no
microphone on a headless server, no handshake headers in a browser — the call raises
`StarhermitFeatureUnavailableException` with a stable `Reason`, instead of failing the build or
disabling unrelated features.

| Capability | Desktop / mobile / console | WebGL | Headless server |
|---|---|---|---|
| REST | `UnityWebRequestTransport` | `UnityWebRequestTransport` | `HttpClientTransport` |
| WebSocket | `ClientWebSocketAdapter` | `WebGLSocketFactory` + bundled `.jslib` bridge | `ClientWebSocketAdapter` |
| OAuth | injected `IStarhermitOAuthBrowser` | injected browser adapter | URL handoff from the host |
| Token storage | injected store; `EncryptedFileTokenStore` opt-in | injected browser storage | injected store or memory |
| File transfer | `SystemFileStore` | injected sink | `SystemFileStore` |
| Voice capture / playback | `UnityMicrophoneCapture` / `UnityAudioPlayback` | injected browser media adapter | unavailable unless injected |
| Public-key signing | injected `IStarhermitSigner` | injected signer or browser crypto | injected signer |

## Install

Package Manager → **Add package from git URL**, or an entry in `Packages/manifest.json`. The package
sits in a subfolder of the repository, so the URL needs `path=`:

```json
{
  "dependencies": {
    "com.starhermit.sdk": "https://github.com/HypeDriven/starhermit-unity-sdk.git?path=/Packages/com.starhermit.sdk"
  }
}
```

Pin a release by appending `#<tag-or-commit>`:

```text
https://github.com/HypeDriven/starhermit-unity-sdk.git?path=/Packages/com.starhermit.sdk#v0.1.0
```

Unity shells out to `git`, so a private repository resolves only if the editor's git can authenticate
non-interactively — an SSH key (`git@github.com:HypeDriven/starhermit-unity-sdk.git?path=/Packages/com.starhermit.sdk`) or a
configured credential helper. A local path or a scoped registry works the same way. Import modifies no
project settings and performs no network access.

## Create a client

```csharp
using Starhermit;

var client = StarhermitClient.Create(new StarhermitOptions
{
    ApiBaseUri = new Uri("https://api.starhermit.com/api/v1/"),
    GameSlug   = "chess",
    TokenStore = myPlatformSecureStore,
    LogLevel   = StarhermitLogLevel.Warning
});

await client.InitializeAsync();               // loads a stored session, refreshes it if expired
var me = await client.Me.GetProfileAsync();
```

`Create` performs no I/O. Nothing touches the network until you initialise, call a service or open a
connection. The WebSocket base is derived from `ApiBaseUri` (`wss://<host>/ws/v1/`) unless you set
`WebSocketBaseUri` yourself.

`StarhermitClient` is `IDisposable`: disposal cancels in-flight requests, closes every connection it
handed out, stops heartbeats and releases audio. There is no static mutable state in the package, so
two clients can run side by side against different environments, and one client survives scene loads.

**A game published on the platform** is served from `https://<slug>.starhermit.com` with `/api` and
`/ws` proxied same-origin (see [GitHub Games](../api/github-games.md)). A WebGL build published that
way should point at its own origin so the browser makes same-origin calls:

```csharp
ApiBaseUri = new Uri("https://chess.starhermit.com/api/v1/")
```

For a local backend, `AllowInsecureTransport = true` permits `http`/`ws`. Client construction refuses a
non-HTTPS address without it, and the editor's build validation fails a non-development player build
that still has it set. It never disables certificate validation.

## Signing in

The three credential kinds described in [Authentication](../api/auth.md) are separate types in separate
stores in the SDK; none can stand in for another.

**OAuth** — the SDK opens the authorize URL through an injected `IStarhermitOAuthBrowser` and completes
the exchange:

```csharp
var session = await client.Auth.SignInWithOAuthAsync("google");
```

Use `BuildAuthorizeUri(provider)` plus `CompleteOAuthAsync(...)` instead when your platform hands the
redirect back through its own deep-link or embedded-browser plumbing.

**Public key** — the passwordless flow for embedded, console and dedicated-server players
(see [Dedicated Server + Embedded Player Onboarding](../tutorials/dedicated-server-onboarding.md)).
Supported key types are `Ed25519`, `ECDSA-P256` and `RSA-PSS`; the SDK never generates or stores a
private key, it calls an injected `IStarhermitSigner`:

```csharp
var session = await client.Auth.SignInWithPublicKeyAsync(signer);   // or (), using Options.Signer
```

> **Contract detail worth knowing.** The deployment verifies a challenge signature against its own
> PascalCase serialisation of the challenge, while the JSON you receive is camelCase — re-serialising
> the response would never verify. `StarhermitChallenge.CanonicalPayload` reproduces the exact bytes to
> sign, so hand-rolled signing must do the same.

**Game launch token** — minted per game and fenced into that game's surface:

```csharp
var chess = client.Games.ForSlug("chess");
await chess.AcquireLaunchTokenAsync();
var fenced = chess.WithLaunchToken();     // subsequent calls authorise with the launch token
```

Minting a launch token never replaces the account session. Which credential a request carries is
decided by the request pipeline, not by the service you called.

Access-token refresh is coordinated: a `401` buys at most one refresh and one replay, and concurrent
callers await the same refresh rather than starting several — with a rotating refresh token, a second
exchange would revoke the family and sign the player out. A definitive rejection raises `SessionExpired`
once; a transport failure leaves the session intact.

### Accepting the current terms

Check acceptance before starting heartbeats, game requests or sockets. Version 0.1.0 has
`AcceptTermsAsync`, but newer profile fields and terms discovery use its raw JSON support:

```csharp
var profile = await client.Me.GetProfileAsync(ct);
var needsAcceptance = profile.RawJson["termsAcceptanceRequired"].AsBooleanOrDefault();
var terms = await client.Raw.SendForJsonAsync(new StarhermitRequest("GET", "terms"), ct);
var textToDisplay = terms["text"].AsStringOrNull();
var displayedHash = terms["hash"].AsStringOrNull();
// Display textToDisplay. Retain displayedHash for this displayed revision.
// Only in the user's Accept handler, using an account session:
// await client.Me.AcceptTermsAsync(displayedHash, ct);
```

Do not use a sample revision label such as `terms-2026-08`: only the current hash from the API is
accepted. On `409`, fetch and display the new text for another acceptance. On
`403 terms_acceptance_required`, resolve acceptance before retrying; player launch tokens cannot
accept. See [Profile](../api/profile.md#terms-acceptance) for the complete flow.

## Where each wiki page lives in the SDK

Every REST area documented here has a service on the client, and every WebSocket protocol has a
connection class.

| Wiki page | SDK |
|---|---|
| [Authentication](../api/auth.md) | `client.Auth` (key enrolment and revocation also on `client.Me`) |
| [Profile](../api/profile.md) | `client.Me`, `client.Entitlements`, `StarhermitPresenceHeartbeat` |
| [Friends](../api/friends.md) | `client.Friends` |
| [Chat](../api/chat.md) | `client.Chat` + `StarhermitChatConnection` |
| [Voice](../api/voice.md) | `client.Voice` + `StarhermitVoiceConnection` |
| [Catalog](../api/catalog.md) | `client.Software`, `client.CloudSaves`, `client.Ratings`, `client.Wishlist` |
| [Activity](../api/activity.md) | `client.Activity` |
| [External Libraries](../api/external-libraries.md) | `client.Activity` (link, unlink, owned software, external launch) |
| [Achievements](../api/achievements.md) | `client.Achievements`, `client.Games.ForSlug(slug).GetAchievementsAsync()` |
| [Leaderboards](../api/leaderboards.md) | `client.Leaderboards` |
| [Games](../api/games.md) | `client.Games.ForSlug(slug)` + `StarhermitGameConnection` |
| [Realtime Rooms](../api/realtime.md) | `client.RealtimeRooms` + `StarhermitRealtimeConnection` |
| [Relay](../api/relay.md) | `client.Relay` + `StarhermitRelayConnection` |
| [Container Game Servers](../api/container-games.md) | `client.GameServer` (server-token exchange and session lookup) |
| [GitHub Games](../api/github-games.md) | `client.BrowserGames` + `StarhermitGameUploadConnection` |
| [Publisher](../api/publisher.md) | `client.Publishers`, `StarhermitBuildPublisher` |
| [Server clock](../getting-started.md#server-clock--get-apiv1time) | `client.Time`, `client.ServerClock` |

[Game Scripts](../api/game-scripts.md) has no SDK service: a script runs on the platform, and its
clients talk to it through the games API above.

## A session end to end

The lifecycle from [the integration walkthrough](../tutorials/chess-walkthrough.md), in C#:

```csharp
var chess = client.Games.ForSlug("chess");
await chess.AcquireLaunchTokenAsync();

var ticket = await chess.EnqueueMatchmakingAsync();
while (!ticket.IsMatched)
{
    await Task.Delay(TimeSpan.FromSeconds(2), ct);
    ticket = await chess.GetMatchmakingAsync(ct) ?? ticket;
}

using var game = client.CreateGameConnection(ticket.SessionId!.Value, "chess", useLaunchToken: true);
game.FrameReceived       += frame => ApplyServerState(frame);
game.AchievementUnlocked += unlock => ShowToast(unlock);
game.PresenceChanged     += (userId, online) => UpdateOpponentDot(userId, online);
game.ErrorReceived       += message => ShowError(message);

await game.ConnectAsync(ct);
await game.SendCommandAsync(writer =>
{
    writer.Write("type", "move");
    writer.Write("from", "e2");
    writer.Write("to",   "e4");
}, ct);
```

`SendCommandAsync` wraps the payload as `{"type":"cmd","data":…}`; `SendRealtimeInputAsync` is the
rate-limited path for continuous input. The connection does not tick game logic, predict authoritative
state, fabricate an outcome, or resend a possibly non-idempotent command after an ambiguous
disconnect — the server remains the only authority on what happened.

Every connection shares one state machine: `Disconnected`, `Connecting`, `Connected`, `Reconnecting`,
`Closing`, `Faulted`, with `StateChanged`, `Closed` and `Faulted` events, bounded outbound queues with
explicit backpressure, and ordered sends. Reconnection uses jittered backoff, re-acquires a current
token before each attempt, and **stops for good on an authorization or policy close** rather than
hammering a door the platform shut. It never assumes membership survived the gap: each protocol
refetches or rejoins on reconnect.

Credentials ride the `Authorization` header where the platform allows it and `?access_token=` on
`/ws/**` otherwise, because a browser cannot set handshake headers. The query token is redacted from
every log.

## Async, threading and Unity

Every I/O operation returns `Task` and takes a trailing `CancellationToken`. There are no `async void`
methods and no public method blocks the calling thread.

Events and progress callbacks are posted to the synchronization context the client was created on — so
if you create it on Unity's main thread, a handler may touch `GameObject`s directly. A headless server
can skip the hop with `options.CallbackDispatcher = ImmediateCallbackDispatcher.Instance`. Callbacks are
ordered per connection, and a handler that throws is reported to diagnostics without stopping the
receive loop.

`StarhermitLifecycle.Attach(client)` bridges Unity's application events: the presence heartbeat pauses
on suspension and sends immediately on resume, and the client is disposed on quit without synchronous
network work.

Models never reference `GameObject`, `MonoBehaviour` or a scene. `StarhermitTextures` converts avatar and
cover-art bytes into a `Texture2D` on the main thread — the caller owns the result and must destroy it.

## Errors, retries and pagination

| Status | Exception |
|---|---|
| 400 / 422 | `StarhermitBadRequestException`, `StarhermitValidationException` (field errors keyed by wire name) |
| 401 | `StarhermitAuthenticationException` |
| 402 | `StarhermitEntitlementException` |
| 403 | `StarhermitAuthorizationException` |
| 404 | `StarhermitNotFoundException` |
| 409 | `StarhermitConflictException` |
| 429 | `StarhermitRateLimitException` (carries `RetryAfter`) |
| 5xx | `StarhermitServerException` |

Each carries the status, the server's `{"error":"..."}` message, any machine-readable code, the request
id, `Retry-After`, redacted headers and a size-capped redacted body. A request that never reached the
API raises `StarhermitTransportException` or `StarhermitTimeoutException` — a transport failure is never
dressed up as an API response. Cancellation always surfaces as `OperationCanceledException`.

Retries are bounded, jittered, honour `Retry-After` up to a cap, and are limited to failures a second
attempt could survive: connection errors, timeouts, `408`, `429` and transient `5xx`. `403`, `404`, `409`
and validation failures are never retried, and a POST is retried only when it opts in with
`AsIdempotent`. A process-wide retry budget stops several clients turning one outage into a storm.

List endpoints return `StarhermitPage<T>` carrying the server's own paging metadata, plus lazy
enumeration that fetches a page only as it is consumed:

```csharp
await foreach (var title in client.Software.EnumerateTitlesAsync(query, cancellationToken: ct)) { … }
```

Downloads stream to an `IStarhermitFileStore` through a temporary file, verify a supplied SHA-256 and
are promoted atomically; `OpenDownloadAsync` reports `IsResumed` only for a real `206`, because
appending a whole file to a partial one would corrupt it while still passing a length check.

## Storing credentials

The package **ships no store that claims to be secure.** The default is in-memory; the opt-in
`EncryptedFileTokenStore` (AES-CBC with HMAC-SHA256 over a key your application supplies) is documented
as obfuscation at rest, not a keychain. Wire `IStarhermitTokenStore` to the platform's own secure
storage — Keychain, Keystore, the console SDK's user storage. `PlayerPrefs` is never presented as
secure.

Tokens, refresh tokens, private keys, client secrets and invoke keys are never serialised into a
`ScriptableObject`, a scene, `Resources`, a log, an exception message, a telemetry event or a build
artifact. `StarhermitSettings` holds only non-secret project defaults: addresses, slug, log level,
timeout and the development flag.

Redaction is structural — by header, query-parameter and JSON member name, at every depth — so a
credential this SDK version has never heard of is still stripped from logs, exceptions and telemetry.
URL fragments are dropped entirely. No telemetry is collected by default; an injected sink receives
event name, operation id, duration, status family, retry count, request id and outcome, never URLs,
bodies or player content.

## When the platform ships something new

Models are immutable and keep the JSON they were parsed from, so a field added to the deployment after
this SDK version is still readable, and an endpoint this version does not type is still callable with
the same credentials, retries and redaction as a typed call:

```csharp
var value = profile.RawJson["shippedAfterThisSdk"].AsStringOrNull();

var json  = await client.Raw.SendForJsonAsync(
    new StarhermitRequest("GET", "some/new/route").WithQuery("page", 1), ct);
```

Socket frames dispatch on their type discriminator with an unknown-frame fallback that preserves the
payload, unknown enum strings are kept as strings rather than coerced, and an unknown privacy level
reads as the **most** private interpretation. `Optional<T>` distinguishes omitted, explicit null and
value, which is what a PATCH body needs.

`client.GetDiagnostics()` returns connection states, queue depths, reconnect counts, token expiry, clock
freshness, in-flight requests, retries spent and the last redacted error — the snapshot to attach to a
bug report.

## Samples

Eight samples ship with the package and are compiled in CI, so they cannot drift from the API they
demonstrate: Authentication and Profile, Friends and Chat, Matchmaking Game, Realtime and Relay, Voice,
Catalog Services, Publisher Tool, and Dedicated Server.

## Verification status

The SDK's own suite (144 hermetic tests under `dotnet test`, the same files running as Unity EditMode
tests) and a generated coverage manifest that fails the build when an API operation has no SDK mapping
run on every change; five further tests read a live deployment when pointed at one, and are skipped
otherwise. The editor matrix and IL2CPP
player builds for Linux, Android and WebGL are defined in CI but need a licensed build farm, so the
platform table above states intended support — treat a target as qualified only once you have built for
it yourself.
