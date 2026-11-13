# Engine features: physics, vehicles, sky, water and rendering

Engine 1.40.0 (host API 1.40) adds simulation and rendering features for script games: rigid-body
physics, vehicles, a physical sky and weather, an ocean, procedural surfaces and grass, GPU particles,
temporal anti-aliasing and screen-space effects, better shadows, compressed textures, and new
animation and level-of-detail tools. This page gives an overview of each area and what to expect
from it. Every member, option, unit and limit is documented in your game's
`.starhermit/starhermit.d.ts` (`starhermit types` writes it); this page does not repeat it.

## Turning them on

Each feature here applies only to games that declare host API 1.40 or later in `starhermit.txt`:

```text
engine.api=1
engine.version=1.40.0
engine.minor=40
```

A game at `engine.minor=39` or lower keeps 1.39's behaviour, frame for frame. It cannot import the new
modules (`starhermit:physics`, `starhermit:vehicle`, `starhermit:sky`, `starhermit:weather`,
`starhermit:water`, `starhermit:surfaces`, `starhermit:particles`): the import throws a `TypeError`. New
options on existing classes stay unknown options for such a game. Raising `engine.minor` is the whole
opt-in; check your game on the new runtime first (see
[moving to a newer engine](tutorials/starhermit-engine.md#9-move-to-a-newer-engine)).

Some features follow three.js r185 and keep its names and behaviour. Others are **engine
extensions**, marked as such in the declarations: they have no three.js equivalent, and code using
them does not run on three.js.

## What to expect on every device

**Every visual feature has a fallback ladder** (full → reduced → minimal → off) on every runtime, native
and browser. When the device or the player's graphics level cannot run a tier, the engine takes the
next one down and adds a note in **Options → Graphics** that says what was lowered. Your game keeps
working; it just looks simpler. You do not need to detect capabilities yourself, though
`renderer.capabilities` and properties such as `ocean.tier` tell you what was chosen.

**Simulation is deterministic.** Physics, vehicles, the water's wave field (`heightAt`, `sampleAt`,
`buoyancy`), the wind's `velocityAt`, procedural surfaces and CPU particles give bit-identical results
natively and in browsers, so lockstep multiplayer can rely on them. GPU particles and everything
drawn are not deterministic and are not readable by gameplay.

**Native work is charged before it runs.** Calls into the new natives charge
[fuel](tutorials/starhermit-engine.md#10-limits-and-the-licence) for their work up front, in proportion
to how much they will do. Each also has hard bounds, so a single oversized call (a huge grass patch, a
whole-track search, a massive water sample) is refused with an error instead of stalling the frame.
Counts are capped, for example 64 vehicles, 16 heightfields, 16 tracks and 8 ponds at once.

## Physics: `starhermit:physics`

`PhysicsWorld` is a 3D rigid-body world (an engine extension; three.js has no physics):

- **Bodies:** dynamic, static and kinematic, with exact kinematic targets.
- **Colliders:** sphere, box, capsule, cylinder, cone, convex hull, triangle mesh, heightfield, plane
  and triangle. Meshes and hulls can be built straight from a `BufferGeometry`.
- **Joints:** fixed, ball, hinge, slider, distance, rope, spring and cone-twist, with limits, motors
  and breaking.
- **Queries:** ray casts, shape casts, overlaps and touch events.
- **Characters:** a kinematic `CharacterController` with sliding, slope limits, autostep and snapping
  to the ground.

Units are metres, kilograms and seconds. Coordinates must stay within 1,000,000 m of the origin.
Step the world from `onFixedUpdate`, and place attached objects from `onRender`:

```ts
import { onFixedUpdate, onRender } from "starhermit:engine";
import { PhysicsWorld } from "starhermit:physics";

const world = new PhysicsWorld();
world.createCollider({ shape: { type: "trimesh", geometry: level.geometry } });
const crate = world.createBody({ position: [0, 5, 0], object: crateMesh });
world.createCollider({ shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] } }, crate);
onFixedUpdate((dt) => world.step(dt));
onRender((alpha) => world.sync(alpha)); // interpolated between steps
```

## Vehicles: `starhermit:vehicle`

`Vehicle` is driving dynamics built from a `.vehicle` text or a spec object. It models Pacejka tyres,
suspension, a drivetrain (engine, clutch, gearbox, differential, brakes), aerodynamics, and ABS,
traction and stability control. Cars drive on flat ground, a `Heightfield` or a physics world. `Track`, `LapTimer`,
`Autopilot` and `formatLapTime` cover circuits, lap and sector timing and AI drivers. Step vehicles
from `onFixedUpdate`. Read their interpolated body and wheel transforms for visuals.

## Sky and weather: `starhermit:sky`, `starhermit:weather`

- **`SkyAtmosphere`** is a physically based sky with the sun, the moon at its phase, stars and the
  Milky Way, placed by time of day, day of year and latitude. It drives a `DirectionalLight` (the sun
  by day, the moon by night) and, on request, `scene.background` and `scene.environment`. Its
  **aerial perspective** fogs distant land and sea into the sky without a seam. The haze is mixed in
  each render pass's own colour space, so it stays correct when the scene is drawn through post
  buffers (render scale, adaptive resolution, motion vectors). The CPU queries (`sunDirection`,
  `moonDirection`, `moonPhase`) give the same numbers on every runtime. Its tiers are full, reduced,
  minimal (Preetham) and off.
- three.js r185's Preetham **`Sky`** addon is also available, from `starhermit:scene` and
  `starhermit:sky`.
- **`WindField`** is wind whose direction veers and whose strength swells and gusts. `velocityAt(x, z, t)`
  is deterministic and suitable for gameplay. Materials can read the wind field around the camera
  through a hook. `sway` and `swayMesh` bend grass and trees with it.
- **`WeatherEffects`** adds weather visuals. They are volumetric clouds as a sky layer, rain that
  stays out from under roofs, wet surfaces and puddles, and lightning with thunder. The weather comes
  from `Weather` (the `.weather` text, six built-in kinds), `WeatherState` (easing between weathers)
  and `WeatherCycle` (changing weather on its own).

## Water: `starhermit:water`

An **`Ocean`** draws FFT waves with reflections, refraction, foam, whitecaps and shoaling over a
seabed. Its tiers are `"gpu"`, `"cpu"`, `"gerstner"` (the lowest graphics levels) and `"off"`.
`ocean.tier` and `tierNote` say which one runs. Gameplay reads the deterministic wave field through
`heightAt`, `sampleAt` and `buoyancy`, whatever tier is drawn. Wind comes from a `WindField`
(`setWindField`) or `setWind`. `Pond` (up to 8) is still water over a rectangle that the wind ripples.
`WaterMaterial` gives the same shading to a heightfield mesh, for rivers and flowing water.

## Surfaces and grass: `starhermit:surfaces`

- `generateSurface` bakes any of 20 tiling surfaces by name and seed. They include sand, gravel,
  grass, rock, snow, marble and five barks. Each comes with colour, normal, ambient occlusion,
  roughness and metalness maps.
- `createSurfaceMaterial` turns a baked surface into a material, with optional hooks that hide
  tiling.
- `createTerrainMaterial` blends three surfaces by vertex shares.
- `createGrass` grows grass from a `.grass` breed (meadow, lawn, dry, tall, verge, or your own text):
  blades, weeds and flowers, ready for wind sway and `generateLods(…, { thin: true })`.

Output is identical natively and in browsers.

## Particles

`ParticleEmitter` (in `starhermit:scene`) gains:

- **Forces:** `wind`, `curl`, `buoyancy`, `vortex` and `attract`.
- **Collision:** a `floor` and up to four `colliders` (planes and heightfields) that bounce, clamp,
  stick or kill.
- **Motion and spawning:** `sway`, `sizeSpread`, `velocityMode` `"planar"`/`"radial"`, and `"ring"`
  and `"disc"` shapes.
- **Rotation:** `rotation`, `rotationSpread`, `spin`, `spinSpread` and `rotationAxis`, for confetti,
  leaves and debris.
- **Sprites:** `lit`, `soft` and `billboard` sprites (engine extensions), lit by the sun, the
  environment and lights.

Emitters stay deterministic. A `set()` the range check refuses now leaves the settings unchanged.
Queueing more than 256 bursts throws a `RangeError`, where it used to drop them silently.

`GPUParticleEmitter` in `starhermit:particles` is an engine extension. It simulates up to about a
million particles per emitter on the GPU, within the graphics level's budget, with forces,
colliders and collision against the scene's depth. It also loads Solstice-style `.particles` effects
(`loadParticleEffect`). It is not deterministic, and gameplay cannot read it. Without float render
targets it falls back to a CPU emitter of up to 4,096 particles.

## Rendering and shadows

| Feature | API | Notes |
|---|---|---|
| Temporal anti-aliasing with upscaling | `renderer.antialias = "taa"` | Falls back to FXAA (with a note) where unsupported; `renderer.resetHistory()` after a cut |
| Motion vectors | `scene_velocity(uv)` in post programs | Engine extension |
| Render scale | `setPixelRatio`, `setSize`, `getPixelRatio`, `getSize`, drawing-buffer size | The player's render scale and adaptive resolution now apply to script games |
| Screen-space reflections, global illumination | `renderer.ssr`, `renderer.ssgi` | Engine extensions; illumination on High and Ultra only |
| Automatic exposure | `renderer.exposure.auto`, `renderer.exposure.hold` | Engine extension |
| Sharpening, film grain, specular anti-aliasing | `renderer.sharpen`, `renderer.film`, `renderer.specularAntialiasing` | Engine extensions |
| Contact shadows | `renderer.contactShadows` | Engine extension, off by default |
| Point-light shadows | three.js `PointLightShadow` | Dropped first when shadow slots run out |
| Shadow update control | `shadowMap.autoUpdate`/`needsUpdate`, `light.shadow.autoUpdate`/`needsUpdate` | As three.js r185: keep a map until asked to redraw |
| Cached cascades | `shadow.cascades.cached` | Engine extension: static casters drawn once, much cheaper shadows |

Over the effect budget, the engine drops global illumination first, then reflections. Each shows a
note in Options.

## Textures, animation and levels of detail

- **Compressed textures.** KTX2 files with BC1, BC3, BC4, BC5 or BC7 blocks load through
  `KTX2Loader` and `TextureLoader`. Devices without BC support get them unpacked to RGBA8. To have
  them written for you, set `engine.textures.compress=bc` and `starhermit package` writes KTX2 files
  beside your PNG and WebP images. The images stay as a fallback. Basis Universal is not supported.
  `Texture.preserveCoverage` keeps alpha-tested foliage from thinning out in the distance.
- **Morph targets** work as in three.js r185, including from glTF.
- **`AnimationGraph`** (engine extension) provides layered state machines, blend spaces, synced
  transitions, bone masks and additive layers.
- **`SkeletonUtils.retarget`, `retargetClip` and `clone`** (three.js addon) carry animations between
  rigs.
- **`compressClip`** shrinks animation clips, and `setUpdateIntervals` updates distant characters
  less often.
- **Levels of detail.** three.js's `SimplifyModifier`, and the engine's `generateLods`, which builds
  a `LOD` or an `InstancedMesh`'s levels that switch by on-screen error.

## Where to read more

- `.starhermit/starhermit.d.ts` in your game: every module, member, option, unit and limit.
- The [engine tutorial](tutorials/starhermit-engine.md) for the basics of a script game.
- [Native performance](native-performance.md) for where heavy work should live.
