# Native performance for script games

A StarHermit engine game runs the same package in browsers and natively. The two run your code very
differently, so choose where heavy work lives before you port or write it. This page covers script
speed, WebAssembly, GPU-bound scenes, workers and measurement. Figures are engine measurements from
October 2026, as of engine 1.26.1.

## How your code runs

| | In browsers | Natively |
|---|---|---|
| Game JavaScript | The browser's V8, full speed | The engine's own interpreter, no JIT (by design, for security) |
| WebAssembly, main realm | The browser's WebAssembly | Platform-compiled native code from engine 1.26.1 ([details](#compiled-webassembly)); otherwise the engine's interpreter (host API 1.25 and later) |
| WebAssembly in `starhermit:script` workers | The engine's interpreter, for bit-exact results | Platform-compiled native code, as in the main realm |

- Natively, real game JavaScript is about **15–25× slower than V8**. Micro-benchmarks can suggest
  about 8×. Don't rely on them.
- Native WebAssembly that the platform has compiled runs at **roughly V8 speed**: about 7× faster
  than the interpreter on the engine's simulation benchmark, about 1.4× V8's time. Interpreted
  WebAssembly is about 8–18× slower than V8.
- `starhermit check` runs JavaScript exactly as a windowed game does. Benchmark with a `--release`
  engine build only.

## Compiled WebAssembly

From engine 1.26.1, when you publish a game containing `.wasm` modules, the platform compiles each
module ahead of time in a sandboxed build and signs the result. The native runtime downloads it,
verifies the signature, caches it and runs it as native code. You don't need to change the game;
just publish it.

- **Where:** Windows x86-64, Linux x86-64 and Intel macOS, on CPUs at x86-64-v2 or newer
  (SSE4.2 and POPCNT). Apple Silicon Macs and older CPUs still interpret, and so do modules that
  use SIMD.
- **When:** an instance created before the compiled code has downloaded keeps interpreting. Later
  instances run compiled, including the next launch, which loads it from the disk cache.
- **Same results:** compiled code matches the interpreter bit for bit, including fuel and traps.
- **Check and disable:** with `--dev`, the log shows for each module whether it ran compiled or
  interpreted, and why. `STARHERMIT_WASM_AOT=0` turns compilation off.
- **Browsers are unchanged:** the main realm uses the browser's WebAssembly, and workers use the
  engine's interpreter.

## Heavy per-frame work

Simulation, meshing, pathfinding and entity builds are the usual hot spots.

1. **Write the hot code in Rust or another WASM language** and run it as WebAssembly, ideally in a
   `starhermit:script` worker. Once the game is published, it runs natively at close to V8 speed,
   while plain JavaScript stays about 15–25× slower.
2. **Choose a path with `runtime()`** from `starhermit:engine` (host API 1.26). `"web"` means V8, so
   JavaScript is fine there. `"native"` means you should prefer the WASM path. Workers always take the
   native path and can't import `starhermit:engine`.
3. **Keep plain JavaScript for game logic, UI and orchestration.** Spread rare heavy work across frames.
4. **Don't compile JavaScript or TypeScript to WebAssembly for speed.** The result still needs a
   JavaScript object model, so it gains nothing.

For many similar entities, [`starhermit:world` kernels](tutorials/starhermit-engine.md#6-many-things-at-once-starhermitworld)
run natively too.

## GPU-bound scenes

Natively, the GPU usually becomes the limit only after script time is under control.

- Use `InstancedMesh.setLevels([...])` with low-poly levels and a draw distance, and three's `LOD`
  (host API 1.26).
- Turn `castShadow` off for small or distant props.
- Limit shadow cascades with `shadow.cascades = { count, maxDistance }`, an engine extension.
- Set `STARHERMIT_GPU_PASS_TIMES=1` to print GPU time for each pass.

## Workers

- Before host API 1.27, keep a reference to every worker you use, because garbage collection
  terminates it. From 1.27, a worker with listeners lives until `terminate()`.
- Workers can read package files (`files`) from host API 1.26.
- Workers can send binary and transferable messages from host API 1.25.

## Measuring

- Compare native and web using the same build.
- The engine's frame stats report script time separately from frame time. Script-bench numbers are
  suitable for citing.
