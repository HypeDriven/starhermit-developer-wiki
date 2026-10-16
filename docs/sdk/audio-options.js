// Pure audio settings helpers; your mixer enforces the resolved playback cap.
// Guide: https://wiki.starhermit.com/docs/tutorials/audio-options.html
export const DEFAULTS = Object.freeze({
  master: 0.8, music: 0.7, effects: 1, ui: 0.8, voice: 1,
  maxConcurrentSounds: 'auto', voiceMode: 'off',
  echoCancellation: true, noiseSuppression: true, autoGainControl: false,
});

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const ceilingFor = value => positive(value) ? Math.max(1, Math.min(256, Math.floor(value))) : 64;

/** Browser hints only. Unknown values remain unknown; no audio or permission prompt. */
export function detectAudioSystem(env = globalThis) {
  const nav = env.navigator || {};
  let coarse = false; // a touch screen as the primary pointer: a phone or tablet
  try { coarse = !!env.matchMedia?.('(pointer: coarse)').matches; } catch { /* no media queries */ }
  return {
    cores: positive(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
    memoryGb: positive(nav.deviceMemory) ? nav.deviceMemory : null,
    mobile: !!nav.userAgentData?.mobile || coarse,
  };
}

/** Conservative starting heuristic, not a hardware capacity measurement. */
export function recommendConcurrentSounds(system = {}, ceiling = 64) {
  const cores = positive(system.cores) ? system.cores : null;
  const memory = positive(system.memoryGb) ? system.memoryGb : null;
  // Phones and tablets start at 16 whatever their core count: heat, battery and shared audio threads.
  const constrained = system.mobile === true || (cores !== null && cores <= 2) || (memory !== null && memory <= 2);
  const count = constrained ? 16 : cores !== null && cores >= 4 ? 64 : 32;
  return Math.min(count, ceilingFor(ceiling));
}

/** Gain for a 0–1 perceptual slider. Invalid positions are silent. */
export function volumeGain(position) {
  return typeof position === 'number' && Number.isFinite(position)
    ? Math.max(0, Math.min(1, position)) ** 3 : 0;
}

/** Resolve untrusted saved settings. Auto is evaluated on this machine at every launch. */
export function resolveAudio(saved = {}, system = detectAudioSystem(), ceiling = 64) {
  saved = saved && typeof saved === 'object' ? saved : {};
  const out = { ...DEFAULTS };
  for (const bus of ['master', 'music', 'effects', 'ui', 'voice']) {
    if (typeof saved[bus] === 'number' && Number.isFinite(saved[bus])) {
      out[bus] = Math.max(0, Math.min(1, saved[bus]));
    }
  }
  for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
    if (typeof saved[key] === 'boolean') out[key] = saved[key];
  }
  if (['off', 'push-to-talk', 'open-mic'].includes(saved.voiceMode)) out.voiceMode = saved.voiceMode;
  const hardCeiling = ceilingFor(ceiling);
  if (Number.isInteger(saved.maxConcurrentSounds) && saved.maxConcurrentSounds > 0) {
    out.maxConcurrentSounds = Math.min(saved.maxConcurrentSounds, hardCeiling);
  }
  out.recommendedConcurrentSounds = recommendConcurrentSounds(system, hardCeiling);
  out.effectiveConcurrentSounds = out.maxConcurrentSounds === 'auto'
    ? out.recommendedConcurrentSounds : out.maxConcurrentSounds;
  return out;
}
