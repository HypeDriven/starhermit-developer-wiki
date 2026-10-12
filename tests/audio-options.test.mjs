import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAudioSystem, recommendConcurrentSounds, resolveAudio, volumeGain } from '../docs/sdk/audio-options.js';

test('Auto handles unknown, constrained and stronger hardware conservatively', () => {
  for (const [system, expected] of [
    [{}, 32], [{ cores: 2, memoryGb: 8 }, 16], [{ cores: 16, memoryGb: 2 }, 16],
    [{ cores: 3 }, 32], [{ cores: 4 }, 64], [{ cores: 32, memoryGb: 8 }, 64],
    [{ cores: NaN, memoryGb: Infinity }, 32], [{ cores: '8' }, 32],
  ]) assert.equal(recommendConcurrentSounds(system), expected);
  assert.deepEqual(detectAudioSystem({}), { cores: null, memoryGb: null });
  assert.deepEqual(detectAudioSystem({ navigator: { hardwareConcurrency: 8, deviceMemory: 4 } }),
    { cores: 8, memoryGb: 4 });
});

test('ceilings and saved manual choices apply independently of Auto', () => {
  assert.equal(resolveAudio({}, { cores: 8 }, 12).effectiveConcurrentSounds, 12);
  assert.equal(resolveAudio({ maxConcurrentSounds: 48 }, { cores: 2 }).effectiveConcurrentSounds, 48);
  assert.equal(resolveAudio({ maxConcurrentSounds: 128 }, {}, 64).effectiveConcurrentSounds, 64);
  assert.equal(resolveAudio({ maxConcurrentSounds: 999 }, {}, 999).effectiveConcurrentSounds, 256);
  for (const bad of [0, -1, 1.5, NaN, Infinity, '64', null, true, {}]) {
    assert.equal(resolveAudio({ maxConcurrentSounds: bad }).maxConcurrentSounds, 'auto');
  }
  const saved = { maxConcurrentSounds: 'auto' };
  assert.equal(resolveAudio(saved, { cores: 2 }).effectiveConcurrentSounds, 16);
  assert.equal(resolveAudio(saved, { cores: 8 }).effectiveConcurrentSounds, 64);
  assert.deepEqual(saved, { maxConcurrentSounds: 'auto' });
});

test('volume and voice defaults reject corrupt values and preserve explicit preferences', () => {
  assert.equal(volumeGain(0), 0);
  assert.equal(volumeGain(1), 1);
  assert.equal(volumeGain(0.5), 0.125);
  assert.equal(volumeGain(NaN), 0);
  const settings = resolveAudio({ master: -1, music: 5, voice: NaN,
    voiceMode: 'open-mic', noiseSuppression: false, autoGainControl: 'true' });
  assert.equal(settings.master, 0);
  assert.equal(settings.music, 1);
  assert.equal(settings.voice, 1);
  assert.equal(settings.voiceMode, 'open-mic');
  assert.equal(settings.noiseSuppression, false);
  assert.equal(settings.autoGainControl, false);
  assert.equal(resolveAudio(null).voiceMode, 'off');
  assert.equal(resolveAudio({ voiceMode: 'garbage' }).voiceMode, 'off');
});
