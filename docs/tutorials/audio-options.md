# Tutorial: audio options with an auto-detected sound limit

Give your game an **Audio** section alongside [Graphics](graphics-options.md), available from the
main menu and during play. Start with the baseline below, let players override it, and enforce a
maximum number of simultaneous playback instances to keep mixing and spatialization work bounded.
These are recommended game-side defaults, not settings the platform enforces.
Add a [Language section](game-localization.md) alongside these controls for translation selection.

[`audio-options.js`](../sdk/audio-options.js) supplies dependency-free helpers for volume curves,
settings validation and a conservative Auto sound limit. It creates no audio context, microphone
capture, mixer, options panel or network connection; your game wires the controls and playback.

## 1. Baseline controls

| Control | Recommended starting value | Behavior |
|---|---|---|
| Master volume | 80% | Controls all game playback, including received voice |
| Music volume | 70% | Music bus, multiplied by Master |
| Sound effects volume | 100% | Gameplay effects bus, multiplied by Master |
| UI volume | 80% | Menu and interface bus, multiplied by Master |
| Voice volume | 100% | Received voice bus, multiplied by Master; never changes microphone gain |
| Maximum concurrent sounds | Auto | Display the detected count and effective limit; offer fixed 16, 32, 64, 128 and a validated custom count within the game ceiling |
| Voice chat | Off | Explicit session opt-in; offer Push-to-talk and Open microphone when voice is supported |
| Microphone / output device | System default | Offer selection where supported; keep device identifiers local |
| Echo cancellation / noise suppression | On / On | Request supported capture processing; display the effective result |
| Automatic microphone gain | Off | Optional capture processing, independent of playback volume |

Hide voice controls in games without voice. Give every slider a visible percentage, accessible label,
keyboard support and a usable touch target; let the panel scroll on small screens. Include an explicit
mute control that remembers the previous level. Apply changes immediately without reloading.
Optional per-participant volume and local mute help players balance a voice room.

Treat slider positions as 0–1 and use `volumeGain(position)` (position cubed) for a perceptual curve.
Connect each bus through its own gain, then the Master gain, so Master is applied exactly once.
Ramp gains over about 20 ms to avoid clicks; zero must be silent. Normalize assets and provide output
headroom or a limiter to prevent clipping when sounds overlap. Unlock browser playback from a user
gesture and handle suspended contexts; unavailable audio must leave the game playable.

## 2. Auto-detect a sensible concurrency limit

Use device-type, CPU and memory hints, independently of the graphics preset or GPU. The starting policy is:

| Available hints (evaluate top to bottom) | Starting count |
|---|---|
| A phone or tablet, at most two logical CPUs, or at most 2 GB reported memory | 16 |
| At least four logical CPUs, without the above constraint | 64 |
| Unknown capability, or fewer than four CPUs without the above constraint | 32 |

The reference helper caps these counts at the game's hard ceiling, **64 by default**, and bounds
custom ceilings to 1–256. A developer can allow 128 or 256 manually after profiling the game; Auto
does not pick these from core count alone. A smaller game can set a ceiling of 16 or 32.
A phone or tablet is one whose browser reports Chromium's mobile hint or a touch screen as the primary
(coarse) pointer, the same signal the graphics module uses; it starts at 16 whatever its core count, to
limit heat and battery drain. Missing or invalid hints remain unknown. These numbers are initial heuristics, not measured hardware
capacity: [logical CPU counts may be reduced by the browser](https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-hardwareconcurrency),
and [memory hints are approximate and privacy restricted](https://www.w3.org/TR/device-memory/).

```js
import { detectAudioSystem, resolveAudio, volumeGain } from './audio-options.js';

const system = detectAudioSystem();
const GAME_SOUND_CEILING = 64;
let saved = {}; // Load your player's validated preferences; empty means defaults.

function applyAudio() {
  const settings = resolveAudio(saved, system, GAME_SOUND_CEILING);
  // mixer is your own adapter, not a StarHermit SDK API.
  mixer.setPlaybackLimit(settings.effectiveConcurrentSounds);
  mixer.setBusGain('master', volumeGain(settings.master));
  for (const bus of ['music', 'effects', 'ui', 'voice']) {
    mixer.setBusGain(bus, volumeGain(settings[bus]));
  }
  return settings; // Show recommendedConcurrentSounds and effectiveConcurrentSounds.
}

function setSoundLimit(value) {
  // A select supplies 'auto'; parse and validate the custom integer before calling.
  saved = { ...saved, maxConcurrentSounds: value };
  applyAudio();
  // Persist the requested choice, including 'auto', through your settings store.
}
```

Run Auto again on each device and after relevant mixer/output-format changes. Save `'auto'`, not its
detected number. A manual count stays manual, subject to the game/backend ceiling. Show an explanation
when the effective count differs from the requested count.

For an instrumented mixer, refine Auto with a bounded, inaudible representative workload: test
the actual resampling, spatialization and effects chain and target at most 25% of an audio block's
duration for mixing. For example, a 128-frame block at 48 kHz gives about 0.67 ms for that target.
Schedule profiling away from active gameplay. A silent gain alone does not guarantee representative
work because a backend may optimize silence. Standard Web Audio does not expose per-graph CPU time;
use the hint fallback unless your own backend provides reliable timing. Do not infer audio CPU cost
from FPS or output channel count.

Auto may step down for the session on sustained measured overload or underruns, with hysteresis to
avoid oscillation; do not overwrite the saved preference. Cache measured recommendations locally by
backend, format, effects configuration and code version. Re-evaluate after those change. Instance
counts bound mixing work, but decoding, microphone processing and networking need separate budgets.

## 3. Enforce the cap in playback

Count **every active playback instance** across music, loops, effects, UI and received voice.
Stereo is one instance. Paused/stopped sounds, microphone capture and virtual sounds with no active
rendering do not count. Music crossfades and release tails count until they finish. Schedule future
starts through the same allocator and also bound their pending queue.

Use one bounded allocator for every playback path, including media elements and WebRTC output:

1. Reserve part of the total for music, important cues and expected voice participants. Reservations
   share the cap; they do not add extra slots. Adapt them when the room size or limit changes.
2. At capacity, drop an incoming low-priority effect or replace a lower-priority active instance.
   Distance, audibility and repeated effects can break priority ties. Deduplicate bursts and limit
   repeated emitters before creating audio nodes or decoding new buffers.
3. A fading victim still occupies its slot: queue its replacement until it stops, or stop it at a safe
   boundary before starting the replacement. Never temporarily exceed the cap for fades.
4. Release and disconnect ended sources. Reducing the limit must reclaim slots, including loops and
   tails, before admitting new playback. Virtualized loops retain only cheap position/state data;
   disconnect their expensive processing and bound virtual-instance bookkeeping too.

Favor voice and meaningful gameplay cues over ambience. A WebRTC track connected to the mixer must
have direct media-element playback disabled to prevent duplicate audio and uncounted playback.
Muting a gain alone does not stop decoding or spatialization; suppress, pause or disconnect work
where the backend permits it. Expose active, suppressed and virtualized counts in development
diagnostics so the CPU bound can be verified.

## 4. Voice chat controls

Follow the [Voice API](../api/voice.md) for conversation membership, join/leave, signaling, own mute
and host mute. Join explicitly and request microphone access only after the player enables capture;
listening without a microphone can remain available. Browser capture requires
[permission and a secure context](https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-getusermedia).
Permission denial should show a useful state and leave playback and text chat usable.

Use Push-to-talk as the recommended mode when enabling voice. Provide a rebindable key and a
press-and-hold touch control; release transmission on key/pointer release, canceled input, blur and
hidden-page transitions. Open microphone is an explicit alternative. Show microphone permission,
input level, speaking state, mute/deafen and any host mute. A microphone test runs only on request.
Deafen mutes received voice and suppresses local transmission while active.

Gate outbound audio locally as well as updating the platform's own-mute state. On every join or
reconnect, restore the intended mute before sending media: joining clears the participant's own mute
in the API, while host mute survives. Peer-to-peer media must honor host mute locally too; signaling
does not let the platform filter a direct peer audio stream. Stop capture tracks and close media
connections when voice is disabled or the session ends. Saving a preferred mode never silently
reopens the microphone on the next launch.

## 5. Save and verify

Save ordinary preferences in the game's [per-player settings](../api/games.md#per-player-game-settings),
for example under `audio` as `{ saved: { master: 0.8, maxConcurrentSounds: 'auto', voiceMode: 'off' }, at: … }`.
Keep a namespaced local cache for standalone play. Read before writing, reconcile timestamps, and
block cloud writes after a failed read until a successful retry, as in the graphics tutorial.
Validate remote settings before applying them. Keep device IDs, permissions, profiling results,
session membership and current microphone activity local; store the preferred voice mode separately
from whether capture is currently enabled.

- `node --test tests/audio-options.test.mjs` checks the shipped helper's unknown/constrained/stronger
  and phone/tablet detection, ceilings, manual choices, Auto on another device, volume bounds and voice defaults.
- In your game, drive the real controls with mouse, keyboard and touch; check live volume changes,
  mute restoration, persistence and Auto/manual switching after reload.
- Trigger overlapping music, effects, voice, fades and scheduled sounds beyond the limit. Confirm
  active playback never exceeds it, including when lowering it live, and important cues survive.
- Test denied microphone permission, push-to-talk cancellation, reconnect mute, host mute, device
  loss and leaving voice. No transmission may resume without the intended session opt-in.

See also: [Graphics options](graphics-options.md) · [JavaScript SDK](../sdk/javascript.md) ·
[Voice API](../api/voice.md).
