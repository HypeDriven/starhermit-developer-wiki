import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SDK = require('../docs/sdk/starhermit-sdk.js');
const game = '00112233-4455-6677-8899-aabbccddeeff';
const user = '12345678-1234-4234-8234-123456789abc';
const token = (extra = {}) => 'x.' + Buffer.from(JSON.stringify({ sub: user, game_scope: game, exp: 9999999999, ...extra })).toString('base64url') + '.x';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture(fetch = async () => json({}), opts = {}) {
  const sockets = [], timers = new Map();
  let timerId = 0;
  class Socket {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code) { this.closed = code; }
  }
  const sdk = SDK.create({ fetch, WebSocket: Socket,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id), ...opts });
  sdk.autoRefresh = false;
  sdk.setToken(token());
  return { sdk, sockets, timers, reconnect: () => { const [id, t] = [...timers].find(([, t]) => t.ms === 1000); timers.delete(id); t.fn(); } };
}

test('unsigned authenticated helpers and sockets make no API calls', async () => {
  let calls = 0;
  const { sdk, sockets } = fixture(async () => { calls++; return json({}); });
  sdk.signOut();
  assert.deepEqual(await sdk.friends(), []);
  assert.equal(await sdk.getSession('session'), null);
  assert.equal(await sdk.loadJSON(), null);
  assert.equal(await sdk.writeSave('hello'), false);
  assert.equal(await sdk.acceptTerms('hash'), null);
  assert.equal(await sdk.setControl('jump', ['KeyJ']), null);
  sdk.connect('session', {}).send({ type: 'sync' });
  assert.equal(calls, 0); assert.equal(sockets.length, 0);
});

test('realtime helper marks input data and preserves caller payload', () => {
  const { sdk, sockets } = fixture();
  const data = { seq: 10, steer: 0.2 };
  sdk.connect('session', {}).send(data, true);
  assert.deepEqual(sockets[0].sent[0], { type: 'cmd', data: { seq: 10, steer: 0.2, type: 'input', realtime: true } });
  assert.deepEqual(data, { seq: 10, steer: 0.2 });
});

test('sequential and concurrent single-action rebindings preserve other actions', async () => {
  let map = { jump: ['Space'], fire: ['KeyF'] };
  const writes = [];
  const { sdk } = fixture(async (_, opts) => {
    if (opts.method === 'GET') return json({ actions: Object.entries(map).map(([action, codes]) => ({ action, codes })) });
    map = JSON.parse(opts.body).bindings; writes.push(map);
    return json({ actions: Object.entries(map).map(([action, codes]) => ({ action, codes })) });
  });
  await Promise.all([sdk.setControl('jump', ['KeyJ']), sdk.setControl('fire', ['KeyK'])]);
  assert.deepEqual(map, { jump: ['KeyJ'], fire: ['KeyK'] });
  assert.deepEqual(writes[0], { jump: ['KeyJ'], fire: ['KeyF'] });
});

test('failed controls read prevents a destructive replacement', async () => {
  let writes = 0;
  const { sdk } = fixture(async (_, opts) => {
    if (opts.method === 'GET') return json({ error: 'Unavailable' }, 503);
    writes++; return json({});
  });
  await assert.rejects(sdk.setControl('jump', ['KeyJ']), error => error.status === 503);
  assert.equal(writes, 0);
});

for (const code of [1000, 1008, 1009]) test(`close ${code} stops automatic reconnect`, () => {
  const { sdk, sockets, timers } = fixture();
  sdk.connect('session', {});
  sockets[0].onclose({ code });
  assert.equal(timers.size, 0);
});

test('network reconnect renews and checks REST membership before upgrading', async () => {
  const calls = [];
  const f = fixture(async (path, opts) => {
    calls.push(path);
    return path.endsWith('/launch-token') ? json({ token: token({ marker: 'new' }) }) : json({ status: 'active' });
  });
  f.sdk.connect('session', {});
  f.sockets[0].onclose({ code: 1006 }); f.reconnect(); await settle();
  assert.equal(f.sockets.length, 2);
  assert.match(calls[0], /launch-token$/); assert.match(calls[1], /sessions\/session$/);
  assert.ok(f.sockets[1].url.includes(encodeURIComponent(token({ marker: 'new' }))));
});

test('a finished session stops retries and reports unavailable', async () => {
  let failure;
  const f = fixture(async path => path.endsWith('/launch-token') ? json({ token: token() }) : json({ status: 'finished' }));
  f.sdk.connect('session', { onUnavailable: error => { failure = error; } });
  f.sockets[0].onclose({ code: 1006 }); f.reconnect(); await settle();
  assert.equal(f.sockets.length, 1); assert.equal(failure.status, 410); assert.equal(f.timers.size, 0);
});

test('stale build is diagnosed without opening another socket', async () => {
  let failure;
  const f = fixture(async path => path.endsWith('/launch-token') ? json({ token: token() }) : path.endsWith('/session') ? json({ status: 'active' }) : json({ buildId: 's2' }));
  f.sdk.connect('session', { onUnavailable: error => { failure = error; } }, { build: 's1' });
  f.sockets[0].onclose({ code: 1006 }); f.reconnect(); await settle();
  assert.equal(f.sockets.length, 1); assert.equal(failure.message, 'build_mismatch');
});

test('terms rejection preserves token and asks for consent instead of signing out', async () => {
  let asked = 0;
  const f = fixture(async () => json({ error: 'terms_acceptance_required', termsHash: 'hash' }, 403));
  f.sdk.connect('session', { onTermsRequired: () => asked++ });
  f.sockets[0].onclose({ code: 1006 }); f.reconnect(); await settle();
  assert.equal(asked, 1); assert.equal(f.sdk.signedIn, true); assert.equal(f.sockets.length, 1);
});

test('invalid JSON inside a ZIP save blocks later writes', async () => {
  let writes = 0;
  let sdk;
  const f = fixture(async (path, opts) => {
    if (opts.method === 'PUT') { writes++; return json({ etag: 'new' }); }
    if (path.endsWith('/info')) return json({ exists: true, etag: 'version' });
    return new Response(sdk._zip('save.json', new TextEncoder().encode('{broken')));
  });
  sdk = f.sdk;
  assert.equal(await sdk.loadJSON(), null); assert.equal(sdk.saveLoadFailed(), true);
  assert.equal(await sdk.writeSave('{}'), false); assert.equal(writes, 0);
});

test('missing cloud write acknowledgement does not emit saved true', async () => {
  const { sdk } = fixture(async (_, opts) => opts.method === 'PUT' ? new Response('', { status: 404 }) : json({ exists: false }));
  await sdk.loadJSON();
  let saved;
  sdk.on('saved', value => { saved = value; });
  assert.equal(await sdk.writeSave('{}'), false); assert.equal(saved, false);
});

test('direct sign-in only accepts a game UUID hosted origin', () => {
  for (const hostname of ['wiki.starhermit.com', 'localhost', `${game}.starhermit.com`]) {
    const f = fixture(undefined, { window: { location: { hostname } } });
    f.sdk.signOut();
    assert.equal(f.sdk.canSignIn(), hostname === `${game}.starhermit.com`);
  }
});

test('signing out discards an in-flight renewal rather than reauthenticating unsigned play', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const renewal = f.sdk.renewForReconnect();
  f.sdk.signOut('single-player');
  complete(json({ token: token({ marker: 'late' }) }));
  assert.equal(await renewal, 'relaunch'); assert.equal(f.sdk.signedIn, false); assert.equal(f.sdk.token, null);
});

test('sign-out cancels a debounced account save before another player can inherit it', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return json({ etag: 'v1' }); });
  f.sdk.saveJSON({ oldPlayer: true });
  assert.equal(f.timers.size, 1);
  f.sdk.signOut(); f.sdk.setToken(token({ sub: 'another-player' }));
  assert.equal(f.timers.size, 0); assert.equal(await f.sdk.flushSave(), false); assert.equal(calls, 0);
});
