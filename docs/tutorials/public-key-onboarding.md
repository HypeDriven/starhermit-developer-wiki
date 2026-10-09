# Tutorial: Onboard Players with a Public Key

A StarHermit account does not need Google, GitHub or any other sign-in provider. Its credential can
be a key pair that your game generates on the player's device, plus an email address the player
confirms once. After that, your game signs in silently on every launch by signing a challenge with
the key. The player never types a password and never has to visit a StarHermit page.

This tutorial builds that flow end to end: generate the key, register it, wait for the player to
confirm, sign in, keep the session, and handle second devices and lost keys.

**Use this for** native and standalone games, launchers, Steam/Epic/GOG builds and desktop tools —
anything that runs on the player's machine and can keep a private key there.

**Use something else for**

- **A browser game hosted on StarHermit**, which already receives a launch token when opened from
  the dashboard, or can show a [Sign in button](../api/auth.md#sign-in-from-a-directly-opened-browser-game).
- **A CI pipeline**, which should enrol a key from an OAuth session with no email step:
  [Tutorial: upload builds from CI/CD](ci-cd-build-upload.md).
- **A dedicated game server**, which has its own deployment token and cannot create or act as
  players: [Tutorial: publish a dedicated server](dedicated-server-onboarding.md).

## What the player sees

1. Your game asks for an email address and their consent to create a StarHermit account.
2. They open the confirmation email and click the link.
3. Back in your game, they are signed in. On later launches nothing is asked at all.

An email address is required, and the player must click the link once. There is no way to create a
StarHermit account silently from a Steam, Epic or GOG identity alone.

## Before you start

The code on this page is plain JavaScript using WebCrypto and `fetch`, so it runs in a browser, in
Electron and in Node 20 or later. **The `js` blocks below, in order, form one ES module** — save them
together as `starhermit-key-auth.js`. Any other language works the same way: step 1 gives the exact
byte formats, and step 3 the exact bytes to sign.

```js
const API = 'https://api.starhermit.com';

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
```

## 1. Create the device key

Generate **one key pair per installation**, the first time your game needs an account. The private
key never leaves the device: not to your servers, not to StarHermit.

| `keyType` | `keyData` (standard Base64) | Signature (standard Base64) |
|---|---|---|
| `Ed25519` — recommended | The raw 32-byte public key | The raw 64-byte Ed25519 signature |
| `ECDSA-P256` | The public point: 65-byte uncompressed (`04‖X‖Y`) or 33-byte compressed | ECDSA with SHA-256, **ASN.1 DER-encoded** |
| `RSA-PSS` | `SubjectPublicKeyInfo` DER, 2048–8192-bit modulus, exponent ≤ 32 bits | RSASSA-PSS, SHA-256, MGF1-SHA-256, 32-byte salt |

`keyData` is at most 2,000 characters. One key belongs to one account across the platform.

Pick **Ed25519** unless your platform cannot produce it. If you use ECDSA, note that WebCrypto,
Windows CNG and most hardware keystores return the signature as raw `r‖s` (64 bytes). StarHermit
expects DER, so convert it — the module below does.

```js
// One key per installation. The private key can sign but is never exported.
export async function createDeviceKey(keyType = 'Ed25519') {
  const algorithm = keyType === 'Ed25519'
    ? { name: 'Ed25519' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
  const pair = await crypto.subtle.generateKey(algorithm, false, ['sign', 'verify']);
  return {
    keyType: keyType === 'Ed25519' ? 'Ed25519' : 'ECDSA-P256',
    keyData: b64(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: pair.privateKey,
  };
}
```

**Store the private key where the operating system protects it.** In a browser or Electron renderer,
a non-extractable `CryptoKey` can be kept in IndexedDB as it is. A native game should use the
platform keystore — Windows DPAPI or CNG, macOS Keychain, libsecret on Linux. Store `keyType` and
`keyData` next to it; you send them with every request.

## 2. Start registration

Ask for the player's email address and consent, then:

```js
async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function fail(step, { status, body }) {
  return Object.assign(new Error(`${step}: ${body.error ?? status}`), { status, body });
}

export async function register(key, email) {
  const res = await post('/api/v1/auth/public-key/register',
    { email, keyType: key.keyType, keyData: key.keyData });
  if (res.status !== 202) throw fail('register', res);
  return res.body; // { registrationId, email, emailSent, deferralReason, message }
}
```

`202` means StarHermit accepted the registration. If `emailSent` is `false`, the email is queued and
will still arrive; `deferralReason` says why it waited. Nothing is attached to any account yet.

Three rules shape your UI:

- **One registration per email address, and one per IP address, every 24 hours.** A second attempt
  is `429` with `Retry-After`. Have the player confirm the address before you send it, because a typo
  costs them a day. Send the request from the player's device, never through your own server: every
  player would share your server's IP and its single daily registration.
- **The link expires after 4 hours.** If it lapses, the player can register again once the 24 hours
  are up.
- **`400`** means the email address or key material was rejected; `error` says which.

## 3. Sign in with the key

Signing in is a challenge and a response. `POST /api/v1/auth/public-key/challenge` returns:

```json
{
  "challengeId": "4fc4d72b-4c12-41ca-a500-dc13cccc3865",
  "payload": {
    "challengeId": "4fc4d72b-4c12-41ca-a500-dc13cccc3865",
    "fingerprint": "9c0b7a…",
    "issuer": "starhermit",
    "audience": "starhermit",
    "expiry": "2026-10-09T14:21:41.9264875+00:00",
    "nonce": "NmL+tgMum6HXU/pa3T9xjQ==",
    "clientTimestamp": "2026-10-09T14:16:41.9265739+00:00"
  },
  "expiresIn": 300
}
```

**What you sign is not the JSON you received.** StarHermit verifies the signature over its own
serialization of `payload`:

- compact JSON, no whitespace;
- **PascalCase** member names, in exactly the order `ChallengeId`, `Fingerprint`, `Issuer`,
  `Audience`, `Expiry`, `Nonce`, `ClientTimestamp`;
- every value copied **exactly as served** — do not parse and reformat the dates;
- every `+` in the nonce written as `+`. The `+` in the dates stays as it is.

For the challenge above, the signed bytes are the UTF-8 encoding of:

```text
{"ChallengeId":"4fc4d72b-4c12-41ca-a500-dc13cccc3865","Fingerprint":"9c0b7a…","Issuer":"starhermit","Audience":"starhermit","Expiry":"2026-10-09T14:21:41.9264875+00:00","Nonce":"NmL+tgMum6HXU/pa3T9xjQ==","ClientTimestamp":"2026-10-09T14:16:41.9265739+00:00"}
```

Get any of that wrong and the answer is `401 "Invalid signature."`, which no retry will fix.

```js
const FIELDS = ['challengeId', 'fingerprint', 'issuer', 'audience', 'expiry', 'nonce', 'clientTimestamp'];

export function challengeSigningBytes(payload) {
  const members = FIELDS.map((field) => {
    let value = JSON.stringify(payload[field]);
    if (field === 'nonce') value = value.replaceAll('+', '\\u002B');
    return `"${field[0].toUpperCase()}${field.slice(1)}":${value}`;
  });
  return new TextEncoder().encode(`{${members.join(',')}}`);
}

export async function signChallenge(key, payload) {
  const data = challengeSigningBytes(payload);
  if (key.keyType === 'Ed25519')
    return b64(await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, data));
  // WebCrypto returns an ECDSA signature as raw r||s; the server expects ASN.1 DER.
  const rs = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, data));
  return b64(derEcdsaSignature(rs));
}

function derEcdsaSignature(rs) {
  const integer = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const value = [...bytes.slice(i)];
    return value[0] & 0x80 ? [0x02, value.length + 1, 0, ...value] : [0x02, value.length, ...value];
  };
  const body = [...integer(rs.slice(0, 32)), ...integer(rs.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

// Resolves to { userId, accessToken, refreshToken }, or null while the key is not attached to
// an account yet — the player has not opened the link, it expired, or the key was revoked.
export async function signIn(key) {
  const { keyType, keyData } = key;
  const challenge = await post('/api/v1/auth/public-key/challenge', { keyType, keyData });
  if (challenge.status !== 200) throw fail('challenge', challenge);
  const signature = await signChallenge(key, challenge.body.payload);
  const done = await post('/api/v1/auth/public-key/complete',
    { challengeId: challenge.body.challengeId, signature, keyType, keyData });
  if (done.status === 200) return done.body;
  if (done.status === 401 && done.body.error === 'Public key not registered or revoked.') return null;
  throw fail('complete', done); // "Invalid signature." will never succeed: fix it, don't retry it
}
```

A challenge lasts five minutes and is single-use, even when the attempt fails, so request a fresh one
for every attempt. Challenge and complete share a limit of 60 requests a minute per IP address.

## 4. Wait for the player to confirm

When the player opens the emailed link, StarHermit creates their account, attaches your key and
marks the address verified. If an account already uses that address, the key is added to it instead,
so a player who already has a StarHermit account keeps it. On starhermit.com the link then opens the
StarHermit dashboard, already signed in.

**Your game never receives the tokens from that link**, and does not need them. The link may be
opened on a phone, in another browser, or by a mail scanner that previews links. Once the key is
attached, your game can simply sign in with it. So show a "check your inbox" screen and keep trying:

```js
// Poll until the player opens the emailed link. Two requests per attempt, so every 5 s stays
// well inside the 60-per-minute sign-in limit.
export async function waitUntilConfirmed(key, { intervalMs = 5000, signal } = {}) {
  for (;;) {
    signal?.throwIfAborted();
    const session = await signIn(key);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
```

Putting steps 1 to 4 together:

```javascript
import { createDeviceKey, register, signIn, waitUntilConfirmed } from './starhermit-key-auth.js';

const key = await loadStoredKey() ?? await saveKey(await createDeviceKey());
let session = await signIn(key);                // a returning player is signed in here
if (!session) {
  const email = await askForEmailAndConsent();
  await register(key, email);
  showCheckYourInbox(email);
  session = await waitUntilConfirmed(key, { signal: cancelButton.signal });
}
```

`loadStoredKey`, `saveKey`, `askForEmailAndConsent` and `showCheckYourInbox` are yours to write.
Offer a **Cancel** that aborts the wait, and stop polling after four hours, when the link expires.

## 5. Keep the session

`complete` returns a 15-minute access token and a refresh token that lasts seven days and rotates.
Send the access token as `Authorization: Bearer …`, and refresh before it expires:

```js
// Resolves to the new pair, or null when the session is over — sign in with the key again.
export async function refresh(refreshToken) {
  const res = await post('/api/v1/auth/refresh', { refreshToken });
  return res.status === 200 ? res.body : null; // { accessToken, refreshToken }
}
```

Replace **both** tokens every time. Presenting a used refresh token ends the whole session, so make
sure two threads or processes never refresh at once. When `refresh` returns `null`, call `signIn` —
no email is involved. The key is the long-lived credential; tokens are just a cache of it.

## 6. Finish setting up the account

**Terms.** A new account must accept the current StarHermit terms before it can use anything else.
Call `GET /api/v1/me`. If `termsAcceptanceRequired` is `true`, show the text from
`GET /api/v1/terms`, and when the player accepts it, send its hash to `POST /api/v1/me/terms/accept`.
Check again on later launches, because the terms are revised. Details:
[Terms acceptance](../api/profile.md#terms-acceptance).

**Name.** The account starts with a `pk-…` username. Let the player choose a nickname:

```http
PATCH /api/v1/me
Authorization: Bearer <access-token>
Content-Type: application/json

{ "nickname": "RookPilot" }
```

From here the account is like any other: friends, chat, matchmaking, cloud saves, achievements.

## 7. Second devices, lost keys, and limits

**A second device** generates its own key and registers it with **the same email address**. When the
player confirms, the key joins their existing account rather than creating a new one. The 24-hour
limit per address applies here too.

**A lost or stolen device.** `POST /api/v1/auth/public-key/revoke-request` with `{ "email": "…" }`
emails a confirmation link. Opening it revokes **every** key on the account and ends the sessions
those keys signed in. The request always answers `202` with the same message, whether or not the
address has an account. The link expires after four hours, and an account can ask once every 15
minutes. Afterwards, each remaining device registers again (step 2).

**What a key-only account cannot do.** A few changes protect the account's credentials, so they
require a session that signed in through a provider such as Google or GitHub:

| Action | Key-only account |
|---|---|
| Add or remove a key from a signed-in session (`POST`/`DELETE /me/public-keys`) | `403` — add a key by registering again; remove keys only all at once, as above |
| Change the account's email address | `403 oauth_session_required` — not possible until a provider is linked |
| Remove a single key | Not possible — revoke all, then re-register the devices you keep |

The way out of all three is to link a provider. When a key-only account links one, the link is held
until the player confirms it from their email. After that, a provider sign-in can do everything above.
See [`authorize?link=true`](../api/auth.md#get-apiv1authoauthproviderauthorizelinkclient).

## Troubleshooting

| Response | Meaning | Fix |
|---|---|---|
| `register` → `400` "Key data is not a valid … key" | `keyData` is in the wrong format for its `keyType` | Check the table in step 1. Ed25519 and ECDSA take raw key bytes, not `SubjectPublicKeyInfo` |
| `register` → `429` | This address or IP registered in the last 24 hours | Wait for `Retry-After`; don't retry in a loop |
| `complete` → `401` "Public key not registered or revoked." | The player hasn't opened the link, it expired, or the key was revoked | Keep waiting (step 4), or register again |
| `complete` → `401` "Invalid signature." | The signed bytes or signature format don't match | Rebuild the signed string exactly (step 3). For ECDSA, send DER, not `r‖s` |
| `complete` → `401` "Challenge not found or expired." | The challenge was older than five minutes or already used | Request a new challenge for each attempt |
| `challenge` / `complete` → `429` | More than 60 sign-in requests a minute from this IP | Poll less often |
| `verify` link → `400` "Verification token not found." or "…already been used." | The link was opened before — often by a mail scanner previewing it | If your game can sign in, the key is attached and nothing is wrong. If not, register again |
| `verify` link → `400` "Verification token has expired." | More than four hours passed | Register again |
| `verify` link → `400` "…already registered to another account." | This key belongs to a different account | Generate a new key on this device |
| `403` "This account is suspended." | The account is suspended | Nothing your game can fix |
