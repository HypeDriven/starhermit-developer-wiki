import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphics, detectLevel, detectPreset, detectSystem, presetForLevel, resolve, withPreset } from '../docs/sdk/graphics-options.js';

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

test('hardware levels run from a Galaxy S20 or weaker (0) to an RTX 5090 (20)', () => {
  const desktop = { webgl: true, webgl2: true, cores: 16, memoryGb: 8 };
  const phone = { ...desktop, mobile: true, cores: 8 };
  for (const [s, gpu, level, preset] of [
    [desktop, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)', 20, 'ultra'],
    [desktop, 'NVIDIA GeForce RTX 4090/PCIe/SSE2', 19, 'ultra'],
    [desktop, 'ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 18, 'ultra'],
    [desktop, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', 17, 'ultra'],
    [desktop, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)', 16, 'high'],
    [desktop, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 12, 'high'],
    [desktop, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)', 10, 'high'],
    [desktop, 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 'balanced'],
    [desktop, 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', 9, 'balanced'],
    [desktop, 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 6, 'balanced'],
    [desktop, 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 'balanced'],
    [desktop, 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 2, 'low'],
    [desktop, 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 0, 'low'],
    [desktop, 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar', 10, 'high'],
    [desktop, 'Some Future GPU', 4, 'balanced'],
    [{ ...desktop, memoryGb: 4 }, 'NVIDIA GeForce RTX 5090', 9, 'balanced'],
    [{ ...desktop, cores: 2 }, 'NVIDIA GeForce RTX 5090', 0, 'low'],
    [desktop, 'Google SwiftShader', 0, 'low'],
    [phone, 'Adreno (TM) 650', 0, 'low'],
    [phone, 'Mali-G77 MP11', 0, 'low'],
    [phone, 'ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)', 0, 'low'],
    [phone, 'Mali-G710 MC10', 2, 'low'],
    [phone, 'Adreno (TM) 740', 5, 'balanced'],
    [phone, 'Adreno (TM) 830', 7, 'balanced'],
    [phone, 'Apple GPU', 0, 'low'],
    [phone, 'An Unknown Phone GPU', 0, 'low'],
  ]) {
    assert.equal(detectLevel({ ...s, gpu }), level, gpu);
    assert.equal(detectPreset({ ...s, gpu }), preset, gpu);
  }
  assert.equal(detectLevel({ gpu: 'NVIDIA GeForce RTX 5090', webgl: false }), 0);
  assert.deepEqual([0, 3, 4, 9, 10, 16, 17, 20].map(l => presetForLevel(l)),
    ['low', 'low', 'balanced', 'balanced', 'high', 'high', 'ultra', 'ultra']);
  const own = { fast: { scale: 1, dprCap: 1 }, pretty: { scale: 1, dprCap: 2 } };
  const gfx = create({ system: { ...desktop, gpu: 'NVIDIA GeForce RTX 3060' }, table: own, categories: {},
    levels: { fast: 0, pretty: 12 } });
  assert.equal(gfx.level, 12);
  assert.equal(gfx.settings.preset, 'pretty');
});

test("Safari's masked Apple GPU is rated by the weakest chip that fits the device", () => {
  const apple = { gpu: 'Apple GPU', webgl: true, webgl2: true, cores: 2, memoryGb: 0 }; // WebKit caps cores
  const iphone = { ...apple, mobile: true, touch: true };
  for (const [s, level, preset] of [
    [{ ...iphone, screen: [414, 896] }, 0, 'low'], // iPhone 11 (A13)
    [{ ...iphone, screen: [375, 812] }, 0, 'low'], // iPhone X–13 mini, or Display Zoom
    [{ ...iphone, screen: [390, 844] }, 1, 'low'], // iPhone 12–14 (A14+)
    [{ ...iphone, screen: [393, 852] }, 4, 'balanced'], // iPhone 15 (A16+)
    [{ ...iphone, screen: [440, 956] }, 6, 'balanced'], // iPhone 16 Pro Max (A18 Pro+)
    [{ ...iphone, screen: [834, 1210] }, 8, 'balanced'], // iPad Pro M4
    [{ ...apple, touch: true, screen: [820, 1180] }, 1, 'low'], // iPad Air with a trackpad as primary pointer
    [{ ...iphone }, 0, 'low'], // no screen size
    [{ ...apple, astc: true, screen: [900, 1440] }, 6, 'balanced'], // Mac with Apple silicon
    [{ ...apple, astc: false, screen: [900, 1440] }, 2, 'low'], // Intel Mac
  ]) {
    assert.equal(detectLevel(s), level, JSON.stringify(s));
    assert.equal(detectPreset(s), preset);
  }
  assert.equal(detectLevel({ ...apple, gpu: 'Intel Iris' }), 0); // the core cap still applies elsewhere
});

test('detectSystem reads Safari through the WebGL debug extension and probes screen and ASTC', () => {
  const gl = {
    RENDERER: 1,
    getParameter: p => (p === 1 ? 'WebKit WebGL' : p === 2 ? 'Apple GPU' : null),
    getExtension: name => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 2 } : null),
    getSupportedExtensions: () => ['WEBGL_compressed_texture_astc'],
  };
  const system = detectSystem({
    navigator: { maxTouchPoints: 5, hardwareConcurrency: 4 },
    screen: { width: 852, height: 393 },
    matchMedia: q => ({ matches: q === '(pointer: coarse)' }),
    document: { createElement: () => ({ getContext: type => (type === 'webgl2' ? gl : null) }) },
  });
  assert.deepEqual(system, { gpu: 'Apple GPU', webgl: true, webgl2: true, mobile: true, touch: true,
    screen: [393, 852], cores: 4, memoryGb: 0, astc: true });
  assert.equal(detectLevel(system), 4);
  assert.deepEqual(detectSystem({}).screen, [0, 0]);
});

test('phones and tablets render at half the refresh rate unless the player sets a limit', () => {
  const phone = { ...system, gpu: 'Adreno (TM) 740', mobile: true };
  for (const [hz, expected] of [[60, 300], [90, 450], [120, 600], [144, 720], [30, 300]]) {
    const gfx = create({ system: phone });
    assert.equal(gfx.settings.maxFps, 0);
    assert.equal(gfx.settings.halfRefresh, true);
    assert.ok(Math.abs(sample(gfx, hz).length - expected) <= 1, `${hz} Hz`);
  }
  // Jittered timestamps and a missed refresh still render every second refresh, never every fourth.
  const jittered = create({ system: phone });
  let rendered = 0;
  for (let tick = 0; tick < 600; tick++) {
    if (tick === 301) continue;
    if (jittered.shouldRender(tick * 1000 / 60 + (tick % 2 ? 1.5 : -1.5))) rendered++;
  }
  assert.ok(Math.abs(rendered - 300) <= 1, `jittered: ${rendered}`);
  const gfx = create({ system: phone });
  gfx.set({ maxFps: 120 });
  assert.equal(gfx.settings.halfRefresh, false);
  assert.ok(Math.abs(sample(gfx, 120).length - 1200) <= 1);
  gfx.set({ maxFps: null });
  assert.equal(gfx.settings.halfRefresh, true);
  assert.equal(create().settings.halfRefresh, false); // desktops keep the display's refresh rate
});

test('half-refresh pacing is not mistaken for a slow GPU', () => {
  const gfx = create({ system: { ...system, gpu: 'Adreno (TM) 740', mobile: true } });
  let previous = 0;
  for (const now of sample(gfx, 60, 4).slice(1)) {
    gfx.frame(now - previous);
    previous = now;
  }
  assert.equal(gfx.adaptiveScale, 1);
  assert.equal(gfx.fps, 30);
});

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
