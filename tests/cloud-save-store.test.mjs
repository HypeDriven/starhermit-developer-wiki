import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudSaveStore } from '../docs/sdk/cloud-save-store.js';
const valid = value => value?.version === 1 && Number.isSafeInteger(value.points);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const create = request => new CloudSaveStore({ gameId: 'game', token: () => 'token', fetch: request });

test('load before write; absent slot writes only if it stays absent', async () => {
  const calls = [];
  const store = create(async (_, opts) => { calls.push(opts); return opts.method === 'PUT' ? json({ etag: '"v1"' }) : new Response('', { status: 404 }); });
  await assert.rejects(store.save({ version: 1, points: 1 }), /Load and validate/);
  assert.equal(await store.load(valid), null);
  await store.save({ version: 1, points: 1 });
  assert.equal(calls[1].headers['If-None-Match'], '*'); assert.equal(store.etag, '"v1"');
});

test('two devices saving the same version expose conflict without overwriting', async () => {
  let remote = { version: 1, points: 1 }, etag = '"v1"', writes = 0;
  const request = async (_, opts) => {
    if (opts.method !== 'PUT') return json(remote, 200, { ETag: etag });
    writes++;
    if (opts.headers['If-Match'] !== etag) return json({ error: 'precondition_failed', etag }, 412);
    remote = JSON.parse(Buffer.from(JSON.parse(opts.body).dataBase64, 'base64').toString());
    etag = '"v2"'; return json({ etag });
  };
  const a = create(request), b = create(request);
  await a.load(valid); await b.load(valid);
  await a.save({ version: 1, points: 2 });
  await assert.rejects(b.save({ version: 1, points: 3 }), error => error.status === 412);
  assert.equal(b.loaded, false); assert.equal(remote.points, 2);
  await assert.rejects(b.save({ version: 1, points: 3 }), /Load and validate/); assert.equal(writes, 2);
  assert.equal((await b.load(valid)).points, 2);
});

for (const status of [401, 403, 503]) test(`failed read ${status} never enables an upload`, async () => {
  let calls = 0;
  const store = create(async () => { calls++; return json({ error: 'failed' }, status); });
  await assert.rejects(store.load(valid), error => error.status === status);
  await assert.rejects(store.save({}), /Load and validate/); assert.equal(calls, 1);
});

test('invalid JSON or unknown format preserves remote data', async () => {
  for (const body of ['{bad', '{"version":99,"points":1}']) {
    const store = create(async () => new Response(body, { headers: { ETag: '"v1"' } }));
    await assert.rejects(store.load(valid)); assert.equal(store.loaded, false);
    await assert.rejects(store.save({}), /Load and validate/);
  }
});

test('missing ETag prevents unconditional writes', async () => {
  const store = create(async () => json({ version: 1, points: 1 }));
  await assert.rejects(store.load(valid), /version unavailable/); assert.equal(store.loaded, false);
});

test('ambiguous write failure requires reread', async () => {
  const store = create(async (_, opts) => {
    if (opts.method === 'PUT') throw new Error('connection lost');
    return new Response('', { status: 404 });
  });
  await store.load(valid);
  await assert.rejects(store.save({ version: 1, points: 1 }), /connection lost/); assert.equal(store.loaded, false);
});
