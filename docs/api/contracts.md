# REST and WebSocket contracts

These downloadable contracts complement the reference pages. Use them to inspect operations,
validate example payloads, or import REST requests into an OpenAPI-compatible client.

| File | Coverage |
|---|---|
| [OpenAPI REST contract](../contracts/openapi.json) | Public REST methods, paths, parameters, JSON request models, success responses, and credential families; reserved generation operations are marked unavailable |
| [WebSocket JSON schemas](../contracts/websocket.schema.json) | Known text frames by protocol and direction; application-owned gameplay/signaling data remains open |
| [Binary layouts](../contracts/binary-protocols.json) | Realtime sender prefix, voice prefix, unframed relay, container stream header, and upload chunks |

## REST contracts

The REST file uses [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html) and the public API origin. Each operation links to its reference page,
which carries the complete authorization, validation, limits, and error rules. `x-credentials`
identifies the accepted credential families; it does not replace ownership or membership checks.
`x-required-policies` describes named permissions where the API applies them.

Responses may include additional fields. Game-specific JSON, metadata, diagnostics, and upload
results use open shapes where the game or endpoint reference defines their contents. Success
schemas are not a promise that every caller is authorized. Endpoint errors can be JSON, plain text,
empty responses, or validation Problem Details; use [defensive response parsing](conventions.md#requests-and-responses).

Do not treat reserved generation operations as a working service. Their contract describes the
current `503 overloaded` response, not future request fields or generation behavior.

## WebSocket contracts

Choose a `$defs` schema for your socket's protocol and direction. For example, validate a client
movement frame against `GameRealtimeInput`, rather than the generic durable `GameCommand`:

```json
{ "type": "cmd", "data": { "type": "input", "realtime": true, "seq": 1, "x": 0.5 } }
```

`realtime` belongs **inside `data`**. The gameplay fields after it are your game's contract.
Use a [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core) validator with the complete schema document so local references resolve.
The root document contains definitions; selecting a definition is required to validate a frame.

| Protocol | Client text definition | Server text definition | Binary data |
|---|---|---|---|
| Games | `GameCommand` / `GameRealtimeInput` | `GameServerFrame` | Text gameplay only |
| Realtime rooms | `RealtimeClientControl` | `RealtimeServerFrame` | Host-routed game data, 16-byte sender participant prefix on receive |
| Voice | `VoiceClientControl` | `VoiceServerEvent` | Audio, 16-byte sender user prefix on receive |
| Chat | No client commands; use REST | `ChatServerPush` | None |
| Peer relay | No JSON framing | No JSON framing | Payload unchanged; no identity prefix |
| Game upload | `UploadClientControl` | `UploadServerFrame` | Archive chunks |
| Container control | `ContainerControl` from the server | No general acknowledgement envelope | Gameplay uses the separate container `/stream` |

Future frame types should reach your client's unknown-frame handler rather than crash the receive
loop. JSON shape validation does not validate game rules, authorize membership, or enforce rate
limits. Reference pages define role and size/rate restrictions.

## GUID byte order

The first three UUID groups are little-endian in a .NET GUID byte header. For example:

```text
UUID:  00112233-4455-6677-8899-aabbccddeeff
Bytes: 33 22 11 00 55 44 77 66 88 99 aa bb cc dd ee ff
```

A browser decoder for the 16-byte prefix:

```js
function guidFromDotNet(bytes) {
  if (bytes.length !== 16) throw new Error('Expected a 16-byte GUID');
  const hex = i => bytes[i].toString(16).padStart(2, '0');
  return `${hex(3)}${hex(2)}${hex(1)}${hex(0)}-${hex(5)}${hex(4)}-${hex(7)}${hex(6)}-` +
    `${hex(8)}${hex(9)}-${hex(10)}${hex(11)}${hex(12)}${hex(13)}${hex(14)}${hex(15)}`;
}
```

Realtime prefixes identify **participants**, while voice prefixes identify **users**. A container
stream has a one-byte type followed by session/user UUIDs, so its JSON begins at byte **33**. The
relay adds no prefix. Reading every socket as the same binary layout corrupts payloads and identity.

See [credentials and identifiers](../credentials.md), [session lifecycle](../session-lifecycle.md),
and [WebSocket troubleshooting](../troubleshooting.md#websockets).
