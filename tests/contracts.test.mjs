import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const api = JSON.parse(await readFile(new URL('../docs/contracts/openapi.json', import.meta.url)));
const frames = JSON.parse(await readFile(new URL('../docs/contracts/websocket.schema.json', import.meta.url)));
const binary = JSON.parse(await readFile(new URL('../docs/contracts/binary-protocols.json', import.meta.url)));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(frames);
const uuid = '00112233-4455-6677-8899-aabbccddeeff';

test('REST contract is valid OpenAPI with complete path parameters and unique operations', async () => {
  await SwaggerParser.validate(structuredClone(api));
  const ids = new Set();
  for (const [path, operations] of Object.entries(api.paths)) {
    for (const operation of Object.values(operations)) {
      assert.ok(!ids.has(operation.operationId)); ids.add(operation.operationId);
      const expected = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();
      const actual = operation.parameters.filter(p => p.in === 'path' && p.required).map(p => p.name).sort();
      assert.deepEqual(actual, expected);
      assert.ok(operation.externalDocs.url.startsWith('https://wiki.starhermit.com/'));
      assert.ok(Object.keys(operation.responses).some(key => key !== 'default'));
    }
  }
  assert.equal(ids.size, 285);
  assert.ok(!api.paths['/api/v1/game-host/{id}/cache-policy']);
  assert.ok(!api.paths['/api/v1/webhooks/email/resend']);
});

test('credential contracts distinguish owner, player, server and reserved calls', () => {
  assert.deepEqual(api.paths['/api/v1/me/game-invites'].get['x-credentials'], ['account']);
  assert.ok(api.paths['/api/v1/me/terms/accept'].post['x-credentials'].includes('player-launch'));
  assert.deepEqual(api.paths['/api/v1/games/{slug}/server/sessions/{sessionId}'].get['x-credentials'], ['container-server']);
  assert.deepEqual(api.paths['/api/v1/games/{slug}/diagnostics'].get['x-credentials'], ['account-owner']);
  assert.equal(api.paths['/api/v1/games/{slug}/generation/jobs'].post['x-availability'], 'reserved-unavailable');
  assert.ok(api.paths['/api/v1/games/{slug}/generation/jobs'].post.responses['503']);
  assert.equal(api.paths['/api/v1/me/github-games/upload'].post.requestBody.content['application/gzip'].schema.format, 'binary');
});

test('each WebSocket JSON definition compiles and protocol fixtures validate', () => {
  for (const name of Object.keys(frames.$defs)) assert.ok(ajv.getSchema(`${frames.$id}#/$defs/${name}`));
  const fixtures = {
    GameCommand: { type: 'cmd', data: { type: 'sync' } },
    GameRealtimeInput: { type: 'cmd', data: { type: 'input', realtime: true, seq: 1 } },
    GameServerFrame: { type: 'resumed', sessionId: uuid, lostMs: 750 },
    RealtimeClientControl: { type: 'ready' },
    RealtimeServerFrame: { type: 'ready', from: uuid },
    VoiceClientControl: { type: 'deafen', deafened: true },
    VoiceServerEvent: { event: 'voice.roster', data: { roomId: uuid, participants: [{ userId: uuid, muted: true, serverMuted: false }] } },
    ChatServerPush: { type: 'game_invite', payload: { inviteId: uuid } },
    UploadClientControl: { type: 'complete' },
    UploadServerFrame: { type: 'ready', mode: 'bundle', apply: 'replace', limitBytes: 1000, heartbeatSeconds: 15 },
    ContainerControl: { type: 'scores', sessionId: uuid, scores: { 'high-score': { [uuid]: 100 } } },
  };
  for (const [name, fixture] of Object.entries(fixtures)) {
    const validate = ajv.getSchema(`${frames.$id}#/$defs/${name}`);
    assert.ok(validate(fixture), JSON.stringify(validate.errors));
  }
  assert.equal(ajv.getSchema(`${frames.$id}#/$defs/GameRealtimeInput`)({ type: 'cmd', data: { type: 'input' }, realtime: true }), false);
  assert.equal(ajv.getSchema(`${frames.$id}#/$defs/VoiceClientControl`)({ type: 'rtc', to: 'not-a-uuid', payload: {} }), false);
});

test('binary layout distinguishes participant/user IDs, unframed relay and 33-byte container header', () => {
  const protocol = name => binary.protocols.find(p => p.name === name);
  assert.equal(protocol('realtime').serverToClient[0].name, 'senderParticipantId');
  assert.equal(protocol('voice').serverToClient[0].name, 'senderUserId');
  assert.equal(protocol('relay').serverToClient[0].offset, 0);
  assert.equal(protocol('container-stream').platformToContainer.at(-1).offset, 33);
  const bytes = Buffer.from(binary.guidEncoding.exampleHex, 'hex');
  const decoded = `${bytes.readUInt32LE(0).toString(16).padStart(8, '0')}-${bytes.readUInt16LE(4).toString(16).padStart(4, '0')}-${bytes.readUInt16LE(6).toString(16).padStart(4, '0')}-${bytes.subarray(8, 10).toString('hex')}-${bytes.subarray(10).toString('hex')}`;
  assert.equal(decoded, binary.guidEncoding.exampleUuid);
});
