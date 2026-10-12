import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markdown = await readFile(new URL('../docs/tutorials/public-key-onboarding.md', import.meta.url), 'utf8');
const code = [...markdown.matchAll(/^```js\n([\s\S]*?)^```/gm)].map(match => match[1]).join('\n');
const example = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const payload = {
  challengeId: '4fc4d72b-4c12-41ca-a500-dc13cccc3865', fingerprint: '9c0b7a',
  issuer: 'starhermit', audience: 'starhermit', expiry: '2026-10-09T14:21:41.9264875+00:00',
  nonce: 'NmL+tgMum6HXU/pa3T9xjQ==', clientTimestamp: '2026-10-09T14:16:41.9265739+00:00',
};

test('the onboarding snippets concatenate into a module with canonical challenge bytes', () => {
  const actual = new TextDecoder().decode(example.challengeSigningBytes(payload));
  const expected = '{"ChallengeId":"4fc4d72b-4c12-41ca-a500-dc13cccc3865","Fingerprint":"9c0b7a","Issuer":"starhermit","Audience":"starhermit","Expiry":"2026-10-09T14:21:41.9264875+00:00","Nonce":"NmL\\u002BtgMum6HXU/pa3T9xjQ==","ClientTimestamp":"2026-10-09T14:16:41.9265739+00:00"}';
  assert.equal(actual, expected);
  const signedExample = markdown.match(/^```text\n(\{"ChallengeId"[^\n]+)\n```/m)[1];
  assert.equal(signedExample.replace('9c0b7a…', '9c0b7a'), expected);
});

test('the device helper generates a non-extractable key and a verifiable Ed25519 signature', async () => {
  const key = await example.createDeviceKey();
  assert.equal(key.privateKey.extractable, false);
  const signature = Buffer.from(await example.signChallenge(key, payload), 'base64');
  const publicKey = await crypto.subtle.importKey('raw', Buffer.from(key.keyData, 'base64'), 'Ed25519', false, ['verify']);
  assert.equal(await crypto.subtle.verify('Ed25519', publicKey, signature, example.challengeSigningBytes(payload)), true);
  await assert.rejects(example.createDeviceKey('RSA-PSS'), /This helper supports/);
});
