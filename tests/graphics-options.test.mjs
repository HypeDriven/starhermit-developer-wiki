import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphics, resolve, withPreset } from '../docs/sdk/graphics-options.js';

const system = { gpu: 'NVIDIA RTX', webgl: true, webgl2: true, cores: 8, memoryGb: 8 };
const create = (opts = {}) => createGraphics({ sdk: null, storage: null, system, ...opts });
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
  let value = null;
  const storage = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  const gfx = create({ storage });
  gfx.set({ maxFps: 45 });
  assert.equal(create({ storage }).settings.maxFps, 45);
  gfx.set({ maxFps: null });
  assert.equal(create({ storage }).settings.maxFps, 0);
});

test('a newer cloud limit applies and resets an existing pacing schedule', async () => {
  let remote;
  const sdk = {
    signedIn: true, slug: 'game',
    api: async () => ({ settings: { 'graphics.desktop.high': remote } }),
  };
  const gfx = create({ sdk });
  await gfx.ready;
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
