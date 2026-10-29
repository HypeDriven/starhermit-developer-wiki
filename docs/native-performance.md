# Native performance for script games

A StarHermit engine game runs the same package in browsers and natively. The two run your code very
differently, so choose where heavy work lives before you port or write it. This page covers script
speed, WebAssembly, GPU-bound scenes, workers and measurement. Figures are engine measurements from
October 2026.

## How your code runs

| | In browsers | Natively |
|---|---|---|
| Game JavaScript | The browser's V8, full speed | The engine's own interpreter, no JIT (by design, for security) |
| WebAssembly, main realm | The browser's WebAssembly | The engine's interpreter (host API 1.25 and later) |
| WebAssembly in `starhermit:script` workers | The engine's interpreter, for bit-exact results | The engine's interpreter |

- Natively, real game JavaScript is about **15–25× slower than V8**. Micro-benchmarks can suggest
  about 8×. Don't rely on them.
- Native WebAssembly is about **8–17× slower than V8** today. The platform plans to compile WASM
  ahead of time to signed native code at publish time, which should bring it close to V8 speed.
- `starhermit check` runs JavaScript exactly as a windowed game does. Benchmark with a `--release`
  engine build only.

## Heavy per-frame work

Simulation, meshing, pathfinding and entity builds are the usual hot spots.

1. **Write the hot code in Rust or another WASM language** and run it as WebAssembly, ideally in a
   `starhermit:script` worker. Code written this way gets the planned ahead-of-time speed-up with no
   changes.
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
