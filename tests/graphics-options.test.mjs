import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphics, resolve, withPreset } from '../docs/sdk/graphics-options.js';

const system = { gpu: 'NVIDIA RTX', webgl: true, webgl2: true, cores: 8, memoryGb: 8 };
const create = (opts = {}) => createGraphics({ sdk: null, storage: null, system, ...opts });
const memoryStorage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
};
const sample = (gfx, hz, seconds = 10) => {
  const rendered = [];
  for (let tick = 0; tick < hz * seconds; tick++) {
    const now = tick * 1000 / hz;
    if (gfx.shouldRender(now)) rendered.push(now);
  }
  return rendered;
};

test('automatic refresh is the default and invalid saved limits restore Auto', () => {
  for (const maxFps of [undefined, null, 0, -30, NaN, Infinity, '60', {}, true]) {
    assert.equal(resolve({ maxFps }, 'high').maxFps, 0);
  }
  assert.equal(resolve({ maxFps: 59.7 }, 'high').maxFps, 60);
  assert.equal(resolve({ maxFps: 0.2 }, 'high').maxFps, 1);
  assert.equal(resolve({ maxFps: 2000 }, 'high').maxFps, 1000);
  assert.equal(sample(create(), 144).length, 1440);
});

test('quality changes retain the limit while clearing effect overrides', () => {
  assert.deepEqual(withPreset({ maxFps: 45, shadows: 'off' }, 'low'), { preset: 'low', maxFps: 45 });
  const gfx = create();
  gfx.set({ maxFps: 45 });
  gfx.setPreset('low');
  gfx.setPreset('auto');
  assert.equal(gfx.settings.maxFps, 45);
});

test('frame pacing retains fractional time across display rates and custom limits', () => {
  for (const [hz, limit] of [[60, 30], [144, 60], [120, 45], [60, 144], [144, 1], [144, 1000]]) {
    const gfx = create();
    gfx.set({ maxFps: limit });
    const times = sample(gfx, hz);
    assert.ok(Math.abs(times.length - Math.min(hz, limit) * 10) <= 1, `${hz} Hz / ${limit} FPS: ${times.length}`);
    // A due frame is quantized to at most one display interval after its target time.
    if (limit < hz) times.forEach((now, i) => {
      assert.ok(now + 1e-6 >= i * 1000 / limit);
      assert.ok(now - i * 1000 / limit < 1000 / hz + 1e-6);
    });
  }
});

test('live changes, Auto, pauses and backward timestamps reset pacing', () => {
  const gfx = create();
  gfx.set({ maxFps: 30 });
  assert.equal(gfx.shouldRender(0), true);
  assert.equal(gfx.shouldRender(10), false);
  gfx.set({ maxFps: 60 });
  assert.equal(gfx.shouldRender(11), true);
  assert.equal(gfx.shouldRender(12), false);
  assert.equal(gfx.shouldRender(2000), true);
  assert.equal(gfx.shouldRender(0), true);
  assert.equal(gfx.shouldRender(NaN), false);
  assert.equal(gfx.shouldRender(Infinity), false);
  gfx.set({ maxFps: null });
  assert.equal(gfx.shouldRender(1), true);
  assert.equal(gfx.shouldRender(2), true);
});

test('manual limits persist before the first frame after reload', () => {
  const storage = memoryStorage();
  const gfx = create({ storage });
  gfx.set({ maxFps: 45 });
  assert.equal(create({ storage }).settings.maxFps, 45);
  gfx.set({ maxFps: null });
  assert.equal(create({ storage }).settings.maxFps, 0);
});

test('a newer cloud limit applies and resets an existing pacing schedule', async () => {
  let remote;
  let slot;
  const sdk = {
    signedIn: true, slug: 'game',
    api: async () => ({ settings: { [slot]: remote } }),
  };
  const gfx = create({ sdk });
  await gfx.ready;
  slot = gfx.cloudSlot;
  remote = { saved: { maxFps: 30 }, at: 1 };
  await gfx.sync();
  assert.equal(gfx.settings.maxFps, 30);
  assert.equal(gfx.shouldRender(0), true);
  assert.equal(gfx.shouldRender(10), false);
  remote = { saved: { maxFps: 45 }, at: 2 };
  await gfx.sync();
  assert.equal(gfx.settings.maxFps, 45);
  assert.equal(gfx.shouldRender(11), true);
});

test('intentional caps retain Auto quality and show the actual rendered FPS', () => {
  for (const [hz, limit] of [[144, 30], [60, 45], [144, 1], [60, 10]]) {
    const gfx = create();
    gfx.set({ maxFps: limit });
    let previous = 0;
    for (const now of sample(gfx, hz, 900 / limit + 1).slice(1)) {
      gfx.frame(now - previous);
      previous = now;
    }
    assert.equal(gfx.adaptiveScale, 1);
    assert.equal(gfx.autoTier, 'high');
    assert.equal(gfx.fps, limit);
  }
});

test('sustained frames slower than the manual target still lower adaptive quality', () => {
  for (const [maxFps, ms] of [[30, 60], [2, 800]]) {
    const gfx = create();
    gfx.set({ maxFps });
    for (let i = 0; i < 90 * 7; i++) gfx.frame(ms);
    assert.equal(gfx.autoTier, 'balanced');
  }
  const automatic = create();
  for (let i = 0; i < 90; i++) automatic.frame(30);
  assert.equal(automatic.adaptiveScale, 0.9);
});

test('switching GPUs uses defaults and returning restores each GPU independently', () => {
  const storage = memoryStorage();
  const gpuB = { ...system, gpu: 'AMD Radeon RX 7900' };
  const a = create({ storage });
  a.setPreset('ultra');
  a.set({ maxFps: 90, renderScale: 1.5, adaptive: false, showFps: true, shadows: 'off' });
  const b = create({ storage, system: gpuB });
  assert.equal(a.detected, b.detected); // a shared quality tier must not merge GPU profiles
  assert.notEqual(a.storageKey, b.storageKey);
  assert.notEqual(a.cloudSlot, b.cloudSlot);
  assert.deepEqual(b.saved, {});
  assert.deepEqual(b.settings, resolve({}, b.detected));
  b.setPreset('low');
  b.set({ maxFps: 45, bloom: 'off' });
  assert.deepEqual(create({ storage }).saved, a.saved);
  assert.deepEqual(create({ storage }).settings, a.settings);
  assert.deepEqual(create({ storage, system: gpuB }).settings, b.settings);
  assert.equal(storage.values.size, 2);
});

test('GPU profiles normalize names and survive hardware-tier changes', () => {
  const storage = memoryStorage();
  const a = create({ storage });
  a.setPreset('ultra');
  a.set({ maxFps: 90 });
  const same = create({ storage, system: { ...system, gpu: '  nvidia   RTX  ', cores: 2 } });
  assert.equal(same.detected, 'low');
  assert.equal(same.gpuProfile, a.gpuProfile);
  assert.equal(same.settings.preset, 'ultra');
  assert.equal(same.settings.maxFps, 90);
  assert.match(a.gpuProfile, /^[a-f0-9]{16}$/);
  const ownPrefix = create({ storage, storageKey: 'other.game', cloudKey: 'otherGraphics' });
  assert.equal(ownPrefix.storageKey, `other.game.gpu.${a.gpuProfile}`);
  assert.equal(ownPrefix.cloudSlot, `otherGraphics.gpu.${a.gpuProfile}`);
  assert.deepEqual(ownPrefix.saved, {});
});

test('cloud settings follow the GPU across devices without importing another GPU', async () => {
  const settings = {};
  const writes = [];
  const sdk = {
    signedIn: true, slug: 'game',
    api: async () => ({ settings: structuredClone(settings) }),
    setSetting: (key, value) => { settings[key] = structuredClone(value); writes.push(key); },
  };
  const a = create({ sdk, storage: memoryStorage() });
  await a.ready;
  a.setPreset('ultra');
  a.set({ maxFps: 90, shadows: 'off' });
  await new Promise(resolve => setTimeout(resolve, 850));
  const bSystem = { ...system, gpu: 'AMD Radeon RX 7900' };
  const b = create({ sdk, storage: memoryStorage(), system: bSystem });
  await b.ready;
  assert.deepEqual(b.saved, {});
  assert.equal(b.settings.auto, true);
  assert.equal(b.settings.maxFps, 0);
  b.set({ maxFps: 45 });
  await new Promise(resolve => setTimeout(resolve, 850));
  const returning = create({ sdk, storage: memoryStorage() });
  await returning.ready;
  assert.deepEqual(returning.saved, a.saved);
  const returningB = create({ sdk, storage: memoryStorage(), system: bSystem });
  await returningB.ready;
  assert.equal(returningB.settings.maxFps, 45);
  assert.deepEqual(writes, [a.cloudSlot, b.cloudSlot]);
});

test('unscoped legacy settings cannot leak into an unrelated GPU profile', async () => {
  const storage = memoryStorage();
  const legacy = { saved: { preset: 'ultra', maxFps: 90 }, at: Date.now() + 1000 };
  storage.setItem('graphics', JSON.stringify(legacy));
  const sdk = {
    signedIn: true, slug: 'game',
    api: async () => ({ settings: { 'graphics.desktop.high': legacy } }),
    setSetting: () => assert.fail('must not upload legacy settings'),
  };
  const gfx = create({ storage, sdk });
  await gfx.ready;
  assert.deepEqual(gfx.saved, {});
  assert.equal(gfx.settings.maxFps, 0);
  assert.equal(storage.getItem('graphics'), JSON.stringify(legacy));
});

test('unidentified GPUs keep session choices without sharing a persistence profile', async () => {
  const storage = memoryStorage();
  const unknown = { ...system, gpu: '' };
  const sdk = { signedIn: true, slug: 'game', api: () => assert.fail('unknown GPU must not read shared settings') };
  const gfx = create({ storage, sdk, system: unknown });
  await gfx.ready;
  gfx.set({ maxFps: 90 });
  assert.equal(gfx.settings.maxFps, 90);
  assert.equal(gfx.gpuProfile, null);
  assert.equal(storage.values.size, 0);
  assert.equal(create({ storage, system: unknown }).settings.maxFps, 0);
});
