# Upload Builds from CI/CD with an OAuth-enrolled Public Key

This tutorial gives a deployment pipeline its own StarHermit credential without storing your Google
or GitHub OAuth tokens in CI. The one-time setup is interactive:

1. Sign in through OAuth.
2. Add a dedicated public key to your StarHermit account.
3. Put only that key's private half in the CI secret store.

Each pipeline run then signs a short-lived StarHermit challenge, receives an ordinary 15-minute
access token, and uploads the new build. The pipeline key acts as your account and can update only
games that account owns.

## Why use a separate deployment key?

Do not save an OAuth access or refresh token in CI. A StarHermit public key is a better machine
credential because it can be labelled, audited, and revoked independently. A session authenticated
by that key **cannot add or revoke keys**; those operations require a fresh OAuth-authenticated
session. If the CI secret leaks, sign in with Google or GitHub and revoke the deployment key.
Revocation also ends refresh sessions created by that key and makes its existing access tokens fail
on their next API request.

Use one key per repository/environment, for example `orbit-league-production`, rather than sharing
one private key among every workflow.

## Prerequisites

- A StarHermit account signed in through Google or GitHub OAuth.
- An existing game owned by that account. Save its `id` as `GAME_ID`; the bundle endpoint updates a
  game but does not create one.
- A distributable client build and/or a Docker-compatible `docker save` image. See
  [GitHub Games](../api/github-games.md#push-a-game-bundle) for the archive layout.
- Python 3 for the setup commands and example workflow; `curl` and `jq` for the enrollment example.

## One-time setup

### 1. Generate a deployment key locally

The example uses Ed25519. Run this on a trusted workstation, not in the CI job:

```bash
python -m pip install cryptography
python - <<'PY'
import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

key = Ed25519PrivateKey.generate()
private = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
public = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
print("STARHERMIT_PRIVATE_KEY=" + base64.b64encode(private).decode())
print("STARHERMIT_PUBLIC_KEY=" + base64.b64encode(public).decode())
PY
```

The private value is the 32-byte seed and is shown once in this trusted local terminal. Never commit
it, print it in CI logs, put it in an artifact, or send it to StarHermit. Keep the public value for
the next step and for the workflow variable.

### 2. Sign in with OAuth and add the public key

Open one of these URLs in a browser:

```text
https://api.starhermit.com/api/v1/auth/oauth/github/authorize
https://api.starhermit.com/api/v1/auth/oauth/google/authorize
```

After the callback, use the returned OAuth-authenticated access token immediately. Put it in a local
environment variable rather than in shell history:

```bash
read -rsp 'OAuth access token: ' OAUTH_ACCESS_TOKEN; echo
read -rp  'Public key: ' STARHERMIT_PUBLIC_KEY

curl -sS -X POST https://api.starhermit.com/api/v1/me/public-keys \
  -H "Authorization: Bearer $OAUTH_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n \
    --arg keyData "$STARHERMIT_PUBLIC_KEY" \
    --arg label 'orbit-league-production' \
    '{keyType:"Ed25519", keyData:$keyData, label:$label}')"
```

The call returns `201` and the key record. A `403` means this token did not come from an OAuth
session (an email-verification, public-key, or game launch token is not enough). A `409` means the
key is already active or the account has reached its active-key limit.

Check the result with `GET /api/v1/me/public-keys`. The list includes labels, fingerprints, last-use
times, and revoked keys, so it is also the credential audit trail.

### 3. Configure the repository

In GitHub, add:

- Actions secret `STARHERMIT_PRIVATE_KEY`: the Base64 private seed.
- Actions variable `STARHERMIT_PUBLIC_KEY`: the Base64 raw public key.
- Actions variable `STARHERMIT_GAME_ID`: the owned game's ID.

Protect production with a GitHub Environment if approval is required. The equivalent values can be
stored in GitLab protected variables, Azure Key Vault, or any other CI secret store.

## Add the authentication/upload helper

Commit the following as `ci/starhermit_upload.py`. It reconstructs the exact challenge JSON that
StarHermit signs internally, authenticates with Ed25519, and chooses HTTP for small archives or the
upload WebSocket for archives over 90 MB. The WebSocket avoids the CDN's roughly 100 MB HTTP-body
limit.

```python
#!/usr/bin/env python3
import argparse, asyncio, base64, json, os
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def authenticate(api, public_key, private_key):
    challenge = requests.post(
        f"{api}/api/v1/auth/public-key/challenge",
        json={"keyType": "Ed25519", "keyData": public_key}, timeout=30)
    challenge.raise_for_status()
    body = challenge.json()
    p = body["payload"]

    # Public JSON is camelCase; the server verifies its ChallengePayload serialization, whose
    # property names and order are the PascalCase sequence below.
    signed_payload = json.dumps({
        "ChallengeId": p["challengeId"],
        "Fingerprint": p["fingerprint"],
        "Issuer": p["issuer"],
        "Audience": p["audience"],
        "Expiry": p["expiry"],
        "Nonce": p["nonce"],
        "ClientTimestamp": p["clientTimestamp"],
    }, separators=(",", ":")).encode()

    seed = base64.b64decode(private_key, validate=True)
    signature = Ed25519PrivateKey.from_private_bytes(seed).sign(signed_payload)
    complete = requests.post(
        f"{api}/api/v1/auth/public-key/complete",
        json={"challengeId": body["challengeId"],
              "signature": base64.b64encode(signature).decode(),
              "keyType": "Ed25519", "keyData": public_key}, timeout=30)
    complete.raise_for_status()
    return complete.json()["accessToken"]


def upload_http(api, game_id, token, archive):
    with archive.open("rb") as stream:
        response = requests.post(
            f"{api}/api/v1/me/github-games/{game_id}/bundle",
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/gzip"},
            data=stream, timeout=1800)
    response.raise_for_status()
    print(json.dumps(response.json()))


async def upload_websocket(api, game_id, token, archive):
    import websockets
    parsed = urlparse(api)
    uri = urlunparse(("wss" if parsed.scheme == "https" else "ws", parsed.netloc,
                      "/ws/v1/game-upload", "",
                      f"gameId={quote(game_id)}&access_token={quote(token)}", ""))
    async with websockets.connect(uri, max_size=None, ping_interval=20) as ws:
        ready = json.loads(await ws.recv())
        if ready.get("type") != "ready":
            raise RuntimeError(ready)
        with archive.open("rb") as stream:
            while chunk := stream.read(512 * 1024):
                await ws.send(chunk)
        await ws.send(json.dumps({"type": "complete"}))
        while True:
            message = json.loads(await ws.recv())
            if message.get("type") == "result":
                print(json.dumps(message))
                return
            if message.get("type") == "error":
                raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--api", default="https://api.starhermit.com")
    args = parser.parse_args()
    game_id = os.environ["STARHERMIT_GAME_ID"]
    token = authenticate(args.api.rstrip("/"), os.environ["STARHERMIT_PUBLIC_KEY"],
                         os.environ["STARHERMIT_PRIVATE_KEY"])
    if args.archive.stat().st_size < 90 * 1024 * 1024:
        upload_http(args.api.rstrip("/"), game_id, token, args.archive)
    else:
        asyncio.run(upload_websocket(args.api.rstrip("/"), game_id, token, args.archive))


if __name__ == "__main__":
    main()
```

Treat a non-zero exit as a failed deployment. Do not log the access token or complete request body.
The access token lasts 15 minutes, so authenticate immediately before uploading; the WebSocket
checks it during the handshake and may finish after the token expires.

## GitHub Actions example

This example publishes the contents of `dist/` on every push to `main`:

{% raw %}
```yaml
name: Deploy to StarHermit
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Build
        run: |
          npm ci
          npm run build

      - name: Package StarHermit bundle
        run: |
          mkdir -p bundle/client
          cp -R dist/. bundle/client/
          cp starhermit.txt bundle/starhermit.txt
          tar -C bundle -czf game-bundle.tar.gz .

      - name: Install uploader dependencies
        run: python -m pip install 'cryptography>=42,<45' 'requests>=2.31,<3' 'websockets>=12,<13'

      - name: Upload build
        env:
          STARHERMIT_PRIVATE_KEY: ${{ secrets.STARHERMIT_PRIVATE_KEY }}
          STARHERMIT_PUBLIC_KEY: ${{ vars.STARHERMIT_PUBLIC_KEY }}
          STARHERMIT_GAME_ID: ${{ vars.STARHERMIT_GAME_ID }}
        run: python ci/starhermit_upload.py game-bundle.tar.gz
```
{% endraw %}

For a dedicated server, add `docker build`, save the image to `bundle/server/image.tar`, and retain
`starhermit.txt` at the bundle root:

```bash
docker build -t my-game-server:${GITHUB_SHA} -f Dockerfile.server .
mkdir -p bundle/server
docker save my-game-server:${GITHUB_SHA} -o bundle/server/image.tar
tar -C bundle -czf game-bundle.tar.gz .
```

A successful bundle upload means StarHermit accepted and atomically published the bundle; it does
not mean a new container has passed health checks. Poll
`GET /api/v1/me/github-games/{id}/deployment` with the same freshly authenticated token and run a
smoke test before promoting the release.

## Rotation and incident response

1. Sign in through OAuth.
2. Add a newly generated, distinctly labelled key.
3. Replace the CI secret and variable, then run a deployment.
4. Revoke the old key with `DELETE /api/v1/me/public-keys/{keyId}`.

For a suspected broad compromise, `DELETE /api/v1/me/public-keys/all` revokes every active key.
Both delete operations require an OAuth-authenticated session. A pipeline authenticated by its own
key cannot revoke itself, add a replacement, change the account email, or remove an OAuth identity.

## See also

- [Profile: public-key management](../api/profile.md#public-keys)
- [Authentication: public-key login](../api/auth.md#public-key-login)
- [GitHub Games: push a game bundle](../api/github-games.md#push-a-game-bundle)
- [GitHub Games: upload over a WebSocket](../api/github-games.md#upload-over-a-websocket)
