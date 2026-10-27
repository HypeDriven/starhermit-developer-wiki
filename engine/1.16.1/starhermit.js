// The StarHermit runtime's browser entry with the engine's browser glue bundled in.
// graphics
const __graphics = (() => {
// Advisory classification never treats a masked or vendor-only name as known hardware.
function classifyGpu(name) {
  if(typeof name!== 'string')return 0;
  const value=name.slice(0,512).toLowerCase();
  if(/llvmpipe|softpipe|swiftshader|software|lavapipe/.test(value))return 4;
  if(/apple\s+m[1-9]/.test(value))return 3;
  if(/geforce|quadro|\brtx\b|radeon\s+(rx|pro)\b|intel.*\barc\b/.test(value))return 2;
  if(/intel.*(uhd|iris|hd graphics)/.test(value))return 1;
  return 0;
}
function webgpuClass(adapter) {
  try {
    const info=adapter.info;
    if(info?.isFallbackAdapter===true || adapter.isFallbackAdapter===true)return 4;
    return classifyGpu(webgpuName(adapter));
  } catch { return 0; }
}
function webgpuName(adapter) {
  try {
    const info=adapter.info;
    return [info?.vendor,info?.architecture,info?.description].filter(v=>typeof v==='string').map(v=>v.slice(0,512)).join(' ').slice(0,512);
  } catch { return ''; }
}
function webglName(gl) {
  try {
    const extension=gl.getExtension?.('WEBGL_debug_renderer_info');
    const unmasked=extension&&gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
    const name=typeof unmasked==='string'&&unmasked?unmasked:gl.getParameter(gl.RENDERER);
    return typeof name==='string'?name.slice(0,512):'';
  } catch { return ''; }
}
function webglClass(gl) { return classifyGpu(webglName(gl)); }

// Quality detection's inputs from the page (spec/rendering-and-quality.html, "Graphics levels"); none of them leaves
// the device. The kind of device: 1 desktop, 2 tablet, 3 phone, 0 unknown (a coarse primary pointer without a fine one
// is handheld: a tablet from a 600 CSS pixel screen side, else a phone; Chrome's userAgentData says phone itself).
function deviceKind(deviceClass) {
  try {
    if (globalThis.navigator?.userAgentData?.mobile === true) return 3;
    const media = query => !!globalThis.matchMedia?.(query).matches;
    const side = Math.min(globalThis.screen?.width || 0, globalThis.screen?.height || 0);
    if (deviceClass === 'mobile' || (media('(pointer: coarse)') && !media('(any-pointer: fine)'))) return side >= 600 ? 2 : 3;
    return media('(any-pointer: fine)') ? 1 : 0;
  } catch { return 0; }
}
// The renderer's name for WebGPU, whose adapter information usually names only the vendor and architecture: a
// throwaway WebGL 2 context's unmasked renderer when it names more (released at once).
function richerName(name) {
  if (/\d/.test(name)) return name;
  try {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : null;
    const gl = canvas?.getContext('webgl2');
    if (!gl) return name;
    const unmasked = webglName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return unmasked && classifyGpu(unmasked) !== 4 ? unmasked : name;
  } catch { return name; }
}
// The start-up benchmark (starhermit-gpu's benchmark.rs, the same measurement): blended layers of a full-target
// triangle over an offscreen 1024 x 1024 RGBA8 target, doubling until a pass takes 4 ms, each pass waited for, one
// layer's pass (the submission and wait) taken off; at most 300 ms; gigapixels a second, or null when no pass finished
// in time. Kept in the page's storage per backend, renderer name and engine (this module's URL), as natively. Software
// renderers are not measured: they start at the bottom.
const BENCH_SIDE = 1024, BENCH_MAX_LAYERS = 8192, BENCH_TIMED = 4, BENCH_LIMIT = 300;
const BENCH_KEY = 'starhermit.graphics.benchmark';
const BENCH_WGSL = `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0, 1.0, 1.0, 1.0 / 64.0); }`;
const BENCH_VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const BENCH_FS = `#version 300 es
precision mediump float; out vec4 color; void main() { color = vec4(1.0, 1.0, 1.0, 1.0 / 64.0); }`;
async function benchPasses(pass) {
  const started = performance.now();
  const base = Math.min(await pass(1), await pass(1));
  let layers = 16, best = null, timed = 0;
  while (performance.now() - started < BENCH_LIMIT && timed < 3) {
    const took = await pass(layers);
    if (performance.now() - started > BENCH_LIMIT) break;
    const work = took - base;
    if (took >= BENCH_TIMED && work > 0) { const rate = (layers - 1) * BENCH_SIDE * BENCH_SIDE / (work / 1000) / 1e9; best = best === null ? rate : Math.max(best, rate); timed++; }
    if (took < 2 * BENCH_TIMED && layers < BENCH_MAX_LAYERS) layers *= 2;
  }
  return best;
}
async function benchWebGPU(device) {
  const module = device.createShaderModule({code: BENCH_WGSL});
  const pipeline = await device.createRenderPipelineAsync({layout: 'auto', vertex: {module, entryPoint: 'vs'},
    fragment: {module, entryPoint: 'fs', targets: [{format: 'rgba8unorm', blend: {color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}}}]},
    primitive: {topology: 'triangle-list'}});
  const texture = device.createTexture({size: [BENCH_SIDE, BENCH_SIDE], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT});
  try {
    const view = texture.createView();
    return await benchPasses(async layers => {
      const at = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({colorAttachments: [{view, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store'}]});
      pass.setPipeline(pipeline); pass.draw(3, layers); pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      return performance.now() - at;
    });
  } finally { texture.destroy(); }
}
async function benchWebGL(renderer) {
  const gl = renderer.gl;
  const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
  const program = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, BENCH_VS), fs = shader(gl.FRAGMENT_SHADER, BENCH_FS);
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer(), vao = gl.createVertexArray();
  try {
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, BENCH_SIDE, BENCH_SIDE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, BENCH_SIDE, BENCH_SIDE); gl.useProgram(program); gl.bindVertexArray(vao);
    const pixel = new Uint8Array(4);
    return await benchPasses(async layers => {
      const at = performance.now();
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, layers);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return performance.now() - at;
    });
  } finally {
    // The renderer's own state again: it binds its vertex array once and sets the rest per draw.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(renderer.vao); gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
    gl.bindTexture(gl.TEXTURE_2D, null); gl.useProgram(null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); gl.deleteVertexArray(vao);
    gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
  }
}
// The renderer's name (`gpuName`) and benchmark (`benchmark`, gigapixels a second or null), for graphics_info.
async function measureGraphics(renderer) {
  if (renderer.backend === 'WebGPU') renderer.gpuName = richerName(renderer.gpuName || '');
  renderer.benchmark = null;
  if (renderer.gpuClass === 4) return;
  const key = `${renderer.backend}\n${renderer.gpuName || ''}\n${new URL(import.meta.url).pathname}`;
  try { const kept = JSON.parse(globalThis.localStorage?.getItem(BENCH_KEY) ?? 'null'); if (kept?.key === key && Number.isFinite(kept.rate) && kept.rate > 0) { renderer.benchmark = kept.rate; return; } } catch {}
  try {
    const rate = renderer.backend === 'WebGPU' ? await benchWebGPU(renderer.device) : await benchWebGL(renderer);
    renderer.benchmark = Number.isFinite(rate) && rate > 0 ? rate : null;
    if (renderer.benchmark !== null) { try { globalThis.localStorage?.setItem(BENCH_KEY, JSON.stringify({key, rate: renderer.benchmark})); } catch {} }
  } catch { renderer.benchmark = null; }
}
// First-party WebGPU/WebGL2 triangle backends. No external renderer or bindings.
const MAX_VERTICES = 300000;
// The most image bytes the surface holds (starhermit-sys's MAX_IMAGE_BYTES): the runtime keeps each game within its own
// image budget, under this.
const MAX_IMAGE_BYTES = 520 * 1024 * 1024;
// The most mesh bytes (vertices and indices as uploaded) the surface holds (starhermit-sys's MAX_MESH_BYTES): the
// runtime keeps each game within its own mesh budget, and starhermit-gpu each surface within its own, under this.
const MAX_MESH_BYTES = 1540 * 1024 * 1024;
// The most meshes the surface holds (starhermit-sys's MAX_MESHES), likewise.
const MAX_MESHES = 4112;
function bounded(promise, label, late = () => {}) {
  let expired = false;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error(`${label} timed out`)); }, 10000); });
  const operation = Promise.resolve(promise).then(value => { if (expired) late(value); return value; });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

// The 2D program: `fs` gives straight alpha (normal and additive batches, copies), `fs_premultiplied` its color
// premultiplied (multiply and screen batches, whose blends take the source premultiplied; BATCH_BLENDS).
const WGSL = `struct Output { @builtin(position) position: vec4f, @location(0) color: vec4f, @location(1) uv: vec2f };
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
@vertex fn vs(@location(0) position: vec2f, @location(1) color: vec4f, @location(2) uv: vec2f) -> Output {
  var output: Output; output.position = vec4f(position, 0.0, 1.0); output.color = color; output.uv = uv; return output;
}
@fragment fn fs(input: Output) -> @location(0) vec4f { return input.color * textureSample(image, image_sampler, input.uv); }
@fragment fn fs_premultiplied(input: Output) -> @location(0) vec4f {
  let color = input.color * textureSample(image, image_sampler, input.uv); return vec4f(color.rgb * color.a, color.a);
}`;
// WebGL2 programs: GLSL ES generated from the WGSL above and below by
// starhermit-shader (y negated for textures, *_WINDOW vertex stages for the
// canvas), the same programs the native GLES backend runs.
// BEGIN GENERATED GLSL
const SPRITE_VS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Output {\n    vec4 _position;\n    vec4 _color;\n    vec2 _uv;\n};\nlayout(location = 0) in vec2 _a0;\nlayout(location = 1) in vec4 _a1;\nlayout(location = 2) in vec2 _a2;\nout vec4 _v0;\nout vec2 _v1;\n_Output _vs(vec2 _p_position, vec4 _p_color, vec2 _p_uv) {\n    _Output _l0_output = _Output(vec4(0.0), vec4(0.0), vec2(0.0));\n    _l0_output._position = vec4(_p_position, 0.0, 1.0);\n    _l0_output._color = _p_color;\n    _l0_output._uv = _p_uv;\n    return _l0_output;\n}\nvoid main() {\n    _Output _result = _vs(_a0, _a1, _a2);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, -_position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._color;\n    _v1 = _result._uv;\n}\n";
const SPRITE_VS_GLSL_WINDOW = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Output {\n    vec4 _position;\n    vec4 _color;\n    vec2 _uv;\n};\nlayout(location = 0) in vec2 _a0;\nlayout(location = 1) in vec4 _a1;\nlayout(location = 2) in vec2 _a2;\nout vec4 _v0;\nout vec2 _v1;\n_Output _vs(vec2 _p_position, vec4 _p_color, vec2 _p_uv) {\n    _Output _l0_output = _Output(vec4(0.0), vec4(0.0), vec2(0.0));\n    _l0_output._position = vec4(_p_position, 0.0, 1.0);\n    _l0_output._color = _p_color;\n    _l0_output._uv = _p_uv;\n    return _l0_output;\n}\nvoid main() {\n    _Output _result = _vs(_a0, _a1, _a2);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, _position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._color;\n    _v1 = _result._uv;\n}\n";
const SPRITE_FS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Output {\n    vec4 _position;\n    vec4 _color;\n    vec2 _uv;\n};\nuniform highp sampler2D _image_image_sampler;\nin vec4 _v0;\nin vec2 _v1;\nlayout(location = 0) out vec4 _o0;\nvec4 _fs(_Output _p_input) {\n    return (_p_input._color * texture(_image_image_sampler, _p_input._uv));\n}\nvoid main() {\n    vec4 _result = _fs(_Output(gl_FragCoord, _v0, _v1));\n    _o0 = _result;\n}\n";
const SPRITE_FS_PREMULTIPLIED_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Output {\n    vec4 _position;\n    vec4 _color;\n    vec2 _uv;\n};\nuniform highp sampler2D _image_image_sampler;\nin vec4 _v0;\nin vec2 _v1;\nlayout(location = 0) out vec4 _o0;\nvec4 _fs_premultiplied(_Output _p_input) {\n    vec4 _l0_color = (_p_input._color * texture(_image_image_sampler, _p_input._uv));\n    return vec4((_l0_color.xyz * _l0_color.w), _l0_color.w);\n}\nvoid main() {\n    vec4 _result = _fs_premultiplied(_Output(gl_FragCoord, _v0, _v1));\n    _o0 = _result;\n}\n";
const POST_VS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nout vec2 _v0;\n_Varyings _vs(uint _p_index) {\n    vec2 _l0_p = vec2(float(((_p_index << 1u) & 2u)), float((_p_index & 2u)));\n    _Varyings _l1_output = _Varyings(vec4(0.0), vec2(0.0));\n    _l1_output._position = vec4(((_l0_p * 2.0) - 1.0), 0.0, 1.0);\n    _l1_output._uv = vec2(_l0_p.x, (1.0 - _l0_p.y));\n    return _l1_output;\n}\nvoid main() {\n    _Varyings _result = _vs(uint(gl_VertexID));\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, -_position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._uv;\n}\n";
const POST_VS_GLSL_WINDOW = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nout vec2 _v0;\n_Varyings _vs(uint _p_index) {\n    vec2 _l0_p = vec2(float(((_p_index << 1u) & 2u)), float((_p_index & 2u)));\n    _Varyings _l1_output = _Varyings(vec4(0.0), vec2(0.0));\n    _l1_output._position = vec4(((_l0_p * 2.0) - 1.0), 0.0, 1.0);\n    _l1_output._uv = vec2(_l0_p.x, (1.0 - _l0_p.y));\n    return _l1_output;\n}\nvoid main() {\n    _Varyings _result = _vs(uint(gl_VertexID));\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, _position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._uv;\n}\n";
const POST_OCCLUSION_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nlayout(std140) uniform post_block {\n    _Post _post;\n};\nuniform highp sampler2D _second_nearest_sampler;\nuniform highp sampler2D _third_nearest_sampler;\nuniform highp sampler2D _depth_image_nearest_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec2 _gl(vec2 _p_uv) {\n    return vec2(_p_uv.x, (1.0 - _p_uv.y));\n}\nfloat _depth_at(vec2 _p_uv) {\n    return textureLod(_depth_image_nearest_sampler, _gl(_p_uv), float(0)).x;\n}\nvec3 _view_position(vec2 _p_screen, float _p_depth) {\n    vec4 _l0_view = (_post._inverse_projection * vec4(((vec3(_p_screen, _p_depth) * 2.0) - 1.0), 1.0));\n    return (_l0_view.xyz / _l0_view.w);\n}\nfloat _horizon(vec3 _p_view, vec3 _p_offset, vec3 _p_view_dir, int _p_j, float _p_current) {\n    vec4 _l0_clip = (_post._projection * vec4((_p_view + _p_offset), 1.0));\n    vec2 _l1_uv = (((_l0_clip.xy / _l0_clip.w) * 0.5) + 0.5);\n    vec3 _l2_delta = (_view_position(_l1_uv, _depth_at(_l1_uv)) - _p_view);\n    if ((abs(_l2_delta.z) < _post._ao0.z)) {\n        float _l3_cos_horizon = dot(_p_view_dir, normalize(_l2_delta));\n        return (_p_current + max(0.0, ((_l3_cos_horizon - _p_current) * mix(1.0, (2.0 / float((_p_j + 2))), _post._ao0.w))));\n    }\n    return _p_current;\n}\nvec3 _normal_at(vec2 _p_uv) {\n    return ((textureLod(_second_nearest_sampler, _gl(_p_uv), 0.0).xyz * 2.0) - 1.0);\n}\nvec4 _occlusion(_Varyings _p_input) {\n    vec2 _l0_uv = _gl(_p_input._uv);\n    float _l1_depth = _depth_at(_l0_uv);\n    if ((_l1_depth >= 1.0)) {\n        return vec4(1.0);\n    }\n    vec3 _l2_view = _view_position(_l0_uv, _l1_depth);\n    vec3 _l3_normal = _normal_at(_l0_uv);\n    vec4 _l4_noise = textureLod(_third_nearest_sampler, fract(((_l0_uv * _parameters._size.xy) / 5.0)), 0.0);\n    vec3 _l5_random = ((_l4_noise.xyz * 2.0) - 1.0);\n    vec3 _l6_tangent = normalize(vec3(_l5_random.xy, 0.0));\n    mat3 _l7_kernel = mat3(_l6_tangent, vec3((-_l6_tangent.y), _l6_tangent.x, 0.0), vec3(0.0, 0.0, 1.0));\n    int _l8_samples = int((_post._ao1.y + 0.5));\n    int _l9_directions = ((_l8_samples >= 30) ? 5 : 3);\n    int _l10_steps = (((_l8_samples + _l9_directions) - 1) / _l9_directions);\n    vec3 _l11_view_dir = normalize((-_l2_view));\n    float _l12_ao = 0.0;\n    {\n        int _l13_i = 0;\n        for (; (_l13_i < _l9_directions); _l13_i = (_l13_i + 1)) {\n            float _l14_angle = ((float(_l13_i) / float(_l9_directions)) * 3.1415927);\n            float _l15_reach = (0.5 + (0.5 * _l4_noise.w));\n            vec3 _l16_direction = normalize((_l7_kernel * vec3(cos(_l14_angle), sin(_l14_angle), 0.0)));\n            vec3 _l17_slice_bitangent = normalize(cross(_l16_direction, _l11_view_dir));\n            vec3 _l18_slice_tangent = cross(_l17_slice_bitangent, _l11_view_dir);\n            vec3 _l19_normal_in_slice = normalize((_l3_normal - (_l17_slice_bitangent * dot(_l3_normal, _l17_slice_bitangent))));\n            vec3 _l20_tangent_to_normal = cross(_l19_normal_in_slice, _l17_slice_bitangent);\n            vec2 _l21_cos_horizons = vec2(dot(_l11_view_dir, _l20_tangent_to_normal), dot(_l11_view_dir, (-_l20_tangent_to_normal)));\n            {\n                int _l22_j = 0;\n                for (; (_l22_j < _l10_steps); _l22_j = (_l22_j + 1)) {\n                    vec3 _l23_offset = (((_l16_direction * _post._ao0.x) * _l15_reach) * pow((float((_l22_j + 1)) / float(_l10_steps)), _post._ao0.y));\n                    _l21_cos_horizons.x = _horizon(_l2_view, _l23_offset, _l11_view_dir, _l22_j, _l21_cos_horizons.x);\n                    _l21_cos_horizons.y = _horizon(_l2_view, (-_l23_offset), _l11_view_dir, _l22_j, _l21_cos_horizons.y);\n                }\n            }\n            vec2 _l24_sin_horizons = sqrt((1.0 - (_l21_cos_horizons * _l21_cos_horizons)));\n            float _l25_nx = dot(_l19_normal_in_slice, _l18_slice_tangent);\n            float _l26_ny = dot(_l19_normal_in_slice, _l11_view_dir);\n            float _l27_nxb = (0.5 * (((acos(_l21_cos_horizons.y) - acos(_l21_cos_horizons.x)) + (_l24_sin_horizons.x * _l21_cos_horizons.x)) - (_l24_sin_horizons.y * _l21_cos_horizons.y)));\n            float _l28_nyb = (0.5 * ((2.0 - (_l21_cos_horizons.x * _l21_cos_horizons.x)) - (_l21_cos_horizons.y * _l21_cos_horizons.y)));\n            _l12_ao = (_l12_ao + ((_l25_nx * _l27_nxb) + (_l26_ny * _l28_nyb)));\n        }\n    }\n    _l12_ao = clamp((_l12_ao / float(_l9_directions)), 0.0, 1.0);\n    _l12_ao = pow(_l12_ao, _post._ao1.x);\n    return vec4(vec3(_l12_ao), 1.0);\n}\nvoid main() {\n    vec4 _result = _occlusion(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_DENOISE_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nlayout(std140) uniform post_block {\n    _Post _post;\n};\nuniform highp sampler2D _image_linear_sampler;\nuniform highp sampler2D _second_nearest_sampler;\nuniform highp sampler2D _third_nearest_sampler;\nuniform highp sampler2D _depth_image_nearest_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nfloat _luminance(vec3 _p_c) {\n    return dot(vec3(0.2125, 0.7154, 0.0721), _p_c);\n}\nvec3 _view_position(vec2 _p_screen, float _p_depth) {\n    vec4 _l0_view = (_post._inverse_projection * vec4(((vec3(_p_screen, _p_depth) * 2.0) - 1.0), 1.0));\n    return (_l0_view.xyz / _l0_view.w);\n}\nvec2 _gl(vec2 _p_uv) {\n    return vec2(_p_uv.x, (1.0 - _p_uv.y));\n}\nvec3 _normal_at(vec2 _p_uv) {\n    return ((textureLod(_second_nearest_sampler, _gl(_p_uv), 0.0).xyz * 2.0) - 1.0);\n}\nfloat _depth_at(vec2 _p_uv) {\n    return textureLod(_depth_image_nearest_sampler, _gl(_p_uv), float(0)).x;\n}\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec4 _denoise(_Varyings _p_input) {\n    vec2 _l0_uv = _gl(_p_input._uv);\n    float _l1_depth = _depth_at(_l0_uv);\n    vec3 _l2_normal = _normal_at(_l0_uv);\n    if (((_l1_depth == 1.0) || (dot(_l2_normal, _l2_normal) == 0.0))) {\n        return vec4(1.0);\n    }\n    vec3 _l3_center = _sample(_p_input._uv).xyz;\n    vec3 _l4_view = _view_position(_l0_uv, _l1_depth);\n    vec2 _l5_resolution = _parameters._size.xy;\n    float _l6_turn = ((textureLod(_third_nearest_sampler, fract(((_l0_uv * _l5_resolution) / 64.0)), 0.0).x * 2.0) * 3.1415927);\n    vec2 _l7_n = vec2(sin(_l6_turn), cos(_l6_turn));\n    int _l8_samples = int((_post._denoise1.y + 0.5));\n    vec3 _l9_denoised = _l3_center;\n    float _l10_total = 1.0;\n    {\n        int _l11_i = 0;\n        for (; (_l11_i < _l8_samples); _l11_i = (_l11_i + 1)) {\n            float _l12_angle = (((6.2831855 * _post._denoise1.x) * float(_l11_i)) / float(_l8_samples));\n            float _l13_radius = ((_l11_i == 0) ? 0.0 : pow((float(_l11_i) / float((_l8_samples - 1))), _post._denoise1.z));\n            vec2 _l14_disk = ((vec2(cos(_l12_angle), sin(_l12_angle)) * (1.0 + (_l13_radius * (_post._denoise0.w - 1.0)))) / _l5_resolution);\n            vec2 _l15_sample_uv = (_l0_uv + vec2(((_l7_n.x * _l14_disk.x) + (_l7_n.x * _l14_disk.y)), ((_l7_n.y * _l14_disk.y) - (_l7_n.y * _l14_disk.x))));\n            vec3 _l16_neighbor = textureLod(_image_linear_sampler, _gl(_l15_sample_uv), 0.0).xyz;\n            float _l17_sample_depth = _depth_at(_l15_sample_uv);\n            vec3 _l18_sample_normal = _normal_at(_l15_sample_uv);\n            vec3 _l19_view_sample = _view_position(_l15_sample_uv, _l17_sample_depth);\n            float _l20_normal_similarity = pow(max(dot(_l2_normal, _l18_sample_normal), 0.0), _post._denoise0.z);\n            float _l21_luma_similarity = max((1.0 - (abs((_luminance(_l16_neighbor) - _luminance(_l3_center))) / _post._denoise0.x)), 0.0);\n            float _l22_depth_similarity = max((1.0 - (abs(dot((_l4_view - _l19_view_sample), _l2_normal)) / _post._denoise0.y)), 0.0);\n            float _l23_w = ((_l21_luma_similarity * _l22_depth_similarity) * _l20_normal_similarity);\n            _l9_denoised = (_l9_denoised + (_l23_w * _l16_neighbor));\n            _l10_total = (_l10_total + _l23_w);\n        }\n    }\n    if ((_l10_total > 0.0)) {\n        _l9_denoised = (_l9_denoised / _l10_total);\n    }\n    return vec4(_l9_denoised, 1.0);\n}\nvoid main() {\n    vec4 _result = _denoise(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_OCCLUSION_BLEND_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform post_block {\n    _Post _post;\n};\nuniform highp sampler2D _image_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec4 _occlusion_blend(_Varyings _p_input) {\n    vec4 _l0_texel = _sample(_p_input._uv);\n    return vec4(mix(vec3(1.0), _l0_texel.xyz, _post._ao1.z), _l0_texel.w);\n}\nvoid main() {\n    vec4 _result = _occlusion_blend(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_BRIGHT_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nuniform highp sampler2D _image_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec3 _decode(vec3 _p_c) {\n    return mix(pow(((_p_c + 0.055) / 1.055), vec3(2.4)), (_p_c / 12.92), lessThan(_p_c, vec3(0.04045)));\n}\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec4 _bright(_Varyings _p_input) {\n    vec4 _l0_raw = _sample(_p_input._uv);\n    vec4 _l1_s = ((all(greaterThanEqual(_l0_raw.xyz, vec3(0.0))) && all(lessThan(_l0_raw.xyz, vec3(65504.0)))) ? _l0_raw : vec4(0.0));\n    vec4 _l2_texel = ((_parameters._output.z > 0.5) ? _l1_s : vec4(_decode(_l1_s.xyz), _l1_s.w));\n    float _l3_threshold = _parameters._values.x;\n    float _l4_amount = smoothstep(_l3_threshold, (_l3_threshold + 0.01), dot(_l2_texel.xyz, vec3(0.2126, 0.7152, 0.0722)));\n    return mix(vec4(0.0), _l2_texel, _l4_amount);\n}\nvoid main() {\n    vec4 _result = _bright(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_BLUR_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nuniform highp sampler2D _image_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec4 _blur(_Varyings _p_input) {\n    float _l0_k = _parameters._values.z;\n    float _l1_weight_sum = (0.39894 / _l0_k);\n    vec3 _l2_sum = (_sample(_p_input._uv).xyz * _l1_weight_sum);\n    {\n        int _l3_i = 1;\n        for (; (_l3_i < int((_l0_k + 0.5))); _l3_i = (_l3_i + 1)) {\n            float _l4_x = float(_l3_i);\n            float _l5_w = ((0.39894 * exp(((((-0.5) * _l4_x) * _l4_x) / (_l0_k * _l0_k)))) / _l0_k);\n            vec2 _l6_offset = (_parameters._values.xy * _l4_x);\n            _l2_sum = (_l2_sum + ((_sample((_p_input._uv + _l6_offset)).xyz + _sample((_p_input._uv - _l6_offset)).xyz) * _l5_w));\n            _l1_weight_sum = (_l1_weight_sum + (2.0 * _l5_w));\n        }\n    }\n    return vec4((_l2_sum / _l1_weight_sum), 1.0);\n}\nvoid main() {\n    vec4 _result = _blur(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_BLOOM_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nuniform highp sampler2D _image_linear_sampler;\nuniform highp sampler2D _second_linear_sampler;\nuniform highp sampler2D _third_linear_sampler;\nuniform highp sampler2D _fourth_linear_sampler;\nuniform highp sampler2D _fifth_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec4 _bloom(_Varyings _p_input) {\n    vec2 _l0_uv = _p_input._uv;\n    vec4 _l1_w = _parameters._values;\n    return (((((_l1_w.x * _sample(_l0_uv)) + (_l1_w.y * textureLod(_second_linear_sampler, _l0_uv, 0.0))) + (_l1_w.z * textureLod(_third_linear_sampler, _l0_uv, 0.0))) + (_l1_w.w * textureLod(_fourth_linear_sampler, _l0_uv, 0.0))) + (_parameters._more.x * textureLod(_fifth_linear_sampler, _l0_uv, 0.0)));\n}\nvoid main() {\n    vec4 _result = _bloom(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_COMPOSITE_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nlayout(std140) uniform post_block {\n    _Post _post;\n};\nuniform highp sampler2D _image_linear_sampler;\nuniform highp sampler2D _second_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec3 _vignetted(vec3 _p_c, vec2 _p_uv) {\n    float _l0_d = length(((_p_uv - 0.5) * _post._vignette_scale.xy));\n    return (_p_c * (1.0 - (_post._vignette.x * smoothstep(_post._vignette.y, _post._vignette.z, _l0_d))));\n}\nvec3 _display_graded(vec3 _p_color, vec2 _p_uv) {\n    vec3 _l0_c = clamp(_p_color, vec3(0.0), vec3(1.0));\n    float _l1_l = dot(_l0_c, vec3(0.2126, 0.7152, 0.0722));\n    float _l2_bright = (smoothstep(_post._night_spare.z, _post._night_spare.w, _l1_l) * ((_post._night.w > 0.0) ? min(1.0, (_post._night.x * _post._night.w)) : 1.0));\n    float _l3_spare = max(smoothstep(_post._night_spare.x, _post._night_spare.y, (_l0_c.x - _l0_c.z)), _l2_bright);\n    float _l4_n = (_post._night.x * (1.0 - _l3_spare));\n    vec3 _l5_g = mix(vec3(_l1_l), _l0_c, ((_post._grade.y * (1.0 + ((_post._night.z * _post._night.x) * _l3_spare))) * (1.0 - (_post._night.y * _l4_n))));\n    _l5_g = (((_l5_g - 0.5) * (1.0 + _post._grade.x)) + 0.5);\n    _l5_g = (_l5_g * mix(_post._shadows.xyz, _post._highlights.xyz, smoothstep(_post._shadows.w, _post._highlights.w, _l1_l)));\n    _l5_g = (_l5_g * mix(vec3(1.0), _post._night_tint.xyz, _l4_n));\n    _l5_g = (_l5_g * (1.0 + (_post._lift.x * smoothstep(_post._lift.y, _post._lift.z, _l1_l))));\n    _l5_g = (_l5_g + (_post._flash.xyz * _post._flash.w));\n    return _vignetted(mix(_l0_c, clamp(_l5_g, vec3(0.0), vec3(1.0)), _post._grade.z), _p_uv);\n}\nvec3 _agx_curve(vec3 _p_x) {\n    vec3 _l0_x2 = (_p_x * _p_x);\n    vec3 _l1_x4 = (_l0_x2 * _l0_x2);\n    return ((((((((15.5 * _l1_x4) * _l0_x2) - ((40.14 * _l1_x4) * _p_x)) + (31.96 * _l1_x4)) - ((6.868 * _l0_x2) * _p_x)) + (0.4298 * _l0_x2)) + (0.1191 * _p_x)) - 0.00232);\n}\nvec3 _rrt(vec3 _p_v) {\n    vec3 _l0_a = ((_p_v * (_p_v + 0.0245786)) - 9.0537e-5);\n    vec3 _l1_b = ((_p_v * ((0.983729 * _p_v) + 0.432951)) + 0.238081);\n    return (_l0_a / _l1_b);\n}\nvec3 _tone(vec3 _p_color, uint _p_mode, float _p_exposure) {\n    if ((_p_mode == 1u)) {\n        return clamp((_p_color * _p_exposure), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 2u)) {\n        vec3 _l0_c = (_p_color * _p_exposure);\n        return clamp((_l0_c / (vec3(1.0) + _l0_c)), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 3u)) {\n        vec3 _l1_c = max(vec3(0.0), ((_p_color * _p_exposure) - 0.004));\n        return pow(((_l1_c * ((6.2 * _l1_c) + 0.5)) / ((_l1_c * ((6.2 * _l1_c) + 1.7)) + 0.06)), vec3(2.2));\n    }\n    if ((_p_mode == 4u)) {\n        mat3 _l2_input = mat3(vec3(0.59719, 0.076, 0.0284), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));\n        mat3 _l3_output = mat3(vec3(1.60475, (-0.10208), (-0.00327)), vec3((-0.53108), 1.10813, (-0.07276)), vec3((-0.07367), (-0.00605), 1.07602));\n        return clamp((_l3_output * _rrt((_l2_input * (_p_color * (_p_exposure / 0.6))))), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 5u)) {\n        mat3 _l4_to2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.088), vec3(0.0433, 0.0113, 0.8956));\n        mat3 _l5_from2020 = mat3(vec3(1.6605, (-0.1246), (-0.0182)), vec3((-0.5876), 1.1329, (-0.1006)), vec3((-0.0728), (-0.0083), 1.1187));\n        mat3 _l6_inset = mat3(vec3(0.85662717, 0.13731897, 0.11189821), vec3(0.09512124, 0.761242, 0.076799415), vec3(0.048251607, 0.10143904, 0.81130236));\n        mat3 _l7_outset = mat3(vec3(1.1271006, (-0.14132977), (-0.14132977)), vec3((-0.11060664), 1.1578237, (-0.11060664)), vec3((-0.016493939), (-0.016493939), 1.2519364));\n        vec3 _l8_c = (_l6_inset * (_l4_to2020 * (_p_color * _p_exposure)));\n        _l8_c = clamp(((log2(max(_l8_c, vec3(1e-10))) + 12.47393) / 16.499998), vec3(0.0), vec3(1.0));\n        _l8_c = (_l7_outset * _agx_curve(_l8_c));\n        return clamp((_l5_from2020 * pow(max(vec3(0.0), _l8_c), vec3(2.2))), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 6u)) {\n        vec3 _l9_c = (_p_color * _p_exposure);\n        float _l10_x = min(_l9_c.x, min(_l9_c.y, _l9_c.z));\n        _l9_c = (_l9_c - vec3(((_l10_x < 0.08) ? (_l10_x - ((6.25 * _l10_x) * _l10_x)) : 0.04)));\n        float _l11_peak = max(_l9_c.x, max(_l9_c.y, _l9_c.z));\n        if ((_l11_peak < 0.76)) {\n            return _l9_c;\n        }\n        float _l12_top = (1.0 - (0.0576 / (_l11_peak - 0.52)));\n        _l9_c = (_l9_c * (_l12_top / _l11_peak));\n        return mix(_l9_c, vec3(_l12_top), (1.0 - (1.0 / ((0.15 * (_l11_peak - _l12_top)) + 1.0))));\n    }\n    return _p_color;\n}\nvec3 _encode(vec3 _p_x) {\n    vec3 _l0_c = clamp(_p_x, vec3(0.0), vec3(1.0));\n    return mix(((1.055 * pow(_l0_c, vec3(0.41666666))) - 0.055), (_l0_c * 12.92), lessThan(_l0_c, vec3(0.0031308)));\n}\nvec3 _graded(vec3 _p_color, vec2 _p_uv) {\n    vec3 _l0_c = clamp(_p_color, vec3(0.0), vec3(1.0));\n    vec3 _l1_s = mix(_l0_c, ((_l0_c * _l0_c) * (3.0 - (2.0 * _l0_c))), _post._grade.x);\n    float _l2_l = dot(_l1_s, vec3(0.299, 0.587, 0.114));\n    _l1_s = mix(vec3(_l2_l), _l1_s, _post._grade.y);\n    _l1_s = (_l1_s * mix(_post._shadows.xyz, _post._highlights.xyz, smoothstep(_post._shadows.w, _post._highlights.w, _l2_l)));\n    _l0_c = mix(_l0_c, clamp(_l1_s, vec3(0.0), vec3(1.0)), _post._grade.z);\n    return _vignetted(_l0_c, _p_uv);\n}\nvec3 _decode(vec3 _p_c) {\n    return mix(pow(((_p_c + 0.055) / 1.055), vec3(2.4)), (_p_c / 12.92), lessThan(_p_c, vec3(0.04045)));\n}\nvec4 _finite(vec4 _p_c) {\n    return mix(vec4(0.0), min(_p_c, vec4(65504.0)), greaterThanEqual(_p_c, vec4(0.0)));\n}\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec4 _composite(_Varyings _p_input) {\n    vec4 _l0_s = _finite(_sample(_p_input._uv));\n    vec3 _l1_g = vec3(0.0);\n    if ((_parameters._values.x > 0.5)) {\n        vec4 _l2_glow = _finite(textureLod(_second_linear_sampler, _p_input._uv, 0.0));\n        _l1_g = (_l2_glow.xyz * _l2_glow.w);\n    }\n    bool _l3_grade = (_parameters._values.y > 0.5);\n    bool _l4_display = (_post._grade.w > 0.5);\n    if ((_parameters._output.z < 0.5)) {\n        vec3 _l5_encoded = _l0_s.xyz;\n        if ((_parameters._values.x > 0.5)) {\n            _l5_encoded = _encode((_decode(_l0_s.xyz) + _l1_g));\n        }\n        if (_l3_grade) {\n            _l5_encoded = _display_graded(_l5_encoded, _p_input._uv);\n        }\n        return vec4(_l5_encoded, _l0_s.w);\n    }\n    bool _l6_over = (_parameters._output.w > 0.5);\n    float _l7_k = ((_l6_over && (_l0_s.w > 0.001)) ? _l0_s.w : 1.0);\n    vec3 _l8_lit = min(((_l0_s.xyz / _l7_k) + (_l1_g / _l7_k)), vec3(65504.0));\n    if (_l3_grade) {\n        _l8_lit = min((_l8_lit + (_post._flash.xyz * (1.0 - _post._flash.w))), vec3(65504.0));\n        if ((!_l4_display)) {\n            _l8_lit = _graded(_l8_lit, _p_input._uv);\n        }\n    }\n    vec3 _l9_shown = _encode(_tone(_l8_lit, uint((_parameters._output.x + 0.5)), _parameters._output.y));\n    if ((_l3_grade && _l4_display)) {\n        _l9_shown = _display_graded(_l9_shown, _p_input._uv);\n    }\n    return vec4((_l9_shown * (_l6_over ? _l7_k : 1.0)), _l0_s.w);\n}\nvoid main() {\n    vec4 _result = _composite(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_FXAA_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nuniform highp sampler2D _image_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec2 _gl(vec2 _p_uv) {\n    return vec2(_p_uv.x, (1.0 - _p_uv.y));\n}\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nfloat _fxaa_luma(vec2 _p_uv) {\n    return dot(_sample(_gl(_p_uv)).xyz, vec3(0.3, 0.59, 0.11));\n}\nfloat _edge_step(int _p_i) {\n    if ((_p_i == 0)) {\n        return 1.0;\n    }\n    if ((_p_i == 1)) {\n        return 1.5;\n    }\n    if ((_p_i == 5)) {\n        return 4.0;\n    }\n    return 2.0;\n}\nvec4 _fxaa(_Varyings _p_input) {\n    vec2 _l0_uv = _gl(_p_input._uv);\n    vec2 _l1_t = _parameters._size.zw;\n    float _l2_m = _fxaa_luma(_l0_uv);\n    float _l3_n = _fxaa_luma((_l0_uv + (_l1_t * vec2(0.0, 1.0))));\n    float _l4_e = _fxaa_luma((_l0_uv + (_l1_t * vec2(1.0, 0.0))));\n    float _l5_s = _fxaa_luma((_l0_uv + (_l1_t * vec2(0.0, (-1.0)))));\n    float _l6_w = _fxaa_luma((_l0_uv + (_l1_t * vec2((-1.0), 0.0))));\n    float _l7_ne = _fxaa_luma((_l0_uv + (_l1_t * vec2(1.0, 1.0))));\n    float _l8_nw = _fxaa_luma((_l0_uv + (_l1_t * vec2((-1.0), 1.0))));\n    float _l9_se = _fxaa_luma((_l0_uv + (_l1_t * vec2(1.0, (-1.0)))));\n    float _l10_sw = _fxaa_luma((_l0_uv + (_l1_t * vec2((-1.0), (-1.0)))));\n    float _l11_highest = max(max(max(max(_l3_n, _l4_e), _l5_s), _l6_w), _l2_m);\n    float _l12_lowest = min(min(min(min(_l3_n, _l4_e), _l5_s), _l6_w), _l2_m);\n    float _l13_contrast = (_l11_highest - _l12_lowest);\n    if ((_l13_contrast < max(0.0312, (0.063 * _l11_highest)))) {\n        return _sample(_p_input._uv);\n    }\n    float _l14_f = ((((((2.0 * (((_l3_n + _l4_e) + _l5_s) + _l6_w)) + _l7_ne) + _l8_nw) + _l9_se) + _l10_sw) / 12.0);\n    _l14_f = clamp((abs((_l14_f - _l2_m)) / _l13_contrast), 0.0, 1.0);\n    float _l15_smooth_f = smoothstep(0.0, 1.0, _l14_f);\n    float _l16_pixel_blend = (_l15_smooth_f * _l15_smooth_f);\n    float _l17_horizontal_edge = (((abs(((_l3_n + _l5_s) - (2.0 * _l2_m))) * 2.0) + abs(((_l7_ne + _l9_se) - (2.0 * _l4_e)))) + abs(((_l8_nw + _l10_sw) - (2.0 * _l6_w))));\n    float _l18_vertical_edge = (((abs(((_l4_e + _l6_w) - (2.0 * _l2_m))) * 2.0) + abs(((_l7_ne + _l8_nw) - (2.0 * _l3_n)))) + abs(((_l9_se + _l10_sw) - (2.0 * _l5_s))));\n    bool _l19_horizontal = (_l17_horizontal_edge >= _l18_vertical_edge);\n    float _l20_p_luma = (_l19_horizontal ? _l3_n : _l4_e);\n    float _l21_n_luma = (_l19_horizontal ? _l5_s : _l6_w);\n    float _l22_p_gradient = abs((_l20_p_luma - _l2_m));\n    float _l23_n_gradient = abs((_l21_n_luma - _l2_m));\n    float _l24_pixel_step = (_l19_horizontal ? _l1_t.y : _l1_t.x);\n    float _l25_opposite = _l20_p_luma;\n    float _l26_gradient = _l22_p_gradient;\n    if ((_l22_p_gradient < _l23_n_gradient)) {\n        _l24_pixel_step = (-_l24_pixel_step);\n        _l25_opposite = _l21_n_luma;\n        _l26_gradient = _l23_n_gradient;\n    }\n    vec2 _l27_uv_edge = _l0_uv;\n    vec2 _l28_edge_dir = vec2(0.0, _l1_t.y);\n    if (_l19_horizontal) {\n        _l27_uv_edge.y = (_l27_uv_edge.y + (_l24_pixel_step * 0.5));\n        _l28_edge_dir = vec2(_l1_t.x, 0.0);\n    } else {\n        _l27_uv_edge.x = (_l27_uv_edge.x + (_l24_pixel_step * 0.5));\n    }\n    float _l29_edge_luma = ((_l2_m + _l25_opposite) * 0.5);\n    float _l30_threshold = (_l26_gradient * 0.25);\n    vec2 _l31_puv = (_l27_uv_edge + (_l28_edge_dir * _edge_step(0)));\n    float _l32_p_delta = (_fxaa_luma(_l31_puv) - _l29_edge_luma);\n    bool _l33_p_end = (abs(_l32_p_delta) >= _l30_threshold);\n    {\n        int _l34_i = 1;\n        for (; ((_l34_i < 6) && (!_l33_p_end)); _l34_i = (_l34_i + 1)) {\n            _l31_puv = (_l31_puv + (_l28_edge_dir * _edge_step(_l34_i)));\n            _l32_p_delta = (_fxaa_luma(_l31_puv) - _l29_edge_luma);\n            _l33_p_end = (abs(_l32_p_delta) >= _l30_threshold);\n        }\n    }\n    if ((!_l33_p_end)) {\n        _l31_puv = (_l31_puv + (_l28_edge_dir * 8.0));\n    }\n    vec2 _l35_nuv = (_l27_uv_edge - (_l28_edge_dir * _edge_step(0)));\n    float _l36_n_delta = (_fxaa_luma(_l35_nuv) - _l29_edge_luma);\n    bool _l37_n_end = (abs(_l36_n_delta) >= _l30_threshold);\n    {\n        int _l38_i = 1;\n        for (; ((_l38_i < 6) && (!_l37_n_end)); _l38_i = (_l38_i + 1)) {\n            _l35_nuv = (_l35_nuv - (_l28_edge_dir * _edge_step(_l38_i)));\n            _l36_n_delta = (_fxaa_luma(_l35_nuv) - _l29_edge_luma);\n            _l37_n_end = (abs(_l36_n_delta) >= _l30_threshold);\n        }\n    }\n    if ((!_l37_n_end)) {\n        _l35_nuv = (_l35_nuv - (_l28_edge_dir * 8.0));\n    }\n    float _l39_p_distance = (_l19_horizontal ? (_l31_puv.x - _l0_uv.x) : (_l31_puv.y - _l0_uv.y));\n    float _l40_n_distance = (_l19_horizontal ? (_l0_uv.x - _l35_nuv.x) : (_l0_uv.y - _l35_nuv.y));\n    float _l41_shortest = _l40_n_distance;\n    bool _l42_delta_sign = (_l36_n_delta >= 0.0);\n    if ((_l39_p_distance <= _l40_n_distance)) {\n        _l41_shortest = _l39_p_distance;\n        _l42_delta_sign = (_l32_p_delta >= 0.0);\n    }\n    float _l43_edge_blend = (0.5 - (_l41_shortest / (_l39_p_distance + _l40_n_distance)));\n    if ((_l42_delta_sign == ((_l2_m - _l29_edge_luma) >= 0.0))) {\n        _l43_edge_blend = 0.0;\n    }\n    float _l44_blend = max(_l16_pixel_blend, _l43_edge_blend);\n    if (_l19_horizontal) {\n        _l0_uv.y = (_l0_uv.y + (_l24_pixel_step * _l44_blend));\n    } else {\n        _l0_uv.x = (_l0_uv.x + (_l24_pixel_step * _l44_blend));\n    }\n    return _sample(_gl(_l0_uv));\n}\nvoid main() {\n    vec4 _result = _fxaa(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_SMAA_EDGES_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nuniform highp sampler2D _image_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec2 _gl(vec2 _p_uv) {\n    return vec2(_p_uv.x, (1.0 - _p_uv.y));\n}\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec3 _smaa_color(vec2 _p_uv) {\n    return _sample(_gl(_p_uv)).xyz;\n}\nfloat _max3(vec3 _p_v) {\n    return max(max(_p_v.x, _p_v.y), _p_v.z);\n}\nvec4 _smaa_edges(_Varyings _p_input) {\n    vec2 _l0_uv = _gl(_p_input._uv);\n    vec2 _l1_r = _parameters._size.zw;\n    vec3 _l2_c = _smaa_color(_l0_uv);\n    vec4 _l3_delta = vec4(_max3(abs((_l2_c - _smaa_color((_l0_uv + (_l1_r * vec2((-1.0), 0.0))))))), _max3(abs((_l2_c - _smaa_color((_l0_uv + (_l1_r * vec2(0.0, 1.0))))))), 0.0, 0.0);\n    vec2 _l4_edges = step(vec2(0.1), _l3_delta.xy);\n    if ((dot(_l4_edges, vec2(1.0)) == 0.0)) {\n        discard;\n    }\n    _l3_delta.z = _max3(abs((_l2_c - _smaa_color((_l0_uv + (_l1_r * vec2(1.0, 0.0)))))));\n    _l3_delta.w = _max3(abs((_l2_c - _smaa_color((_l0_uv + (_l1_r * vec2(0.0, (-1.0))))))));\n    float _l5_max_delta = max(max(max(_l3_delta.x, _l3_delta.y), _l3_delta.z), _l3_delta.w);\n    _l3_delta.z = _max3(abs((_l2_c - _smaa_color((_l0_uv + (_l1_r * vec2((-2.0), 0.0)))))));\n    _l3_delta.w = _max3(abs((_l2_c - _smaa_color((_l0_uv + (_l1_r * vec2(0.0, 2.0)))))));\n    _l5_max_delta = max(max(_l5_max_delta, _l3_delta.z), _l3_delta.w);\n    _l4_edges = (_l4_edges * step(vec2((0.5 * _l5_max_delta)), _l3_delta.xy));\n    return vec4(_l4_edges, 0.0, 0.0);\n}\nvoid main() {\n    vec4 _result = _smaa_edges(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_SMAA_WEIGHTS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nuniform highp sampler2D _image_linear_sampler;\nuniform highp sampler2D _second_linear_sampler;\nuniform highp sampler2D _third_nearest_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec2 _smaa_area(vec2 _p_distance, float _p_e1, float _p_e2) {\n    vec2 _l0_texel = ((16.0 * roundEven((4.0 * vec2(_p_e1, _p_e2)))) + _p_distance);\n    return textureLod(_second_linear_sampler, ((_l0_texel + 0.5) / 80.0), 0.0).xy;\n}\nvec2 _gl(vec2 _p_uv) {\n    return vec2(_p_uv.x, (1.0 - _p_uv.y));\n}\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec2 _smaa_edge(vec2 _p_uv) {\n    return _sample(_gl(_p_uv)).xy;\n}\nfloat _smaa_search_length(vec2 _p_e, float _p_bias, float _p_scale) {\n    return (255.0 * textureLod(_third_nearest_sampler, vec2((_p_bias + (_p_e.x * _p_scale)), _p_e.y), 0.0).x);\n}\nfloat _smaa_search_down(vec2 _p_start, float _p_end) {\n    vec2 _l0_r = _parameters._size.zw;\n    vec2 _l1_uv = _p_start;\n    vec2 _l2_e = vec2(1.0, 0.0);\n    {\n        int _l3_i = 0;\n        for (; (_l3_i < 8); _l3_i = (_l3_i + 1)) {\n            _l2_e = _smaa_edge(_l1_uv);\n            _l1_uv = (_l1_uv - (vec2(0.0, 2.0) * _l0_r));\n            if ((!(((_l1_uv.y < _p_end) && (_l2_e.x > 0.8281)) && (_l2_e.y == 0.0)))) {\n                break;\n            }\n        }\n    }\n    _l1_uv.y = (_l1_uv.y + (((0.25 * _l0_r.y) + _l0_r.y) + (2.0 * _l0_r.y)));\n    return (_l1_uv.y - (_l0_r.y * _smaa_search_length(_l2_e.yx, 0.5, 0.5)));\n}\nfloat _smaa_search_up(vec2 _p_start, float _p_end) {\n    vec2 _l0_r = _parameters._size.zw;\n    vec2 _l1_uv = _p_start;\n    vec2 _l2_e = vec2(1.0, 0.0);\n    {\n        int _l3_i = 0;\n        for (; (_l3_i < 8); _l3_i = (_l3_i + 1)) {\n            _l2_e = _smaa_edge(_l1_uv);\n            _l1_uv = (_l1_uv + (vec2(0.0, 2.0) * _l0_r));\n            if ((!(((_l1_uv.y > _p_end) && (_l2_e.x > 0.8281)) && (_l2_e.y == 0.0)))) {\n                break;\n            }\n        }\n    }\n    _l1_uv.y = (_l1_uv.y - (((0.25 * _l0_r.y) + _l0_r.y) + (2.0 * _l0_r.y)));\n    return (_l1_uv.y + (_l0_r.y * _smaa_search_length(_l2_e.yx, 0.0, 0.5)));\n}\nfloat _smaa_search_right(vec2 _p_start, float _p_end) {\n    vec2 _l0_r = _parameters._size.zw;\n    vec2 _l1_uv = _p_start;\n    vec2 _l2_e = vec2(0.0, 1.0);\n    {\n        int _l3_i = 0;\n        for (; (_l3_i < 8); _l3_i = (_l3_i + 1)) {\n            _l2_e = _smaa_edge(_l1_uv);\n            _l1_uv = (_l1_uv + (vec2(2.0, 0.0) * _l0_r));\n            if ((!(((_l1_uv.x < _p_end) && (_l2_e.y > 0.8281)) && (_l2_e.x == 0.0)))) {\n                break;\n            }\n        }\n    }\n    _l1_uv.x = (_l1_uv.x - (((0.25 * _l0_r.x) + _l0_r.x) + (2.0 * _l0_r.x)));\n    return (_l1_uv.x + (_l0_r.x * _smaa_search_length(_l2_e, 0.5, 0.5)));\n}\nfloat _smaa_search_left(vec2 _p_start, float _p_end) {\n    vec2 _l0_r = _parameters._size.zw;\n    vec2 _l1_uv = _p_start;\n    vec2 _l2_e = vec2(0.0, 1.0);\n    {\n        int _l3_i = 0;\n        for (; (_l3_i < 8); _l3_i = (_l3_i + 1)) {\n            _l2_e = _smaa_edge(_l1_uv);\n            _l1_uv = (_l1_uv - (vec2(2.0, 0.0) * _l0_r));\n            if ((!(((_l1_uv.x > _p_end) && (_l2_e.y > 0.8281)) && (_l2_e.x == 0.0)))) {\n                break;\n            }\n        }\n    }\n    _l1_uv.x = (_l1_uv.x + (((0.25 * _l0_r.x) + _l0_r.x) + (2.0 * _l0_r.x)));\n    return (_l1_uv.x - (_l0_r.x * _smaa_search_length(_l2_e, 0.0, 0.5)));\n}\nvec4 _smaa_weights(_Varyings _p_input) {\n    vec2 _l0_uv = _gl(_p_input._uv);\n    vec2 _l1_r = _parameters._size.zw;\n    vec2 _l2_pixel = (_l0_uv * _parameters._size.xy);\n    vec4 _l3_o0 = (_l0_uv.xyxy + (_l1_r.xyxy * vec4((-0.25), 0.125, 1.25, 0.125)));\n    vec4 _l4_o1 = (_l0_uv.xyxy + (_l1_r.xyxy * vec4((-0.125), 0.25, (-0.125), (-1.25))));\n    vec4 _l5_o2 = (vec4(_l3_o0.xz, _l4_o1.yw) + ((vec4((-2.0), 2.0, (-2.0), 2.0) * _l1_r.xxyy) * 8.0));\n    vec4 _l6_weights = vec4(0.0);\n    vec2 _l7_e = _sample(_p_input._uv).xy;\n    if ((_l7_e.y > 0.0)) {\n        vec2 _l8_d = vec2(_smaa_search_left(_l3_o0.xy, _l5_o2.x), 0.0);\n        vec2 _l9_coords = vec2(_l8_d.x, _l4_o1.y);\n        float _l10_e1 = _smaa_edge(_l9_coords).x;\n        _l9_coords.x = _smaa_search_right(_l3_o0.zw, _l5_o2.y);\n        _l8_d.y = _l9_coords.x;\n        _l8_d = ((_l8_d / _l1_r.x) - _l2_pixel.x);\n        _l9_coords.y = (_l9_coords.y - _l1_r.y);\n        float _l11_e2 = _smaa_edge((_l9_coords + _l1_r)).x;\n        vec2 _l12_a = _smaa_area(sqrt(abs(_l8_d)), _l10_e1, _l11_e2);\n        _l6_weights.x = _l12_a.x;\n        _l6_weights.y = _l12_a.y;\n    }\n    if ((_l7_e.x > 0.0)) {\n        vec2 _l13_d = vec2(_smaa_search_up(_l4_o1.xy, _l5_o2.z), 0.0);\n        vec2 _l14_coords = vec2(_l3_o0.x, _l13_d.x);\n        float _l15_e1 = _smaa_edge(_l14_coords).y;\n        _l14_coords.y = _smaa_search_down(_l4_o1.zw, _l5_o2.w);\n        _l13_d.y = _l14_coords.y;\n        _l13_d = ((_l13_d / _l1_r.y) - _l2_pixel.y);\n        _l14_coords.y = (_l14_coords.y - _l1_r.y);\n        float _l16_e2 = _smaa_edge(_l14_coords).y;\n        vec2 _l17_a = _smaa_area(sqrt(abs(_l13_d)), _l15_e1, _l16_e2);\n        _l6_weights.z = _l17_a.x;\n        _l6_weights.w = _l17_a.y;\n    }\n    return _l6_weights;\n}\nvoid main() {\n    vec4 _result = _smaa_weights(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const POST_SMAA_BLEND_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Parameters {\n    vec4 _values;\n    vec4 _more;\n    vec4 _size;\n    vec4 _output;\n};\nstruct _Post {\n    vec4 _flags;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _denoise0;\n    vec4 _denoise1;\n    mat4 _projection;\n    mat4 _inverse_projection;\n    vec4 _view_normal[3];\n    vec4 _bloom;\n    vec4 _grade;\n    vec4 _shadows;\n    vec4 _highlights;\n    vec4 _vignette;\n    vec4 _vignette_scale;\n    vec4 _flash;\n    vec4 _night;\n    vec4 _night_tint;\n    vec4 _night_spare;\n    vec4 _lift;\n    mat4 _game_inverse;\n    vec4 _game_camera;\n    vec4 _game_forward;\n    vec4 _game[16];\n};\nstruct _Varyings {\n    vec4 _position;\n    vec2 _uv;\n};\nlayout(std140) uniform parameters_block {\n    _Parameters _parameters;\n};\nuniform highp sampler2D _image_linear_sampler;\nuniform highp sampler2D _second_linear_sampler;\nin vec2 _v0;\nlayout(location = 0) out vec4 _o0;\nvec2 _gl(vec2 _p_uv) {\n    return vec2(_p_uv.x, (1.0 - _p_uv.y));\n}\nvec4 _sample(vec2 _p_uv) {\n    return textureLod(_image_linear_sampler, _p_uv, 0.0);\n}\nvec4 _smaa_blend(_Varyings _p_input) {\n    vec2 _l0_uv = _gl(_p_input._uv);\n    vec2 _l1_r = _parameters._size.zw;\n    vec4 _l2_weights = textureLod(_second_linear_sampler, _p_input._uv, 0.0);\n    vec4 _l3_a = vec4(_l2_weights.x, textureLod(_second_linear_sampler, _gl((_l0_uv + (_l1_r * vec2(0.0, (-1.0))))), 0.0).y, _l2_weights.z, textureLod(_second_linear_sampler, _gl((_l0_uv + (_l1_r * vec2(1.0, 0.0)))), 0.0).w);\n    if ((dot(_l3_a, vec4(1.0)) < 1e-5)) {\n        return _sample(_p_input._uv);\n    }\n    vec2 _l4_offset = vec2(((_l3_a.w > _l3_a.z) ? _l3_a.w : (-_l3_a.z)), ((_l3_a.y > _l3_a.x) ? (-_l3_a.y) : _l3_a.x));\n    if ((abs(_l4_offset.x) > abs(_l4_offset.y))) {\n        _l4_offset.y = 0.0;\n    } else {\n        _l4_offset.x = 0.0;\n    }\n    vec4 _l5_c = _sample(_p_input._uv);\n    vec4 _l6_opposite = _sample(_gl((_l0_uv + (sign(_l4_offset) * _l1_r))));\n    float _l7_s = ((abs(_l4_offset.x) > abs(_l4_offset.y)) ? abs(_l4_offset.x) : abs(_l4_offset.y));\n    _l5_c = vec4(pow(_l5_c.xyz, vec3(2.2)), _l5_c.w);\n    _l6_opposite = vec4(pow(_l6_opposite.xyz, vec3(2.2)), _l6_opposite.w);\n    vec4 _l8_mixed = mix(_l5_c, _l6_opposite, _l7_s);\n    return vec4(pow(_l8_mixed.xyz, vec3(0.45454547)), _l8_mixed.w);\n}\nvoid main() {\n    vec4 _result = _smaa_blend(_Varyings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const MESH_VS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform frame_block {\n    _Frame _frame;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nlayout(location = 0) in vec3 _a0;\nlayout(location = 1) in vec3 _a1;\nlayout(location = 2) in vec2 _a2;\nlayout(location = 3) in vec4 _a3;\nlayout(location = 4) in vec4 _a4;\nlayout(location = 5) in vec4 _a5;\nlayout(location = 6) in vec4 _a6;\nlayout(location = 7) in vec4 _a7;\nout vec3 _v0;\nout vec3 _v1;\nout vec2 _v2;\nout vec4 _v3;\nvec4 _shading_color(vec4 _p_c) {\n    return clamp(_p_c, vec4(0.0), vec4(65504.0, 65504.0, 65504.0, 1.0));\n}\n_Varyings _vs(vec3 _p_position, vec3 _p_normal, vec2 _p_uv, vec4 _p_model0, vec4 _p_model1, vec4 _p_model2, vec4 _p_tint, vec4 _p_color) {\n    vec4 _l0_d = _material._extra;\n    bool _l1_compact = (_l0_d.w > 0.5);\n    vec3 _l2_p = (_l1_compact ? ((_p_position * _l0_d.x) + vec3(_l0_d.y)) : _p_position);\n    vec3 _l3_n = ((_l0_d.w > 1.5) ? vec3(0.0, 1.0, 0.0) : _p_normal);\n    vec2 _l4_t = (_l1_compact ? (vec2(_p_uv.x, (1.0 - _p_uv.y)) * _l0_d.z) : _p_uv);\n    if ((_material._ao1.w > 0.5)) {\n        _Varyings _l5_sky = _Varyings(vec4(0.0), vec3(0.0), vec3(0.0), vec2(0.0), vec4(0.0));\n        _l5_sky._world = (((_p_model0.xyz * _l2_p.x) + (_p_model1.xyz * _l2_p.y)) + vec3(_p_model0.w, _p_model1.w, _p_model2.w));\n        _l5_sky._normal = vec3(0.0, 0.0, 1.0);\n        _l5_sky._uv = _l4_t;\n        _l5_sky._tint = _p_tint;\n        _l5_sky._position = vec4(_l2_p.xy, 0.5, 1.0);\n        return _l5_sky;\n    }\n    vec3 _l6_c0 = _p_model0.xyz;\n    vec3 _l7_c1 = _p_model1.xyz;\n    vec3 _l8_c2 = _p_model2.xyz;\n    vec3 _l9_origin = vec3(_p_model0.w, _p_model1.w, _p_model2.w);\n    _Varyings _l10_output = _Varyings(vec4(0.0), vec3(0.0), vec3(0.0), vec2(0.0), vec4(0.0));\n    _l10_output._world = ((((_l6_c0 * _l2_p.x) + (_l7_c1 * _l2_p.y)) + (_l8_c2 * _l2_p.z)) + _l9_origin);\n    float _l11_det = dot(_l6_c0, cross(_l7_c1, _l8_c2));\n    _l10_output._normal = ((mat3(cross(_l7_c1, _l8_c2), cross(_l8_c2, _l6_c0), cross(_l6_c0, _l7_c1)) * _l3_n) * ((_l11_det < 0.0) ? (-1.0) : 1.0));\n    uint _l12_flags = uint(_material._params.w);\n    _l10_output._uv = _l4_t;\n    _l10_output._tint = (_p_tint * (((_l12_flags & 4096u) != 0u) ? _shading_color(_p_color) : vec4(1.0)));\n    vec4 _l13_clip = (_frame._view_projection * vec4(_l10_output._world, 1.0));\n    if (((_l12_flags & 131072u) != 0u)) {\n        _l10_output._world = _l9_origin;\n        _l10_output._normal = vec3(0.0, 0.0, 1.0);\n        _l13_clip = (_frame._view_projection * vec4(_l9_origin, 1.0));\n        float _l14_size = _material._ao0.w;\n        if ((((_l12_flags & 262144u) != 0u) && (_frame._viewport.z > 0.5))) {\n            _l14_size = (((_l14_size * _frame._viewport.y) * 0.5) / max(_l13_clip.w, 1e-6));\n        }\n        _l14_size = min(_l14_size, _frame._viewport.w);\n        vec2 _l15_extent = (((_l2_p.xy * 2.0) * _l14_size) / max(_frame._viewport.xy, vec2(1.0)));\n        _l13_clip = vec4((_l13_clip.xy + (_l15_extent * _l13_clip.w)), _l13_clip.z, _l13_clip.w);\n    }\n    _l13_clip.z = ((_l13_clip.z + _l13_clip.w) * 0.5);\n    _l10_output._position = _l13_clip;\n    return _l10_output;\n}\nvoid main() {\n    _Varyings _result = _vs(_a0, _a1, _a2, _a3, _a4, _a5, _a6, _a7);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, -_position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._world;\n    _v1 = _result._normal;\n    _v2 = _result._uv;\n    _v3 = _result._tint;\n}\n";
const MESH_VS_GLSL_WINDOW = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform frame_block {\n    _Frame _frame;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nlayout(location = 0) in vec3 _a0;\nlayout(location = 1) in vec3 _a1;\nlayout(location = 2) in vec2 _a2;\nlayout(location = 3) in vec4 _a3;\nlayout(location = 4) in vec4 _a4;\nlayout(location = 5) in vec4 _a5;\nlayout(location = 6) in vec4 _a6;\nlayout(location = 7) in vec4 _a7;\nout vec3 _v0;\nout vec3 _v1;\nout vec2 _v2;\nout vec4 _v3;\nvec4 _shading_color(vec4 _p_c) {\n    return clamp(_p_c, vec4(0.0), vec4(65504.0, 65504.0, 65504.0, 1.0));\n}\n_Varyings _vs(vec3 _p_position, vec3 _p_normal, vec2 _p_uv, vec4 _p_model0, vec4 _p_model1, vec4 _p_model2, vec4 _p_tint, vec4 _p_color) {\n    vec4 _l0_d = _material._extra;\n    bool _l1_compact = (_l0_d.w > 0.5);\n    vec3 _l2_p = (_l1_compact ? ((_p_position * _l0_d.x) + vec3(_l0_d.y)) : _p_position);\n    vec3 _l3_n = ((_l0_d.w > 1.5) ? vec3(0.0, 1.0, 0.0) : _p_normal);\n    vec2 _l4_t = (_l1_compact ? (vec2(_p_uv.x, (1.0 - _p_uv.y)) * _l0_d.z) : _p_uv);\n    if ((_material._ao1.w > 0.5)) {\n        _Varyings _l5_sky = _Varyings(vec4(0.0), vec3(0.0), vec3(0.0), vec2(0.0), vec4(0.0));\n        _l5_sky._world = (((_p_model0.xyz * _l2_p.x) + (_p_model1.xyz * _l2_p.y)) + vec3(_p_model0.w, _p_model1.w, _p_model2.w));\n        _l5_sky._normal = vec3(0.0, 0.0, 1.0);\n        _l5_sky._uv = _l4_t;\n        _l5_sky._tint = _p_tint;\n        _l5_sky._position = vec4(_l2_p.xy, 0.5, 1.0);\n        return _l5_sky;\n    }\n    vec3 _l6_c0 = _p_model0.xyz;\n    vec3 _l7_c1 = _p_model1.xyz;\n    vec3 _l8_c2 = _p_model2.xyz;\n    vec3 _l9_origin = vec3(_p_model0.w, _p_model1.w, _p_model2.w);\n    _Varyings _l10_output = _Varyings(vec4(0.0), vec3(0.0), vec3(0.0), vec2(0.0), vec4(0.0));\n    _l10_output._world = ((((_l6_c0 * _l2_p.x) + (_l7_c1 * _l2_p.y)) + (_l8_c2 * _l2_p.z)) + _l9_origin);\n    float _l11_det = dot(_l6_c0, cross(_l7_c1, _l8_c2));\n    _l10_output._normal = ((mat3(cross(_l7_c1, _l8_c2), cross(_l8_c2, _l6_c0), cross(_l6_c0, _l7_c1)) * _l3_n) * ((_l11_det < 0.0) ? (-1.0) : 1.0));\n    uint _l12_flags = uint(_material._params.w);\n    _l10_output._uv = _l4_t;\n    _l10_output._tint = (_p_tint * (((_l12_flags & 4096u) != 0u) ? _shading_color(_p_color) : vec4(1.0)));\n    vec4 _l13_clip = (_frame._view_projection * vec4(_l10_output._world, 1.0));\n    if (((_l12_flags & 131072u) != 0u)) {\n        _l10_output._world = _l9_origin;\n        _l10_output._normal = vec3(0.0, 0.0, 1.0);\n        _l13_clip = (_frame._view_projection * vec4(_l9_origin, 1.0));\n        float _l14_size = _material._ao0.w;\n        if ((((_l12_flags & 262144u) != 0u) && (_frame._viewport.z > 0.5))) {\n            _l14_size = (((_l14_size * _frame._viewport.y) * 0.5) / max(_l13_clip.w, 1e-6));\n        }\n        _l14_size = min(_l14_size, _frame._viewport.w);\n        vec2 _l15_extent = (((_l2_p.xy * 2.0) * _l14_size) / max(_frame._viewport.xy, vec2(1.0)));\n        _l13_clip = vec4((_l13_clip.xy + (_l15_extent * _l13_clip.w)), _l13_clip.z, _l13_clip.w);\n    }\n    _l13_clip.z = ((_l13_clip.z + _l13_clip.w) * 0.5);\n    _l10_output._position = _l13_clip;\n    return _l10_output;\n}\nvoid main() {\n    _Varyings _result = _vs(_a0, _a1, _a2, _a3, _a4, _a5, _a6, _a7);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, _position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._world;\n    _v1 = _result._normal;\n    _v2 = _result._uv;\n    _v3 = _result._tint;\n}\n";
const MESH_SHADOW_VS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform frame_block {\n    _Frame _frame;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nlayout(location = 0) in vec3 _a0;\nlayout(location = 2) in vec2 _a2;\nlayout(location = 3) in vec4 _a3;\nlayout(location = 4) in vec4 _a4;\nlayout(location = 5) in vec4 _a5;\nlayout(location = 6) in vec4 _a6;\nlayout(location = 7) in vec4 _a7;\nout vec2 _v0;\nout float _v1;\nvec4 _shading_color(vec4 _p_c) {\n    return clamp(_p_c, vec4(0.0), vec4(65504.0, 65504.0, 65504.0, 1.0));\n}\n_ShadowVaryings _shadow_vs(vec3 _p_position, vec2 _p_uv, vec4 _p_model0, vec4 _p_model1, vec4 _p_model2, vec4 _p_tint, vec4 _p_color) {\n    vec4 _l0_d = _material._extra;\n    bool _l1_compact = (_l0_d.w > 0.5);\n    vec3 _l2_p = (_l1_compact ? ((_p_position * _l0_d.x) + vec3(_l0_d.y)) : _p_position);\n    vec3 _l3_world = ((((_p_model0.xyz * _l2_p.x) + (_p_model1.xyz * _l2_p.y)) + (_p_model2.xyz * _l2_p.z)) + vec3(_p_model0.w, _p_model1.w, _p_model2.w));\n    _ShadowVaryings _l4_output = _ShadowVaryings(vec4(0.0), vec2(0.0), 0.0);\n    uint _l5_s = (uint((_frame._counts.z + 0.5)) * 6u);\n    mat4 _l6_m = mat4(_frame._shadows[_l5_s], _frame._shadows[(_l5_s + 1u)], _frame._shadows[(_l5_s + 2u)], _frame._shadows[(_l5_s + 3u)]);\n    vec4 _l7_clip = (_l6_m * vec4(_l3_world, 1.0));\n    _l7_clip.z = max(((_l7_clip.z + _l7_clip.w) * 0.5), 0.0);\n    uint _l8_flags = uint(_material._params.w);\n    _l4_output._position = _l7_clip;\n    _l4_output._uv = (_l1_compact ? (vec2(_p_uv.x, (1.0 - _p_uv.y)) * _l0_d.z) : _p_uv);\n    _l4_output._alpha = (_p_tint.w * (((_l8_flags & 4096u) != 0u) ? _shading_color(_p_color).w : 1.0));\n    return _l4_output;\n}\nvoid main() {\n    _ShadowVaryings _result = _shadow_vs(_a0, _a2, _a3, _a4, _a5, _a6, _a7);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, -_position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._uv;\n    _v1 = _result._alpha;\n}\n";
const MESH_SHADOW_VS_GLSL_WINDOW = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform frame_block {\n    _Frame _frame;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nlayout(location = 0) in vec3 _a0;\nlayout(location = 2) in vec2 _a2;\nlayout(location = 3) in vec4 _a3;\nlayout(location = 4) in vec4 _a4;\nlayout(location = 5) in vec4 _a5;\nlayout(location = 6) in vec4 _a6;\nlayout(location = 7) in vec4 _a7;\nout vec2 _v0;\nout float _v1;\nvec4 _shading_color(vec4 _p_c) {\n    return clamp(_p_c, vec4(0.0), vec4(65504.0, 65504.0, 65504.0, 1.0));\n}\n_ShadowVaryings _shadow_vs(vec3 _p_position, vec2 _p_uv, vec4 _p_model0, vec4 _p_model1, vec4 _p_model2, vec4 _p_tint, vec4 _p_color) {\n    vec4 _l0_d = _material._extra;\n    bool _l1_compact = (_l0_d.w > 0.5);\n    vec3 _l2_p = (_l1_compact ? ((_p_position * _l0_d.x) + vec3(_l0_d.y)) : _p_position);\n    vec3 _l3_world = ((((_p_model0.xyz * _l2_p.x) + (_p_model1.xyz * _l2_p.y)) + (_p_model2.xyz * _l2_p.z)) + vec3(_p_model0.w, _p_model1.w, _p_model2.w));\n    _ShadowVaryings _l4_output = _ShadowVaryings(vec4(0.0), vec2(0.0), 0.0);\n    uint _l5_s = (uint((_frame._counts.z + 0.5)) * 6u);\n    mat4 _l6_m = mat4(_frame._shadows[_l5_s], _frame._shadows[(_l5_s + 1u)], _frame._shadows[(_l5_s + 2u)], _frame._shadows[(_l5_s + 3u)]);\n    vec4 _l7_clip = (_l6_m * vec4(_l3_world, 1.0));\n    _l7_clip.z = max(((_l7_clip.z + _l7_clip.w) * 0.5), 0.0);\n    uint _l8_flags = uint(_material._params.w);\n    _l4_output._position = _l7_clip;\n    _l4_output._uv = (_l1_compact ? (vec2(_p_uv.x, (1.0 - _p_uv.y)) * _l0_d.z) : _p_uv);\n    _l4_output._alpha = (_p_tint.w * (((_l8_flags & 4096u) != 0u) ? _shading_color(_p_color).w : 1.0));\n    return _l4_output;\n}\nvoid main() {\n    _ShadowVaryings _result = _shadow_vs(_a0, _a2, _a3, _a4, _a5, _a6, _a7);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, _position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._uv;\n    _v1 = _result._alpha;\n}\n";
const MESH_SHADOW_FS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nuniform highp sampler2D _image_image_sampler;\nin vec2 _v0;\nin float _v1;\nvec2 _transformed(vec4 _p_r0, vec4 _p_r1, vec2 _p_uv) {\n    vec3 _l0_p = vec3(_p_uv, 1.0);\n    return vec2(dot(_p_r0.xyz, _l0_p), dot(_p_r1.xyz, _l0_p));\n}\nvoid _shadow_fs(_ShadowVaryings _p_input) {\n    uint _l0_flags = uint(_material._params.w);\n    if ((((_l0_flags & 8u) != 0u) && (((_material._base_color.w * _p_input._alpha) * texture(_image_image_sampler, _transformed(_material._map0, _material._map1, _p_input._uv)).w) < _material._params.z))) {\n        discard;\n    }\n}\nvoid main() {\n    _shadow_fs(_ShadowVaryings(gl_FragCoord, _v0, _v1));\n}\n";
const MESH_NORMAL_VS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform frame_block {\n    _Frame _frame;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nlayout(location = 0) in vec3 _a0;\nlayout(location = 1) in vec3 _a1;\nlayout(location = 3) in vec4 _a3;\nlayout(location = 4) in vec4 _a4;\nlayout(location = 5) in vec4 _a5;\nout vec3 _v0;\n_NormalVaryings _normal_vs(vec3 _p_position, vec3 _p_normal, vec4 _p_model0, vec4 _p_model1, vec4 _p_model2) {\n    vec4 _l0_d = _material._extra;\n    vec3 _l1_p = ((_l0_d.w > 0.5) ? ((_p_position * _l0_d.x) + vec3(_l0_d.y)) : _p_position);\n    vec3 _l2_c0 = _p_model0.xyz;\n    vec3 _l3_c1 = _p_model1.xyz;\n    vec3 _l4_c2 = _p_model2.xyz;\n    vec3 _l5_world = ((((_l2_c0 * _l1_p.x) + (_l3_c1 * _l1_p.y)) + (_l4_c2 * _l1_p.z)) + vec3(_p_model0.w, _p_model1.w, _p_model2.w));\n    float _l6_det = dot(_l2_c0, cross(_l3_c1, _l4_c2));\n    vec3 _l7_n = ((mat3(cross(_l3_c1, _l4_c2), cross(_l4_c2, _l2_c0), cross(_l2_c0, _l3_c1)) * ((_l0_d.w > 1.5) ? vec3(0.0, 1.0, 0.0) : _p_normal)) * ((_l6_det < 0.0) ? (-1.0) : 1.0));\n    _NormalVaryings _l8_output = _NormalVaryings(vec4(0.0), vec3(0.0));\n    _l8_output._normal = normalize((mat3(_frame._post[13].xyz, _frame._post[14].xyz, _frame._post[15].xyz) * _l7_n));\n    vec4 _l9_clip = (_frame._view_projection * vec4(_l5_world, 1.0));\n    _l9_clip.z = ((_l9_clip.z + _l9_clip.w) * 0.5);\n    _l8_output._position = _l9_clip;\n    return _l8_output;\n}\nvoid main() {\n    _NormalVaryings _result = _normal_vs(_a0, _a1, _a3, _a4, _a5);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, -_position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._normal;\n}\n";
const MESH_NORMAL_VS_GLSL_WINDOW = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform frame_block {\n    _Frame _frame;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nlayout(location = 0) in vec3 _a0;\nlayout(location = 1) in vec3 _a1;\nlayout(location = 3) in vec4 _a3;\nlayout(location = 4) in vec4 _a4;\nlayout(location = 5) in vec4 _a5;\nout vec3 _v0;\n_NormalVaryings _normal_vs(vec3 _p_position, vec3 _p_normal, vec4 _p_model0, vec4 _p_model1, vec4 _p_model2) {\n    vec4 _l0_d = _material._extra;\n    vec3 _l1_p = ((_l0_d.w > 0.5) ? ((_p_position * _l0_d.x) + vec3(_l0_d.y)) : _p_position);\n    vec3 _l2_c0 = _p_model0.xyz;\n    vec3 _l3_c1 = _p_model1.xyz;\n    vec3 _l4_c2 = _p_model2.xyz;\n    vec3 _l5_world = ((((_l2_c0 * _l1_p.x) + (_l3_c1 * _l1_p.y)) + (_l4_c2 * _l1_p.z)) + vec3(_p_model0.w, _p_model1.w, _p_model2.w));\n    float _l6_det = dot(_l2_c0, cross(_l3_c1, _l4_c2));\n    vec3 _l7_n = ((mat3(cross(_l3_c1, _l4_c2), cross(_l4_c2, _l2_c0), cross(_l2_c0, _l3_c1)) * ((_l0_d.w > 1.5) ? vec3(0.0, 1.0, 0.0) : _p_normal)) * ((_l6_det < 0.0) ? (-1.0) : 1.0));\n    _NormalVaryings _l8_output = _NormalVaryings(vec4(0.0), vec3(0.0));\n    _l8_output._normal = normalize((mat3(_frame._post[13].xyz, _frame._post[14].xyz, _frame._post[15].xyz) * _l7_n));\n    vec4 _l9_clip = (_frame._view_projection * vec4(_l5_world, 1.0));\n    _l9_clip.z = ((_l9_clip.z + _l9_clip.w) * 0.5);\n    _l8_output._position = _l9_clip;\n    return _l8_output;\n}\nvoid main() {\n    _NormalVaryings _result = _normal_vs(_a0, _a1, _a3, _a4, _a5);\n    vec4 _position = _result._position;\n    gl_Position = vec4(_position.x, _position.y, _position.z * 2.0 - _position.w, _position.w);\n    _v0 = _result._normal;\n}\n";
const MESH_NORMAL_FS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nin vec3 _v0;\nlayout(location = 0) out vec4 _o0;\nvec4 _normal_fs(_NormalVaryings _p_input) {\n    return vec4(((normalize(_p_input._normal) * 0.5) + 0.5), 1.0);\n}\nvoid main() {\n    vec4 _result = _normal_fs(_NormalVaryings(gl_FragCoord, _v0));\n    _o0 = _result;\n}\n";
const MESH_FS_GLSL = "#version 300 es\nprecision highp float;\nprecision highp int;\nstruct _Frame {\n    mat4 _view_projection;\n    vec4 _camera;\n    vec4 _forward;\n    vec4 _light_direction;\n    vec4 _light_color;\n    vec4 _ambient;\n    vec4 _counts;\n    vec4 _output;\n    vec4 _fog_color;\n    vec4 _fog;\n    vec4 _effects;\n    vec4 _env0;\n    vec4 _env1;\n    vec4 _env2;\n    vec4 _viewport;\n    vec4 _lights[64];\n    vec4 _shadows[24];\n    vec4 _post[49];\n};\nstruct _Material {\n    vec4 _base_color;\n    vec4 _params;\n    vec4 _emissive;\n    vec4 _map0;\n    vec4 _map1;\n    vec4 _glow0;\n    vec4 _glow1;\n    vec4 _normal0;\n    vec4 _normal1;\n    vec4 _rough0;\n    vec4 _rough1;\n    vec4 _metal0;\n    vec4 _metal1;\n    vec4 _ao0;\n    vec4 _ao1;\n    vec4 _extra;\n};\nstruct _Varyings {\n    vec4 _position;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _tint;\n};\nstruct _ShadowVaryings {\n    vec4 _position;\n    vec2 _uv;\n    float _alpha;\n};\nstruct _NormalVaryings {\n    vec4 _position;\n    vec3 _normal;\n};\nstruct _Surface {\n    vec4 _base_color;\n    vec3 _emissive;\n    float _metalness;\n    float _roughness;\n    vec3 _normal;\n    float _occlusion;\n    vec3 _world;\n    vec2 _uv;\n    vec4 _color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n    bool _front;\n};\nstruct _Shading {\n    _Surface _surface;\n    vec3 _geometric;\n    float _geometry_roughness;\n};\nstruct _Light {\n    vec3 _sun;\n    float _shadow;\n    vec3 _direct;\n    vec3 _indirect;\n    vec3 _emissive;\n    vec3 _sun_direction;\n    vec3 _sun_color;\n    vec3 _ambient;\n    vec3 _world;\n    vec3 _normal;\n    vec2 _uv;\n    vec4 _base_color;\n    vec4 _v0;\n    vec4 _v1;\n    vec4 _v2;\n    vec4 _v3;\n};\nstruct _Lit {\n    _Light _light;\n    vec3 _coating;\n    float _clearcoat;\n    vec3 _coat_fresnel;\n};\nlayout(std140) uniform frame_block {\n    _Frame _frame;\n};\nlayout(std140) uniform material_block {\n    _Material _material;\n};\nuniform highp sampler2D _image_image_sampler;\nuniform highp sampler2D _emissive_map_emissive_sampler;\nuniform highp sampler2D _normal_map_normal_sampler;\nuniform highp sampler2D _roughness_map_roughness_sampler;\nuniform highp sampler2D _metalness_map_metalness_sampler;\nuniform highp sampler2D _occlusion_map_occlusion_sampler;\nuniform highp sampler2D _environment_map_environment_sampler;\nuniform highp sampler2DShadow _shadow_map0_shadow_sampler;\nuniform highp sampler2DShadow _shadow_map1_shadow_sampler;\nuniform highp sampler2DShadow _shadow_map2_shadow_sampler;\nuniform highp sampler2DShadow _shadow_map3_shadow_sampler;\nin vec3 _v0;\nin vec3 _v1;\nin vec2 _v2;\nin vec4 _v3;\nlayout(location = 0) out vec4 _o0;\nfloat _ease(float _p_t) {\n    float _l0_s = clamp(_p_t, 0.0, 1.0);\n    return ((_l0_s * _l0_s) * (3.0 - (2.0 * _l0_s)));\n}\nfloat _fog_amount(vec3 _p_world) {\n    uint _l0_flags = uint(_material._params.w);\n    uint _l1_fog = uint((_frame._fog_color.w + 0.5));\n    float _l2_amount = 0.0;\n    if (((_l1_fog != 0u) && ((_l0_flags & 512u) == 0u))) {\n        float _l3_depth = dot((_p_world - _frame._camera.xyz), _frame._forward.xyz);\n        _l2_amount = _ease(((_l3_depth - _frame._fog.x) / max((_frame._fog.y - _frame._fog.x), 0.0001)));\n        if ((_l1_fog == 2u)) {\n            float _l4_e = (_frame._fog.z * _l3_depth);\n            _l2_amount = (1.0 - exp(((-_l4_e) * _l4_e)));\n        }\n    }\n    return _l2_amount;\n}\nvec3 _decode(vec3 _p_c) {\n    return mix(pow(((_p_c + 0.055) / 1.055), vec3(2.4)), (_p_c / 12.92), lessThan(_p_c, vec3(0.04045)));\n}\nvec3 _agx_curve(vec3 _p_x) {\n    vec3 _l0_x2 = (_p_x * _p_x);\n    vec3 _l1_x4 = (_l0_x2 * _l0_x2);\n    return ((((((((15.5 * _l1_x4) * _l0_x2) - ((40.14 * _l1_x4) * _p_x)) + (31.96 * _l1_x4)) - ((6.868 * _l0_x2) * _p_x)) + (0.4298 * _l0_x2)) + (0.1191 * _p_x)) - 0.00232);\n}\nvec3 _rrt(vec3 _p_v) {\n    vec3 _l0_a = ((_p_v * (_p_v + 0.0245786)) - 9.0537e-5);\n    vec3 _l1_b = ((_p_v * ((0.983729 * _p_v) + 0.432951)) + 0.238081);\n    return (_l0_a / _l1_b);\n}\nvec3 _tone(vec3 _p_color, uint _p_mode, float _p_exposure) {\n    if ((_p_mode == 1u)) {\n        return clamp((_p_color * _p_exposure), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 2u)) {\n        vec3 _l0_c = (_p_color * _p_exposure);\n        return clamp((_l0_c / (vec3(1.0) + _l0_c)), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 3u)) {\n        vec3 _l1_c = max(vec3(0.0), ((_p_color * _p_exposure) - 0.004));\n        return pow(((_l1_c * ((6.2 * _l1_c) + 0.5)) / ((_l1_c * ((6.2 * _l1_c) + 1.7)) + 0.06)), vec3(2.2));\n    }\n    if ((_p_mode == 4u)) {\n        mat3 _l2_input = mat3(vec3(0.59719, 0.076, 0.0284), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));\n        mat3 _l3_output = mat3(vec3(1.60475, (-0.10208), (-0.00327)), vec3((-0.53108), 1.10813, (-0.07276)), vec3((-0.07367), (-0.00605), 1.07602));\n        return clamp((_l3_output * _rrt((_l2_input * (_p_color * (_p_exposure / 0.6))))), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 5u)) {\n        mat3 _l4_to2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.088), vec3(0.0433, 0.0113, 0.8956));\n        mat3 _l5_from2020 = mat3(vec3(1.6605, (-0.1246), (-0.0182)), vec3((-0.5876), 1.1329, (-0.1006)), vec3((-0.0728), (-0.0083), 1.1187));\n        mat3 _l6_inset = mat3(vec3(0.85662717, 0.13731897, 0.11189821), vec3(0.09512124, 0.761242, 0.076799415), vec3(0.048251607, 0.10143904, 0.81130236));\n        mat3 _l7_outset = mat3(vec3(1.1271006, (-0.14132977), (-0.14132977)), vec3((-0.11060664), 1.1578237, (-0.11060664)), vec3((-0.016493939), (-0.016493939), 1.2519364));\n        vec3 _l8_c = (_l6_inset * (_l4_to2020 * (_p_color * _p_exposure)));\n        _l8_c = clamp(((log2(max(_l8_c, vec3(1e-10))) + 12.47393) / 16.499998), vec3(0.0), vec3(1.0));\n        _l8_c = (_l7_outset * _agx_curve(_l8_c));\n        return clamp((_l5_from2020 * pow(max(vec3(0.0), _l8_c), vec3(2.2))), vec3(0.0), vec3(1.0));\n    }\n    if ((_p_mode == 6u)) {\n        vec3 _l9_c = (_p_color * _p_exposure);\n        float _l10_x = min(_l9_c.x, min(_l9_c.y, _l9_c.z));\n        _l9_c = (_l9_c - vec3(((_l10_x < 0.08) ? (_l10_x - ((6.25 * _l10_x) * _l10_x)) : 0.04)));\n        float _l11_peak = max(_l9_c.x, max(_l9_c.y, _l9_c.z));\n        if ((_l11_peak < 0.76)) {\n            return _l9_c;\n        }\n        float _l12_top = (1.0 - (0.0576 / (_l11_peak - 0.52)));\n        _l9_c = (_l9_c * (_l12_top / _l11_peak));\n        return mix(_l9_c, vec3(_l12_top), (1.0 - (1.0 / ((0.15 * (_l11_peak - _l12_top)) + 1.0))));\n    }\n    return _p_color;\n}\nvec3 _encode(vec3 _p_x) {\n    vec3 _l0_c = clamp(_p_x, vec3(0.0), vec3(1.0));\n    return mix(((1.055 * pow(_l0_c, vec3(0.41666666))) - 0.055), (_l0_c * 12.92), lessThan(_l0_c, vec3(0.0031308)));\n}\nvec4 _finish_fogged(vec3 _p_color, float _p_alpha, bool _p_premultiply, vec3 _p_fog_shown, vec3 _p_fog_linear, float _p_amount) {\n    uint _l0_flags = uint(_material._params.w);\n    vec3 _l1_light = mix(vec3(0.0), min(_p_color, vec3(65504.0)), greaterThanEqual(_p_color, vec3(0.0)));\n    vec3 _l2_result = vec3(0.0);\n    if ((_frame._output.z > 0.5)) {\n        _l2_result = mix(_l1_light, _p_fog_linear, _p_amount);\n    } else {\n        uint _l3_mode = (((_l0_flags & 1048576u) != 0u) ? 0u : uint((_frame._output.x + 0.5)));\n        _l2_result = mix(_encode(_tone(_l1_light, _l3_mode, _frame._output.y)), _p_fog_shown, _p_amount);\n    }\n    bool _l4_blended = ((_l0_flags & 12582960u) != 0u);\n    bool _l5_premultiplied = (_p_premultiply && ((_l0_flags & 4194304u) != 0u));\n    return vec4((_l5_premultiplied ? (_l2_result * _p_alpha) : _l2_result), (_l4_blended ? _p_alpha : 1.0));\n}\nvec4 _finish(vec3 _p_color, float _p_alpha, vec3 _p_world, bool _p_premultiply) {\n    return _finish_fogged(_p_color, _p_alpha, _p_premultiply, _frame._fog_color.xyz, _decode(_frame._fog_color.xyz), _fog_amount(_p_world));\n}\nfloat _saturate1(float _p_x) {\n    return clamp(_p_x, 0.0, 1.0);\n}\nvec3 _schlick(vec3 _p_f0, float _p_vh) {\n    float _l0_f = exp2(((((-5.55473) * _p_vh) - 6.98316) * _p_vh));\n    return ((_p_f0 * (1.0 - _l0_f)) + vec3(_l0_f));\n}\nvec2 _dfg(float _p_nv, float _p_roughness) {\n    vec4 _l0_r = ((_p_roughness * vec4((-1.0), (-0.0275), (-0.572), 0.022)) + vec4(1.0, 0.0425, 1.04, (-0.04)));\n    float _l1_a004 = ((min((_l0_r.x * _l0_r.x), exp2(((-9.28) * _p_nv))) * _l0_r.x) + _l0_r.y);\n    return ((vec2((-1.04), 1.04) * _l1_a004) + _l0_r.zw);\n}\nvec3 _environment(vec3 _p_d, float _p_roughness, bool _p_scene) {\n    vec3 _l0_dir = normalize(_p_d);\n    if (_p_scene) {\n        _l0_dir = normalize((mat3(_frame._env0.xyz, _frame._env1.xyz, _frame._env2.xyz) * _l0_dir));\n    }\n    vec2 _l1_uv = vec2(((atan(_l0_dir.z, _l0_dir.x) * 0.15915494) + 0.5), (0.5 - (asin(clamp(_l0_dir.y, (-1.0), 1.0)) * 0.3183099)));\n    bool _l2_pmrem = (textureLod(_environment_map_environment_sampler, vec2(0.5), 6.0).w > 1.5);\n    float _l3_lod = (_l2_pmrem ? min((_p_roughness * 6.0), (4.0 + (max((_p_roughness - 0.6666667), 0.0) * 3.0))) : (_p_roughness * 6.0));\n    return textureLod(_environment_map_environment_sampler, _l1_uv, _l3_lod).xyz;\n}\nvec3 _half_vector(vec3 _p_l, vec3 _p_v, vec3 _p_n) {\n    vec3 _l0_s = (_p_l + _p_v);\n    float _l1_k = dot(_l0_s, _l0_s);\n    return ((_l1_k > 1e-12) ? (_l0_s * inversesqrt(max(_l1_k, 1e-30))) : _p_n);\n}\nvec3 _coat(vec3 _p_n, vec3 _p_v, vec3 _p_l, float _p_roughness) {\n    float _l0_alpha = (_p_roughness * _p_roughness);\n    float _l1_a2 = (_l0_alpha * _l0_alpha);\n    vec3 _l2_h = _half_vector(_p_l, _p_v, _p_n);\n    float _l3_nl = _saturate1(dot(_p_n, _p_l));\n    float _l4_nv = _saturate1(dot(_p_n, _p_v));\n    float _l5_nh = _saturate1(dot(_p_n, _l2_h));\n    float _l6_vh = _saturate1(dot(_p_v, _l2_h));\n    float _l7_gv = (_l3_nl * sqrt((_l1_a2 + (((1.0 - _l1_a2) * _l4_nv) * _l4_nv))));\n    float _l8_gl = (_l4_nv * sqrt((_l1_a2 + (((1.0 - _l1_a2) * _l3_nl) * _l3_nl))));\n    float _l9_d = (((_l5_nh * _l5_nh) * (_l1_a2 - 1.0)) + 1.0);\n    return (((_schlick(vec3(0.04), _l6_vh) * (((0.5 / max((_l7_gv + _l8_gl), 1e-6)) * _l1_a2) / ((3.1415927 * _l9_d) * _l9_d))) * _l3_nl) * 3.1415927);\n}\nvec3 _brdf(vec3 _p_n, vec3 _p_v, vec3 _p_l, vec3 _p_base, float _p_metallic, float _p_roughness) {\n    vec3 _l0_h = _half_vector(_p_l, _p_v, _p_n);\n    float _l1_nl = _saturate1(dot(_p_n, _p_l));\n    float _l2_nv = _saturate1(dot(_p_n, _p_v));\n    float _l3_nh = _saturate1(dot(_p_n, _l0_h));\n    float _l4_vh = _saturate1(dot(_p_v, _l0_h));\n    float _l5_alpha = (_p_roughness * _p_roughness);\n    float _l6_a2 = (_l5_alpha * _l5_alpha);\n    float _l7_gv = (_l1_nl * sqrt((_l6_a2 + (((1.0 - _l6_a2) * _l2_nv) * _l2_nv))));\n    float _l8_gl = (_l2_nv * sqrt((_l6_a2 + (((1.0 - _l6_a2) * _l1_nl) * _l1_nl))));\n    float _l9_d = (((_l3_nh * _l3_nh) * (_l6_a2 - 1.0)) + 1.0);\n    vec3 _l10_f0 = mix(vec3(0.04), _p_base, _p_metallic);\n    vec3 _l11_specular = (_schlick(_l10_f0, _l4_vh) * (((0.5 / max((_l7_gv + _l8_gl), 1e-6)) * _l6_a2) / ((3.1415927 * _l9_d) * _l9_d)));\n    vec3 _l12_diffuse = (((1.0 - _p_metallic) * _p_base) / 3.1415927);\n    return (((_l12_diffuse + _l11_specular) * _l1_nl) * 3.1415927);\n}\nvec3 _reflected(vec3 _p_n, vec3 _p_v, vec3 _p_l, vec3 _p_base, float _p_metallic, float _p_roughness, bool _p_lambert) {\n    if (_p_lambert) {\n        return (_p_base * max(dot(_p_n, _p_l), 0.0));\n    }\n    return _brdf(_p_n, _p_v, _p_l, _p_base, _p_metallic, _p_roughness);\n}\nfloat _shadow_sample(uint _p_k, vec2 _p_uv, float _p_depth) {\n    if ((_p_k == 0u)) {\n        return textureLod(_shadow_map0_shadow_sampler, vec3(_p_uv, _p_depth), 0.0);\n    }\n    if ((_p_k == 1u)) {\n        return textureLod(_shadow_map1_shadow_sampler, vec3(_p_uv, _p_depth), 0.0);\n    }\n    if ((_p_k == 2u)) {\n        return textureLod(_shadow_map2_shadow_sampler, vec3(_p_uv, _p_depth), 0.0);\n    }\n    return textureLod(_shadow_map3_shadow_sampler, vec3(_p_uv, _p_depth), 0.0);\n}\nfloat _visibility(uint _p_k, vec3 _p_world, vec3 _p_n) {\n    uint _l0_s = (_p_k * 6u);\n    vec4 _l1_params = _frame._shadows[(_l0_s + 4u)];\n    vec4 _l2_caster = _frame._shadows[(_l0_s + 5u)];\n    float _l3_size = _l1_params.x;\n    if ((_l3_size <= 0.0)) {\n        return 1.0;\n    }\n    float _l4_offset = _l1_params.z;\n    float _l5_bias = _l1_params.y;\n    vec3 _l6_point = _p_world;\n    if ((_l2_caster.y > 0.5)) {\n        vec3 _l7_light = _frame._lights[((uint((_l2_caster.x + 0.5)) - 1u) * 4u)].xyz;\n        _l4_offset = (_l4_offset + (_l1_params.w * distance(_p_world, _l7_light)));\n        _l6_point = (_p_world + ((_l7_light - _p_world) * _l5_bias));\n        _l5_bias = 0.0;\n    }\n    mat4 _l8_m = mat4(_frame._shadows[_l0_s], _frame._shadows[(_l0_s + 1u)], _frame._shadows[(_l0_s + 2u)], _frame._shadows[(_l0_s + 3u)]);\n    vec4 _l9_p = (_l8_m * vec4((_l6_point + (_p_n * _l4_offset)), 1.0));\n    if ((_l9_p.w <= 0.0)) {\n        return 1.0;\n    }\n    vec3 _l10_ndc = (_l9_p.xyz / _l9_p.w);\n    vec3 _l11_q = vec3(((_l10_ndc.x * 0.5) + 0.5), (0.5 - (_l10_ndc.y * 0.5)), ((_l10_ndc.z * 0.5) + 0.5));\n    if ((any(lessThan(_l11_q, vec3(0.0))) || any(greaterThan(_l11_q, vec3(1.0))))) {\n        return 1.0;\n    }\n    float _l12_texel = (_l2_caster.z / _l3_size);\n    float _l13_sum = 0.0;\n    {\n        int _l14_y = (-1);\n        for (; (_l14_y <= 1); _l14_y = (_l14_y + 1)) {\n            {\n                int _l15_x = (-1);\n                for (; (_l15_x <= 1); _l15_x = (_l15_x + 1)) {\n                    _l13_sum = (_l13_sum + _shadow_sample(_p_k, (_l11_q.xy + (vec2(float(_l15_x), float(_l14_y)) * _l12_texel)), (_l11_q.z - _l5_bias)));\n                }\n            }\n        }\n    }\n    return (_l13_sum / 9.0);\n}\nfloat _shadowed(float _p_reference, vec3 _p_world, vec3 _p_n) {\n    uint _l0_k = uint((_p_reference + 0.5));\n    if ((_l0_k == 0u)) {\n        return 1.0;\n    }\n    return _visibility((_l0_k - 1u), _p_world, _p_n);\n}\n_Lit _lighting(_Surface _p_s, vec3 _p_geometric, float _p_geometry_roughness) {\n    uint _l0_flags = uint(_material._params.w);\n    vec4 _l1_base = _p_s._base_color;\n    bool _l2_lambert = ((_l0_flags & 8192u) != 0u);\n    vec3 _l3_n = _p_s._normal;\n    vec3 _l4_coat_n = _p_geometric;\n    if ((!_p_s._front)) {\n        bool _l5_mirrored = (((_l0_flags & 64u) != 0u) && ((uint((_material._map1.w + 0.5)) & 2u) == 0u));\n        _l3_n = (_l5_mirrored ? (_l3_n - ((2.0 * dot(_l3_n, _p_geometric)) * _p_geometric)) : (-_l3_n));\n        _l4_coat_n = (-_l4_coat_n);\n    }\n    vec3 _l6_to_camera = (_frame._camera.xyz - _p_s._world);\n    vec3 _l7_v = ((dot(_l6_to_camera, _l6_to_camera) > 1e-12) ? (_l6_to_camera * inversesqrt(max(dot(_l6_to_camera, _l6_to_camera), 1e-30))) : _l3_n);\n    float _l8_metallic = _p_s._metalness;\n    float _l9_roughness = _p_s._roughness;\n    float _l10_direct_roughness = min((max(_l9_roughness, 0.0525) + _p_geometry_roughness), 1.0);\n    float _l11_clearcoat = (_l2_lambert ? 0.0 : _material._rough1.w);\n    float _l12_coat_roughness = min((max(_material._metal0.w, 0.0525) + _p_geometry_roughness), 1.0);\n    bool _l13_receives = ((_l0_flags & 2048u) == 0u);\n    _Lit _l14_out = _Lit(_Light(vec3(0.0), 0.0, vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec2(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0)), vec3(0.0), 0.0, vec3(0.0));\n    _l14_out._clearcoat = _l11_clearcoat;\n    _l14_out._coating = vec3(0.0);\n    _l14_out._coat_fresnel = vec3(0.0);\n    _l14_out._light._world = _p_s._world;\n    _l14_out._light._normal = _l3_n;\n    _l14_out._light._uv = _p_s._uv;\n    _l14_out._light._base_color = _l1_base;\n    _l14_out._light._v0 = _p_s._v0;\n    _l14_out._light._v1 = _p_s._v1;\n    _l14_out._light._v2 = _p_s._v2;\n    _l14_out._light._v3 = _p_s._v3;\n    vec3 _l15_l = normalize((-_frame._light_direction.xyz));\n    _l14_out._light._sun_direction = _l15_l;\n    _l14_out._light._sun_color = _frame._light_color.xyz;\n    _l14_out._light._ambient = _frame._ambient.xyz;\n    float _l16_reach = 1.0;\n    if (_l13_receives) {\n        _l16_reach = _shadowed(_frame._light_direction.w, _p_s._world, _l3_n);\n    }\n    _l14_out._light._shadow = _l16_reach;\n    _l14_out._light._sun = (_reflected(_l3_n, _l7_v, _l15_l, _l1_base.xyz, _l8_metallic, _l10_direct_roughness, _l2_lambert) * _frame._light_color.xyz);\n    if ((_l11_clearcoat > 0.0)) {\n        _l14_out._coating = (_l14_out._coating + ((_coat(_l4_coat_n, _l7_v, _l15_l, _l12_coat_roughness) * _frame._light_color.xyz) * _l16_reach));\n    }\n    vec3 _l17_direct = vec3(0.0);\n    vec3 _l18_indirect = (_frame._ambient.xyz * _l1_base.xyz);\n    uint _l19_count = uint(_frame._counts.x);\n    {\n        uint _l20_i = 0u;\n        for (; (_l20_i < _l19_count); _l20_i = (_l20_i + 1u)) {\n            vec4 _l21_p = _frame._lights[(_l20_i * 4u)];\n            vec4 _l22_c = _frame._lights[((_l20_i * 4u) + 1u)];\n            vec4 _l23_sp = _frame._lights[((_l20_i * 4u) + 2u)];\n            vec4 _l24_cone = _frame._lights[((_l20_i * 4u) + 3u)];\n            uint _l25_kind = uint((_l21_p.w + 0.5));\n            if ((_l25_kind == 3u)) {\n                _l18_indirect = (_l18_indirect + (mix(_l23_sp.xyz, _l22_c.xyz, ((0.5 * dot(_l3_n, normalize(_l21_p.xyz))) + 0.5)) * _l1_base.xyz));\n                continue;\n            }\n            _l15_l = normalize((-_l21_p.xyz));\n            float _l26_attenuation = 1.0;\n            if ((_l25_kind != 0u)) {\n                vec3 _l27_d = (_l21_p.xyz - _p_s._world);\n                float _l28_dist = max(length(_l27_d), 0.0001);\n                _l15_l = (_l27_d / _l28_dist);\n                _l26_attenuation = (1.0 / max(pow(_l28_dist, _l23_sp.w), 0.01));\n                if ((_l22_c.w > 0.0)) {\n                    float _l29_r = (_l28_dist / _l22_c.w);\n                    float _l30_window = clamp((1.0 - (((_l29_r * _l29_r) * _l29_r) * _l29_r)), 0.0, 1.0);\n                    _l26_attenuation = (_l26_attenuation * (_l30_window * _l30_window));\n                }\n                if ((_l25_kind == 2u)) {\n                    _l26_attenuation = (_l26_attenuation * _ease(((dot((-_l15_l), normalize(_l23_sp.xyz)) - _l24_cone.x) / max((_l24_cone.y - _l24_cone.x), 0.0001))));\n                }\n            }\n            if (_l13_receives) {\n                _l26_attenuation = (_l26_attenuation * _shadowed(_l24_cone.z, _p_s._world, _l3_n));\n            }\n            _l17_direct = (_l17_direct + ((_reflected(_l3_n, _l7_v, _l15_l, _l1_base.xyz, _l8_metallic, _l10_direct_roughness, _l2_lambert) * _l22_c.xyz) * _l26_attenuation));\n            if ((_l11_clearcoat > 0.0)) {\n                _l14_out._coating = (_l14_out._coating + ((_coat(_l4_coat_n, _l7_v, _l15_l, _l12_coat_roughness) * _l22_c.xyz) * _l26_attenuation));\n            }\n        }\n    }\n    float _l31_occlusion = _p_s._occlusion;\n    _l18_indirect = (_l18_indirect * _l31_occlusion);\n    if ((((_l0_flags & 32768u) != 0u) && _l2_lambert)) {\n        bool _l32_scene = ((_l0_flags & 65536u) != 0u);\n        _l18_indirect = (_l18_indirect + (((_l1_base.xyz * _environment(_l3_n, 1.0, _l32_scene)) * _material._metal1.w) * _l31_occlusion));\n    }\n    if ((((_l0_flags & 32768u) != 0u) && (!_l2_lambert))) {\n        bool _l33_scene = ((_l0_flags & 65536u) != 0u);\n        float _l34_intensity = _material._metal1.w;\n        float _l35_r = min((max(_l9_roughness, 0.0525) + _p_geometry_roughness), 1.0);\n        vec3 _l36_irradiance = (_environment(_l3_n, 1.0, _l33_scene) * _l34_intensity);\n        vec3 _l37_radiance = (_environment(mix(reflect((-_l7_v), _l3_n), _l3_n, (_l35_r * _l35_r)), _l35_r, _l33_scene) * _l34_intensity);\n        float _l38_nv = _saturate1(dot(_l3_n, _l7_v));\n        vec2 _l39_fab = _dfg(_l38_nv, _l35_r);\n        vec3 _l40_f0 = mix(vec3(0.04), _l1_base.xyz, _l8_metallic);\n        vec3 _l41_single = ((_l40_f0 * _l39_fab.x) + _l39_fab.y);\n        float _l42_ems = (1.0 - (_l39_fab.x + _l39_fab.y));\n        vec3 _l43_favg = (_l40_f0 + ((1.0 - _l40_f0) * 0.047619));\n        vec3 _l44_multi = (((_l41_single * _l43_favg) / (1.0 - (_l42_ems * _l43_favg))) * _l42_ems);\n        vec3 _l45_total = (_l41_single + _l44_multi);\n        _l18_indirect = (_l18_indirect + ((((_l1_base.xyz * (1.0 - _l8_metallic)) * (1.0 - max(_l45_total.x, max(_l45_total.y, _l45_total.z)))) * _l36_irradiance) * _l31_occlusion));\n        float _l46_specular_occlusion = _saturate1(((pow((_l38_nv + _l31_occlusion), exp2((((-16.0) * _l35_r) - 1.0))) - 1.0) + _l31_occlusion));\n        _l18_indirect = (_l18_indirect + (((_l37_radiance * _l41_single) + (_l44_multi * _l36_irradiance)) * _l46_specular_occlusion));\n        if ((_l11_clearcoat > 0.0)) {\n            vec3 _l47_coat_radiance = (_environment(mix(reflect((-_l7_v), _l4_coat_n), _l4_coat_n, (_l12_coat_roughness * _l12_coat_roughness)), _l12_coat_roughness, _l33_scene) * _l34_intensity);\n            vec2 _l48_coat_fab = _dfg(_saturate1(dot(_l4_coat_n, _l7_v)), _l12_coat_roughness);\n            _l14_out._coating = (_l14_out._coating + ((_l47_coat_radiance * ((0.04 * _l48_coat_fab.x) + _l48_coat_fab.y)) * _l31_occlusion));\n        }\n    }\n    _l14_out._light._direct = _l17_direct;\n    _l14_out._light._indirect = _l18_indirect;\n    _l14_out._light._emissive = _p_s._emissive;\n    if ((_l11_clearcoat > 0.0)) {\n        _l14_out._coat_fresnel = _schlick(vec3(0.04), _saturate1(dot(_l4_coat_n, _l7_v)));\n    }\n    return _l14_out;\n}\nvec3 _lit_color(_Lit _p_l) {\n    vec3 _l0_color = ((((_p_l._light._sun * _p_l._light._shadow) + _p_l._light._direct) + _p_l._light._indirect) + _p_l._light._emissive);\n    if ((_p_l._clearcoat > 0.0)) {\n        return ((_l0_color * (1.0 - (_p_l._clearcoat * _p_l._coat_fresnel))) + (_p_l._coating * _p_l._clearcoat));\n    }\n    return _l0_color;\n}\nvec4 _depth_out(vec3 _p_world) {\n    return vec4(dot((_p_world - _frame._camera.xyz), _frame._forward.xyz), 0.0, 0.0, 1.0);\n}\nvec4 _shade(_Surface _p_s, vec3 _p_geometric, float _p_geometry_roughness) {\n    uint _l0_flags = uint(_material._params.w);\n    if ((((_l0_flags & 8u) != 0u) && (_p_s._base_color.w < _material._params.z))) {\n        discard;\n    }\n    if ((_frame._output.z > 1.5)) {\n        return _depth_out(_p_s._world);\n    }\n    if ((_material._glow1.w > 0.5)) {\n        float _l1_reach = 1.0;\n        if (((_l0_flags & 2048u) == 0u)) {\n            uint _l2_shadows = uint((_frame._counts.y + 0.5));\n            {\n                uint _l3_k = 0u;\n                for (; (_l3_k < _l2_shadows); _l3_k = (_l3_k + 1u)) {\n                    _l1_reach = (_l1_reach * _visibility(_l3_k, _p_s._world, _p_geometric));\n                }\n            }\n        }\n        return _finish(_p_s._base_color.xyz, (_p_s._base_color.w * (1.0 - _l1_reach)), _p_s._world, true);\n    }\n    vec3 _l4_color = (_p_s._base_color.xyz + _p_s._emissive);\n    if (((_l0_flags & 1u) == 0u)) {\n        _l4_color = _lit_color(_lighting(_p_s, _p_geometric, _p_geometry_roughness));\n    }\n    return _finish(_l4_color, _p_s._base_color.w, _p_s._world, true);\n}\nvec3 _perturb(vec3 _p_n, vec3 _p_q0, vec3 _p_q1, vec2 _p_st0, vec2 _p_st1, vec3 _p_m) {\n    vec3 _l0_q1perp = cross(_p_q1, _p_n);\n    vec3 _l1_q0perp = cross(_p_n, _p_q0);\n    vec3 _l2_t = ((_l0_q1perp * _p_st0.x) + (_l1_q0perp * _p_st1.x));\n    vec3 _l3_b = (-((_l0_q1perp * _p_st0.y) + (_l1_q0perp * _p_st1.y)));\n    float _l4_det = max(dot(_l2_t, _l2_t), dot(_l3_b, _l3_b));\n    float _l5_scale = (((_l4_det == 0.0) ? 0.0 : inversesqrt(_l4_det)) * sign(dot(_p_q0, _l0_q1perp)));\n    return normalize((((_l2_t * (_l5_scale * _p_m.x)) + (_l3_b * (_l5_scale * _p_m.y))) + (_p_n * _p_m.z)));\n}\nvec3 _bumped(vec3 _p_n, vec3 _p_q0, vec3 _p_q1, vec2 _p_dh) {\n    if (((dot(_p_q0, _p_q0) == 0.0) || (dot(_p_q1, _p_q1) == 0.0))) {\n        return _p_n;\n    }\n    vec3 _l0_sx = normalize(_p_q0);\n    vec3 _l1_sy = normalize(_p_q1);\n    vec3 _l2_r1 = cross(_l1_sy, _p_n);\n    vec3 _l3_r2 = cross(_p_n, _l0_sx);\n    float _l4_det = dot(_l0_sx, _l2_r1);\n    return normalize(((abs(_l4_det) * _p_n) - (sign(_l4_det) * ((_p_dh.x * _l2_r1) + (_p_dh.y * _l3_r2)))));\n}\nvec2 _transformed(vec4 _p_r0, vec4 _p_r1, vec2 _p_uv) {\n    vec3 _l0_p = vec3(_p_uv, 1.0);\n    return vec2(dot(_p_r0.xyz, _l0_p), dot(_p_r1.xyz, _l0_p));\n}\n_Shading _shading_of(vec3 _p_world, vec3 _p_normal, vec2 _p_uv, vec4 _p_tint, bool _p_front) {\n    uint _l0_flags = uint(_material._params.w);\n    vec4 _l1_texel = texture(_image_image_sampler, _transformed(_material._map0, _material._map1, _p_uv));\n    vec4 _l2_glow = texture(_emissive_map_emissive_sampler, _transformed(_material._glow0, _material._glow1, _p_uv));\n    vec2 _l3_normal_uv = _transformed(_material._normal0, _material._normal1, _p_uv);\n    vec3 _l4_bump = texture(_normal_map_normal_sampler, _l3_normal_uv).xyz;\n    vec4 _l5_rough_texel = texture(_roughness_map_roughness_sampler, _transformed(_material._rough0, _material._rough1, _p_uv));\n    vec4 _l6_metal_texel = texture(_metalness_map_metalness_sampler, _transformed(_material._metal0, _material._metal1, _p_uv));\n    vec4 _l7_ao_texel = texture(_occlusion_map_occlusion_sampler, _transformed(_material._ao0, _material._ao1, _p_uv));\n    vec3 _l8_q0 = dFdx(_p_world);\n    vec3 _l9_q1 = dFdy(_p_world);\n    vec2 _l10_st0 = dFdx(_l3_normal_uv);\n    vec2 _l11_st1 = dFdy(_l3_normal_uv);\n    uint _l12_surface_bits = uint((_material._map1.w + 0.5));\n    vec3 _l13_face = cross(_l8_q0, _l9_q1);\n    vec3 _l14_to_eye = ((_frame._viewport.z > 0.5) ? (_frame._camera.xyz - _p_world) : (-_frame._forward.xyz));\n    vec3 _l15_facing = (((dot(_l13_face, _l14_to_eye) >= 0.0) ? _l13_face : (-_l13_face)) * inversesqrt(max(dot(_l13_face, _l13_face), 1e-30)));\n    bool _l16_flat = (((_l12_surface_bits & 1u) != 0u) && (dot(_l13_face, _l13_face) > 0.0));\n    vec3 _l17_geometric = (_l16_flat ? (_p_front ? _l15_facing : (-_l15_facing)) : normalize(_p_normal));\n    vec3 _l18_dxy = max(abs(dFdx(_l17_geometric)), abs(dFdy(_l17_geometric)));\n    bool _l19_lambert = ((_l0_flags & 8192u) != 0u);\n    _Shading _l20_output = _Shading(_Surface(vec4(0.0), vec3(0.0), 0.0, 0.0, vec3(0.0), 0.0, vec3(0.0), vec2(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), false), vec3(0.0), 0.0);\n    _l20_output._geometric = _l17_geometric;\n    _l20_output._geometry_roughness = max(max(_l18_dxy.x, _l18_dxy.y), _l18_dxy.z);\n    _l20_output._surface._base_color = ((_material._base_color * _p_tint) * vec4(_decode(_l1_texel.xyz), _l1_texel.w));\n    _l20_output._surface._emissive = (_material._emissive.xyz * _decode(_l2_glow.xyz));\n    _l20_output._surface._metalness = (_l19_lambert ? 0.0 : (_material._params.x * _l6_metal_texel.z));\n    _l20_output._surface._roughness = (_material._params.y * _l5_rough_texel.y);\n    vec3 _l21_n = _l17_geometric;\n    if ((((_l0_flags & 16384u) != 0u) && ((_l12_surface_bits & 2u) != 0u))) {\n        float _l22_scale = _material._normal0.w;\n        float _l23_height = (_l22_scale * _l4_bump.x);\n        float _l24_across = ((_l22_scale * textureGrad(_normal_map_normal_sampler, (_l3_normal_uv + _l10_st0), _l10_st0, _l11_st1).x) - _l23_height);\n        float _l25_down = ((_l22_scale * textureGrad(_normal_map_normal_sampler, (_l3_normal_uv + _l11_st1), _l10_st0, _l11_st1).x) - _l23_height);\n        _l21_n = _bumped(_l17_geometric, _l8_q0, _l9_q1, vec2(_l24_across, _l25_down));\n    } else {\n        if (((_l0_flags & 16384u) != 0u)) {\n            _l21_n = _perturb(_l17_geometric, _l8_q0, _l9_q1, _l10_st0, _l11_st1, vec3((((_l4_bump.xy * 2.0) - 1.0) * vec2(_material._normal0.w, _material._normal1.w)), ((_l4_bump.z * 2.0) - 1.0)));\n        }\n    }\n    _l20_output._surface._normal = _l21_n;\n    _l20_output._surface._occlusion = (((_l7_ao_texel.x - 1.0) * _material._rough0.w) + 1.0);\n    _l20_output._surface._world = _p_world;\n    _l20_output._surface._uv = _p_uv;\n    _l20_output._surface._color = _p_tint;\n    _l20_output._surface._front = _p_front;\n    _l20_output._surface._v0 = vec4(0.0);\n    _l20_output._surface._v1 = vec4(0.0);\n    _l20_output._surface._v2 = vec4(0.0);\n    _l20_output._surface._v3 = vec4(0.0);\n    return _l20_output;\n}\nvec3 _cube_sky(vec3 _p_d) {\n    vec3 _l0_a = abs(_p_d);\n    if (((_l0_a.x >= _l0_a.y) && (_l0_a.x >= _l0_a.z))) {\n        vec2 _l1_st = (((vec2(((_p_d.x > 0.0) ? (-_p_d.z) : _p_d.z), (-_p_d.y)) / _l0_a.x) * 0.5) + 0.5);\n        if ((_p_d.x > 0.0)) {\n            return textureLod(_image_image_sampler, _l1_st, 0.0).xyz;\n        }\n        return textureLod(_emissive_map_emissive_sampler, _l1_st, 0.0).xyz;\n    }\n    if ((_l0_a.y >= _l0_a.z)) {\n        vec2 _l2_st = (((vec2(_p_d.x, ((_p_d.y > 0.0) ? _p_d.z : (-_p_d.z))) / _l0_a.y) * 0.5) + 0.5);\n        if ((_p_d.y > 0.0)) {\n            return textureLod(_normal_map_normal_sampler, _l2_st, 0.0).xyz;\n        }\n        return textureLod(_roughness_map_roughness_sampler, _l2_st, 0.0).xyz;\n    }\n    vec2 _l3_st = (((vec2(((_p_d.z > 0.0) ? _p_d.x : (-_p_d.x)), (-_p_d.y)) / _l0_a.z) * 0.5) + 0.5);\n    if ((_p_d.z > 0.0)) {\n        return textureLod(_metalness_map_metalness_sampler, _l3_st, 0.0).xyz;\n    }\n    return textureLod(_occlusion_map_occlusion_sampler, _l3_st, 0.0).xyz;\n}\nvec4 _background(vec3 _p_world, vec2 _p_uv) {\n    uint _l0_kind = uint((_material._ao1.w + 0.5));\n    vec3 _l1_color = vec3(0.0);\n    if ((_l0_kind == 1u)) {\n        _l1_color = _decode(texture(_image_image_sampler, _transformed(_material._map0, _material._map1, _p_uv)).xyz);\n    } else {\n        vec3 _l2_dir = normalize((mat3(_material._normal0.xyz, _material._normal1.xyz, _material._rough0.xyz) * _p_world));\n        uint _l3_bound = uint((_material._emissive.x + 0.5));\n        bool _l4_sharp = ((_l3_bound & 1u) != 0u);\n        bool _l5_prefiltered = ((_l3_bound & 2u) != 0u);\n        float _l6_blur = _material._params.y;\n        if ((_l5_prefiltered && ((_l6_blur > 0.0) || (!_l4_sharp)))) {\n            _l1_color = _environment(_l2_dir, _l6_blur, false);\n        } else {\n            if ((_l0_kind == 2u)) {\n                vec2 _l7_at = vec2(((atan(_l2_dir.z, _l2_dir.x) * 0.15915494) + 0.5), (0.5 - (asin(clamp(_l2_dir.y, (-1.0), 1.0)) * 0.3183099)));\n                _l1_color = _decode(textureLod(_image_image_sampler, _l7_at, 0.0).xyz);\n                if (_l5_prefiltered) {\n                    _l1_color = mix(_l1_color, max(_l1_color, _environment(_l2_dir, 0.0, false)), greaterThanEqual(_l1_color, vec3(0.999)));\n                }\n            } else {\n                _l1_color = _decode(_cube_sky(vec3((-_l2_dir.x), _l2_dir.y, _l2_dir.z)));\n            }\n        }\n    }\n    return _finish_fogged((_l1_color * _material._base_color.xyz), 1.0, false, vec3(0.0), vec3(0.0), 0.0);\n}\nvec4 _fs(_Varyings _p_input, bool _p_front) {\n    if ((_material._ao1.w > 0.5)) {\n        return _background(_p_input._world, _p_input._uv);\n    }\n    _Shading _l0_shading = _shading_of(_p_input._world, _p_input._normal, _p_input._uv, _p_input._tint, _p_front);\n    return _shade(_l0_shading._surface, _l0_shading._geometric, _l0_shading._geometry_roughness);\n}\nvoid main() {\n    vec4 _result = _fs(_Varyings(gl_FragCoord, _v0, _v1, _v2, _v3), gl_FrontFacing);\n    _o0 = _result;\n}\n";
const POST_TABLES = {occlusionNoise: [5, 5, 4, "LuF//9zWf//cKH//Lh1//xg0f//vvH//wxN//6YGf/8IUH//SfJ///9/f/+HAH//AW9//2f8f//6n3//ZwJ//wGPf/+H/n//pvh///pff/8Irn//GMp//8Prf//vQn//SQx//w=="], denoiseNoise: [64, 64, 4, "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"], smaaArea: [80, 80, 2, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8ACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8ACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAD8AAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAD8AAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcgBcAC0AAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcgBcAC0AAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAagBIACIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAagBIACIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB6AHEAWQA6ABsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB6AHEAWQA6ABsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfAB1AGMASgAwABYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfAB1AGMASgAwABYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAeABqAFYAPwAoABMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAeABqAFYAPwAoABMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB9AHkAbgBeAEsANwAjABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB9AHkAbgBeAEsANwAjABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfQB6AHIAZABUAEIAMAAfAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfQB6AHIAZABUAEIAMAAfAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AewB0AGkAWwBLADsAKwAbAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AewB0AGkAWwBLADsAKwAbAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB+AHwAdgBt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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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"], smaaSearch: [66, 33, 1, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEAAQEAAAEBAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAQEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEAAQEAAAEBAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAQEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEAAQEAAAEBAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAQEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEAAQEAAAEBAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAQEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAAQEAAAICAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAgEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAAQEAAAICAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAgEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAAQEAAAICAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAgEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAAQEAAAICAAEBAAAAAAAAAAAAAQEAAQEAAAEBAAEBAgEAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"], };
// END GENERATED GLSL
// Mesh frames (starhermit_sys::frame) are the shader's Frame block float for float: view-projection, camera, view
// direction, primary light direction (and its shadow, k + 1) and color, ambient, counts (extra lights, shadows, the
// shadow a shadow pass renders, 0), output (tone mapping, exposure, encoding, 0), fog color and mode, fog near, far
// and density, post effects (samples, anti-aliasing after the output, bloom threshold and strength), the environment
// rotation's three columns, the viewport (width, height, perspective, 0), sixteen lights of four vec4s, four shadows of
// six and the post block (starhermit_sys::frame::POST). Materials are its Material block (64 floats); batches are
// [mesh, the seven textures by MESH_TEXTURE_* slot, first instance, instance count, flags, kept instance buffer, custom
// program, its five textures, its uniforms' offset and floats in the pass's uniforms]. Instances are 20 floats: three
// columns with the translation, the tint and four floats of custom data (starhermit_sys::MeshInstanceData).
const MESH_FRAME_LENGTH = 620, MESH_MATERIAL_LENGTH = 64, MESH_BATCH_LENGTH = 23, MESH_TEXTURES = 7, MESH_INSTANCE_LENGTH = 32;
// Custom materials' programs (starhermit_sys MESH_GAME_TEXTURES, MAX_MESH_UNIFORM_FLOATS, MAX_MESH_PROGRAMS,
// MESH_PROGRAM_STAGES): their own textures, uniform block, how many a surface holds, and stages.
const MESH_GAME_TEXTURES = 5, MAX_MESH_UNIFORM_FLOATS = 4096, MAX_MESH_PROGRAMS = 256, MESH_PROGRAM_STAGES = 6;
// A custom material's uniform block is 16 KiB at most (host API 1.10): WebGL2's least MAX_UNIFORM_BLOCK_SIZE; WebGPU's
// default maxUniformBufferBindingSize is 64 KiB. A device holding less is refused (starhermit_sys::check_uniform_block).
const uniformBlock = bytes => {
  if (!(bytes >= MAX_MESH_UNIFORM_FLOATS * 4)) throw new Error(`the GPU's uniform blocks hold ${bytes} bytes; custom materials need ${MAX_MESH_UNIFORM_FLOATS * 4}`);
};
// Vertices by layout (starhermit_sys::MeshLayout): the float layouts by code, plain, with a color, with a color and the
// custom attribute (floats a vertex); a compact layout's code (host API 1.15) is MESH_COMPACT_LAYOUT with its position's,
// normal's, UV's, color's and custom attribute's formats four bits apiece, the position's lowest (VERTEX_FORMATS: none,
// float32, snorm16, unorm16, snorm8, unorm8, then whole numbers sint16, uint16, sint8 and uint8, positions only, stored
// as unorm16 and unorm8 the shader scales back).
const MESH_LAYOUT_FLOATS = [8, 12, 16];
const MESH_COMPACT_LAYOUT = 1 << 20;
const VERTEX_FORMATS = [null, ['float32', 4], ['snorm16', 2], ['unorm16', 2], ['snorm8', 1], ['unorm8', 1], ['unorm16', 2, 65535, -32768],
  ['unorm16', 2, 65535, 0], ['unorm8', 1, 255, -128], ['unorm8', 1, 255, 0]];
// Each attribute's shader location and components as floats and as integers.
const VERTEX_ATTRIBUTES = [[0, 3, 4], [1, 3, 4], [2, 2, 2], [7, 4, 4], [8, 4, 4]];
const meshLayouts = new Map();
// A layout's stored attributes ({location, format, components, offset}, `format` WebGPU's base name), stride, whether it
// is a float layout, has colors, the custom attribute or no attributes at all, and its dequantization (the material's slot
// 15, as starhermit_sys::MeshLayout::dequantize); null for a code no mesh may have (starhermit_sys::MeshLayout::from_code).
function meshLayoutInfo(code) {
  if (meshLayouts.has(code)) return meshLayouts.get(code);
  let formats = null;
  if (code === 0 || code === 1 || code === 2) formats = [1, 1, 1, code > 0 ? 1 : 0, code > 1 ? 1 : 0];
  else if (Number.isInteger(code) && code >= MESH_COMPACT_LAYOUT && code < MESH_COMPACT_LAYOUT * 2) formats = [0, 1, 2, 3, 4].map(i => code >> 4 * i & 15);
  const float = code === 0 || code === 1 || code === 2;
  let info = null;
  if (formats && formats.every(f => f < VERTEX_FORMATS.length) && !formats.slice(1).some(f => f >= 6)
      && (formats[0] ? formats[1] > 0 : formats.every(f => f === 0))
      && !(!float && formats[0] === 1 && formats[1] === 1 && formats[2] === 1 && formats[3] <= 1 && formats[4] <= formats[3])) {
    const attributes = []; let offset = 0;
    formats.forEach((f, i) => {
      if (!f) return;
      const [location, floats, integers] = VERTEX_ATTRIBUTES[i], [format, bytes] = VERTEX_FORMATS[f], components = f === 1 ? floats : integers;
      attributes.push({location, format, components, offset}); offset += Math.ceil(components * bytes / 4) * 4;
    });
    const [, , scale = 1, shift = 0] = VERTEX_FORMATS[formats[0]] ?? [];
    const dequantize = float ? [0, 0, 0, 0] : formats[0] ? [scale, shift, formats[2] ? 1 : 0, 1] : [0, 0, 0, 2];
    info = {code, attributes, stride: offset, float, colored: formats[3] > 0, custom: formats[4] > 0, empty: !formats[0], dequantize};
  }
  meshLayouts.set(code, info);
  return info;
}
const FRAME = {camera: 16, forward: 20, direction: 24, color: 28, ambient: 32, counts: 36, output: 40, fogColor: 44, fog: 48, effects: 52,
  environment: 56, viewport: 68, lights: 72, shadows: 328, post: 424};
// The post block: ambient occlusion and grade switches, GTAOPass's and its denoise's settings, the projection and its
// inverse, the view normal matrix, the bloom's radius and resolution, the grade and vignette, the grade's flash, the
// display-space grade's night and lift (host API 1.11), and a game's post program's data (world from clip, the camera and
// the program's id, the forward axis, its uniforms).
const POST = {flags: 424, ao: 428, denoise: 436, projection: 444, inverseProjection: 460, viewNormal: 476, bloom: 488, grade: 492, flash: 512,
  night: 516, game: 532, gameProgram: 551, gameForward: 552, length: 196};
// Where the grade works (starhermit_sys::GRADE_SPACE_*): linear light, or the display's encoded color.
const GRADE_SPACE_DISPLAY = 1;
// A game's post programs (starhermit_sys MAX_POST_PROGRAMS).
const MAX_POST_PROGRAMS = 16;
const MAX_LIGHTS = 16, MAX_SHADOWS = 4, SHADOW_LENGTH = 24, SHADOW_PASS = FRAME.counts + 2;
// WebGPU binds the frame at 256-byte aligned offsets: the lit pass's, then one per shadow pass; material texture
// bind groups are cached for this many distinct texture sets.
const FRAME_SLOT = Math.ceil(MESH_FRAME_LENGTH * 4 / 256) * 256, MATERIAL_GROUPS = 512;
// Offsets within a shadow: its size, then the depth bias, normal offset and offset per unit of distance, the caster
// (0 the primary light, i + 1 extra light i) and whether its map is a spot's perspective one.
const SHADOW = {size: 16, bias: 17, offsetScale: 19, caster: 20, perspective: 21, radius: 22};
// The largest shadow filter radius, in map texels (starhermit_sys::MAX_MESH_SHADOW_RADIUS).
const MAX_SHADOW_RADIUS = 16;
// The largest linear color (the largest half float); output encodings (display, or linear for the composite).
const MAX_COLOR = 65504, OUTPUT_LINEAR = 1, OUTPUT_DEPTH = 2, SCENE_DEPTH_FAR = 65504;
// Render target kinds (starhermit_sys::TARGET_*): a texture target may go without a depth buffer (its passes draw in
// order) and keep a mip chain made again after each pass; half floats or bytes (host API 1.11: RG8 and R8) may have two
// channels or one (no mip chain).
const TARGET = {depth: 1, sampled: 2, half: 4, mipmaps: 8, twoChannels: 16, oneChannel: 32};
// starhermit_sys::valid_target_flags and target_color_bytes.
const validTargetFlags = flags => {
  const channels = flags & (TARGET.twoChannels | TARGET.oneChannel);
  return Number.isInteger(flags) && !(flags & ~63) && !(flags & (TARGET.half | TARGET.mipmaps) && !(flags & TARGET.sampled))
    && (channels === 0 || (channels !== (TARGET.twoChannels | TARGET.oneChannel) && flags & TARGET.sampled && !(flags & TARGET.mipmaps)));
};
const targetColorBytes = flags => (flags & TARGET.half ? 2 : 1) * (flags & TARGET.twoChannels ? 2 : flags & TARGET.oneChannel ? 1 : 4);
// Mip levels of a target's color (starhermit_sys::target_levels).
const targetLevels = (width, height, flags) => flags & TARGET.mipmaps ? mipLevels(width, height) : 1;
// Batch ranges: the mesh, textures, first instance, instance count and flags.
// A batch's instances are the pass's own from `first`, or a kept instance buffer's (`instances`, 0 for none).
// It draws the mesh's elements (indices, or vertices in order) from `firstElement`, `elementCount` of them (0xffffffff
// to the end; starhermit_sys::MeshBatch::elements).
const BATCH = {textures: 1, first: 8, count: 9, flags: 10, instances: 11, program: 12, gameTextures: 13, uniformOffset: 18, uniformFloats: 19, blend: 20,
  firstElement: 21, elementCount: 22};
// The elements batch `i` draws of a mesh of `total`: [first, count], within it.
const batchElements = (batches, i, total) => {
  const first = Math.min(batches[i + BATCH.firstElement], total);
  return [first, Math.min(batches[i + BATCH.elementCount], total - first)];
};
// Batch flags, as starhermit_sys::MESH_*.
const MESH = {unlit: 1, double: 2, clockwise: 4, mask: 8, blend: 16, additive: 32, back: 64, noDepthWrite: 128, noDepthTest: 256,
  noFog: 512, noCast: 1024, noReceive: 2048, vertexColors: 4096, lambert: 8192, normalMap: 16384, environment: 32768,
  sceneEnvironment: 65536, points: 131072, pointAttenuation: 262144, noAO: 524288, noToneMapping: 1048576, vertexCustom: 2097152,
  premultiplied: 4194304, multiply: 8388608, lines: 33554432};
// A line mesh's layout code carries this (starhermit_sys::MESH_LINE_CODE): its indices, or its vertices in order, are
// line segments, two vertices each, which line batches (MESH.lines, host API 1.17) draw.
const MESH_LINE_CODE = 1 << 24;
// Callers' flags; the backend sets vertexCustom itself.
const MESH_FLAGS = 2097151 | MESH.premultiplied | MESH.multiply;
const BLENDING = MESH.blend | MESH.additive | MESH.premultiplied | MESH.multiply;
// Custom vec4s an instance carries (attributes 9 to 12, from offset 64), as starhermit_sys::MESH_INSTANCE_SLOTS.
const MESH_INSTANCE_SLOTS = 4;
const INSTANCE_LOCATIONS = [3, 4, 5, 6, 9, 10, 11, 12];
// Where an instance attribute reads in an instance: the placement and tint, then the custom data.
const instanceOffset = location => location >= 9 ? 64 + (location - 9) * 16 : (location - 3) * 16;
// Blended batches cast unless flagged (host API 1.18).
const castsShadow = flags => !(flags & (MESH.noCast | MESH.points));
// 0 none, 1 straight alpha, 2 additive, 3 premultiplied alpha, 4 multiply; culling 0 none, 1 back faces, 2 front faces.
const blendMode = flags => flags & MESH.blend ? 1 : flags & MESH.additive ? 2 : flags & MESH.premultiplied ? 3 : flags & MESH.multiply ? 4 : 0;
// A material's custom blend (BATCH.blend, as starhermit_sys::MeshBlend::pack): the color's operation and factors,
// then the alpha's (starhermit_sys::BLEND_*, three.js's order), or null for 0 or a value no blend packs to.
const CUSTOM_BLEND = 1 << 24;
function unpackBlend(bits) {
  if ((bits & ~(CUSTOM_BLEND | 0x3fffff)) !== 0 || !(bits & CUSTOM_BLEND)) return null;
  const part = b => [b & 7, b >> 3 & 15, b >> 7 & 15];
  const blend = {color: part(bits & 0x7ff), alpha: part(bits >> 11 & 0x7ff)};
  const valid = ([op, src, dst]) => op <= 4 && src <= 10 && dst <= 10 && (op < 3 || (src === 1 && dst === 1));
  return valid(blend.color) && valid(blend.alpha) ? blend : null;
}
// Blend operations and factors by starhermit_sys::BLEND_* number, as WebGPU names them.
const GPU_BLEND_OPS = ['add', 'subtract', 'reverse-subtract', 'min', 'max'];
const GPU_BLEND_FACTORS = ['zero', 'one', 'src', 'one-minus-src', 'src-alpha', 'one-minus-src-alpha', 'dst-alpha', 'one-minus-dst-alpha', 'dst',
  'one-minus-dst', 'src-alpha-saturated'];
const gpuBlend = bits => {
  const {color, alpha} = unpackBlend(bits), part = ([op, src, dst]) => ({srcFactor: GPU_BLEND_FACTORS[src], dstFactor: GPU_BLEND_FACTORS[dst], operation: GPU_BLEND_OPS[op]});
  return {color: part(color), alpha: part(alpha)};
};
// 2D batch blends (starhermit_sys::batch_blend, BATCH_* by number: normal, add, multiply, screen): the color's and
// alpha's operation and factors (starhermit_sys::BLEND_*), and whether the batch draws with `fs_premultiplied`.
const BATCH_BLENDS = [
  {color: [0, 4, 5], alpha: [0, 1, 5], premultiplied: false},
  {color: [0, 4, 1], alpha: [0, 1, 1], premultiplied: false},
  {color: [0, 8, 5], alpha: [0, 1, 5], premultiplied: true},
  {color: [0, 1, 3], alpha: [0, 1, 5], premultiplied: true},
];
const gpuBatchBlend = mode => {
  const part = ([op, src, dst]) => ({srcFactor: GPU_BLEND_FACTORS[src], dstFactor: GPU_BLEND_FACTORS[dst], operation: GPU_BLEND_OPS[op]});
  return {color: part(BATCH_BLENDS[mode].color), alpha: part(BATCH_BLENDS[mode].alpha)};
};
const bitCount = value => { let n = 0; for (let v = value >>> 0; v; v &= v - 1) n++; return n; };
const cullMode = flags => flags & MESH.double ? 0 : flags & MESH.back ? 2 : 1;
// The material block a batch's shader reads: its flags in slot 7, without the winding (a pipeline state), without
// vertex colors on meshes that have none and with vertexCustom on meshes with the custom attribute; the layout's
// dequantization in slot 15.
function shaderMaterial(materials, m, flags, layout) {
  const material = materials.slice(m, m + MESH_MATERIAL_LENGTH), info = meshLayoutInfo(layout);
  material[7] = (flags & ~MESH.clockwise & ~MESH.lines & (info.colored ? MESH_FLAGS : ~MESH.vertexColors)) | (info.custom ? MESH.vertexCustom : 0);
  material.set(info.dequantize, 60); return material;
}
// A mesh layout from its code, or from the older colored flag.
const meshLayout = layout => layout === true ? 1 : layout === false || layout === undefined ? 0 : layout;
// A mesh's vertices as bytes.
const vertexBytes = vertices => new Uint8Array(vertices.buffer, vertices.byteOffset, vertices.byteLength);
// A custom program's entry is a custom material's (its fragment replaces the material) rather than hooks.
const customProgram = code => code.entries[1] === 'custom_fs';
// A batch's polygon offset (factor, units), held in material slots 11 and 15; the lit pass only.
const polygonOffset = (materials, m) => [materials[m + 11], materials[m + 15]];
// Material scalars (starhermit_sys MESH_*): normal scale x and y, occlusion intensity, clearcoat and its roughness,
// environment intensity and point size.
const MATERIAL = {normalScale: 31, occlusion: 39, clearcoat: 43, clearcoatRoughness: 47, environment: 51, pointSize: 55, surface: 19, shadowCatcher: 27};
// Texture sampling (starhermit_sys SAMPLER_*): wrap U (bits 0-1) and V (2-3): 0 clamp, 1 repeat, 2 mirrored; linear
// magnification (16) and minification (32); the mipmap filter (64 nearest, 128 linear) for textures with mipmaps;
// anisotropic filtering (bits 8-10, log2 of the most samples up to 16) with linear filters throughout.
function validSampler(bits) { return Number.isInteger(bits) && bits >= 0 && bits < 5 << 8 && (bits & 3) !== 3 && ((bits >> 2) & 3) !== 3 && ((bits >> 6) & 3) !== 3; }
// Without mipmaps the mipmap filter is dropped; anisotropy needs linear magnification, minification and mipmaps.
function effectiveSampler(bits, levels) { if (levels <= 1) bits &= ~0xc0; return (bits & 176) === 176 ? bits : bits & 0xff; }
const samplerAnisotropy = bits => 1 << (bits >> 8);
function mipLevels(width, height) { return 32 - Math.clz32(Math.max(width, height, 1)); }
function mipChainBytes(width, height, levels) {
  let bytes = 0; for (let level = 0; level < levels; level++) bytes += Math.max(1, width >> level) * Math.max(1, height >> level) * 4; return bytes;
}
// Uniform buffer binding points and sampler texture units of the generated programs, as in starhermit_sys::egl: the
// material's textures by slot, then the shadow maps; post programs read the image and glow on units 0 and 1.
// Custom programs' uniforms take point 4 and their textures the units after the shadow maps.
const FRAME_BLOCK = 0, MATERIAL_BLOCK = 1, PARAMETERS_BLOCK = 2, POST_BLOCK = 3, GAME_BLOCK = 4, SHADOW_UNIT = MESH_TEXTURES, GAME_UNIT = MESH_TEXTURES + 4;
const UNIFORM_BLOCKS = [['frame_block', FRAME_BLOCK], ['material_block', MATERIAL_BLOCK], ['parameters_block', PARAMETERS_BLOCK], ['post_block', POST_BLOCK],
  ['uniforms_block', GAME_BLOCK]];
// Post steps read five images and the prepass's depth on units 0..5, each through the one sampler its kind takes.
const SAMPLER_UNITS = [...['image_image', 'emissive_map_emissive', 'normal_map_normal', 'roughness_map_roughness', 'metalness_map_metalness',
  'occlusion_map_occlusion', 'environment_map_environment'].map((name, unit) => [`_${name}_sampler`, unit]),
  ...[0, 1, 2, 3].map(k => [`_shadow_map${k}_shadow_sampler`, SHADOW_UNIT + k]),
  ...['image', 'second', 'third', 'fourth', 'fifth'].flatMap((name, unit) => [[`_${name}_linear_sampler`, unit], [`_${name}_nearest_sampler`, unit]]),
  ['_depth_image_nearest_sampler', 5]];
// Optional effects share a GPU memory budget, as in starhermit_sys: the shadow maps first (in order, while they fit),
// then post-effect buffers in half floats where they render, else 8-bit color. Fallback bits (starhermit_sys
// MESH_FALLBACK_*): shadows left out (1), post effects left out (2), fewer multisample samples (4), 8-bit post color (8).
const DEFAULT_EFFECT_BUDGET = 512 * 1024 * 1024, POST_HDR_BYTES = 8, POST_LDR_BYTES = 4;
// The note (fallback bit 8) when post effects run in 8-bit color (starhermit_sys::POST_LDR_NOTE).
const POST_LDR_NOTE = 'Post effects use 8-bit color here: tone mapping comes first and over-bright light does not bloom';
const shadowMapBytes = size => size * size * 4;
// The post-effect chain (starhermit_sys post.rs): anti-aliasing after the output, fallback bits for effects left out
// (16 occlusion, 32 bloom, 64 SMAA for FXAA, 128 the grade) and the plan every backend runs: images of given sizes and
// formats, and steps drawing one triangle (the occlusion prepass the pass's batches) from inputs (null, 'scene', an image
// index or a lookup table's name) into a target ('scene', an image index or 'destination'), with a load ('discard',
// 'keep' or a clear color), a blend ('replace', 'multiply' or 'over') and 16 parameters.
const POST_AA = {none: 0, fxaa: 1, smaa: 2};
const POST_LDR_OCCLUSION_NOTE = 'Ambient occlusion needs half-float color, which this device cannot render';
const POST_LDR_GRADE_NOTE = 'Color grading needs half-float color, which this device cannot render';
const POST_LDR_FLASH_NOTE = "The grade's flash needs half-float color, which this device cannot render";
const POST_LDR_PROGRAM_NOTE = "The game's post pass needs half-float color, which this device cannot render";
const NORMAL_CLEAR = [0.184475, 0.184475, 1, 1], BLOOM_KERNELS = [3, 5, 7, 9, 11], BLOOM_FACTORS = [1, 0.8, 0.6, 0.4, 0.2];
const postEffects = f => ({antiAliasing: f[FRAME.effects + 1], occlusion: f[POST.flags] !== 0, bloom: f[FRAME.effects + 3] > 0, grade: f[POST.flags + 1] !== 0, displayGrade: f[POST.grade + 3] === GRADE_SPACE_DISPLAY, program: f[POST.gameProgram]});
function anyPostEffects(f) { const e = postEffects(f); return f[FRAME.effects] > 1 || e.antiAliasing !== 0 || e.occlusion || e.bloom || e.grade || e.program !== 0; }
const scaled = (size, k) => k < 1 ? Math.max(1, Math.round(size * k)) : size, halved = size => Math.max(1, Math.ceil(size / 2));
function postPlan(f, width, height, hdr, clear) {
  const over = clear === null, effects = postEffects(f), images = [], steps = [];
  const output = [f[FRAME.output], f[FRAME.output + 1], hdr ? 1 : 0, over ? 1 : 0];
  const image = (w, h, format) => images.push({width: w, height: h, format}) - 1;
  const step = (program, inputs, target, size, load, blend, values = []) => {
    const parameters = new Float32Array(16); parameters.set(values); parameters.set([size[0], size[1], 1 / size[0], 1 / size[1]], 8); parameters.set(output, 12);
    const all = [null, null, null, null, null]; inputs.forEach((input, i) => { all[i] = input; });
    return steps.push({program, inputs: all, depth: null, target, size, load, blend, parameters}) - 1;
  };
  if (effects.occlusion && hdr) {
    const k = f[POST.ao + 7], size = [scaled(width, k), scaled(height, k)];
    const normals = image(...size, 'normal'), depth = image(...size, 'depth'), occlusion = image(...size, 'color'), denoised = image(...size, 'color');
    const d = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    // three.js clears its normals to 0x7777ff and then, rendering the scene, to the scene's background.
    const first = step('normals', [], normals, size, {clear: clear ? [d(clear[0]), d(clear[1]), d(clear[2]), 1] : NORMAL_CLEAR}, 'replace');
    step('occlusion', [null, normals, 'occlusionNoise'], occlusion, size, 'discard', 'replace');
    step('denoise', [occlusion, normals, 'denoiseNoise'], denoised, size, 'discard', 'replace');
    step('occlusion_blend', [denoised], 'scene', [width, height], 'keep', 'multiply');
    for (let s = first; s < first + 3; s++) steps[s].depth = depth;
  }
  // A game's post program over the scene's light and depth, into an image the later steps read in place of the scene.
  let scene = 'scene';
  if (effects.program && hdr) {
    const shown = image(width, height, 'color');
    const s = step('game', ['scene', 'sceneDepth'], shown, [width, height], 'discard', 'replace'); steps[s].programId = effects.program; scene = shown;
  }
  let glow = null;
  if (effects.bloom) {
    const k = f[POST.bloom + 1];
    let size = [halved(scaled(width, k)), halved(scaled(height, k))];
    const bright = image(...size, 'color');
    step('bright', [scene], bright, size, 'discard', 'replace', [f[FRAME.effects + 2]]);
    let source = bright; const levels = [], across = [];
    for (let i = 0; i < 5; i++) {
      const h = image(...size, 'color'), v = image(...size, 'color');
      step('blur', [source], h, size, 'discard', 'replace', [1 / size[0], 0, BLOOM_KERNELS[i]]);
      step('blur', [h], v, size, 'discard', 'replace', [0, 1 / size[1], BLOOM_KERNELS[i]]);
      levels.push(v); across.push(h); source = v; size = [halved(size[0]), halved(size[1])];
    }
    // three.js mixes each level's weight toward its mirror (1.2 - w) by the radius and scales by the strength.
    const strength = f[FRAME.effects + 3], radius = f[POST.bloom], first = images[across[0]];
    step('bloom', levels, across[0], [first.width, first.height], 'discard', 'replace', BLOOM_FACTORS.map(w => strength * (w + (1.2 - 2 * w) * radius)));
    glow = across[0];
  }
  // The composite, straight to the destination or into an image the anti-aliasing reads; the last step replaces the
  // destination's color or goes over it.
  const [load, blend] = over ? ['keep', 'over'] : ['discard', 'replace'];
  const composite = [glow !== null ? 1 : 0, effects.grade && (hdr || effects.displayGrade) ? 1 : 0], inputs = glow !== null ? [scene, glow] : [scene];
  if (effects.antiAliasing === POST_AA.none) { step('composite', inputs, 'destination', [width, height], load, blend, composite); return {images, steps}; }
  const shown = image(width, height, 'color');
  step('composite', inputs, shown, [width, height], 'discard', 'replace', composite);
  if (effects.antiAliasing === POST_AA.fxaa) { step('fxaa', [shown], 'destination', [width, height], load, blend); return {images, steps}; }
  const edges = image(width, height, 'color'), weights = image(width, height, 'color');
  step('smaa_edges', [shown], edges, [width, height], {clear: [0, 0, 0, 0]}, 'replace');
  step('smaa_weights', [edges, 'smaaArea', 'smaaSearch'], weights, [width, height], 'discard', 'replace');
  step('smaa_blend', [shown, weights], 'destination', [width, height], load, blend);
  return {images, steps};
}
// Bytes of a pass's post effects: the scene's buffers (multisampled color and depth, the resolved image) and the plan's
// images (color at colorBytes, normals in half floats, 4-byte depth).
function postBytes(f, width, height, samples, hdr) {
  const color = hdr ? POST_HDR_BYTES : POST_LDR_BYTES; samples = Math.max(1, samples);
  const scene = width * height * ((samples > 1 ? samples * color : 0) + samples * 4 + color);
  return postPlan(f, width, height, hdr, [0, 0, 0, 0]).images.reduce((sum, i) => sum + i.width * i.height * (i.format === 'color' ? color : i.format === 'normal' ? POST_HDR_BYTES : 4), scene);
}
function leaveOutOcclusion(f) { f[POST.flags] = 0; f.fill(0, POST.ao, POST.bloom); }
function leaveOutBloom(f) { f.fill(0, FRAME.effects + 2, FRAME.effects + 4); f.fill(0, POST.bloom, POST.bloom + 2); }
function leaveOutGrade(f) { f[POST.flags + 1] = 0; f.fill(0, POST.grade, POST.game); }
function leaveOutPostProgram(f) { f.fill(0, POST.game, POST.flags + POST.length); }
// 8-bit post buffers leave out ambient occlusion, a linear-space grade and a game's post program (linear light), with
// notes; a display-space grade runs without a linear flash (light before tone mapping), noted when it has one; a
// display-space flash stays.
function leaveOutLinearEffects(f, notes) {
  const e = postEffects(f);
  if (e.occlusion) { leaveOutOcclusion(f); notes.push([16, POST_LDR_OCCLUSION_NOTE]); }
  if (e.grade && e.displayGrade) {
    if (f[POST.flash + 3] === 0 && f.subarray(POST.flash, POST.flash + 3).some(v => v !== 0)) { f.fill(0, POST.flash, POST.flash + 3); notes.push([128, POST_LDR_FLASH_NOTE]); }
  } else if (e.grade) { leaveOutGrade(f); notes.push([128, POST_LDR_GRADE_NOTE]); }
  if (e.program) { leaveOutPostProgram(f); notes.push([256, POST_LDR_PROGRAM_NOTE]); }
}
// Fits a frame's effects into the budget, as starhermit_sys::fit_post: multisampling halves first (FXAA standing in at
// one sample); what still does not fit is left out in order (occlusion, bloom, SMAA for FXAA), each with a note.
// Returns the samples, or null when not even the scene's buffers fit.
function fitPost(f, width, height, wanted, hdr, budget, notes) {
  for (let samples = Math.max(1, wanted); ;) {
    const fitted = f.slice();
    if (samples === 1 && wanted > 1 && fitted[FRAME.effects + 1] === POST_AA.none) fitted[FRAME.effects + 1] = POST_AA.fxaa;
    if (postBytes(fitted, width, height, samples, hdr) <= budget) { f.set(fitted); return samples; }
    if (samples > 1) { samples = Math.floor(samples / 2); continue; }
    const over = `at ${width}×${height} exceeds the effect budget`, e = postEffects(f);
    if (e.occlusion) { leaveOutOcclusion(f); notes.push([16, `Ambient occlusion ${over}`]); }
    else if (e.bloom) { leaveOutBloom(f); notes.push([32, `Bloom ${over}`]); }
    else if (e.antiAliasing === POST_AA.smaa) { f[FRAME.effects + 1] = POST_AA.fxaa; notes.push([64, `SMAA ${over}; FXAA is used instead`]); }
    else return null;
  }
}
// The lookup textures (built by starhermit-sys from its tables) as RGBA8: width, height and data, decoded once.
const postTables = new Map();
function postTable(name) {
  if (!postTables.has(name)) {
    const [width, height, channels, base64] = POST_TABLES[name], bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = c < channels ? bytes[i * channels + c] : c === 3 ? 255 : 0;
    postTables.set(name, {width, height, data});
  }
  return postTables.get(name);
}
// The frame's shadows that fit the budget after the ones before them, in order, and their bytes.
function fitShadows(frame, budget) {
  const kept = []; let bytes = 0;
  for (let k = 0; k < frame[FRAME.counts + 1]; k++) {
    const size = frame[FRAME.shadows + k * SHADOW_LENGTH + SHADOW.size], need = shadowMapBytes(size);
    if (size > 0 && need <= budget - bytes) { kept.push(k); bytes += need; }
  }
  return {kept, bytes};
}
// A half-float RGBA upload (binary16 bits, starhermit_sys::validate_float_texture): 1 to the full chain of levels,
// non-negative finite values.
function validFloatTexture(width, height, levels, data, sampler) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= 4096 && height <= 4096
    && Number.isInteger(levels) && levels >= 1 && levels <= mipLevels(width, height) && validSampler(sampler)
    && data instanceof Uint16Array && data.length === mipChainBytes(width, height, levels))) return false;
  for (let i = 0; i < data.length; i++) if (data[i] & 0x8000 || (data[i] & 0x7c00) === 0x7c00) return false;
  return true;
}
const POST_WGSL = `// The post-effect chain's programs (starhermit-sys post.rs plans their steps). Parameters: per-step values, more values, the
// target's size and its reciprocal, and the output (tone mapping, exposure, whether the scene holds linear color, whether
// the result goes over kept color). Post: the mesh frame's post block (mesh_data.rs frame::POST).
struct Parameters { values: vec4f, more: vec4f, size: vec4f, output: vec4f };
struct Post { flags: vec4f, ao0: vec4f, ao1: vec4f, denoise0: vec4f, denoise1: vec4f, projection: mat4x4f,
  inverse_projection: mat4x4f, view_normal: array<vec4f, 3>, bloom: vec4f, grade: vec4f, shadows: vec4f, highlights: vec4f,
  vignette: vec4f, vignette_scale: vec4f, flash: vec4f, night: vec4f, night_tint: vec4f, night_spare: vec4f, lift: vec4f,
  game_inverse: mat4x4f, game_camera: vec4f, game_forward: vec4f, game: array<vec4f, 16> };
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var second: texture_2d<f32>;
@group(0) @binding(2) var third: texture_2d<f32>;
@group(0) @binding(3) var fourth: texture_2d<f32>;
@group(0) @binding(4) var fifth: texture_2d<f32>;
@group(0) @binding(5) var depth_image: texture_depth_2d;
@group(0) @binding(6) var linear_sampler: sampler;
@group(0) @binding(7) var nearest_sampler: sampler;
@group(0) @binding(8) var<uniform> parameters: Parameters;
@group(0) @binding(9) var<uniform> post: Post;
struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Varyings {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var output: Varyings; output.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0); output.uv = vec2f(p.x, 1.0 - p.y); return output;
}
const PI = 3.141592653589793;
fn decode(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045)); }
fn encode(x: vec3f) -> vec3f { let c = clamp(x, vec3f(0.0), vec3f(1.0)); return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c < vec3f(0.0031308)); }
fn rrt(v: vec3f) -> vec3f { let a = v * (v + 0.0245786) - 0.000090537; let b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
fn agx_curve(x: vec3f) -> vec3f {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
// As the mesh shader's: three.js's tone mapping operators.
fn tone(color: vec3f, mode: u32, exposure: f32) -> vec3f {
  if (mode == 1u) { return clamp(color * exposure, vec3f(0.0), vec3f(1.0)); }
  if (mode == 2u) { let c = color * exposure; return clamp(c / (vec3f(1.0) + c), vec3f(0.0), vec3f(1.0)); }
  if (mode == 3u) {
    let c = max(vec3f(0.0), color * exposure - 0.004);
    return pow((c * (6.2 * c + 0.5)) / (c * (6.2 * c + 1.7) + 0.06), vec3f(2.2));
  }
  if (mode == 4u) {
    let input = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
    let output = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
    return clamp(output * rrt(input * (color * (exposure / 0.6))), vec3f(0.0), vec3f(1.0));
  }
  if (mode == 5u) {
    let to2020 = mat3x3f(vec3f(0.6274, 0.0691, 0.0164), vec3f(0.3293, 0.9195, 0.0880), vec3f(0.0433, 0.0113, 0.8956));
    let from2020 = mat3x3f(vec3f(1.6605, -0.1246, -0.0182), vec3f(-0.5876, 1.1329, -0.1006), vec3f(-0.0728, -0.0083, 1.1187));
    let inset = mat3x3f(vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995),
      vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    let outset = mat3x3f(vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
      vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
      vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    var c = inset * (to2020 * (color * exposure));
    c = clamp((log2(max(c, vec3f(1e-10))) + 12.47393) / (4.026069 + 12.47393), vec3f(0.0), vec3f(1.0));
    c = outset * agx_curve(c);
    return clamp(from2020 * pow(max(vec3f(0.0), c), vec3f(2.2)), vec3f(0.0), vec3f(1.0));
  }
  if (mode == 6u) {
    var c = color * exposure;
    let x = min(c.r, min(c.g, c.b));
    c = c - vec3f(select(0.04, x - 6.25 * x * x, x < 0.08));
    let peak = max(c.r, max(c.g, c.b));
    if (peak < 0.76) { return c; }
    let top = 1.0 - 0.0576 / (peak - 0.52);
    c = c * (top / peak);
    return mix(c, vec3f(top), 1.0 - 1.0 / (0.15 * (peak - top) + 1.0));
  }
  return color;
}
fn sample(uv: vec2f) -> vec4f { return textureSampleLevel(image, linear_sampler, uv, 0.0); }
// Half floats as finite light: infinity (additive light overflowing) to the largest, NaN (infinity times a zero blend
// factor) to zero, so neither spreads through the effects.
fn finite(c: vec4f) -> vec4f { return select(vec4f(0.0), min(c, vec4f(65504.0)), c >= vec4f(0.0)); }

// The ports of three.js's shaders work in OpenGL's texture coordinates, v rising from the bottom row; the engine's images
// keep their top row first, so rendered images are read at the mirrored coordinate. Lookup tables are read unmirrored, as
// three.js's flipY-free data textures are.
fn gl(uv: vec2f) -> vec2f { return vec2f(uv.x, 1.0 - uv.y); }
fn depth_at(uv: vec2f) -> f32 { return textureSampleLevel(depth_image, nearest_sampler, gl(uv), 0); }
fn normal_at(uv: vec2f) -> vec3f { return textureSampleLevel(second, nearest_sampler, gl(uv), 0.0).rgb * 2.0 - 1.0; }
fn view_position(screen: vec2f, depth: f32) -> vec3f {
  let view = post.inverse_projection * vec4f(vec3f(screen, depth) * 2.0 - 1.0, 1.0);
  return view.xyz / view.w;
}

// three.js GTAOShader (OUTPUT.Default's occlusion): horizon search along three (or five) slice directions turned by a 5×5
// noise, each over ceil(samples / directions) steps both ways within the radius; 1 where nothing was drawn.
fn horizon(view: vec3f, offset: vec3f, view_dir: vec3f, j: i32, current: f32) -> f32 {
  let clip = post.projection * vec4f(view + offset, 1.0);
  let uv = clip.xy / clip.w * 0.5 + 0.5;
  let delta = view_position(uv, depth_at(uv)) - view;
  if (abs(delta.z) < post.ao0.z) {
    let cos_horizon = dot(view_dir, normalize(delta));
    return current + max(0.0, (cos_horizon - current) * mix(1.0, 2.0 / f32(j + 2), post.ao0.w));
  }
  return current;
}
@fragment fn occlusion(input: Varyings) -> @location(0) vec4f {
  let uv = gl(input.uv);
  let depth = depth_at(uv);
  if (depth >= 1.0) { return vec4f(1.0); }
  let view = view_position(uv, depth);
  let normal = normal_at(uv);
  let noise = textureSampleLevel(third, nearest_sampler, fract(uv * parameters.size.xy / 5.0), 0.0);
  let random = noise.xyz * 2.0 - 1.0;
  let tangent = normalize(vec3f(random.xy, 0.0));
  let kernel = mat3x3f(tangent, vec3f(-tangent.y, tangent.x, 0.0), vec3f(0.0, 0.0, 1.0));
  let samples = i32(post.ao1.y + 0.5);
  let directions = select(3, 5, samples >= 30);
  let steps = (samples + directions - 1) / directions;
  let view_dir = normalize(-view);
  var ao = 0.0;
  for (var i = 0; i < directions; i++) {
    let angle = f32(i) / f32(directions) * PI;
    let reach = 0.5 + 0.5 * noise.w;
    let direction = normalize(kernel * vec3f(cos(angle), sin(angle), 0.0));
    let slice_bitangent = normalize(cross(direction, view_dir));
    let slice_tangent = cross(slice_bitangent, view_dir);
    let normal_in_slice = normalize(normal - slice_bitangent * dot(normal, slice_bitangent));
    let tangent_to_normal = cross(normal_in_slice, slice_bitangent);
    var cos_horizons = vec2f(dot(view_dir, tangent_to_normal), dot(view_dir, -tangent_to_normal));
    for (var j = 0; j < steps; j++) {
      let offset = direction * post.ao0.x * reach * pow(f32(j + 1) / f32(steps), post.ao0.y);
      cos_horizons.x = horizon(view, offset, view_dir, j, cos_horizons.x);
      cos_horizons.y = horizon(view, -offset, view_dir, j, cos_horizons.y);
    }
    let sin_horizons = sqrt(1.0 - cos_horizons * cos_horizons);
    let nx = dot(normal_in_slice, slice_tangent);
    let ny = dot(normal_in_slice, view_dir);
    let nxb = 0.5 * (acos(cos_horizons.y) - acos(cos_horizons.x) + sin_horizons.x * cos_horizons.x - sin_horizons.y * cos_horizons.y);
    let nyb = 0.5 * (2.0 - cos_horizons.x * cos_horizons.x - cos_horizons.y * cos_horizons.y);
    ao += nx * nxb + ny * nyb;
  }
  ao = clamp(ao / f32(directions), 0.0, 1.0);
  ao = pow(ao, post.ao1.x);
  return vec4f(vec3f(ao), 1.0);
}
// three.js PoissonDenoiseShader: the occlusion averaged over a disk of samples (generateDenoiseSamples: angle 2π·rings·i/n,
// radius (i/(n − 1))^exponent) turned by a 64×64 noise, weighted by luma, plane distance and normal similarity.
fn luminance(c: vec3f) -> f32 { return dot(vec3f(0.2125, 0.7154, 0.0721), c); }
@fragment fn denoise(input: Varyings) -> @location(0) vec4f {
  let uv = gl(input.uv);
  let depth = depth_at(uv);
  let normal = normal_at(uv);
  if (depth == 1.0 || dot(normal, normal) == 0.0) { return vec4f(1.0); }
  let center = sample(input.uv).rgb;
  let view = view_position(uv, depth);
  let resolution = parameters.size.xy;
  let turn = textureSampleLevel(third, nearest_sampler, fract(uv * resolution / 64.0), 0.0).x * 2.0 * PI;
  let n = vec2f(sin(turn), cos(turn));
  let samples = i32(post.denoise1.y + 0.5);
  var denoised = center;
  var total = 1.0;
  for (var i = 0; i < samples; i++) {
    let angle = 2.0 * PI * post.denoise1.x * f32(i) / f32(samples);
    let radius = select(pow(f32(i) / f32(samples - 1), post.denoise1.z), 0.0, i == 0);
    let disk = vec2f(cos(angle), sin(angle)) * (1.0 + radius * (post.denoise0.w - 1.0)) / resolution;
    // three.js's mat2(n.x, -n.y, n.x, n.y) times the disk offset.
    let sample_uv = uv + vec2f(n.x * disk.x + n.x * disk.y, n.y * disk.y - n.y * disk.x);
    let neighbor = textureSampleLevel(image, linear_sampler, gl(sample_uv), 0.0).rgb;
    let sample_depth = depth_at(sample_uv);
    let sample_normal = normal_at(sample_uv);
    let view_sample = view_position(sample_uv, sample_depth);
    let normal_similarity = pow(max(dot(normal, sample_normal), 0.0), post.denoise0.z);
    let luma_similarity = max(1.0 - abs(luminance(neighbor) - luminance(center)) / post.denoise0.x, 0.0);
    let depth_similarity = max(1.0 - abs(dot(view - view_sample, normal)) / post.denoise0.y, 0.0);
    let w = luma_similarity * depth_similarity * normal_similarity;
    denoised += w * neighbor;
    total += w;
  }
  if (total > 0.0) { denoised /= total; }
  return vec4f(denoised, 1.0);
}
// three.js GTAOBlendShader, multiplied into the scene by the blend.
@fragment fn occlusion_blend(input: Varyings) -> @location(0) vec4f {
  let texel = sample(input.uv);
  return vec4f(mix(vec3f(1.0), texel.rgb, post.ao1.z), texel.a);
}

// three.js UnrealBloomPass. The luminosity high pass (LuminosityHighPassShader, smooth width 0.01) at half the bloom's
// resolution; 8-bit buffers hold encoded color, which it decodes. A texel that is not finite light (NaN, or infinity
// from overflowing half floats) brightens nothing, so one bad pixel cannot spread over the frame.
@fragment fn bright(input: Varyings) -> @location(0) vec4f {
  let raw = sample(input.uv);
  let s = select(vec4f(0.0), raw, all(raw.rgb >= vec3f(0.0)) && all(raw.rgb < vec3f(65504.0)));
  let texel = select(vec4f(decode(s.rgb), s.a), s, parameters.output.z > 0.5);
  let threshold = parameters.values.x;
  let amount = smoothstep(threshold, threshold + 0.01, dot(texel.rgb, vec3f(0.2126, 0.7152, 0.0722)));
  return mix(vec4f(0.0), texel, amount);
}
// A separable Gaussian of kernel radius k: weights 0.39894·exp(−x²/2k²)/k, normalized (values.xy: the step, values.z: k).
@fragment fn blur(input: Varyings) -> @location(0) vec4f {
  let k = parameters.values.z;
  var weight_sum = 0.39894 / k;
  var sum = sample(input.uv).rgb * weight_sum;
  for (var i = 1; i < i32(k + 0.5); i++) {
    let x = f32(i);
    let w = 0.39894 * exp(-0.5 * x * x / (k * k)) / k;
    let offset = parameters.values.xy * x;
    sum += (sample(input.uv + offset).rgb + sample(input.uv - offset).rgb) * w;
    weight_sum += 2.0 * w;
  }
  return vec4f(sum / weight_sum, 1.0);
}
// The levels' weighted sum (values and more.x: strength times each level's radius-lerped factor). Its alpha, the weights'
// sum, scales the light the composite adds, as three.js's additive blend (source alpha, one) does.
@fragment fn bloom(input: Varyings) -> @location(0) vec4f {
  let uv = input.uv;
  let w = parameters.values;
  return w.x * sample(uv) + w.y * textureSampleLevel(second, linear_sampler, uv, 0.0) + w.z * textureSampleLevel(third, linear_sampler, uv, 0.0)
    + w.w * textureSampleLevel(fourth, linear_sampler, uv, 0.0) + parameters.more.x * textureSampleLevel(fifth, linear_sampler, uv, 0.0);
}

// The color grade and vignette in linear space (grade.w 0: on linear light clamped to 0..1, as a three.js ShaderPass before
// OutputPass sees it): an S-curve blended in by the contrast, saturation around Rec. 601 luma, the shadows' tint turning
// into the highlights' as that luma rises through the split, all blended in by the amount; then darkening by the vignette's
// amount times a smoothstep from its inner to its outer radius in the frame's texture coordinates about the center, scaled
// per axis.
fn vignetted(c: vec3f, uv: vec2f) -> vec3f {
  let d = length((uv - 0.5) * post.vignette_scale.xy);
  return c * (1.0 - post.vignette.x * smoothstep(post.vignette.y, post.vignette.z, d));
}
fn graded(color: vec3f, uv: vec2f) -> vec3f {
  var c = clamp(color, vec3f(0.0), vec3f(1.0));
  var s = mix(c, c * c * (3.0 - 2.0 * c), post.grade.x);
  let l = dot(s, vec3f(0.299, 0.587, 0.114));
  s = mix(vec3f(l), s, post.grade.y);
  s *= mix(post.shadows.rgb, post.highlights.rgb, smoothstep(post.shadows.w, post.highlights.w, l));
  c = mix(c, clamp(s, vec3f(0.0), vec3f(1.0)), post.grade.z);
  return vignetted(c, uv);
}
// The grade in display space (grade.w 1; host API 1.11), on the tone-mapped sRGB-encoded color clamped to 0..1, per
// channel as a page's canvas grade: Rec. 709 luma l; the night's spared part (red minus blue through its warm range, or
// l through its bright range, times min(1, night amount × bright scale) when that scale is above 0); saturation around l,
// times 1 + spare saturation × night amount × spare and 1 − the night's desaturation × n (n the night's amount less the
// spared part); contrast as a slope of 1 + contrast about 0.5; the split tints by a smoothstep of l; the night's tint
// mixed in by n; the lift, times 1 + amount by a smoothstep of l; a display-space flash (flash.w 1) added; clamped and
// blended in by the amount, then the vignette. Neutral terms change nothing.
fn display_graded(color: vec3f, uv: vec2f) -> vec3f {
  let c = clamp(color, vec3f(0.0), vec3f(1.0));
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let bright = smoothstep(post.night_spare.z, post.night_spare.w, l) * select(1.0, min(1.0, post.night.x * post.night.w), post.night.w > 0.0);
  let spare = max(smoothstep(post.night_spare.x, post.night_spare.y, c.r - c.b), bright);
  let n = post.night.x * (1.0 - spare);
  var g = mix(vec3f(l), c, post.grade.y * (1.0 + post.night.z * post.night.x * spare) * (1.0 - post.night.y * n));
  g = (g - 0.5) * (1.0 + post.grade.x) + 0.5;
  g *= mix(post.shadows.rgb, post.highlights.rgb, smoothstep(post.shadows.w, post.highlights.w, l));
  g *= mix(vec3f(1.0), post.night_tint.rgb, n);
  g *= 1.0 + post.lift.x * smoothstep(post.lift.y, post.lift.z, l);
  g += post.flash.rgb * post.flash.w;
  return vignetted(mix(c, clamp(g, vec3f(0.0), vec3f(1.0)), post.grade.z), uv);
}
// The image as shown: bloom added, graded, and linear images tone mapped and encoded (three.js OutputPass); over kept
// color, light divided by its coverage and multiplied back, so light without coverage adds on. values: bloom (1), grade (1);
// the grade adds its flash to the light first (unless the flash is in display space, flash.w 1). 8-bit images (tone mapped
// and encoded already) take only a display-space grade.
@fragment fn composite(input: Varyings) -> @location(0) vec4f {
  let s = finite(sample(input.uv));
  var g = vec3f(0.0);
  if (parameters.values.x > 0.5) { let glow = finite(textureSampleLevel(second, linear_sampler, input.uv, 0.0)); g = glow.rgb * glow.a; }
  let grade = parameters.values.y > 0.5;
  let display = post.grade.w > 0.5;
  if (parameters.output.z < 0.5) {
    var encoded = s.rgb;
    if (parameters.values.x > 0.5) { encoded = encode(decode(s.rgb) + g); }
    if (grade) { encoded = display_graded(encoded, input.uv); }
    return vec4f(encoded, s.a);
  }
  let over = parameters.output.w > 0.5;
  let k = select(1.0, s.a, over && s.a > 0.001);
  var lit = min(s.rgb / k + g / k, vec3f(65504.0));
  if (grade) {
    lit = min(lit + post.flash.rgb * (1.0 - post.flash.w), vec3f(65504.0));
    if (!display) { lit = graded(lit, input.uv); }
  }
  var shown = encode(tone(lit, u32(parameters.output.x + 0.5), parameters.output.y));
  if (grade && display) { shown = display_graded(shown, input.uv); }
  return vec4f(shown * select(1.0, k, over), s.a);
}

// FXAA as Jasper Flick's Catlike Coding tutorial (MIT-0) computes it, with the parameters three.js r176's FXAAShader uses:
// luma 0.3/0.59/0.11, contrast threshold 0.0312, relative threshold 0.063, full subpixel blending, edge steps 1, 1.5, 2, 2,
// 2, 4 and a guess of 8.
fn fxaa_luma(uv: vec2f) -> f32 { return dot(sample(gl(uv)).rgb, vec3f(0.3, 0.59, 0.11)); }
fn edge_step(i: i32) -> f32 { if (i == 0) { return 1.0; } if (i == 1) { return 1.5; } if (i == 5) { return 4.0; } return 2.0; }
@fragment fn fxaa(input: Varyings) -> @location(0) vec4f {
  var uv = gl(input.uv);
  let t = parameters.size.zw;
  let m = fxaa_luma(uv);
  let n = fxaa_luma(uv + t * vec2f(0.0, 1.0)); let e = fxaa_luma(uv + t * vec2f(1.0, 0.0));
  let s = fxaa_luma(uv + t * vec2f(0.0, -1.0)); let w = fxaa_luma(uv + t * vec2f(-1.0, 0.0));
  let ne = fxaa_luma(uv + t * vec2f(1.0, 1.0)); let nw = fxaa_luma(uv + t * vec2f(-1.0, 1.0));
  let se = fxaa_luma(uv + t * vec2f(1.0, -1.0)); let sw = fxaa_luma(uv + t * vec2f(-1.0, -1.0));
  let highest = max(max(max(max(n, e), s), w), m);
  let lowest = min(min(min(min(n, e), s), w), m);
  let contrast = highest - lowest;
  if (contrast < max(0.0312, 0.063 * highest)) { return sample(input.uv); }
  // The pixel's blend from its neighborhood's average.
  var f = (2.0 * (n + e + s + w) + ne + nw + se + sw) / 12.0;
  f = clamp(abs(f - m) / contrast, 0.0, 1.0);
  let smooth_f = smoothstep(0.0, 1.0, f);
  let pixel_blend = smooth_f * smooth_f;
  // The edge's orientation and side.
  let horizontal_edge = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
  let vertical_edge = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
  let horizontal = horizontal_edge >= vertical_edge;
  let p_luma = select(e, n, horizontal); let n_luma = select(w, s, horizontal);
  let p_gradient = abs(p_luma - m); let n_gradient = abs(n_luma - m);
  var pixel_step = select(t.x, t.y, horizontal);
  var opposite = p_luma; var gradient = p_gradient;
  if (p_gradient < n_gradient) { pixel_step = -pixel_step; opposite = n_luma; gradient = n_gradient; }
  // The edge's ends, searched both ways along it.
  var uv_edge = uv;
  var edge_dir = vec2f(0.0, t.y);
  if (horizontal) { uv_edge.y += pixel_step * 0.5; edge_dir = vec2f(t.x, 0.0); } else { uv_edge.x += pixel_step * 0.5; }
  let edge_luma = (m + opposite) * 0.5;
  let threshold = gradient * 0.25;
  var puv = uv_edge + edge_dir * edge_step(0);
  var p_delta = fxaa_luma(puv) - edge_luma;
  var p_end = abs(p_delta) >= threshold;
  for (var i = 1; i < 6 && !p_end; i++) { puv += edge_dir * edge_step(i); p_delta = fxaa_luma(puv) - edge_luma; p_end = abs(p_delta) >= threshold; }
  if (!p_end) { puv += edge_dir * 8.0; }
  var nuv = uv_edge - edge_dir * edge_step(0);
  var n_delta = fxaa_luma(nuv) - edge_luma;
  var n_end = abs(n_delta) >= threshold;
  for (var i = 1; i < 6 && !n_end; i++) { nuv -= edge_dir * edge_step(i); n_delta = fxaa_luma(nuv) - edge_luma; n_end = abs(n_delta) >= threshold; }
  if (!n_end) { nuv -= edge_dir * 8.0; }
  let p_distance = select(puv.y - uv.y, puv.x - uv.x, horizontal);
  let n_distance = select(uv.y - nuv.y, uv.x - nuv.x, horizontal);
  var shortest = n_distance; var delta_sign = n_delta >= 0.0;
  if (p_distance <= n_distance) { shortest = p_distance; delta_sign = p_delta >= 0.0; }
  var edge_blend = 0.5 - shortest / (p_distance + n_distance);
  if (delta_sign == (m - edge_luma >= 0.0)) { edge_blend = 0.0; }
  let blend = max(pixel_blend, edge_blend);
  if (horizontal) { uv.y += pixel_step * blend; } else { uv.x += pixel_step * blend; }
  return sample(gl(uv));
}

// SMAA 1x (Jimenez et al., MIT; licenses/LICENSE-smaa) as three.js r176's SMAAShader runs it: color edges at threshold
// 0.1 with local contrast adaptation, blending weights from line searches of up to 8 steps and the area texture
// (orthogonal, no diagonals or corners), and neighborhood blending in gamma 2.2. Its coordinates follow three.js's (OpenGL).
fn smaa_color(uv: vec2f) -> vec3f { return sample(gl(uv)).rgb; }
fn max3(v: vec3f) -> f32 { return max(max(v.r, v.g), v.b); }
@fragment fn smaa_edges(input: Varyings) -> @location(0) vec4f {
  let uv = gl(input.uv);
  let r = parameters.size.zw;
  let c = smaa_color(uv);
  var delta = vec4f(max3(abs(c - smaa_color(uv + r * vec2f(-1.0, 0.0)))), max3(abs(c - smaa_color(uv + r * vec2f(0.0, 1.0)))), 0.0, 0.0);
  var edges = step(vec2f(0.1), delta.xy);
  if (dot(edges, vec2f(1.0)) == 0.0) { discard; }
  delta.z = max3(abs(c - smaa_color(uv + r * vec2f(1.0, 0.0))));
  delta.w = max3(abs(c - smaa_color(uv + r * vec2f(0.0, -1.0))));
  var max_delta = max(max(max(delta.x, delta.y), delta.z), delta.w);
  delta.z = max3(abs(c - smaa_color(uv + r * vec2f(-2.0, 0.0))));
  delta.w = max3(abs(c - smaa_color(uv + r * vec2f(0.0, 2.0))));
  max_delta = max(max(max_delta, delta.z), delta.w);
  edges *= step(vec2f(0.5 * max_delta), delta.xy);
  return vec4f(edges, 0.0, 0.0);
}
fn smaa_edge(uv: vec2f) -> vec2f { return sample(gl(uv)).rg; }
// The search texture (nearest, its own coordinates) as a pixel count.
fn smaa_search_length(e: vec2f, bias: f32, scale: f32) -> f32 {
  return 255.0 * textureSampleLevel(third, nearest_sampler, vec2f(bias + e.x * scale, e.y), 0.0).r;
}
fn smaa_search_left(start: vec2f, end: f32) -> f32 {
  let r = parameters.size.zw;
  var uv = start; var e = vec2f(0.0, 1.0);
  for (var i = 0; i < 8; i++) {
    e = smaa_edge(uv); uv -= vec2f(2.0, 0.0) * r;
    if (!(uv.x > end && e.g > 0.8281 && e.r == 0.0)) { break; }
  }
  uv.x += 0.25 * r.x + r.x + 2.0 * r.x;
  return uv.x - r.x * smaa_search_length(e, 0.0, 0.5);
}
fn smaa_search_right(start: vec2f, end: f32) -> f32 {
  let r = parameters.size.zw;
  var uv = start; var e = vec2f(0.0, 1.0);
  for (var i = 0; i < 8; i++) {
    e = smaa_edge(uv); uv += vec2f(2.0, 0.0) * r;
    if (!(uv.x < end && e.g > 0.8281 && e.r == 0.0)) { break; }
  }
  uv.x -= 0.25 * r.x + r.x + 2.0 * r.x;
  return uv.x + r.x * smaa_search_length(e, 0.5, 0.5);
}
fn smaa_search_up(start: vec2f, end: f32) -> f32 {
  let r = parameters.size.zw;
  var uv = start; var e = vec2f(1.0, 0.0);
  for (var i = 0; i < 8; i++) {
    e = smaa_edge(uv); uv += vec2f(0.0, 2.0) * r;
    if (!(uv.y > end && e.r > 0.8281 && e.g == 0.0)) { break; }
  }
  uv.y -= 0.25 * r.y + r.y + 2.0 * r.y;
  return uv.y + r.y * smaa_search_length(e.gr, 0.0, 0.5);
}
fn smaa_search_down(start: vec2f, end: f32) -> f32 {
  let r = parameters.size.zw;
  var uv = start; var e = vec2f(1.0, 0.0);
  for (var i = 0; i < 8; i++) {
    e = smaa_edge(uv); uv -= vec2f(0.0, 2.0) * r;
    if (!(uv.y < end && e.r > 0.8281 && e.g == 0.0)) { break; }
  }
  uv.y += 0.25 * r.y + r.y + 2.0 * r.y;
  return uv.y - r.y * smaa_search_length(e.gr, 0.5, 0.5);
}
// The area texture's orthogonal part for subsample 0 (80×80 texels, bilinear), at the distances' square roots.
fn smaa_area(distance: vec2f, e1: f32, e2: f32) -> vec2f {
  let texel = 16.0 * round(4.0 * vec2f(e1, e2)) + distance;
  return textureSampleLevel(second, linear_sampler, (texel + 0.5) / 80.0, 0.0).rg;
}
@fragment fn smaa_weights(input: Varyings) -> @location(0) vec4f {
  let uv = gl(input.uv);
  let r = parameters.size.zw;
  let pixel = uv * parameters.size.xy;
  let o0 = uv.xyxy + r.xyxy * vec4f(-0.25, 0.125, 1.25, 0.125);
  let o1 = uv.xyxy + r.xyxy * vec4f(-0.125, 0.25, -0.125, -1.25);
  let o2 = vec4f(o0.xz, o1.yw) + vec4f(-2.0, 2.0, -2.0, 2.0) * r.xxyy * 8.0;
  var weights = vec4f(0.0);
  let e = sample(input.uv).rg;
  if (e.g > 0.0) {
    // An edge at the top: the distances to its ends left and right and the crossing edges there.
    var d = vec2f(smaa_search_left(o0.xy, o2.x), 0.0);
    var coords = vec2f(d.x, o1.y);
    let e1 = smaa_edge(coords).r;
    coords.x = smaa_search_right(o0.zw, o2.y);
    d.y = coords.x;
    d = d / r.x - pixel.x;
    // three.js's SMAASampleLevelZeroOffset adds float(offset) × resolution, and GLSL's float() of an ivec2 is its first
    // component: ivec2(1, 0) moves by a whole texel both ways, undoing the row it stepped down.
    coords.y -= r.y;
    let e2 = smaa_edge(coords + r).r;
    let a = smaa_area(sqrt(abs(d)), e1, e2);
    weights.r = a.x; weights.g = a.y;
  }
  if (e.r > 0.0) {
    // An edge at the left: up and down.
    var d = vec2f(smaa_search_up(o1.xy, o2.z), 0.0);
    var coords = vec2f(o0.x, d.x);
    let e1 = smaa_edge(coords).g;
    coords.y = smaa_search_down(o1.zw, o2.w);
    d.y = coords.y;
    d = d / r.y - pixel.y;
    // ivec2(0, 1) there moves by nothing.
    coords.y -= r.y;
    let e2 = smaa_edge(coords).g;
    let a = smaa_area(sqrt(abs(d)), e1, e2);
    weights.b = a.x; weights.a = a.y;
  }
  return weights;
}
@fragment fn smaa_blend(input: Varyings) -> @location(0) vec4f {
  let uv = gl(input.uv);
  let r = parameters.size.zw;
  let weights = textureSampleLevel(second, linear_sampler, input.uv, 0.0);
  let a = vec4f(weights.x, textureSampleLevel(second, linear_sampler, gl(uv + r * vec2f(0.0, -1.0)), 0.0).g, weights.z,
    textureSampleLevel(second, linear_sampler, gl(uv + r * vec2f(1.0, 0.0)), 0.0).a);
  if (dot(a, vec4f(1.0)) < 1e-5) { return sample(input.uv); }
  // The line with the most weight through each pair of sides, then the larger of the two.
  var offset = vec2f(select(-a.b, a.a, a.a > a.b), select(a.r, -a.g, a.g > a.r));
  if (abs(offset.x) > abs(offset.y)) { offset.y = 0.0; } else { offset.x = 0.0; }
  var c = sample(input.uv);
  var opposite = sample(gl(uv + sign(offset) * r));
  let s = select(abs(offset.y), abs(offset.x), abs(offset.x) > abs(offset.y));
  c = vec4f(pow(c.rgb, vec3f(2.2)), c.a);
  opposite = vec4f(pow(opposite.rgb, vec3f(2.2)), opposite.a);
  let mixed = mix(c, opposite, s);
  return vec4f(pow(mixed.rgb, vec3f(1.0 / 2.2)), mixed.a);
}`;
// A game's post program (renderer.post; starhermit-gpu joins POST_WGSL, the game's uniforms, its WGSL and this): its
// `fn pixel(p: Pixel) -> vec4f` gives each pixel's linear light from the scene's light and depth, which bloom, the grade
// and the output then take in place of the scene's. Coordinates are the image's, (0, 0) its top left.
const POST_GAME_WGSL = `struct Pixel { uv: vec2f, coord: vec4f };
// The scene's linear light (after ambient occlusion), its alpha the coverage; and its view depth (65504 where nothing opaque).
fn scene_color(uv: vec2f) -> vec4f { return finite(textureSampleLevel(image, linear_sampler, uv, 0.0)); }
fn scene_depth(uv: vec2f) -> f32 { return textureSampleLevel(second, nearest_sampler, uv, 0.0).r; }
// The world position at a view depth along the ray through a point of the image.
fn world_position(uv: vec2f, depth: f32) -> vec3f {
  let far = post.game_inverse * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
  let ray = normalize(far.xyz / far.w - post.game_camera.xyz);
  return post.game_camera.xyz + ray * (depth / max(dot(ray, post.game_forward.xyz), 1e-6));
}
fn camera_position() -> vec3f { return post.game_camera.xyz; }
fn screen_size() -> vec2f { return parameters.size.xy; }
fn srgb_to_linear(c: vec3f) -> vec3f { return decode(c); }
fn linear_to_srgb(c: vec3f) -> vec3f { return encode(c); }
@fragment fn game_post(input: Varyings) -> @location(0) vec4f {
  load_uniforms();
  var p: Pixel; p.uv = input.uv; p.coord = input.position;
  return finite(pixel(p));
}`;
const MESH_WGSL = `struct Frame { view_projection: mat4x4f, camera: vec4f, forward: vec4f, light_direction: vec4f, light_color: vec4f, ambient: vec4f,
  counts: vec4f, output: vec4f, fog_color: vec4f, fog: vec4f, effects: vec4f, env0: vec4f, env1: vec4f, env2: vec4f, viewport: vec4f,
  lights: array<vec4f, 64>, shadows: array<vec4f, 24>, post: array<vec4f, 49> };
struct Material { base_color: vec4f, params: vec4f, emissive: vec4f, map0: vec4f, map1: vec4f, glow0: vec4f, glow1: vec4f,
  normal0: vec4f, normal1: vec4f, rough0: vec4f, rough1: vec4f, metal0: vec4f, metal1: vec4f, ao0: vec4f, ao1: vec4f, extra: vec4f };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> material: Material;
@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var image_sampler: sampler;
@group(1) @binding(2) var emissive_map: texture_2d<f32>;
@group(1) @binding(3) var emissive_sampler: sampler;
@group(1) @binding(4) var normal_map: texture_2d<f32>;
@group(1) @binding(5) var normal_sampler: sampler;
@group(1) @binding(6) var roughness_map: texture_2d<f32>;
@group(1) @binding(7) var roughness_sampler: sampler;
@group(1) @binding(8) var metalness_map: texture_2d<f32>;
@group(1) @binding(9) var metalness_sampler: sampler;
@group(1) @binding(10) var occlusion_map: texture_2d<f32>;
@group(1) @binding(11) var occlusion_sampler: sampler;
@group(1) @binding(12) var environment_map: texture_2d<f32>;
@group(1) @binding(13) var environment_sampler: sampler;
@group(2) @binding(0) var shadow_map0: texture_depth_2d;
@group(2) @binding(1) var shadow_map1: texture_depth_2d;
@group(2) @binding(2) var shadow_map2: texture_depth_2d;
@group(2) @binding(3) var shadow_map3: texture_depth_2d;
@group(2) @binding(4) var shadow_sampler: sampler_comparison;
struct Varyings { @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) tint: vec4f };
// A vertex color as shading takes it: any finite values arrive (custom materials read them as they are), color within
// the half-float range and alpha within 0..1.
fn shading_color(c: vec4f) -> vec4f { return clamp(c, vec4f(0.0), vec4f(65504.0, 65504.0, 65504.0, 1.0)); }
// Material flags (starhermit_sys::MESH_*), a whole number held exactly in params.w (read without adding 0.5: at 2^23
// that would round away the lowest bit): unlit 1, alpha mask 8, blend 16, additive 32, back side 64, no fog 512, no shadows received 2048,
// vertex colors 4096, Lambert 8192, normal map 16384, environment 32768, the pass's environment 65536, points 131072,
// point size attenuation 262144, no tone mapping 1048576, the custom attribute 2097152, premultiplied 4194304, multiply
// 8388608. Lights take four slots: position or direction and kind, color and range, spot direction
// (hemisphere ground color) and decay, cone cosines and the shadow cast (k + 1). Shadows take six: the matrix's columns,
// (size, depth bias, normal offset, offset per unit of distance) and (casting light, perspective, 0, 0). The surface's
// shading bits (starhermit_sys::MESH_SURFACE, host API 1.18) are a whole number of their own in map1.w: flat shading 1, a
// bump map in the normal map's place 2.
@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) model0: vec4f,
  @location(4) model1: vec4f, @location(5) model2: vec4f, @location(6) tint: vec4f, @location(7) color: vec4f) -> Varyings {
  // A compact layout's vertex read as the float layouts' are (material.extra, starhermit_sys::MeshLayout::dequantize; host
  // API 1.15): whole-number positions scaled back, UVs turned to count down from the top (zero without them) and, without
  // attributes, normals up. The float layouts' extra is zero: their vertices read as they are.
  let d = material.extra; let compact = d.w > 0.5;
  let p = select(position, position * d.x + vec3f(d.y), compact);
  let n = select(normal, vec3f(0.0, 1.0, 0.0), d.w > 1.5);
  let t = select(uv, vec2f(uv.x, 1.0 - uv.y) * d.z, compact);
  if (material.ao1.w > 0.5) {
    // A scene background (starhermit_sys::MESH_BACKGROUND): the triangle over the view, its world position the view
    // direction the instance places each corner at.
    var sky: Varyings;
    sky.world = model0.xyz * p.x + model1.xyz * p.y + vec3f(model0.w, model1.w, model2.w);
    sky.normal = vec3f(0.0, 0.0, 1.0); sky.uv = t; sky.tint = tint;
    sky.position = vec4f(p.xy, 0.5, 1.0); return sky;
  }
  let c0 = model0.xyz; let c1 = model1.xyz; let c2 = model2.xyz;
  let origin = vec3f(model0.w, model1.w, model2.w);
  var output: Varyings;
  output.world = c0 * p.x + c1 * p.y + c2 * p.z + origin;
  let det = dot(c0, cross(c1, c2));
  output.normal = mat3x3f(cross(c1, c2), cross(c2, c0), cross(c0, c1)) * n * select(1.0, -1.0, det < 0.0);
  let flags = u32(material.params.w);
  output.uv = t; output.tint = tint * select(vec4f(1.0), shading_color(color), (flags & 4096u) != 0u);
  var clip = frame.view_projection * vec4f(output.world, 1.0);
  if ((flags & 131072u) != 0u) {
    // Points: a square facing the view, the material's size in pixels across around the instance's position (three.js
    // gl_PointSize), or with attenuation under a perspective view that size times half the height over the depth.
    output.world = origin; output.normal = vec3f(0.0, 0.0, 1.0);
    clip = frame.view_projection * vec4f(origin, 1.0);
    var size = material.ao0.w;
    if ((flags & 262144u) != 0u && frame.viewport.z > 0.5) { size = size * frame.viewport.y * 0.5 / max(clip.w, 1e-6); }
    size = min(size, frame.viewport.w);
    let extent = p.xy * 2.0 * size / max(frame.viewport.xy, vec2f(1.0));
    clip = vec4f(clip.xy + extent * clip.w, clip.z, clip.w);
  }
  clip.z = (clip.z + clip.w) * 0.5;
  output.position = clip; return output;
}
fn decode(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045)); }
fn encode(x: vec3f) -> vec3f { let c = clamp(x, vec3f(0.0), vec3f(1.0)); return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c < vec3f(0.0031308)); }
const PI = 3.14159265;
// Texture coordinates through a material's two transform rows.
fn transformed(r0: vec4f, r1: vec4f, uv: vec2f) -> vec2f { let p = vec3f(uv, 1.0); return vec2f(dot(r0.xyz, p), dot(r1.xyz, p)); }
fn ease(t: f32) -> f32 { let s = clamp(t, 0.0, 1.0); return s * s * (3.0 - 2.0 * s); }
fn saturate1(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn rrt(v: vec3f) -> vec3f { let a = v * (v + 0.0245786) - 0.000090537; let b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
fn agx_curve(x: vec3f) -> vec3f {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
// three.js's tone mapping operators (tonemapping_pars_fragment): none 0, linear 1, Reinhard 2, Cineon 3, ACES filmic 4, AgX 5,
// neutral 6.
fn tone(color: vec3f, mode: u32, exposure: f32) -> vec3f {
  if (mode == 1u) { return clamp(color * exposure, vec3f(0.0), vec3f(1.0)); }
  if (mode == 2u) { let c = color * exposure; return clamp(c / (vec3f(1.0) + c), vec3f(0.0), vec3f(1.0)); }
  if (mode == 3u) {
    let c = max(vec3f(0.0), color * exposure - 0.004);
    return pow((c * (6.2 * c + 0.5)) / (c * (6.2 * c + 1.7) + 0.06), vec3f(2.2));
  }
  if (mode == 4u) {
    let input = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
    let output = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
    return clamp(output * rrt(input * (color * (exposure / 0.6))), vec3f(0.0), vec3f(1.0));
  }
  if (mode == 5u) {
    let to2020 = mat3x3f(vec3f(0.6274, 0.0691, 0.0164), vec3f(0.3293, 0.9195, 0.0880), vec3f(0.0433, 0.0113, 0.8956));
    let from2020 = mat3x3f(vec3f(1.6605, -0.1246, -0.0182), vec3f(-0.5876, 1.1329, -0.1006), vec3f(-0.0728, -0.0083, 1.1187));
    let inset = mat3x3f(vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995),
      vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    let outset = mat3x3f(vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
      vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
      vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    var c = inset * (to2020 * (color * exposure));
    c = clamp((log2(max(c, vec3f(1e-10))) + 12.47393) / (4.026069 + 12.47393), vec3f(0.0), vec3f(1.0));
    c = outset * agx_curve(c);
    return clamp(from2020 * pow(max(vec3f(0.0), c), vec3f(2.2)), vec3f(0.0), vec3f(1.0));
  }
  if (mode == 6u) {
    var c = color * exposure;
    let x = min(c.r, min(c.g, c.b));
    c = c - vec3f(select(0.04, x - 6.25 * x * x, x < 0.08));
    let peak = max(c.r, max(c.g, c.b));
    if (peak < 0.76) { return c; }
    let top = 1.0 - 0.0576 / (peak - 0.52);
    c = c * (top / peak);
    return mix(c, vec3f(top), 1.0 - 1.0 / (0.15 * (peak - top) + 1.0));
  }
  return color;
}
fn shadow_sample(k: u32, uv: vec2f, depth: f32) -> f32 {
  if (k == 0u) { return textureSampleCompareLevel(shadow_map0, shadow_sampler, uv, depth); }
  if (k == 1u) { return textureSampleCompareLevel(shadow_map1, shadow_sampler, uv, depth); }
  if (k == 2u) { return textureSampleCompareLevel(shadow_map2, shadow_sampler, uv, depth); }
  return textureSampleCompareLevel(shadow_map3, shadow_sampler, uv, depth);
}
// Shadow k's light reaching a point (1 lit, 0 shadowed), filtered over nine samples spaced by the shadow's radius in map texels
// (three.js PCFShadowMap's shadow.radius; 0 a hard edge). A perspective (spot) map's bias moves the
// lookup that fraction of the way toward the light, in linear distance rather than the map's depth, and its normal offset
// grows with the distance from the light.
fn visibility(k: u32, world: vec3f, n: vec3f) -> f32 {
  let s = k * 6u;
  let params = frame.shadows[s + 4u]; let caster = frame.shadows[s + 5u];
  let size = params.x;
  if (size <= 0.0) { return 1.0; }
  var offset = params.z; var bias = params.y; var point = world;
  if (caster.y > 0.5) {
    let light = frame.lights[(u32(caster.x + 0.5) - 1u) * 4u].xyz;
    offset += params.w * distance(world, light);
    point = world + (light - world) * bias; bias = 0.0;
  }
  let m = mat4x4f(frame.shadows[s], frame.shadows[s + 1u], frame.shadows[s + 2u], frame.shadows[s + 3u]);
  let p = m * vec4f(point + n * offset, 1.0);
  if (p.w <= 0.0) { return 1.0; }
  let ndc = p.xyz / p.w;
  let q = vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z * 0.5 + 0.5);
  if (any(q < vec3f(0.0)) || any(q > vec3f(1.0))) { return 1.0; }
  let texel = caster.z / size; var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      sum += shadow_sample(k, q.xy + vec2f(f32(x), f32(y)) * texel, q.z - bias);
    }
  }
  return sum / 9.0;
}
// A shadow slot reference (k + 1, 0 for none) as the light's visibility.
fn shadowed(reference: f32, world: vec3f, n: vec3f) -> f32 {
  let k = u32(reference + 0.5);
  if (k == 0u) { return 1.0; }
  return visibility(k - 1u, world, n);
}
struct ShadowVaryings { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) alpha: f32 };
@vertex fn shadow_vs(@location(0) position: vec3f, @location(2) uv: vec2f, @location(3) model0: vec4f, @location(4) model1: vec4f,
  @location(5) model2: vec4f, @location(6) tint: vec4f, @location(7) color: vec4f) -> ShadowVaryings {
  // A compact layout's vertex as vs reads it.
  let d = material.extra; let compact = d.w > 0.5;
  let p = select(position, position * d.x + vec3f(d.y), compact);
  let world = model0.xyz * p.x + model1.xyz * p.y + model2.xyz * p.z + vec3f(model0.w, model1.w, model2.w);
  var output: ShadowVaryings;
  // The shadow this pass renders (each shadow pass reads its own copy of the frame).
  let s = u32(frame.counts.z + 0.5) * 6u;
  let m = mat4x4f(frame.shadows[s], frame.shadows[s + 1u], frame.shadows[s + 2u], frame.shadows[s + 3u]);
  var clip = m * vec4f(world, 1.0);
  // Casters nearer the light than the map's depth range are flattened onto its near plane rather than clipped:
  // they still shadow what is in it (a vertex hook may place them anywhere, and unculled meshes add no bounds).
  clip.z = max((clip.z + clip.w) * 0.5, 0.0);
  let flags = u32(material.params.w);
  output.position = clip; output.uv = select(uv, vec2f(uv.x, 1.0 - uv.y) * d.z, compact); output.alpha = tint.a * select(1.0, shading_color(color).a, (flags & 4096u) != 0u); return output;
}
@fragment fn shadow_fs(input: ShadowVaryings) {
  let flags = u32(material.params.w);
  if ((flags & 8u) != 0u && material.base_color.a * input.alpha * textureSample(image, image_sampler, transformed(material.map0, material.map1, input.uv)).a < material.params.z) { discard; }
}
// The ambient occlusion prepass (three.js GTAOPass's MeshNormalMaterial override): view-space normals, normalized at each
// vertex and again per pixel, packed to 0..1 (frame.post[13..16] turns world normals into view space).
struct NormalVaryings { @builtin(position) position: vec4f, @location(0) normal: vec3f };
@vertex fn normal_vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(3) model0: vec4f, @location(4) model1: vec4f,
  @location(5) model2: vec4f) -> NormalVaryings {
  // A compact layout's vertex as vs reads it.
  let d = material.extra;
  let p = select(position, position * d.x + vec3f(d.y), d.w > 0.5);
  let c0 = model0.xyz; let c1 = model1.xyz; let c2 = model2.xyz;
  let world = c0 * p.x + c1 * p.y + c2 * p.z + vec3f(model0.w, model1.w, model2.w);
  let det = dot(c0, cross(c1, c2));
  let n = mat3x3f(cross(c1, c2), cross(c2, c0), cross(c0, c1)) * select(normal, vec3f(0.0, 1.0, 0.0), d.w > 1.5) * select(1.0, -1.0, det < 0.0);
  var output: NormalVaryings;
  output.normal = normalize(mat3x3f(frame.post[13].xyz, frame.post[14].xyz, frame.post[15].xyz) * n);
  var clip = frame.view_projection * vec4f(world, 1.0);
  clip.z = (clip.z + clip.w) * 0.5;
  output.position = clip; return output;
}
@fragment fn normal_fs(input: NormalVaryings) -> @location(0) vec4f { return vec4f(normalize(input.normal) * 0.5 + 0.5, 1.0); }
// The half vector of a light and view direction, the normal where they cancel (normalize(0) is NaN).
fn half_vector(l: vec3f, v: vec3f, n: vec3f) -> vec3f {
  let s = l + v; let k = dot(s, s);
  return select(n, s * inverseSqrt(max(k, 1e-30)), k > 1e-12);
}
// three.js's direct light on MeshStandardMaterial (RE_Direct_Physical): Lambert diffuse and BRDF_GGX (F_Schlick,
// V_GGX_SmithCorrelated, D_GGX) with saturated cosines, for a roughness already clamped as three.js clamps it (at least
// 0.0525, plus the geometry's); times n·l and π for the engine's light units. Finite for every direction, the light at
// the camera or the view grazing included.
fn brdf(n: vec3f, v: vec3f, l: vec3f, base: vec3f, metallic: f32, roughness: f32) -> vec3f {
  let h = half_vector(l, v, n);
  let nl = saturate1(dot(n, l)); let nv = saturate1(dot(n, v)); let nh = saturate1(dot(n, h)); let vh = saturate1(dot(v, h));
  let alpha = roughness * roughness; let a2 = alpha * alpha;
  let gv = nl * sqrt(a2 + (1.0 - a2) * nv * nv); let gl = nv * sqrt(a2 + (1.0 - a2) * nl * nl);
  let d = nh * nh * (a2 - 1.0) + 1.0;
  let f0 = mix(vec3f(0.04), base, metallic);
  let specular = schlick(f0, vh) * (0.5 / max(gv + gl, 1e-6) * a2 / (PI * d * d));
  let diffuse = (1.0 - metallic) * base / PI;
  return (diffuse + specular) * nl * PI;
}
// A light's reflection: the metallic-roughness BRDF, or for Lambert materials the diffuse part alone.
fn reflected(n: vec3f, v: vec3f, l: vec3f, base: vec3f, metallic: f32, roughness: f32, lambert: bool) -> vec3f {
  if (lambert) { return base * max(dot(n, l), 0.0); }
  return brdf(n, v, l, base, metallic, roughness);
}
// three.js's F_Schlick and clearcoat GGX (BRDF_GGX_Clearcoat), times π for the engine's light units.
fn schlick(f0: vec3f, vh: f32) -> vec3f { let f = exp2((-5.55473 * vh - 6.98316) * vh); return f0 * (1.0 - f) + vec3f(f); }
fn coat(n: vec3f, v: vec3f, l: vec3f, roughness: f32) -> vec3f {
  let alpha = roughness * roughness; let a2 = alpha * alpha;
  let h = half_vector(l, v, n);
  let nl = saturate1(dot(n, l)); let nv = saturate1(dot(n, v)); let nh = saturate1(dot(n, h)); let vh = saturate1(dot(v, h));
  let gv = nl * sqrt(a2 + (1.0 - a2) * nv * nv); let gl = nv * sqrt(a2 + (1.0 - a2) * nl * nl);
  let d = nh * nh * (a2 - 1.0) + 1.0;
  return schlick(vec3f(0.04), vh) * (0.5 / max(gv + gl, 1e-6) * a2 / (PI * d * d)) * nl * PI;
}
// three.js's DFGApprox: the split-sum environment BRDF's scale and bias.
fn dfg(nv: f32, roughness: f32) -> vec2f {
  let r = roughness * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}
// The environment's prefiltered light from a direction, at a roughness: a latitude-longitude image (three.js equirectUv, with
// v running down the image), level i filtered for roughness i / 6. The pass's environment turns by the frame's rotation first.
fn environment(d: vec3f, roughness: f32, scene: bool) -> vec3f {
  var dir = normalize(d);
  if (scene) { dir = normalize(mat3x3f(frame.env0.xyz, frame.env1.xyz, frame.env2.xyz) * dir); }
  let uv = vec2f(atan2(dir.z, dir.x) * 0.15915494 + 0.5, 0.5 - asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989);
  // Environments prefiltered as three.js r16x's PMREM (engine.minor 18) mark their last level with alpha 2: their level 5
  // (16 × 8 texels) holds roughness 1, so rough light is not read from the 8 × 4 level, and roughness 2/3 to 1 spans
  // levels 4 to 5.
  let pmrem = textureSampleLevel(environment_map, environment_sampler, vec2f(0.5), 6.0).a > 1.5;
  let lod = select(roughness * 6.0, min(roughness * 6.0, 4.0 + max(roughness - 0.6666667, 0.0) * 3.0), pmrem);
  return textureSampleLevel(environment_map, environment_sampler, uv, lod).rgb;
}
// three.js's perturbNormalArb (bumpmap_pars_fragment): the normal tilted by a height's screen-space slope (dHdxy_fwd's
// forward differences), facing as the front of the surface (lighting turns it for the back). A flip of the screen's y
// turns the derivatives, the cross products and the slope together, so every backend's orientation gives the same normal.
fn bumped(n: vec3f, q0: vec3f, q1: vec3f, dh: vec2f) -> vec3f {
  if (dot(q0, q0) == 0.0 || dot(q1, q1) == 0.0) { return n; }
  let sx = normalize(q0); let sy = normalize(q1);
  let r1 = cross(sy, n); let r2 = cross(n, sx);
  let det = dot(sx, r1);
  return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
}
// three.js's getTangentFrame applied to a tangent-space normal, with v pointing up the image (the engine's v runs down) and
// the sign of the screen frame's own determinant, so every backend's derivative orientation agrees.
fn perturb(n: vec3f, q0: vec3f, q1: vec3f, st0: vec2f, st1: vec2f, m: vec3f) -> vec3f {
  let q1perp = cross(q1, n); let q0perp = cross(n, q0);
  let t = q1perp * st0.x + q0perp * st1.x;
  let b = -(q1perp * st0.y + q0perp * st1.y);
  let det = max(dot(t, t), dot(b, b));
  let scale = select(inverseSqrt(det), 0.0, det == 0.0) * sign(dot(q0, q1perp));
  return normalize(t * (scale * m.x) + b * (scale * m.y) + n * m.z);
}
// The surface a fragment shows before light: what the material's maps and colors give, which custom materials' surface
// hooks change (the read-only rest describes the fragment). The normal is the shading normal in world space (normal map
// applied), facing the side the geometry's normal faces.
struct Surface { base_color: vec4f, emissive: vec3f, metalness: f32, roughness: f32, normal: vec3f, occlusion: f32,
  world: vec3f, uv: vec2f, color: vec4f, v0: vec4f, v1: vec4f, v2: vec4f, v3: vec4f, front: bool };
// A surface with what its lighting needs besides: the geometric normal and how fast it turns across the pixel.
struct Shading { surface: Surface, geometric: vec3f, geometry_roughness: f32 };
// The material's surface at a fragment. Every implicit-derivative sample and derivative is here, so callers call it first,
// in uniform control flow.
fn shading_of(world: vec3f, normal: vec3f, uv: vec2f, tint: vec4f, front: bool) -> Shading {
  let flags = u32(material.params.w);
  let texel = textureSample(image, image_sampler, transformed(material.map0, material.map1, uv));
  let glow = textureSample(emissive_map, emissive_sampler, transformed(material.glow0, material.glow1, uv));
  let normal_uv = transformed(material.normal0, material.normal1, uv);
  let bump = textureSample(normal_map, normal_sampler, normal_uv).xyz;
  let rough_texel = textureSample(roughness_map, roughness_sampler, transformed(material.rough0, material.rough1, uv));
  let metal_texel = textureSample(metalness_map, metalness_sampler, transformed(material.metal0, material.metal1, uv));
  let ao_texel = textureSample(occlusion_map, occlusion_sampler, transformed(material.ao0, material.ao1, uv));
  let q0 = dpdx(world); let q1 = dpdy(world);
  let st0 = dpdx(normal_uv); let st1 = dpdy(normal_uv);
  // Flat shading (three.js flatShading): the triangle's own normal from the position's screen-space derivatives,
  // facing the viewer as three.js's cross(dFdx, dFdy) of the view position does on every backend, and given here as the
  // side's front would face so that lighting's turn for the back keeps it toward the viewer. Lines keep their normals.
  let surface_bits = u32(material.map1.w + 0.5);
  let face = cross(q0, q1);
  let to_eye = select(-frame.forward.xyz, frame.camera.xyz - world, frame.viewport.z > 0.5);
  let facing = select(-face, face, dot(face, to_eye) >= 0.0) * inverseSqrt(max(dot(face, face), 1e-30));
  let flat = (surface_bits & 1u) != 0u && dot(face, face) > 0.0;
  let geometric = select(normalize(normal), select(-facing, facing, front), flat);
  let dxy = max(abs(dpdx(geometric)), abs(dpdy(geometric)));
  let lambert = (flags & 8192u) != 0u;
  var output: Shading;
  output.geometric = geometric;
  output.geometry_roughness = max(max(dxy.x, dxy.y), dxy.z);
  output.surface.base_color = material.base_color * tint * vec4f(decode(texel.rgb), texel.a);
  output.surface.emissive = material.emissive.rgb * decode(glow.rgb);
  output.surface.metalness = select(material.params.x * metal_texel.b, 0.0, lambert);
  output.surface.roughness = material.params.y * rough_texel.g;
  // The surface normal, perturbed by the normal map, or by the bump map in its place (its height in red, scaled by
  // bumpScale in the normal scale's x; sampled forward a pixel across and down at the same level of detail).
  var n = geometric;
  if ((flags & 16384u) != 0u && (surface_bits & 2u) != 0u) {
    let scale = material.normal0.w; let height = scale * bump.x;
    let across = scale * textureSampleGrad(normal_map, normal_sampler, normal_uv + st0, st0, st1).x - height;
    let down = scale * textureSampleGrad(normal_map, normal_sampler, normal_uv + st1, st0, st1).x - height;
    n = bumped(geometric, q0, q1, vec2f(across, down));
  } else if ((flags & 16384u) != 0u) {
    n = perturb(geometric, q0, q1, st0, st1, vec3f((bump.xy * 2.0 - 1.0) * vec2f(material.normal0.w, material.normal1.w), bump.z * 2.0 - 1.0));
  }
  output.surface.normal = n;
  // Ambient occlusion darkens indirect light (three.js aoMap: red channel, eased by its intensity).
  output.surface.occlusion = (ao_texel.r - 1.0) * material.rough0.w + 1.0;
  output.surface.world = world; output.surface.uv = uv; output.surface.color = tint; output.surface.front = front;
  output.surface.v0 = vec4f(0.0); output.surface.v1 = vec4f(0.0); output.surface.v2 = vec4f(0.0); output.surface.v3 = vec4f(0.0);
  return output;
}
// Fog by view depth and the output: smooth from near to far (1) or exponential squared (2), mixed in encoded color toward
// the encoded fog color as clear colors are, or in linear color before a post-effect composite's tone mapping; opaque
// unless blended.
fn finish(color: vec3f, alpha: f32, world: vec3f, premultiply: bool) -> vec4f {
  return finish_fogged(color, alpha, premultiply, frame.fog_color.xyz, decode(frame.fog_color.xyz), fog_amount(world));
}
// The frame's fog at a point (0 none, 1 full), none for materials without fog (512).
fn fog_amount(world: vec3f) -> f32 {
  let flags = u32(material.params.w);
  let fog = u32(frame.fog_color.w + 0.5);
  var amount = 0.0;
  if (fog != 0u && (flags & 512u) == 0u) {
    let depth = dot(world - frame.camera.xyz, frame.forward.xyz);
    amount = ease((depth - frame.fog.x) / max(frame.fog.y - frame.fog.x, 1e-4));
    if (fog == 2u) { let e = frame.fog.z * depth; amount = 1.0 - exp(-e * e); }
  }
  return amount;
}
// A color fogged toward a fog color (encoded for display, linear for the composite) by an amount, and output.
fn finish_fogged(color: vec3f, alpha: f32, premultiply: bool, fog_shown: vec3f, fog_linear: vec3f, amount: f32) -> vec4f {
  let flags = u32(material.params.w);
  // Light as half floats hold it: NaN (and anything below zero) as none, infinity as the largest, so no pixel a hook or
  // a degenerate input makes non-finite reaches the effects or the screen.
  let light = select(vec3f(0.0), min(color, vec3f(65504.0)), color >= vec3f(0.0));
  var result = vec3f(0.0);
  if (frame.output.z > 0.5) {
    result = mix(light, fog_linear, amount);
  } else {
    // Materials that are not tone mapped (1048576) keep their color, clamped to the display's range.
    let mode = select(u32(frame.output.x + 0.5), 0u, (flags & 1048576u) != 0u);
    result = mix(encode(tone(light, mode, frame.output.y)), fog_shown, amount);
  }
  // Blended (16, 32, 4194304, 8388608) output keeps its alpha; premultiplied blending (4194304) takes color times
  // alpha, which a material's surface gives straight.
  let blended = (flags & 12582960u) != 0u;
  let premultiplied = premultiply && (flags & 4194304u) != 0u;
  return vec4f(select(result, result * alpha, premultiplied), select(1.0, alpha, blended));
}
// The scene-depth prepass's output (output mode 2): the surface's view depth, along the camera's forward axis.
fn depth_out(world: vec3f) -> vec4f { return vec4f(dot(world - frame.camera.xyz, frame.forward.xyz), 0.0, 0.0, 1.0); }
// The light a lit surface reflects, by kind, which custom materials' light hooks change (fn light(l: Light) -> Light; the
// read-only rest describes the fragment): the primary light's (sun, unshadowed) and its shadow (1 lit, 0 shadowed); the other
// lights' (direct, their shadows applied); ambient, hemisphere and environment light (indirect, ambient occlusion applied); and
// the emissive light. The color is sun × shadow + direct + indirect + emissive (under a clearcoat's Fresnel).
struct Light { sun: vec3f, shadow: f32, direct: vec3f, indirect: vec3f, emissive: vec3f, sun_direction: vec3f, sun_color: vec3f,
  ambient: vec3f, world: vec3f, normal: vec3f, uv: vec2f, base_color: vec4f, v0: vec4f, v1: vec4f, v2: vec4f, v3: vec4f };
// A lit surface's light with its clearcoat: the coat's own light, its strength and its Fresnel over the rest.
struct Lit { light: Light, coating: vec3f, clearcoat: f32, coat_fresnel: vec3f };
// The lights, shadows and environment on a lit surface.
fn lighting(s: Surface, geometric: vec3f, geometry_roughness: f32) -> Lit {
  let flags = u32(material.params.w);
  let base = s.base_color;
  let lambert = (flags & 8192u) != 0u;
  var n = s.normal;
  var coat_n = geometric;
  if (!s.front) {
    // Seen from behind: double sides reverse the whole perturbed normal; back sides (three.js FLIP_SIDED) keep the
    // tangent frame and turn only the height, mirroring the normal through the surface, except a bump map's, which
    // three.js's perturbNormalArb reverses whole there too.
    let mirrored = (flags & 64u) != 0u && (u32(material.map1.w + 0.5) & 2u) == 0u;
    n = select(-n, n - 2.0 * dot(n, geometric) * geometric, mirrored); coat_n = -coat_n;
  }
  // The view direction (the normal for a point at the camera itself); direct light takes three.js's clamped
  // roughness, as image-based light does.
  let to_camera = frame.camera.xyz - s.world;
  let v = select(n, to_camera * inverseSqrt(max(dot(to_camera, to_camera), 1e-30)), dot(to_camera, to_camera) > 1e-12);
  let metallic = s.metalness;
  let roughness = s.roughness;
  let direct_roughness = min(max(roughness, 0.0525) + geometry_roughness, 1.0);
  let clearcoat = select(material.rough1.w, 0.0, lambert);
  let coat_roughness = min(max(material.metal0.w, 0.0525) + geometry_roughness, 1.0);
  let receives = (flags & 2048u) == 0u;
  var out: Lit;
  out.clearcoat = clearcoat;
  out.coating = vec3f(0.0);
  out.coat_fresnel = vec3f(0.0);
  out.light.world = s.world; out.light.normal = n; out.light.uv = s.uv; out.light.base_color = base;
  out.light.v0 = s.v0; out.light.v1 = s.v1; out.light.v2 = s.v2; out.light.v3 = s.v3;
  // The primary light.
  var l = normalize(-frame.light_direction.xyz);
  out.light.sun_direction = l; out.light.sun_color = frame.light_color.xyz; out.light.ambient = frame.ambient.xyz;
  var reach = 1.0;
  if (receives) { reach = shadowed(frame.light_direction.w, s.world, n); }
  out.light.shadow = reach;
  out.light.sun = reflected(n, v, l, base.rgb, metallic, direct_roughness, lambert) * frame.light_color.xyz;
  if (clearcoat > 0.0) { out.coating += coat(coat_n, v, l, coat_roughness) * frame.light_color.xyz * reach; }
  var direct = vec3f(0.0);
  var indirect = frame.ambient.xyz * base.rgb;
  let count = u32(frame.counts.x);
  for (var i = 0u; i < count; i++) {
    let p = frame.lights[i * 4u]; let c = frame.lights[i * 4u + 1u]; let sp = frame.lights[i * 4u + 2u]; let cone = frame.lights[i * 4u + 3u];
    let kind = u32(p.w + 0.5);
    if (kind == 3u) {
      // Hemisphere: the ground color facing away from up, the sky color facing it.
      indirect += mix(sp.xyz, c.xyz, 0.5 * dot(n, normalize(p.xyz)) + 0.5) * base.rgb;
      continue;
    }
    l = normalize(-p.xyz); var attenuation = 1.0;
    if (kind != 0u) {
      // Point and spot lights: distance decay (inverse square for 2), faded to zero at the range by three.js's window
      // (getDistanceAttenuation: the square of 1 - (d / range)^4), and a spot's cone.
      let d = p.xyz - s.world; let dist = max(length(d), 1e-4); l = d / dist;
      attenuation = 1.0 / max(pow(dist, sp.w), 0.01);
      if (c.w > 0.0) { let r = dist / c.w; let window = clamp(1.0 - r * r * r * r, 0.0, 1.0); attenuation *= window * window; }
      if (kind == 2u) { attenuation *= ease((dot(-l, normalize(sp.xyz)) - cone.x) / max(cone.y - cone.x, 1e-4)); }
    }
    if (receives) { attenuation *= shadowed(cone.z, s.world, n); }
    direct += reflected(n, v, l, base.rgb, metallic, direct_roughness, lambert) * c.rgb * attenuation;
    if (clearcoat > 0.0) { out.coating += coat(coat_n, v, l, coat_roughness) * c.rgb * attenuation; }
  }
  let occlusion = s.occlusion;
  indirect = indirect * occlusion;
  if ((flags & 32768u) != 0u && lambert) {
    // Lambert takes the environment's diffuse light only: irradiance from the roughest level along the normal.
    let scene = (flags & 65536u) != 0u;
    indirect += base.rgb * environment(n, 1.0, scene) * material.metal1.w * occlusion;
  }
  if ((flags & 32768u) != 0u && !lambert) {
    // Image-based light as three.js's MeshStandardMaterial: irradiance from the roughest level along the normal, radiance
    // along the reflection, the split-sum BRDF with multiple scattering, specular occlusion from the ambient occlusion.
    let scene = (flags & 65536u) != 0u;
    let intensity = material.metal1.w;
    let r = min(max(roughness, 0.0525) + geometry_roughness, 1.0);
    let irradiance = environment(n, 1.0, scene) * intensity;
    let radiance = environment(mix(reflect(-v, n), n, r * r), r, scene) * intensity;
    let nv = saturate1(dot(n, v));
    let fab = dfg(nv, r);
    let f0 = mix(vec3f(0.04), base.rgb, metallic);
    let single = f0 * fab.x + fab.y;
    let ems = 1.0 - (fab.x + fab.y);
    let favg = f0 + (1.0 - f0) * 0.047619;
    let multi = single * favg / (1.0 - ems * favg) * ems;
    let total = single + multi;
    indirect += base.rgb * (1.0 - metallic) * (1.0 - max(total.r, max(total.g, total.b))) * irradiance * occlusion;
    let specular_occlusion = saturate1(pow(nv + occlusion, exp2(-16.0 * r - 1.0)) - 1.0 + occlusion);
    indirect += (radiance * single + multi * irradiance) * specular_occlusion;
    if (clearcoat > 0.0) {
      let coat_radiance = environment(mix(reflect(-v, coat_n), coat_n, coat_roughness * coat_roughness), coat_roughness, scene) * intensity;
      let coat_fab = dfg(saturate1(dot(coat_n, v)), coat_roughness);
      out.coating += coat_radiance * (0.04 * coat_fab.x + coat_fab.y) * occlusion;
    }
  }
  out.light.direct = direct;
  out.light.indirect = indirect;
  out.light.emissive = s.emissive;
  // The coat's Fresnel dims what lies beneath it (three.js MeshPhysicalMaterial clearcoat).
  if (clearcoat > 0.0) { out.coat_fresnel = schlick(vec3f(0.04), saturate1(dot(coat_n, v))); }
  return out;
}
// A lit surface's color from its light.
fn lit_color(l: Lit) -> vec3f {
  let color = l.light.sun * l.light.shadow + l.light.direct + l.light.indirect + l.light.emissive;
  if (l.clearcoat > 0.0) { return color * (1.0 - l.clearcoat * l.coat_fresnel) + l.coating * l.clearcoat; }
  return color;
}
// A surface lit: the alpha cutoff, the lights, shadows and environment, then fog and the output.
fn shade(s: Surface, geometric: vec3f, geometry_roughness: f32) -> vec4f {
  let flags = u32(material.params.w);
  if ((flags & 8u) != 0u && s.base_color.a < material.params.z) { discard; }
  if (frame.output.z > 1.5) { return depth_out(s.world); }
  if (material.glow1.w > 0.5) {
    // A shadow catcher (three.js ShadowMaterial; starhermit_sys::MESH_SHADOW_CATCHER): its color at its alpha times how
    // shadowed it is, every shadow map's light multiplied (none received: unshadowed).
    var reach = 1.0;
    if ((flags & 2048u) == 0u) {
      let shadows = u32(frame.counts.y + 0.5);
      for (var k = 0u; k < shadows; k++) { reach *= visibility(k, s.world, geometric); }
    }
    return finish(s.base_color.rgb, s.base_color.a * (1.0 - reach), s.world, true);
  }
  var color = s.base_color.rgb + s.emissive;
  if ((flags & 1u) == 0u) { color = lit_color(lighting(s, geometric, geometry_roughness)); }
  return finish(color, s.base_color.a, s.world, true);
}
// A cube sky's face (the first six texture slots, +X, -X, +Y, -Y, +Z, -Z) along a direction, chosen as OpenGL chooses it,
// t running down the image.
fn cube_sky(d: vec3f) -> vec3f {
  let a = abs(d);
  if (a.x >= a.y && a.x >= a.z) {
    let st = vec2f(select(d.z, -d.z, d.x > 0.0), -d.y) / a.x * 0.5 + 0.5;
    if (d.x > 0.0) { return textureSampleLevel(image, image_sampler, st, 0.0).rgb; }
    return textureSampleLevel(emissive_map, emissive_sampler, st, 0.0).rgb;
  }
  if (a.y >= a.z) {
    let st = vec2f(d.x, select(-d.z, d.z, d.y > 0.0)) / a.y * 0.5 + 0.5;
    if (d.y > 0.0) { return textureSampleLevel(normal_map, normal_sampler, st, 0.0).rgb; }
    return textureSampleLevel(roughness_map, roughness_sampler, st, 0.0).rgb;
  }
  let st = vec2f(select(-d.x, d.x, d.z > 0.0), -d.y) / a.z * 0.5 + 0.5;
  if (d.z > 0.0) { return textureSampleLevel(metalness_map, metalness_sampler, st, 0.0).rgb; }
  return textureSampleLevel(occlusion_map, occlusion_sampler, st, 0.0).rgb;
}
// A scene background (three.js WebGLBackground; starhermit_sys::MESH_BACKGROUND): 1 a texture over the view through the
// base transform, 2 a latitude-longitude sky, 3 a cube sky (mirrored in X, as three.js's flipEnvMap). A sky turns the view
// direction by its rotation (normal0, normal1, rough0) and, blurred (the roughness, three.js backgroundBlurriness) or
// without its own image, shows the prefiltered environment at that roughness; a latitude-longitude image's light past 1
// (clamped in the image) comes from the environment. Times the intensity, not fogged, tone mapped unless flagged.
fn background(world: vec3f, uv: vec2f) -> vec4f {
  let kind = u32(material.ao1.w + 0.5);
  var color = vec3f(0.0);
  if (kind == 1u) {
    color = decode(textureSample(image, image_sampler, transformed(material.map0, material.map1, uv)).rgb);
  } else {
    let dir = normalize(mat3x3f(material.normal0.xyz, material.normal1.xyz, material.rough0.xyz) * world);
    let bound = u32(material.emissive.x + 0.5);
    let sharp = (bound & 1u) != 0u; let prefiltered = (bound & 2u) != 0u;
    let blur = material.params.y;
    if (prefiltered && (blur > 0.0 || !sharp)) {
      color = environment(dir, blur, false);
    } else if (kind == 2u) {
      let at = vec2f(atan2(dir.z, dir.x) * 0.15915494 + 0.5, 0.5 - asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989);
      color = decode(textureSampleLevel(image, image_sampler, at, 0.0).rgb);
      if (prefiltered) { color = select(color, max(color, environment(dir, 0.0, false)), color >= vec3f(0.999)); }
    } else {
      color = decode(cube_sky(vec3f(-dir.x, dir.y, dir.z)));
    }
  }
  return finish_fogged(color * material.base_color.rgb, 1.0, false, vec3f(0.0), vec3f(0.0), 0.0);
}
@fragment fn fs(input: Varyings, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (material.ao1.w > 0.5) { return background(input.world, input.uv); }
  let shading = shading_of(input.world, input.normal, input.uv, input.tint, front);
  return shade(shading.surface, shading.geometric, shading.geometry_roughness);
}`;
// Custom materials' stages (spec/rendering-and-quality.html, "Custom materials"): MESH_WGSL, the game's uniforms and
// textures, its WGSL and these, as one module. A game's vertex hook changes a vertex in object space (and may place it in
// clip space itself, w not 0); its surface hook changes a lit material's surface before light, and a custom material's
// fragment function gives the fragment's linear color. Vertex colors (4096) and the geometry's custom attribute (2097152)
// read as white and zero on meshes without them; the instance's color and the vertex's own (instance_color, vertex_color)
// read-only, their product in color.
const MESH_HOOK_WGSL = `struct Vertex { position: vec3f, normal: vec3f, uv: vec2f, color: vec4f, custom: vec4f, instance: vec4f, clip: vec4f,
  v0: vec4f, v1: vec4f, v2: vec4f, v3: vec4f, instance_color: vec4f, vertex_color: vec4f, instance1: vec4f, instance2: vec4f,
  instance3: vec4f };
struct Fragment { world: vec3f, normal: vec3f, uv: vec2f, color: vec4f, v0: vec4f, v1: vec4f, v2: vec4f, v3: vec4f, front: bool,
  coord: vec4f };
struct HookVaryings { @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f,
  @location(3) tint: vec4f, @location(4) v0: vec4f, @location(5) v1: vec4f, @location(6) v2: vec4f, @location(7) v3: vec4f };
// An instance's custom data (vertex attributes 9 to 12).
struct Instance { slot0: vec4f, slot1: vec4f, slot2: vec4f, slot3: vec4f };
// The fog on a fragment, which custom materials' fog hooks change (fn fog(f: Fog) -> Fog): its linear color and amount (0
// none, 1 full; the scene's fog's, else black and 0), and, read-only, where the fragment is (world position, view depth,
// window position) and the camera's position.
struct Fog { color: vec3f, amount: f32, world: vec3f, depth: f32, coord: vec4f, camera: vec3f };
var<private> hook_model: mat4x4f;
var<private> hook_vertex: u32;
// What a game's code may read besides its arguments, uniforms and textures.
fn model_matrix() -> mat4x4f { return hook_model; }
fn vertex_index() -> u32 { return hook_vertex; }
fn view_projection() -> mat4x4f { return frame.view_projection; }
fn camera_position() -> vec3f { return frame.camera.xyz; }
fn viewport_size() -> vec2f { return frame.viewport.xy; }
// A fragment's view depth (distance along the camera's forward axis) and its window position as texture coordinates
// (0..1 from the top left), for reading the scene's depth texture.
fn view_depth(world: vec3f) -> f32 { return dot(world - frame.camera.xyz, frame.forward.xyz); }
fn screen_uv(coord: vec4f) -> vec2f { return coord.xy / frame.viewport.xy; }
fn srgb_to_linear(c: vec3f) -> vec3f { return decode(c); }
fn linear_to_srgb(c: vec3f) -> vec3f { return encode(c); }
// A vertex through the game's hook to world space, with the world normal and, unless the hook placed it, its clip position
// by the given view-projection; clip depth then runs 0..1.
fn hooked(position: vec3f, normal: vec3f, uv: vec2f, model0: vec4f, model1: vec4f, model2: vec4f, tint: vec4f, color: vec4f,
  custom: vec4f, instance: Instance, index: u32, projection: mat4x4f, placed: bool) -> HookVaryings {
  let flags = u32(material.params.w);
  hook_model = mat4x4f(vec4f(model0.xyz, 0.0), vec4f(model1.xyz, 0.0), vec4f(model2.xyz, 0.0), vec4f(model0.w, model1.w, model2.w, 1.0));
  hook_vertex = index;
  var v: Vertex;
  // A compact layout's vertex as vs reads it.
  let d = material.extra; let compact = d.w > 0.5;
  v.position = select(position, position * d.x + vec3f(d.y), compact);
  v.normal = select(normal, vec3f(0.0, 1.0, 0.0), d.w > 1.5);
  v.uv = select(uv, vec2f(uv.x, 1.0 - uv.y) * d.z, compact);
  v.instance_color = tint; v.vertex_color = select(vec4f(1.0), color, (flags & 4096u) != 0u);
  v.color = v.instance_color * shading_color(v.vertex_color);
  v.custom = select(vec4f(0.0), custom, (flags & 2097152u) != 0u);
  v.instance = instance.slot0; v.instance1 = instance.slot1; v.instance2 = instance.slot2; v.instance3 = instance.slot3;
  v.clip = vec4f(0.0);
  v.v0 = vec4f(0.0); v.v1 = vec4f(0.0); v.v2 = vec4f(0.0); v.v3 = vec4f(0.0);
  v = vertex(v);
  let c0 = model0.xyz; let c1 = model1.xyz; let c2 = model2.xyz;
  var output: HookVaryings;
  output.world = c0 * v.position.x + c1 * v.position.y + c2 * v.position.z + vec3f(model0.w, model1.w, model2.w);
  let det = dot(c0, cross(c1, c2));
  output.normal = mat3x3f(cross(c1, c2), cross(c2, c0), cross(c0, c1)) * v.normal * select(1.0, -1.0, det < 0.0);
  output.uv = v.uv; output.tint = v.color;
  output.v0 = v.v0; output.v1 = v.v1; output.v2 = v.v2; output.v3 = v.v3;
  var clip = projection * vec4f(output.world, 1.0);
  if (placed && v.clip.w != 0.0) { clip = v.clip; }
  clip.z = (clip.z + clip.w) * 0.5;
  output.position = clip;
  return output;
}
@vertex fn hook_vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) model0: vec4f,
  @location(4) model1: vec4f, @location(5) model2: vec4f, @location(6) tint: vec4f, @location(7) color: vec4f, @location(8) custom: vec4f,
  @location(9) instance0: vec4f, @location(10) instance1: vec4f, @location(11) instance2: vec4f, @location(12) instance3: vec4f,
  @builtin(vertex_index) index: u32) -> HookVaryings {
  return hooked(position, normal, uv, model0, model1, model2, tint, color, custom, Instance(instance0, instance1, instance2, instance3), index, frame.view_projection, true);
}
// The shadow pass: the same vertices seen from the light this pass renders.
@vertex fn hook_shadow_vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) model0: vec4f,
  @location(4) model1: vec4f, @location(5) model2: vec4f, @location(6) tint: vec4f, @location(7) color: vec4f, @location(8) custom: vec4f,
  @location(9) instance0: vec4f, @location(10) instance1: vec4f, @location(11) instance2: vec4f, @location(12) instance3: vec4f,
  @builtin(vertex_index) index: u32) -> HookVaryings {
  let s = u32(frame.counts.z + 0.5) * 6u;
  let m = mat4x4f(frame.shadows[s], frame.shadows[s + 1u], frame.shadows[s + 2u], frame.shadows[s + 3u]);
  var output = hooked(position, normal, uv, model0, model1, model2, tint, color, custom, Instance(instance0, instance1, instance2, instance3), index, m, false);
  // Flattened onto the near plane rather than clipped, as shadow_vs does.
  output.position.z = max(output.position.z, 0.0);
  return output;
}
// The ambient occlusion prepass's normals of hooked vertices.
@vertex fn hook_normal_vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) model0: vec4f,
  @location(4) model1: vec4f, @location(5) model2: vec4f, @location(6) tint: vec4f, @location(7) color: vec4f, @location(8) custom: vec4f,
  @location(9) instance0: vec4f, @location(10) instance1: vec4f, @location(11) instance2: vec4f, @location(12) instance3: vec4f,
  @builtin(vertex_index) index: u32) -> NormalVaryings {
  let h = hooked(position, normal, uv, model0, model1, model2, tint, color, custom, Instance(instance0, instance1, instance2, instance3), index, frame.view_projection, true);
  var output: NormalVaryings;
  output.normal = normalize(mat3x3f(frame.post[13].xyz, frame.post[14].xyz, frame.post[15].xyz) * h.normal);
  output.position = h.position;
  return output;
}
// A lit material's surface through the game's hook.
fn hooked_surface(input: HookVaryings, front: bool) -> Shading {
  var shading = shading_of(input.world, input.normal, input.uv, input.tint, front);
  shading.surface.v0 = input.v0; shading.surface.v1 = input.v1; shading.surface.v2 = input.v2; shading.surface.v3 = input.v3;
  shading.surface = surface(shading.surface);
  return shading;
}
// A fragment's color fogged through the game's fog hook (unless the material has no fog) and output.
fn hook_finish(color: vec3f, alpha: f32, world: vec3f, coord: vec4f, premultiply: bool) -> vec4f {
  let flags = u32(material.params.w);
  if ((flags & 512u) != 0u) { return finish(color, alpha, world, premultiply); }
  var f: Fog;
  f.color = select(vec3f(0.0), decode(frame.fog_color.xyz), frame.fog_color.w > 0.5); f.amount = fog_amount(world);
  f.world = world; f.depth = view_depth(world); f.coord = coord; f.camera = frame.camera.xyz;
  // A window that counts rows from the bottom (output.w 1: OpenGL's) is turned to count them from the top.
  if (frame.output.w > 0.5) { f.coord.y = frame.viewport.y - coord.y; }
  f = fog(f);
  let shown = clamp(f.color, vec3f(0.0), vec3f(65504.0));
  return finish_fogged(color, alpha, premultiply, encode(shown), shown, clamp(f.amount, 0.0, 1.0));
}
// A hooked surface lit, its light through the game's light hook.
fn hook_shade(s: Surface, geometric: vec3f, geometry_roughness: f32, coord: vec4f) -> vec4f {
  let flags = u32(material.params.w);
  if ((flags & 8u) != 0u && s.base_color.a < material.params.z) { discard; }
  if (frame.output.z > 1.5) { return depth_out(s.world); }
  var color = s.base_color.rgb + s.emissive;
  if ((flags & 1u) == 0u) {
    var lit = lighting(s, geometric, geometry_roughness);
    lit.light = light(lit.light);
    color = lit_color(lit);
  }
  return hook_finish(color, s.base_color.a, s.world, coord, true);
}
@fragment fn hook_fs(input: HookVaryings, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let shading = hooked_surface(input, front);
  return hook_shade(shading.surface, shading.geometric, shading.geometry_roughness, input.position);
}
// Depth only, past the alpha cutoff of the hooked surface (whose hook may also discard).
@fragment fn hook_shadow_fs(input: HookVaryings, @builtin(front_facing) front: bool) {
  let flags = u32(material.params.w);
  let shading = hooked_surface(input, front);
  if ((flags & 8u) != 0u && shading.surface.base_color.a < material.params.z) { discard; }
}
// A custom material's fragment: the game's linear color, fogged and output as the material says.
@fragment fn custom_fs(input: HookVaryings, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  var f: Fragment;
  f.world = input.world; f.normal = normalize(input.normal); f.uv = input.uv; f.color = input.tint;
  f.v0 = input.v0; f.v1 = input.v1; f.v2 = input.v2; f.v3 = input.v3; f.front = front; f.coord = input.position;
  // A window that counts rows from the bottom (output.w 1: OpenGL's) is turned to count them from the top.
  if (frame.output.w > 0.5) { f.coord.y = frame.viewport.y - input.position.y; }
  let color = fragment(f);
  let flags = u32(material.params.w);
  if ((flags & 8u) != 0u && color.a < material.params.z) { discard; }
  if (frame.output.z > 1.5) { return depth_out(input.world); }
  // A custom material's color is premultiplied as it is given.
  return hook_finish(color.rgb, color.a, input.world, input.position, false);
}`;
// Kept instance buffers: starhermit_sys MAX_INSTANCE_BUFFERS and MAX_KEPT_INSTANCES.
// Meshes below 65,536 vertices upload 16-bit indices (starhermit_sys NARROW_INDEX_VERTICES: their largest, 65,534, is
// never the restart index 65,535 WebGL2 always honours), larger ones 32-bit; the bytes their indices count, in whole
// 4 bytes (starhermit_sys::mesh_index_bytes), as WebGPU writes buffers.
const NARROW_INDEX_VERTICES = 65536;
function padded(indices) { const out = new Uint16Array(indices.length + 1); out.set(indices); return out; }
function meshIndexBytes(vertexCount, indexCount) { return vertexCount < NARROW_INDEX_VERTICES ? Math.ceil(indexCount / 2) * 4 : indexCount * 4; }
const MESH_LIMITS = {vertices: 1 << 20, indices: 3 << 20, meshes: MAX_MESHES, bytes: MAX_MESH_BYTES, instances: 65536, batches: 16384, instanceBuffers: 4096, keptInstances: 1 << 20};
// Every value of a typed array finite (NaN and infinities are not: x - x is 0 only for finite x). Plain loops: a
// pass's instances and the overlay's vertices are checked every frame, and a callback per value would cost more
// than the drawing.
function finite(values, from = 0, to = values.length) {
  for (let i = from; i < to; i++) { const v = values[i]; if (v - v !== 0) return false; }
  return true;
}
function indicesBelow(indices, count) {
  for (let i = 0; i < indices.length; i++) if (indices[i] >= count) return false;
  return true;
}
// An RGBA multiplier (instance or vertex color): color 0..65504, alpha 0..1.
// A mesh's vertices as starhermit_sys::MeshData::validate checks them: `count` vertices of `layout` (a float layout's as
// a Float32Array, any layout's as bytes; the count follows from them unless the layout has no attributes), finite floats,
// and its indices naming them in whole triangles, or none (host API 1.15) to draw them in order, three a triangle; a
// layout code with MESH_LINE_CODE (host API 1.17) is a line mesh's, two vertices a segment.
function validateMesh(vertices, indices, layout = 0, count = undefined) {
  layout = meshLayout(layout);
  const lines = typeof layout === 'number' && (layout & MESH_LINE_CODE) !== 0;
  const info = meshLayoutInfo(lines ? layout & ~MESH_LINE_CODE : layout);
  if (!info || !(vertices instanceof Float32Array || vertices instanceof Uint8Array) || (vertices instanceof Float32Array && !info.float)
      || !(indices instanceof Uint32Array || indices instanceof Uint16Array)) throw new Error('Invalid mesh data');
  const bytes = vertexBytes(vertices);
  count ??= info.stride ? bytes.length / info.stride : 0;
  if (!Number.isInteger(count) || count < 1 || count > MESH_LIMITS.vertices || bytes.length !== count * info.stride || (indices.length ? indices.length : count) % (lines ? 2 : 3)
      || indices.length > MESH_LIMITS.indices || (info.empty && indices.length) || !indicesBelow(indices, count)) throw new Error('Invalid mesh data');
  // Floats are finite: vertex colors may be any finite values (shading clamps them; custom materials read them as they are).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const a of info.attributes) {
    if (a.format !== 'float32') continue;
    for (let at = a.offset; at < bytes.length; at += info.stride) for (let k = 0; k < a.components; k++) if (!Number.isFinite(view.getFloat32(at + 4 * k, true))) throw new Error('Invalid mesh data');
  }
  return count;
}
// Whether the frame's environment rotation is orthonormal within 1e-3 (starhermit_sys::frame::ROTATION_TOLERANCE).
function rotation(f) {
  const column = c => f.subarray(FRAME.environment + 4 * c, FRAME.environment + 4 * c + 3);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const a = column(i), b = column(j), dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-3) return false;
  }
  return true;
}
// The frame as starhermit_sys::valid_frame checks it. Lengths whose squares sum to at least 1e-12 can be normalized.
const normalizable = values => { let sum = 0; for (const v of values) sum += v * v; return sum >= 1e-12; };
function validFrame(f) {
  const whole = Number.isInteger, color = v => v >= 0 && v <= MAX_COLOR;
  const colors = (from, to) => f.subarray(from, to).every(color), nonNegative = (from, to) => f.subarray(from, to).every(v => v >= 0);
  const count = f[FRAME.counts], shadows = f[FRAME.counts + 1];
  if (!whole(count) || count < 0 || count > MAX_LIGHTS || !whole(shadows) || shadows < 0 || shadows > MAX_SHADOWS
      || f[SHADOW_PASS] !== 0 || f[FRAME.counts + 3] !== 0) return false;
  // The primary light travels somewhere; colors are non-negative.
  if (!normalizable(f.subarray(FRAME.direction, FRAME.direction + 3)) || !colors(FRAME.color, FRAME.color + 3) || !colors(FRAME.ambient, FRAME.ambient + 3)
      || [FRAME.camera, FRAME.forward, FRAME.color, FRAME.ambient].some(at => f[at + 3] !== 0)) return false;
  // Output: a known tone mapping, a non-negative exposure, display encoding (backends switch to linear themselves).
  const tone = f[FRAME.output];
  if (!whole(tone) || tone < 0 || tone > 6 || !color(f[FRAME.output + 1]) || f[FRAME.output + 2] !== 0 || f[FRAME.output + 3] !== 0) return false;
  // Shadows: whole sizes 64..4096 with non-negative biases, each cast by the primary light or an extra directional or
  // spot light that refers back to it, one per light; unused slots zero.
  const casters = [];
  for (let k = 0; k < MAX_SHADOWS; k++) {
    const s = f.subarray(FRAME.shadows + k * SHADOW_LENGTH, FRAME.shadows + (k + 1) * SHADOW_LENGTH);
    if (k >= shadows) { if (s.some(v => v !== 0)) return false; continue; }
    const size = s[SHADOW.size], caster = s[SHADOW.caster];
    if (!(whole(size) && size >= 64 && size <= 4096) || !s.subarray(SHADOW.bias, SHADOW.offsetScale + 1).every(v => v >= 0) || !whole(caster)
        || caster < 0 || caster > count || casters.includes(caster) || !(s[SHADOW.radius] >= 0 && s[SHADOW.radius] <= MAX_SHADOW_RADIUS) || s[23] !== 0) return false;
    casters.push(caster);
    const light = FRAME.lights + (caster - 1) * 16, [kind, reference] = caster > 0 ? [f[light + 3], f[light + 14]] : [0, f[FRAME.direction + 3]];
    const perspective = kind === 2 ? 1 : 0;
    if ((kind !== 0 && kind !== 2) || s[SHADOW.perspective] !== perspective || (perspective === 0 && s[SHADOW.offsetScale] !== 0) || reference !== k + 1) return false;
  }
  // Every shadow a light names is one that names it back.
  const namesBack = (reference, caster) => reference === 0
    || (whole(reference) && reference >= 1 && reference <= shadows && f[FRAME.shadows + (reference - 1) * SHADOW_LENGTH + SHADOW.caster] === caster);
  if (!namesBack(f[FRAME.direction + 3], 0)) return false;
  // Fog: off, smooth from near to far (far beyond near) or exponential squared, with a 0..1 color.
  const mode = f[FRAME.fogColor + 3];
  if (![0, 1, 2].includes(mode) || f.subarray(FRAME.fogColor, FRAME.fogColor + 3).some(v => !(v >= 0 && v <= 1))
      || !Number.isFinite(f[FRAME.fog]) || !Number.isFinite(f[FRAME.fog + 1]) || !nonNegative(FRAME.fog + 2, FRAME.fog + 3) || f[FRAME.fog + 3] !== 0
      || (mode === 1 && f[FRAME.fog + 1] <= f[FRAME.fog])) return false;
  // Post effects: a whole sample count up to 8, a known anti-aliasing, a non-negative threshold and strength, and the
  // post block.
  const [samples, antiAliasing, threshold, strength] = f.subarray(FRAME.effects, FRAME.effects + 4);
  if (!whole(samples) || samples < 0 || samples > 8 || ![0, 1, 2].includes(antiAliasing) || !color(threshold) || !color(strength) || !validPost(f)) return false;
  // The environment rotation: padding zero, columns orthonormal or all zero. The viewport: whole sizes, a perspective
  // switch and the point size cap.
  const [width, height, perspective, points] = f.subarray(FRAME.viewport, FRAME.viewport + 4);
  if (![FRAME.environment + 3, FRAME.environment + 7, FRAME.environment + 11].every(at => f[at] === 0)
      || !(f.subarray(FRAME.environment, FRAME.environment + 12).every(v => v === 0) || rotation(f))
      || !whole(width) || !whole(height) || width < 0 || width > 65536 || height < 0 || height > 65536 || (perspective !== 0 && perspective !== 1)
      || !(points >= 0 && points <= 4096)) return false;
  // Lights (0 directional, 1 point, 2 spot, 3 hemisphere): non-negative colors, ranges and decay, directions that are
  // not zero, ordered cone cosines, shadows that name them back, and zeros in unused slots.
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const l = f.subarray(FRAME.lights + i * 16, FRAME.lights + i * 16 + 16);
    if (i >= count) { if (l.some(v => v !== 0)) return false; continue; }
    const kind = l[3], direction = (from, to) => normalizable(l.subarray(from, to)), zeros = (from, to) => l.subarray(from, to).every(v => v === 0);
    if (!l.subarray(4, 7).every(color) || l[7] < 0 || l[11] < 0 || l[15] !== 0 || (l[14] !== 0 && kind !== 0 && kind !== 2) || !namesBack(l[14], i + 1)) return false;
    if (kind === 0) { if (!direction(0, 3) || l[7] !== 0 || !zeros(8, 14)) return false; }
    else if (kind === 1) { if (!zeros(8, 11) || l[12] !== 0 || l[13] !== 0) return false; }
    else if (kind === 2) { if (!direction(8, 11) || !(l[12] >= -1 && l[12] <= 1 && l[12] <= l[13] && l[13] <= 1)) return false; }
    else if (kind === 3) { if (!direction(0, 3) || l[7] !== 0 || !l.subarray(8, 11).every(color) || l[11] !== 0 || l[12] !== 0 || l[13] !== 0) return false; }
    else return false;
  }
  return true;
}
// The post block (starhermit_sys valid_post): switches, effects that are off all zero, parameters in range.
function validPost(f) {
  const within = (values, low, high) => values.every(v => v >= low && v <= high), zero = (from, to) => f.subarray(from, to).every(v => v === 0);
  const [occlusion, grade] = [f[POST.flags], f[POST.flags + 1]], resolution = v => v >= 0.125 && v <= 1;
  if (![0, 1].includes(occlusion) || ![0, 1].includes(grade) || !zero(POST.flags + 2, POST.ao) || !zero(POST.bloom + 2, POST.grade)) return false;
  const ao = f.subarray(POST.ao, POST.denoise), pd = f.subarray(POST.denoise, POST.projection);
  const samples = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;
  const occlusionOk = occlusion === 0 ? zero(POST.ao, POST.bloom)
    : ao[0] > 0 && ao[0] <= 1000 && within([ao[1], ao[4]], 0, 16) && within([ao[2]], 0, 1000) && within([ao[3], ao[6]], 0, 1) && samples(ao[5], 64)
      && resolution(ao[7]) && pd[0] > 0 && pd[1] > 0 && within([pd[0], pd[1]], 0, 10000) && within([pd[2], pd[6]], 0, 16) && within([pd[3]], 0, 64)
      && within([pd[4]], 0, 16) && samples(pd[5], 64) && pd[7] === 0 && [3, 7, 11].every(i => f[POST.viewNormal + i] === 0);
  const bloomOk = f[FRAME.effects + 3] > 0 ? within([f[POST.bloom]], 0, 1) && resolution(f[POST.bloom + 1]) : zero(POST.bloom, POST.bloom + 2);
  // Contrast is an S-curve's weight in linear space, a slope about the middle less one in display space (whose night,
  // spared pixels and lift are all zero in linear space).
  const g = f.subarray(POST.grade, POST.game), n = f.subarray(POST.night, POST.game), display = g[3] === GRADE_SPACE_DISPLAY;
  const gradeOk = grade === 0 ? zero(POST.grade, POST.game)
    : (display ? within([g[0]], -1, 3) : g[3] === 0 && within([g[0]], 0, 1)) && within([g[2], g[12]], 0, 1) && within([g[1]], 0, 4)
      && within([g[4], g[5], g[6], g[8], g[9], g[10]], 0, 4) && within([g[7], g[11]], 0, 1)
      && g[7] < g[11] && within([g[13], g[14]], 0, 2) && g[13] < g[14] && within([g[16], g[17]], 0, 4) && within([g[20], g[21], g[22]], 0, MAX_COLOR)
      && [g[15], g[18], g[19]].every(v => v === 0) && (g[23] === 0 || (display && g[23] === 1))
      && (display ? within([n[0], n[1]], 0, 1) && within([n[2], n[3], n[4], n[5], n[6]], 0, 4) && within([n[8], n[9], n[10], n[11]], -1, 2) && n[8] < n[9]
          && n[10] < n[11] && within([n[12]], 0, 4) && within([n[13], n[14]], 0, 1) && n[13] < n[14] && [n[7], n[15]].every(v => v === 0)
        : zero(POST.night, POST.game));
  // A game's post program: an id, finite data and a forward axis; all zero otherwise.
  const program = f[POST.gameProgram], game = f.subarray(POST.game, POST.flags + POST.length);
  const gameOk = program === 0 ? game.every(v => v === 0)
    : Number.isInteger(program) && program > 0 && finite(game) && normalizable(f.subarray(POST.gameForward, POST.gameForward + 3)) && f[POST.gameForward + 3] === 0;
  return occlusionOk && bloomOk && gradeOk && gameOk;
}
// Each instance's 20 values finite and its color (12..16) a valid multiplier.
function validInstances(instances) {
  for (let at = 0; at < instances.length; at += MESH_INSTANCE_LENGTH) {
    if (!finite(instances, at, at + MESH_INSTANCE_LENGTH)) return false;
    const r = instances[at + 12], g = instances[at + 13], b = instances[at + 14], a = instances[at + 15];
    if (!(r >= 0 && r <= MAX_COLOR && g >= 0 && g <= MAX_COLOR && b >= 0 && b <= MAX_COLOR && a >= 0 && a <= 1)) return false;
  }
  return true;
}
const inRange = (v, low, high) => v >= low && v <= high;
// Material slots that must be zero, and those that hold 0..1 values.
const ZERO_SLOTS = [7, 23, 60, 61, 62, 63], UNIT_SLOTS = [3, 4, 5, 6, MATERIAL.clearcoat, MATERIAL.clearcoatRoughness];
// A scene background's batch (starhermit_sys::MESH_BACKGROUND, host API 1.18): its kind in material slot 59 (0 for every
// other batch: 1 a texture over the view, 2 and 3 a latitude-longitude or cube sky), with the background's flags (and no
// tone mapping or not), the built-in program, no blend, and which images it binds (0..3) in slot 8.
const MESH_BACKGROUND = 59;
const BACKGROUND_FLAGS = MESH.unlit | MESH.double | MESH.noDepthWrite | MESH.noDepthTest | MESH.noFog | MESH.noCast | MESH.noReceive | MESH.noAO;
const validBackground = (flags, materials, m, program, blend) => {
  const kind = materials[m + MESH_BACKGROUND];
  return kind === 0 || ([1, 2, 3].includes(kind) && (flags & ~MESH.noToneMapping) === BACKGROUND_FLAGS && program === 0 && blend === 0
    && [0, 1, 2, 3].includes(materials[m + 8]));
};
// One batch's flags and material (starting at m) as starhermit_sys::validate_mesh_pass takes them.
function validBatch(flags, materials, m) {
  const both = (a, b) => (flags & (a | b)) === (a | b), needs = (flag, needed) => !(flags & flag) || !!(flags & needed);
  if (flags & ~(MESH_FLAGS | MESH.lines) || bitCount(flags & (BLENDING | MESH.mask)) > 1
      || both(MESH.double, MESH.back) || !needs(MESH.sceneEnvironment, MESH.environment) || !needs(MESH.points, MESH.unlit)
      || !needs(MESH.pointAttenuation, MESH.points) || both(MESH.lines, MESH.points)
      || !needs(MESH.lines, MESH.noCast) || !needs(MESH.lines, MESH.noAO) || !finite(materials, m, m + MESH_MATERIAL_LENGTH)) return false;
  for (let j = 0; j < 3; j++) if (!inRange(materials[m + j], 0, MAX_COLOR) || !inRange(materials[m + 8 + j], 0, MAX_COLOR)) return false;
  for (const j of UNIT_SLOTS) if (!inRange(materials[m + j], 0, 1)) return false;
  for (const j of ZERO_SLOTS) if (materials[m + j] !== 0) return false;
  // Polygon offsets: factors in quarters up to 16, whole units up to 256.
  const factor = materials[m + 11], units = materials[m + 15];
  return Math.abs(factor) <= 16 && Number.isInteger(factor * 4) && Math.abs(units) <= 256 && Number.isInteger(units)
    && Math.abs(materials[m + MATERIAL.normalScale]) <= 16 && Math.abs(materials[m + MATERIAL.normalScale + 4]) <= 16
    && inRange(materials[m + MATERIAL.occlusion], 0, 16) && inRange(materials[m + MATERIAL.environment], 0, MAX_COLOR)
    && inRange(materials[m + MATERIAL.pointSize], 0, 4096)
    // The surface's shading bits (starhermit_sys::MESH_SURFACE_BITS: flat shading 1, bump map 2).
    && Number.isInteger(materials[m + MATERIAL.surface]) && inRange(materials[m + MATERIAL.surface], 0, 3);
}
// Mirrors starhermit_sys::validate_mesh_pass; `kept` gives a kept instance buffer's instance count by id (batches
// drawing kept instances stay within their buffer and are no part of the pass's own instances), `uniforms` the pass's
// custom programs' uniforms (each batch's range in whole vec4s, none for the built-in material) and `program` whether
// a custom program is known.
function validateMeshPass(clear, frame, instances, batches, materials, kept = () => undefined, uniforms = new Float32Array(), program = () => false) {
  if ((clear !== null && (clear.length !== 4 || clear.some(value => !Number.isFinite(value))))
      || !(frame instanceof Float32Array) || frame.length !== MESH_FRAME_LENGTH || !finite(frame) || !validFrame(frame)
      || !(uniforms instanceof Float32Array) || uniforms.length > MESH_LIMITS.batches * MAX_MESH_UNIFORM_FLOATS || !finite(uniforms)
      || !(instances instanceof Float32Array) || instances.length % MESH_INSTANCE_LENGTH || instances.length / MESH_INSTANCE_LENGTH > MESH_LIMITS.instances
      || !validInstances(instances) || !(batches instanceof Uint32Array) || batches.length % MESH_BATCH_LENGTH
      || batches.length / MESH_BATCH_LENGTH > MESH_LIMITS.batches || !(materials instanceof Float32Array)
      || materials.length !== batches.length / MESH_BATCH_LENGTH * MESH_MATERIAL_LENGTH) throw new Error('Invalid mesh pass data');
  let next = 0, offsets = null, environment = false;
  for (let i = 0, m = 0; i < batches.length; i += MESH_BATCH_LENGTH, m += MESH_MATERIAL_LENGTH) {
    const count = batches[i + BATCH.count], flags = batches[i + BATCH.flags], first = batches[i + BATCH.first], buffer = batches[i + BATCH.instances];
    const own = buffer === 0, length = own ? 0 : kept(buffer);
    if (own ? first !== next || count > instances.length / MESH_INSTANCE_LENGTH - next : length === undefined || first > length || count > length - first) {
      throw new Error(own || length !== undefined ? 'Invalid mesh batch' : 'Unknown instance buffer');
    }
    const blend = batches[i + BATCH.blend];
    const id = batches[i + BATCH.program];
    if (count === 0 || !validBatch(flags, materials, m) || (blend !== 0 && (!(flags & MESH.blend) || unpackBlend(blend) === null))
        || !validBackground(flags, materials, m, id, blend)
        // A shadow catcher (starhermit_sys::MESH_SHADOW_CATCHER, host API 1.18): 0 or 1, triangles with the built-in program.
        || ![0, 1].includes(materials[m + MATERIAL.shadowCatcher])
        || (materials[m + MATERIAL.shadowCatcher] === 1 && ((flags & (MESH.points | MESH.lines)) || id !== 0))) throw new Error('Invalid mesh batch');
    const offset = batches[i + BATCH.uniformOffset], floats = batches[i + BATCH.uniformFloats];
    if (offset % 4 || floats % 4 || floats > MAX_MESH_UNIFORM_FLOATS || offset + floats > uniforms.length
        || (id === 0 && (floats || batches.subarray(i + BATCH.gameTextures, i + BATCH.gameTextures + MESH_GAME_TEXTURES).some(t => t)))) throw new Error('Invalid mesh batch');
    if (id !== 0 && !program(id)) throw new Error('Unknown mesh program');
    // At most 16 distinct polygon offsets in a pass.
    const factor = materials[m + 11], units = materials[m + 15];
    if (factor || units) {
      (offsets ??= new Set()).add(`${factor},${units}`);
      if (offsets.size > 16) throw new Error('Too many polygon offsets in one mesh pass');
    }
    environment ||= !!(flags & MESH.sceneEnvironment);
    if (own) next += count;
  }
  if (next !== instances.length / MESH_INSTANCE_LENGTH) throw new Error('Incomplete mesh instance partition');
  // Batches lit by the pass's environment need its rotation.
  if (environment && !rotation(frame)) throw new Error("The pass's environment needs a rotation");
}
function validateTriangles(vertices, background, stride = 6) {
  if (![6,8].includes(stride) || !(vertices instanceof Float32Array) || vertices.length % (3 * stride) || vertices.length / stride > MAX_VERTICES
      || !finite(vertices) || background.length !== 4 || background.some(value => !Number.isFinite(value))) {
    throw new Error('Invalid or oversized triangle data');
  }
}
// Batches are (texture, first vertex, vertex count, blend) as starhermit_sys::validate_triangle_batches takes them.
function validateBatches(vertices, background, batches) {
  validateTriangles(vertices, background, 8);
  if (!(batches instanceof Uint32Array) || batches.length % 4 || batches.length / 4 > 100000) throw new Error('Invalid batch ranges');
  let next = 0;
  for(let i = 0; i < batches.length; i += 4) {
    if (batches[i+1] !== next || batches[i+2] % 3 || batches[i+2] > vertices.length / 8 - next || !BATCH_BLENDS[batches[i+3]]) throw new Error('Invalid batch range');
    next += batches[i+2];
  }
  if (next !== vertices.length / 8) throw new Error('Incomplete batch partition');
}
function textured(vertices, background) {
  validateTriangles(vertices, background);
  const output = new Float32Array(vertices.length / 6 * 8);
  for (let from = 0, to = 0; from < vertices.length; from += 6, to += 8) output.set(vertices.subarray(from, from + 6), to);
  return output;
}
// WebGPU's vertex buffers for a mesh layout: its attributes (positions, normals and UVs, then vertex colors), and those it
// does not store from the instance (as starhermit_sys::MeshLayout::input: meshes without vertex colors read the instance
// tint at location 7, which the shader ignores; a compact layout without UVs or one without attributes reads instance
// values the shader turns to zero); instances carry the placement and tint. Custom programs also read the custom
// attribute (location 8; the tint again on meshes without it) and the instance's custom data (9). `normals` keeps what the
// occlusion prepass's built-in program reads. A layout without attributes has no vertex buffer.
function meshBuffers(layout, program = false, normals = false) {
  const info = meshLayoutInfo(layout), vertex = [], instance = [0, 1, 2].map(i => ({shaderLocation: 3 + i, offset: i * 16, format: 'float32x4'}));
  const input = location => {
    const a = info.attributes.find(a => a.location === location);
    if (a) vertex.push({shaderLocation: location, offset: a.offset, format: `${a.format}x${a.components}`});
    else instance.push({shaderLocation: location, offset: location === 0 ? 0 : location === 1 ? 16 : 48, format: 'float32x4'});
  };
  input(0); input(1);
  if (!normals || program) { input(2); instance.push({shaderLocation: 6, offset: 48, format: 'float32x4'}); input(7); }
  if (program) {
    input(8);
    for (let slot = 0; slot < MESH_INSTANCE_SLOTS; slot++) instance.push({shaderLocation: 9 + slot, offset: 64 + 16 * slot, format: 'float32x4'});
  }
  return [info.stride ? {arrayStride: info.stride, attributes: vertex} : null, {arrayStride: MESH_INSTANCE_LENGTH * 4, stepMode: 'instance', attributes: instance}];
}
// A mesh's triangles `instances` times in a WebGPU pass: by its indices, or its vertices in order (batch `i`'s
// elements of them).
function drawMesh(pass, mesh, instances, batches, i) {
  if (mesh.indexBuffer) {
    const [first, count] = batchElements(batches, i, mesh.count);
    pass.setIndexBuffer(mesh.indexBuffer, mesh.format); pass.drawIndexed(count, instances, first);
  } else {
    const [first, count] = batchElements(batches, i, mesh.vertices);
    pass.draw(count, instances, first);
  }
}
// Textures retain owned CPU samples for restoration; never retain a WASM view.
class TextureRenderer {
  effectBudget = DEFAULT_EFFECT_BUDGET;
  // Why optional effects the latest mesh pass asked for were left out or reduced, by fallback bit.
  effectNotes = new Map();
  // Whether post-effect buffers can hold half floats (rendered and blended).
  halfFloatColor = true;
  get effectFallbacks() { let bits = 0; for (const bit of this.effectNotes.keys()) bits |= bit; return bits; }
  setEffectBudget(bytes) {
    if (!(Number.isFinite(bytes) && bytes >= 0)) throw new Error('Invalid effect budget');
    this.effectBudget = bytes; this.shadowFailed = this.postFailed = this.hdrFailed = null;
  }
  supportsSamples() { return true; }
  // Fits the shadow maps and post effects within the effect budget, as starhermit_sys's backends: shadows are left out
  // (size 0) when their map does not fit after the ones before it or cannot be created; multisampling halves its
  // samples until the buffers fit, with FXAA standing in for none, then occlusion, bloom and SMAA (for FXAA) are left
  // out in turn; post effects use half floats where they render and fit, else 8-bit color (without occlusion and the
  // grade), and are left out when even single-sample buffers fail. Returns the frame to draw (a copy when changed: with
  // half-float buffers the mesh shader writes linear color), the shadow maps by slot, the scene's post-effect buffers
  // and the plan the chain runs.
  prepareEffects(frame, width, height, clear) {
    let remaining = this.effectBudget, adjusted = frame;
    const change = (index, value) => { if (adjusted === frame) adjusted = frame.slice(); adjusted[index] = value; };
    const shadows = new Array(MAX_SHADOWS).fill(null);
    this.effectNotes.clear();
    const {kept} = fitShadows(frame, remaining);
    for (let k = 0; k < frame[FRAME.counts + 1]; k++) {
      const at = FRAME.shadows + k * SHADOW_LENGTH + SHADOW.size, size = frame[at];
      try {
        if (!kept.includes(k)) throw new Error(`a ${size}×${size} shadow map exceeds the effect budget`);
        if (this.shadowFailed?.size === size) throw this.shadowFailed.error;
        try { shadows[k] = this.ensureShadowMap(k, size); } catch (error) { this.shadowFailed = {size, error}; throw error; }
        remaining -= shadowMapBytes(size);
      } catch (error) { change(at, 0); this.effectNotes.set(1, `Shadows are unavailable: ${error.message}`); }
    }
    // Maps of shadows this pass leaves out are released (they stay within the budget).
    for (let k = 0; k < MAX_SHADOWS; k++) if (!shadows[k]) this.releaseShadowMap(k);
    // The game's post program draws once it is compiled; one the backend refused is left out for good.
    if (frame[POST.gameProgram] !== 0 && !this.postGameReady(frame[POST.gameProgram])) {
      if (adjusted === frame) adjusted = frame.slice();
      leaveOutPostProgram(adjusted);
    }
    const requested = frame[FRAME.effects], none = {frame: adjusted, shadows, post: null, plan: null};
    if (!anyPostEffects(adjusted)) return none;
    let supported;
    try { supported = this.postSampleLimit(); } catch (error) { this.effectNotes.set(2, `Post effects are unavailable: ${error.message}`); return none; }
    const wanted = Math.max(1, Math.min(requested, supported)), smallest = adjusted.slice();
    leaveOutLinearEffects(smallest, []);
    if (fitPost(smallest, width, height, wanted, false, remaining, []) === null) {
      this.effectNotes.set(2, `Post effects at ${width}×${height} exceed the effect budget`); return none;
    }
    // Half-float linear color where it renders and fits, else 8-bit color; failures are not retried until the
    // budget changes.
    const attempt = hdr => {
      const fitted = adjusted.slice(), notes = [];
      if (!hdr) leaveOutLinearEffects(fitted, notes);
      let samples = fitPost(fitted, width, height, wanted, hdr, remaining, notes);
      if (samples === null) throw new Error(`post effects at ${width}×${height} exceed the effect budget`);
      while (samples > 1 && !this.supportsSamples(samples, hdr)) samples = Math.floor(samples / 2);
      const key = `${width}×${height}×${samples}`, failed = hdr ? 'hdrFailed' : 'postFailed';
      if (this[failed]?.key === key) throw this[failed].error;
      try { return {samples, post: this.ensurePost(width, height, samples, hdr), hdr, fitted, notes}; } catch (error) { this[failed] = {key, error}; throw error; }
    };
    let fit;
    try {
      if (!this.halfFloatColor) throw new Error('half-float color is unsupported');
      fit = attempt(true);
    } catch {
      try { fit = attempt(false); } catch (error) { this.effectNotes.set(2, `Post effects are unavailable: ${error.message}`); return none; }
    }
    const {samples, post, hdr, fitted, notes} = fit;
    adjusted = fitted;
    for (const [bit, note] of notes) this.effectNotes.set(bit, note);
    if (!hdr) this.effectNotes.set(8, POST_LDR_NOTE);
    if (requested > 1 && samples === 1) {
      // FXAA stands in for multisampling.
      if (adjusted[FRAME.effects + 1] === POST_AA.none) adjusted[FRAME.effects + 1] = POST_AA.fxaa;
      this.effectNotes.set(4, `Multisampling ${supported === 1 ? 'is unsupported' : `at ${width}×${height} exceeds the effect budget`}; FXAA is used instead`);
    } else if (samples < wanted) this.effectNotes.set(4, `Multisampling uses ${samples} samples to fit the effect budget`);
    const plan = postPlan(adjusted, width, height, hdr, clear);
    if (hdr) adjusted[FRAME.output + 2] = OUTPUT_LINEAR;
    return {frame: adjusted, shadows, post, plan};
  }
  constructor() {
    this.textures = new Map(); this.targets = new Map(); this.textureBytes = 0; this.meshes = new Map(); this.meshBytes = 0;
    this.instanceSets = new Map(); this.keptInstances = 0; this.meshPrograms = new Map(); this.postGames = new Map();
    // Why custom programs a backend refused after accepting them (WebGPU compiles asynchronously), by id; and those
    // the host has not taken yet (`takeRefusedPrograms`), each once.
    this.programErrors = new Map(); this.refusedPrograms = [];
  }
  // A program (mesh or post: their IDs are one sequence) the backend refused after accepting it: `messages` are the
  // compiler's, each `line:column: text` in the lines of the joined WGSL (0:0 for a message without a place).
  refuseProgram(id, messages) {
    if (this.programErrors.has(id)) return;
    this.programErrors.set(id, `WebGPU refused custom material program ${id}: ${messages.join('; ')}`);
    this.refusedPrograms.push([id, messages]);
  }
  // The programs refused since the last call, for the game's log: [id, messages] each.
  takeRefusedPrograms() { return this.refusedPrograms.splice(0); }
  // Whether the game's post program `id` can draw now (WebGPU compiles it first; one it refused never draws).
  postGameReady(id) { this.postGame(id); return true; }
  // Textures hold `levels` mip levels (1 or the full chain, packed level 0 first) sampled as `sampler` says.
  uploadTexture(id, width, height, pixels, {levels = 1, sampler = 0} = {}) {
    this.checkTextureId(id);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > Math.min(4096, this.maxDimension) || height > Math.min(4096, this.maxDimension)
        || !(levels === 1 || levels === mipLevels(width, height)) || !validSampler(sampler)
        || !(pixels instanceof Uint8Array) || pixels.byteLength !== mipChainBytes(width, height, levels)) throw new Error('Invalid RGBA8 texture data');
    this.retainTexture(id, width, height, pixels, levels, sampler);
  }
  // Half-float RGBA textures (binary16 bits, mesh environments) hold 1 to the full chain of levels.
  uploadFloatTexture(id, width, height, data, {levels = 1, sampler = 0} = {}) {
    this.checkTextureId(id);
    if (!validFloatTexture(width, height, levels, data, sampler) || width > this.maxDimension || height > this.maxDimension) throw new Error('Invalid half-float texture data');
    this.retainTexture(id, width, height, data, levels, sampler);
  }
  checkTextureId(id) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || this.textures.has(id) || this.targets.has(id)) throw new Error('Invalid or duplicate texture ID');
  }
  retainTexture(id, width, height, pixels, levels, sampler) {
    if (!this.ready || this.disposed) throw new Error('Texture upload needs a live graphics surface');
    if (this.textures.size + this.targets.size >= 128 || pixels.byteLength > MAX_IMAGE_BYTES - this.textureBytes) throw new Error('Texture resource budget exceeded');
    sampler = effectiveSampler(sampler, levels);
    const owned = pixels.slice(), resource = this.createTextureResource(width, height, owned, levels, sampler);
    this.textures.set(id, {width, height, pixels: owned, levels, sampler, float: owned instanceof Uint16Array, resource}); this.textureBytes += owned.byteLength;
  }
  setTextureSampler(id, sampler) {
    const target = this.targets.get(id);
    if (target && target.flags & TARGET.sampled && validSampler(sampler)) {
      const levels = targetLevels(target.width, target.height, target.flags);
      target.sampler = effectiveSampler(sampler, levels); if (this.ready) this.applyTextureSampler(this.targetTexture(target.resource), target.sampler, levels); return;
    }
    const entry = this.textures.get(id); if (!entry || !validSampler(sampler)) throw new Error('Unknown texture or invalid sampler');
    entry.sampler = effectiveSampler(sampler, entry.levels); if (this.ready) this.applyTextureSampler(entry.resource, entry.sampler, entry.levels);
  }
  deleteTexture(id) {
    const texture = this.textures.get(id); if (!texture) throw new Error('Unknown texture');
    if (id === this.sceneDepth) { this.releasePrepass(); this.sceneDepth = 0; }
    this.deleteTextureResource(texture.resource); this.textures.delete(id); this.textureBytes -= texture.pixels.byteLength;
  }
  // Depth targets add a depth attachment for mesh passes, counted at 4 bytes/pixel. `flags` are starhermit_sys's
  // TARGET_* kind: depth, sampled (a texture target, whose color is also texture `id`: its mesh passes draw without
  // shadows or post effects) and half floats (texture targets only; linear light).
  createTarget(id,width,height,depth=false,flags=depth?TARGET.depth:0) {
    if(!Number.isInteger(id)||id<1||id>0xffffffff||this.textures.has(id)||this.targets.has(id))throw new Error('Invalid target ID');
    if(!this.ready||this.disposed||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>Math.min(4096,this.maxDimension)||height>Math.min(4096,this.maxDimension))throw new Error('Invalid target dimensions');
    if(!validTargetFlags(flags))throw new Error('Invalid target kind');
    if(flags&TARGET.half&&!this.halfFloatTargets)throw new Error('Half-float render targets are unsupported here');
    depth=!!(flags&TARGET.depth);
    const bytes=mipChainBytes(width,height,targetLevels(width,height,flags))/4*targetColorBytes(flags)+width*height*(depth?4:0);
    if(this.targets.size>=32||this.targets.size+this.textures.size>=128||bytes>MAX_IMAGE_BYTES-this.textureBytes)throw new Error('Target budget exceeded');
    const resource=this.createTargetResource(width,height,depth,flags);this.targets.set(id,{width,height,bytes,depth,flags,sampler:0,resource});this.textureBytes+=bytes;
  }
  // Whether half-float texture targets render (TARGET.half).
  get halfFloatTargets() { return this.halfFloatColor; }
  // A texture target's pass: no shadows or post effects (the window's maps and buffers stay as they are), and linear
  // light in half floats.
  targetEffects(frame, output) {
    const adjusted = frame.slice();
    for (let k = 0; k < MAX_SHADOWS; k++) adjusted[FRAME.shadows + k * SHADOW_LENGTH + SHADOW.size] = 0;
    if (output.flags & TARGET.half) adjusted[FRAME.output + 2] = OUTPUT_LINEAR;
    return {frame: adjusted, shadows: new Array(MAX_SHADOWS).fill(null), post: null, plan: null};
  }
  // The area (x, y from the top left, width, height) the next mesh pass draws into (starhermit_sys's pass_area, set by
  // the host before the pass), taken once: the whole destination without one; one must lie within a texture target.
  takePassArea(output, width, height) {
    const area = this.passArea ?? [0, 0, width, height]; this.passArea = null;
    const [x, y, w, h] = area, partial = x !== 0 || y !== 0 || w !== width || h !== height;
    if (partial && !(output && output.flags & TARGET.sampled && w > 0 && h > 0 && x + w <= width && y + h <= height)) throw new Error('Invalid mesh pass area');
    return {area, partial};
  }
  // Nothing samples the target it draws into.
  checkFeedback(target, ids) { if (target && ids.includes(target)) throw new Error('A pass cannot sample the target it draws into'); }
  // The scene-depth texture (a half-float texture already uploaded, starhermit_sys's set_scene_depth): window passes
  // whose batches sample it first draw their opaque batches' view depth into it (a prepass, at the pass's size).
  setSceneDepth(id) {
    const entry = this.textures.get(id); if (!entry || !entry.float) throw new Error('Unknown scene-depth texture');
    this.releasePrepass(); this.sceneDepth = id;
  }
  releasePrepass() {
    const prepass = this.prepass; if (!prepass) return; this.prepass = null;
    const entry = this.textures.get(this.sceneDepth); if (entry) entry.resource = prepass.placeholder;
    if (this.ready) this.deletePrepassResource(prepass);
  }
  // Whether batch i samples the scene depth, and whether the prepass draws it (opaque, writing depth, not points, not
  // reading the depth itself).
  samplesSceneDepth(batches, i) { return !!this.sceneDepth && this.batchIds(batches, i).includes(this.sceneDepth); }
  writesSceneDepth(batches, i) { const flags = batches[i + BATCH.flags]; return !(flags & (BLENDING | MESH.noDepthWrite | MESH.points | MESH.lines)) && !this.samplesSceneDepth(batches, i); }
  batchIds(batches, i) { return [...batches.subarray(i + BATCH.textures, i + BATCH.textures + MESH_TEXTURES), ...batches.subarray(i + BATCH.gameTextures, i + BATCH.gameTextures + MESH_GAME_TEXTURES)]; }
  // The prepass for a window pass of this size whose batches or post program (`game`) read the scene depth (null without
  // one), its color the scene-depth texture's resource.
  scenePrepass(batches, output, width, height, game = false) {
    if (output || !this.sceneDepth || !this.textures.has(this.sceneDepth)) return null;
    let wanted = game; for (let i = 0; i < batches.length && !wanted; i += MESH_BATCH_LENGTH) if (this.samplesSceneDepth(batches, i)) wanted = true;
    if (!wanted || !this.halfFloatColor) return null;
    if (this.prepass?.width === width && this.prepass?.height === height) return this.prepass;
    const entry = this.textures.get(this.sceneDepth), placeholder = this.prepass?.placeholder ?? entry.resource;
    if (this.prepass) { this.deletePrepassResource(this.prepass); entry.resource = placeholder; this.prepass = null; }
    const prepass = this.createPrepassResource(width, height, entry.sampler);
    prepass.width = width; prepass.height = height; prepass.placeholder = placeholder;
    entry.resource = prepass.sampled; this.prepass = prepass;
    return prepass;
  }
  // Meshes retain owned CPU copies so a replacement backend can recreate them, their vertices' bytes and their indices in
  // the width they upload (16 bits below NARROW_INDEX_VERTICES vertices; none to draw the vertices in order); `layout` is
  // a layout's code (true for 1), `count` the vertices of a layout without attributes.
  uploadMesh(id, vertices, indices, layout = 0, count = undefined) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || this.meshes.has(id)) throw new Error('Invalid or duplicate mesh ID');
    layout = meshLayout(layout);
    const vertexCount = validateMesh(vertices, indices, layout, count);
    // A line mesh keeps its layout's own code (its batches say how it draws) and that it is one (`code` gives both
    // back, for a replacement backend).
    const lines = (layout & MESH_LINE_CODE) !== 0;
    layout &= ~MESH_LINE_CODE;
    if (!this.ready || this.disposed) throw new Error('Mesh upload needs a live graphics surface');
    const bytes = vertices.byteLength + meshIndexBytes(vertexCount, indices.length);
    if (this.meshes.size >= MESH_LIMITS.meshes || bytes > MESH_LIMITS.bytes - this.meshBytes) throw new Error('Mesh resource budget exceeded');
    const kept = vertexCount < NARROW_INDEX_VERTICES ? new Uint16Array(indices) : new Uint32Array(indices);
    const entry = {vertices: vertexBytes(vertices).slice(), indices: kept, bytes, layout, count: vertexCount, colored: meshLayoutInfo(layout).colored,
      lines, code: layout | (lines ? MESH_LINE_CODE : 0)};
    entry.resource = this.createMeshResource(entry.vertices, entry.indices, layout, vertexCount);
    this.meshes.set(id, entry); this.meshBytes += bytes;
  }
  // A custom material's program (starhermit_sys::MeshProgramCode): the joined WGSL and its six stages' entry points
  // (WebGPU), the GLSL of the six stages into textures then the three vertex stages for the canvas, with the units of
  // its combined samplers (WebGL2), and its uniform block's bytes. Kept so a replacement backend can recreate it.
  createProgram(id, code) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || this.meshPrograms.has(id)) throw new Error('Invalid or duplicate mesh program ID');
    if (this.meshPrograms.size >= MAX_MESH_PROGRAMS) throw new Error('Mesh program budget exceeded');
    const strings = list => Array.isArray(list) && list.every(s => typeof s === 'string');
    if (!code || typeof code.wgsl !== 'string' || !strings(code.entries) || code.entries.length !== MESH_PROGRAM_STAGES || !strings(code.glsl)
        || code.glsl.length !== MESH_PROGRAM_STAGES + 3 || !Array.isArray(code.samplers)
        || !code.samplers.every(([name, unit]) => typeof name === 'string' && Number.isInteger(unit) && unit >= 0 && unit < GAME_UNIT + MESH_GAME_TEXTURES)
        || !Number.isInteger(code.uniformBytes) || code.uniformBytes < 0 || code.uniformBytes > MAX_MESH_UNIFORM_FLOATS * 4) throw new Error('Invalid mesh program');
    if (!this.ready || this.disposed) throw new Error('Mesh program needs a live graphics surface');
    const entry = {code: {...code, entries: [...code.entries], glsl: [...code.glsl], samplers: code.samplers.map(([name, unit]) => [name, unit])}};
    entry.resource = this.createProgramResource(entry.code, id);
    this.meshPrograms.set(id, entry);
  }
  deleteProgram(id) {
    const entry = this.meshPrograms.get(id); if (!entry) throw new Error('Unknown mesh program');
    this.deleteProgramResource(entry.resource); this.meshPrograms.delete(id); this.programErrors.delete(id);
  }
  // A game's post program (starhermit_sys::PostProgramCode): the joined WGSL (WebGPU: entry points vs and game_post) and
  // the GLSL of its fragment stage for textures (WebGL2), kept so a replacement backend can recreate it. Frames name it.
  createPostProgram(id, code) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || this.postGames.has(id)) throw new Error('Invalid or duplicate post program ID');
    if (this.postGames.size >= MAX_POST_PROGRAMS) throw new Error('Post program budget exceeded');
    if (!code || typeof code.wgsl !== 'string' || typeof code.glsl !== 'string') throw new Error('Invalid post program');
    if (!this.ready || this.disposed) throw new Error('Post program needs a live graphics surface');
    const entry = {code: {wgsl: code.wgsl, glsl: code.glsl}};
    entry.resource = this.createPostProgramResource(entry.code, id);
    this.postGames.set(id, entry);
  }
  deletePostProgram(id) {
    const entry = this.postGames.get(id); if (!entry) throw new Error('Unknown post program');
    this.deletePostProgramResource(entry.resource); this.postGames.delete(id); this.programErrors.delete(id);
  }
  postGame(id) { const entry = this.postGames.get(id); if (!entry) throw new Error('Unknown post program'); return entry.resource; }
  deleteMesh(id) {
    const entry = this.meshes.get(id); if (!entry) throw new Error('Unknown mesh');
    this.deleteMeshResource(entry.resource); this.meshes.delete(id); this.meshBytes -= entry.bytes;
  }
  mesh(id) { const entry = this.meshes.get(id); if (!entry) throw new Error('Unknown mesh'); return entry; }
  // Kept instance buffers: instances checked once as they arrive (an update only its span), held on the GPU for
  // passes to draw by range, with owned CPU copies so a replacement backend can recreate them.
  uploadInstances(id, instances) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || this.instanceSets.has(id)) throw new Error('Invalid or duplicate instance buffer ID');
    if (!(instances instanceof Float32Array) || !instances.length || instances.length % MESH_INSTANCE_LENGTH || !validInstances(instances)) throw new Error('Invalid mesh instances');
    if (!this.ready || this.disposed) throw new Error('Instance upload needs a live graphics surface');
    const count = instances.length / MESH_INSTANCE_LENGTH;
    if (this.instanceSets.size >= MESH_LIMITS.instanceBuffers || count > MESH_LIMITS.keptInstances - this.keptInstances) throw new Error('Instance buffer budget exceeded');
    const entry = {instances: instances.slice(), count};
    entry.resource = this.createInstanceResource(entry.instances);
    this.instanceSets.set(id, entry); this.keptInstances += count;
  }
  updateInstances(id, start, instances) {
    const entry = this.instanceSets.get(id); if (!entry) throw new Error('Unknown instance buffer');
    if (!(instances instanceof Float32Array) || instances.length % MESH_INSTANCE_LENGTH || !Number.isInteger(start) || start < 0
        || start + instances.length / MESH_INSTANCE_LENGTH > entry.count || !validInstances(instances)) throw new Error('Invalid mesh instances');
    entry.instances.set(instances, start * MESH_INSTANCE_LENGTH);
    if (this.ready && instances.length) this.updateInstanceResource(entry.resource, start, instances);
  }
  deleteInstances(id) {
    const entry = this.instanceSets.get(id); if (!entry) throw new Error('Unknown instance buffer');
    this.deleteInstanceResource(entry.resource); this.instanceSets.delete(id); this.keptInstances -= entry.count;
  }
  // The GPU buffer a batch draws its instances from: a kept buffer's, else the pass's own.
  batchInstances(batches, i, own) { const id = batches[i + BATCH.instances]; return id ? this.instanceSets.get(id).resource : own; }
  meshPass(clear, frame, instances, batches, materials, target, uniforms = new Float32Array()) {
    validateMeshPass(clear, frame, instances, batches, materials, id => this.instanceSets.get(id)?.count, uniforms, id => this.meshPrograms.has(id));
    for (let i = 0; i < batches.length; i += MESH_BATCH_LENGTH) {
      this.mesh(batches[i]); for (let t = 0; t < MESH_TEXTURES; t++) this.textureResource(batches[i + BATCH.textures + t]);
      for (let t = 0; t < MESH_GAME_TEXTURES; t++) this.textureResource(batches[i + BATCH.gameTextures + t]);
      this.checkFeedback(target, [...batches.subarray(i + BATCH.textures, i + BATCH.textures + MESH_TEXTURES), ...batches.subarray(i + BATCH.gameTextures, i + BATCH.gameTextures + MESH_GAME_TEXTURES)]);
    }
    const output = target ? this.target(target) : null;
    // A texture target without a depth buffer draws in order.
    if (output && !output.depth && !(output.flags & TARGET.sampled)) throw new Error('Render target has no depth buffer');
    return output;
  }
  // A batch's textures by slot, then its program's.
  batchTextures(batches, i) {
    return [...batches.subarray(i + BATCH.textures, i + BATCH.textures + MESH_TEXTURES), ...batches.subarray(i + BATCH.gameTextures, i + BATCH.gameTextures + MESH_GAME_TEXTURES)]
      .map(id => this.textureResource(id));
  }
  // A batch's custom program entry (undefined for the built-in material).
  batchProgram(batches, i) { const id = batches[i + BATCH.program]; return id ? this.meshPrograms.get(id) : undefined; }
  deleteTarget(id) { const entry=this.targets.get(id);if(!entry)throw new Error('Unknown target');this.deleteTargetResource(entry.resource);this.targets.delete(id);this.textureBytes-=entry.bytes; }
  target(id) { const entry=this.targets.get(id);if(!entry)throw new Error('Unknown target');return entry; }
  clearTextures() {
    for(const id of this.targets.keys())this.deleteTarget(id); for (const id of this.textures.keys()) this.deleteTexture(id); for (const id of this.meshes.keys()) this.deleteMesh(id);
    for (const id of this.instanceSets.keys()) this.deleteInstances(id);
    for (const id of this.meshPrograms.keys()) this.deleteProgram(id);
    for (const id of this.postGames.keys()) this.deletePostProgram(id);
  }
  textureResource(id) {
    if (id === 0) return this.whiteTexture; const entry = this.textures.get(id); if (entry) return entry.resource;
    const target = this.targets.get(id); if (target && target.flags & TARGET.sampled) return this.targetTexture(target.resource);
    throw new Error('Unknown texture');
  }
}
// sRGB-encoded to linear light (linear post buffers hold clear colors decoded).
const srgbDecode = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
// A number's binary16 bits (rounded toward zero; tiny values flush to zero, huge ones to infinity).
const halfBits = value => {
  const u = new Uint32Array(new Float32Array([value]).buffer)[0], sign = (u >>> 16) & 0x8000, e = ((u >>> 23) & 0xff) - 112;
  return e <= 0 ? sign : e >= 31 ? sign | 0x7c00 : sign | (e << 10) | ((u & 0x7fffff) >>> 13);
};
class WebGL2Renderer extends TextureRenderer {
  static async create(canvas, onLost, onRestored) {
    const gl = canvas.getContext('webgl2', {alpha: false, antialias: false});
    if (!gl) throw new Error('WebGL2 context unavailable');
    const renderer = new WebGL2Renderer(canvas, gl);
    try { renderer.initialize(); } catch (error) { renderer.destroy(); throw error; }
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); renderer.ready = false; onLost(renderer); });
    canvas.addEventListener('webglcontextrestored', () => {
      if (renderer.disposed) return;
      try { renderer.initialize(); onRestored(renderer); } catch (error) { onLost(renderer, error); }
    });
    return renderer;
  }
  constructor(canvas, gl) { super(); this.canvas = canvas; this.gl = gl; this.backend = 'WebGL2'; this.ready = false; this.disposed = false; }
  initialize() {
    const gl = this.gl;
    // Textures and targets hold WGSL's row order (drawn with y negated), the canvas GL's.
    // For textures and the canvas, then those giving their color premultiplied (multiply and screen batches).
    this.programs = this.linkAll([[SPRITE_VS_GLSL, SPRITE_FS_GLSL, '2D'], [SPRITE_VS_GLSL_WINDOW, SPRITE_FS_GLSL, '2D'],
      [SPRITE_VS_GLSL, SPRITE_FS_PREMULTIPLIED_GLSL, '2D'], [SPRITE_VS_GLSL_WINDOW, SPRITE_FS_PREMULTIPLIED_GLSL, '2D']]);
    this.vao = gl.createVertexArray(); this.buffer = gl.createBuffer();
    if (!this.vao || !this.buffer) throw new Error('WebGL2 resource allocation failed');
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 8);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.gpuName = webglName(gl); this.gpuClass = classifyGpu(this.gpuName);
    this.maxDimension = Math.min(16384, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
    uniformBlock(gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE));
    // Half-float color renders (and blends) with EXT_color_buffer_float or EXT_color_buffer_half_float; anisotropic
    // filtering needs EXT_texture_filter_anisotropic. Extensions are enabled again on each context.
    this.halfFloatColor = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maxAnisotropy = anisotropic ? Math.max(1, Math.min(16, gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1)) : 1;
    this.sampleLimits = new Map();
    this.whiteTexture = this.createTextureResource(1, 1, new Uint8Array([255,255,255,255]));
    this.prepass = null;
    for (const entry of this.textures.values()) entry.resource = this.createTextureResource(entry.width, entry.height, entry.pixels, entry.levels, entry.sampler);
    for (const entry of this.targets.values()) {
      entry.resource = this.createTargetResource(entry.width,entry.height,entry.depth,entry.flags);
      if (entry.flags & TARGET.sampled) this.applyTextureSampler(this.targetTexture(entry.resource), entry.sampler, targetLevels(entry.width, entry.height, entry.flags));
    }
    this.meshProgram = null; this.shadowMaps = new Array(MAX_SHADOWS).fill(null); this.postPrograms = null; this.post = null;
    this.shadowFailed = this.postFailed = this.hdrFailed = null;
    for (const entry of this.meshes.values()) entry.resource = this.createMeshResource(entry.vertices, entry.indices, entry.layout, entry.count);
    for (const entry of this.instanceSets.values()) entry.resource = this.createInstanceResource(entry.instances);
    for (const entry of this.meshPrograms.values()) entry.resource = this.createProgramResource(entry.code);
    this.ready = true;
    this.draw(new Float32Array(), [0, 0, 0, 1]); this.present();
  }
  draw(vertices, background) { return this.drawTextured(textured(vertices, background), background, 0); }
  drawTextured(vertices, background, id) {
    return this.drawBatches(vertices, background, new Uint32Array([id, 0, vertices.length / 8, 0]));
  }
  // overlay=true blends over existing color (UI after a mesh pass) instead of clearing.
  drawBatches(vertices, background, batches, target=0, overlay=false) {
    validateBatches(vertices, background, batches);
    if (!this.ready || this.gl.isContextLost()) return false;
    for(let i=0;i<batches.length;i+=4) { this.textureResource(batches[i]); this.checkFeedback(target, [batches[i]]); }
    const output=target?this.target(target):null;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER,output?.resource.framebuffer||null);
    gl.viewport(0, 0, output?.width||this.canvas.width, output?.height||this.canvas.height);
    if(!overlay){const color=output?background.map(value=>Math.max(0,Math.min(1,value))):background;const alpha=output?color[3]:1;gl.clearColor(color[0]*alpha,color[1]*alpha,color[2]*alpha,color[3]);gl.clear(gl.COLOR_BUFFER_BIT);}
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.programs[output ? 0 : 1]); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    // An empty batch (a clear draws one) issues no draw call. Each blend's factors and program as its batches come; then
    // straight alpha's again, the state the other passes leave.
    const factors = [gl.ZERO, gl.ONE, gl.SRC_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA,
      gl.ONE_MINUS_DST_ALPHA, gl.DST_COLOR, gl.ONE_MINUS_DST_COLOR, gl.SRC_ALPHA_SATURATE];
    let mode = 0;
    for(let i=0;i<batches.length;i+=4) {
      if (!batches[i+2]) continue;
      if (batches[i+3] !== mode) {
        mode = batches[i+3]; const blend = BATCH_BLENDS[mode];
        gl.blendFuncSeparate(factors[blend.color[1]], factors[blend.color[2]], factors[blend.alpha[1]], factors[blend.alpha[2]]);
        gl.useProgram(this.programs[(output ? 0 : 1) + (blend.premultiplied ? 2 : 0)]);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.textureResource(batches[i])); gl.drawArrays(gl.TRIANGLES, batches[i+1], batches[i+2]);
    }
    if (mode !== 0) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const code = gl.getError(); if (code && code !== gl.CONTEXT_LOST_WEBGL) throw new Error(`WebGL2 draw error 0x${code.toString(16)}`);
    return !gl.isContextLost();
  }
  createTargetResource(width,height,depth=false,flags=0) {
    const gl=this.gl,levels=targetLevels(width,height,flags),texture=this.createTextureResource(width,height,null,levels,0,!!(flags&TARGET.half),flags&TARGET.twoChannels?2:flags&TARGET.oneChannel?1:4);let framebuffer,renderbuffer=null;
    try {
      framebuffer=gl.createFramebuffer();if(!framebuffer)throw new Error('Framebuffer allocation failed');
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(depth){
        renderbuffer=gl.createRenderbuffer();if(!renderbuffer)throw new Error('Depth allocation failed');
        gl.bindRenderbuffer(gl.RENDERBUFFER,renderbuffer);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,renderbuffer);gl.bindRenderbuffer(gl.RENDERBUFFER,null);
      }
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete framebuffer');
      gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(levels>1){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.generateMipmap(gl.TEXTURE_2D);gl.bindTexture(gl.TEXTURE_2D,null);}
      const code=gl.getError();if(code)throw new Error(`Target error ${code}`);
      return {framebuffer,texture,renderbuffer,levels};
    }catch(error){if(framebuffer)gl.deleteFramebuffer(framebuffer);if(renderbuffer)gl.deleteRenderbuffer(renderbuffer);gl.deleteTexture(texture);throw error;}finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  }
  targetTexture(resource) { return resource.texture; }
  createPrepassResource(width, height, sampler) {
    const resource = this.createTargetResource(width, height, true, TARGET.half | TARGET.sampled);
    this.applyTextureSampler(resource.texture, sampler, 1);
    return {...resource, sampled: resource.texture};
  }
  deletePrepassResource(prepass) { this.deleteTargetResource(prepass); }
  deleteTargetResource(resource){this.gl.deleteFramebuffer(resource.framebuffer);if(resource.renderbuffer)this.gl.deleteRenderbuffer(resource.renderbuffer);this.gl.deleteTexture(resource.texture);}
  // Links a generated program and binds its uniform blocks and samplers to
  // the fixed binding points and texture units (and a custom program's further samplers to theirs).
  link(vertex, fragment, what, samplers = []) {
    const gl = this.gl, program = gl.createProgram(), shaders = [];
    if (!program) throw new Error('WebGL2 program allocation failed');
    try {
      for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(kind); if (!shader) throw new Error('WebGL2 shader allocation failed'); shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`WebGL2 ${what} shader: ${gl.getShaderInfoLog(shader)}`);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL2 ${what} pipeline: ${gl.getProgramInfoLog(program)}`);
      for (const [name, point] of UNIFORM_BLOCKS) { const index = gl.getUniformBlockIndex(program, name); if (index !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, index, point); }
      gl.useProgram(program);
      for (const [name, unit] of [...SAMPLER_UNITS, ...samplers]) { const location = gl.getUniformLocation(program, name); if (location) gl.uniform1i(location, unit); }
      gl.useProgram(null);
      return program;
    } catch (error) { gl.deleteProgram(program); throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  // Links [vertex, fragment, what, samplers] programs, all or none.
  linkAll(sources) {
    const programs = [];
    try { for (const [vertex, fragment, what, samplers] of sources) programs.push(this.link(vertex, fragment, what, samplers)); return programs; }
    catch (error) { for (const program of programs) this.gl.deleteProgram(program); throw error; }
  }
  uniformBuffer(bytes) {
    const gl = this.gl, buffer = gl.createBuffer(); if (!buffer) throw new Error('WebGL2 uniform buffer allocation failed');
    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.DYNAMIC_DRAW); gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    return buffer;
  }
  // Replaces a uniform buffer's contents and binds it at `point`.
  setUniforms(buffer, point, values) {
    const gl = this.gl; gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferData(gl.UNIFORM_BUFFER, values, gl.DYNAMIC_DRAW); gl.bindBufferBase(gl.UNIFORM_BUFFER, point, buffer);
  }
  ensureMeshProgram() {
    if (this.meshProgram) return this.meshProgram;
    const gl = this.gl, buffers = [];
    let programs = [], noShadow = null;
    try {
      programs = this.linkAll([[MESH_VS_GLSL, MESH_FS_GLSL, 'mesh'], [MESH_VS_GLSL_WINDOW, MESH_FS_GLSL, 'mesh'], [MESH_SHADOW_VS_GLSL, MESH_SHADOW_FS_GLSL, 'shadow']]);
      const instances = gl.createBuffer(); if (!instances) throw new Error('WebGL2 instance buffer allocation failed'); buffers.push(instances);
      const frame = this.uniformBuffer(MESH_FRAME_LENGTH * 4); buffers.push(frame);
      const material = this.uniformBuffer(MESH_MATERIAL_LENGTH * 4); buffers.push(material);
      const uniforms = this.uniformBuffer(MAX_MESH_UNIFORM_FLOATS * 4); buffers.push(uniforms);
      // A 1x1 depth texture keeps the shadow samplers valid where shadows are off.
      noShadow = this.depthTexture(1);
      return this.meshProgram = {programs: programs.slice(0, 2), shadowProgram: programs[2], instances, frame, material, uniforms, noShadow};
    } catch (error) { for (const program of programs) gl.deleteProgram(program); for (const buffer of buffers) gl.deleteBuffer(buffer); throw error; }
  }
  // A depth texture compared on sampling; linear filtering makes each lookup a 2x2 filtered comparison.
  depthTexture(size) {
    const gl = this.gl, texture = gl.createTexture(); if (!texture) throw new Error('WebGL2 depth texture allocation failed');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.bindTexture(gl.TEXTURE_2D, null); return texture;
  }
  // Shadow map k, recreated when its size changes.
  ensureShadowMap(k, size) {
    if (this.shadowMaps[k]?.size === size) return this.shadowMaps[k];
    this.releaseShadowMap(k);
    const gl = this.gl, texture = this.depthTexture(size), framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) { gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); throw new Error('WebGL2 shadow map is incomplete'); }
    return this.shadowMaps[k] = {size, texture, framebuffer};
  }
  releaseShadowMap(k) {
    const map = this.shadowMaps?.[k]; if (!map) return;
    this.gl.deleteFramebuffer(map.framebuffer); this.gl.deleteTexture(map.texture); this.shadowMaps[k] = null;
  }
  // Post-effect programs, linked on first use; returns the most multisample samples.
  postSampleLimit() {
    const gl = this.gl;
    if (!this.postPrograms) {
      // The step's parameters, and the frame's post block.
      const parameters = this.uniformBuffer(64), block = this.uniformBuffer(POST.length * 4);
      this.postPrograms = {programs: new Map(), tables: new Map(), parameters, block, vao: gl.createVertexArray(), maxSamples: Math.max(1, gl.getParameter(gl.MAX_SAMPLES))};
    }
    return this.postPrograms.maxSamples;
  }
  // A post step's program, linked when first used: for textures (y negated) or for the canvas; the occlusion prepass
  // draws batches with the mesh module's normal program.
  postProgram(name, canvas) {
    const programs = this.postPrograms.programs, key = `${name}${canvas ? ' canvas' : ''}`;
    if (!programs.has(key)) {
      const fragments = {occlusion: POST_OCCLUSION_GLSL, denoise: POST_DENOISE_GLSL, occlusion_blend: POST_OCCLUSION_BLEND_GLSL, bright: POST_BRIGHT_GLSL,
        blur: POST_BLUR_GLSL, bloom: POST_BLOOM_GLSL, composite: POST_COMPOSITE_GLSL, fxaa: POST_FXAA_GLSL, smaa_edges: POST_SMAA_EDGES_GLSL,
        smaa_weights: POST_SMAA_WEIGHTS_GLSL, smaa_blend: POST_SMAA_BLEND_GLSL};
      programs.set(key, name === 'normals' ? this.link(MESH_NORMAL_VS_GLSL, MESH_NORMAL_FS_GLSL, 'occlusion prepass')
        : this.link(canvas ? POST_VS_GLSL_WINDOW : POST_VS_GLSL, fragments[name], name));
    }
    return programs.get(key);
  }
  // A lookup texture, uploaded when first used: the area texture filtered linearly, the others nearest.
  postTableTexture(name) {
    const tables = this.postPrograms.tables;
    if (!tables.has(name)) {
      const gl = this.gl, {width, height, data} = postTable(name), texture = gl.createTexture(), filter = name === 'smaaArea' ? gl.LINEAR : gl.NEAREST;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.bindTexture(gl.TEXTURE_2D, null);
      tables.set(name, texture);
    }
    return tables.get(name);
  }
  // Multisampled color in the post buffers' format, and depth, take at most the formats' sample counts.
  supportsSamples(samples, hdr) {
    const gl = this.gl, key = hdr ? 'hdr' : 'ldr';
    if (!this.sampleLimits.has(key)) {
      const most = format => gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES)?.[0] ?? 1;
      this.sampleLimits.set(key, Math.min(most(hdr ? gl.RGBA16F : gl.RGBA8), most(gl.DEPTH_COMPONENT24)));
    }
    return samples <= this.sampleLimits.get(key);
  }
  // The scene's post-effect buffers for one destination size: multisampled when samples > 1, resolved into
  // `resolved`, in half floats of linear color when `hdr`.
  ensurePost(width, height, samples, hdr) {
    const gl = this.gl;
    samples = Math.max(1, Math.min(samples, this.postSampleLimit()));
    const current = this.post;
    if (current && current.width === width && current.height === height && current.samples === samples && current.hdr === hdr) return current;
    this.releasePost();
    const [internal, type] = hdr ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
    const resolved = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, resolved);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null); gl.bindTexture(gl.TEXTURE_2D, null);
    const post = this.post = {width, height, samples, hdr, resolved, framebuffers: [], renderbuffers: []};
    let complete = true;
    const framebuffer = attach => { const f = gl.createFramebuffer(); post.framebuffers.push(f); gl.bindFramebuffer(gl.FRAMEBUFFER, f); attach(); complete &&= gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; return f; };
    const renderbuffer = (format) => { const r = gl.createRenderbuffer(); post.renderbuffers.push(r); gl.bindRenderbuffer(gl.RENDERBUFFER, r);
      if (samples > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height); else gl.renderbufferStorage(gl.RENDERBUFFER, format, width, height); return r; };
    post.resolve = framebuffer(() => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolved, 0));
    post.scene = framebuffer(() => {
      if (samples > 1) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer(internal));
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolved, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer(gl.DEPTH_COMPONENT24));
    });
    gl.bindRenderbuffer(gl.RENDERBUFFER, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const code = gl.getError();
    if (!complete || (code && code !== gl.CONTEXT_LOST_WEBGL)) { this.releasePost(); throw new Error(`WebGL2 post-effect buffers are incomplete (0x${code.toString(16)})`); }
    return post;
  }
  releasePost() {
    this.releasePostChain();
    const post = this.post, gl = this.gl; if (!post) return; this.post = null;
    for (const framebuffer of post.framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const renderbuffer of post.renderbuffers) gl.deleteRenderbuffer(renderbuffer);
    gl.deleteTexture(post.resolved);
  }
  // The plan's images (kept while they stay the same): color filtered linearly, normals and 24-bit depth nearest, a
  // framebuffer for each color image (the normals with the depth after them).
  ensurePostChain(plan, hdr) {
    const gl = this.gl, key = JSON.stringify([plan.images, hdr]);
    if (this.chain?.key === key) return this.chain;
    this.releasePostChain();
    const chain = this.chain = {key, textures: [], framebuffers: []};
    let complete = true;
    for (const image of plan.images) {
      const texture = gl.createTexture(); chain.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
      const [internal, format, type, filter] = image.format === 'depth' ? [gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST]
        : image.format === 'normal' || hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, image.format === 'normal' ? gl.NEAREST : gl.LINEAR] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR];
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, image.width, image.height, 0, format, type, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    plan.images.forEach((image, i) => {
      if (image.format === 'depth') { chain.framebuffers.push(null); return; }
      const framebuffer = gl.createFramebuffer(); chain.framebuffers.push(framebuffer); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, chain.textures[i], 0);
      if (image.format === 'normal' && plan.images[i + 1]?.format === 'depth') gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, chain.textures[i + 1], 0);
      complete &&= gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const code = gl.getError();
    if (!complete || (code && code !== gl.CONTEXT_LOST_WEBGL)) { this.releasePostChain(); throw new Error(`WebGL2 post-effect images are incomplete (0x${code.toString(16)})`); }
    return chain;
  }
  releasePostChain() {
    const chain = this.chain, gl = this.gl; if (!chain) return; this.chain = null;
    for (const framebuffer of chain.framebuffers) if (framebuffer) gl.deleteFramebuffer(framebuffer);
    for (const texture of chain.textures) gl.deleteTexture(texture);
  }
  // The scene resolved, then each step of the plan: one triangle with the step's program, its images on units 0..5
  // and its parameters, into an image, the scene or the destination (`normals` draws the occlusion prepass).
  postFinish(plan, chain, frame, destination, normals) {
    const gl = this.gl, post = this.post, programs = this.postPrograms, {width, height} = post;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    if (post.samples > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, post.scene); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, post.resolve);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    this.setUniforms(programs.block, POST_BLOCK, frame.subarray(FRAME.post, FRAME.post + POST.length));
    const texture = input => input === null ? null : input === 'scene' ? post.resolved : typeof input === 'number' ? chain.textures[input]
      : input === 'sceneDepth' ? (this.sceneDepth ? this.textureResource(this.sceneDepth) : null) : this.postTableTexture(input);
    for (const step of plan.steps) {
      const framebuffer = step.target === 'scene' ? post.resolve : step.target === 'destination' ? destination : chain.framebuffers[step.target];
      if (step.program === 'normals') { normals(step, framebuffer); continue; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, step.size[0], step.size[1]);
      if (step.load.clear) { gl.clearColor(...step.load.clear); gl.clear(gl.COLOR_BUFFER_BIT); }
      if (step.blend === 'replace') gl.disable(gl.BLEND);
      else { gl.enable(gl.BLEND); if (step.blend === 'over') gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.DST_ALPHA, gl.ZERO); }
      gl.useProgram(step.program === 'game' ? this.postGame(step.programId) : this.postProgram(step.program, step.target === 'destination' && !destination));
      this.setUniforms(programs.parameters, PARAMETERS_BLOCK, step.parameters);
      const units = [...step.inputs.map(texture), step.depth === null ? null : chain.textures[step.depth]];
      for (let unit = units.length - 1; unit >= 0; unit--) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, units[unit]); }
      gl.bindVertexArray(programs.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    }
    for (let unit = 5; unit >= 0; unit--) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // The layout's attributes (vertex colors follow the UV and the custom attribute the colors); without one (vertex colors,
  // the custom attribute, a compact layout's UVs or a layout without any) the attribute stays disabled and the shader
  // ignores it or reads it as zero. Instances carry the placement and tint (3..6) and custom data (9). A mesh drawn in
  // order has no index buffer.
  createMeshResource(vertices, indices, layout = 0, vertexCount = 0) {
    const info = meshLayoutInfo(meshLayout(layout)), indexed = indices.length > 0;
    const gl = this.gl, vao = gl.createVertexArray(), vertexBuffer = gl.createBuffer(), indexBuffer = indexed ? gl.createBuffer() : null;
    const types = {float32: [gl.FLOAT, false], snorm16: [gl.SHORT, true], unorm16: [gl.UNSIGNED_SHORT, true], snorm8: [gl.BYTE, true], unorm8: [gl.UNSIGNED_BYTE, true]};
    try {
      if (!vao || !vertexBuffer || (indexed && !indexBuffer)) throw new Error('WebGL2 mesh allocation failed');
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      for (const a of info.attributes) {
        const [type, normalized] = types[a.format];
        gl.enableVertexAttribArray(a.location); gl.vertexAttribPointer(a.location, a.components, type, normalized, info.stride, a.offset);
      }
      for (const location of INSTANCE_LOCATIONS) { gl.enableVertexAttribArray(location); gl.vertexAttribDivisor(location, 1); }
      if (indexed) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW); }
      gl.bindVertexArray(null); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      const code = gl.getError(); if (code && code !== gl.CONTEXT_LOST_WEBGL) throw new Error(`WebGL2 mesh upload error 0x${code.toString(16)}`);
      return {vao, vertexBuffer, indexBuffer, count: indices.length, vertices: vertexCount, type: indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT};
    } catch (error) { gl.bindVertexArray(null); gl.deleteVertexArray(vao); gl.deleteBuffer(vertexBuffer); if (indexBuffer) gl.deleteBuffer(indexBuffer); throw error; }
  }
  deleteMeshResource(resource) { const gl = this.gl; gl.deleteVertexArray(resource.vao); gl.deleteBuffer(resource.vertexBuffer); if (resource.indexBuffer) gl.deleteBuffer(resource.indexBuffer); }
  // A mesh's triangles (line segments for a line batch's `lines`) `instances` times, its vertex array bound: by its
  // indices, or its vertices in order (batch `i`'s elements of them).
  drawMesh(mesh, instances, batches, i, lines = false) {
    const gl = this.gl, mode = lines ? gl.LINES : gl.TRIANGLES;
    if (mesh.count) {
      const [first, count] = batchElements(batches, i, mesh.count);
      gl.drawElementsInstanced(mode, count, mesh.type, first * (mesh.type === gl.UNSIGNED_SHORT ? 2 : 4), instances);
    } else {
      const [first, count] = batchElements(batches, i, mesh.vertices);
      gl.drawArraysInstanced(mode, first, count, instances);
    }
  }
  // A custom program's four programs, as starhermit_sys::egl links them: the lit pass's for textures and for the
  // canvas, the shadow pass's and the occlusion prepass's.
  createProgramResource(code) {
    const g = code.glsl, programs = this.linkAll([[g[0], g[1], 'custom material'], [g[6], g[1], 'custom material'], [g[2], g[3], 'custom material shadow'],
      [g[4], g[5], 'custom material prepass']].map(([vertex, fragment, what]) => [vertex, fragment, what, code.samplers]));
    return {programs: programs.slice(0, 2), shadow: programs[2], normals: programs[3], custom: customProgram(code)};
  }
  deleteProgramResource(resource) { for (const program of [...resource.programs, resource.shadow, resource.normals]) this.gl.deleteProgram(program); }
  // A game's post program: its fragment stage linked with the post module's vertex stage (it draws into images only).
  createPostProgramResource(code) { return this.link(POST_VS_GLSL, code.glsl, 'post program'); }
  deletePostProgramResource(program) { this.gl.deleteProgram(program); }
  createInstanceResource(instances) {
    const gl = this.gl, buffer = gl.createBuffer(); if (!buffer) throw new Error('WebGL2 instance buffer allocation failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW); return buffer;
  }
  updateInstanceResource(buffer, start, instances) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferSubData(gl.ARRAY_BUFFER, start * MESH_INSTANCE_LENGTH * 4, instances); }
  deleteInstanceResource(buffer) { this.gl.deleteBuffer(buffer); }
  // Depth-tested instanced pass; clear=null keeps color (e.g. a 2D background; with post effects the scene composites
  // over it) and always resets depth.
  drawMeshes(clear, frame, instances, batches, materials, target=0, uniforms=new Float32Array()) {
    const output = this.meshPass(clear, frame, instances, batches, materials, target, uniforms);
    if (!this.ready || this.gl.isContextLost()) return false;
    const gl = this.gl, program = this.ensureMeshProgram(), width = output?.width || this.canvas.width, height = output?.height || this.canvas.height;
    const {area, partial} = this.takePassArea(output, width, height);
    let shadows, post, plan;
    ({frame, shadows, post, plan} = output && output.flags & TARGET.sampled ? this.targetEffects(frame, output) : this.prepareEffects(frame, width, height, clear));
    // Post effects render the scene offscreen and run their chain into the destination.
    const destination = output?.resource.framebuffer || null;
    const chain = post ? this.ensurePostChain(plan, post.hdr) : null;
    gl.bindBuffer(gl.ARRAY_BUFFER, program.instances); gl.bufferData(gl.ARRAY_BUFFER, instances, gl.STREAM_DRAW);
    // Drawing with y negated (into textures) inverts front faces; the material's textures sit on units 0.. by slot. A
    // custom program's uniforms take their block and its textures the units after the shadow maps, and every stage of
    // it may read all the material's textures.
    const stride = MESH_INSTANCE_LENGTH * 4;
    const bindBatch = (i, m, flipped, units) => {
      const flags = batches[i + BATCH.flags], cull = cullMode(flags), custom = batches[i + BATCH.program] !== 0;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.batchInstances(batches, i, program.instances));
      for (const location of INSTANCE_LOCATIONS) gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, batches[i + BATCH.first] * stride + instanceOffset(location));
      if (cull === 0) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(cull === 1 ? gl.BACK : gl.FRONT); }
      gl.frontFace(!!(flags & MESH.clockwise) !== flipped ? gl.CW : gl.CCW);
      this.setUniforms(program.material, MATERIAL_BLOCK, shaderMaterial(materials, m, flags, this.mesh(batches[i]).layout));
      if (custom) {
        const from = batches[i + BATCH.uniformOffset], floats = batches[i + BATCH.uniformFloats];
        this.setUniforms(program.uniforms, GAME_BLOCK, floats ? uniforms.slice(from, from + floats) : new Float32Array(4));
        for (let k = 0; k < MESH_GAME_TEXTURES; k++) { gl.activeTexture(gl.TEXTURE0 + GAME_UNIT + k); gl.bindTexture(gl.TEXTURE_2D, this.textureResource(batches[i + BATCH.gameTextures + k])); }
        units = MESH_TEXTURES;
      }
      for (let unit = units - 1; unit >= 0; unit--) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.textureResource(batches[i + BATCH.textures + unit])); }
    };
    // The program a batch draws with in a pass (`pick` chooses among a custom program's), switched only when it
    // changes.
    let bound = null;
    const use = (i, builtIn, pick) => { const entry = this.batchProgram(batches, i), wanted = entry ? pick(entry.resource) : builtIn; if (wanted !== bound) { gl.useProgram(wanted); bound = wanted; } };
    // Shadow passes: depth of everything casting shadows, seen from each shadowing light; each reads its own copy of
    // the frame naming the shadow it renders.
    shadows.forEach((shadow, k) => {
      if (!shadow) return;
      const copy = frame.slice(); copy[SHADOW_PASS] = k; this.setUniforms(program.frame, FRAME_BLOCK, copy);
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.framebuffer); gl.viewport(0, 0, shadow.size, shadow.size);
      gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND); gl.disable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      bound = null;
      for (let i = 0, m = 0; i < batches.length; i += MESH_BATCH_LENGTH, m += MESH_MATERIAL_LENGTH) {
        if (!castsShadow(batches[i + BATCH.flags])) continue;
        use(i, program.shadowProgram, p => p.shadow);
        const mesh = this.mesh(batches[i]).resource; gl.bindVertexArray(mesh.vao); bindBatch(i, m, true, 1);
        this.drawMesh(mesh, batches[i + BATCH.count], batches, i);
      }
      gl.bindVertexArray(null);
    });
    // The scene-depth prepass: the opaque batches' view depth (far where none), drawn as into a texture, which the lit
    // pass's batches then read.
    const prepass = this.scenePrepass(batches, output, width, height, !!plan?.steps.some(step => step.program === 'game'));
    if (prepass) {
      const depthFrame = frame.slice(); depthFrame[FRAME.output + 2] = OUTPUT_DEPTH; depthFrame[FRAME.output + 3] = 0;
      this.setUniforms(program.frame, FRAME_BLOCK, depthFrame);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prepass.framebuffer); gl.viewport(0, 0, width, height);
      gl.clearColor(SCENE_DEPTH_FAR, 0, 0, 0); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); bound = null;
      for (let k = 0; k < MAX_SHADOWS; k++) { gl.activeTexture(gl.TEXTURE0 + SHADOW_UNIT + k); gl.bindTexture(gl.TEXTURE_2D, program.noShadow); }
      for (let i = 0, m = 0; i < batches.length; i += MESH_BATCH_LENGTH, m += MESH_MATERIAL_LENGTH) {
        if (!this.writesSceneDepth(batches, i)) continue;
        use(i, program.programs[0], p => p.programs[0]);
        const mesh = this.mesh(batches[i]).resource, flags = batches[i + BATCH.flags];
        gl.bindVertexArray(mesh.vao); bindBatch(i, m, true, MESH_TEXTURES);
        if (flags & MESH.noDepthTest) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
        const [factor, units] = polygonOffset(materials, m);
        if (factor || units) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(factor, units); } else gl.disable(gl.POLYGON_OFFSET_FILL);
        this.drawMesh(mesh, batches[i + BATCH.count], batches, i);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindVertexArray(null);
    }
    // Custom materials' window positions count rows from the top, the canvas's too (output.w 1).
    if (!post && !destination) { frame = frame.slice(); frame[FRAME.output + 3] = 1; }
    this.setUniforms(program.frame, FRAME_BLOCK, frame);
    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? post.scene : destination);
    // A texture target's area (its rows top first, so the area's top is the framebuffer's y), scissored.
    gl.viewport(...area);
    if (partial) { gl.scissor(...area); gl.enable(gl.SCISSOR_TEST); }
    let mask = gl.DEPTH_BUFFER_BIT;
    if (clear) {
      const color = output ? clear.map(value => Math.max(0, Math.min(1, value))) : clear, alpha = output ? color[3] : 1;
      // Linear buffers hold the clear color decoded.
      const rgb = [color[0] * alpha, color[1] * alpha, color[2] * alpha].map(c => post?.hdr ? srgbDecode(c) : c);
      gl.clearColor(rgb[0], rgb[1], rgb[2], color[3]); mask |= gl.COLOR_BUFFER_BIT;
    } else if (post) {
      // Over existing color: the scene starts transparent.
      gl.clearColor(0, 0, 0, 0); mask |= gl.COLOR_BUFFER_BIT;
    }
    gl.depthMask(true); gl.clearDepth(1); gl.clear(mask);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    const onCanvas = !post && !destination;
    bound = null;
    // The shadow maps (or a stand-in depth texture) after the material's units.
    for (let k = 0; k < MAX_SHADOWS; k++) { gl.activeTexture(gl.TEXTURE0 + SHADOW_UNIT + k); gl.bindTexture(gl.TEXTURE_2D, shadows[k]?.texture ?? program.noShadow); }
    // Whether a custom blend changed the blend equations.
    let customBlend = false;
    for (let i = 0, m = 0; i < batches.length; i += MESH_BATCH_LENGTH, m += MESH_MATERIAL_LENGTH) {
      use(i, program.programs[onCanvas ? 1 : 0], p => p.programs[onCanvas ? 1 : 0]);
      const mesh = this.mesh(batches[i]).resource, flags = batches[i + BATCH.flags], mode = blendMode(flags);
      gl.bindVertexArray(mesh.vao); bindBatch(i, m, !onCanvas, MESH_TEXTURES);
      const custom = mode ? unpackBlend(batches[i + BATCH.blend]) : null;
      if (mode === 0) gl.disable(gl.BLEND);
      else if (custom) {
        // A material's custom blend: its equations and factors (the equations go back to adding after the pass).
        const ops = [gl.FUNC_ADD, gl.FUNC_SUBTRACT, gl.FUNC_REVERSE_SUBTRACT, gl.MIN, gl.MAX];
        const factors = [gl.ZERO, gl.ONE, gl.SRC_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA,
          gl.ONE_MINUS_DST_ALPHA, gl.DST_COLOR, gl.ONE_MINUS_DST_COLOR, gl.SRC_ALPHA_SATURATE];
        gl.enable(gl.BLEND); customBlend = true;
        gl.blendEquationSeparate(ops[custom.color[0]], ops[custom.alpha[0]]);
        gl.blendFuncSeparate(factors[custom.color[1]], factors[custom.color[2]], factors[custom.alpha[1]], factors[custom.alpha[2]]);
      } else {
        gl.enable(gl.BLEND);
        if (customBlend) { gl.blendEquation(gl.FUNC_ADD); customBlend = false; }
        if (mode === 1) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else if (mode === 2) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
        else if (mode === 3) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // Multiply: the destination's color times the source's, its alpha kept.
        else gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
      }
      if (flags & MESH.noDepthTest) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
      gl.depthMask(!(flags & MESH.noDepthWrite));
      const [factor, units] = polygonOffset(materials, m);
      if (factor || units) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(factor, units); } else gl.disable(gl.POLYGON_OFFSET_FILL);
      this.drawMesh(mesh, batches[i + BATCH.count], batches, i, (flags & MESH.lines) !== 0);
    }
    if (customBlend) gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindVertexArray(null);
    for (let unit = GAME_UNIT + MESH_GAME_TEXTURES - 1; unit >= 0; unit--) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, null); }
    if (post) {
      // The occlusion prepass draws the batches that take part, front faces only, depth tested and written.
      const normals = (step, framebuffer) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, step.size[0], step.size[1]);
        gl.clearColor(...step.load.clear); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); bound = null;
        const normalsProgram = this.postProgram('normals', false);
        this.setUniforms(program.frame, FRAME_BLOCK, frame);
        for (let i = 0, m = 0; i < batches.length; i += MESH_BATCH_LENGTH, m += MESH_MATERIAL_LENGTH) {
          if (batches[i + BATCH.flags] & (MESH.points | MESH.noAO)) continue;
          use(i, normalsProgram, p => p.normals);
          const mesh = this.mesh(batches[i]).resource; gl.bindVertexArray(mesh.vao); bindBatch(i, m, true, 0);
          gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
          this.drawMesh(mesh, batches[i + BATCH.count], batches, i);
        }
        gl.bindVertexArray(null); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        for (let unit = GAME_UNIT + MESH_GAME_TEXTURES - 1; unit >= 0; unit--) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, null); }
      };
      this.postFinish(plan, chain, frame, destination, normals);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.DEPTH_TEST); gl.frontFace(gl.CCW);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // A texture target's mip chain, made again from what the pass drew.
    if (output && output.resource.levels > 1) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, output.resource.texture); gl.generateMipmap(gl.TEXTURE_2D); gl.bindTexture(gl.TEXTURE_2D, null);
    }
    const code = gl.getError(); if (code && code !== gl.CONTEXT_LOST_WEBGL) throw new Error(`WebGL2 mesh draw error 0x${code.toString(16)}`);
    return !gl.isContextLost();
  }
  compositeTarget(id){
    const entry=this.target(id),gl=this.gl;if(!this.ready||gl.isContextLost())return false;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,entry.resource.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
    try {// Targets hold WGSL's row order (top first), the canvas GL's.
    gl.blitFramebuffer(0,0,entry.width,entry.height,0,this.canvas.height,this.canvas.width,0,gl.COLOR_BUFFER_BIT,gl.LINEAR);const code=gl.getError();if(code)throw new Error(`Blit error ${code}`);return true;}
    finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  }
  // `pixels` packs `levels` mip levels (level 0 first): RGBA8 bytes, or binary16 half floats (RGBA16F, filterable in
  // WebGL2); render targets pass null (`half` for half floats).
  // `channels`: a half-float target's (RG16F with two, R16F with one; renderable with the same extensions as RGBA16F).
  createTextureResource(width, height, pixels, levels = 1, sampler = 0, half = false, channels = 4) {
    const gl = this.gl, texture = gl.createTexture(); if (!texture) throw new Error('WebGL2 texture allocation failed');
    const [internal, type] = half || pixels instanceof Uint16Array ? [channels === 2 ? gl.RG16F : channels === 1 ? gl.R16F : gl.RGBA16F, gl.HALF_FLOAT]
      : [channels === 2 ? gl.RG8 : channels === 1 ? gl.R8 : gl.RGBA8, gl.UNSIGNED_BYTE];
    const format = channels === 2 ? gl.RG : channels === 1 ? gl.RED : gl.RGBA;
    try {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      for (let level = 0, offset = 0; level < levels; level++) {
        const w = Math.max(1, width >> level), h = Math.max(1, height >> level);
        gl.texImage2D(gl.TEXTURE_2D, level, internal, w, h, 0, format, type, pixels && pixels.subarray(offset, offset + w * h * 4)); offset += w * h * 4;
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
      this.samplerParameters(sampler, levels);
      const code = gl.getError(); if (code || gl.isContextLost()) throw new Error(`WebGL2 texture upload error 0x${code.toString(16)}`);
      return texture;
    } catch (error) { gl.deleteTexture(texture); throw error; }
  }
  // Sampling parameters of the texture bound to TEXTURE_2D, with anisotropic filtering where the extension allows.
  samplerParameters(sampler, levels) {
    const gl = this.gl, bits = effectiveSampler(sampler, levels), linear = bits & 32, mip = (bits >> 6) & 3;
    const wrap = w => w === 1 ? gl.REPEAT : w === 2 ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    const min = mip === 0 ? (linear ? gl.LINEAR : gl.NEAREST) : mip === 1 ? (linear ? gl.LINEAR_MIPMAP_NEAREST : gl.NEAREST_MIPMAP_NEAREST) : (linear ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, bits & 16 ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(bits & 3)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap((bits >> 2) & 3));
    // TEXTURE_MAX_ANISOTROPY_EXT.
    if (this.maxAnisotropy > 1) gl.texParameterf(gl.TEXTURE_2D, 0x84fe, Math.min(samplerAnisotropy(bits), this.maxAnisotropy));
  }
  applyTextureSampler(texture, sampler, levels) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); this.samplerParameters(sampler, levels); gl.bindTexture(gl.TEXTURE_2D, null);
  }
  deleteTextureResource(texture) { this.gl.deleteTexture(texture); }
  present() { if (this.ready) this.gl.flush(); }
  async readPixel(x, y) { return this.readPixelSync(x, y); }
  // The frame drawn so far (`renderer.capture`), read now, before
  // anything else draws over it: RGBA8 rows from the top.
  captureFrame() {
    const {width, height} = this.canvas, gl = this.gl;
    if (!this.ready || !width || !height) throw new Error('No live WebGL2 frame to capture');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const rows = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rows);
    const pixels = new Uint8Array(rows.length), row = width * 4;
    for (let y = 0; y < height; y++) pixels.set(rows.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return Promise.resolve({width, height, pixels});
  }
  readPixelSync(x, y) {
    if (!this.ready || x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) throw new Error('Pixel outside a live WebGL2 surface');
    const pixel = new Uint8Array(4); this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return pixel;
  }
  destroy() {
    this.disposed = true; this.ready = false; this.clearTextures();
    if (this.whiteTexture) this.gl.deleteTexture(this.whiteTexture);
    this.whiteTexture = null;
    const gl = this.gl;
    if (this.buffer) gl.deleteBuffer(this.buffer); if (this.vao) gl.deleteVertexArray(this.vao); for (const program of this.programs || []) gl.deleteProgram(program);
    if (this.meshProgram) {
      const mesh = this.meshProgram; for (const program of [...mesh.programs, mesh.shadowProgram]) gl.deleteProgram(program);
      gl.deleteTexture(mesh.noShadow); for (const buffer of [mesh.instances, mesh.frame, mesh.material, mesh.uniforms]) gl.deleteBuffer(buffer);
    }
    for (let k = 0; k < MAX_SHADOWS; k++) this.releaseShadowMap(k);
    this.releasePost();
    if (this.postPrograms) {
      const post = this.postPrograms; for (const program of post.programs.values()) gl.deleteProgram(program);
      for (const table of post.tables.values()) gl.deleteTexture(table);
      gl.deleteBuffer(post.block); gl.deleteVertexArray(post.vao);
      gl.deleteBuffer(post.parameters); gl.deleteVertexArray(post.vao);
    }
    this.buffer = this.vao = this.programs = this.meshProgram = this.postPrograms = null;
  }
  simulateLoss() { const extension = this.gl.getExtension('WEBGL_lose_context'); if (!extension) throw new Error('Context loss simulation unavailable'); extension.loseContext(); return extension; }
}
class WebGPURenderer extends TextureRenderer {
  static async create(canvas, gpu, onLost) {
    if (!gpu) throw new Error('WebGPU unavailable');
    const adapter = await bounded(gpu.requestAdapter(), "WebGPU adapter"); if (!adapter) throw new Error('WebGPU adapter unavailable');
    const device = await bounded(adapter.requestDevice(), "WebGPU device", device => device.destroy());
    const renderer = new WebGPURenderer(canvas, device);
    renderer.gpuClass = webgpuClass(adapter); renderer.gpuName = webgpuName(adapter);
    try {
      const context = canvas.getContext('webgpu'); if (!context) throw new Error('WebGPU canvas unavailable');
      renderer.context = context; renderer.format = gpu.getPreferredCanvasFormat();
      renderer.maxDimension = Math.min(16384, device.limits.maxTextureDimension2D);
      if (device.limits.maxBufferSize < 96 || device.limits.maxVertexBufferArrayStride < 32) throw new Error('WebGPU limits do not support the triangle profile');
      uniformBlock(device.limits.maxUniformBufferBindingSize);
      context.configure({device, format: renderer.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST});
      device.pushErrorScope('validation');
      const shader = device.createShaderModule({code: WGSL});
      if (shader.getCompilationInfo) {
        const info = await bounded(shader.getCompilationInfo(), "WGSL compilation");
        const messages = info.messages.filter(message => message.type === 'error');
        if (messages.length) throw new Error(`WGSL: ${messages.map(message => message.message).join('; ')}`);
      }
      // An explicit layout (a texture and its sampler, as the module binds them), which the batch blends' pipelines
      // share: bind groups made for an 'auto' layout serve its own pipeline alone.
      const textureLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: 2, texture: {sampleType: 'float'}},
        {binding: 1, visibility: 2, sampler: {type: 'filtering'}}]});
      const pipeline = {layout: device.createPipelineLayout({bindGroupLayouts: [textureLayout]}),
        vertex: {module: shader, entryPoint: 'vs', buffers: [{arrayStride: 32, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x2'}, {shaderLocation: 1, offset: 8, format: 'float32x4'}, {shaderLocation: 2, offset: 24, format: 'float32x2'}]}]},
        fragment: {module: shader, entryPoint: 'fs', targets: [{format: renderer.format, blend: {
          color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}
        }}]}, primitive: {topology: 'triangle-list'}};
      renderer.pipeline = await bounded(device.createRenderPipelineAsync(pipeline), 'WebGPU pipeline');
      // The other batch blends' pipelines (add, multiply, screen), made when a pass first draws one.
      renderer.spriteDescriptor = pipeline; renderer.batchPipelines = [renderer.pipeline];
      renderer.blitPipeline = await bounded(device.createRenderPipelineAsync({...pipeline, fragment:{...pipeline.fragment,targets:[{format:renderer.format}]}}), 'WebGPU composite pipeline');
      renderer.samplers = new Map(); renderer.sampler = renderer.samplerFor(0);
      renderer.whiteTexture = renderer.createTextureResource(1, 1, new Uint8Array([255,255,255,255]));
      renderer.ready = true; renderer.draw(new Float32Array(), [0, 0, 0, 1]); renderer.present();
      await bounded(device.queue.onSubmittedWorkDone(), "WebGPU surface probe");
      const error = await bounded(device.popErrorScope(), 'WebGPU validation'); if (error) throw new Error(`WebGPU surface probe: ${error.message}`);
      device.addEventListener('uncapturederror', event => onLost(renderer, event.error));
      device.lost.then(info => { renderer.ready = false; if (!renderer.disposed) onLost(renderer, new Error(`WebGPU device lost: ${info.message || info.reason}`)); });
      return renderer;
    } catch (error) { renderer.destroy(); throw error; }
  }
  constructor(canvas, device) { super(); this.canvas = canvas; this.device = device; this.backend = 'WebGPU'; this.capacity = 0; this.ready = false; this.disposed = false; this.textureSerial = 0; this.shadowMaps = new Array(MAX_SHADOWS).fill(null); }
  draw(vertices, background) { return this.drawTextured(textured(vertices, background), background, 0); }
  drawTextured(vertices, background, id) {
    return this.drawBatches(vertices, background, new Uint32Array([id, 0, vertices.length / 8, 0]));
  }
  drawBatches(vertices, background, batches, target=0, overlay=false) {
    validateBatches(vertices, background, batches); if (!this.ready) return false;
    for(let i=0;i<batches.length;i+=4) { this.textureResource(batches[i]); this.checkFeedback(target, [batches[i]]); }
    if (target && this.target(target).flags & TARGET.half) throw new Error('2D batches draw into RGBA8 targets');
    // Pending work is submitted before its buffers are rewritten.
    if(this.encoder){this.device.queue.submit([this.encoder.finish()]);this.encoder=null;}
    const size = Math.max(96, vertices.byteLength);
    if (size > this.device.limits.maxBufferSize) throw new Error('WebGPU vertex budget exceeds device limits');
    if (size > this.capacity) {
      if (this.buffer) this.buffer.destroy(); this.capacity = size;
      this.buffer = this.device.createBuffer({size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
    }
    if (vertices.byteLength) this.device.queue.writeBuffer(this.buffer, 0, vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const output=target?this.target(target):null;
    const drawTexture=output?output.resource.texture:this.frameTexture();
    if(!output)this.texture=drawTexture;this.encoder=this.device.createCommandEncoder();
    const color=output?background.map(value=>Math.max(0,Math.min(1,value))):background;const alpha=output?color[3]:1;
    const attachment = overlay ? {view: drawTexture.createView(), loadOp: 'load', storeOp: 'store'}
      : {view: drawTexture.createView(), clearValue: {r: color[0]*alpha, g: color[1]*alpha, b: color[2]*alpha, a: color[3]}, loadOp: 'clear', storeOp: 'store'};
    const pass = this.encoder.beginRenderPass({colorAttachments: [attachment]});
    pass.setPipeline(this.pipeline); pass.setVertexBuffer(0, this.buffer);
    // An empty batch (a clear draws one) issues no draw: WebGPU warns of a zero vertex count. Each blend's pipeline as its
    // batches come.
    let mode = 0;
    for(let i=0;i<batches.length;i+=4) {
      if (!batches[i+2]) continue;
      if (batches[i+3] !== mode) { mode = batches[i+3]; pass.setPipeline(this.batchPipeline(mode)); }
      pass.setBindGroup(0, this.textureResource(batches[i]).bindGroup); pass.draw(batches[i+2], 1, batches[i+1]);
    }
    pass.end();
    if(output){this.device.queue.submit([this.encoder.finish()]);this.encoder=null;}
    return true;
  }
  // A batch blend's pipeline (BATCH_BLENDS), made once: the 2D pipeline (its layout too, so the textures' bind groups
  // serve it) with the blend's factors and fragment stage.
  batchPipeline(mode) {
    this.batchPipelines ??= [this.pipeline];
    if (!this.batchPipelines[mode]) {
      const base = this.spriteDescriptor, fragment = base.fragment;
      this.batchPipelines[mode] = this.device.createRenderPipeline({...base, fragment: {...fragment,
        entryPoint: BATCH_BLENDS[mode].premultiplied ? 'fs_premultiplied' : 'fs', targets: [{...fragment.targets[0], blend: gpuBatchBlend(mode)}]}});
    }
    return this.batchPipelines[mode];
  }
  createTargetResource(width,height,withDepth=false,flags=0) {
    const half=flags&TARGET.half,format=flags&TARGET.twoChannels?(half?'rg16float':'rg8unorm'):flags&TARGET.oneChannel?(half?'r16float':'r8unorm'):half?'rgba16float':this.format;
    const levels=targetLevels(width,height,flags);
    // Copied into for areas' clears; passes draw into its first level (`attachment`), which makes the rest.
    const texture=this.device.createTexture({size:{width,height},format,mipLevelCount:levels,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
    let vertices,depth=null;
    try {
      if(this.device.limits.maxBufferSize<192)throw new Error('Composite buffer exceeds device limit');
      const sampler=this.device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
      const bindGroup=this.device.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({baseMipLevel:0,mipLevelCount:1})},{binding:1,resource:sampler}]});
      vertices=this.device.createBuffer({size:192,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
      this.device.queue.writeBuffer(vertices,0,new Float32Array([-1,-1,1,1,1,1,0,1, 1,-1,1,1,1,1,1,1, -1,1,1,1,1,1,0,0, -1,1,1,1,1,1,0,0, 1,-1,1,1,1,1,1,1, 1,1,1,1,1,1,1,0]));
      const encoder=this.device.createCommandEncoder();
      for(let level=0;level<levels;level++){const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView({baseMipLevel:level,mipLevelCount:1}),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.end();}
      this.device.queue.submit([encoder.finish()]);
      if(withDepth)depth=this.device.createTexture({size:{width,height},format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
      // A texture target's color as materials and batches sample it.
      let sampled=null;
      if(flags&TARGET.sampled){sampled={texture,view:texture.createView(),levels,sampler:0,serial:++this.textureSerial};this.applyTextureSampler(sampled,0);}
      return {texture,attachment:texture.createView({baseMipLevel:0,mipLevelCount:1}),bindGroup,vertices,depth,format,sampled,levels,mips:null};
    }catch(error){texture.destroy();vertices?.destroy();depth?.destroy();throw error;}
  }
  targetTexture(resource) { return resource.sampled; }
  createPrepassResource(width, height, sampler) {
    const texture = this.device.createTexture({size: {width, height}, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING});
    const depth = this.device.createTexture({size: {width, height}, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT});
    const sampled = {texture, view: texture.createView(), levels: 1, sampler: 0, serial: ++this.textureSerial};
    this.applyTextureSampler(sampled, sampler);
    return {texture, depth, sampled};
  }
  deletePrepassResource(prepass) { this.dropTextureGroups(prepass.sampled); prepass.texture.destroy(); prepass.depth.destroy(); }
  deleteTargetResource(resource){if(resource.sampled)this.dropTextureGroups(resource.sampled);resource.texture.destroy();resource.vertices.destroy();resource.depth?.destroy();}
  // Texture samplers by SAMPLER_* bits (at most 540 states), created on first use; without a mipmap filter only level 0
  // is sampled; anisotropy comes with linear filters throughout.
  samplerFor(bits) {
    let sampler = this.samplers.get(bits);
    if (!sampler) {
      const wrap = w => w === 1 ? 'repeat' : w === 2 ? 'mirror-repeat' : 'clamp-to-edge', anisotropy = (bits & 176) === 176 ? samplerAnisotropy(bits) : 1;
      sampler = this.device.createSampler({addressModeU: wrap(bits & 3), addressModeV: wrap((bits >> 2) & 3), magFilter: bits & 16 ? 'linear' : 'nearest',
        minFilter: bits & 32 ? 'linear' : 'nearest', mipmapFilter: bits & 128 ? 'linear' : 'nearest',
        // A maximum LOD of 0.25 with nearest mip selection keeps level 0 while minification uses its own filter.
        lodMaxClamp: (bits >> 6) & 3 ? 32 : 0.25, ...(anisotropy > 1 ? {maxAnisotropy: anisotropy} : {})});
      this.samplers.set(bits, sampler);
    }
    return sampler;
  }
  // Explicit layouts let every mesh pipeline variant share bind groups: the frame and material at dynamic offsets
  // (group 0), the material's seven textures and samplers (group 1) and the shadow maps (group 2).
  ensureMeshPipelines() {
    if (this.mesh3d) return this.mesh3d;
    const device = this.device, stage = GPUShaderStage;
    // Binding 2 holds a custom program's uniforms (its whole range; built-in pipelines read none).
    const frameLayout = device.createBindGroupLayout({entries: [
      {binding: 0, visibility: stage.VERTEX | stage.FRAGMENT, buffer: {type: 'uniform', hasDynamicOffset: true, minBindingSize: MESH_FRAME_LENGTH * 4}},
      {binding: 1, visibility: stage.VERTEX | stage.FRAGMENT, buffer: {type: 'uniform', hasDynamicOffset: true, minBindingSize: MESH_MATERIAL_LENGTH * 4}},
      {binding: 2, visibility: stage.VERTEX | stage.FRAGMENT, buffer: {type: 'uniform', hasDynamicOffset: true}}]});
    // Texture slot k at binding 2k, its sampler at 2k + 1: the material's seven, then a custom program's four (which
    // its vertex stage may read too).
    const textureLayout = device.createBindGroupLayout({entries: Array.from({length: MESH_TEXTURES + MESH_GAME_TEXTURES}, (_, k) => {
      const visibility = k < MESH_TEXTURES ? stage.FRAGMENT : stage.VERTEX | stage.FRAGMENT;
      return [{binding: 2 * k, visibility, texture: {}}, {binding: 2 * k + 1, visibility, sampler: {}}];
    }).flat()});
    const shadowLayout = device.createBindGroupLayout({entries: [...Array.from({length: MAX_SHADOWS}, (_, binding) => ({binding, visibility: stage.FRAGMENT, texture: {sampleType: 'depth'}})),
      {binding: MAX_SHADOWS, visibility: stage.FRAGMENT, sampler: {type: 'comparison'}}]});
    const layout = device.createPipelineLayout({bindGroupLayouts: [frameLayout, textureLayout, shadowLayout]});
    const shadowPipelineLayout = device.createPipelineLayout({bindGroupLayouts: [frameLayout, textureLayout]});
    const module = device.createShaderModule({code: MESH_WGSL});
    const buffers = layout => meshBuffers(layout);
    // Alpha over, or additive (color by alpha added, alpha kept).
    const blends = [null, {color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}},
      {color: {srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add'}, alpha: {srcFactor: 'zero', dstFactor: 'one', operation: 'add'}},
      {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}},
      {color: {srcFactor: 'dst', dstFactor: 'zero', operation: 'add'}, alpha: {srcFactor: 'zero', dstFactor: 'one', operation: 'add'}}];
    const cullModes = ['none', 'back', 'front'];
    // The lit pass's frame, then a copy per shadow pass, in 256-byte aligned slots.
    // The frame, a copy per shadow pass and the scene-depth prepass's copy.
    const frame = device.createBuffer({size: FRAME_SLOT * (2 + MAX_SHADOWS), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    // Depth-only pipelines for the shadow maps, and a 1x1 map bound in unused slots.
    const comparison = device.createSampler({compare: 'less-equal', magFilter: 'linear', minFilter: 'linear'});
    const noShadowTexture = device.createTexture({size: {width: 1, height: 1}, format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT});
    let shadowBinding = null;
    const shadowGroup = textures => {
      if (!shadowBinding || textures.some((texture, k) => texture !== shadowBinding.textures[k])) {
        shadowBinding = {textures, group: device.createBindGroup({layout: shadowLayout, entries: [...textures.map((texture, binding) => ({binding, resource: texture.createView()})),
          {binding: MAX_SHADOWS, resource: comparison}]})};
      }
      return shadowBinding.group;
    };
    // Variants are created on first use, keyed by culling, winding, blending, depth writes and tests, vertex colors,
    // samples, the polygon offset and the color format; the caches keep their 128 most recently used (pipelines in
    // flight stay alive).
    const lit = new Map(), shadows = new Map();
    const cached = (cache, key, create) => {
      let entry = cache.get(key);
      if (entry) cache.delete(key); else entry = create();
      cache.set(key, entry);
      while (cache.size > 128) cache.delete(cache.keys().next().value);
      return entry;
    };
    // Without depth (a texture target without a depth buffer) a pipeline has no depth state; `custom` is the batch's
    // custom blend (BATCH.blend, 0 for none).
    const litDescriptor = (flags, layout, count, [factor, units], format, program, depth = true, custom = 0) => {
      // Line batches (host API 1.17) draw a line list: nothing to cull, and WebGPU takes no depth bias for lines.
      const lines = (flags & MESH.lines) !== 0;
      if (lines) { factor = 0; units = 0; }
      const cull = lines ? 0 : cullMode(flags), front = flags & MESH.clockwise ? 'cw' : 'ccw', mode = blendMode(flags), blend = mode && custom ? custom : mode;
      const test = !(flags & MESH.noDepthTest), write = test && !(flags & MESH.noDepthWrite);
      const [vertexModule, vertexEntry, fragmentModule, fragmentEntry] = program ? [program.module, program.entries[0], program.module, program.entries[1]] : [module, 'vs', module, 'fs'];
      const descriptor = {layout,
        vertex: {module: vertexModule, entryPoint: vertexEntry, buffers: meshBuffers(layout, !!program)},
        fragment: {module: fragmentModule, entryPoint: fragmentEntry, targets: [blend ? {format, blend: blend === custom ? gpuBlend(custom) : blends[blend]} : {format}]},
        primitive: {topology: lines ? 'line-list' : 'triangle-list', cullMode: cullModes[cull], frontFace: front},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: write, depthCompare: test ? 'less' : 'always', depthBias: units, depthBiasSlopeScale: factor}, multisample: {count}};
      if (!depth) delete descriptor.depthStencil;
      return {key: [cull, front, blend, write, test, layout, count, factor, units, format, depth, lines].join(), descriptor};
    };
    const shadowDescriptor = (flags, layout, program) => {
      const cull = cullMode(flags), front = flags & MESH.clockwise ? 'cw' : 'ccw';
      return {key: ['shadow', cull, front, layout].join(), descriptor: {layout: shadowPipelineLayout,
        vertex: {module: program?.module ?? module, entryPoint: program ? program.entries[2] : 'shadow_vs', buffers: meshBuffers(layout, !!program)},
        fragment: {module: program?.module ?? module, entryPoint: program ? program.entries[3] : 'shadow_fs', targets: []},
        primitive: {topology: 'triangle-list', cullMode: cullModes[cull], frontFace: front}, depthStencil: {format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less'}}};
    };
    const pipeline = (flags, layout, count, offset = [0, 0], format = this.format, depth = true, custom = 0) => {
      const {key, descriptor} = litDescriptor(flags, layout, count, offset, format, null, depth, custom);
      return cached(lit, key, () => device.createRenderPipeline({...descriptor, layout: this.mesh3d.pipelineLayout}));
    };
    const shadowPipeline = (flags, layout) => { const {key, descriptor} = shadowDescriptor(flags, layout, null); return cached(shadows, key, () => device.createRenderPipeline(descriptor)); };
    // A custom program's pipeline, made asynchronously (a refused one rejects instead of raising an uncaptured error
    // that would end the device): null until it is ready, and for good once the program failed.
    const programPipeline = (program, {key, descriptor}) => {
      if (program.failed) return null;
      const known = program.pipelines.get(key);
      if (known !== undefined) return known;
      program.pipelines.set(key, null);
      device.createRenderPipelineAsync(descriptor).then(made => { if (!program.failed) program.pipelines.set(key, made); },
        error => this.failProgram(program, error));
      return null;
    };
    const programLit = (program, flags, layout, count, offset = [0, 0], format = this.format, depth = true, custom = 0) => {
      const made = litDescriptor(flags, layout, count, offset, format, program, depth, custom); made.descriptor.layout = this.mesh3d.pipelineLayout;
      return programPipeline(program, made);
    };
    const programShadow = (program, flags, layout) => programPipeline(program, shadowDescriptor(flags, layout, program));
    // The occlusion prepass's normals of a program's vertices (which may read its textures, group 1).
    const programNormals = (program, flags, layout) => {
      const front = flags & MESH.clockwise ? 'cw' : 'ccw';
      return programPipeline(program, {key: ['normals', front, layout].join(), descriptor: {layout: shadowPipelineLayout,
        vertex: {module: program.module, entryPoint: program.entries[4], buffers: meshBuffers(layout, true)},
        fragment: {module: program.module, entryPoint: program.entries[5], targets: [{format: 'rgba16float'}]}, primitive: {topology: 'triangle-list', cullMode: 'back', frontFace: front},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less'}}});
    };
    this.mesh3d = {frameLayout, textureLayout, pipelineLayout: layout, frame, pipeline, shadowPipeline, programLit, programShadow, programNormals,
      cachedPipelines: () => lit.size + shadows.size, shadowGroup, noShadowTexture,
      groups: new Map(), materials: null, materialCapacity: 0, uniforms: null, uniformCapacity: 0, instances: null, instanceCapacity: 0, bindGroup: null};
    return this.mesh3d;
  }
  // A custom program's module, checked as WebGPU compiles it: a program it refuses is marked failed (its batches then
  // draw the built-in material, or nothing for custom materials) and its error kept for the host to report.
  createProgramResource(code, id) {
    const device = this.device;
    const program = {id, module: this.checkedModule(code.wgsl, messages => this.failProgram(program, messages)), entries: code.entries,
      custom: customProgram(code), pipelines: new Map(), failed: false};
    return program;
  }
  // A game's WGSL as a module, its refusal (the compiler's messages, else the validation error's) to `fail` once.
  checkedModule(wgsl, fail) {
    const device = this.device;
    device.pushErrorScope('validation');
    const module = device.createShaderModule({code: wgsl});
    let compiled = null;
    device.popErrorScope().then(error => {
      if (!error) return;
      // The compiler's messages say where; wait for them when they come.
      Promise.resolve(compiled).then(said => { if (!said) fail([`0:0: ${error.message}`]); });
    }, () => {});
    compiled = module.getCompilationInfo?.().then(info => {
      const errors = info.messages.filter(message => message.type === 'error');
      if (!errors.length) return false;
      fail(errors.map(message => `${message.lineNum}:${message.linePos}: ${message.message}`));
      return true;
    }, () => false) ?? null;
    return module;
  }
  failProgram(program, error) {
    if (program.failed) return;
    program.failed = true; program.pipelines.clear();
    const messages = Array.isArray(error) ? error : [`0:0: ${error?.message ?? error}`];
    if (this.meshPrograms.get(program.id)?.resource === program) this.refuseProgram(program.id, messages);
  }
  deleteProgramResource(program) { program.failed = true; program.pipelines.clear(); }
  // A batch's material textures (group 1), cached by the seven textures for the MATERIAL_GROUPS most recently used;
  // deleting a texture or changing its sampler drops the groups that bind it.
  materialGroup(resources) {
    const cache = this.mesh3d.groups, key = resources.map(resource => resource.serial).join();
    let entry = cache.get(key);
    if (entry) { cache.delete(key); cache.set(key, entry); return entry.group; }
    entry = {resources, group: this.device.createBindGroup({layout: this.mesh3d.textureLayout, entries: resources.flatMap((resource, k) => [
      {binding: 2 * k, resource: resource.view}, {binding: 2 * k + 1, resource: this.samplerFor(resource.sampler)}])})};
    cache.set(key, entry); for (const resource of resources) (resource.groups ??= new Set()).add(key);
    while (cache.size > MATERIAL_GROUPS) this.dropGroup(cache.keys().next().value);
    return entry.group;
  }
  dropGroup(key) {
    const cache = this.mesh3d?.groups, entry = cache?.get(key); if (!entry) return;
    cache.delete(key); for (const resource of entry.resources) resource.groups?.delete(key);
  }
  dropTextureGroups(resource) { for (const key of [...(resource.groups ?? [])]) this.dropGroup(key); resource.groups?.clear(); }
  // Shadow map k, recreated when its size changes.
  ensureShadowMap(k, size) {
    if (this.shadowMaps[k]?.size !== size) {
      this.releaseShadowMap(k);
      const texture = this.device.createTexture({size: {width: size, height: size}, format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING});
      this.shadowMaps[k] = {size, texture, view: texture.createView()};
    }
    return this.shadowMaps[k];
  }
  releaseShadowMap(k) { this.shadowMaps[k]?.texture.destroy(); this.shadowMaps[k] = null; }
  // WebGPU multisamples with exactly four samples.
  postSampleLimit() { return 4; }
  supportsSamples(samples) { return samples === 1 || samples === 4; }
  // The post module's pipelines (by program, format and blend; the occlusion prepass's by culling, winding and vertex
  // colors), its samplers and the scene's post-effect buffers for one destination size: four samples when multisampled,
  // resolved into `resolved`, with its depth, in half floats of linear color when `hdr` (else the canvas format).
  ensurePost(width, height, samples, hdr) {
    const device = this.device, usage = GPUTextureUsage;
    if (!this.postPipelines) {
      const stage = GPUShaderStage, module = device.createShaderModule({code: POST_WGSL}), mesh3d = this.ensureMeshPipelines();
      const texture = binding => ({binding, visibility: stage.FRAGMENT, texture: {}});
      const groupLayout = device.createBindGroupLayout({entries: [...[0, 1, 2, 3, 4].map(texture), {binding: 5, visibility: stage.FRAGMENT, texture: {sampleType: 'depth'}},
        {binding: 6, visibility: stage.FRAGMENT, sampler: {}}, {binding: 7, visibility: stage.FRAGMENT, sampler: {type: 'non-filtering'}},
        {binding: 8, visibility: stage.FRAGMENT, buffer: {type: 'uniform', hasDynamicOffset: true, minBindingSize: 64}},
        {binding: 9, visibility: stage.FRAGMENT, buffer: {type: 'uniform', minBindingSize: POST.length * 4}}]});
      const layout = device.createPipelineLayout({bindGroupLayouts: [groupLayout]}), pipelines = new Map();
      // Premultiplied color over existing color (light without coverage adds on), or color and alpha multiplied in.
      const blends = {over: {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}},
        multiply: {color: {srcFactor: 'dst', dstFactor: 'zero', operation: 'add'}, alpha: {srcFactor: 'dst-alpha', dstFactor: 'zero', operation: 'add'}}};
      const pipeline = (entryPoint, format, blend) => {
        const key = [entryPoint, format, blend].join();
        if (!pipelines.has(key)) pipelines.set(key, device.createRenderPipeline({layout, vertex: {module, entryPoint: 'vs'},
          fragment: {module, entryPoint, targets: [blend === 'replace' ? {format} : {format, blend: blends[blend]}]}, primitive: {topology: 'triangle-list'}}));
        return pipelines.get(key);
      };
      const meshModule = device.createShaderModule({code: MESH_WGSL}), normalsLayout = device.createPipelineLayout({bindGroupLayouts: [mesh3d.frameLayout]});
      // As the mesh pipelines' vertex buffers (the normal program reads positions, normals and the instance columns).
      const normals = (flags, layout) => {
        const front = flags & MESH.clockwise ? 'cw' : 'ccw', key = ['normals', front, layout].join();
        if (!pipelines.has(key)) pipelines.set(key, device.createRenderPipeline({layout: normalsLayout, vertex: {module: meshModule, entryPoint: 'normal_vs', buffers: meshBuffers(layout, false, true)},
          fragment: {module: meshModule, entryPoint: 'normal_fs', targets: [{format: 'rgba16float'}]}, primitive: {topology: 'triangle-list', cullMode: 'back', frontFace: front},
          depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less'}}));
        return pipelines.get(key);
      };
      const sampler = filter => device.createSampler({magFilter: filter, minFilter: filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'});
      const tables = new Map(), table = name => {
        if (!tables.has(name)) {
          const {width: w, height: h, data} = postTable(name), t = device.createTexture({size: {width: w, height: h}, format: 'rgba8unorm', usage: usage.TEXTURE_BINDING | usage.COPY_DST});
          device.queue.writeTexture({texture: t}, data, {bytesPerRow: w * 4, rowsPerImage: h}, {width: w, height: h}); tables.set(name, t);
        }
        return tables.get(name);
      };
      const blank = device.createTexture({size: {width: 1, height: 1}, format: 'rgba8unorm', usage: usage.TEXTURE_BINDING});
      const blankDepth = device.createTexture({size: {width: 1, height: 1}, format: 'depth24plus', usage: usage.TEXTURE_BINDING | usage.RENDER_ATTACHMENT});
      this.postPipelines = {groupLayout, pipeline, normals, linear: sampler('linear'), nearest: sampler('nearest'), table, tables, blank, blankDepth, parameters: null, capacity: 0,
        block: device.createBuffer({size: POST.length * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST})};
    }
    samples = samples > 1 ? 4 : 1;
    const current = this.post;
    if (current && current.width === width && current.height === height && current.samples === samples && current.hdr === hdr) return current;
    this.releasePost();
    const format = hdr ? 'rgba16float' : this.format, textures = [];
    const texture = descriptor => { const t = device.createTexture(descriptor); textures.push(t); return t; };
    try {
      const resolved = texture({size: {width, height}, format, usage: usage.RENDER_ATTACHMENT | usage.TEXTURE_BINDING});
      const multisampled = samples > 1 ? texture({size: {width, height}, format, sampleCount: 4, usage: usage.RENDER_ATTACHMENT}) : null;
      const depth = texture({size: {width, height}, format: 'depth24plus', sampleCount: samples, usage: usage.RENDER_ATTACHMENT});
      return this.post = {width, height, samples, hdr, format, textures, resolved, multisampled, depth};
    } catch (error) { for (const t of textures) t.destroy(); throw error; }
  }
  releasePost() { this.releasePostChain(); if (this.post) { for (const texture of this.post.textures) texture.destroy(); this.post = null; } }
  // The plan's images (kept while they and the scene's buffers stay the same) and a bind group per step: its five
  // inputs and depth (stand-ins where unused), the samplers, its parameters slot and the post block; each pass writes
  // the steps' parameters and the frame's post block.
  ensurePostChain(plan, hdr, frame) {
    const device = this.device, pipelines = this.postPipelines, post = this.post, key = JSON.stringify([plan.images, plan.steps.map(s => [s.inputs, s.depth]), hdr]);
    // The scene depth a game's post program reads (the prepass's, when it ran).
    const depth = this.sceneDepth && this.textures.has(this.sceneDepth) ? this.textureResource(this.sceneDepth) : null;
    if (this.chain?.key !== key || this.chain.post !== post || this.chain.depth !== depth) {
      this.releasePostChain();
      const chain = this.chain = {key, post, depth, textures: [], views: [], formats: [], groups: []};
      for (const image of plan.images) {
        const format = image.format === 'depth' ? 'depth24plus' : image.format === 'normal' || hdr ? 'rgba16float' : 'rgba8unorm';
        const texture = device.createTexture({size: {width: image.width, height: image.height}, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING});
        chain.textures.push(texture); chain.views.push(texture.createView()); chain.formats.push(format);
      }
      const view = input => input === null ? pipelines.blank.createView() : input === 'scene' ? post.resolved.createView() : typeof input === 'number' ? chain.views[input]
        : input === 'sceneDepth' ? (depth?.view ?? pipelines.blank.createView()) : pipelines.table(input).createView();
      const bytes = Math.max(256, plan.steps.length * 256);
      if (bytes > pipelines.capacity) { pipelines.parameters?.destroy(); pipelines.capacity = bytes; pipelines.parameters = device.createBuffer({size: bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}); chain.grown = true; }
      for (const step of plan.steps) {
        chain.groups.push(step.program === 'normals' ? null : device.createBindGroup({layout: pipelines.groupLayout, entries: [
          ...step.inputs.map((input, binding) => ({binding, resource: view(input)})),
          {binding: 5, resource: step.depth === null ? pipelines.blankDepth.createView() : chain.views[step.depth]},
          {binding: 6, resource: pipelines.linear}, {binding: 7, resource: pipelines.nearest},
          {binding: 8, resource: {buffer: pipelines.parameters, size: 64}}, {binding: 9, resource: {buffer: pipelines.block}}]}));
      }
      chain.parameters = pipelines.parameters;
    }
    if (this.chain.parameters !== pipelines.parameters) { this.releasePostChain(); return this.ensurePostChain(plan, hdr, frame); }
    const values = new Float32Array(plan.steps.length * 64);
    plan.steps.forEach((step, slot) => values.set(step.parameters, slot * 64));
    device.queue.writeBuffer(pipelines.parameters, 0, values.buffer, 0, values.byteLength);
    device.queue.writeBuffer(pipelines.block, 0, frame.buffer, frame.byteOffset + FRAME.post * 4, POST.length * 4);
    return this.chain;
  }
  releasePostChain() { if (this.chain) { for (const texture of this.chain.textures) texture.destroy(); this.chain = null; } }
  // A game's post program: its module (entry points vs and game_post), and its pipelines by format and blend in the post
  // module's layout, made when first drawn.
  // It draws once WebGPU has compiled it (`postGameReady`); one it refuses is left out of the scene's effects for good.
  createPostProgramResource(code, id) {
    const resource = {pipelines: new Map(), ready: false, failed: false};
    const fail = messages => {
      if (resource.failed) return;
      resource.failed = true; resource.pipelines.clear();
      if (this.postGames.get(id)?.resource === resource) this.refuseProgram(id, messages);
    };
    resource.fail = fail;
    resource.module = this.checkedModule(code.wgsl, fail);
    Promise.resolve(resource.module.getCompilationInfo?.()).then(() => { resource.ready = true; }, () => { resource.ready = true; });
    return resource;
  }
  deletePostProgramResource(resource) { resource.failed = true; resource.pipelines.clear(); }
  postGameReady(id) { const resource = this.postGame(id); return resource.ready && !resource.failed; }
  postGamePipeline(id, format, blend) {
    const resource = this.postGame(id), key = [format, blend].join();
    if (!resource.pipelines.has(key)) {
      const layout = this.device.createPipelineLayout({bindGroupLayouts: [this.postPipelines.groupLayout]});
      // A pipeline WebGPU refuses fails the program instead of raising an uncaptured error (which would end the device).
      this.device.pushErrorScope('validation');
      resource.pipelines.set(key, this.device.createRenderPipeline({layout, vertex: {module: resource.module, entryPoint: 'vs'},
        fragment: {module: resource.module, entryPoint: 'game_post', targets: [{format}]}, primitive: {topology: 'triangle-list'}}));
      this.device.popErrorScope().then(error => { if (error) resource.fail([`0:0: ${error.message}`]); }, () => {});
    }
    return resource.pipelines.get(key);
  }
  createMeshResource(vertices, indices, layout = 0, vertexCount = 0) {
    // 16-bit indices write in whole 4 bytes: an odd count gets one more (never drawn). A mesh drawn in order has no index
    // buffer; one without attributes a placeholder vertex buffer (never read).
    const narrow = indices instanceof Uint16Array, written = narrow && indices.length % 2 ? padded(indices) : indices;
    if (Math.max(vertices.byteLength, written.byteLength) > this.device.limits.maxBufferSize) throw new Error('Mesh exceeds WebGPU buffer limits');
    const vertexBuffer = this.device.createBuffer({size: Math.max(4, vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
    let indexBuffer = null;
    try {
      if (indices.length) indexBuffer = this.device.createBuffer({size: written.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
      this.device.queue.writeBuffer(vertexBuffer, 0, vertices.buffer, vertices.byteOffset, vertices.byteLength);
      if (indexBuffer) this.device.queue.writeBuffer(indexBuffer, 0, written.buffer, written.byteOffset, written.byteLength);
      layout = meshLayout(layout);
      return {vertexBuffer, indexBuffer, count: indices.length, vertices: vertexCount, format: narrow ? 'uint16' : 'uint32', layout, colored: meshLayoutInfo(layout).colored};
    } catch (error) { vertexBuffer.destroy(); indexBuffer?.destroy(); throw error; }
  }
  deleteMeshResource(resource) { resource.vertexBuffer.destroy(); resource.indexBuffer?.destroy(); }
  createInstanceResource(instances) {
    if (instances.byteLength > this.device.limits.maxBufferSize) throw new Error('Instances exceed WebGPU buffer limits');
    const buffer = this.device.createBuffer({size: instances.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
    try { this.device.queue.writeBuffer(buffer, 0, instances.buffer, instances.byteOffset, instances.byteLength); return buffer; }
    catch (error) { buffer.destroy(); throw error; }
  }
  updateInstanceResource(buffer, start, instances) {
    // Pending work drew the old instances: it is submitted first.
    if (this.encoder) { this.device.queue.submit([this.encoder.finish()]); this.encoder = null; }
    this.device.queue.writeBuffer(buffer, start * MESH_INSTANCE_LENGTH * 4, instances.buffer, instances.byteOffset, instances.byteLength);
  }
  deleteInstanceResource(buffer) { buffer.destroy(); }
  canvasDepth() {
    const {width, height} = this.canvas;
    if (!this.depthTexture || this.depthSize[0] !== width || this.depthSize[1] !== height) {
      this.depthTexture?.destroy(); this.depthSize = [width, height];
      this.depthTexture = this.device.createTexture({size: {width, height}, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT});
    }
    return this.depthTexture;
  }
  // Matrices use -1..1 clip depth; the vertex shader remaps to WebGPU's 0..1. clear=null keeps color (with post
  // effects the scene composites over it).
  drawMeshes(clear, frame, instances, batches, materials, target=0, uniforms=new Float32Array()) {
    const output = this.meshPass(clear, frame, instances, batches, materials, target, uniforms);
    if (!this.ready) return false;
    const device = this.device, mesh3d = this.ensureMeshPipelines(), count = batches.length / MESH_BATCH_LENGTH;
    // Pending work is submitted before the shared buffers are rewritten.
    if (this.encoder) { device.queue.submit([this.encoder.finish()]); this.encoder = null; }
    const width = output ? output.width : this.canvas.width, height = output ? output.height : this.canvas.height;
    const {area, partial} = this.takePassArea(output, width, height);
    let shadows, post, plan;
    ({frame, shadows, post, plan} = output && output.flags & TARGET.sampled ? this.targetEffects(frame, output) : this.prepareEffects(frame, width, height, clear));
    // The lit pass's frame, then each shadow pass's copy naming the shadow it renders.
    const frames = new Float32Array(FRAME_SLOT / 4 * (2 + MAX_SHADOWS)); frames.set(frame);
    shadows.forEach((shadow, k) => { if (shadow) { const at = (1 + k) * FRAME_SLOT / 4; frames.set(frame, at); frames[at + SHADOW_PASS] = k; } });
    const prepass = this.scenePrepass(batches, output, width, height, !!plan?.steps.some(step => step.program === 'game')), prepassSlot = (1 + MAX_SHADOWS) * FRAME_SLOT;
    if (prepass) { frames.set(frame, prepassSlot / 4); frames[prepassSlot / 4 + FRAME.output + 2] = OUTPUT_DEPTH; }
    device.queue.writeBuffer(mesh3d.frame, 0, frames.buffer, 0, frames.byteLength);
    // Custom programs' uniform blocks in 256-byte aligned slots (a run of batches with the same range shares one), with
    // room past the last for the binding's whole range.
    const uniformOffsets = new Array(count).fill(0), slots = [];
    for (let b = 0, last = null; b < count; b++) {
      const i = b * MESH_BATCH_LENGTH, from = batches[i + BATCH.uniformOffset], floats = batches[i + BATCH.uniformFloats];
      if (!floats) continue;
      const key = `${from},${floats}`;
      if (key !== last) { slots.push([from, floats, slots.length ? slots.at(-1)[2] + Math.ceil(slots.at(-1)[1] * 4 / 256) * 256 : 0]); last = key; }
      uniformOffsets[b] = slots.at(-1)[2];
    }
    const uniformBytes = (slots.length ? slots.at(-1)[2] + Math.ceil(slots.at(-1)[1] * 4 / 256) * 256 : 0) + MAX_MESH_UNIFORM_FLOATS * 4;
    const materialBytes = Math.max(256, count * 256), instanceBytes = Math.max(MESH_INSTANCE_LENGTH * 4, instances.byteLength);
    if (Math.max(materialBytes, instanceBytes, uniformBytes) > device.limits.maxBufferSize) throw new Error('Mesh pass exceeds WebGPU buffer limits');
    if (materialBytes > mesh3d.materialCapacity || uniformBytes > mesh3d.uniformCapacity) {
      if (materialBytes > mesh3d.materialCapacity) {
        mesh3d.materials?.destroy(); mesh3d.materialCapacity = materialBytes;
        mesh3d.materials = device.createBuffer({size: materialBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      }
      if (uniformBytes > mesh3d.uniformCapacity) {
        mesh3d.uniforms?.destroy(); mesh3d.uniformCapacity = uniformBytes;
        mesh3d.uniforms = device.createBuffer({size: uniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      }
      mesh3d.bindGroup = device.createBindGroup({layout: mesh3d.frameLayout, entries: [{binding: 0, resource: {buffer: mesh3d.frame, size: MESH_FRAME_LENGTH * 4}},
        {binding: 1, resource: {buffer: mesh3d.materials, size: MESH_MATERIAL_LENGTH * 4}}, {binding: 2, resource: {buffer: mesh3d.uniforms, size: MAX_MESH_UNIFORM_FLOATS * 4}}]});
    }
    for (const [from, floats, at] of slots) device.queue.writeBuffer(mesh3d.uniforms, at, uniforms.buffer, uniforms.byteOffset + from * 4, floats * 4);
    if (instanceBytes > mesh3d.instanceCapacity) {
      mesh3d.instances?.destroy(); mesh3d.instanceCapacity = instanceBytes;
      mesh3d.instances = device.createBuffer({size: instanceBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
    }
    if (count) {
      const data = new Float32Array(count * 64);
      for (let b = 0; b < count; b++) data.set(shaderMaterial(materials, b * MESH_MATERIAL_LENGTH, batches[b * MESH_BATCH_LENGTH + BATCH.flags], this.mesh(batches[b * MESH_BATCH_LENGTH]).layout), b * 64);
      device.queue.writeBuffer(mesh3d.materials, 0, data.buffer, 0, data.byteLength);
    }
    if (instances.byteLength) device.queue.writeBuffer(mesh3d.instances, 0, instances.buffer, instances.byteOffset, instances.byteLength);
    const colorTexture = output ? output.resource.texture : (this.texture = this.frameTexture());
    const colorView = output ? output.resource.attachment : null;
    // Post effects render the scene offscreen and run their chain into the destination: with clear the last step
    // replaces the destination's color; without, the scene starts transparent and goes over it.
    const depthTexture = post ? post.depth : output ? output.resource.depth : this.canvasDepth();
    let clearValue = null;
    if (clear) {
      const color = output ? clear.map(value => Math.max(0, Math.min(1, value))) : clear, alpha = output ? color[3] : 1;
      // Linear buffers hold the clear color decoded.
      const [r, g, b] = [color[0] * alpha, color[1] * alpha, color[2] * alpha].map(c => post?.hdr ? srgbDecode(c) : c);
      clearValue = {r, g, b, a: color[3]};
    } else if (post) clearValue = {r: 0, g: 0, b: 0, a: 0};
    // A texture target's area is cleared by writing its texels (a render pass clears the whole attachment) and kept
    // around it.
    if (partial && clearValue) {
      const [x, y, w, h] = area, format = output.resource.format, half = format.endsWith('16float'), bgra = format.startsWith('bgra');
      const channels = format.startsWith('rg') && !format.startsWith('rgba') ? 2 : format.startsWith('r') && !format.startsWith('rg') ? 1 : 4;
      const c = [clearValue.r, clearValue.g, clearValue.b, clearValue.a], texel = (bgra ? [c[2], c[1], c[0], c[3]] : c).slice(0, channels);
      const data = half ? new Uint16Array(w * h * channels) : new Uint8Array(w * h * channels), value = half ? texel.map(halfBits) : texel.map(v => Math.round(v * 255));
      for (let i = 0; i < data.length; i += channels) data.set(value, i);
      device.queue.writeTexture({texture: colorTexture, origin: {x, y}}, data, {bytesPerRow: w * (half ? 2 : 1) * channels, rowsPerImage: h}, {width: w, height: h});
      clearValue = null;
    }
    const attachment = {view: post ? (post.multisampled ?? post.resolved).createView() : colorView ?? colorTexture.createView(), loadOp: clearValue ? 'clear' : 'load', storeOp: 'store'};
    if (clearValue) attachment.clearValue = clearValue;
    if (post?.multisampled) { attachment.resolveTarget = post.resolved.createView(); attachment.storeOp = 'discard'; }
    const encoder = device.createCommandEncoder(), chain = post ? this.ensurePostChain(plan, post.hdr, frame) : null;
    const groups = Array.from({length: count}, (_, b) => this.materialGroup(this.batchTextures(batches, b * MESH_BATCH_LENGTH)));
    // Each batch's custom program (null for the built-in material), and the pipeline it draws with: its program's
    // when that is ready, else the built-in one for hooks and none for custom materials.
    const programs = Array.from({length: count}, (_, b) => this.batchProgram(batches, b * MESH_BATCH_LENGTH)?.resource ?? null);
    const choose = (program, made, builtIn) => program ? made() ?? (program.custom ? null : builtIn()) : builtIn();
    const stride = MESH_INSTANCE_LENGTH * 4;
    // Shadow passes: depth of everything casting shadows, seen from each shadowing light, each reading its own frame.
    shadows.forEach((shadow, k) => {
      if (!shadow) return;
      const depthPass = encoder.beginRenderPass({colorAttachments: [], depthStencilAttachment: {view: shadow.view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'}});
      for (let b = 0; b < count; b++) {
        const i = b * MESH_BATCH_LENGTH, mesh = this.mesh(batches[i]).resource, flags = batches[i + BATCH.flags]; if (!castsShadow(flags)) continue;
        const program = programs[b], chosen = choose(program, () => mesh3d.programShadow(program, flags, mesh.layout), () => mesh3d.shadowPipeline(flags, mesh.layout));
        if (!chosen) continue;
        depthPass.setPipeline(chosen);
        depthPass.setBindGroup(0, mesh3d.bindGroup, [(1 + k) * FRAME_SLOT, b * 256, uniformOffsets[b]]); depthPass.setBindGroup(1, groups[b]);
        depthPass.setVertexBuffer(0, mesh.vertexBuffer); depthPass.setVertexBuffer(1, this.batchInstances(batches, i, mesh3d.instances), batches[i + BATCH.first] * stride);
        drawMesh(depthPass, mesh, batches[i + BATCH.count], batches, i);
      }
      depthPass.end();
    });
    const shadowGroup = mesh3d.shadowGroup(shadows.map(shadow => shadow?.texture ?? mesh3d.noShadowTexture));
    // The scene-depth prepass: the opaque batches' view depth (far where none) into half floats, which the lit pass's
    // batches then read.
    if (prepass) {
      const depthPass = encoder.beginRenderPass({colorAttachments: [{view: prepass.texture.createView(), clearValue: {r: SCENE_DEPTH_FAR, g: 0, b: 0, a: 0}, loadOp: 'clear', storeOp: 'store'}],
        depthStencilAttachment: {view: prepass.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'}});
      depthPass.setBindGroup(2, shadowGroup);
      for (let b = 0; b < count; b++) {
        const i = b * MESH_BATCH_LENGTH; if (!this.writesSceneDepth(batches, i)) continue;
        const mesh = this.mesh(batches[i]).resource, flags = batches[i + BATCH.flags], program = programs[b], offset = polygonOffset(materials, b * MESH_MATERIAL_LENGTH);
        const chosen = choose(program, () => mesh3d.programLit(program, flags, mesh.layout, 1, offset, 'rgba16float'), () => mesh3d.pipeline(flags, mesh.layout, 1, offset, 'rgba16float'));
        if (!chosen) continue;
        depthPass.setPipeline(chosen);
        depthPass.setBindGroup(0, mesh3d.bindGroup, [prepassSlot, b * 256, uniformOffsets[b]]); depthPass.setBindGroup(1, groups[b]);
        depthPass.setVertexBuffer(0, mesh.vertexBuffer); depthPass.setVertexBuffer(1, this.batchInstances(batches, i, mesh3d.instances), batches[i + BATCH.first] * stride);
        drawMesh(depthPass, mesh, batches[i + BATCH.count], batches, i);
      }
      depthPass.end();
    }
    // A texture target without a depth buffer draws in order, with pipelines without depth state.
    const pass = encoder.beginRenderPass(depthTexture ? {colorAttachments: [attachment], depthStencilAttachment: {view: depthTexture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'}}
      : {colorAttachments: [attachment]});
    if (partial) { pass.setViewport(area[0], area[1], area[2], area[3], 0, 1); pass.setScissorRect(...area); }
    pass.setBindGroup(2, shadowGroup);
    const format = post ? post.format : output?.resource.format ?? this.format, samples = post?.multisampled ? 4 : 1, depth = !!depthTexture;
    for (let b = 0; b < count; b++) {
      const i = b * MESH_BATCH_LENGTH, mesh = this.mesh(batches[i]).resource, flags = batches[i + BATCH.flags], program = programs[b];
      const offset = polygonOffset(materials, b * MESH_MATERIAL_LENGTH);
      const custom = batches[i + BATCH.blend];
      const chosen = choose(program, () => mesh3d.programLit(program, flags, mesh.layout, samples, offset, format, depth, custom), () => mesh3d.pipeline(flags, mesh.layout, samples, offset, format, depth, custom));
      if (!chosen) continue;
      pass.setPipeline(chosen);
      pass.setBindGroup(0, mesh3d.bindGroup, [0, b * 256, uniformOffsets[b]]); pass.setBindGroup(1, groups[b]);
      pass.setVertexBuffer(0, mesh.vertexBuffer); pass.setVertexBuffer(1, this.batchInstances(batches, i, mesh3d.instances), batches[i + BATCH.first] * stride);
      drawMesh(pass, mesh, batches[i + BATCH.count], batches, i);
    }
    pass.end();
    if (post) {
      // Each step into its image, the scene or the destination; the occlusion prepass draws the batches that take part,
      // front faces only.
      const pipelines = this.postPipelines;
      plan.steps.forEach((step, slot) => {
        const view = step.target === 'scene' ? post.resolved.createView() : step.target === 'destination' ? colorTexture.createView() : chain.views[step.target];
        const color = {view, storeOp: 'store', loadOp: step.load === 'keep' ? 'load' : 'clear', clearValue: step.load.clear ? {r: step.load.clear[0], g: step.load.clear[1], b: step.load.clear[2], a: step.load.clear[3]} : {r: 0, g: 0, b: 0, a: 0}};
        if (step.program === 'normals') {
          const prepass = encoder.beginRenderPass({colorAttachments: [color], depthStencilAttachment: {view: chain.views[step.depth], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'}});
          for (let b = 0; b < count; b++) {
            const i = b * MESH_BATCH_LENGTH, mesh = this.mesh(batches[i]).resource, flags = batches[i + BATCH.flags]; if (flags & (MESH.points | MESH.noAO)) continue;
            const program = programs[b], chosen = choose(program, () => mesh3d.programNormals(program, flags, mesh.layout), () => pipelines.normals(flags, mesh.layout));
            if (!chosen) continue;
            prepass.setPipeline(chosen); prepass.setBindGroup(0, mesh3d.bindGroup, [0, b * 256, uniformOffsets[b]]);
            // A program's prepass reads its textures (the built-in one's layout has no group 1).
            if (program && chosen !== pipelines.normals(flags, mesh.layout)) prepass.setBindGroup(1, groups[b]);
            prepass.setVertexBuffer(0, mesh.vertexBuffer); prepass.setVertexBuffer(1, this.batchInstances(batches, i, mesh3d.instances), batches[i + BATCH.first] * stride);
            drawMesh(prepass, mesh, batches[i + BATCH.count], batches, i);
          }
          prepass.end(); return;
        }
        const format = step.target === 'scene' ? post.format : step.target === 'destination' ? this.format : chain.formats[step.target];
        const stepPass = encoder.beginRenderPass({colorAttachments: [color]});
        const pipeline = step.program === 'game' ? this.postGamePipeline(step.programId, format, step.blend) : pipelines.pipeline(step.program, format, step.blend);
        stepPass.setPipeline(pipeline); stepPass.setBindGroup(0, chain.groups[slot], [slot * 256]); stepPass.draw(3); stepPass.end();
      });
    }
    // A texture target's mip chain: each level drawn from the one before.
    if (output && output.resource.levels > 1) this.downsample(encoder, output.resource);
    if (output) device.queue.submit([encoder.finish()]); else this.encoder = encoder;
    return true;
  }
  // Levels 1.. of a mip-mapped target from level 0, each a linear halving of the one before, with a copying pipeline of
  // its format (made once).
  downsample(encoder, resource) {
    const device = this.device;
    this.downsamplers ??= new Map();
    let entry = this.downsamplers.get(resource.format);
    if (!entry) {
      const module = device.createShaderModule({code: WGSL});
      const pipeline = device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vs', buffers: [{arrayStride: 32, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x2'},
        {shaderLocation: 1, offset: 8, format: 'float32x4'}, {shaderLocation: 2, offset: 24, format: 'float32x2'}]}]},
        fragment: {module, entryPoint: 'fs', targets: [{format: resource.format}]}, primitive: {topology: 'triangle-list'}});
      entry = {pipeline, sampler: device.createSampler({magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'})};
      this.downsamplers.set(resource.format, entry);
    }
    for (let level = 1; level < resource.levels; level++) {
      const group = device.createBindGroup({layout: entry.pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: resource.texture.createView({baseMipLevel: level - 1, mipLevelCount: 1})},
        {binding: 1, resource: entry.sampler}]});
      const pass = encoder.beginRenderPass({colorAttachments: [{view: resource.texture.createView({baseMipLevel: level, mipLevelCount: 1}), loadOp: 'clear', clearValue: {r: 0, g: 0, b: 0, a: 0}, storeOp: 'store'}]});
      pass.setPipeline(entry.pipeline); pass.setVertexBuffer(0, resource.vertices); pass.setBindGroup(0, group); pass.draw(6); pass.end();
    }
  }
  compositeTarget(id){
    const entry=this.target(id);if(!this.ready)return false;
    if(this.encoder){this.device.queue.submit([this.encoder.finish()]);this.encoder=null;}
    this.texture=this.frameTexture();const encoder=this.device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.texture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(this.blitPipeline);pass.setVertexBuffer(0,entry.resource.vertices);pass.setBindGroup(0,entry.resource.bindGroup);pass.draw(6);pass.end();this.device.queue.submit([encoder.finish()]);return true;
  }
  // `pixels` packs `levels` mip levels, level 0 first: RGBA8 bytes or binary16 half floats (rgba16float).
  createTextureResource(width, height, pixels, levels = 1, sampler = 0) {
    const float = pixels instanceof Uint16Array, texel = float ? 8 : 4;
    const texture = this.device.createTexture({size: {width, height}, format: float ? 'rgba16float' : 'rgba8unorm', mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
    try {
      for (let level = 0, offset = 0; level < levels; level++) {
        const w = Math.max(1, width >> level), h = Math.max(1, height >> level);
        this.device.queue.writeTexture({texture, mipLevel: level}, pixels, {offset, bytesPerRow: w * texel, rowsPerImage: h}, {width: w, height: h}); offset += w * h * texel;
      }
      const resource = {texture, view: texture.createView(), levels, sampler: 0, serial: ++this.textureSerial};
      this.applyTextureSampler(resource, sampler);
      return resource;
    } catch (error) { texture.destroy(); throw error; }
  }
  // 2D and mesh bind groups follow the texture's sampler.
  applyTextureSampler(resource, sampler) {
    resource.sampler = sampler; this.dropTextureGroups(resource);
    resource.bindGroup = this.device.createBindGroup({layout: this.pipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: resource.view}, {binding: 1, resource: this.samplerFor(sampler)}]});
  }
  deleteTextureResource(resource) { this.dropTextureGroups(resource); resource.texture.destroy(); }
  // The frame persists across passes and awaits, as on the native backends
  // (a canvas hands out a fresh texture after each presentation); present
  // copies it onto the canvas.
  frameTexture() {
    const {width, height} = this.canvas;
    if (!this.frame || this.frame.width !== width || this.frame.height !== height) {
      this.frame?.destroy();
      this.frame = this.device.createTexture({size: {width, height}, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC});
    }
    return this.frame;
  }
  present() {
    if (!this.ready) return;
    const encoder = this.encoder || this.device.createCommandEncoder(); this.encoder = null;
    if (this.frame) {
      const canvas = this.context.getCurrentTexture();
      if (canvas.width === this.frame.width && canvas.height === this.frame.height) encoder.copyTextureToTexture({texture: this.frame}, {texture: canvas}, {width: this.frame.width, height: this.frame.height});
    }
    this.device.queue.submit([encoder.finish()]);
  }
  // The frame drawn so far (`renderer.capture`): its copy is queued now,
  // before anything else draws over it, and read once the GPU is done.
  captureFrame() {
    const texture = this.texture;
    if (!this.ready || !texture) throw new Error('No live WebGPU frame to capture');
    const {width, height} = texture, bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    if (this.encoder) { this.device.queue.submit([this.encoder.finish()]); this.encoder = null; }
    const buffer = this.device.createBuffer({size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture}, {buffer, bytesPerRow}, {width, height});
    this.device.queue.submit([encoder.finish()]);
    const bgra = this.format.startsWith('bgra');
    return buffer.mapAsync(GPUMapMode.READ).then(() => {
      const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        const from = y * bytesPerRow, to = y * width * 4;
        pixels.set(mapped.subarray(from, from + width * 4), to);
        if (bgra) for (let at = to; at < to + width * 4; at += 4) { const b = pixels[at]; pixels[at] = pixels[at + 2]; pixels[at + 2] = b; }
      }
      return {width, height, pixels};
    }).finally(() => buffer.destroy());
  }
  async readPixel(x, y) {
    if (!this.ready || !this.texture || x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) throw new Error('Pixel outside a live WebGPU surface');
    const buffer = this.device.createBuffer({size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture: this.texture, origin: {x, y: this.canvas.height - 1 - y}}, {buffer, bytesPerRow: 256}, {width: 1, height: 1});
      this.device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange()).slice(0, 4);
      return this.format.startsWith('bgra') ? new Uint8Array([bytes[2], bytes[1], bytes[0], bytes[3]]) : bytes;
    } finally { buffer.destroy(); }
  }
  destroy() {
    this.disposed = true; this.ready = false; this.clearTextures(); if (this.whiteTexture) this.whiteTexture.texture.destroy(); this.whiteTexture = null; if (this.buffer) this.buffer.destroy(); this.depthTexture?.destroy();
    for (let k = 0; k < MAX_SHADOWS; k++) this.releaseShadowMap(k);
    if (this.mesh3d) { this.mesh3d.frame.destroy(); this.mesh3d.materials?.destroy(); this.mesh3d.uniforms?.destroy(); this.mesh3d.instances?.destroy(); this.mesh3d.noShadowTexture.destroy(); this.mesh3d = null; }
    this.releasePost(); this.postPipelines?.parameters.destroy(); this.postPipelines = null; if (this.context) this.context.unconfigure(); this.frame?.destroy(); this.frame = null; this.device.destroy();
  }
  simulateLoss() { this.device.destroy(); }
}
// Each attempt gets a fresh canvas: a canvas that acquired WebGPU cannot later
// acquire WebGL2, even when adapter/device/surface initialization failed.
async function selectGraphics(createCanvas, {gpu = globalThis.navigator?.gpu, fallback = true, webgpuFactory = WebGPURenderer.create, webglFactory = WebGL2Renderer.create, onLost = () => {}, onRestored = () => {}} = {}) {
  const failures = [];
  try { const canvas = createCanvas(); const renderer = await webgpuFactory(canvas, gpu, onLost); return {canvas, renderer, failures}; }
  catch (error) { failures.push(`WebGPU: ${error.message || error}`); }
  if (fallback) {
    try { const canvas = createCanvas(); const renderer = await webglFactory(canvas, onLost, onRestored); return {canvas, renderer, failures}; }
    catch (error) { failures.push(`WebGL2: ${error.message || error}`); }
  }
  // The page shows this to the player (the runtime's error screen): what
  // is missing and what helps, the browser's own reasons last.
  throw new Error(`This browser cannot draw the game: it needs WebGPU${fallback ? ' or WebGL 2, and neither is available' : ', which is not available (the WebGL 2 fallback is off)'}. `
    + 'Open the game in a current Chrome, Edge, Firefox or Safari; if it still does not start, turn on hardware acceleration '
    + `(graphics acceleration) in the browser's settings and update the graphics driver. (${failures.join(' · ')})`);
}
return {classifyGpu, deviceKind, measureGraphics, MESH_FRAME_LENGTH, MESH_MATERIAL_LENGTH, MESH_BATCH_LENGTH, MESH_TEXTURES, MESH_INSTANCE_LENGTH, MESH_GAME_TEXTURES, MAX_MESH_UNIFORM_FLOATS, MAX_MESH_PROGRAMS, MESH_PROGRAM_STAGES, MESH_LAYOUT_FLOATS, MESH_COMPACT_LAYOUT, meshLayoutInfo, MAX_POST_PROGRAMS, MESH_INSTANCE_SLOTS, unpackBlend, validSampler, effectiveSampler, samplerAnisotropy, mipLevels, mipChainBytes, DEFAULT_EFFECT_BUDGET, POST_HDR_BYTES, POST_LDR_BYTES, POST_LDR_NOTE, shadowMapBytes, POST_AA, POST_LDR_OCCLUSION_NOTE, POST_LDR_GRADE_NOTE, POST_LDR_FLASH_NOTE, POST_LDR_PROGRAM_NOTE, postEffects, anyPostEffects, postPlan, postBytes, leaveOutOcclusion, leaveOutBloom, leaveOutGrade, leaveOutPostProgram, leaveOutLinearEffects, fitPost, postTable, fitShadows, validFloatTexture, NARROW_INDEX_VERTICES, meshIndexBytes, MESH_LIMITS, validateMesh, validateMeshPass, validateTriangles, validateBatches, TextureRenderer, WebGL2Renderer, WebGPURenderer, selectGraphics};
})();
// storage
const __storage = (() => {
// Browser preference snapshots are opaque Rust-validated bytes, not game progress.
class PreferenceStore {
  constructor({indexedDB = globalThis.indexedDB, storage = globalThis.navigator?.storage, maxBytes = 4 * 1024 * 1024, timeoutMs = 2000, onStatus = () => {}} = {}) {
    this.timeoutMs = timeoutMs; this.storage = storage; this.persisted = false;
    this.indexedDB = indexedDB; this.maxBytes = maxBytes; this.onStatus = onStatus; this.memory = new Map(); this.status = 'session-only'; this.database = null; this.pending = new Map(); this.writing = null;
  }
  async open() {
    try {
      if (!this.indexedDB) throw new Error('IndexedDB unavailable');
      this.database = await new Promise((resolve, reject) => {
        const request = this.indexedDB.open('starhermit-engine-preferences-v1', 1);
        let finished = false;
        const fail = error => { finished = true; clearTimeout(timer); reject(error); };
        const timer = setTimeout(() => fail(new Error('Preference storage timed out')), this.timeoutMs);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots'); };
        request.onsuccess = () => { clearTimeout(timer); if (finished) { request.result.close(); return; } finished = true; resolve(request.result); };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error('Preference storage upgrade blocked'));
      });
      this.database.onversionchange = () => { this.database.close(); this.database = null; this.setStatus('session-only', 'Storage version changed'); };
      this.setStatus('persistent');
      // Whether the browser may evict it; asked without prompting, and not
      // awaited (preferences hydrate before the window opens).
      Promise.resolve(this.storage?.persisted?.()).then(persisted => { this.persisted = Boolean(persisted); }, () => {});
    } catch (error) { this.setStatus('session-only', error.message); }
    return this;
  }
  setStatus(status, reason = '') { this.status = status; this.reason = reason; this.onStatus({status, reason}); }
  async transaction(mode, operation) {
    if (!this.database) throw new Error('Persistent preference storage is unavailable');
    const database = this.database;
    return new Promise((resolve, reject) => {
      let transaction;
      try { transaction = database.transaction('snapshots', mode, {durability: 'strict'}); }
      catch { transaction = database.transaction('snapshots', mode); }
      let value; const timer = setTimeout(() => { try { transaction.abort(); } catch {} reject(new Error('Preference transaction timed out')); }, this.timeoutMs);
      try { operation(transaction.objectStore('snapshots'), result => { value = result; }); }
      catch (error) { clearTimeout(timer); try { transaction.abort(); } catch {} reject(error); return; }
      transaction.oncomplete = () => { clearTimeout(timer); resolve(value); };
      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error('Preference transaction failed')); };
    });
  }
  // `fresh` reads the database even when this page holds a copy: another
  // tab may have written since (a takeover hands the partition over).
  async load(key, {fresh = false} = {}) {
    if (this.memory.has(key) && !(fresh && this.database)) return this.memory.get(key).slice();
    if (!this.database) return null;
    try {
      const value = await this.transaction('readonly', (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result); });
      if (value === undefined) return null;
      if (!(value instanceof ArrayBuffer) || value.byteLength > this.maxBytes) throw new Error('Invalid preference snapshot or byte budget exceeded');
      const bytes = new Uint8Array(value); this.validate(key, bytes); this.memory.set(key, bytes); return bytes.slice();
    } catch (error) {
      // A failed read is not an empty cache. Block overwriting that persistent
      // partition and let the player continue with session-only preferences.
      this.setStatus('session-only', error.message); this.database?.close(); this.database = null; throw error;
    }
  }
  validate(key, bytes) {
    if (typeof key !== 'string' || !key.length || key.length > 4096) throw new Error('Invalid preference partition');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxBytes) throw new Error('Preference snapshot byte budget exceeded');
    if (!this.memory.has(key) && this.memory.size >= 32) throw new Error('Preference partition budget exceeded');
    let total = bytes.byteLength;
    for (const [other, value] of this.memory) if (other !== key) total += value.byteLength;
    if (total > 16 * 1024 * 1024) throw new Error('Preference session byte budget exceeded');
  }
  async save(key, bytes) {
    this.validate(key, bytes);
    this.memory.set(key, bytes.slice());
    if (!this.database) return;
    try { await this.transaction('readwrite', store => store.put(bytes.slice().buffer, key)); }
    catch (error) { this.setStatus('session-only', error.message); this.database?.close(); this.database = null; }
  }
  // Writes in order, one at a time; while one is in flight, each partition's
  // newest queued snapshot replaces its older one (a game's exit write may
  // queue several partitions at once).
  queue(key, bytes) {
    this.validate(key, bytes);
    this.pending.delete(key); this.pending.set(key, bytes.slice());
    if (!this.writing) {
      this.writing = (async () => { while (this.pending.size) { const [key, bytes] = this.pending.entries().next().value; this.pending.delete(key); await this.save(key, bytes); } })()
        .finally(() => { this.writing = null; });
    }
    return this.writing;
  }
  async flush() { if (this.writing) await this.writing; }
  // Drops a partition's queued snapshot that has not started (the game's
  // worker writes a newer one itself as the game quits).
  forget(key) { this.pending.delete(key); }
  close() { this.database?.close(); this.database = null; }
}
return {PreferenceStore};
})();
// assets
const __assets = (() => {
// Async I/O never retains a WASM memory view. Rust copies completed bytes itself.
// Taken before a game's code runs: in the game's worker the game has its own
// TextEncoder and timers (natives), which the fetcher must not call.
const TextEncoderNow = globalThis.TextEncoder;
const setTimeoutNow = globalThis.setTimeout.bind(globalThis), clearTimeoutNow = globalThis.clearTimeout.bind(globalThis);
class AssetFetcher {
  constructor({baseURL = new URL('.', globalThis.location?.href || 'http://localhost/').href, fetch: fetcher = globalThis.fetch,
    maxRequests = 32, maxBytes = 64 * 1024 * 1024, maxReadBytes = 16 * 1024 * 1024,
    timeoutMs = 10000, onReady = () => {}} = {}) {
    if (![maxRequests, maxBytes, maxReadBytes, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid asset fetch budget');
    this.base = new URL(baseURL); if (!['http:', 'https:', 'file:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('Invalid asset base URL');
    if (!this.base.pathname.endsWith('/')) this.base.pathname += '/';
    this.fetcher = fetcher.bind(globalThis); this.maxRequests = maxRequests; this.maxBytes = maxBytes; this.maxReadBytes = maxReadBytes; this.timeoutMs = timeoutMs; this.onReady = onReady;
    this.requests = new Map(); this.reservedBytes = 0; this.nextId = 1; this.closed = false;
  }
  begin(path, limit) {
    if (this.closed) throw new Error('Asset source is closed');
    if (typeof path !== 'string' || !path.length || new TextEncoderNow().encode(path).length > 4096 || /[\\:\x00-\x1f\x7f-\x9f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid asset path');
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > this.maxReadBytes) throw new Error('Asset read byte budget exceeded');
    // Download chunks and final assembly can coexist, so reserve twice the limit.
    const reservation = 2 * limit;
    if (this.requests.size >= this.maxRequests || reservation > this.maxBytes - this.reservedBytes) throw new Error('Asset fetch concurrency or memory budget exceeded');
    const url = new URL(path.split('/').map(encodeURIComponent).join('/'), this.base);
    if (this.nextId > 0xffffffff) throw new Error('Asset request identity exhausted');
    const id = this.nextId++; const controller = new AbortController(); let rejectStop;
    const stopped = new Promise((_, reject) => {rejectStop = reject;}); stopped.catch(() => {});
    const record = {id, path, limit, controller, stopped, rejectStop, status: 0, error: '', data: null, reader: null, reservation};
    this.requests.set(id, record); this.reservedBytes += reservation;
    record.timer = setTimeoutNow(() => this.fail(record, new Error('Asset download deadline exceeded')), this.timeoutMs);
    this.download(record, url).catch(error => this.fail(record, error));
    return id;
  }
  current(record) {return this.requests.get(record.id) === record && record.status === 0;}
  release(record, retained = 0) {this.reservedBytes += retained - record.reservation; record.reservation = retained;}
  notify(record) {try {this.onReady(record.id);} catch {} }
  fail(record, error) {
    if (!this.current(record)) return;
    record.status = 2; record.error = `Asset '${record.path}': ${String(error.message || error)}`.slice(0, 4096); clearTimeoutNow(record.timer); this.release(record);
    record.rejectStop(error); record.controller.abort(); record.reader?.cancel().catch(() => {}); this.notify(record);
  }
  async wait(record, promise) {return Promise.race([promise, record.stopped]);}
  async download(record, url) {
    const response = await this.wait(record, this.fetcher(url.href, {signal:record.controller.signal, credentials:'omit', redirect:'error'}));
    if (!this.current(record)) return;
    if (!response.ok) throw new Error(`Asset download failed (${response.status})`);
    if ((!response.headers.get('Content-Encoding') || response.headers.get('Content-Encoding') === 'identity') && Number(response.headers.get('Content-Length')) > record.limit) {response.body?.cancel().catch(() => {}); throw new Error('Asset download byte budget exceeded');}
    const chunks = []; let total = 0;
    if (response.body) {
      const reader = response.body.getReader(); record.reader = reader;
      try {
        while (true) {
          const {done, value} = await this.wait(record, reader.read());
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('Invalid asset response chunk');
          total += value.byteLength;
          if (total > record.limit) throw new Error('Asset download byte budget exceeded');
          chunks.push(value);
        }
      } finally {
        if (!this.current(record) || total > record.limit) reader.cancel().catch(() => {});
        reader.releaseLock(); record.reader = null;
      }
    } else {
      const bytes = new Uint8Array(await this.wait(record, response.arrayBuffer()));
      total = bytes.byteLength; if (total > record.limit) throw new Error('Asset download byte budget exceeded'); chunks.push(bytes);
    }
    if (!this.current(record)) return;
    const data = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.byteLength;}
    chunks.length = 0;
    record.data = data; record.status = 1; clearTimeoutNow(record.timer); this.release(record, total); this.notify(record);
  }
  record(id) {const record = this.requests.get(id); if (!record) throw new Error('Unknown asset request'); return record;}
  poll(id) {return this.record(id).status;}
  length(id) {const record = this.record(id); if (record.status !== 1) throw new Error('Asset request is not ready'); return record.data.byteLength;}
  copy(id, offset, destination) {
    const record = this.record(id);
    if (record.status !== 1 || !(destination instanceof Uint8Array) || destination.byteLength > 65536 || !Number.isSafeInteger(offset) || offset < 0 || offset + destination.byteLength > record.data.byteLength) throw new Error('Invalid asset result range');
    destination.set(record.data.subarray(offset, offset + destination.byteLength)); return destination.byteLength;
  }
  error(id) {return this.record(id).error;}
  cancel(id) {
    const record = this.requests.get(id); if (!record) return;
    this.requests.delete(id); clearTimeoutNow(record.timer); this.release(record); record.data = null;
    record.rejectStop(new Error('Asset request cancelled')); record.controller.abort(); record.reader?.cancel().catch(() => {});
  }
  close() {this.closed = true; for (const id of this.requests.keys()) this.cancel(id);}
}

// A single owned download for auxiliary modules; shares fetch deadlines,
// streamed byte checks, URL policy and cancellation with runtime assets.
async function fetchAssetBytes(url,{fetch=globalThis.fetch,limit=16*1024*1024,timeoutMs=10000}={}) {
  const resolved=new URL(url,globalThis.location?.href||'http://localhost/');
  if(resolved.search||resolved.hash)throw new Error('Asset URL must not contain query or fragment');
  const name=decodeURIComponent(resolved.pathname.slice(resolved.pathname.lastIndexOf('/')+1));
  if(name.includes('/')||name.includes('\\'))throw new Error('Invalid asset file name');
  let ready;const result=new Promise((resolve,reject)=>{ready={resolve,reject};});
  const fetcher=new AssetFetcher({baseURL:new URL('.',resolved).href,fetch,maxRequests:1,maxBytes:2*limit,maxReadBytes:limit,timeoutMs,onReady:id=>{
    const record=fetcher.record(id);if(record.status===1)ready.resolve(record.data);else ready.reject(new Error(record.error));
  }});
  try{fetcher.begin(name,limit);return await result;}finally{fetcher.close();}
}
return {AssetFetcher, fetchAssetBytes};
})();
// http
const __http = (() => {
// Same-origin StarHermit API requests for WASM games, and launch-credential
// capture. Hosted games are served from their own <id>.starhermit.com origin,
// which proxies /api, so requests never leave the page's origin.
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const REQUEST_HEADERS = new Set(['authorization', 'content-type', 'accept', 'if-match', 'if-none-match']);
const RESPONSE_HEADERS = ['content-type', 'etag', 'retry-after', 'date'];
const KEEPALIVE_QUOTA = 64 * 1024;
const HOST_SUFFIX = '.starhermit.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequestHead(head) {
  if (typeof head !== 'string' || head.length > 65536) throw new Error('Invalid API request head');
  const lines = head.split('\n'); if (lines.at(-1) === '') lines.pop();
  const [method, path, ...rest] = (lines.shift() || '').split(' ');
  if (!METHODS.has(method) || rest.length) throw new Error('Unsupported API request method');
  if (!/^\/api\/v1\/[\x21-\x7e]*$/.test(path) || /[#\\]/.test(path) || path.split('?')[0].split('/').some(part => /^(\.|%2e){1,2}$/i.test(part)))
    throw new Error('API requests must use same-origin /api/v1/ paths');
  if (lines.length > 32) throw new Error('Too many API request headers');
  const headers = new Headers();
  for (const line of lines) {
    const split = line.indexOf(':'); const name = line.slice(0, split).trim().toLowerCase(); const value = line.slice(split + 1).trim();
    if (split < 1 || !REQUEST_HEADERS.has(name) || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`API request header not allowed: ${name || '(invalid)'}`);
    headers.set(name, value);
  }
  return {method, path, headers};
}

class ApiFetcher {
  constructor({origin = globalThis.location?.origin, fetch: fetcher = globalThis.fetch, maxRequests = 16, maxBytes = 96 * 1024 * 1024,
    maxBodyBytes = 16 * 1024 * 1024, maxResponseBytes = 32 * 1024 * 1024, timeoutMs = 30000, onReady = () => {}} = {}) {
    if (![maxRequests, maxBytes, maxBodyBytes, maxResponseBytes, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid API fetch budget');
    const base = new URL(origin || 'null');
    if (!['http:', 'https:'].includes(base.protocol) || base.origin !== origin) throw new Error('Invalid API origin');
    this.origin = base.origin; this.fetcher = fetcher.bind(globalThis); this.maxRequests = maxRequests; this.maxBytes = maxBytes;
    this.maxBodyBytes = maxBodyBytes; this.maxResponseBytes = maxResponseBytes; this.timeoutMs = timeoutMs; this.onReady = onReady;
    this.requests = new Map(); this.reservedBytes = 0; this.nextId = 1; this.closed = false; this.keepaliveBytes = 0;
  }
  // `keepalive` requests (a lifecycle exit's last writes) may outlive the
  // page; their bodies in flight share the browser's 64 KiB quota, and
  // cancelling or closing forgets them without aborting.
  begin(head, body, limit, keepalive = false) {
    if (this.closed) throw new Error('API client is closed');
    const {method, path, headers} = parseRequestHead(head);
    if (!(body instanceof Uint8Array) || body.byteLength > this.maxBodyBytes) throw new Error('API request body budget exceeded');
    if (body.byteLength && (method === 'GET' || method === 'DELETE')) throw new Error('API request body not allowed');
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > this.maxResponseBytes) throw new Error('API response byte budget exceeded');
    if (keepalive && this.keepaliveBytes + body.byteLength > KEEPALIVE_QUOTA) throw new Error('API keepalive quota exceeded');
    const reservation = 2 * limit + body.byteLength;
    if (this.requests.size >= this.maxRequests || reservation > this.maxBytes - this.reservedBytes) throw new Error('API concurrency or memory budget exceeded');
    const url = new URL(path, this.origin); if (url.origin !== this.origin || !url.pathname.startsWith('/api/v1/')) throw new Error('API requests must stay on the page origin');
    if (this.nextId > 0xffffffff) throw new Error('API request identity exhausted');
    const id = this.nextId++; const controller = new AbortController(); let rejectStop;
    const stopped = new Promise((_, reject) => {rejectStop = reject;}); stopped.catch(() => {});
    const record = {id, limit, controller, stopped, rejectStop, state: 0, status: 0, head: '', error: '', data: null, reader: null, reservation, keepalive: keepalive ? body.byteLength : null};
    this.requests.set(id, record); this.reservedBytes += reservation; if (keepalive) this.keepaliveBytes += body.byteLength;
    record.timer = setTimeout(() => this.fail(record, new Error('API request deadline exceeded')), this.timeoutMs);
    // The body is copied out of WASM memory before the import returns.
    const init = {method, headers, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'};
    if (keepalive) init.keepalive = true;
    if (body.byteLength) init.body = body.slice();
    this.download(record, url, init).catch(error => this.fail(record, error));
    return id;
  }
  current(record) {return this.requests.get(record.id) === record && record.state === 0;}
  release(record, retained = 0) {
    this.reservedBytes += retained - record.reservation; record.reservation = retained;
    if (record.keepalive !== null) {this.keepaliveBytes -= record.keepalive; record.keepalive = null;}
  }
  notify(record) {try {this.onReady(record.id);} catch {} }
  fail(record, error) {
    if (!this.current(record)) return;
    // Messages never include request headers, so credentials cannot leak here.
    record.state = 2; record.error = `API request failed: ${String(error?.message || error)}`.slice(0, 4096); clearTimeout(record.timer); this.release(record);
    record.rejectStop(error); record.controller.abort(); record.reader?.cancel().catch(() => {}); this.notify(record);
  }
  async download(record, url, init) {
    const wait = promise => Promise.race([promise, record.stopped]);
    const response = await wait(this.fetcher(url.href, init));
    if (!this.current(record)) return;
    if (response.type === 'opaqueredirect' || response.redirected || response.status < 100) throw new Error('API redirects are not followed');
    const encoding = response.headers.get('Content-Encoding');
    if ((!encoding || encoding === 'identity') && Number(response.headers.get('Content-Length')) > record.limit) {response.body?.cancel().catch(() => {}); throw new Error('API response byte budget exceeded');}
    const chunks = []; let total = 0;
    if (response.body) {
      const reader = response.body.getReader(); record.reader = reader;
      try {
        while (true) {
          const {done, value} = await wait(reader.read());
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('Invalid API response chunk');
          total += value.byteLength; if (total > record.limit) throw new Error('API response byte budget exceeded');
          chunks.push(value);
        }
      } finally {
        if (!this.current(record) || total > record.limit) reader.cancel().catch(() => {});
        reader.releaseLock(); record.reader = null;
      }
    } else {
      const bytes = new Uint8Array(await wait(response.arrayBuffer()));
      total = bytes.byteLength; if (total > record.limit) throw new Error('API response byte budget exceeded'); chunks.push(bytes);
    }
    if (!this.current(record)) return;
    const data = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.byteLength;}
    record.status = response.status;
    record.head = RESPONSE_HEADERS.map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null && !/[\r\n]/.test(value)).map(([name, value]) => `${name}: ${value}\n`).join('');
    record.data = data; record.state = 1; clearTimeout(record.timer); this.release(record, total); this.notify(record);
  }
  record(id) {const record = this.requests.get(id); if (!record) throw new Error('Unknown API request'); return record;}
  poll(id) {return this.record(id).state;}
  ready(id) {const record = this.record(id); if (record.state !== 1) throw new Error('API request is not ready'); return record;}
  status(id) {return this.ready(id).status;}
  head(id) {return this.ready(id).head;}
  length(id) {return this.ready(id).data.byteLength;}
  copy(id, offset, destination) {
    const record = this.ready(id);
    if (!(destination instanceof Uint8Array) || destination.byteLength > 65536 || !Number.isSafeInteger(offset) || offset < 0 || offset + destination.byteLength > record.data.byteLength) throw new Error('Invalid API result range');
    destination.set(record.data.subarray(offset, offset + destination.byteLength)); return destination.byteLength;
  }
  error(id) {return this.record(id).error;}
  cancel(id) {
    const record = this.requests.get(id); if (!record) return;
    // A keepalive request is meant to outlive its caller: forget it only.
    const outlive = record.keepalive !== null && record.state === 0;
    this.requests.delete(id); clearTimeout(record.timer); this.release(record); record.data = null;
    if (outlive) return;
    record.rejectStop(new Error('API request cancelled')); record.controller.abort(); record.reader?.cancel().catch(() => {});
  }
  close() {this.closed = true; for (const id of this.requests.keys()) this.cancel(id);}
}

// The hosted game's id from its `<id>.starhermit.com` origin, if any.
function hostedGameId(hostname = globalThis.location?.hostname || '') {
  const id = hostname.endsWith(HOST_SUFFIX) ? hostname.slice(0, -HOST_SUFFIX.length) : '';
  return UUID.test(id) ? id.toLowerCase() : null;
}

// Captures `#game_token` (launcher) or `#access_token` (game sign-in) before
// the game routes, removes authentication data from history, and restores
// a `game_fragment`. The token is held only until the game takes it, with
// the launch's `session_id` (the game's launch context). A `session_id`
// without a token leaves the address too: a guest has no session to open.
function captureLaunch(win = globalThis.window) {
  const location = win?.location; if (!location) return null;
  const fragment = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  const launcher = fragment.get('game_token'); const token = launcher || fragment.get('access_token');
  if (!token) {
    if (fragment.has('session_id')) {
      // The rest stays as written (the game's own fragment need not be a query).
      const rest = String(location.hash || '').replace(/^#/, '').split('&').filter(part => !/^session_id(=|$)/.test(part)).join('&');
      try {win.history?.replaceState(win.history.state, '', location.pathname + location.search + (rest ? `#${rest}` : ''));} catch {}
    }
    return null;
  }
  const restore = fragment.get('game_fragment'); const sessionId = fragment.get('session_id') || '';
  for (const name of ['game_token', 'access_token', 'token_type', 'expires_in', 'session_id', 'game_fragment']) fragment.delete(name);
  const rest = restore !== null ? restore.replace(/^#/, '') : fragment.toString();
  try {win.history?.replaceState(win.history.state, '', location.pathname + location.search + (rest ? `#${rest}` : ''));} catch {}
  if (/[\s]/.test(token) || token.length > 16384 || /[\r\n]/.test(sessionId)) return null;
  return {kind: launcher ? 'launcher' : 'sign-in', token, sessionId, game: hostedGameId(location.hostname) || ''};
}
return {parseRequestHead, ApiFetcher, hostedGameId, captureLaunch};
})();
// sockets
const __sockets = (() => {
// Same-origin WebSockets for WASM games. Hosted games are served from their
// own <id>.starhermit.com origin, which proxies /ws, so sockets open only to
// the page's origin and only on /ws/v1/ paths. Received messages wait in a
// bounded queue until WASM polls them; size limits apply both ways.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

function parseSocketPath(path) {
  if (typeof path !== 'string' || path.length > 8192 || !/^\/ws\/v1\/[\x21-\x7e]*$/.test(path) || /[#\\]/.test(path)
    || path.split('?')[0].split('/').some(part => /^(\.|%2e){1,2}$/i.test(part)))
    throw new Error('Sockets must use same-origin /ws/v1/ paths');
  return path;
}

class SocketHub {
  constructor({origin = globalThis.location?.origin, WebSocket: Socket = globalThis.WebSocket, maxSockets = 8,
    maxQueuedBytes = 1024 * 1024, maxBufferedBytes = 1024 * 1024, onReady = () => {}} = {}) {
    if (![maxSockets, maxQueuedBytes, maxBufferedBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid socket budget');
    const base = new URL(origin || 'null');
    if (!['http:', 'https:'].includes(base.protocol) || base.origin !== origin) throw new Error('Invalid socket origin');
    if (typeof Socket !== 'function') throw new Error('WebSocket is unavailable');
    this.origin = base; this.Socket = Socket; this.maxSockets = maxSockets; this.maxQueuedBytes = maxQueuedBytes;
    this.maxBufferedBytes = maxBufferedBytes; this.onReady = onReady; this.sockets = new Map(); this.nextId = 1; this.closed = false;
  }
  open(path, maxText, maxBinary) {
    if (this.closed) throw new Error('Socket hub is closed');
    parseSocketPath(path);
    if (![maxText, maxBinary].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 16 * 1024 * 1024)) throw new Error('Invalid socket limits');
    if (this.sockets.size >= this.maxSockets) throw new Error('Too many sockets');
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin.origin || !url.pathname.startsWith('/ws/v1/')) throw new Error('Sockets must stay on the page origin');
    url.protocol = this.origin.protocol === 'https:' ? 'wss:' : 'ws:';
    if (this.nextId > 0xffffffff) throw new Error('Socket identity exhausted');
    const id = this.nextId++;
    const record = {id, state: 0, queue: [], queuedBytes: 0, maxText, maxBinary, socket: null, ending: null};
    const socket = new this.Socket(url.href); record.socket = socket; socket.binaryType = 'arraybuffer';
    this.sockets.set(id, record);
    socket.onopen = () => {if (this.current(record)) {record.state = 1; this.notify(record);}};
    socket.onmessage = event => this.receive(record, event.data);
    socket.onerror = () => {};
    socket.onclose = event => {
      if (!this.current(record)) return;
      // A refused upgrade and a dropped connection both report 1006 here.
      const code = record.ending?.code ?? (event.code === 1005 || event.code === 1006 ? 0 : event.code);
      const reason = record.ending?.reason ?? String(event.reason || '').slice(0, 123);
      record.queue.push({kind: 3, bytes: encoder.encode(reason), code}); record.state = 2; this.notify(record);
    };
    return id;
  }
  current(record) {return this.sockets.get(record.id) === record && record.state !== 2;}
  notify(record) {try {this.onReady(record.id);} catch {} }
  receive(record, data) {
    if (!this.current(record) || record.ending) return;
    const text = typeof data === 'string';
    const bytes = text ? encoder.encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : null;
    if (!bytes) return;
    if (bytes.byteLength > (text ? record.maxText : record.maxBinary)) return this.end(record, 1009, 'message too big', 1009);
    // A game that stops polling is disconnected rather than buffering forever.
    if (record.queuedBytes + bytes.byteLength > this.maxQueuedBytes) return this.end(record, 1001, 'receive queue full', 0);
    record.queue.push({kind: text ? 1 : 2, bytes}); record.queuedBytes += bytes.byteLength; this.notify(record);
  }
  end(record, code, reason, reported) {
    record.ending = {code: reported, reason};
    try {record.socket.close(code, reason);} catch {}
  }
  record(id) {const record = this.sockets.get(id); if (!record) throw new Error('Unknown socket'); return record;}
  state(id) {return this.record(id).state;}
  send(id, kind, bytes) {
    const record = this.record(id);
    if (record.state !== 1 || record.ending) throw new Error('Socket is not open');
    if (!(bytes instanceof Uint8Array) || ![1, 2].includes(kind)) throw new Error('Invalid socket message');
    if (bytes.byteLength > (kind === 1 ? record.maxText : record.maxBinary)) throw new Error('Socket message too big');
    if (record.socket.bufferedAmount + bytes.byteLength > this.maxBufferedBytes) throw new Error('Socket send buffer full');
    // Copied out of WASM memory before the import returns.
    record.socket.send(kind === 1 ? decoder.decode(bytes) : bytes.slice());
    return 1;
  }
  next(id) {return this.record(id).queue[0] || null;}
  pop(id) {
    const record = this.record(id); const event = record.queue.shift();
    if (event && event.kind !== 3) record.queuedBytes -= event.bytes.byteLength;
  }
  close(id, code, reason) {
    const record = this.record(id);
    if (record.state === 2 || record.ending) return;
    if (!(code === 1000 || (code >= 3000 && code <= 4999))) throw new Error('Invalid close code');
    record.ending = {code, reason: String(reason).slice(0, 123)};
    try {record.socket.close(code, record.ending.reason);} catch {}
  }
  release(id) {
    const record = this.sockets.get(id); if (!record) return;
    this.sockets.delete(id);
    if (record.socket.readyState < 2) {try {record.socket.close(1000, '');} catch {} }
    record.socket.onopen = record.socket.onmessage = record.socket.onclose = record.socket.onerror = null;
  }
  closeAll() {this.closed = true; for (const id of [...this.sockets.keys()]) this.release(id);}
}
return {parseSocketPath, SocketHub};
})();
// instance
const __instance = (() => {
// One active game instance per environment, game and account, elected with
// the Web Locks API. A later tab can ask the active one to hand over: the
// request travels on a BroadcastChannel, the holder releases its sockets and
// outbox and then the lock, and the new tab takes it. A holder that does not
// answer (a frozen tab) loses the lock to a steal after a timeout.
const PENDING = 0, ACTIVE = 1, ELSEWHERE = 2, HANDOVER_REQUESTED = 3, RELEASED = 4, WAITING = 5;

class InstanceElection {
  constructor({locks = globalThis.navigator?.locks, BroadcastChannel: Channel = globalThis.BroadcastChannel,
    takeoverTimeoutMs = 5000, onChange = () => {}} = {}) {
    if (!Number.isSafeInteger(takeoverTimeoutMs) || takeoverTimeoutMs < 0) throw new Error('Invalid takeover timeout');
    this.locks = locks; this.Channel = Channel; this.takeoverTimeoutMs = takeoverTimeoutMs; this.onChange = onChange;
    this.claims = new Map(); this.nextId = 1;
  }
  // Without Web Locks (an old browser or an insecure context) nothing can be
  // coordinated, so every instance is active.
  get coordinated() {return typeof this.locks?.request === 'function';}
  claim(scope) {
    if (typeof scope !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(scope)) throw new Error('Invalid instance scope');
    if (this.nextId > 0xffffffff) throw new Error('Instance claims exhausted');
    const id = this.nextId++;
    const record = {id, name: `starhermit-instance:${scope}`, state: PENDING, release: null, channel: null, timer: null};
    this.claims.set(id, record);
    if (!this.coordinated) {record.state = ACTIVE; return id;}
    if (typeof this.Channel === 'function') {
      record.channel = new this.Channel(record.name);
      record.channel.onmessage = event => {
        if (event.data?.type === 'takeover' && record.state === ACTIVE) this.set(record, HANDOVER_REQUESTED);
      };
    }
    this.request(record, {ifAvailable: true});
    return id;
  }
  set(record, state) {
    if (this.claims.get(record.id) !== record) return;
    record.state = state; try {this.onChange(record.id, state);} catch {}
  }
  // Holds the lock until `release`; a lock lost to a steal ends as RELEASED.
  request(record, options) {
    this.locks.request(record.name, {mode: 'exclusive', ...options}, lock => {
      if (this.claims.get(record.id) !== record || record.state === RELEASED) return undefined;
      if (!lock) {this.set(record, ELSEWHERE); return undefined;}
      clearTimeout(record.timer); record.timer = null;
      this.set(record, ACTIVE);
      return new Promise(resolve => {record.release = resolve;});
    }).catch(() => {
      // AbortError: another instance stole the lock.
      if (this.claims.get(record.id) === record && record.state !== RELEASED) {record.release = null; this.set(record, RELEASED);}
    });
  }
  state(id) {return this.record(id).state;}
  record(id) {const record = this.claims.get(id); if (!record) throw new Error('Unknown instance claim'); return record;}
  // Asks the active instance to hand over, waits for the lock, and steals
  // it if the holder does not release in time.
  takeover(id) {
    const record = this.record(id);
    if (record.state !== ELSEWHERE) throw new Error('No other instance to take over from');
    this.set(record, WAITING);
    record.channel?.postMessage({type: 'takeover'});
    this.request(record, {});
    record.timer = setTimeout(() => {
      if (this.claims.get(record.id) === record && record.state === WAITING) this.request(record, {steal: true});
    }, this.takeoverTimeoutMs);
    return 1;
  }
  // Ends this instance's claim, releasing the lock if held.
  release(id) {
    const record = this.claims.get(id); if (!record) return;
    clearTimeout(record.timer); record.channel?.close();
    const release = record.release; record.release = null;
    this.set(record, RELEASED); this.claims.delete(id);
    release?.();
  }
  close() {for (const id of [...this.claims.keys()]) this.release(id);}
}
return {InstanceElection};
})();
// saves
const __saves = (() => {
// Durable browser save slots: one IndexedDB record per partition and slot,
// mirrored in memory so the game reads synchronously. Writes apply to memory
// at once and persist in order; a failed write reports session-only status
// and the cloud copy stays the durable one.
const SLOTS = ['current', 'previous', 'remote', 'record'];

class SaveSlots {
  constructor({indexedDB = globalThis.indexedDB, storage = globalThis.navigator?.storage, maxSlotBytes = 16 * 1024 * 1024,
    maxPartitionBytes = 48 * 1024 * 1024, timeoutMs = 5000, onStatus = () => {}} = {}) {
    this.indexedDB = indexedDB; this.storage = storage; this.maxSlotBytes = maxSlotBytes; this.maxPartitionBytes = maxPartitionBytes;
    this.timeoutMs = timeoutMs; this.onStatus = onStatus; this.database = null; this.partition = null; this.slots = new Map(); this.memory = new Map();
    this.status = 'session-only'; this.reason = ''; this.persisted = false; this.readFailed = true; this.queue = Promise.resolve(); this.generation = 0;
    this.retired = false;
  }
  // Writes a partition's slots (`[slot, bytes or null]`) in one transaction
  // without opening it: the game's worker, as the game quits, writes the
  // slots with its last save itself (the page takes no more of its
  // messages and drops its own writes still waiting: `retire`).
  static async keep(partition, entries, {indexedDB = globalThis.indexedDB, timeoutMs = 5000} = {}) {
    const slots = new SaveSlots({indexedDB, storage: null, timeoutMs});
    try {
      await slots.connect();
      await slots.transaction('readwrite', store => {
        for (const [slot, bytes] of entries) {
          if (!SLOTS.includes(slot)) continue;
          const key = `${partition}\n${slot}`;
          if (bytes instanceof Uint8Array) store.put(bytes.slice().buffer, key); else store.delete(key);
        }
      });
    } finally { slots.close(); }
  }
  // The game's worker writes the slots as the game quits: writes waiting
  // here (older) are dropped, until a partition opens again.
  retire() { this.retired = true; }
  setStatus(status, reason = '') { this.status = status; this.reason = reason; try { this.onStatus({status, reason, persisted: this.persisted}); } catch {} }
  async connect() {
    if (this.database || !this.indexedDB) return this.database;
    this.database = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open('starhermit-engine-saves-v1', 1); let finished = false;
      const fail = error => { if (finished) return; finished = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => fail(new Error('Save storage timed out')), this.timeoutMs);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('slots')) request.result.createObjectStore('slots'); };
      request.onsuccess = () => { clearTimeout(timer); if (finished) { request.result.close(); return; } finished = true; resolve(request.result); };
      request.onerror = () => fail(request.error || new Error('Save storage failed to open'));
      request.onblocked = () => fail(new Error('Save storage upgrade blocked'));
    });
    this.database.onversionchange = () => { this.database?.close(); this.database = null; this.setStatus('session-only', 'Save storage version changed'); };
    return this.database;
  }
  transaction(mode, operation) {
    const database = this.database; if (!database) return Promise.reject(new Error('Save storage is unavailable'));
    return new Promise((resolve, reject) => {
      let transaction; try { transaction = database.transaction('slots', mode, {durability: 'strict'}); } catch { transaction = database.transaction('slots', mode); }
      const results = []; const timer = setTimeout(() => { try { transaction.abort(); } catch {} reject(new Error('Save transaction timed out')); }, this.timeoutMs);
      try { operation(transaction.objectStore('slots'), results); } catch (error) { clearTimeout(timer); try { transaction.abort(); } catch {} reject(error); return; }
      transaction.oncomplete = () => { clearTimeout(timer); resolve(results); };
      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error('Save transaction failed')); };
    });
  }
  // Opens one partition (environment/game/account); its slots load into memory.
  async open(partition) {
    if (typeof partition !== 'string' || !partition.length || partition.length > 512 || /[\x00-\x1f]/.test(partition)) throw new Error('Invalid save partition');
    const generation = ++this.generation; this.partition = partition; this.retired = false;
    // A newer open supersedes this one, which then fails without touching
    // the shared database, slots or status: they belong to the newer open.
    const superseded = () => generation !== this.generation;
    const changed = () => new Error('Save partition changed while opening');
    // Earlier writes land before this read; session-only partitions keep
    // their in-memory slots across reopening.
    await this.queue;
    if (superseded()) throw changed();
    if (!this.memory.has(partition)) { if (this.memory.size >= 8) this.memory.delete(this.memory.keys().next().value); this.memory.set(partition, new Map()); }
    this.slots = this.memory.get(partition);
    try {
      await this.connect();
      if (superseded()) throw changed();
      if (!this.database) throw new Error('IndexedDB unavailable');
      const values = await this.transaction('readonly', (store, results) => {
        for (const slot of SLOTS) { const request = store.get(`${partition}\n${slot}`); request.onsuccess = () => { results.push([slot, request.result]); }; }
      });
      if (superseded()) throw changed();
      let total = 0; const loaded = new Map();
      for (const [slot, value] of values) {
        if (value === undefined) continue;
        if (!(value instanceof ArrayBuffer) || value.byteLength > this.maxSlotBytes) throw new Error('Invalid stored save slot');
        total += value.byteLength; loaded.set(slot, new Uint8Array(value));
      }
      if (total > this.maxPartitionBytes) throw new Error('Stored saves exceed their byte budget');
      this.memory.set(partition, loaded); this.slots = loaded;
      // Persistence is requested best effort; a browser that never answers
      // leaves the slots durable but evictable.
      const answer = async () => Boolean(await this.storage?.persisted?.()) || Boolean(await this.storage?.persist?.());
      let persisted = false; try { persisted = await Promise.race([answer(), new Promise(resolve => setTimeout(() => resolve(false), 2000))]); } catch {}
      if (superseded()) throw changed();
      this.persisted = persisted; this.setStatus('persistent');
    } catch (error) {
      if (superseded()) throw error;
      // A failed read is not an empty slot: refuse to persist over it.
      this.readFailed = true; this.database?.close(); this.database = null; this.setStatus('session-only', error.message);
      throw error;
    }
    this.readFailed = false;
  }
  read(slot) { if (!SLOTS.includes(slot)) throw new Error('Unknown save slot'); return this.slots.get(slot) || null; }
  write(slot, bytes) {
    if (!SLOTS.includes(slot) || this.partition === null) throw new Error('No open save partition');
    if (bytes !== null && (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxSlotBytes)) throw new Error('Save slot byte budget exceeded');
    let total = bytes?.byteLength || 0; for (const [other, value] of this.slots) if (other !== slot) total += value.byteLength;
    if (total > this.maxPartitionBytes) throw new Error('Save partition byte budget exceeded');
    const copy = bytes && bytes.slice(); const key = `${this.partition}\n${slot}`;
    if (copy) this.slots.set(slot, copy); else this.slots.delete(slot);
    if (!this.database || this.readFailed) return;
    this.queue = this.queue.then(() => this.retired ? undefined : this.transaction('readwrite', store => copy ? store.put(copy.slice().buffer, key) : store.delete(key)))
      .catch(error => { this.database?.close(); this.database = null; this.setStatus('session-only', error.message); });
  }
  flush() { return this.queue; }
  close() { this.generation++; this.database?.close(); this.database = null; this.partition = null; this.slots = new Map(); this.memory = new Map(); }
}
return {SaveSlots};
})();
// content
const __content = (() => {
// The content library's durable browser store: one IndexedDB record per
// partition (environment/game/account) and name (`library.json`, the record,
// and `packs/<sha256>.zip`, the archives), mirrored in memory so the game
// reads synchronously. A commit applies a batch of puts and removals to memory
// at once and persists it as one transaction, in order. A failed read is not an
// empty library: the partition then stays session-only and nothing is written
// over what could not be read.
const NAME = /^(library\.json|packs\/[0-9a-f]{64}\.zip)$/;

class ContentStore {
  constructor({indexedDB = globalThis.indexedDB, storage = globalThis.navigator?.storage, maxEntryBytes = 32 * 1024 * 1024, maxEntries = 1025,
    maxPartitionBytes = 128 * 1024 * 1024, timeoutMs = 5000, onStatus = () => {}} = {}) {
    this.indexedDB = indexedDB; this.storage = storage; this.maxEntryBytes = maxEntryBytes; this.maxEntries = maxEntries; this.maxPartitionBytes = maxPartitionBytes;
    this.timeoutMs = timeoutMs; this.onStatus = onStatus; this.database = null; this.partition = null; this.entries = new Map(); this.memory = new Map();
    this.pending = new Map(); this.status = 'session-only'; this.reason = ''; this.persisted = false; this.readFailed = true; this.queue = Promise.resolve(); this.generation = 0;
  }
  setStatus(status, reason = '') { this.status = status; this.reason = reason; try { this.onStatus({status, reason, persisted: this.persisted}); } catch {} }
  async connect() {
    if (this.database || !this.indexedDB) return this.database;
    this.database = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open('starhermit-engine-content-v1', 1); let finished = false;
      const fail = error => { if (finished) return; finished = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => fail(new Error('Content storage timed out')), this.timeoutMs);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('entries')) request.result.createObjectStore('entries'); };
      request.onsuccess = () => { clearTimeout(timer); if (finished) { request.result.close(); return; } finished = true; resolve(request.result); };
      request.onerror = () => fail(request.error || new Error('Content storage failed to open'));
      request.onblocked = () => fail(new Error('Content storage upgrade blocked'));
    });
    this.database.onversionchange = () => { this.database?.close(); this.database = null; this.setStatus('session-only', 'Content storage version changed'); };
    return this.database;
  }
  transaction(mode, operation) {
    const database = this.database; if (!database) return Promise.reject(new Error('Content storage is unavailable'));
    return new Promise((resolve, reject) => {
      let transaction; try { transaction = database.transaction('entries', mode, {durability: 'strict'}); } catch { transaction = database.transaction('entries', mode); }
      const results = {}; const timer = setTimeout(() => { try { transaction.abort(); } catch {} reject(new Error('Content transaction timed out')); }, this.timeoutMs);
      try { operation(transaction.objectStore('entries'), results); } catch (error) { clearTimeout(timer); try { transaction.abort(); } catch {} reject(error); return; }
      transaction.oncomplete = () => { clearTimeout(timer); resolve(results); };
      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error('Content transaction failed')); };
    });
  }
  // Opens one partition; its entries load into memory. Earlier commits land
  // first. A newer open supersedes this one, which then fails without
  // touching the shared database, entries or status.
  async open(partition) {
    if (typeof partition !== 'string' || !partition.length || partition.length > 1024 || /[\x00-\x1f]/.test(partition)) throw new Error('Invalid content partition');
    const generation = ++this.generation; this.partition = partition; this.pending = new Map();
    const superseded = () => generation !== this.generation;
    const changed = () => new Error('Content partition changed while opening');
    await this.queue;
    if (superseded()) throw changed();
    // Session-only partitions keep their entries across reopening.
    if (!this.memory.has(partition)) { if (this.memory.size >= 4) this.memory.delete(this.memory.keys().next().value); this.memory.set(partition, new Map()); }
    this.entries = this.memory.get(partition);
    try {
      await this.connect();
      if (superseded()) throw changed();
      if (!this.database) throw new Error('IndexedDB unavailable');
      const prefix = `${partition}\n`; const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      const {keys, values} = await this.transaction('readonly', (store, results) => {
        store.getAllKeys(range, this.maxEntries + 1).onsuccess = event => { results.keys = event.target.result; };
        store.getAll(range, this.maxEntries + 1).onsuccess = event => { results.values = event.target.result; };
      });
      if (superseded()) throw changed();
      if (!keys || !values || keys.length !== values.length || keys.length > this.maxEntries) throw new Error('Stored content exceeds its entry budget');
      let total = 0; const loaded = new Map();
      keys.forEach((key, index) => {
        const name = key.slice(prefix.length), value = values[index];
        if (!NAME.test(name) || !(value instanceof ArrayBuffer) || value.byteLength > this.maxEntryBytes) throw new Error(`Invalid stored content entry ${JSON.stringify(name)}`);
        total += value.byteLength; loaded.set(name, new Uint8Array(value));
      });
      if (total > this.maxPartitionBytes) throw new Error('Stored content exceeds its byte budget');
      this.memory.set(partition, loaded); this.entries = loaded;
      // Persistence is requested best effort; a browser that never answers
      // leaves the library durable but evictable.
      const answer = async () => Boolean(await this.storage?.persisted?.()) || Boolean(await this.storage?.persist?.());
      let persisted = false; try { persisted = await Promise.race([answer(), new Promise(resolve => setTimeout(() => resolve(false), 2000))]); } catch {}
      if (superseded()) throw changed();
      this.persisted = persisted; this.setStatus('persistent');
    } catch (error) {
      if (superseded()) throw error;
      // A failed read is not an empty library: refuse to persist over it.
      this.readFailed = true; this.database?.close(); this.database = null; this.setStatus('session-only', error.message);
      throw error;
    }
    this.readFailed = false;
  }
  names() { return [...this.entries.keys()]; }
  read(name) { if (!NAME.test(name)) throw new Error('Invalid content entry name'); return this.entries.get(name) || null; }
  // Adds a put (bytes) or removal (null) to the next commit.
  stage(name, bytes) {
    if (this.partition === null) throw new Error('No open content partition');
    if (!NAME.test(name)) throw new Error('Invalid content entry name');
    if (bytes !== null && (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxEntryBytes)) throw new Error('Content entry byte budget exceeded');
    this.pending.delete(name); this.pending.set(name, bytes && bytes.slice());
  }
  // Applies the staged batch within budget, or drops it (`apply` false or
  // over budget) leaving memory and storage as they were.
  commit(apply = true) {
    const batch = this.pending; this.pending = new Map();
    if (!apply || !batch.size) return;
    if (this.partition === null) throw new Error('No open content partition');
    const next = new Map(this.entries);
    for (const [name, bytes] of batch) if (bytes) next.set(name, bytes); else next.delete(name);
    let total = 0; for (const value of next.values()) total += value.byteLength;
    if (next.size > this.maxEntries) throw new Error('Content partition entry budget exceeded');
    if (total > this.maxPartitionBytes) throw new Error('Content partition byte budget exceeded');
    this.memory.set(this.partition, next); this.entries = next;
    if (!this.database || this.readFailed) return;
    const partition = this.partition;
    this.queue = this.queue.then(() => this.transaction('readwrite', store => {
      for (const [name, bytes] of batch) { const key = `${partition}\n${name}`; if (bytes) store.put(bytes.buffer, key); else store.delete(key); }
    })).catch(error => { this.database?.close(); this.database = null; this.setStatus('session-only', error.message); });
  }
  flush() { return this.queue; }
  close() { this.generation++; this.database?.close(); this.database = null; this.partition = null; this.entries = new Map(); this.memory = new Map(); this.pending = new Map(); }
}
return {ContentStore};
})();
// audio-output
const __audio_output = (() => {
// Output routing owns no mixer, sample buffers or microphone permissions.
const encoder=new TextEncoder();
const DEFAULT=Object.freeze({id:'',label:'System default'});
function identity(value){if(typeof value!=='string'||encoder.encode(value).length>1024||/[\x00-\x1f\x7f-\x9f]/.test(value))throw new Error('Invalid audio output identifier');return value==='default'?'':value;}
function label(value,fallback){let text='';for(const part of String(value||fallback).replace(/[\x00-\x1f\x7f-\x9f]/g,' ').slice(0,1024)){if(encoder.encode(text+part).length>256)break;text+=part;}return text.trim()||fallback;}
function bounded(promise,ms,name){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${name} timed out`)),ms);})]).finally(()=>clearTimeout(timer));}
function allowed(policy){try{return !policy?.allowsFeature||policy.allowsFeature('speaker-selection');}catch{return true;}}
class AudioOutputRouter {
  constructor(context,{mediaDevices=globalThis.navigator?.mediaDevices,secureContext=globalThis.isSecureContext===true,policy=globalThis.document?.permissionsPolicy||globalThis.document?.featurePolicy,
    elementFactory=()=>globalThis.document?.createElement('audio'),timeoutMs=10000,onStatus=()=>{}}={}){
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid output deadline');
    this.context=context;this.mediaDevices=mediaDevices;this.timeoutMs=timeoutMs;this.onStatus=onStatus;
    this.closed=false;this.busy=null;this.refreshing=null;this.refreshAgain=false;this.requested='';this.effective='';this.reason='';this.outputs=[DEFAULT];this.listeners=new Set();this.node=null;
    this.stopped=new Promise((_,reject)=>{this.rejectStop=reject;});this.stopped.catch(()=>{});
    this.mode='default';this.destination=context.destination;this.element=null;this.stream=null;
    this.secureContext=secureContext;this.policy=policy;this.permitted=secureContext&&allowed(policy);
    if(this.permitted&&typeof context.setSinkId==='function')this.mode='context';
    else if(this.permitted&&typeof context.createMediaStreamDestination==='function'){
      const element=elementFactory();
      if(typeof element?.setSinkId==='function'){
        this.stream=context.createMediaStreamDestination();this.element=element;this.element.srcObject=this.stream.stream;
        this.element.volume=1;this.element.muted=false;this.destination=this.stream;this.mode='media-element';
      }
    }
    if(!secureContext)this.reason='Output selection requires a secure page.';
    else if(!this.permitted)this.reason='Output selection is blocked by this page.';
    else if(this.mode==='default')this.reason='This browser uses the system default output.';
    const initial=this.actual();this.effective=initial;this.requested=initial||'';if(initial===null)this.reason='The browser has not reported a named output.';
    this.deviceChanged=()=>this.refresh().catch(()=>{});
    this.deviceError=()=>{if(this.effective)this.fallback('The selected output is unavailable.').catch(()=>{});else{this.reason='System default output is currently unavailable.';this.notify();}};
    this.stateChanged=()=>this.notify();
    this.sinkChanged=()=>{if(!this.closed){this.effective=this.actual();this.notify();}};
    this.mediaDevices?.addEventListener?.('devicechange',this.deviceChanged);context.addEventListener?.('error',this.deviceError);context.addEventListener?.('sinkchange',this.sinkChanged);context.addEventListener?.('statechange',this.stateChanged);
  }
  snapshot(){this.permitted=this.secureContext&&allowed(this.policy);const selectable=this.mode!=='default'||!!(this.element&&this.node)||typeof this.context.setSinkId==='function';return Object.freeze({active:!this.closed,mode:this.mode,supported:selectable&&this.permitted,
    canPrompt:selectable&&this.permitted&&typeof this.mediaDevices?.selectAudioOutput==='function',
    requested:this.requested,effective:this.effective,suspended:this.context.state==='suspended'||this.context.state==='interrupted',pending:!!this.busy,reason:this.reason,outputs:Object.freeze([...this.outputs])});}
  notify(){if(this.closed)return;const state=this.snapshot();try{this.onStatus(state);}catch{}for(const listener of this.listeners){try{listener(state);}catch{}}}
  subscribe(listener){if(this.listeners.size>=32)throw new Error('Audio output subscriber budget exceeded');this.listeners.add(listener);try{listener(this.snapshot());}catch(error){this.listeners.delete(listener);throw error;}return()=>this.listeners.delete(listener);}
  attach(node){this.node=node;}
  // Invoke before awaiting worklet compilation while the Start gesture is live.
  async start(){if(this.closed)throw new Error('Audio output is closed');return this.element?bounded(Promise.resolve(this.element.play()),this.timeoutMs,'Audio output playback'):Promise.resolve();}
  target(){return this.mode==='context'?this.context:this.element;}
  actual(){if(this.mode==='default')return '';const id=this.target()?.sinkId;return typeof id==='string'?identity(id):this.mode==='default'?'':null;}
  check(){if(this.closed||this.context.state==='closed')throw new Error('Audio output is closed');if(this.busy)throw new Error('An audio output change is already pending');}
  async enumerate(){
    if(this.closed)throw new Error('Audio output is closed');
    if(!this.snapshot().supported||typeof this.mediaDevices?.enumerateDevices!=='function')return this.snapshot();
    try{
      const devices=await bounded(Promise.race([Promise.resolve(this.mediaDevices.enumerateDevices()),this.stopped]),this.timeoutMs,'Audio output enumeration');
      if(this.closed)throw new Error('Audio output is closed');
      if(!Array.isArray(devices)||devices.length>256)throw new Error('Audio device list budget exceeded');
      const entries=new Map();
      for(const device of devices){if(device.kind!=='audiooutput')continue;const id=identity(device.deviceId);if(!id)continue;
        if(entries.size>=32&&!entries.has(id))throw new Error('Audio output list budget exceeded');
        entries.set(id,Object.freeze({id,label:label(device.label,`Output ${entries.size+1}`)}));}
      this.outputs=[DEFAULT,...[...entries.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id))];
      this.reason=this.outputs.length===1?'Only the system default is currently available.':'';this.notify();return this.snapshot();
    }catch(error){if(!this.closed){this.reason='The output list is unavailable; the current output remains active.';this.notify();}throw error;}
  }
  // Only one operation can touch a sink. A timed-out setter remains pending until
  // its browser promise settles; later completion is reported rather than hidden.
  operation(begin,{signal}={}){
    this.check();if(signal?.aborted)throw new Error('Audio output change cancelled');const operation={expired:false,prompt:false};this.busy=operation;this.reason='';
    let rejectCancel;const cancellation=new Promise((_,reject)=>{rejectCancel=reject;});cancellation.catch(()=>{});
    const abort=()=>{operation.expired=true;this.reason=operation.prompt?'Output selection cancelled; the current output remains active.':'Output change cancelled; waiting for the browser.';this.notify();rejectCancel(new Error('Audio output change cancelled'));};
    signal?.addEventListener('abort',abort,{once:true});
    let task;try{task=Promise.resolve(begin(operation));}catch(error){task=Promise.reject(error);}
    const settled=task.then(value=>{if(this.closed)throw new Error('Audio output is closed');return value;},error=>{
      if(!this.closed){this.reason=error?.name==='NotAllowedError'?'Output permission was denied; the current output remains active.':'The output could not be changed; the current output remains active.';}throw error;
    }).finally(()=>{signal?.removeEventListener('abort',abort);if(this.busy===operation){this.busy=null;this.notify();if(this.refreshAgain){this.refreshAgain=false;this.refresh().catch(()=>{});}}});
    settled.catch(()=>{});this.notify();
    let timer;
    return Promise.race([settled.then(()=>this.snapshot()),this.stopped,cancellation,new Promise((_,reject)=>{timer=setTimeout(()=>{
      operation.expired=true;if(!this.closed){this.reason=operation.prompt?'Output selection did not finish; the current output remains active.':'Output change did not finish; waiting for the browser.';this.notify();}reject(new Error('Audio output change timed out'));
    },this.timeoutMs);})]).finally(()=>clearTimeout(timer));
  }
  async set(id,updateRequested=true){
    if(this.closed)throw new Error('Audio output is closed');
    if(id===this.effective){if(updateRequested)this.requested=id;return this.snapshot();}
    if(!this.snapshot().supported)throw new Error('Audio output selection is unavailable');
    const direct=this.mode==='context'||(this.mode==='default'&&!this.element&&typeof this.context.setSinkId==='function');
    const recovering=this.mode==='default'&&!direct;
    const target=direct?this.context:this.element;
    try{const switching=target.setSinkId(id);const playback=recovering?this.element.play():Promise.resolve();await Promise.all([switching,playback]);}
    catch(error){if(recovering)this.element.pause();throw error;}
    if(this.closed)throw new Error('Audio output is closed');
    const actual=typeof target.sinkId==='string'?identity(target.sinkId):null;if(actual!==id)throw new Error('Browser did not confirm the selected output');
    if(recovering){const previous=this.destination;this.node.disconnect(previous);try{this.node.connect(this.stream);}catch(error){this.node.connect(previous);this.element.pause();throw error;}this.destination=this.stream;this.mode='media-element';}
    else if(direct)this.mode='context';
    this.effective=id;if(updateRequested)this.requested=id;this.reason='';this.notify();return this.snapshot();
  }
  switch(id,options={}){id=identity(id);return this.operation(()=>this.set(id),options);}
  // selectAudioOutput is deliberately called synchronously, before any await.
  choose(options={}){return this.operation(operation=>{
    if(!this.snapshot().canPrompt)throw new Error('This browser cannot prompt for an output');
    operation.prompt=true;const selection=this.mediaDevices.selectAudioOutput({deviceId:this.requested});
    return Promise.resolve(selection).then(device=>{
      if(this.closed||operation.expired)throw new Error('Output selection expired');operation.prompt=false;
      const id=identity(device.deviceId);if(device.kind!=='audiooutput')throw new Error('No output was selected');
      if(!this.outputs.some(output=>output.id===id)&&this.outputs.length<=32)this.outputs.push(Object.freeze({id,label:label(device.label,'Selected output')}));return this.set(id);
    });
  },options);}
  fallback(reason){
    if(this.closed)return Promise.reject(new Error('Audio output is closed'));
    if(this.busy){this.refreshAgain=true;return Promise.resolve(this.snapshot());}
    return this.operation(async()=>{
      try{await this.set('',false);}catch(error){
        if(this.closed)throw error;
        // If an element's default switch is denied after device removal, keep
        // default playback usable through the already activated AudioContext.
        if(this.mode!=='media-element'||!this.node)throw error;
        const previous=this.destination;this.node.disconnect(previous);try{this.node.connect(this.context.destination);}catch(error){this.node.connect(previous);throw error;}this.element.pause();this.destination=this.context.destination;this.mode='default';this.effective='';
      }
      this.reason=`${reason} Using system default.`;this.notify();return this.snapshot();
    });
  }
  refresh(){
    if(this.closed)return Promise.reject(new Error('Audio output is closed'));
    if(this.busy||this.refreshing){this.refreshAgain=true;return this.refreshing||Promise.resolve(this.snapshot());}
    this.refreshing=(async()=>{
      const state=await this.enumerate();if(this.closed)return state;
      const ids=new Set(this.outputs.map(output=>output.id));
      if(this.effective&&!ids.has(this.effective))await this.fallback('The selected output is unavailable.');
      else if(this.requested&&this.requested!==this.effective&&ids.has(this.requested)&&this.snapshot().supported){
        try{await this.operation(()=>this.set(this.requested,false));}catch{}
      }
      return this.snapshot();
    })().finally(()=>{this.refreshing=null;if(this.refreshAgain&&!this.busy&&!this.closed){this.refreshAgain=false;this.refresh().catch(()=>{});}});
    return this.refreshing;
  }
  close(){if(this.closed)return;this.closed=true;this.rejectStop(new Error('Audio output is closed'));this.mediaDevices?.removeEventListener?.('devicechange',this.deviceChanged);this.context.removeEventListener?.('error',this.deviceError);this.context.removeEventListener?.('sinkchange',this.sinkChanged);this.context.removeEventListener?.('statechange',this.stateChanged);
    this.listeners.clear();try{this.element?.pause();}catch{}if(this.element)this.element.srcObject=null;
    for(const track of this.stream?.stream?.getTracks?.()||[]){try{track.stop();}catch{}}try{this.stream?.disconnect?.();}catch{}this.node=null;this.stream=null;this.element=null;}
}
return {AudioOutputRouter};
})();
// audio
const __audio = (() => {
const {AudioOutputRouter} = __audio_output;
const {fetchAssetBytes} = __assets;
// Main-thread ownership and bounded transferable control messages. No shared memory.
const MAX_BYTES = 64 * 1024 * 1024;
// A synthesis graph batch (GraphConfig::max_batch_bytes must fit), staged
// apart from clip uploads.
const GRAPH_MAX_BYTES = 128 * 1024 * 1024;
const CHUNK_SAMPLES = 16384;
// Requests in flight to the worklet within one upload or graph batch, and
// the port's budget: the bridge's requests, an upload and a graph batch
// (one of each at a time) pipelining.
const PIPELINE = 8;
const REQUESTS = 32 + 2 * PIPELINE;
// Conservative initial heuristic from the project specification; 128 requires
// representative measured headroom, which this adapter does not yet profile.
function detectAudioHint(hints=globalThis.navigator||{}){
  const {hardwareConcurrency,deviceMemory}=hints;
  const cpu=Number.isInteger(hardwareConcurrency)&&hardwareConcurrency>0?hardwareConcurrency:null;
  const memory=Number.isFinite(deviceMemory)&&deviceMemory>0?deviceMemory:null;
  if((cpu!==null&&cpu<=2)||(memory!==null&&memory<=2))return 16;
  return cpu!==null&&cpu>=4?64:32;
}
// Flags: mute when unfocused, mono, spatialization off, unfocused (bit 0 up).
function preferences(volumes,flags,requested,autoLimit){
  if(!Array.isArray(volumes)||volumes.length!==5||volumes.some(value=>!Number.isFinite(value)||value<0||value>1)||!Number.isInteger(flags)||flags<0||flags>15)throw new Error('Invalid audio preferences');
  if(requested!=='auto')integer(requested,1,256,'requested sound limit');integer(autoLimit,1,256,'Auto sound recommendation');
}
function deadline(promise,label,ms=10000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),ms);})]).finally(()=>clearTimeout(timer));}
function finite(value,label) {if (!Number.isFinite(value)) throw new Error(`Invalid ${label}`); return value;}
function integer(value,min,max,label) {if (!Number.isInteger(value)||value<min||value>max) throw new Error(`Invalid ${label}`);return value;}
function reservation(value){const word=integer(value,1,16777473,'bus reservation')-1,requested=word>>>16,effective=word&0xffff;if(requested>256||effective>requested)throw new Error('Invalid bus reservation');return Object.freeze({requested,effective});}
class AudioPort {
  constructor(node,{timeoutMs=10000,onFailure=()=>{},soundCeiling=256,autoHint=32}={}) {
    this.node=node;this.timeoutMs=integer(timeoutMs,1,60000,'audio deadline');this.onFailure=onFailure;this.soundCeiling=integer(soundCeiling,1,256,'game sound ceiling');this.autoHint=integer(autoHint,1,256,'Auto recommendation');
    this.pending=new Map();this.next=1;this.closed=false;this.uploading=false;this.owner=Symbol('audio');
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    this.ready.catch(()=>{});
    this.readyTimer=setTimeout(()=>this.fail(new Error('Audio initialization timed out')),this.timeoutMs);
    node.port.onmessage=event=>{
      const message=event.data;
      if(message?.type==='ready'){clearTimeout(this.readyTimer);this.readyResolve();return;}
      const request=this.pending.get(message?.id);if(!request)return;
      this.pending.delete(message.id);this.watch(true);if(message.error)request.reject(new Error(message.error));else request.resolve(message.value);
    };
    this.processorError=()=>this.fail(new Error('Audio processor error'));node.addEventListener('processorerror',this.processorError);
  }
  fail(error) {if(this.closed)return;this.close(error);this.onFailure(error);}
  // The deadline is the worklet's progress, not each request's age: it
  // runs while requests wait and starts again with each answer, so a
  // burst queued behind others (clip uploads, graph batches, commands; a
  // render thread starved by a loaded machine) is never failed while the
  // worklet still answers. Only a worklet that answered nothing for
  // timeoutMs fails the port: the oldest request waiting is named.
  watch(answered=false) {
    if(this.closed||!this.pending.size){clearTimeout(this.watchdog);this.watchdog=null;return;}
    if(this.watchdog&&!answered)return;
    clearTimeout(this.watchdog);
    this.watchdog=setTimeout(()=>{this.watchdog=null;const [oldest]=this.pending.values();if(oldest)this.fail(new Error(`Audio ${oldest.type} timed out`));},this.timeoutMs);
  }
  request(type,fields={},transfer=[]) {
    if(this.closed)return Promise.reject(new Error('Audio port is closed'));
    if(this.pending.size>=REQUESTS||this.next>0xffffffff)return Promise.reject(new Error('Audio command budget exceeded'));
    const id=this.next++;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject,type});
      try{this.node.port.postMessage({id,type,...fields},transfer);}catch(error){this.pending.delete(id);this.watch();reject(error);return;}
      this.watch();
    });
  }
  // Requests sent one after another without waiting for each answer (the
  // worklet takes them in order; browsers answer its port once per render
  // quantum or more slowly: about 30 ms a round trip in Firefox, against
  // 4 in Safari and a tenth of one in Chrome), at most PIPELINE unanswered;
  // the last one's answer, or the first refusal.
  async pipeline(count,make) {
    const sent=[];
    for(let index=0;index<count;index++){const request=make(index);request.catch(()=>{});sent.push(request);if(sent.length>=PIPELINE)await sent.shift();}
    return (await Promise.all(sent)).at(-1);
  }
  registerClip(clip,options={}) {
    const samples=clip.samples;
    if(!(samples instanceof Float32Array)||!(samples.buffer instanceof ArrayBuffer)||samples.byteLength>MAX_BYTES)throw new Error('Invalid decoded audio samples');
    // Snapshot caller memory synchronously before any await.
    return this.registerOwnedClip({...clip,samples:new Float32Array(samples)},options);
  }
  async registerOwnedClip({samples,sampleRate,channels,channelMask=0},{signal}={}) {
    if(this.uploading)throw new Error('An audio upload is already in progress');
    integer(sampleRate,1,768000,'sample rate');integer(channels,1,32,'channel count');integer(channelMask,0,0xffffffff,'channel mask');
    if(!(samples instanceof Float32Array)||!(samples.buffer instanceof ArrayBuffer)||!samples.length||samples.length%channels||samples.byteLength>MAX_BYTES)throw new Error('Invalid decoded audio samples');
    // Private ownership handoff from the bounded Rust bridge or snapshot above.
    const owned=samples;this.uploading=true;
    try {
      if(signal?.aborted)throw new Error('Audio upload cancelled');await this.ready;
      // The worklet refuses chunks and the commit after a refused begin.
      const chunks=Math.ceil(owned.length/CHUNK_SAMPLES);
      const token=await this.pipeline(chunks+2,index=>{
        if(signal?.aborted)throw new Error('Audio upload cancelled');
        if(index===0)return this.request('begin',{rate:sampleRate,channels,mask:channelMask,samples:owned.length});
        if(index>chunks)return this.request('commit');
        const chunk=owned.slice((index-1)*CHUNK_SAMPLES,Math.min(index*CHUNK_SAMPLES,owned.length));
        return this.request('append',{samples:chunk},[chunk.buffer]);
      });
      const clip=Object.freeze({owner:this.owner,token});
      if(signal?.aborted){await this.deleteClip(clip);throw new Error('Audio upload cancelled');}return clip;
    }catch(error){if(!this.closed){try{await this.request('abort');}catch{}}throw error;}finally{this.uploading=false;}
  }
  handle(handle){if(handle?.owner!==this.owner)throw new Error('Foreign audio handle');return integer(handle.token,1,0xffffffff,'audio handle');}
  // Streamed clips (music decoded while it plays): a ring of capacityFrames
  // frames in the worklet, filled by writeStream and played by one voice.
  async openStream({sampleRate,channels,capacityFrames}) {
    integer(sampleRate,1,768000,'sample rate');integer(channels,1,32,'channel count');integer(capacityFrames,256,1<<20,'stream capacity');
    await this.ready;const token=await this.request('command',{op:16,handle:0,a:sampleRate,b:channels*2**21+capacityFrames});
    return Object.freeze({owner:this.owner,token});
  }
  // Frames accepted (the rest are for a later call).
  async writeStream(stream,samples) {
    const handle=this.handle(stream);
    if(!(samples instanceof Float32Array)||samples.length>CHUNK_SAMPLES)throw new Error('Invalid audio stream chunk');
    const chunk=new Float32Array(samples);return (await this.request('streamWrite',{handle,samples:chunk},[chunk.buffer]))-1;
  }
  endStream(stream){return this.command(18,stream);}
  async streamStatus(stream) {
    const [free,played,starved]=await Promise.all([19,20,21].map(op=>this.command(op,stream)));
    return Object.freeze({freeFrames:free-1,played:played-1,starvedFrames:starved-1});
  }
  async play(clip,{gain=1,pitch=1,startFrame=0,loopFrames=null,pan=null,bus=2,priority=0}={}) {
    const token=this.handle(clip);finite(gain,'gain');finite(pitch,'pitch');integer(startFrame,0,0xffffffff,'start frame');integer(bus,0,4,'bus');
    if(pan!==null)finite(pan,'pan');const loopStart=loopFrames?integer(loopFrames[0],0,0xffffffff,'loop start'):0;const loopEnd=loopFrames?integer(loopFrames[1],1,0xffffffff,'loop end'):0;
    integer(priority,-32768,32767,'voice priority');
    const voice=await this.request('play',{clip:token,gain,pitch,offset:startFrame,loopStart,loopEnd,pan:pan===null?NaN:pan,bus,priority});return Object.freeze({owner:this.owner,token:voice});
  }
  command(op,handle,a=0,b=0){return this.request('command',{op,handle:this.handle(handle),a,b});}
  async reserveBus(bus,slots){integer(bus,0,4,'bus');integer(slots,0,this.soundCeiling,'reserved sounds');return reservation(await this.request('command',{op:14,handle:bus,a:slots,b:0}));}
  async busReservation(bus){integer(bus,0,4,'bus');return reservation(await this.request('command',{op:15,handle:bus,a:0,b:0}));}
  async resetFeedback(autoHint=this.autoHint){integer(autoHint,1,256,'Auto recommendation');await this.request('resetFeedback',{autoHint});this.autoHint=autoHint;}
  stop(handle){return this.command(1,handle);}
  pause(handle){return this.command(2,handle);}
  resume(handle){return this.command(3,handle);}
  fade(handle,gain,frames){return this.command(4,handle,finite(gain,'gain'),integer(frames,0,0xffffffff,'fade frames'));}
  seek(handle,frame){return this.command(5,handle,integer(frame,0,0xffffffff,'seek frame'));}
  pitch(handle,pitch){return this.command(6,handle,finite(pitch,'pitch'));}
  pan(handle,pan){return this.command(7,handle,pan===null?NaN:finite(pan,'pan'));}
  deleteClip(handle){return this.command(11,handle);}
  busGain(bus,gain,frames=0){return this.request('command',{op:8,handle:integer(bus,0,4,'bus'),a:finite(gain,'gain'),b:integer(frames,0,0xffffffff,'fade frames')});}
  busMute(bus,muted){return this.request('command',{op:9,handle:integer(bus,0,4,'bus'),a:muted?1:0,b:0});}
  activeLimit(limit){return this.request('command',{op:10,handle:0,a:integer(limit,1,this.soundCeiling,'sound limit'),b:0});}
  async applyPreferences({volumes=[.8,1,1,1,1],spatialization=true,mono=false,muteWhenUnfocused=true,focused=true,requested='auto'}={},autoLimit=this.autoHint){
    const flags=(muteWhenUnfocused?1:0)|(mono?2:0)|(spatialization?0:4)|(focused?0:8);
    preferences(volumes,flags,requested,autoLimit);const effectiveLimit=await this.request('preferences',{volumes:[...volumes],flags,requested,autoLimit});
    return Object.freeze({requested,effectiveLimit});
  }
  stats(){return this.request('stats');}
  // The synthesis graph's records: the opening, then batches sent in chunks
  // of at most 64 KiB, one batch at a time, each answered by feedback.
  graphOpen(bytes){if(!(bytes instanceof Uint8Array)||bytes.length>65536)throw new Error('Invalid audio graph opening');const owned=bytes.slice();return this.request('graphOpen',{bytes:owned},[owned.buffer]);}
  graphApply(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length>GRAPH_MAX_BYTES)throw new Error('Invalid audio graph batch');
    const chunks=Math.ceil(bytes.length/65536);
    const run=()=>this.pipeline(chunks+1,index=>{if(index===chunks)return this.request('graphApply');const chunk=bytes.slice(index*65536,(index+1)*65536);return this.request('graphAppend',{bytes:chunk},[chunk.buffer]);});
    const result=(this.graphQueue??Promise.resolve()).then(run,run);this.graphQueue=result.catch(()=>{});return result;
  }
  graphClose(){return this.request('graphClose');}
  close(error=new Error('Audio port closed')) {
    if(this.closed)return;this.closed=true;clearTimeout(this.readyTimer);this.readyReject(error);
    try{this.node.port.postMessage({type:'shutdown'});}catch{}
    this.node.disconnect();this.node.removeEventListener('processorerror',this.processorError);this.node.port.onmessage=null;this.node.port.close();
    clearTimeout(this.watchdog);this.watchdog=null;for(const request of this.pending.values())request.reject(error);this.pending.clear();
  }
}
async function prepareAudioModule({module,wasmURL,fetch=globalThis.fetch,timeoutMs=10000,onProgress=()=>{}}={}) {
  if(module){if(!(module instanceof WebAssembly.Module))throw new Error('Invalid audio WASM module');return module;}
  if(!wasmURL)throw new Error('Audio WASM URL is required');onProgress('fetch');
  const bytes=await fetchAssetBytes(wasmURL,{fetch,timeoutMs,limit:16*1024*1024});onProgress('compile');
  return deadline(WebAssembly.compile(bytes),'Audio WASM compilation',timeoutMs);
}
async function createAudioNode(context,{module,wasmURL,workletURL,channels=2,activeLimit=null,soundCeiling=256,fetch=globalThis.fetch,timeoutMs=10000,onFailure,onProgress=()=>{},waitUntilReady=true,signal,destination=context.destination}={}) {
  const cancelled=()=>{if(signal?.aborted)throw new Error('Audio startup cancelled');};cancelled();
  integer(channels,1,2,'browser output channels');integer(soundCeiling,1,256,'game sound ceiling');
  const autoHint=detectAudioHint();if(activeLimit===null)activeLimit=autoHint;integer(activeLimit,1,256,'sound limit');activeLimit=Math.min(activeLimit,soundCeiling);
  if(!context.audioWorklet)throw new Error('AudioWorklet is unavailable');
  if(!module)module=await prepareAudioModule({wasmURL,fetch,timeoutMs,onProgress});
  cancelled();onProgress('worklet');await deadline(context.audioWorklet.addModule(workletURL),'Audio worklet loading',timeoutMs);onProgress('node');cancelled();
  const node=new AudioWorkletNode(context,'starhermit-mixer',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[channels],processorOptions:{module,channels,limit:activeLimit,ceiling:soundCeiling,autoHint}});
  const port=new AudioPort(node,{timeoutMs,onFailure,soundCeiling,autoHint});port.channels=channels;
  const abort=()=>port.close(new Error('Audio startup cancelled'));signal?.addEventListener('abort',abort,{once:true});
  try{cancelled();node.connect(destination);if(waitUntilReady)await port.ready;cancelled();return port;}
  catch(error){port.close(error);throw error;}finally{signal?.removeEventListener('abort',abort);}
}
/// Construction is silent. Invoke start/resume directly from a user gesture.
/// The output (`port`, which the game's bridge sees) is published only once
/// the context runs: an event that is not a user activation (a modifier key
/// alone) makes a context the browser does not let start, and the game's
/// requests sent to it would all be cancelled when that start gave up. A
/// later start() while it waits resumes the same context (a real gesture
/// starts it); a start that gave up because the context never ran rejects
/// with `error.gesture` set, and the next gesture may try again.
class BrowserAudio {
  constructor(options={}){this.options=options;this.context=null;this.port=null;this.starting=null;this.preparing=null;this.closed=false;this.startup=null;this.outputRouter=null;this.outputListeners=new Set();this.outputReason='';}
  prepare(){if(this.closed)return Promise.reject(new Error('Browser audio is closed'));if(!this.preparing)this.preparing=prepareAudioModule(this.options);return this.preparing;}
  async start(){
    if(this.closed)return Promise.reject(new Error('Browser audio is closed'));
    if(this.port){const resumed=this.context.resume();const playback=this.outputRouter?.start();return Promise.all([deadline(resumed,'Audio resume',this.options.timeoutMs),playback]).then(()=>{this.notifyOutput();return this.port;});}if(this.starting){this.context?.resume().catch(()=>{});return this.starting;}
    const Factory=this.options.AudioContext||globalThis.AudioContext;
    if(!Factory){this.outputReason='Audio output is unavailable.';this.notifyOutput();throw new Error('Web Audio is unavailable');}
    const startup=this.startup=new AbortController();
    let context;try{context=this.context=new Factory();}catch(error){this.outputReason='Audio output is unavailable.';this.notifyOutput();throw error;}
    let resume;
    try{resume=deadline(context.resume(),'Audio resume',this.options.timeoutMs);}
    catch(error){this.outputReason='Audio output is unavailable.';this.notifyOutput();await deadline(context.close(),'Audio close',this.options.timeoutMs).catch(()=>{});throw error;}
    resume.catch(()=>{});
    let routing;
    try{this.outputRouter=new AudioOutputRouter(context,{...this.options.output,timeoutMs:this.options.timeoutMs,onStatus:()=>this.notifyOutput()});routing=this.outputRouter.start();routing.catch(()=>{});}
    catch(error){this.outputReason='Audio output is unavailable.';this.notifyOutput();await deadline(context.close(),'Audio close',this.options.timeoutMs).catch(()=>{});throw error;}
    let pending=null;
    const failed=error=>{const published=!!pending&&this.port===pending;this.port=null;this.outputReason='Audio output is unavailable.';this.outputRouter?.close();context.close().catch(()=>{});this.notifyOutput();this.options.onFailure?.(error);if(published)this.recover(error);};
    this.starting=this.prepare().then(module=>{if(this.closed)throw new Error('Audio startup cancelled');return createAudioNode(context,{...this.options,module,onFailure:failed,signal:startup.signal,destination:this.outputRouter.destination});})
      .then(async port=>{if(this.closed){port.close();throw new Error('Audio startup cancelled');}pending=port;this.outputRouter.attach(port.node);await Promise.all([resume,routing]);
        if(this.closed||port.closed)throw new Error('Audio startup cancelled');this.port=port;this.outputReason='';this.notifyOutput();return port;})
      .catch(async error=>{if(error&&typeof error==='object'&&context.state==='suspended')error.gesture=true;pending?.close();this.port?.close();this.port=null;this.outputReason='Audio output is unavailable.';this.outputRouter?.close();this.notifyOutput();if(context.state!=='closed')await deadline(context.close(),'Audio close',this.options.timeoutMs).catch(()=>{});this.options.onFailure?.(error);throw error;})
      .finally(()=>{this.starting=null;this.startup=null;});return this.starting;
  }
  // A published output was lost (its worklet stopped answering, its
  // processor failed): a new context and worklet start at once (a page
  // whose audio ran may start it again without a gesture), and the game's
  // bridge sees a new output. After 3 losses within a minute, or when the
  // new one cannot start, onLost asks for the next gesture instead.
  recover(error){
    if(this.closed)return;
    const now=Date.now();this.losses=(this.losses||[]).filter(at=>now-at<60000);this.losses.push(now);
    if(this.losses.length>3){try{this.onLost?.(error);}catch{}return;}
    setTimeout(()=>{if(this.closed||this.port||this.starting)return;this.start().catch(failure=>{try{this.onLost?.(failure);}catch{}});},0);
  }
  outputStatus(){const state=this.outputRouter?.snapshot()||{mode:'default',supported:false,canPrompt:false,requested:'',effective:'',pending:false,reason:'Start the game to use audio outputs.',outputs:[{id:'',label:'System default'}]};return Object.freeze({...state,reason:this.outputReason||state.reason,active:!this.closed&&!!this.port&&!this.port.closed&&this.context?.state!=='closed'});}
  subscribeOutput(listener){if(this.outputListeners.size>=32)throw new Error('Audio output subscriber budget exceeded');this.outputListeners.add(listener);try{listener(this.outputStatus());}catch(error){this.outputListeners.delete(listener);throw error;}return()=>this.outputListeners.delete(listener);}
  notifyOutput(){const state=this.outputStatus();if(this.port&&state.effective!==null){if(this.feedbackOutput!==undefined&&this.feedbackOutput!==state.effective)this.resetOutputFeedback();this.feedbackOutput=state.effective;}try{this.options.onOutput?.(state);}catch{}for(const listener of this.outputListeners){try{listener(state);}catch{}}}
  async resetOutputFeedback(){const port=this.port;if(!port?.resetFeedback)return;const request=this.feedbackRequest={};for(let attempt=0;attempt<3;attempt++){if(this.closed||this.port!==port||this.feedbackRequest!==request)return;try{await port.resetFeedback(detectAudioHint());return;}catch(error){if(attempt===2){try{this.options.onFeedbackError?.(error);}catch{}return;}await new Promise(resolve=>setTimeout(resolve,0));}}}
  listOutputs(){return this.outputRouter?this.outputRouter.refresh():Promise.resolve(this.outputStatus());}
  chooseOutput(options){return this.outputRouter?this.outputRouter.choose(options):Promise.reject(new Error('Start audio before choosing an output'));}
  switchOutput(id,options){return this.outputRouter?this.outputRouter.switch(id,options):Promise.reject(new Error('Start audio before choosing an output'));}
  suspend(){return this.context?.suspend();}
  resume(){return this.start();}
  async close(){if(this.closed)return;this.closed=true;this.startup?.abort();this.port?.close();this.port=null;this.preparing=null;this.outputReason='Audio output is closed.';this.outputRouter?.close();this.notifyOutput();this.outputListeners.clear();if(this.context&&this.context.state!=='closed')await deadline(this.context.close(),'Audio close',this.options.timeoutMs);}
}

// Rust's asynchronous control ABI. Buffers are owned by this broker between
// imports; it never retains a game WASM memory view or opens an AudioContext.
// Clip uploads stage side by side (within the staging budget) and reach the
// worklet one after another, in the order they were committed.
class AudioBridge {
  constructor({getPort,getOutput=()=>null,onReady=()=>{},soundCeiling=256}) {
    this.soundCeiling=integer(soundCeiling,1,256,'game sound ceiling');this.getPort=getPort;this.getOutput=getOutput;this.onReady=onReady;this.port=null;this.epoch=0;this.next=1;
    this.requests=new Map();this.stagingBytes=0;this.graphStagingBytes=0;this.uploads=Promise.resolve();this.closed=false;
  }
  current() {
    const next=this.closed?null:this.getPort();const port=next?.closed?null:next;
    if(port!==this.port){for(const id of this.requests.keys())this.cancel(id);this.port=port;this.epoch++;if(this.epoch>0xffffffff)throw new Error('Audio device identity exhausted');}
    return port;
  }
  device(epoch) {const port=this.current();if(!port||epoch!==this.epoch)throw new Error('Audio output unavailable or replaced');return port;}
  info(kind) {const port=this.current();if(kind===3)return Math.min(this.soundCeiling,port?.soundCeiling||256);if(!port)return 0;return kind===0?this.epoch:kind===1?port.node.context?.sampleRate||0:kind===2?port.channels||0:kind===4?port.autoHint:0;}
  record(id) {const record=this.requests.get(id);if(!record)throw new Error('Unknown audio request');return record;}
  allocate(epoch,kind) {
    const port=this.device(epoch);
    if(this.requests.size>=32||this.next>0xffffffff)throw new Error('Audio bridge request budget exceeded');
    const record={id:this.next++,epoch,port,kind,status:0,value:0,error:'',cancelled:false,bytes:0};this.requests.set(record.id,record);return record;
  }
  notify(id){try{this.onReady(id);}catch{this.close();}}
  run(record,promise) {
    Promise.resolve(promise).then(value=>{
      if(record.cancelled){if(record.kind==='play')record.port.stop(value).catch(()=>{});else if(record.kind==='upload'||record.kind==='stream')record.port.deleteClip(value).catch(()=>{});return;}
      record.value=value;record.status=1;this.notify(record.id);
    },error=>{if(!record.cancelled){record.error=String(error.message||error).slice(0,512);record.status=2;this.notify(record.id);}})
      .finally(()=>{if(record.bytes){this.stagingBytes-=record.bytes;record.bytes=0;}if(record.graphBytes){this.graphStagingBytes-=record.graphBytes;record.graphBytes=0;}record.samples=null;record.data=null;});
  }
  begin(epoch,rate,channels,mask,count) {
    integer(rate,1,768000,'sample rate');integer(channels,1,32,'channel count');integer(mask,0,0xffffffff,'channel mask');integer(count,1,MAX_BYTES/4,'sample count');
    if(count%channels||count*4>MAX_BYTES-this.stagingBytes)throw new Error('Audio staging budget exceeded');
    const record=this.allocate(epoch,'upload');
    try{record.samples=new Float32Array(count);}catch(error){this.requests.delete(record.id);throw error;}
    record.rate=rate;record.channels=channels;record.mask=mask;record.position=0;record.status=1;
    record.bytes=count*4;this.stagingBytes+=record.bytes;return record.id;
  }
  append(id,samples) {
    const record=this.record(id);this.device(record.epoch);
    if(record.kind!=='upload'||record.committed||!(samples instanceof Float32Array)||samples.length>CHUNK_SAMPLES||samples.length>record.samples.length-record.position)throw new Error('Invalid audio upload chunk');
    record.samples.set(samples,record.position);record.position+=samples.length;return 1;
  }
  commit(id) {
    const record=this.record(id);this.device(record.epoch);
    if(record.kind!=='upload'||record.committed||record.position!==record.samples.length)throw new Error('Incomplete audio upload');
    record.committed=true;record.status=0;const controller=record.controller=new AbortController();
    // Its turn comes once the uploads committed before it settled.
    const upload=()=>controller.signal.aborted?Promise.reject(new Error('Audio upload cancelled')):record.port.registerOwnedClip({samples:record.samples,sampleRate:record.rate,channels:record.channels,channelMask:record.mask},{signal:controller.signal});
    const result=this.uploads.then(upload,upload);this.uploads=result.catch(()=>{});this.run(record,result);return 1;
  }
  play(epoch,values) {
    if(!(values instanceof DataView)||values.byteLength!==36)throw new Error('Invalid audio play command');
    const record=this.allocate(epoch,'play'),clip={owner:record.port.owner,token:values.getUint32(0,true)};
    try{this.run(record,record.port.play(clip,{gain:values.getFloat32(4,true),pitch:values.getFloat32(8,true),startFrame:values.getUint32(12,true),loopFrames:values.getUint32(20,true)?[values.getUint32(16,true),values.getUint32(20,true)]:null,pan:Number.isNaN(values.getFloat32(24,true))?null:values.getFloat32(24,true),bus:values.getUint32(28,true),priority:values.getInt32(32,true)}));}
    catch(error){this.requests.delete(record.id);throw error;}return record.id;
  }
  outputs(epoch,action,id=''){
    integer(action,0,4,'audio output operation');const output=this.getOutput();if(!output)throw new Error('Audio output controller is unavailable');
    const record=this.allocate(epoch,'outputs');record.controller=new AbortController();
    try{const result=action===4?Promise.resolve(output.resume()).then(()=>output.outputStatus()):action===0?output.outputStatus():action===1?output.listOutputs():action===2?output.switchOutput(id,{signal:record.controller.signal}):output.chooseOutput({signal:record.controller.signal});
      this.run(record,Promise.resolve(result).then(value=>{const bytes=new TextEncoder().encode(JSON.stringify(value));if(bytes.length>128*1024)throw new Error('Audio output result budget exceeded');return bytes;}));
    }catch(error){this.requests.delete(record.id);throw error;}return record.id;
  }
  // Byte results: output device data, and graph feedback records.
  outputLength(id){const record=this.record(id);if((record.kind!=='outputs'&&record.kind!=='graph')||record.status!==1||!(record.value instanceof Uint8Array))throw new Error('Audio output result is not ready');return record.value.length;}
  outputCopy(id,offset,out){const record=this.record(id);if((record.kind!=='outputs'&&record.kind!=='graph')||record.status!==1||!(record.value instanceof Uint8Array)||!Number.isInteger(offset)||offset<0||out.length>65536||offset+out.length>record.value.length)throw new Error('Invalid audio output copy range');out.set(record.value.subarray(offset,offset+out.length));return out.length;}
  // Synthesis graph requests: the opening, a batch staged like a clip
  // upload and answered by a feedback record, and closing.
  graphOpen(epoch,bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length>65536)throw new Error('Invalid audio graph opening');
    const record=this.allocate(epoch,'graph');this.run(record,record.port.graphOpen(bytes.slice()));return record.id;
  }
  graphBegin(epoch,length){
    integer(length,1,GRAPH_MAX_BYTES,'audio graph batch length');if(length>GRAPH_MAX_BYTES-this.graphStagingBytes)throw new Error('Audio graph staging budget exceeded');
    const record=this.allocate(epoch,'graph');
    try{record.data=new Uint8Array(length);}catch(error){this.requests.delete(record.id);throw error;}
    record.position=0;record.status=1;record.graphBytes=length;this.graphStagingBytes+=length;return record.id;
  }
  graphAppend(id,bytes){
    const record=this.record(id);this.device(record.epoch);
    if(record.kind!=='graph'||!record.data||record.committed||!(bytes instanceof Uint8Array)||bytes.length>65536||bytes.length>record.data.length-record.position)throw new Error('Invalid audio graph chunk');
    record.data.set(bytes,record.position);record.position+=bytes.length;return 1;
  }
  graphCommit(id){
    const record=this.record(id);this.device(record.epoch);
    if(record.kind!=='graph'||!record.data||record.committed||record.position!==record.data.length)throw new Error('Incomplete audio graph batch');
    record.committed=true;record.status=0;this.run(record,record.port.graphApply(record.data));return 1;
  }
  graphClose(epoch){const record=this.allocate(epoch,'graph');this.run(record,record.port.graphClose());return record.id;}
  preferences(epoch,values){
    if(!(values instanceof DataView)||values.byteLength!==32)throw new Error('Invalid audio preference command');
    const volumes=Array.from({length:5},(_,index)=>values.getFloat32(index*4,true)),flags=values.getUint32(20,true),requested=values.getUint32(24,true)||'auto',autoLimit=values.getUint32(28,true);
    preferences(volumes,flags,requested,autoLimit);
    const record=this.allocate(epoch,'preferences');this.run(record,record.port.applyPreferences({volumes,muteWhenUnfocused:!!(flags&1),mono:!!(flags&2),spatialization:!(flags&4),focused:!(flags&8),requested},autoLimit));return record.id;
  }
  command(epoch,op,handle,a,b) {
    integer(op,1,21,'audio operation');if(op===12)throw new Error('Reserved audio operation');
    if(op===16){
      integer(a,1,768000,'sample rate');integer(b,0,2**27,'stream shape');
      const record=this.allocate(epoch,'stream');
      this.run(record,record.port.openStream({sampleRate:a,channels:Math.floor(b/2**21),capacityFrames:b%2**21}));return record.id;
    }
    if(op===10)integer(a,1,this.info(3),'sound limit');
    if(op===14||op===15){integer(handle,0,4,'bus');if(op===14)integer(a,0,this.info(3),'reserved sounds');}
    const record=this.allocate(epoch,op===13?'stats':'command');
    this.run(record,op===13?record.port.stats():record.port.request('command',{op,handle,a,b}));return record.id;
  }
  // Copies the samples before returning; the frames written arrive plus one.
  streamWrite(epoch,handle,samples) {
    if(!(samples instanceof Float32Array)||samples.length>CHUNK_SAMPLES)throw new Error('Invalid audio stream chunk');
    const record=this.allocate(epoch,'command'),owned=new Float32Array(samples);
    this.run(record,record.port.request('streamWrite',{handle:integer(handle,1,0xffffffff,'audio handle'),samples:owned},[owned.buffer]));return record.id;
  }
  poll(id){return this.record(id).status;}
  result(id){const record=this.record(id);if(record.status!==1)throw new Error('Audio request is not ready');return record.kind==='upload'||record.kind==='play'||record.kind==='stream'?record.value.token:record.kind==='preferences'?record.value.effectiveLimit:record.kind==='command'?record.value:1;}
  metric(id,kind){const record=this.record(id);if(record.status!==1||record.kind!=='stats')throw new Error('Audio stats are not ready');const fields=['frames','active','clipBytes','fault','effectiveLimit','capacity','virtualized','suppressed','virtualizationEvents','clippedSamples','finishedVoices','replacedVoices','timingClock','renderedBlocks','overloadedBlocks','underruns','peakRenderNanos','autoRecommendation'];if(kind===18)return record.value.peakRenderNanos==null?0:1;return record.value[fields[kind]]??0;}
  error(id){return this.record(id).error;}
  take(id){const value=this.result(id);this.requests.delete(id);return value;}
  cancel(id) {
    const record=this.requests.get(id);if(!record)return;this.requests.delete(id);record.cancelled=true;record.controller?.abort();
    if(record.status===1&&record.value){if(record.kind==='upload'||record.kind==='stream')record.port.deleteClip(record.value).catch(()=>{});else if(record.kind==='play')record.port.stop(record.value).catch(()=>{});}
    if(!record.committed&&record.kind==='upload'){if(record.bytes){this.stagingBytes-=record.bytes;record.bytes=0;}record.samples=null;}
    if(!record.committed&&record.kind==='graph'&&record.data){if(record.graphBytes){this.graphStagingBytes-=record.graphBytes;record.graphBytes=0;}record.data=null;}
    // Replacement/cancellation must also wake a Rust waiter. Explicit Drop has
    // already removed its waker, so this notification is harmless there.
    this.notify(id);
  }
  close(){if(this.closed)return;this.closed=true;for(const id of this.requests.keys())this.cancel(id);this.port=null;}
}
return {GRAPH_MAX_BYTES, detectAudioHint, AudioPort, prepareAudioModule, createAudioNode, BrowserAudio, AudioBridge};
})();
// courier
const __courier = (() => {
// The page's courier (runtime.mjs makes it a blob worker of the page's
// own: no game code runs in it, and nothing it holds reaches the game's
// worker). A signed-in page starts it with the game's worker, telling it
// the API origin and the game's id; the game's worker gets a port to it in
// its start message, before any of the game's code runs. As the game quits
// the page gives the courier the player's credential, and the game's
// worker hands it the requests the quit leaves (its last save, settings
// and platform calls, which the page no longer takes: it is going away).
// The courier sends each the runtime makes for this game (`route`) with
// the credential and `keepalive`, so it goes out though the page and both
// workers end: at most MAX_REQUESTS, their bodies within the browser's
// 64 KiB keepalive quota. Then it forgets the credential and closes. Both
// functions close over nothing: their sources make the worker.

/** The requests the courier sends at most, per quit. */
const MAX_REQUESTS = 16;

/** The rule of the runtime's own quit request `method path` for `game` (the
 * routes crates/starhermit-runtime/src/leaving.rs makes, as
 * tests/courier-routes.txt lists them), or null for any other: `save` when
 * it is the save's conditional upload (which alone may carry `If-Match` or
 * `If-None-Match`). Path segments are those the SDK sends unescaped; an
 * escaped byte, `.` and `..` segments and other games' ids are refused. */
function route(method, path, game) {
  // A segment the SDK sends unescaped, not all dots.
  const I = '(?!\\.+(?:/|&|$))[A-Za-z0-9._~:@-]+', Q = `queues=${I}(?:&queues=${I})*`;
  if (typeof method !== 'string' || typeof path !== 'string' || typeof game !== 'string' || !new RegExp(`^${I}$`).test(game)) return null;
  const G = game.replace(/[.]/g, '\\.');
  const RULES = [
    ['PATCH', `games/${G}/settings`], ['PUT', `me/cloud-saves/game:${G}`, null, true],
    ['POST', 'me/friend-requests'], ['POST', `me/friend-requests/${I}/(?:accept|decline)`], ['DELETE', `me/friends/${I}`],
    ['POST', 'realtime/rooms'], ['POST', 'realtime/rooms/(?:join-by-code|quick-join)'], ['PATCH', `realtime/rooms/${I}`],
    ['POST', `realtime/rooms/${I}/(?:open|start|leave|invites|seats)`], ['POST', `realtime/rooms/${I}/matchmake`, Q],
    ['POST', `realtime/rooms/invites/${I}/(?:accept|decline)`],
    ['POST', `games/${G}/sessions/${I}/leave`], ['POST', `games/${G}/sessions/ai`], ['POST', `games/${G}/invites`],
    ['POST', `games/${G}/invites/${I}/(?:accept|decline)`], ['POST', `games/${G}/matchmaking`, Q], ['DELETE', `games/${G}/matchmaking`],
    ['POST', `chat/conversations/${I}/messages`], ['PUT', `chat/conversations/${I}/messages/${I}`],
    ['DELETE', `chat/conversations/${I}/messages/${I}`], ['POST', `chat/conversations/${I}/read`],
    ['POST', `games/${G}/moderation/flags`], ['POST', `games/${G}/reports`],
  ];
  const at = path.indexOf('?'), where = at < 0 ? path : path.slice(0, at), query = at < 0 ? null : path.slice(at + 1);
  if (!where.startsWith('/api/v1/')) return null;
  for (const [verb, pattern, queries = null, save = false] of RULES) {
    if (verb !== method || !new RegExp(`^/api/v1/${pattern}$`).test(where)) continue;
    if (query === null ? false : queries === null || !new RegExp(`^${queries}$`).test(query)) return null;
    return {save};
  }
  return null;
}

/** The courier's work in `scope` (the worker's global object), sending what
 * `route` allows. */
function courier(route, scope) {
  const MAX = 16, QUOTA = 64 * 1024, HEADERS = new Set(['content-type', 'accept']), CONDITIONS = new Set(['if-match', 'if-none-match']);
  let origin = null, game = null, token = null, used = 0, sent = 0, done = false, ending = false;
  const waiting = [];
  // The credential is forgotten at once; the worker closes a moment later
  // (the requests it started go on without it).
  const finish = () => {
    if (done) return;
    done = true; token = null; waiting.length = 0;
    scope.setTimeout(() => scope.close(), 1000);
  };
  const send = ({head, body} = {}) => {
    if (done) return;
    if (token === null) { if (waiting.length < MAX) waiting.push({head, body}); return; }
    if (sent >= MAX) { finish(); return; }
    try {
      const lines = String(head).split('\n'); if (lines.at(-1) === '') lines.pop();
      const [method, path, ...rest] = (lines.shift() || '').split(' ');
      const rule = rest.length || lines.length > 32 ? null : route(method, path, game);
      if (!rule) return;
      const headers = new scope.Headers();
      for (const line of lines) {
        const split = line.indexOf(':'), name = line.slice(0, split).trim().toLowerCase(), value = line.slice(split + 1).trim();
        if (split < 1 || !(HEADERS.has(name) || rule.save && CONDITIONS.has(name)) || /[\x00-\x1f\x7f]/.test(value)) return;
        headers.set(name, value);
      }
      if (!(body instanceof Uint8Array) || used + body.byteLength > QUOTA) return;
      const url = new scope.URL(path, origin); if (url.origin !== origin) return;
      used += body.byteLength; sent++;
      headers.set('authorization', `Bearer ${token}`);
      scope.fetch(url.href, {method, headers, ...(body.byteLength ? {body} : {}), keepalive: true, credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer'}).catch(() => {});
    } catch {}
  };
  scope.addEventListener('message', event => {
    const data = event.data;
    if (data?.port instanceof scope.MessagePort && origin === null) {
      origin = new scope.URL(data.origin).origin; game = String(data.game);
      data.port.onmessage = message => {
        if (message.data?.done === true) { if (token === null) ending = true; else finish(); }
        else send(message.data ?? {});
      };
    } else if (typeof data?.token === 'string' && token === null && !done && origin !== null && data.token && !/\s/.test(data.token)) {
      token = data.token;
      waiting.splice(0).forEach(send);
      // The game's worker has its second to quit, and the page ends it ten
      // seconds on at most.
      if (ending) finish(); else scope.setTimeout(finish, 10000);
    }
  });
}
return {MAX_REQUESTS, route, courier};
})();
// voice
const __voice = (() => {
// Browser voice media for games with voice chat (packaged only for them):
// microphone capture through getUserMedia and an AudioWorklet tap, input
// device lists, and one RTCPeerConnection per remote participant using
// perfect negotiation. The game's WebAssembly polls everything through the
// `voice_*` imports (crates/starhermit-sys/src/audio_capture/browser.rs);
// signaling payloads ({sdp} / {ice}) travel over the platform voice socket,
// which the game owns. Nothing here asks for the microphone until the game
// opens a capture, which it does from the player's explicit enable action.
const encoder = new TextEncoder();
const STATE = {prompting: 1, granted: 2, denied: 3, unavailable: 4, lost: 5};
const PEER_STATES = {new: 0, connecting: 1, connected: 2, disconnected: 3, failed: 4, closed: 5};

/// A bounded FIFO of Float32Array blocks; overflow drops the oldest audio.
/// Consumed blocks go back to `recycle` (the worklet that filled them), so
/// steady capture allocates nothing.
class SampleQueue {
  constructor(limit) { this.blocks = []; this.offset = 0; this.length = 0; this.limit = limit; this.dropped = 0; this.recycle = null; }
  free(block) { this.recycle?.(block); }
  push(block) {
    this.blocks.push(block); this.length += block.length;
    while (this.length - this.offset > this.limit && this.blocks.length > 1) {
      const first = this.blocks.shift(); this.dropped += first.length - this.offset; this.length -= first.length; this.offset = 0;
      this.free(first);
    }
  }
  take(out) {
    let written = 0;
    while (written < out.length && this.blocks.length) {
      const first = this.blocks[0];
      const count = Math.min(out.length - written, first.length - this.offset);
      out.set(first.subarray(this.offset, this.offset + count), written);
      written += count; this.offset += count;
      if (this.offset === first.length) { this.blocks.shift(); this.length -= first.length; this.offset = 0; this.free(first); }
    }
    return written;
  }
}

class VoiceBridge {
  constructor({workletURL = new URL('./voice-worklet.js', import.meta.url), mediaDevices = globalThis.navigator?.mediaDevices,
    permissions = globalThis.navigator?.permissions, PeerConnection = globalThis.RTCPeerConnection,
    createContext = options => new AudioContext(options), onState = () => {}, document = globalThis.document} = {}) {
    Object.assign(this, {workletURL, mediaDevices, PeerConnection, createContext, onState, document});
    this.captures = new Map(); this.peers = new Map(); this.queries = new Map(); this.next = 1;
    this.permission = 0; this.context = null; this.ready = null; this.taps = new Set();
    // A hidden tab sends nothing: every sender drops its track at once and
    // gets it back only on the game's next send request after the page is
    // visible again (voice_peer_send(1)).
    this.onVisibility = () => { if (this.hidden()) for (const peer of this.peers.values()) peer.hide(); };
    document?.addEventListener?.('visibilitychange', this.onVisibility);
    permissions?.query?.({name: 'microphone'}).then(status => {
      const update = () => { this.permission = {prompt: 1, granted: 2, denied: 3}[status.state] ?? 0; };
      update(); status.onchange = update;
    }).catch(() => {});
  }
  hidden() { return this.document?.visibilityState === 'hidden'; }
  /// The shared voice AudioContext, at `rate` when the browser allows it.
  /// `defaultRate` makes it at the browser's own rate (the game resamples):
  /// Firefox refuses to connect a microphone to a context at another rate.
  async ensureContext(rate, defaultRate = false) {
    if (!this.context) {
      const options = {latencyHint: 'interactive'};
      try { this.context = this.createContext(defaultRate ? options : {...options, sampleRate: rate}); }
      catch { this.context = this.createContext(options); }
    }
    // A failed module load is not kept: the next request tries again.
    if (!this.ready) {
      const context = this.context;
      this.ready = context.audioWorklet.addModule(this.workletURL).catch(error => { if (this.context === context) this.ready = null; throw error; });
    }
    await this.ready;
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
    return this.context;
  }
  /// Moves to a context at the browser's rate and re-taps every stream.
  async resetContext() {
    const old = this.context; this.context = null; this.ready = null;
    const taps = [...this.taps];
    for (const tap of taps) tap.detach();
    old?.close?.().catch?.(() => {});
    await this.ensureContext(0, true);
    for (const tap of taps) tap.attach();
  }
  /// A tap node delivering `stream` into `queue`; returns a disconnect function.
  tap(stream, queue) {
    const tap = {};
    tap.attach = () => {
      const context = this.context;
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'starhermit-voice-tap', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'});
      const silent = context.createGain(); silent.gain.value = 0;
      node.port.onmessage = event => { if (event.data instanceof Float32Array) queue.push(event.data); };
      queue.recycle = block => { try { node.port.postMessage(block, [block.buffer]); } catch {} };
      source.connect(node); node.connect(silent); silent.connect(context.destination);
      tap.detach = () => { queue.recycle = null; node.port.postMessage('close'); node.port.onmessage = null; source.disconnect(); node.disconnect(); silent.disconnect(); };
    };
    tap.attach();
    this.taps.add(tap);
    return () => { tap.detach(); this.taps.delete(tap); };
  }
  /// As `tap`, moving to the browser's own rate when the context refuses
  /// the stream at the requested one (Firefox's NotSupportedError).
  async tapAnyRate(stream, queue) {
    try { return this.tap(stream, queue); }
    catch (error) {
      if (error?.name !== 'NotSupportedError' || this.context?.defaultRate) throw error;
      await this.resetContext();
      this.context.defaultRate = true;
      return this.tap(stream, queue);
    }
  }
  openCapture(rate, flags, device) {
    const id = this.next++;
    const capture = {state: STATE.prompting, queue: new SampleQueue(rate), stream: null, track: null, untap: null,
      processing: [0, 0, 0], deviceId: '', muted: false, peers: new Set(), closed: false};
    this.captures.set(id, capture);
    const audio = {echoCancellation: !!(flags & 1), noiseSuppression: !!(flags & 2), autoGainControl: !!(flags & 4), channelCount: 1};
    const request = exact => this.mediaDevices.getUserMedia({audio: exact ? {...audio, deviceId: {exact}} : audio});
    (async () => {
      if (!this.mediaDevices?.getUserMedia) throw Object.assign(new Error('getUserMedia unavailable'), {name: 'NotSupportedError'});
      let stream;
      try { stream = await request(device); }
      catch (error) {
        // A chosen device that is gone: the system default stands in and
        // the choice is kept (the game sees the effective device differ).
        if (!device || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error;
        stream = await request('');
      }
      if (capture.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      const track = stream.getAudioTracks()[0];
      if (!track) throw Object.assign(new Error('no audio track'), {name: 'NotFoundError'});
      await this.ensureContext(rate);
      if (capture.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      const settings = track.getSettings?.() ?? {};
      const applied = value => value === true ? 2 : value === false ? 1 : 0;
      capture.processing = [applied(settings.echoCancellation), applied(settings.noiseSuppression), applied(settings.autoGainControl)];
      capture.deviceId = settings.deviceId ?? '';
      const untap = await this.tapAnyRate(stream, capture.queue);
      if (capture.closed) { untap(); stream.getTracks().forEach(track => track.stop()); return; }
      Object.assign(capture, {stream, track, untap, state: STATE.granted});
      track.enabled = !capture.muted;
      track.addEventListener('ended', () => { if (!capture.closed) capture.state = STATE.lost; });
      for (const peer of capture.peers) peer.addLocal(track, stream);
      this.permission = 2; this.onState({capture: id, state: 'granted'});
    })().catch(error => {
      capture.state = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(error?.name) ? STATE.denied : STATE.unavailable;
      capture.error = String(error?.message || error);
      if (capture.state === STATE.denied) this.permission = 3;
      this.onState({capture: id, state: capture.state === STATE.denied ? 'denied' : 'unavailable', reason: capture.error});
    });
    return id;
  }
  closeCapture(id) {
    const capture = this.captures.get(id); if (!capture) return;
    capture.closed = true; capture.untap?.(); capture.stream?.getTracks().forEach(track => track.stop());
    for (const peer of capture.peers) peer.capture = null;
    this.captures.delete(id);
  }
  beginDevices() {
    const id = this.next++; const query = {status: 0, text: ''}; this.queries.set(id, query);
    Promise.resolve(this.mediaDevices?.enumerateDevices?.() ?? Promise.reject(new Error('enumerateDevices unavailable'))).then(devices => {
      query.text = devices.filter(device => device.kind === 'audioinput' && device.deviceId)
        .map((device, index) => `${device.deviceId.replace(/[\t\n]/g, ' ')}\t${(device.label || `Microphone ${index + 1}`).replace(/[\t\n]/g, ' ')}\n`).join('');
      query.status = 1;
    }, () => { query.status = 2; });
    return id;
  }
  openPeer(captureId, polite, config) {
    const id = this.next++;
    const pc = new this.PeerConnection(config ? JSON.parse(config) : undefined);
    const peer = {pc, polite, outgoing: [], queue: new SampleQueue(48000), untap: null, element: null, capture: null,
      makingOffer: false, ignoreOffer: false, answerPending: false, chain: Promise.resolve(), sending: true, hidden: this.hidden(), sent: undefined};
    const send = payload => { if (peer.outgoing.length < 256) peer.outgoing.push(JSON.stringify(payload)); };
    // What the sender carries: the track while transmitting from a visible
    // page, else nothing (pausing without renegotiating).
    peer.apply = () => {
      if (!peer.sender || pc.signalingState === 'closed') return;
      const track = peer.sending && !peer.hidden ? peer.track ?? null : null;
      if (track === peer.sent) return;
      peer.sent = track;
      peer.sender.replaceTrack(track).catch(() => {});
    };
    peer.addLocal = (track, stream) => {
      if (pc.signalingState === 'closed') return;
      peer.track = track;
      if (!peer.sender) { peer.sender = pc.addTrack(track, stream); peer.sent = track; }
      peer.apply();
    };
    peer.hide = () => { peer.hidden = true; peer.apply(); };
    peer.setSending = sending => {
      peer.sending = sending;
      // Back from a hidden tab only on a send request while visible.
      if (sending && peer.hidden && !this.hidden()) peer.hidden = false;
      peer.apply();
    };
    // Another microphone (a device change): the sender's track is replaced,
    // no new connection.
    peer.attach = captureId => {
      peer.capture?.peers.delete(peer); peer.capture = null;
      const capture = this.captures.get(captureId);
      if (!capture) { peer.track = null; peer.apply(); return; }
      peer.capture = capture; capture.peers.add(peer);
      if (capture.track) peer.addLocal(capture.track, capture.stream); else { peer.track = null; peer.apply(); }
    };
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); send({sdp: pc.localDescription.toJSON()}); }
      catch (error) { peer.error = String(error?.message || error); }
      finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({candidate}) => { if (candidate) send({ice: candidate.toJSON()}); };
    pc.ontrack = ({track, streams}) => {
      const stream = streams[0] ?? new MediaStream([track]);
      // Chrome delivers remote WebRTC audio to Web Audio only while a media
      // element also plays the stream; it stays muted (the game mixes).
      if (globalThis.Audio) { peer.element = new Audio(); peer.element.muted = true; peer.element.srcObject = stream; peer.element.play?.().catch(() => {}); }
      this.ensureContext(this.context?.sampleRate ?? 48000).then(() => { if (pc.signalingState !== 'closed') { peer.untap?.(); peer.untap = this.tap(stream, peer.queue); } }).catch(error => { peer.error = String(error?.message || error); });
    };
    peer.signal = payload => {
      peer.chain = peer.chain.then(async () => {
        const {sdp, ice} = payload;
        if (sdp) {
          const ready = !peer.makingOffer && (pc.signalingState === 'stable' || peer.answerPending);
          const collision = sdp.type === 'offer' && !ready;
          peer.ignoreOffer = !polite && collision;
          if (peer.ignoreOffer) return;
          peer.answerPending = sdp.type === 'answer';
          await pc.setRemoteDescription(sdp);
          peer.answerPending = false;
          if (sdp.type === 'offer') { await pc.setLocalDescription(); send({sdp: pc.localDescription.toJSON()}); }
        } else if (ice) {
          try { await pc.addIceCandidate(ice); } catch (error) { if (!peer.ignoreOffer) throw error; }
        }
      }).catch(error => { peer.error = String(error?.message || error); });
    };
    peer.attach(captureId);
    this.peers.set(id, peer);
    return id;
  }
  closePeer(id) {
    const peer = this.peers.get(id); if (!peer) return;
    peer.untap?.(); peer.pc.close(); if (peer.element) peer.element.srcObject = null;
    peer.capture?.peers.delete(peer); this.peers.delete(id);
  }
  close() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    for (const id of [...this.captures.keys()]) this.closeCapture(id);
    this.context?.close().catch(() => {}); this.context = null; this.ready = null;
    this.document?.removeEventListener?.('visibilitychange', this.onVisibility);
  }
  /// The `voice_*` imports, bound to a host offering `memory(ptr, len)`,
  /// `text(ptr, len)` and `guard(callback, failed)` (BrowserHost does).
  imports(host) {
    const floats = (ptr, count) => { if (ptr % 4) throw new Error('Invalid voice memory range'); const bytes = host.memory(ptr, count * 4); return new Float32Array(bytes.buffer, bytes.byteOffset, count); };
    const write = (text, ptr, capacity) => { const bytes = encoder.encode(text); if (bytes.length > capacity) return 0; host.memory(ptr, bytes.length).set(bytes); return bytes.length; };
    return {
      voice_capture_open: (rate, flags, ptr, len) => host.guard(() => { if (!(rate >= 8000 && rate <= 48000) || len > 1024) throw new Error('Invalid capture request'); return this.openCapture(rate, flags, host.text(ptr, len)); }),
      voice_capture_state: id => host.guard(() => this.captures.get(id)?.state ?? STATE.unavailable, STATE.unavailable),
      voice_capture_read: (id, ptr, capacity) => host.guard(() => { const capture = this.captures.get(id); return capture ? capture.queue.take(floats(ptr, Math.min(capacity, 65536))) : 0; }),
      voice_capture_info: (id, kind) => host.guard(() => {
        if (id === 0) return kind === 0 ? this.context?.sampleRate ?? 0 : 0;
        const capture = this.captures.get(id); if (!capture) return 0;
        return kind === 0 ? (capture.state === STATE.granted ? this.context?.sampleRate ?? 0 : 0) : kind === 1 ? capture.queue.dropped : capture.processing[kind - 2] ?? 0;
      }),
      voice_capture_device: (id, ptr, capacity) => host.guard(() => write(this.captures.get(id)?.deviceId ?? '', ptr, capacity)),
      voice_capture_mute: (id, muted) => host.guard(() => { const capture = this.captures.get(id); if (capture) { capture.muted = muted !== 0; if (capture.track) capture.track.enabled = !capture.muted; } }),
      voice_capture_close: id => host.guard(() => this.closeCapture(id)),
      voice_permission: () => this.permission,
      voice_devices_begin: () => host.guard(() => this.beginDevices()),
      voice_devices_poll: id => host.guard(() => this.queries.get(id)?.status ?? 2, 2),
      voice_devices_copy: (id, ptr, capacity) => host.guard(() => write(this.queries.get(id)?.text ?? '', ptr, capacity)),
      voice_devices_close: id => { this.queries.delete(id); },
      voice_peer_open: (capture, polite, ptr, len) => host.guard(() => { if (!this.PeerConnection) throw new Error('WebRTC unavailable'); if (len > 16384) throw new Error('Invalid peer configuration'); return this.openPeer(capture, polite !== 0, len ? host.text(ptr, len) : ''); }),
      voice_peer_signal: (id, ptr, len) => host.guard(() => { const peer = this.peers.get(id); if (!peer || len > 65536) return 0; const payload = JSON.parse(host.text(ptr, len)); if (typeof payload !== 'object' || payload === null || !(payload.sdp || payload.ice)) return 0; peer.signal(payload); return 1; }),
      voice_peer_outgoing: (id, ptr, capacity) => host.guard(() => { const peer = this.peers.get(id); if (!peer?.outgoing.length) return 0; const written = write(peer.outgoing[0], ptr, capacity); if (written) peer.outgoing.shift(); return written; }),
      voice_peer_outgoing_length: id => host.guard(() => { const next = this.peers.get(id)?.outgoing[0]; return next ? encoder.encode(next).length : 0; }),
      voice_peer_attach: (id, capture) => host.guard(() => { this.peers.get(id)?.attach(capture); }),
      voice_peer_state: id => host.guard(() => { const peer = this.peers.get(id); return peer ? PEER_STATES[peer.pc.connectionState] ?? 1 : PEER_STATES.closed; }, PEER_STATES.closed),
      voice_peer_read: (id, ptr, capacity) => host.guard(() => { const peer = this.peers.get(id); return peer ? peer.queue.take(floats(ptr, Math.min(capacity, 65536))) : 0; }),
      voice_peer_send: (id, sending) => host.guard(() => { this.peers.get(id)?.setSending(sending !== 0); }),
      voice_peer_close: id => host.guard(() => this.closePeer(id)),
    };
  }
}
return {VoiceBridge};
})();
// host
const __host = (() => {
const {selectGraphics,measureGraphics,deviceKind,MESH_FRAME_LENGTH,MESH_MATERIAL_LENGTH,MESH_BATCH_LENGTH,MESH_INSTANCE_LENGTH,meshLayoutInfo,MESH_LIMITS,MESH_PROGRAM_STAGES,MAX_MESH_UNIFORM_FLOATS,mipChainBytes} = __graphics;
const {PreferenceStore} = __storage;
const {AssetFetcher} = __assets;
const {ApiFetcher, captureLaunch} = __http;
const {SocketHub} = __sockets;
const {InstanceElection} = __instance;
const {SaveSlots} = __saves;
const {ContentStore} = __content;
const {VoiceBridge} = __voice;
const encoder = new TextEncoder(); const decoder = new TextDecoder('utf-8', {fatal: true});
const MAX_WASM = 64 * 1024 * 1024;
/** Whether `error` is the browser refusing memory for a buffer: V8's "Array buffer allocation failed", its "Out of
 * memory at ImageData creation", Blink's "Failed to allocate buffer" (TextEncoder) and WebKit's "Out of memory".
 * The page shares what its renderer process may give buffers with the game's worker, so a game that holds it all
 * leaves the page none; the runtime's `GameError::worker_fault` (host.rs) reads a worker's fault the same way. */
function outOfMemory(error) {
  return (error instanceof RangeError || error?.name === 'UnknownError') && /allocation failed|failed to allocate|out of memory/i.test(String(error.message));
}
// The game's cursors (input.setCursor), numbered as CursorShape::ALL is.
const CURSORS = ['default', 'pointer', 'crosshair', 'move', 'grab', 'grabbing', 'text', 'wait', 'progress', 'help', 'not-allowed', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize', 'none'];
async function instantiateWasm(url, imports, {fetch: fetcher = globalThis.fetch, wasmBytes, onProgress = () => {}} = {}) {
  if (wasmBytes) {
    if (wasmBytes.byteLength > MAX_WASM) throw new Error('WASM download budget exceeded');
    const result = await WebAssembly.instantiate(wasmBytes, imports); return {...result, loadingMode: 'bytes'};
  }
  onProgress('Downloading game'); const response = await fetcher(url);
  if (!response.ok) throw new Error(`Game download failed (${response.status})`);
  if (Number(response.headers.get('Content-Length')) > MAX_WASM) throw new Error('WASM download budget exceeded');
  const streaming = response.headers.get('Content-Type')?.split(';')[0].trim() === 'application/wasm';
  if (streaming && WebAssembly.instantiateStreaming) {
    let streamedBytes = 0;
    const bounded = response.clone().body?.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        streamedBytes += chunk.byteLength;
        if (streamedBytes > MAX_WASM) throw new Error('WASM download budget exceeded');
        controller.enqueue(chunk);
      },
    }));
    const streamingResponse = bounded ? new Response(bounded, {headers: response.headers}) : response.clone();
    try { const result = await WebAssembly.instantiateStreaming(streamingResponse, imports); return {...result, loadingMode: 'streaming'}; }
    catch (error) { if (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.LinkError) throw error; }
  }
  // Bound fallback downloads even if the server omitted or lied about length.
  const chunks = []; let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try { while (true) { const {done, value} = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_WASM) { await reader.cancel(); throw new Error('WASM download budget exceeded'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
  } else { const bytes = new Uint8Array(await response.arrayBuffer()); total = bytes.byteLength; if (total > MAX_WASM) throw new Error('WASM download budget exceeded'); chunks.push(bytes); }
  const bytes = new Uint8Array(total); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  onProgress('Initializing game'); const result = await WebAssembly.instantiate(bytes, imports); return {...result, loadingMode: 'array-buffer'};
}

// WASM plugins in the page's own engine. Modules arrive instrumented by the
// game (fuel in `sh_fuel`, call depth in `sh_depth`); their host-API imports
// call back into the game through `sh_plugin_host`.
const PLUGIN_HOST_TRAP = -(2n ** 63n);
class PluginHostTrap extends Error {}
// A DOM mouse button as the engine numbers buttons (X11's numbering,
// which every native backend reports): 1 left, 2 middle, 3 right, 8 back,
// 9 forward; others from 10, clear of X11's wheel buttons 4 to 7.
function buttonNumber(button) { return [1, 2, 3, 8, 9][button] ?? Math.min(32, 10 + button - 5); }
// A touch pointer event as the game's touch event code: the phase letter
// (s, m, e, c), 1 for the primary point, and the pressure (- for none).
function touchCode(phase, event) {
  const pressure = Number(event.pressure);
  return `${phase} ${event.isPrimary ? 1 : 0} ${Number.isFinite(pressure) && pressure >= 0 && pressure <= 1 ? Number(pressure.toFixed(4)) : '-'}`;
}
// The canvas's share of the page's safe-area insets (CSS pixels from the
// viewport's edges, as env(safe-area-inset-*) has them), in canvas pixels:
// only what reaches into the canvas, so an embedded canvas clear of the
// notch keeps all of its area (and a canvas scrolled past the viewport's
// edge has no inset there unless the edge has one).
function canvasInsets(rect, viewport, safe, scaleX, scaleY = scaleX) {
  const inset = (side, value, extent, scale) => side > 0 ? Math.round(Math.max(0, Math.min(extent, value)) * scale * 100) / 100 : 0;
  return [inset(safe.top, safe.top - rect.top, rect.height, scaleY), inset(safe.right, rect.right - (viewport.width - safe.right), rect.width, scaleX),
    inset(safe.bottom, rect.bottom - (viewport.height - safe.bottom), rect.height, scaleY), inset(safe.left, safe.left - rect.left, rect.width, scaleX)];
}

class PluginHub {
  constructor(game) { this.game = game; this.instances = new Map(); this.next = 1; }
  get(id) { const instance = this.instances.get(id); if (!instance) throw new Error('No such plugin'); return instance; }
  instantiate(bytes) {
    // Plugins run inside the game's step, so compilation is synchronous;
    // browsers refuse that above 8 MB on the main thread.
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Plugins are at most 8 MB');
    const id = this.next++;
    const host = kind => (...args) => {
      const slots = args.map(value => BigInt(value));
      while (slots.length < 6) slots.push(0n);
      const result = this.game().sh_plugin_host(id, kind, ...slots);
      if (result === PLUGIN_HOST_TRAP) throw new PluginHostTrap('host call refused');
      return result;
    };
    const int = kind => (...args) => Number(BigInt.asIntN(32, host(kind)(...args)));
    const starhermit = {log: (...args) => { host(0)(...args); }, random: host(1), query: int(2), call: int(3), storage_get: int(4), storage_set: int(5)};
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {starhermit});
    if (typeof instance.exports.sh_fuel?.value !== 'bigint' || typeof instance.exports.sh_depth?.value !== 'number') throw new Error('The plugin is not instrumented');
    this.instances.set(id, instance);
    return id;
  }
  exportKind(id, name) {
    const value = this.get(id).exports[name];
    return typeof value === 'function' ? 1 : value instanceof WebAssembly.Memory ? 2 : value === undefined ? 0 : 3;
  }
  invoke(id, name, signature, view, argsPtr, outPtr) {
    const instance = this.get(id);
    const exported = instance.exports[name];
    if (typeof exported !== 'function') return 4;
    const args = [...signature].map((kind, index) => {
      const value = view().getBigInt64(argsPtr + index * 8, true);
      return kind === 'I' ? value : Number(BigInt.asIntN(32, value));
    });
    instance.exports.sh_depth.value = 0;
    try {
      const result = exported(...args);
      view().setBigInt64(outPtr, typeof result === 'bigint' ? result : BigInt(result ?? 0), true);
      return 0;
    } catch (error) {
      if (instance.exports.sh_fuel.value === -1n) return 2;
      if (instance.exports.sh_depth.value === -1) return 3;
      if (error instanceof PluginHostTrap) return 5;
      if (error instanceof WebAssembly.RuntimeError || error instanceof RangeError) throw error;
      throw error;
    }
  }
  read(id, ptr, out) { const memory = new Uint8Array(this.get(id).exports.memory.buffer); if (ptr + out.length > memory.length) return 0; out.set(memory.subarray(ptr, ptr + out.length)); return 1; }
  write(id, ptr, bytes) { const memory = new Uint8Array(this.get(id).exports.memory.buffer); if (ptr + bytes.length > memory.length) return 0; memory.set(bytes, ptr); return 1; }
  release(id) { this.instances.delete(id); }
}

// The game's accessibility tree as ARIA elements in the canvas's fallback
// content, which screen readers read and the canvas never draws. The canvas
// (role application) keeps keyboard focus; aria-activedescendant names the
// focused widget (an open dropdown's highlighted option). Clicks and focus
// that assistive technology sends to the elements become requests the game
// takes (`f <id>` focus, `a <id>` activate). The interface language and
// direction go on the canvas and the mirror's root; nodes in their own
// language (a language's native name) get lang and dir=auto. The game's
// announcements go to two live regions after the widgets (polite and
// assertive), each its own element, so a repeated one is heard again; the
// last few stay (removals are not announced).
class AccessTree {
  constructor() { this.elements = new Map(); this.requests = []; this.root = null; this.canvas = null; this.description = null; this.live = null; }
  attach(canvas, title) {
    if (!this.root) {
      this.root = canvas.ownerDocument.createElement('div'); this.root.id = 'starhermit-access';
      const target = event => event.target?.closest?.('[data-access-id]')?.dataset.accessId;
      this.root.addEventListener('click', event => { const id = target(event); if (id) this.requests.push(`a ${id}`); });
      this.root.addEventListener('focusin', event => { const id = target(event); if (id) { this.requests.push(`f ${id}`); this.canvas?.focus(); } });
      this.live = {};
      for (const level of ['polite', 'assertive']) {
        const region = canvas.ownerDocument.createElement('div'); region.id = `starhermit-live-${level}`;
        region.setAttribute('aria-live', level); region.setAttribute('aria-atomic', 'false'); region.setAttribute('aria-relevant', 'additions');
        this.root.append(region); this.live[level] = region;
      }
    }
    this.canvas = canvas; if (this.root.parentElement !== canvas) canvas.append(this.root);
    canvas.setAttribute('role', 'application'); canvas.setAttribute('aria-roledescription', 'game'); if (title) canvas.setAttribute('aria-label', title);
    if (this.description) this.render(this.description);
  }
  update(canvas, title, description) { this.description = description; this.attach(canvas, title); }
  render({nodes, lang = '', dir = 'ltr'}) {
    const document = this.root.ownerDocument; const seen = new Set(); const placed = new Map(); let active = null;
    for (const target of [this.root, this.canvas]) { if (lang) target.setAttribute('lang', lang); else target.removeAttribute('lang'); target.setAttribute('dir', dir === 'rtl' ? 'rtl' : 'ltr'); }
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
      const key = node.id; seen.add(key); let element = this.elements.get(key);
      const kind = {panel: 'group', label: '', heading: 'heading', image: 'img', button: 'button', keycapture: 'button', checkbox: 'checkbox', slider: 'slider', select: 'combobox',
        list: 'listbox', listitem: 'option', tablist: 'tablist', tab: 'tab', tabpanel: 'tabpanel', scrollarea: 'group', scrollbar: 'scrollbar', dialog: 'dialog', progress: 'progressbar', textfield: 'textbox',
        radiogroup: 'radiogroup', radio: 'radio', meter: 'meter', document: 'document', region: 'application'}[node.role] ?? '';
      if (!element || element.dataset.kind !== node.role) { element?.remove(); element = document.createElement('div'); element.dataset.kind = node.role; element.dataset.accessId = key; element.id = `starhermit-access-${key}`; this.elements.set(key, element); }
      if (kind) element.setAttribute('role', kind); else element.removeAttribute('role');
      const set = (name, value) => value === null || value === undefined ? element.removeAttribute(name) : element.setAttribute(name, String(value));
      set('tabindex', node.focusable ? -1 : null);
      const own = node.role === 'label' || node.role === 'heading';
      if (own) { if (element.textContent !== node.name) element.textContent = node.name; set('aria-label', null); } else set('aria-label', node.name || null);
      // A document's text is its content, read in order.
      if (node.role === 'textfield' || node.role === 'select' || node.role === 'document') { if (element.textContent !== (node.text ?? '')) element.textContent = node.text ?? ''; }
      const described = [node.role === 'keycapture' ? node.text : null, node.description].filter(text => text).join(', ');
      set('aria-description', described || null);
      const toggle = node.role === 'button';
      set('aria-checked', node.checked === null || toggle ? null : node.checked);
      set('aria-pressed', toggle && node.checked !== null ? node.checked : null);
      set('aria-disabled', node.disabled ? true : null);
      set('aria-selected', node.selected ?? null);
      set('aria-expanded', node.expanded ?? (node.role === 'select' ? false : null));
      set('aria-modal', node.role === 'dialog' ? true : null);
      set('aria-level', node.role === 'heading' ? 2 : null);
      set('aria-orientation', node.role === 'scrollbar' ? 'vertical' : null);
      set('lang', node.lang ?? null); set('dir', node.lang ? 'auto' : null);
      set('aria-valuemin', node.range ? node.range[0] : null); set('aria-valuemax', node.range ? node.range[1] : null); set('aria-valuenow', node.range ? node.range[2] : null);
      if (node.focused) active = element.id;
      // Children follow their tree order; only misplaced elements move. An
      // open dropdown's list follows its combo box (aria-controls), as ARIA
      // 1.2 has it, rather than sitting inside it.
      let owner = node.parent;
      if (node.role === 'list' && byId.get(owner)?.role === 'select') { this.elements.get(owner)?.setAttribute('aria-controls', element.id); owner = byId.get(owner).parent; }
      if (node.role === 'select' && !node.expanded) element.removeAttribute('aria-controls');
      const parent = owner === null ? this.root : this.elements.get(owner) ?? this.root; const previous = placed.get(parent) ?? null;
      if (element.parentElement !== parent || element.previousElementSibling !== previous) { if (previous) previous.after(element); else parent.prepend(element); }
      placed.set(parent, element);
    }
    for (const [key, element] of this.elements) if (!seen.has(key)) { element.remove(); this.elements.delete(key); }
    if (active) this.canvas.setAttribute('aria-activedescendant', active); else this.canvas.removeAttribute('aria-activedescendant');
  }
  announce(canvas, title, text, assertive) {
    // A region only just made is given a moment, so assistive technology
    // knows it before its first message.
    const fresh = !this.root; this.attach(canvas, title);
    const region = this.live[assertive ? 'assertive' : 'polite'];
    const say = () => { const message = region.ownerDocument.createElement('div'); message.textContent = text; region.append(message); while (region.childElementCount > 3) region.firstElementChild.remove(); };
    if (fresh) setTimeout(say, 100); else say();
  }
  take() { const text = this.requests.map(line => `${line}\n`).join(''); this.requests = []; return text; }
}

// The Gamepad API for the game: navigator.getGamepads() read when the game
// polls (once a frame), each connection under its own id; a pad that
// disconnects and returns at the same index gets a new one. Pads without the
// "standard" mapping give their buttons index for index and no axes (their
// axis layouts vary: Firefox's triggers rest at -1). A failing
// getGamepads keeps the pads as they were and is reported once.
class GamepadReader {
  constructor(onNote) { this.known = new Map(); this.serial = 0; this.frame = 0; this.onNote = onNote; this.failed = false; }
  supported() { return typeof globalThis.navigator?.getGamepads === 'function'; }
  forget(index) { this.known.delete(index); }
  // Records of 23 floats: id, flags (1: vibration), 17 buttons, 4 axes; -1
  // when the browser could not say.
  read(out) {
    let pads;
    try { pads = this.supported() ? globalThis.navigator.getGamepads() : []; } catch (error) {
      if (!this.failed) { this.failed = true; this.onNote?.(`Gamepads unavailable: ${error?.message || error}`); }
      return -1;
    }
    const frame = ++this.frame, capacity = Math.floor(out.length / 23); let count = 0;
    for (let n = 0; n < pads.length; n++) {
      const pad = pads[n]; if (!pad?.connected) continue;
      let entry = this.known.get(pad.index);
      if (!entry || entry.name !== String(pad.id)) { entry = {id: ++this.serial, name: String(pad.id), pad, frame}; this.known.set(pad.index, entry); }
      entry.pad = pad; entry.frame = frame;
      if (count === capacity) continue;
      const at = count++ * 23; out.fill(0, at, at + 23); out[at] = entry.id; out[at + 1] = pad.vibrationActuator?.playEffect ? 1 : 0;
      for (let i = 0; i < 17 && i < pad.buttons.length; i++) { const button = pad.buttons[i]; out[at + 2 + i] = typeof button === 'number' ? button : Math.max(Number(button.value) || 0, button.pressed ? 1 : 0); }
      if (pad.mapping === 'standard') for (let i = 0; i < 4 && i < pad.axes.length; i++) out[at + 19 + i] = Number(pad.axes[i]) || 0;
    }
    for (const [index, entry] of this.known) if (entry.frame !== frame) this.known.delete(index);
    return count;
  }
  entry(id) { for (const entry of this.known.values()) if (entry.id === id) return entry; return null; }
  rumble(id, strong, weak, duration) {
    const actuator = this.entry(id)?.pad.vibrationActuator; if (!actuator?.playEffect) return 0;
    if (duration === 0 || (strong === 0 && weak === 0)) actuator.reset?.()?.catch?.(() => {});
    else actuator.playEffect('dual-rumble', {duration, strongMagnitude: strong, weakMagnitude: weak}).catch(() => {});
    return 1;
  }
}

// Keys that keep editing the game's text field while the text entry has
// focus (characters arrive as input instead).
const EDIT_KEYS = new Set(['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'NumpadEnter', 'Tab', 'Escape']);
// A key's code for the game's text field: on-screen keyboards often leave
// event.code empty, so their editing keys go by event.key.
function editCode(event) { return EDIT_KEYS.has(event.code) ? event.code : !event.code && EDIT_KEYS.has(event.key) ? event.key : ''; }
// Ctrl (Cmd) with these opens developer tools with Shift (Alt on macOS), and
// with these reloads (R) or works the browser's tabs and windows (Shift+N
// and Shift+P private windows, Tab and PageUp/PageDown between tabs).
const DEVTOOLS_KEYS = new Set(['KeyI', 'KeyJ', 'KeyC', 'KeyK']);
const TAB_KEYS = new Set(['KeyT', 'KeyW', 'KeyN', 'KeyQ', 'KeyR', 'Tab', 'PageUp', 'PageDown']);
// The browser's shortcuts a game keeps from it (select all, bookmark, find,
// history, downloads, open, print, save, view source; zoom), the keys
// that scroll the page or go back, Firefox's quick find, and function keys
// for help, find, the address bar, caret browsing and the menu bar.
const SHORTCUT_KEYS = new Set(['KeyA', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyO', 'KeyP', 'KeyS', 'KeyU']);
const ZOOM_KEYS = new Set(['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0']);
const PAGE_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace']);
const FUNCTION_KEYS = new Set(['F1', 'F3', 'F6', 'F7', 'F10']);
// Whether a key press is kept from the browser (preventDefault): `handled`
// when the game takes the key, `inGame` when the keyboard focus is in the
// game (its canvas, its area, or nowhere on the page) and the page lets
// the game keep the browser's shortcuts. The player's way out always
// works: fullscreen (F11), developer tools, reload (F5 unless the game
// binds it), the browser's tab and window keys (Ctrl+1–9 unless the game
// binds the digit). A key the game takes outside the game's focus, or with
// the page's defaults, is kept only without modifiers (as it always was).
function keepsKey(event, handled, inGame) {
  const {code, key} = event, command = event.ctrlKey || event.metaKey, modified = command || event.altKey;
  if (code === 'F11' || code === 'F12') return false;
  if (DEVTOOLS_KEYS.has(code) && (event.ctrlKey && event.shiftKey || event.metaKey && event.altKey)) return false;
  if (command && (TAB_KEYS.has(code) || code === 'KeyP' && event.shiftKey)) return false;
  if (event.altKey && (code === 'Tab' || code === 'F4')) return false;
  if (code === 'F5' || command && /^Digit[1-9]$/.test(code)) return handled && (!modified || inGame);
  if (handled && (!modified || inGame)) return true;
  if (!inGame) return false;
  if (command && !event.altKey && (SHORTCUT_KEYS.has(code) || ZOOM_KEYS.has(code) || ['+', '-', '=', '_', '0'].includes(key))) return true;
  // Alt alone opens the menu bar (Firefox, Windows); Alt+Left and Cmd+[
  // go back, Cmd+] forward.
  return FUNCTION_KEYS.has(code) || PAGE_KEYS.has(code) || key === 'Alt' || event.metaKey && (code === 'BracketLeft' || code === 'BracketRight')
    || !modified && (code === 'Slash' || code === 'Quote');
}
// A transparent input over the game's focused text field receives typing and
// IME composition, so candidate windows open beside the field. Committed text
// and the composition in progress go to the game (events 6 and 7); editing
// keys pass through as key events. On touch screens focusing it raises the
// on-screen keyboard (a text keyboard whose Enter reads Done; a tap's
// release focuses it within the gesture, see bind()); deletions the
// keyboard makes without key codes arrive as beforeinput and become
// Backspace and Delete.
class TextEntry {
  constructor(host) { this.host = host; this.element = null; this.composing = false; }
  show(x, y, width, height) {
    const {canvas, container} = this.host;
    if (!this.element) {
      const input = this.element = canvas.ownerDocument.createElement('input');
      input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off'); input.setAttribute('aria-label', 'Text entry');
      input.setAttribute('inputmode', 'text'); input.setAttribute('enterkeyhint', 'done');
      Object.assign(input.style, {position: 'absolute', opacity: '0', border: '0', padding: '0', margin: '0', background: 'transparent', color: 'transparent', caretColor: 'transparent', outline: 'none'});
      // Its text selects and its long press offers Paste in the game's
      // area, which takes both from everything else.
      for (const name of ['user-select', '-webkit-user-select']) input.style.setProperty(name, 'text');
      input.style.setProperty('-webkit-touch-callout', 'default');
      input.addEventListener('compositionstart', () => { this.composing = true; });
      input.addEventListener('compositionupdate', event => { const text = event.data ?? ''; this.host.event(7, text, [...text].length); });
      input.addEventListener('compositionend', () => { this.composing = false; this.host.event(7, '', 0); this.commit(); });
      input.addEventListener('input', event => { if (!this.composing && !event.isComposing) this.commit(); });
      for (const [name, pressed] of [['keydown', 1], ['keyup', 0]]) input.addEventListener(name, event => {
        const code = editCode(event);
        if (this.composing || event.isComposing || event.keyCode === 229 || !code) return;
        event.preventDefault(); this.host.event(0, code, pressed, 0);
      });
      input.addEventListener('beforeinput', event => {
        const code = {deleteContentBackward: 'Backspace', deleteContentForward: 'Delete'}[event.inputType];
        if (!code || this.composing || event.isComposing) return;
        event.preventDefault(); this.host.event(0, code, 1, 0); this.host.event(0, code, 0, 0);
      });
    }
    const input = this.element; if (input.parentElement !== container) container.append(input);
    input.style.cursor = this.host.cursor ?? '';
    const sx = canvas.clientWidth / canvas.width, sy = canvas.clientHeight / canvas.height;
    Object.assign(input.style, {left: `${canvas.offsetLeft + x * sx}px`, top: `${canvas.offsetTop + y * sy}px`, width: `${Math.max(1, width * sx)}px`, height: `${Math.max(1, height * sy)}px`});
    if (canvas.ownerDocument.activeElement !== input) input.focus({preventScroll: true});
  }
  hide() {
    const input = this.element; this.composing = false;
    if (!input?.isConnected) return;
    const focused = input.ownerDocument.activeElement === input; input.value = ''; input.remove(); if (focused) this.host.canvas.focus();
  }
  commit() { const text = this.element.value; this.element.value = ''; if (text) this.host.event(6, text); }
  // A press elsewhere took the focus (the canvas's) while the field kept
  // it: typing goes on there. A press that moved the game's focus hides
  // the entry in its frame.
  refocus() { const input = this.element; if (input?.isConnected && input.ownerDocument.activeElement !== input) input.focus({preventScroll: true}); }
}

class BrowserHost {
  constructor(canvas, options) {
    this.canvas = canvas; this.container = canvas.parentElement; this.options = options; this.clock = options.clock || (() => performance.now()); this.started = false; this.hidden = false; this.disposed = false;
    this.gamepads = new GamepadReader(note => this.options.onNote?.(note)); this.renderer = null; this.instance = null; this.windowLive = false; this.surfaceLive = false; this.lastError = ''; this.generation = 0; this.recovering = null;
    // Buffers the browser refused the page (`outOfMemory`), which the runtime reads (`memory_failures`).
    this.memoryFailures = 0;
    this.audio = options.audioFactory?.() || null;this.audioClosing=null;
    this.audioBridge=options.audioBridgeFactory?.({getPort:()=>this.audio?.port,getOutput:()=>this.audio,onReady:id=>{if(!this.disposed){try{this.instance?.exports.sh_audio_wake?.(id); this.woke?.();}catch(error){this.fault(error.message);} this.hiddenTurn(); this.audioPump();}}})||null;
    // Microphone and WebRTC media for voice chat; nothing opens until the game asks.
    this.voice = options.voiceFactory?.() ?? new VoiceBridge(options.voice ?? {});
    this.hz = options.displayHz || 60; this.refreshSamples = []; this.labels = new Map(); this.cleanups = [];
    // 'game' (the default): while the game runs, its area and keyboard
    // focus keep the browser's menus, selection, clipboard and shortcuts
    // from it (see bind()); 'page' leaves them to the page, for a page
    // that embeds the game in a larger document.
    if (![undefined, 'game', 'page'].includes(options.browserDefaults)) throw new Error('browserDefaults is "game" or "page"');
    this.gameDefaults = options.browserDefaults !== 'page'; this.restyled = [];
    const root = new URL('.', globalThis.document?.baseURI || globalThis.location?.href || 'http://localhost/');
    this.assets = new AssetFetcher({...options.assets, baseURL: new URL(options.assetBaseURL || '.', root).href,
      onReady: id => {if (!this.disposed && !this.fatal) {try {this.instance.exports.sh_asset_wake(id); this.woke?.();} catch (error) {this.fault(error.message);}}}});
    this.storage = options.storage || new PreferenceStore({onStatus: status => this.options.onStorage?.(status)});
    // Launch credentials leave the URL before anything else runs; WASM takes them once.
    this.launch = options.launch === false ? null : (options.launch || captureLaunch(options.window || globalThis.window)); this.api = null; this.saveSlots = null; this.saveOpens = new Map(); this.nextSaveOpen = 1;
  }
  saves() {
    if (!this.saveSlots) this.saveSlots = this.options.saveSlots || new SaveSlots({onStatus: status => this.options.onSaves?.(status)});
    return this.saveSlots;
  }
  saveOpen(partition) { return this.saveWait(() => this.saves().open(partition)); }
  // Opening a partition, or flushing slot writes before a handover; either
  // way the game proceeds once it settles (a failure means session-only).
  saveWait(start) {
    const id = this.nextSaveOpen++; this.saveOpens.set(id, false);
    const done = () => { if (!this.saveOpens.has(id)) return; this.saveOpens.set(id, true); if (!this.disposed && !this.fatal) { try { this.instance.exports.sh_saves_wake?.(id); this.woke?.(); } catch (error) { this.fault(error.message); } } };
    start().then(done, done); return id;
  }
  contentLibrary() {
    if (!this.contentStore) this.contentStore = this.options.contentStore || new ContentStore({onStatus: status => this.options.onContent?.(status)});
    return this.contentStore;
  }
  // The content library's open partition is the newest open's request id;
  // reads and commits through an older one fail rather than reach another
  // partition.
  contentRequest(start, handle = false) {
    this.contentRequests ??= new Map(); this.nextContent ??= 1;
    if (this.contentRequests.size >= 16) throw new Error('Too many content library requests');
    const id = this.nextContent++; const record = {state: 0, error: ''}; this.contentRequests.set(id, record);
    if (handle) this.contentHandle = id;
    const wake = () => { if (!this.disposed && !this.fatal) { try { this.instance.exports.sh_library_wake?.(id); this.woke?.(); } catch (error) { this.fault(error.message); } } };
    start().then(() => { record.state = 1; wake(); }, error => { record.state = 2; record.error = String(error?.message || error).slice(0, 4096); wake(); });
    return id;
  }
  contentOpen(handle) { if (!handle || handle !== this.contentHandle) throw new Error('The content library partition was replaced'); return this.contentLibrary(); }
  // Preference snapshots the game loads and writes itself (a game whose
  // partition callback answers empty, such as one following account changes).
  prefsRequest(start) {
    this.prefRequests ??= new Map(); this.nextPref ??= 1;
    if (this.prefRequests.size >= 16) throw new Error('Too many preference requests');
    const id = this.nextPref++; const record = {state: 0, bytes: null, error: ''}; this.prefRequests.set(id, record);
    const wake = () => { if (!this.disposed && !this.fatal) { try { this.instance.exports.sh_prefs_wake?.(id); this.woke?.(); } catch (error) { this.fault(error.message); } } };
    start().then(bytes => { record.state = 1; record.bytes = bytes || null; wake(); }, error => { record.state = 2; record.error = String(error?.message || error).slice(0, 4096); wake(); });
    return id;
  }
  prefRecord(id) { const record = this.prefRequests?.get(id); if (!record) throw new Error('Unknown preference request'); return record; }
  apiClient() {
    if (!this.api) this.api = new ApiFetcher({...this.options.api, origin: this.options.api?.origin || globalThis.location?.origin,
      onReady: id => {if (!this.disposed && !this.fatal) {try {this.instance.exports.sh_api_wake?.(id); this.woke?.();} catch (error) {this.fault(error.message);}}}});
    return this.api;
  }
  socketHub() {
    if (!this.sockets) this.sockets = new SocketHub({...this.options.sockets, origin: this.options.sockets?.origin || this.options.api?.origin || globalThis.location?.origin,
      onReady: id => {if (!this.disposed && !this.fatal) {try {this.instance.exports.sh_socket_wake?.(id); this.woke?.();} catch (error) {this.fault(error.message);}}}});
    return this.sockets;
  }
  election() {
    if (!this.instances) this.instances = this.options.instances instanceof InstanceElection ? this.options.instances : new InstanceElection({...this.options.instances,
      onChange: (id, state) => {if (!this.disposed && !this.fatal) {try {this.instance.exports.sh_instance_wake?.(id); this.woke?.();} catch (error) {this.fault(error.message);} if (state === 3 && this.started && this.hidden) this.serveHandover(id);}}});
    return this.instances;
  }
  // One-shot timers for WASM futures (the SDK's retry and polling sleeps).
  timerStart(ms) {
    if (!Number.isInteger(ms) || ms < 0 || ms > 86400000) throw new Error('Invalid timer delay');
    this.timers ??= new Map(); this.nextTimer ??= 1;
    if (this.timers.size >= 256) throw new Error('Too many timers');
    const id = this.nextTimer++;
    this.timers.set(id, setTimeout(() => {
      if (!this.timers.has(id)) return; this.timers.set(id, true);
      if (!this.disposed && !this.fatal) {try {this.instance.exports.sh_timer_wake?.(id); this.woke?.();} catch (error) {this.fault(error.message);}}
    }, ms));
    return id;
  }
  timerCancel(id) {const timer = this.timers?.get(id); if (typeof timer !== 'boolean' && timer !== undefined) clearTimeout(timer); this.timers?.delete(id);}
  memory(ptr, length) {
    const buffer = this.instance?.exports.memory.buffer;
    if (!buffer || !Number.isInteger(ptr) || !Number.isInteger(length) || ptr < 0 || length < 0 || ptr + length > buffer.byteLength) throw new Error('Invalid host memory range');
    return new Uint8Array(buffer, ptr, length);
  }
  text(ptr, length) { return decoder.decode(this.memory(ptr, length)); }
  plugins() { return this.pluginHub ??= new PluginHub(() => this.instance.exports); }
  // The canvas's cursor (and the text entry's over it).
  showCursor(css) { this.cursor = css; this.canvas.style.cursor = css; if (this.entry?.element) this.entry.element.style.cursor = css; }
  guard(callback, failed = 0) {
    try { return callback(); } catch (error) { if (outOfMemory(error)) this.memoryFailures++; this.lastError = String(error.message || error).slice(0, 4096); return failed; }
  }
  fault(message) {
    if (!this.fatal) { this.fatal = String(message).slice(0, 4096); this.options.onError?.(this.fatal); }
    this.started = false; this.cancelLoops(); this.releaseArea(); this.assets.close(); this.sockets?.closeAll();
    this.audioBridge?.close();this.audioClosing=this.audio?.close().catch(error=>this.options.onAudio?.({status:"unavailable",reason:error.message}));
    this.voice?.close();
  }
  imports() {
    return {starhermit: {
      audio_info: kind=>this.guard(()=>this.audioBridge?.info(kind)||0),
      audio_upload_begin: (epoch,rate,channels,mask,count)=>this.guard(()=>this.audioBridge.begin(epoch,rate,channels,mask,count)),
      audio_upload_append: (id,ptr,count)=>this.guard(()=>{if(count>16384||ptr%4)throw new Error('Invalid audio memory range');const bytes=this.memory(ptr,count*4);return this.audioBridge.append(id,new Float32Array(bytes.buffer,bytes.byteOffset,count));}),
      audio_upload_commit: id=>this.guard(()=>this.audioBridge.commit(id)),
      audio_stream_write: (epoch,handle,ptr,count)=>this.guard(()=>{if(count>16384||ptr%4)throw new Error('Invalid audio memory range');const bytes=this.memory(ptr,count*4);return this.audioBridge.streamWrite(epoch,handle,new Float32Array(bytes.buffer,bytes.byteOffset,count));}),
      audio_play: (epoch,ptr,len)=>this.guard(()=>{if(len!==36)throw new Error('Invalid audio play command');const bytes=this.memory(ptr,len);return this.audioBridge.play(epoch,new DataView(bytes.buffer,bytes.byteOffset,len));}),
      audio_outputs: (epoch,action,ptr,len)=>this.guard(()=>{if(len>1024)throw new Error('Invalid output identifier');return this.audioBridge.outputs(epoch,action,this.text(ptr,len));}),
      audio_graph_open: (epoch,ptr,len)=>this.guard(()=>this.audioBridge.graphOpen(epoch,this.memory(ptr,len))),
      audio_graph_begin: (epoch,len)=>this.guard(()=>this.audioBridge.graphBegin(epoch,len)),
      audio_graph_append: (id,ptr,len)=>this.guard(()=>this.audioBridge.graphAppend(id,this.memory(ptr,len))),
      audio_graph_commit: id=>this.guard(()=>this.audioBridge.graphCommit(id)),
      audio_graph_close: epoch=>this.guard(()=>this.audioBridge.graphClose(epoch)),
      audio_output_length:id=>this.guard(()=>this.audioBridge.outputLength(id)),
      audio_output_copy:(id,offset,ptr,len)=>this.guard(()=>this.audioBridge.outputCopy(id,offset,this.memory(ptr,len))),
      audio_preferences: (epoch,ptr,len)=>this.guard(()=>{if(len!==32)throw new Error('Invalid audio preferences');const bytes=this.memory(ptr,len);return this.audioBridge.preferences(epoch,new DataView(bytes.buffer,bytes.byteOffset,len));}),
      audio_command: (epoch,op,handle,a,b)=>this.guard(()=>this.audioBridge.command(epoch,op,handle,a,b)),
      audio_poll: id=>this.guard(()=>this.audioBridge.poll(id),2),
      audio_result: id=>this.guard(()=>this.audioBridge.result(id)),
      audio_take: id=>this.guard(()=>this.audioBridge.take(id)),
      audio_metric: (id,kind)=>this.guard(()=>this.audioBridge.metric(id,kind)),
      audio_error: (id,ptr,capacity)=>this.guard(()=>{const bytes=encoder.encode(this.audioBridge.error(id));const count=Math.min(bytes.length,capacity);this.memory(ptr,count).set(bytes.subarray(0,count));return count;}),
      audio_cancel: id=>this.guard(()=>this.audioBridge?.cancel(id)),
      ...(this.voice?.imports(this) ?? {}),
      asset_request_begin: (ptr, len, limit) => this.guard(() => this.assets.begin(this.text(ptr, len), limit)),
      asset_request_poll: id => this.guard(() => this.assets.poll(id), 2),
      asset_request_length: id => this.guard(() => this.assets.length(id)),
      asset_request_copy: (id, offset, ptr, len) => this.guard(() => this.assets.copy(id, offset, this.memory(ptr, len))),
      asset_request_error: (id, ptr, capacity) => this.guard(() => {const bytes = encoder.encode(this.assets.error(id)); const count = Math.min(bytes.length, capacity); this.memory(ptr, count).set(bytes.subarray(0, count)); return count;}),
      asset_request_cancel: id => this.assets.cancel(id),
      api_request_begin: (head, headLen, body, bodyLen, limit, keepalive) => this.guard(() => this.apiClient().begin(this.text(head, headLen), this.memory(body, bodyLen), limit, keepalive === 1)),
      api_request_poll: id => this.guard(() => this.apiClient().poll(id), 2),
      api_request_status: id => this.guard(() => this.apiClient().status(id)),
      api_request_head: (id, ptr, capacity) => this.guard(() => {const bytes = encoder.encode(this.apiClient().head(id)); const count = Math.min(bytes.length, capacity); this.memory(ptr, count).set(bytes.subarray(0, count)); return count;}),
      api_request_length: id => this.guard(() => this.apiClient().length(id)),
      api_request_copy: (id, offset, ptr, len) => this.guard(() => this.apiClient().copy(id, offset, this.memory(ptr, len))),
      api_request_error: (id, ptr, capacity) => this.guard(() => {const bytes = encoder.encode(this.apiClient().error(id)); const count = Math.min(bytes.length, capacity); this.memory(ptr, count).set(bytes.subarray(0, count)); return count;}),
      api_request_cancel: id => this.api?.cancel(id),
      saves_open: (ptr, len) => this.guard(() => this.saveOpen(this.text(ptr, len))),
      socket_open: (ptr, len, maxText, maxBinary) => this.guard(() => this.socketHub().open(this.text(ptr, len), maxText, maxBinary)),
      socket_state: id => this.guard(() => this.socketHub().state(id), 2),
      socket_send: (id, kind, ptr, len) => this.guard(() => this.socketHub().send(id, kind, this.memory(ptr, len))),
      socket_next: id => this.guard(() => this.socketHub().next(id)?.kind || 0),
      socket_length: id => this.guard(() => this.socketHub().next(id)?.bytes.byteLength || 0),
      socket_copy: (id, ptr, len) => this.guard(() => {const event = this.socketHub().next(id); if (!event || len !== event.bytes.byteLength) throw new Error('Invalid socket read'); this.memory(ptr, len).set(event.bytes); return len;}),
      socket_close_code: id => this.guard(() => this.socketHub().next(id)?.code || 0),
      socket_pop: id => this.guard(() => {this.socketHub().pop(id); return 1;}),
      socket_close: (id, code, ptr, len) => this.guard(() => {this.socketHub().close(id, code, this.text(ptr, len)); return 1;}),
      socket_release: id => this.sockets?.release(id),
      timer_start: ms => this.guard(() => this.timerStart(ms)),
      instance_claim: (ptr, len) => this.guard(() => this.election().claim(this.text(ptr, len))),
      instance_state: id => this.guard(() => this.election().state(id), 4),
      instance_takeover: id => this.guard(() => this.election().takeover(id)),
      instance_release: id => this.instances?.release(id),
      instance_coordinated: () => this.guard(() => this.election().coordinated ? 1 : 0),
      timer_done: id => this.guard(() => this.timers?.get(id) === true ? 1 : 0),
      timer_cancel: id => this.timerCancel(id),
      saves_poll: id => this.guard(() => { const done = this.saveOpens.get(id); if (done === undefined) throw new Error('Unknown save request'); if (done) this.saveOpens.delete(id); return done ? 1 : 0; }, 1),
      saves_status: () => { const slots = this.saveSlots; return !slots || slots.status !== 'persistent' ? 0 : slots.persisted ? 2 : 1; },
      saves_length: slot => { try { const bytes = this.saves().read(['current', 'previous', 'remote', 'record'][slot]); return bytes ? bytes.byteLength : -1; } catch (error) { this.lastError = error.message; return -1; } },
      saves_copy: (slot, offset, ptr, len) => this.guard(() => { const bytes = this.saves().read(['current', 'previous', 'remote', 'record'][slot]); if (!bytes || offset + len > bytes.byteLength) throw new Error('Invalid save slot range'); this.memory(ptr, len).set(bytes.subarray(offset, offset + len)); return len; }),
      saves_write: (slot, ptr, len, present) => this.guard(() => { this.saves().write(['current', 'previous', 'remote', 'record'][slot], present ? this.memory(ptr, len) : null); return 1; }),
      saves_flush: () => this.guard(() => this.saveWait(() => this.saves().flush())),
      library_open: (ptr, len) => this.guard(() => { const partition = this.text(ptr, len); return this.contentRequest(() => this.contentLibrary().open(partition), true); }),
      library_poll: id => this.guard(() => { const record = this.contentRequests?.get(id); if (!record) throw new Error('Unknown content library request'); if (record.state === 2) this.lastError = record.error; return record.state; }, 2),
      library_release: id => { this.contentRequests?.delete(id); },
      library_status: () => { const store = this.contentStore; return !store || store.status !== 'persistent' ? 0 : store.persisted ? 2 : 1; },
      // 0: the open partition's entry names, one per line; 1: why storage is session-only.
      library_text: (handle, kind, out, capacity) => this.guard(() => { const bytes = encoder.encode(kind === 0 ? this.contentOpen(handle).names().join('\n') : this.contentStore?.reason || ''); if (capacity >= bytes.byteLength) this.memory(out, bytes.byteLength).set(bytes); return bytes.byteLength; }, -1),
      library_length: (handle, ptr, len) => { try { const bytes = this.contentOpen(handle).read(this.text(ptr, len)); return bytes ? bytes.byteLength : -1; } catch (error) { this.lastError = error.message; return -2; } },
      library_copy: (handle, ptr, len, offset, out, outLen) => this.guard(() => { const bytes = this.contentOpen(handle).read(this.text(ptr, len)); if (!bytes || offset + outLen > bytes.byteLength) throw new Error('Invalid content entry range'); this.memory(out, outLen).set(bytes.subarray(offset, offset + outLen)); return outLen; }),
      library_stage: (handle, ptr, len, data, dataLen, present) => this.guard(() => { this.contentOpen(handle).stage(this.text(ptr, len), present ? this.memory(data, dataLen) : null); return 1; }),
      library_commit: (handle, apply) => this.guard(() => { this.contentOpen(handle).commit(apply === 1); return 1; }),
      library_flush: () => this.guard(() => this.contentRequest(() => this.contentLibrary().flush())),
      prefs_load: (ptr, len) => this.guard(() => { const key = this.text(ptr, len); return this.prefsRequest(() => this.storage.load(key, {fresh: true})); }),
      prefs_save: (ptr, len, data, dataLen) => this.guard(() => { const key = this.text(ptr, len); const bytes = this.memory(data, dataLen).slice(); this.storage.validate(key, bytes); return this.prefsRequest(() => this.storage.queue(key, bytes).then(() => null)); }),
      prefs_poll: id => this.guard(() => { const record = this.prefRecord(id); if (record.state === 2) this.lastError = record.error; return record.state; }, 2),
      prefs_length: id => { try { const record = this.prefRecord(id); return record.state === 1 && record.bytes ? record.bytes.byteLength : -1; } catch (error) { this.lastError = error.message; return -1; } },
      prefs_copy: (id, ptr, len) => this.guard(() => { const record = this.prefRecord(id); if (record.state !== 1 || !record.bytes || record.bytes.byteLength !== len) throw new Error('Invalid preference read'); this.memory(ptr, len).set(record.bytes); return len; }),
      prefs_release: id => { this.prefRequests?.delete(id); },
      // 2 when the browser granted persistent storage: granted per origin,
      // so any store's answer covers preferences too.
      prefs_status: () => this.storage.status !== 'persistent' ? 0 : (this.storage.persisted || this.saveSlots?.persisted || this.contentStore?.persisted) ? 2 : 1,
      text_input: (active, x, y, width, height) => this.guard(() => { this.entry ??= new TextEntry(this); if (active) this.entry.show(x, y, width, height); else this.entry.hide(); return 1; }),
      access_update: (ptr, len) => this.guard(() => { (this.access ??= new AccessTree()).update(this.canvas, this.title, JSON.parse(this.text(ptr, len))); return 1; }),
      access_announce: (ptr, len, assertive) => this.guard(() => { (this.access ??= new AccessTree()).announce(this.canvas, this.title, this.text(ptr, len), assertive !== 0); return 1; }),
      access_take: (ptr, capacity) => this.guard(() => {
        const bytes = encoder.encode(this.accessPending ??= this.access?.take() ?? ''); if (!bytes.length) this.accessPending = null; if (capacity === 0) return bytes.length;
        if (capacity !== bytes.length) throw new Error('Accessibility request buffer mismatch');
        this.memory(ptr, bytes.length).set(bytes); this.accessPending = null; return bytes.length;
      }),
      launch_take: (ptr, capacity) => this.guard(() => {
        if (!this.launch) return 0; const {kind, token, sessionId = '', game = ''} = this.launch;
        const bytes = encoder.encode(`${kind}\n${token}\n${sessionId}\n${game}`); if (capacity === 0) return bytes.length;
        if (capacity !== bytes.length) throw new Error('Launch credential buffer mismatch');
        this.memory(ptr, bytes.length).set(bytes); this.launch = null; return bytes.length;
      }),
      window_open: (ptr, len, width, height) => this.guard(() => { if (this.windowLive) throw new Error('Only one browser canvas window is currently supported'); this.title = this.text(ptr, len); this.windowLive = true; this.resize(); return 1; }),
      window_close: () => { this.windowLive = false; },
      window_width: () => this.dimensions()[0], window_height: () => this.dimensions()[1],
      window_scale: () => this.dimensions()[2],
      // navigator.languages, one per line (capacity 0 asks for the length).
      languages_take: (ptr, capacity) => this.guard(() => {
        const list = globalThis.navigator?.languages?.length ? globalThis.navigator.languages : [globalThis.navigator?.language].filter(Boolean);
        const bytes = encoder.encode(list.slice(0, 64).join('\n')); if (capacity === 0) return bytes.length;
        if (capacity !== bytes.length) throw new Error('Language buffer mismatch');
        this.memory(ptr, bytes.length).set(bytes); return bytes.length;
      }),
      window_resize: (_, width, height) => this.guard(() => { if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error('Invalid canvas dimensions'); this.resize(); return 1; }),
      gamepads_supported: () => this.gamepads.supported() ? 1 : 0,
      gamepads_read: (ptr, capacity) => this.guard(() => { this.memory(ptr, capacity * 4); return this.gamepads.read(new Float32Array(this.instance.exports.memory.buffer, ptr, capacity)); }),
      gamepad_name: (id, out, capacity) => this.guard(() => { const bytes = encoder.encode(this.gamepads.entry(id)?.name ?? ''); const count = Math.min(bytes.length, capacity); this.memory(out, count).set(bytes.subarray(0, count)); return count; }),
      gamepad_rumble: (id, strong, weak, duration) => this.guard(() => this.gamepads.rumble(id, strong, weak, duration)),
      // Fullscreen and pointer lock on the game's request; browsers allow
      // both only shortly after a gesture, and refusals arrive as events.
      // Leaving exits only the game's own fullscreen, never the page's.
      window_fullscreen: (_, on) => this.guard(() => { if (on) this.fullscreen(); else if (this.ownFullscreen()) document.exitFullscreen().catch(() => {}); return 1; }),
      window_pointer_lock: (_, on) => this.guard(() => { this.pointerLock(on !== 0); return 1; }),
      // The canvas's cursor (and the text entry's over it); a locked
      // pointer is hidden whatever it is.
      window_cursor: (_, shape) => this.guard(() => { const name = CURSORS[shape]; if (!name) throw new Error('Invalid cursor'); this.showCursor(name); }),
      // A game's image as a PNG data URL (made once a number; the runtime
      // keeps 16 and forgets the rest), at its hotspot over its fallback.
      window_cursor_image: (_, number, ptr, len, width, height, x, y, fallback) => this.guard(() => {
        const name = CURSORS[fallback]; if (!name || width < 1 || height < 1 || width > 64 || height > 64 || x >= width || y >= height) throw new Error('Invalid cursor image');
        this.cursorImages ??= new Map();
        if (len) {
          if (len !== width * height * 4) throw new Error('Invalid cursor image');
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.memory(ptr, len)), width, height), 0, 0);
          this.cursorImages.set(number, canvas.toDataURL('image/png'));
        }
        const url = this.cursorImages.get(number); if (!url) throw new Error('Unknown cursor image');
        this.showCursor(`url("${url}") ${x} ${y}, ${name}`);
      }),
      window_cursor_forget: (_, number) => { this.cursorImages?.delete(number); },
      window_orientation: (_, kind) => this.guard(() => { const wanted = ['any', 'landscape', 'portrait'][kind]; if (!wanted) throw new Error('Invalid orientation'); this.orientation = wanted; this.lockOrientation(); return 1; }),
      // Axis 2: whether the page may go fullscreen (1 or 0).
      window_screen: (_, axis) => { if (axis === 2) return globalThis.document?.fullscreenEnabled && typeof this.canvas?.requestFullscreen === 'function' ? 1 : 0; const ratio = globalThis.devicePixelRatio || 1; const size = axis ? globalThis.screen?.height : globalThis.screen?.width; return Number.isFinite(size) && size > 0 ? Math.min(16384, Math.round(size * ratio)) : 1; },
      key_label: (ptr, len, out, capacity) => this.guard(() => { const code = this.text(ptr, len); const bytes = encoder.encode(this.labels.get(code) ?? ''); const count = Math.min(bytes.length, capacity); this.memory(out, count).set(bytes.subarray(0, count)); return count; }),
      surface_open: () => this.guard(() => { if (!this.renderer?.ready || this.surfaceLive) throw new Error('Browser surface is unavailable or already owned'); this.surfaceLive = true; return 1; }),
      surface_close: () => { this.renderer?.clearTextures(); this.surfaceLive = false; },
      graphics_info: (_, kind) => { try {
        if(!this.surfaceLive || !this.renderer?.ready)return -1;
        if(kind===0){const value=this.renderer.maxDimension;return Number.isInteger(value)&&value>0&&value<=16384?value:-1;}
        if(kind===1){const value=this.renderer.gpuClass;return Number.isInteger(value)&&value>=0&&value<=4?value:0;}
        if(kind===2){const value=globalThis.navigator?.hardwareConcurrency;return Number.isInteger(value)&&value>0&&value<=4096?value:-1;}
        if(kind===3){const value=globalThis.navigator?.deviceMemory;return Number.isFinite(value)&&value>0&&value<=16384?value*1073741824:-1;}
        if(kind===4)return this.renderer.halfFloatTargets?1:0;
        if(kind===5){const value=this.renderer.benchmark;return Number.isFinite(value)&&value>0?value:-1;}
        if(kind===6)return deviceKind(this.options.deviceClass);
        return -1;
      } catch {return -1;} },
      graphics_name: (_, out, capacity) => this.guard(() => { if (!this.surfaceLive || !this.renderer?.ready) return 0; const bytes = encoder.encode(String(this.renderer.gpuName || '').slice(0, 512)); const count = Math.min(bytes.length, capacity); this.memory(out, count).set(bytes.subarray(0, count)); return count; }, 0),
      surface_backend: () => this.renderer?.ready ? (this.renderer.backend === 'WebGPU' ? 2 : 1) : 0,
      surface_draw: (_, ptr, count, r, g, b, a) => this.guard(() => {
        if (!this.renderer?.ready) return 2; if (count > 300000 || ptr % 4) throw new Error('Invalid vertex memory');
        const bytes = this.memory(ptr, count * 24); const vertices = new Float32Array(bytes.buffer, bytes.byteOffset, count * 6);
        return this.renderer.draw(vertices, [r, g, b, a]) ? 1 : 2;
      }),
      surface_texture_upload: (_, id, width, height, levels, sampler, ptr, len) => this.guard(() => {
        if (!this.surfaceLive || !this.renderer?.ready) throw new Error('Texture upload needs a live surface');
        if (width < 1 || height < 1 || width > 4096 || height > 4096 || levels < 1 || levels > 13 || len !== mipChainBytes(width, height, levels)) throw new Error('Invalid texture memory');
        this.renderer.uploadTexture(id, width, height, this.memory(ptr, len), {levels, sampler}); return 1;
      }),
      // Half-float RGBA levels (binary16 values; mesh environments).
      surface_float_texture_upload: (_, id, width, height, levels, sampler, ptr, len) => this.guard(() => {
        if (!this.surfaceLive || !this.renderer?.ready) throw new Error('Texture upload needs a live surface');
        if (width < 1 || height < 1 || width > 4096 || height > 4096 || levels < 1 || levels > 13 || len !== mipChainBytes(width, height, levels) || ptr % 2) throw new Error('Invalid texture memory');
        const bytes = this.memory(ptr, len * 2);
        this.renderer.uploadFloatTexture(id, width, height, new Uint16Array(bytes.buffer, bytes.byteOffset, len), {levels, sampler}); return 1;
      }),
      surface_texture_sampler: (_, id, sampler) => this.guard(() => { if (!this.surfaceLive) throw new Error('Surface is closed'); this.renderer.setTextureSampler(id, sampler); return 1; }),
      surface_texture_delete: (_, id) => this.guard(() => { if (!this.surfaceLive) throw new Error('Surface is closed'); this.renderer.deleteTexture(id); return 1; }),
      surface_pass_area: (_, x, y, width, height) => this.guard(() => { if (!this.surfaceLive || !this.renderer) throw new Error('Surface is closed'); this.renderer.passArea = [x, y, width, height]; return 1; }),
      surface_scene_depth: (_, id) => this.guard(() => { if (!this.surfaceLive) throw new Error('Surface is closed'); this.renderer.setSceneDepth(id); return 1; }),
      surface_target: (_, action, id, width, height) => this.guard(() => {
        if(!this.surfaceLive)throw new Error('Surface is closed');
        if(action===0){this.renderer.createTarget(id,width,height);return 1;}
        if(action===1){this.renderer.deleteTarget(id);return 1;}
        if(action===2)return this.renderer.compositeTarget(id)?1:2;
        if(action===3){this.renderer.createTarget(id,width,height,true);return 1;}
        // 8 + kind: a target of starhermit_sys's TARGET_* kind.
        if(action>=8&&action<72){this.renderer.createTarget(id,width,height,!!(action&1),action-8);return 1;}
        throw new Error('Invalid render target operation');
      }),
      surface_draw_target: (_, target, ptr, count, rangePtr, rangeCount, r,g,b,a) => this.guard(() => {
        if(!this.surfaceLive||count>300000||rangeCount>100000||ptr%4||rangePtr%4)throw new Error('Invalid target draw');
        const vertices=this.memory(ptr,count*32),ranges=this.memory(rangePtr,rangeCount*16);
        return this.renderer.drawBatches(new Float32Array(vertices.buffer,vertices.byteOffset,count*8),[r,g,b,a],new Uint32Array(ranges.buffer,ranges.byteOffset,rangeCount*4),target)?1:2;
      }),
      surface_overlay_target: (_, target, ptr, count, rangePtr, rangeCount) => this.guard(() => {
        if(!this.surfaceLive||count>300000||rangeCount>100000||ptr%4||rangePtr%4)throw new Error('Invalid overlay draw');
        if (!this.renderer?.ready) return 2;
        const vertices=this.memory(ptr,count*32),ranges=this.memory(rangePtr,rangeCount*16);
        return this.renderer.drawBatches(new Float32Array(vertices.buffer,vertices.byteOffset,count*8),[0,0,0,0],new Uint32Array(ranges.buffer,ranges.byteOffset,rangeCount*4),target,true)?1:2;
      }),
      surface_draw_batches: (_, ptr, count, ranges, batchCount, r, g, b, a) => this.guard(() => {
        if (!this.surfaceLive) throw new Error('Surface is closed');
        if (!this.renderer?.ready) return 2;
        if (count > 300000 || batchCount > 100000 || ptr % 4 || ranges % 4) throw new Error('Invalid batch memory');
        const bytes = this.memory(ptr, count * 32), vertices = new Float32Array(bytes.buffer, bytes.byteOffset, count * 8);
        const rangeBytes = this.memory(ranges, batchCount * 16), batches = new Uint32Array(rangeBytes.buffer, rangeBytes.byteOffset, batchCount * 4);
        return this.renderer.drawBatches(vertices, [r,g,b,a], batches) ? 1 : 2;
      }),
      surface_mesh: (_, action, id, vertexPtr, vertexCount, layout, indexPtr, indexCount) => this.guard(() => {
        if (!this.surfaceLive) throw new Error('Surface is closed');
        if (action === 1) { this.renderer.deleteMesh(id); return 1; }
        // The layout's code (starhermit_sys::MeshLayout::code) says how to read the vertices' bytes; a line mesh's
        // carries starhermit_sys::MESH_LINE_CODE (1 << 24) besides.
        const info = meshLayoutInfo(layout & ~(1 << 24));
        if (action !== 0 || !info || vertexCount > 1048576 || indexCount > 3145728 || indexPtr % 4) throw new Error('Invalid mesh memory');
        const vertices = this.memory(vertexPtr, vertexCount * info.stride), indices = this.memory(indexPtr, indexCount * 4);
        this.renderer.uploadMesh(id, vertices, new Uint32Array(indices.buffer, indices.byteOffset, indexCount), layout, vertexCount); return 1;
      }),
      // Custom materials' programs: 0 create from UTF-8 text (the WGSL, the six entry points, the nine GLSL stages,
      // then the GLSL samplers as name=unit pairs joined by commas, all NUL-separated) and the uniform block's bytes,
      // 1 delete.
      surface_program: (_, action, id, textPtr, textLength, uniformBytes) => this.guard(() => {
        if (!this.surfaceLive) throw new Error('Surface is closed');
        if (action === 1) { this.renderer.deleteProgram(id); return 1; }
        // Games' post programs: 2 create from UTF-8 text (the WGSL, then the fragment stage's GLSL, NUL-separated), 3 delete.
        if (action === 3) { this.renderer.deletePostProgram(id); return 1; }
        if (action === 2) {
          if (textLength > 16 * 1024 * 1024) throw new Error('Invalid post program memory');
          const parts = new TextDecoder().decode(this.memory(textPtr, textLength)).split('\0');
          if (parts.length !== 2) throw new Error('Invalid post program');
          this.renderer.createPostProgram(id, {wgsl: parts[0], glsl: parts[1]}); return 1;
        }
        if (action !== 0 || textLength > 16 * 1024 * 1024) throw new Error('Invalid mesh program memory');
        const parts = new TextDecoder().decode(this.memory(textPtr, textLength)).split('\0'), stages = MESH_PROGRAM_STAGES;
        if (parts.length !== 1 + stages + stages + 3 + 1) throw new Error('Invalid mesh program');
        const samplers = parts.at(-1) ? parts.at(-1).split(',').map(pair => { const at = pair.lastIndexOf('='); return [pair.slice(0, at), Number(pair.slice(at + 1))]; }) : [];
        this.renderer.createProgram(id, {wgsl: parts[0], entries: parts.slice(1, 1 + stages), glsl: parts.slice(1 + stages, 1 + 2 * stages + 3), samplers, uniformBytes});
        return 1;
      }),
      // Kept instance buffers: 0 upload, 1 update from `start`, 2 delete.
      surface_instances: (_, action, id, start, instancePtr, instanceCount) => this.guard(() => {
        if (!this.surfaceLive) throw new Error('Surface is closed');
        if (action === 2) { this.renderer.deleteInstances(id); return 1; }
        if ((action !== 0 && action !== 1) || instanceCount > MESH_LIMITS.keptInstances || instancePtr % 4) throw new Error('Invalid instance memory');
        const bytes = this.memory(instancePtr, instanceCount * MESH_INSTANCE_LENGTH * 4), instances = new Float32Array(bytes.buffer, bytes.byteOffset, instanceCount * MESH_INSTANCE_LENGTH);
        if (action === 0) this.renderer.uploadInstances(id, instances); else this.renderer.updateInstances(id, start, instances);
        return 1;
      }),
      surface_draw_meshes: (_, target, clearing, r, g, b, a, framePtr, instancePtr, instanceCount, batchPtr, materialPtr, batchCount, uniformPtr, uniformCount) => this.guard(() => {
        if (!this.surfaceLive || instanceCount > 65536 || batchCount > 16384 || uniformCount > 16384 * MAX_MESH_UNIFORM_FLOATS
            || [framePtr, instancePtr, batchPtr, materialPtr, uniformPtr].some(ptr => ptr % 4)) throw new Error('Invalid mesh pass memory');
        if (!this.renderer?.ready) return 2;
        const view = (Type, ptr, count) => { const bytes = this.memory(ptr, count * 4); return new Type(bytes.buffer, bytes.byteOffset, count); };
        const presented = this.renderer.drawMeshes(clearing ? [r, g, b, a] : null, view(Float32Array, framePtr, MESH_FRAME_LENGTH),
          view(Float32Array, instancePtr, instanceCount * MESH_INSTANCE_LENGTH), view(Uint32Array, batchPtr, batchCount * MESH_BATCH_LENGTH),
          view(Float32Array, materialPtr, batchCount * MESH_MATERIAL_LENGTH), target, view(Float32Array, uniformPtr, uniformCount));
        // Effect fallbacks ride above the presentation code; changed notes reach the shell, with programs the backend
        // refused after accepting them (WebGPU compiles asynchronously; their batches draw the built-in material).
        const notes = [...this.renderer.effectNotes.values(), ...(this.renderer.programErrors?.values() ?? [])].join(' ');
        if (notes !== this.effectNotes) { this.effectNotes = notes; if (notes) this.options.onNote?.(notes); }
        return (presented ? 1 : 2) | this.renderer.effectFallbacks << 2;
      }),
      surface_effect_budget: (_, bytes) => this.guard(() => { this.effectBudget = bytes; this.renderer?.setEffectBudget(bytes); return 1; }),
      // Programs the renderer refused after accepting them (WebGPU compiles asynchronously), each once, for the game's
      // log: its ID, then the compiler's messages (`LINE:COLUMN: TEXT` in the joined WGSL's lines), each on a line of
      // its own, a NUL between programs. Taken once copied; the length is returned either way.
      surface_refused_programs: (_, out, capacity) => this.guard(() => {
        for (const [id, messages] of this.renderer?.takeRefusedPrograms?.() ?? []) {
          (this.refusedPrograms ??= []).push([id, ...messages.map(m => String(m).replace(/[\n\0]/g, ' '))].join('\n'));
        }
        const bytes = encoder.encode((this.refusedPrograms ?? []).join('\0'));
        if (bytes.byteLength && capacity >= bytes.byteLength) { this.memory(out, bytes.byteLength).set(bytes); this.refusedPrograms = []; }
        return bytes.byteLength;
      }, -1),
      surface_present: () => this.guard(() => { this.renderer?.present(); return 1; }),
      // A capture of the frame drawn so far (`renderer.capture`): read now,
      // encoded as PNG off the drawing; the runtime polls its ticket.
      surface_capture: (_, maxPixels, maxBytes) => this.guard(() => {
        if (!this.surfaceLive || !this.renderer?.ready || !this.renderer.captureFrame) throw new Error('No frame to capture');
        const ticket = this.captureTicket = (this.captureTicket ?? 0) % 0x7fffffff + 1, entry = {state: -1, png: null, error: ''};
        (this.captures ??= new Map()).set(ticket, entry);
        this.renderer.captureFrame().then(frame => encodeCapture(frame, maxPixels, maxBytes)).then(png => { entry.png = png; entry.state = png.length; },
          error => { entry.state = -2; entry.error = `the frame could not be captured: ${error?.message ?? error}`; });
        return ticket;
      }),
      capture_state: ticket => {
        const entry = this.captures?.get(ticket);
        if (!entry) { this.lastError = 'No such capture'; return -2; }
        if (entry.state === -2) { this.lastError = entry.error; this.captures.delete(ticket); }
        return entry.state;
      },
      capture_take: (ticket, out, length) => this.guard(() => {
        const entry = this.captures?.get(ticket);
        if (!entry?.png || entry.png.length !== length) throw new Error('Capture size mismatch');
        this.memory(out, length).set(entry.png); this.captures.delete(ticket); return 1;
      }),
      surface_pixel: (_, x, y, out) => this.guard(() => { if (!this.renderer.readPixelSync) throw new Error('WebGPU readback is asynchronous; use the host readback API'); this.memory(out, 4).set(this.renderer.readPixelSync(x, y)); return 1; }),
      plugin_instantiate: (ptr, len) => this.guard(() => this.plugins().instantiate(this.memory(ptr, len).slice())),
      plugin_export_kind: (id, ptr, len) => this.guard(() => this.plugins().exportKind(id, this.text(ptr, len))),
      plugin_invoke: (id, name, nameLen, signature, signatureLen, args, out) => this.guard(() => this.plugins().invoke(id, this.text(name, nameLen), this.text(signature, signatureLen), () => new DataView(this.instance.exports.memory.buffer), args, out), 1),
      plugin_fuel_set: (id, fuel) => this.guard(() => { this.plugins().get(id).exports.sh_fuel.value = fuel; }),
      plugin_fuel_get: id => this.guard(() => this.plugins().get(id).exports.sh_fuel.value, -1n),
      plugin_memory_read: (id, ptr, len, out) => this.guard(() => this.plugins().read(id, ptr >>> 0, this.memory(out, len >>> 0))),
      plugin_memory_write: (id, ptr, src, len) => this.guard(() => this.plugins().write(id, ptr >>> 0, this.memory(src, len >>> 0))),
      plugin_release: id => this.guard(() => this.plugins().release(id)),
      // Straight into the runtime's memory: reading why the browser refused a buffer needs none.
      error_copy: (out, capacity) => encoder.encodeInto(this.lastError, this.memory(out, capacity)).written,
      memory_failures: () => this.memoryFailures,
      report_error: (ptr, len) => this.fault(this.text(ptr, Math.min(len, 4096))),
      report_note: (ptr, len) => { this.lastError = this.text(ptr, Math.min(len, 4096)); this.options.onNote?.(this.lastError); },
      epoch_ms: () => this.options.epochMillis?.() ?? Date.now(),
      reduced_motion: () => {try{return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?1:0;}catch{return 0;}},
      device_class: () => this.options.deviceClass === 'mobile' || (this.options.deviceClass === undefined && globalThis.matchMedia?.('(pointer: coarse)').matches) ? 1 : 0,
      // Touch-first: a coarse primary pointer (or touch points) and no fine pointer anywhere, or a page that says
      // it is mobile; on-screen touch controls then show before the first touch.
      touch_first: () => {try{if(this.options.deviceClass!==undefined)return this.options.deviceClass==='mobile'?1:0;const media=query=>!!globalThis.matchMedia?.(query).matches;return (media('(pointer: coarse)')||(globalThis.navigator?.maxTouchPoints|0)>0)&&!media('(any-pointer: fine)')?1:0;}catch{return 0;}},
      display_hz: () => this.hz,
      work_clock: () => {try{const value=this.options.workClock?this.options.workClock():globalThis.performance?.now?.();return Number.isFinite(value)&&value>=0?value:-1;}catch{return -1;}},
      viewport_info: kind => {const rect=this.container.getBoundingClientRect();return kind===0?rect.width:kind===1?rect.height:kind===2?Math.min(3,Math.max(1,globalThis.devicePixelRatio||1)):0;},
      random_fill: (out, len) => this.guard(() => { if (len > 65536) throw new Error('Randomness request exceeds Web Crypto limit'); crypto.getRandomValues(this.memory(out, len)); return 1; }),
    },
    // A page's own import modules beside the engine's (the StarHermit
    // runtime's page gives `starhermit_runtime`).
    ...(this.options.imports?.(this) ?? {})};
  }
  candidateCanvas() { const canvas = this.canvas.cloneNode(false); canvas.width = this.canvas.width; canvas.height = this.canvas.height; return canvas; }
  async graphics() {
    const generation = ++this.generation;
    const selected = await selectGraphics(() => this.candidateCanvas(), {...this.options.graphics,
      fallback: this.options.fallback !== false,
      onLost: (renderer, error) => { if (this.disposed || generation !== this.generation) return; renderer.ready = false; this.options.onProgress?.('Restoring graphics'); if (error || renderer.backend === 'WebGPU') this.recover().catch(error => this.fault(error.message)); },
      onRestored: () => this.options.onProgress?.('Graphics restored'),
    });
    // Quality detection's name and benchmark (at most 300 ms, kept on the device; not for software renderers).
    await measureGraphics(selected.renderer);
    if (this.disposed || generation !== this.generation) { selected.renderer.destroy(); throw new Error('Graphics initialization cancelled'); }
    const old = this.renderer;
    try {
      if (old?.textures) for (const [id, entry] of old.textures) selected.renderer[entry.float ? 'uploadFloatTexture' : 'uploadTexture'](id, entry.width, entry.height, entry.pixels, entry);
      if (old?.targets) for (const [id, entry] of old.targets) {
        // A texture target comes back cleared (in RGBA8 where half floats do not render, of whatever channels: the
        // runtime's own fallback), sampled as it was.
        let flags = entry.flags ?? (entry.depth ? 1 : 0);
        if (flags & 4 && !selected.renderer.halfFloatTargets) flags &= ~(4 | 16 | 32);
        selected.renderer.createTarget(id, entry.width, entry.height, entry.depth, flags);
        if (flags & 2 && entry.sampler) selected.renderer.setTextureSampler(id, entry.sampler);
      }
      if (old?.sceneDepth && old.textures?.has(old.sceneDepth)) selected.renderer.setSceneDepth(old.sceneDepth);
      if (old?.meshes) for (const [id, entry] of old.meshes) selected.renderer.uploadMesh(id, entry.vertices, entry.indices, entry.code ?? entry.layout, entry.count);
      if (old?.meshPrograms) for (const [id, entry] of old.meshPrograms) selected.renderer.createProgram(id, entry.code);
      if (old?.postGames) for (const [id, entry] of old.postGames) selected.renderer.createPostProgram(id, entry.code);
      if (old?.instanceSets) for (const [id, entry] of old.instanceSets) selected.renderer.uploadInstances(id, entry.instances);
    }
    catch (error) { selected.renderer.destroy(); throw error; }
    if (this.effectBudget !== undefined) selected.renderer.setEffectBudget(this.effectBudget);
    this.canvas.replaceWith(selected.canvas); this.canvas = selected.canvas; if (this.cursor) this.canvas.style.cursor = this.cursor; this.renderer = selected.renderer; old?.destroy(); this.access?.attach(this.canvas, this.title);
    this.backendFailures = selected.failures; this.resize(); this.options.onBackend?.(this.renderer.backend, selected.failures);
  }
  async recover() {
    if (this.recovering) return this.recovering;
    this.recovering = this.graphics().finally(() => { this.recovering = null; });
    return this.recovering;
  }
  // Canvas pixels and their scale (canvas pixels per CSS pixel: the device
  // pixel ratio, within 1..3 and the renderer's largest canvas).
  dimensions() {
    const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    if (this.hidden) return [0, 0, ratio]; const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [0, 0, ratio];
    const limit = this.renderer?.maxDimension || 8192;
    const scale = Math.min(ratio, limit / rect.width, limit / rect.height);
    return [Math.max(1, Math.floor(rect.width * scale)), Math.max(1, Math.floor(rect.height * scale)), scale];
  }
  resize() {
    const [width, height] = this.dimensions(); if (!width || !height) return;
    if (this.canvas.width !== width) this.canvas.width = width; if (this.canvas.height !== height) this.canvas.height = height;
  }
  call(name, ...args) {
    try { const result = this.instance.exports[name](...args); if (result === 0 && name !== 'sh_metric' && name !== 'sh_handles_key') throw new Error(this.fatal || this.lastError || `${name} failed`); return result; }
    catch (error) { this.fault(error.message); throw error; }
  }
  putInbox(bytes) { const ptr = this.call('sh_inbox_reserve', bytes.length); this.memory(ptr, bytes.length).set(bytes); }
  output(kind) { const len = this.call('sh_output', kind); return this.memory(this.instance.exports.sh_output_ptr(), len).slice(); }
  // The preference partition; empty when the game persists preferences itself.
  partitionKey() { const len = this.instance.exports.sh_output(1); if (this.fatal) throw new Error(this.fatal); return decoder.decode(this.memory(this.instance.exports.sh_output_ptr(), len)); }
  event(kind, code = '', a = 0, b = 0, c = 0) {
    // PointerEvent ids are opaque signed integers. Safari can use large
    // negative ids; the engine's touch ABI accepts only unsigned ids.
    // Map all active fingers, so a signed id cannot alias a positive one.
    if (kind === 13) {
      if (!Number.isSafeInteger(c)) return 1;
      const browserId = c;
      const ids = this.touchIdentifiers ??= new Map();
      if (!ids.has(browserId)) {
        if (code[0] !== 's') return 1; // a retired/unknown finger
        const used = new Set(ids.values());
        let id = 1;
        while (used.has(id)) id++;
        ids.set(browserId, id);
      }
      c = ids.get(browserId);
      if (code[0] === 'e' || code[0] === 'c') ids.delete(browserId);
    }
    const bytes = encoder.encode(code);
    this.putInbox(bytes);
    return this.call('sh_event', kind, bytes.length, a, b, c);
  }
  stats() {
    const get = kind => this.instance.exports.sh_metric(kind);
    return {ticks: get(0), presses: get(1), frames: get(2), x: get(3), nextSimulationMs: get(4), running: !!get(5), revision: ((BigInt(this.instance.exports.sh_revision_high() >>> 0) << 32n) | BigInt(this.instance.exports.sh_revision_low() >>> 0)).toString(), fps: get(7), dropped: get(8), backend: this.renderer.backend, loadingMode: this.loadingMode, storage: this.storage.status, initializationProgress: this.instance.exports.sh_initialization_progress(), initializing: !!this.instance.exports.sh_initializing()};
  }
  step(now = this.clock(), present = true) {
    this.resize();
    // A changed device pixel ratio (zoom, another monitor) reaches the game.
    const scale = this.dimensions()[2]; if (this.started && scale !== this.scaleSent) { if (this.scaleSent !== undefined) this.event(8, '', scale); this.scaleSent = scale; }
    // The safe area is measured again only after something that moves it
    // (a resize, rotation, the page's styles).
    if (this.started && this.insetsDirty !== false) { this.insetsDirty = false; const insets = this.safeArea(); if (insets !== (this.insetsSent ?? '0 0 0 0')) { this.insetsSent = insets; this.event(14, insets); } }
    this.call('sh_tick', now, present ? 1 : 0);
    const stats = this.stats();
    // An empty partition means the game persists its preferences itself.
    // Marked written once copied out: a copy the browser refused is tried again next turn.
    if (this.partition && stats.revision !== this.lastRevision) { const bytes = this.output(0); this.lastRevision = stats.revision; this.storage.queue(this.partition, bytes).catch(error => this.options.onStorage?.({status: 'session-only', reason: error.message})); }
    this.options.onFrame?.(stats); return stats;
  }
  // The safe-area insets in canvas pixels, as the game's event text. A
  // fixed probe reads them through custom properties a page may set on
  // :root (--starhermit-safe-top and the others; env() by default).
  safeArea() {
    try {
      const document = this.canvas.ownerDocument, view = document.defaultView;
      if (!this.safeProbe) {
        const probe = this.safeProbe = document.createElement('div'); probe.setAttribute('aria-hidden', 'true');
        Object.assign(probe.style, {position: 'fixed', left: '0', top: '0', width: '0', height: '0', visibility: 'hidden', pointerEvents: 'none'});
        for (const side of ['top', 'right', 'bottom', 'left']) probe.style.setProperty(`padding-${side}`, `var(--starhermit-safe-${side}, env(safe-area-inset-${side}, 0px))`);
        (document.body ?? document.documentElement).append(probe); this.cleanups.push(() => probe.remove());
      }
      const style = view.getComputedStyle(this.safeProbe), rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return this.insetsSent ?? '0 0 0 0';
      const px = side => Math.max(0, parseFloat(style.getPropertyValue(`padding-${side}`)) || 0);
      return canvasInsets(rect, {width: view.innerWidth, height: view.innerHeight}, {top: px('top'), right: px('right'), bottom: px('bottom'), left: px('left')}, this.canvas.width / rect.width, this.canvas.height / rect.height).join(' ');
    } catch { return this.insetsSent ?? '0 0 0 0'; }
  }
  // The game's orientation request; most browsers lock only in
  // fullscreen, so entering it asks again. Refusals are notes.
  async lockOrientation() {
    const screenOrientation = globalThis.screen?.orientation, wanted = this.orientation;
    if (!wanted) return;
    if (wanted === 'any') { try { screenOrientation?.unlock?.(); } catch {} return; }
    if (typeof screenOrientation?.lock !== 'function') { this.options.onNote?.('Orientation lock unavailable: not supported'); return; }
    try { await screenOrientation.lock(wanted); } catch (error) { this.options.onNote?.(`Orientation lock unavailable: ${error?.message ?? 'refused'}`); }
  }
  // A turn that failed: a buffer the browser refused the page's own code (a copy of the runtime's output, an
  // event's text) left the runtime as it was, so the loops go on and the runtime hears of it (`memory_failures`);
  // anything else, or a runtime that stopped, ends them. True when they go on.
  turnFailed(error) {
    if (this.fatal || !outOfMemory(error)) { this.cancelLoops(); return false; }
    this.memoryFailures++; return true;
  }
  cancelLoops() { if (this.timer !== undefined) clearTimeout(this.timer); if (this.animation !== undefined) cancelAnimationFrame(this.animation); this.timer = this.animation = undefined; }
  schedule() {
    if (!this.started || this.hidden || this.options.manual) return;
    const simulation = () => {
      if (!this.started || this.hidden) return;
      try { const stats = this.step(this.clock(), false); if (!stats.running) { this.stop(); return; } this.timer = setTimeout(simulation, Math.max(0, stats.nextSimulationMs)); }
      catch (error) { if (this.turnFailed(error)) this.timer = setTimeout(simulation, Math.max(0, this.stats().nextSimulationMs)); }
    };
    const presentation = timestamp => {
      if (!this.started || this.hidden) return;
      if (this.lastAnimation !== undefined && timestamp > this.lastAnimation) {
        this.refreshSamples.push(timestamp - this.lastAnimation); if (this.refreshSamples.length > 32) this.refreshSamples.shift();
        if (this.refreshSamples.length === 32 && !this.options.displayHz) {
          const sorted = [...this.refreshSamples].sort((a, b) => a - b); const rate = Math.round(1000 / sorted[16]);
          if (rate >= 30 && rate <= 1000) this.hz = rate;
        }
      }
      this.lastAnimation = timestamp;
      // A frame a finger's release already presented simulates only.
      const present = !this.liftPresented; this.liftPresented = false;
      try { this.step(this.clock(), present); this.animation = requestAnimationFrame(presentation); }
      catch (error) { if (this.turnFailed(error)) this.animation = requestAnimationFrame(presentation); }
    };
    this.timer = setTimeout(simulation, Math.max(0, this.stats().nextSimulationMs)); this.animation = requestAnimationFrame(presentation);
  }
  setHidden(hidden, now = this.clock()) {
    this.hidden = hidden; this.cancelLoops(); this.call('sh_suspend', now); this.lastAnimation = undefined; this.refreshSamples = [];
    // Streamed music plays on in a hidden page: a turn now and then (the
    // browser runs a hidden page's timers once a second at most) refills
    // its rings, while the runtime says streams play.
    clearInterval(this.hiddenWake); this.hiddenWake = null;
    if (hidden && this.options.hiddenTurns) this.hiddenWake = setInterval(() => { if (this.instance?.exports.sh_wake_hidden?.()) this.hiddenTurn(); }, 250);
    if (!hidden) this.schedule();
  }
  // The keyboard focus is the game's (with its browser defaults): on its
  // canvas or in its area, or on nothing (the page's body); never the
  // page's elements outside it.
  inGame(target) {
    const document = this.canvas.ownerDocument;
    return this.gameDefaults && (target === document.body || target === document.documentElement || !!target && this.container.contains(target));
  }
  // While the game runs (with its browser defaults) its area selects
  // nothing, shows no callout, tap highlight or touch gesture of the
  // browser's, and the canvas no focus ring (the game draws its own focus);
  // the page's own styles come back when it stops.
  claimArea() {
    if (!this.gameDefaults) return;
    const set = (element, styles) => { if (typeof element?.style?.setProperty !== 'function') return; for (const [name, value] of Object.entries(styles)) { this.restyled.push([element, name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]); element.style.setProperty(name, value); } };
    set(this.container, {'user-select': 'none', '-webkit-user-select': 'none', '-webkit-touch-callout': 'none', '-webkit-tap-highlight-color': 'transparent', 'touch-action': 'none'});
    set(this.canvas, {outline: 'none'});
  }
  releaseArea() { for (const [element, name, value, priority] of this.restyled.splice(0).reverse()) element.style.setProperty(name, value, priority); }
  bind() {
    const on = (target, name, callback, options) => { target.addEventListener(name, callback, options); this.cleanups.push(() => target.removeEventListener(name, callback, options)); };
    const FIELDS = 'input,textarea,select,button,[contenteditable=true]';
    // Keys reach the game as they are pressed; keepsKey says which the
    // browser does not act on as well.
    const key = pressed => event => {
      if (!this.started || this.hidden || event.target?.closest?.(FIELDS)) return;
      const code = encoder.encode(event.code); this.putInbox(code);
      if (keepsKey(event, !!this.instance.exports.sh_handles_key(code.length), this.inGame(event.target))) event.preventDefault();
      this.call('sh_event', 0, code.length, pressed ? 1 : 0, [...event.key].length === 1 ? event.key.codePointAt(0) : 0, 0);
    };
    on(window, 'gamepaddisconnected', event => this.gamepads.forget(event.gamepad?.index));
    on(window, 'keydown', key(true)); on(window, 'keyup', key(false)); on(window, 'blur', () => { if (this.started) this.event(4, '', 0); });
    // The game's area while it runs: right-click is the game's (button 3),
    // nothing selects or drags (but the text entry), the middle button does
    // not scroll and the back and forward buttons (8 and 9) do not leave the
    // page (Chrome and Firefox go on their release). The clipboard's copy,
    // cut and paste go only to the text entry; the game's own writes
    // (clipboard.writeText) are the page's and unaffected.
    const area = event => this.started && this.gameDefaults && event.target !== this.entry?.element;
    for (const name of ['contextmenu', 'selectstart', 'dragstart', 'auxclick']) on(this.container, name, event => { if (area(event)) event.preventDefault(); });
    on(this.container, 'mousedown', event => { if (event.button === 1 && area(event)) event.preventDefault(); });
    on(this.container, 'mouseup', event => { if ((event.button === 3 || event.button === 4) && area(event)) event.preventDefault(); });
    for (const name of ['copy', 'cut', 'paste']) on(document, name, event => { if (area(event) && !event.target?.closest?.(FIELDS) && this.inGame(event.target)) event.preventDefault(); });
    // A file or link dropped anywhere on the page does not open it in the
    // game's place; a page's field (and the text entry) still takes text.
    for (const name of ['dragenter', 'dragover', 'drop']) on(document, name, event => {
      if (!this.started || !this.gameDefaults || event.target?.closest?.(FIELDS)) return;
      event.preventDefault(); if (name !== 'drop' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    });
    // Focus back on the window or the canvas (mute when unfocused follows it).
    on(window, 'focus', () => { if (this.started) this.event(4, '', 1); });
    on(window,'focusin',event=>{if(this.started&&event.target!==this.entry?.element&&event.target?.closest?.('input,textarea,select,button,[contenteditable=true]'))this.event(4,'',0);else if(this.started&&event.target===this.canvas)this.event(4,'',1);});
    // Fingers down, for the cancellations the browser leaves out (the page
    // hidden, capture lost to a replaced canvas).
    const fingers = new Map();
    const cancelFingers = ids => {
      for (const id of ids) {
        const finger = fingers.get(id); if (!finger) continue; fingers.delete(id);
        this.event(13, `c ${finger.primary ? 1 : 0} -`, finger.x, finger.y, id);
        if (finger.primary) { this.event(1, '', -1, -1); this.event(2, '', 1, 0); }
      }
    };
    on(document, 'visibilitychange', () => { if (!this.started) return; this.setHidden(document.hidden); if (document.hidden) cancelFingers([...fingers.keys()]); });
    // The page going away quits the game (onQuit runs; its worker, audio
    // and sockets close), also when the browser keeps the page in its
    // back/forward cache: it may drop it from there without a word. A page
    // the cache gives back (pageshow, persisted) loads again, as one the
    // cache did not keep would, so the player finds the game running.
    on(window, 'pagehide', () => { this.exit(); this.stop(); });
    on(window, 'pageshow', event => { if (event.persisted && !this.started && !this.disposed) globalThis.location.reload(); });
    // Touch screens: every finger is a touch point of its own (event 13),
    // captured by the canvas so it reports beyond the canvas's edge; the
    // primary finger also drives the pointer as before, so the UI works.
    // touch() is true for points the pointer must not follow.
    const touch = (phase, event) => {
      if (event.pointerType !== 'touch') return false;
      if (phase !== 's' && !fingers.has(event.pointerId)) return true;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const x = (event.clientX - rect.left) * this.canvas.width / rect.width, y = (event.clientY - rect.top) * this.canvas.height / rect.height;
        if (phase === 'e' || phase === 'c') fingers.delete(event.pointerId); else fingers.set(event.pointerId, {x, y, primary: event.isPrimary});
        this.event(13, touchCode(phase, event), x, y, event.pointerId);
      }
      return !event.isPrimary;
    };
    // While the pointer is locked, motion is relative (event 12).
    on(this.container, 'pointermove', event => { if (!this.started || this.hidden || touch('m', event)) return; const rect = this.canvas.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0) return; if (document.pointerLockElement === this.canvas) { if (event.movementX || event.movementY) this.event(12, '', event.movementX * this.canvas.width / rect.width, event.movementY * this.canvas.height / rect.height); return; } this.event(1, '', (event.clientX - rect.left) * this.canvas.width / rect.width, (event.clientY - rect.top) * this.canvas.height / rect.height); });
    // Buttons numbered as on X11: 1 left, 2 middle, 3 right, 8 back, 9
    // forward. A press on the text entry leaves it focused (the on-screen
    // keyboard stays up).
    on(this.container, 'pointerdown', event => {
      if (!this.started || this.hidden) return;
      const entry = event.target === this.entry?.element;
      if (event.pointerType === 'touch' && !entry) { try { this.canvas.setPointerCapture(event.pointerId); } catch {} }
      if (touch('s', event)) return;
      if (!entry) this.canvas.focus();
      // A finger presses where no motion went before it.
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && document.pointerLockElement !== this.canvas) this.event(1, '', (event.clientX - rect.left) * this.canvas.width / rect.width, (event.clientY - rect.top) * this.canvas.height / rect.height);
      this.event(2, '', buttonNumber(event.button), 1);
    });
    // A finger's release presents a frame at once (outside manual
    // stepping; the next animation frame then only simulates): a text
    // field it tapped takes focus inside the gesture, which iOS wants
    // before it shows the on-screen keyboard. Releases count while hidden
    // too, so nothing stays held.
    on(this.container, 'pointerup', event => {
      if (!this.started) return;
      if (touch('e', event)) return;
      this.event(2, '', buttonNumber(event.button), 0);
      if (event.target !== this.entry?.element) this.entry?.refocus();
      if (event.pointerType === 'touch' && !this.options.manual && !this.hidden && !this.liftPresented) {
        try { this.step(this.clock(), true); this.liftPresented = true; } catch { this.cancelLoops(); }
      }
    });
    // A cancelled primary finger lets go away from every widget, so it
    // clicks nothing.
    on(this.container, 'pointercancel', event => {
      if (!this.started || touch('c', event) || event.pointerType !== 'touch') return;
      this.event(1, '', -1, -1); this.event(2, '', 1, 0);
    });
    // Capture lost without a release (the canvas replaced after a context
    // loss): the finger is cancelled.
    on(document, 'lostpointercapture', event => { if (this.started && event.pointerType === 'touch') cancelFingers([event.pointerId]); });
    on(document, 'fullscreenchange', () => { if (this.started) this.event(10, '', this.ownFullscreen() ? 1 : 0, 0); if (this.ownFullscreen() && this.orientation && this.orientation !== 'any') this.lockOrientation(); });
    on(document, 'pointerlockchange', () => { if (this.started) this.event(11, '', document.pointerLockElement === this.canvas ? 1 : 0, 0); });
    // Promise-based requests report their own refusals (a refused
    // unadjusted request is retried without it).
    on(document, 'pointerlockerror', () => { if (this.started && !this.lockRequest) this.event(11, '', 0, 1); });
    // The wheel in notches: pixels (about 100 a notch), lines (3) or pages.
    on(this.container, 'wheel', event => {
      if (!this.started || this.hidden) return; event.preventDefault();
      const unit = event.deltaMode === 1 ? 1 / 3 : event.deltaMode === 2 ? 10 : 1 / 100;
      this.event(9, '', Math.max(-1000, Math.min(1000, event.deltaX * unit)), Math.max(-1000, Math.min(1000, event.deltaY * unit)));
    }, {passive: false});
    const observer = new ResizeObserver(() => { this.resize(); this.insetsDirty = true; }); observer.observe(this.container); this.cleanups.push(() => observer.disconnect());
    const moved = () => { this.insetsDirty = true; };
    on(window, 'resize', moved); on(window, 'orientationchange', moved); on(document, 'fullscreenchange', moved);
    if (globalThis.visualViewport) on(globalThis.visualViewport, 'resize', moved);
    // Pages may set --starhermit-safe-* on :root (style or class).
    if (typeof MutationObserver === 'function') { const styles = new MutationObserver(moved); styles.observe(document.documentElement, {attributes: true, attributeFilter: ['style', 'class']}); this.cleanups.push(() => styles.disconnect()); }
  }
  async start() {
    if (this.started || this.fatal) throw new Error(this.fatal || 'Game already started');
    // With audioOnGesture the game starts at once and audio with the page's
    // first press (browsers start audio only within a gesture).
    const audioFailed=error=>{this.options.onAudio?.({status:"unavailable",reason:error.message});};
    const audioReady=this.options.audioOnGesture?null:this.audio?.start().catch(audioFailed);
    try{await this.options.onStartGesture?.();
      if(audioReady)await audioReady;
    }catch(error){
      await this.audio?.close().catch(()=>{});
      throw error;
    }
    if(this.disposed||this.fatal)throw new Error(this.fatal||'Game was destroyed during startup');
    this.call('sh_start', this.clock()); this.started = true; this.canvas.tabIndex = 0; this.canvas.style.touchAction = 'none'; this.claimArea(); this.canvas.focus();
    this.bind();
    if(this.options.audioOnGesture&&this.audio){
      const events=['pointerdown','keydown','touchend'];
      // Each press until the audio runs: one the browser does not count as
      // a gesture (a modifier key alone) leaves the context waiting, and
      // the next resumes it; a start that gave up waiting (error.gesture)
      // leaves the next press to try again.
      // An output lost later that could not start again by itself
      // (onLost) waits for the next press the same way.
      let armed=false;
      const stop=()=>{armed=false;for(const name of events)window.removeEventListener(name,begin,true);};
      const begin=()=>{if(this.disposed||this.fatal||!this.audio)return stop();this.audio.start().then(stop,error=>{if(!error?.gesture)stop();audioFailed(error);});};
      const arm=()=>{if(armed||this.disposed||this.fatal)return;armed=true;for(const name of events)window.addEventListener(name,begin,true);};
      arm();this.audio.onLost=error=>{if(error)audioFailed(error);arm();};
      this.cleanups.push(stop);
    }
    if (navigator.keyboard?.getLayoutMap) navigator.keyboard.getLayoutMap().then(map => { this.labels = map; }).catch(() => {});
    this.schedule(); return this;
  }
  stop() {
    this.started = false; this.cancelLoops(); this.releaseArea(); this.assets.close(); this.api?.close(); this.sockets?.closeAll(); this.instances?.close(); for (const id of [...(this.timers?.keys() || [])]) this.timerCancel(id); this.launch = null;
    this.audioBridge?.close();this.audioClosing=this.audio?.close().catch(error=>this.options.onAudio?.({status:"unavailable",reason:error.message}));
    this.voice?.close();
    if (this.instance) { try { const stats = this.stats(); if (this.partition && stats.revision !== this.lastRevision) this.storage.queue(this.partition, this.output(0)).catch(() => {}); } catch {} this.instance.exports.sh_shutdown(); }
  }
  // The page is going away for good: the game may start its last
  // `keepalive` requests (within the browser's 64 KiB quota) before stopping.
  exit() {
    if (!this.instance || this.fatal) return;
    try { this.instance.exports.sh_page_exit?.(); } catch (error) { this.lastError = String(error.message || error).slice(0, 4096); }
  }
  // A hidden page takes no turns of its own, but with `hiddenTurns` the
  // news it waits for (the game's worker answering: its frame, then the
  // suspend the page asks for after it, and what that writes; the audio
  // worklet's answer to that frame's sound, whose time the clock reads)
  // takes a simulation-only turn: the browser's timers in a hidden page fire
  // once a second at most, so it comes as a microtask (news may come during
  // a turn, which it follows), one for all that came meanwhile.
  // The application's audio work once audio requests settled, outside any
  // import (a wake may come from inside one) and at most once a task.
  audioPump() {
    if (this.audioPumpQueued || !this.instance?.exports.sh_audio_pump) return;
    this.audioPumpQueued = true;
    setTimeout(() => {
      this.audioPumpQueued = false;
      if (!this.started || this.disposed || this.fatal) return;
      try { this.instance.exports.sh_audio_pump(); } catch (error) { this.fault(error.message); }
    }, 0);
  }
  hiddenTurn() {
    if (!this.options.hiddenTurns || !this.hidden || this.hiddenTurnQueued) return;
    this.hiddenTurnQueued = true;
    queueMicrotask(() => {
      this.hiddenTurnQueued = false;
      if (!this.started || !this.hidden || this.disposed || this.fatal) return;
      try { this.step(this.clock(), false); } catch (error) { this.turnFailed(error); }
    });
  }
  // A hidden tab does not tick, but a takeover request must still be served
  // (sockets closed, outboxes flushed, claim released): simulation-only
  // steps run until the claim changes or the requester's steal deadline.
  serveHandover(id) {
    const deadline = this.clock() + 6000;
    const serve = () => {
      if (!this.started || !this.hidden || this.disposed || this.fatal || this.instances?.claims.get(id)?.state !== 3 || this.clock() > deadline) return;
      try { this.step(this.clock(), false); } catch { return; }
      setTimeout(serve, 50);
    };
    setTimeout(serve, 0);
  }
  // A refusal leaves the embedded game as it was and tells it (event 10).
  // The canvas is fullscreen, itself or inside the fullscreen element.
  ownFullscreen() { const element = document.fullscreenElement; return !!element && (element === this.canvas || !!element.contains?.(this.canvas)); }
  async fullscreen() { if (this.ownFullscreen()) return true; try { await this.canvas.requestFullscreen(); return true; } catch (error) { this.options.onNote?.(`Fullscreen unavailable: ${error.message}`); if (this.started) this.event(10, '', this.ownFullscreen() ? 1 : 0, 1); return false; } }
  // Unadjusted (raw) motion where the browser offers it; event 11 reports
  // the lock and refusals.
  async pointerLock(on) {
    if (!on) { if (document.pointerLockElement === this.canvas) document.exitPointerLock(); return; }
    if (document.pointerLockElement === this.canvas) return;
    const refuse = error => { this.options.onNote?.(`Pointer lock unavailable: ${error?.message ?? 'refused'}`); if (this.started) this.event(11, '', 0, 1); };
    // Older browsers return nothing and report refusals only through
    // pointerlockerror (which bind() forwards).
    const request = options => { const result = this.canvas.requestPointerLock(options); this.lockRequest = !!result?.then; return this.lockRequest ? result : Promise.resolve(); };
    try { await request({unadjustedMovement: true}); }
    catch (error) { if (error?.name !== 'NotSupportedError') return refuse(error); try { await request(); } catch (again) { refuse(again); } }
    finally { this.lockRequest = false; }
  }
  async destroy() { if (this.disposed) return; this.disposed = true; this.generation++; clearInterval(this.hiddenWake); try {this.stop(); this.cleanups.splice(0).forEach(cleanup => cleanup()); await this.storage.flush(); await this.saveSlots?.flush(); await this.contentStore?.flush();
      if(this.audioClosing)await this.audioClosing;
    } finally {this.assets.close(); this.storage.close(); this.saveSlots?.close(); this.contentStore?.close(); this.renderer?.destroy();} }
}
// A captured frame as PNG: opaque, halved until it holds at most
// `maxPixels`, encoded by the browser (off the page's thread where it
// can) and at most `maxBytes`.
async function encodeCapture({width, height, pixels}, maxPixels, maxBytes) {
  for (let at = 3; at < pixels.length; at += 4) pixels[at] = 255;
  const canvas = (w, h) => {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
    const element = globalThis.document.createElement('canvas'); element.width = w; element.height = h; return element;
  };
  let image = canvas(width, height);
  image.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), width, height), 0, 0);
  while (width * height > maxPixels && width > 1 && height > 1) {
    width = Math.floor(width / 2); height = Math.floor(height / 2);
    const half = canvas(width, height), context = half.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height); image = half;
  }
  const blob = image.convertToBlob ? await image.convertToBlob({type: 'image/png'})
    : await new Promise((resolve, reject) => image.toBlob(blob => blob ? resolve(blob) : reject(new Error('the browser did not encode it')), 'image/png'));
  if (blob.size > maxBytes) throw new Error(`the PNG is larger than ${maxBytes} bytes`);
  return new Uint8Array(await blob.arrayBuffer());
}

async function createHost(canvas, options = {}) {
  if (!globalThis.isSecureContext && !options.allowInsecureForTests) throw new Error('Serve the game over HTTPS or localhost');
  const host = new BrowserHost(canvas, options);
  try {
    options.onProgress?.('Checking graphics'); await host.graphics();
    const loaded = await instantiateWasm(options.wasmUrl, host.imports(), options); host.instance = loaded.instance; host.wasmModule = loaded.module; host.loadingMode = loaded.loadingMode;
    for (const name of ['main', 'sh_prepare', 'sh_start', 'sh_tick', 'sh_suspend', 'sh_shutdown', 'sh_output', 'sh_metric', 'sh_event', 'sh_asset_wake', 'sh_initializing', 'sh_initialization_progress']) if (typeof host.instance.exports[name] !== 'function') throw new Error(`WASM host export missing: ${name}`);
    if(host.audio){try{await host.audio.prepare();}catch(error){options.onAudio?.({status:"unavailable",reason:error.message});await host.audio.close();host.audio=null;}}
    host.instance.exports.main(0, 0); if (host.fatal) throw new Error(host.fatal); host.call('sh_prepare', host.clock());
    host.partition = host.partitionKey(); await host.storage.open();
    // An empty partition: the game loads (and writes) its own preferences.
    try { const snapshot = host.partition ? await host.storage.load(host.partition) : null; if (snapshot) { host.putInbox(snapshot); if (!host.instance.exports.sh_restore(snapshot.byteLength)) {
        host.storage.database?.close(); host.storage.database = null; host.storage.setStatus?.('session-only', host.lastError);
        options.onStorage?.({status: 'session-only', reason: host.lastError});
      } } }
    catch (error) { if (host.fatal) throw error; options.onStorage?.({status: 'session-only', reason: error.message}); }
    host.lastRevision = host.stats().revision;
    while (host.stats().initializing) {
      if (host.disposed || host.fatal) throw new Error(host.fatal || 'Initialization cancelled');
      host.call('sh_tick', host.clock(), 0);
      options.onProgress?.(`Initializing modules: ${Math.round(host.stats().initializationProgress * 100)}%`);
      // A game whose loading wakes it (initializeOnWake) is polled when
      // its requests complete, else on a short timer.
      if (host.stats().initializing) await new Promise(resolve => {
        const done = () => { clearTimeout(timer); host.woke = null; resolve(); };
        const timer = setTimeout(done, options.initializeOnWake ? 1000 : Math.min(50, Math.max(1, host.stats().nextSimulationMs)));
        host.woke = done;
      });
    }
    options.onProgress?.('Ready'); return host;
  } catch (error) { host.fault(error.message); await host.destroy(); throw error; }
}
return {outOfMemory, instantiateWasm, buttonNumber, touchCode, canvasInsets, PluginHub, AccessTree, editCode, keepsKey, TextEntry, BrowserHost, createHost};
})();
// runtime
// The StarHermit runtime in browsers: the release's entry (`starhermit.js`,
// the only script a game's loader loads, pinned by its integrity; the
// release build bundles the engine's browser glue into it). It reads the
// release manifest (pinned too), fetches the runtime's WebAssembly, the
// audio mixer and the fonts with the integrity the manifest lists, starts
// the runtime in the engine's browser host and runs the game at `package`
// (the game's own origin and path: starhermit.txt, starhermit-files.json and
// the game's files). Any failure before the runtime can show its own
// screens shows the runtime's error page here, never a blank page.
//
// A loader page holds no script of its own (it works under a
// Content-Security-Policy that allows scripts only from the engine's host):
// the configuration is data, and this module starts the game when it finds
// it, with the page's directory as the package and the page's canvas:
//
//   <script type="module" src="<base>/<version>/starhermit.js" integrity="..." crossorigin="anonymous"></script>
//   <script type="application/json" id="starhermit-config">{"manifest":{"url":"...","integrity":"..."}}</script>
//
// `start({manifest: {url, integrity}, package, canvas})` does the same for
// pages that call it.
//
// While the game runs, its area and the keyboard focus on it keep the
// browser's right-click menu, text selection, copy and paste, and
// shortcuts such as Ctrl+S, Ctrl+F and zoom from the game (the player's
// fullscreen, reload, developer tools and tab keys still work; see
// BrowserHost.bind()). A page that embeds the game in a larger document
// may leave all of them to the page: `"browserDefaults": "page"` in the
// configuration, or `start({browserDefaults: 'page', ...})`.
//
// `start` resolves once the game runs and rejects after showing the error;
// audio starts with the page's first press (browsers start audio only in a
// gesture). The page's `<html data-starhermit>` reads `loading`, `running`
// or `error`.
//
// A launch credential in the page's address (`#game_token` from the
// StarHermit launcher, `#access_token` from the platform's game sign-in)
// is taken out of it before anything else runs; the runtime's platform
// session on this page takes it once, and the game's worker never sees it.
const {createHost} = __host;
const {captureLaunch} = __http;
const {courier, route} = __courier;
const {BrowserAudio, AudioBridge} = __audio;
const {PreferenceStore} = __storage;

const VERSION = '1.16.1';
// The game's worker's script (game-worker.js with its glue), which the
// release build puts here; the worker is made from a blob of it.
const GAME_WORKER = "((URL, setTimeout, clearTimeout, AbortController, Response, Blob, DecompressionStream, TextEncoder, TextDecoder) => {\n// The StarHermit runtime's browser entry with the engine's browser glue bundled in.\n// assets\nconst __assets = (() => {\n// Async I/O never retains a WASM memory view. Rust copies completed bytes itself.\n// Taken before a game's code runs: in the game's worker the game has its own\n// TextEncoder and timers (natives), which the fetcher must not call.\nconst TextEncoderNow = globalThis.TextEncoder;\nconst setTimeoutNow = globalThis.setTimeout.bind(globalThis), clearTimeoutNow = globalThis.clearTimeout.bind(globalThis);\nclass AssetFetcher {\n  constructor({baseURL = new URL('.', globalThis.location?.href || 'http://localhost/').href, fetch: fetcher = globalThis.fetch,\n    maxRequests = 32, maxBytes = 64 * 1024 * 1024, maxReadBytes = 16 * 1024 * 1024,\n    timeoutMs = 10000, onReady = () => {}} = {}) {\n    if (![maxRequests, maxBytes, maxReadBytes, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid asset fetch budget');\n    this.base = new URL(baseURL); if (!['http:', 'https:', 'file:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('Invalid asset base URL');\n    if (!this.base.pathname.endsWith('/')) this.base.pathname += '/';\n    this.fetcher = fetcher.bind(globalThis); this.maxRequests = maxRequests; this.maxBytes = maxBytes; this.maxReadBytes = maxReadBytes; this.timeoutMs = timeoutMs; this.onReady = onReady;\n    this.requests = new Map(); this.reservedBytes = 0; this.nextId = 1; this.closed = false;\n  }\n  begin(path, limit) {\n    if (this.closed) throw new Error('Asset source is closed');\n    if (typeof path !== 'string' || !path.length || new TextEncoderNow().encode(path).length > 4096 || /[\\\\:\\x00-\\x1f\\x7f-\\x9f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid asset path');\n    if (!Number.isSafeInteger(limit) || limit \x3c 0 || limit > this.maxReadBytes) throw new Error('Asset read byte budget exceeded');\n    // Download chunks and final assembly can coexist, so reserve twice the limit.\n    const reservation = 2 * limit;\n    if (this.requests.size >= this.maxRequests || reservation > this.maxBytes - this.reservedBytes) throw new Error('Asset fetch concurrency or memory budget exceeded');\n    const url = new URL(path.split('/').map(encodeURIComponent).join('/'), this.base);\n    if (this.nextId > 0xffffffff) throw new Error('Asset request identity exhausted');\n    const id = this.nextId++; const controller = new AbortController(); let rejectStop;\n    const stopped = new Promise((_, reject) => {rejectStop = reject;}); stopped.catch(() => {});\n    const record = {id, path, limit, controller, stopped, rejectStop, status: 0, error: '', data: null, reader: null, reservation};\n    this.requests.set(id, record); this.reservedBytes += reservation;\n    record.timer = setTimeoutNow(() => this.fail(record, new Error('Asset download deadline exceeded')), this.timeoutMs);\n    this.download(record, url).catch(error => this.fail(record, error));\n    return id;\n  }\n  current(record) {return this.requests.get(record.id) === record && record.status === 0;}\n  release(record, retained = 0) {this.reservedBytes += retained - record.reservation; record.reservation = retained;}\n  notify(record) {try {this.onReady(record.id);} catch {} }\n  fail(record, error) {\n    if (!this.current(record)) return;\n    record.status = 2; record.error = `Asset '${record.path}': ${String(error.message || error)}`.slice(0, 4096); clearTimeoutNow(record.timer); this.release(record);\n    record.rejectStop(error); record.controller.abort(); record.reader?.cancel().catch(() => {}); this.notify(record);\n  }\n  async wait(record, promise) {return Promise.race([promise, record.stopped]);}\n  async download(record, url) {\n    const response = await this.wait(record, this.fetcher(url.href, {signal:record.controller.signal, credentials:'omit', redirect:'error'}));\n    if (!this.current(record)) return;\n    if (!response.ok) throw new Error(`Asset download failed (${response.status})`);\n    if ((!response.headers.get('Content-Encoding') || response.headers.get('Content-Encoding') === 'identity') && Number(response.headers.get('Content-Length')) > record.limit) {response.body?.cancel().catch(() => {}); throw new Error('Asset download byte budget exceeded');}\n    const chunks = []; let total = 0;\n    if (response.body) {\n      const reader = response.body.getReader(); record.reader = reader;\n      try {\n        while (true) {\n          const {done, value} = await this.wait(record, reader.read());\n          if (done) break;\n          if (!(value instanceof Uint8Array)) throw new Error('Invalid asset response chunk');\n          total += value.byteLength;\n          if (total > record.limit) throw new Error('Asset download byte budget exceeded');\n          chunks.push(value);\n        }\n      } finally {\n        if (!this.current(record) || total > record.limit) reader.cancel().catch(() => {});\n        reader.releaseLock(); record.reader = null;\n      }\n    } else {\n      const bytes = new Uint8Array(await this.wait(record, response.arrayBuffer()));\n      total = bytes.byteLength; if (total > record.limit) throw new Error('Asset download byte budget exceeded'); chunks.push(bytes);\n    }\n    if (!this.current(record)) return;\n    const data = new Uint8Array(total); let offset = 0;\n    for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.byteLength;}\n    chunks.length = 0;\n    record.data = data; record.status = 1; clearTimeoutNow(record.timer); this.release(record, total); this.notify(record);\n  }\n  record(id) {const record = this.requests.get(id); if (!record) throw new Error('Unknown asset request'); return record;}\n  poll(id) {return this.record(id).status;}\n  length(id) {const record = this.record(id); if (record.status !== 1) throw new Error('Asset request is not ready'); return record.data.byteLength;}\n  copy(id, offset, destination) {\n    const record = this.record(id);\n    if (record.status !== 1 || !(destination instanceof Uint8Array) || destination.byteLength > 65536 || !Number.isSafeInteger(offset) || offset \x3c 0 || offset + destination.byteLength > record.data.byteLength) throw new Error('Invalid asset result range');\n    destination.set(record.data.subarray(offset, offset + destination.byteLength)); return destination.byteLength;\n  }\n  error(id) {return this.record(id).error;}\n  cancel(id) {\n    const record = this.requests.get(id); if (!record) return;\n    this.requests.delete(id); clearTimeoutNow(record.timer); this.release(record); record.data = null;\n    record.rejectStop(new Error('Asset request cancelled')); record.controller.abort(); record.reader?.cancel().catch(() => {});\n  }\n  close() {this.closed = true; for (const id of this.requests.keys()) this.cancel(id);}\n}\n\n// A single owned download for auxiliary modules; shares fetch deadlines,\n// streamed byte checks, URL policy and cancellation with runtime assets.\nasync function fetchAssetBytes(url,{fetch=globalThis.fetch,limit=16*1024*1024,timeoutMs=10000}={}) {\n  const resolved=new URL(url,globalThis.location?.href||'http://localhost/');\n  if(resolved.search||resolved.hash)throw new Error('Asset URL must not contain query or fragment');\n  const name=decodeURIComponent(resolved.pathname.slice(resolved.pathname.lastIndexOf('/')+1));\n  if(name.includes('/')||name.includes('\\\\'))throw new Error('Invalid asset file name');\n  let ready;const result=new Promise((resolve,reject)=>{ready={resolve,reject};});\n  const fetcher=new AssetFetcher({baseURL:new URL('.',resolved).href,fetch,maxRequests:1,maxBytes:2*limit,maxReadBytes:limit,timeoutMs,onReady:id=>{\n    const record=fetcher.record(id);if(record.status===1)ready.resolve(record.data);else ready.reject(new Error(record.error));\n  }});\n  try{fetcher.begin(name,limit);return await result;}finally{fetcher.close();}\n}\nreturn {AssetFetcher, fetchAssetBytes};\n})();\n// remote\nconst __remote = (() => {\n// Remote files in the game's worker: the package files a game's own hosts\n// serve (engine.remote.* in starhermit.txt), fetched for the runtime and\n// used only once their size and SHA-256 match the package's remote index.\n// Each object is fetched from the URLs the runtime gives, in order, without\n// cookies, credentials or referrer; a redirect may end only at an origin the\n// manifest allows (the page's Content-Security-Policy, connect-src, is the\n// browser's own gate before that). A compressed object (`.z`, zlib) is\n// inflated as it arrives, the result is counted against its indexed size,\n// hashed with Web Crypto and only then kept: in the origin's Cache Storage\n// (one cache per package), where later runs and offline play find it. The\n// runtime reads a ready file synchronously through FileReaderSync.\n// A cached object's key names its hash and size, so the keys alone list\n// what the cache holds.\n//\n// A stream (audio.stream) reads a remote file the index lists with its\n// pieces' hashes while it arrives: one request at a time, `Range:\n// bytes=N-` from the bases in order, first the pieces holding the file's\n// last 64 KiB, then from the first piece missing where the stream reads,\n// at most 16 pieces ahead of it. Each 256 KiB piece is checked against its\n// hash with Web Crypto before the stream reads it, a piece that fails asks\n// the next base, and checked pieces are kept in a second cache of the\n// package's (`… pieces`), so a later play or run reads them from there.\n// Once every piece is there they are joined into the object, checked as a\n// download is, and kept as one.\nconst KEY_ORIGIN = 'https://remote.starhermit.invalid/sha256/';\nconst keyURL = (key, size) => `${KEY_ORIGIN}${key}/${size}`;\nconst PIECE_ORIGIN = 'https://remote.starhermit.invalid/piece/';\nconst pieceURL = (key, size, index) => `${PIECE_ORIGIN}${key}/${size}/${index}`;\nconst PIECE = 256 * 1024, AHEAD = 16, MAX_PAGE = 27 + 255 + 255 * 255;\nconst HEX = /^[0-9a-f]{64}$/;\n// Taken as the worker starts, before a game's code could replace them: a\n// request's URLs are the runtime's (the manifest's bases), never a game's.\nconst parse = JSON.parse, isArray = Array.isArray, isHex = text => typeof text === 'string' && text.length === 64 && HEX.test(text);\nconst LOOPBACK = /^http:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]{1,5})?\\//;\nconst isURL = text => typeof text === 'string' && text.length \x3c= 2048 && (text.startsWith('https://') || LOOPBACK.test(text));\n\nclass RemoteFetcher {\n  // At most `maxActive` downloads run at once (a host's connections); the\n  // others wait their turn.\n  constructor({cacheName, fetch: fetcher, caches: cacheStorage = null, subtle, Reader, onChange = () => {}, maxRequests = 65536, maxActive = 6}) {\n    this.cacheName = String(cacheName); this.fetcher = fetcher; this.cacheStorage = cacheStorage; this.digest = subtle.digest.bind(subtle);\n    this.Reader = Reader; this.onChange = onChange; this.maxRequests = maxRequests; this.maxActive = maxActive;\n    this.cache = null; this.cachedKeys = new Map(); this.blobs = new Map(); this.requests = new Map(); this.nextId = 1;\n    this.waiting = []; this.active = 0;\n    this.pieceCache = null; this.pieceKeys = new Map(); this.streams = new Map(); this.nextStream = 1;\n  }\n  // The cache's keys and sizes, before the game starts (an unusable cache\n  // means downloads are kept for this run only).\n  async open() {\n    try {\n      if (!this.cacheStorage) return;\n      this.cache = await this.cacheStorage.open(this.cacheName);\n      for (const request of await this.cache.keys()) {\n        const url = String(request.url), [key, size] = url.slice(KEY_ORIGIN.length).split('/');\n        if (url.startsWith(KEY_ORIGIN) && HEX.test(key ?? '') && /^[0-9]{1,16}$/.test(size ?? '')) this.cachedKeys.set(key, Number(size));\n        else await this.cache.delete(request);\n      }\n    } catch { this.cache = null; this.cachedKeys.clear(); }\n    // Streamed files' pieces: which each file has, by key and size.\n    try {\n      this.pieceCache = await this.cacheStorage.open(`${this.cacheName} pieces`);\n      for (const request of await this.pieceCache.keys()) {\n        const url = String(request.url), [key, size, index] = url.slice(PIECE_ORIGIN.length).split('/');\n        if (url.startsWith(PIECE_ORIGIN) && HEX.test(key ?? '') && /^[0-9]{1,16}$/.test(size ?? '') && /^[0-9]{1,8}$/.test(index ?? '')) {\n          const id = `${key}/${size}`;\n          if (!this.pieceKeys.has(id)) this.pieceKeys.set(id, new Set());\n          this.pieceKeys.get(id).add(Number(index));\n        } else await this.pieceCache.delete(request);\n      }\n    } catch { this.pieceCache = null; this.pieceKeys.clear(); }\n  }\n  // Removes the cached objects the package no longer lists, and pieces of\n  // files it no longer lists or that are whole.\n  async keepOnly(keys) {\n    const keep = new Set(keys);\n    for (const key of [...this.cachedKeys.keys()]) {\n      if (keep.has(key)) continue;\n      const size = this.cachedKeys.get(key);\n      this.cachedKeys.delete(key);\n      try { await this.cache?.delete(keyURL(key, size)); } catch {}\n    }\n    for (const id of [...this.pieceKeys.keys()]) {\n      const [key, size] = id.split('/');\n      if (keep.has(key) && this.cachedKeys.get(key) !== Number(size)) continue;\n      await this.dropPieces(key, Number(size));\n    }\n  }\n  async dropPieces(key, size) {\n    const indices = this.pieceKeys.get(`${key}/${size}`) ?? new Set();\n    this.pieceKeys.delete(`${key}/${size}`);\n    for (const index of indices) { try { await this.pieceCache?.delete(pieceURL(key, size, index)); } catch {} }\n  }\n  cached(key, size) { return this.cachedKeys.get(key) === size || this.blobs.get(key)?.size === size; }\n  begin(text) {\n    const request = parse(text);\n    const {key, size, stored, urls, origins} = request;\n    if (!isHex(key) || !Number.isSafeInteger(size) || size \x3c 0 || !(stored === null || (Number.isSafeInteger(stored) && stored > 0))\n      || !isArray(urls) || !urls.length || urls.length > 4 || !isArray(origins)) throw new Error('Invalid remote file request');\n    for (let index = 0; index \x3c urls.length; index++) if (!isURL(urls[index])) throw new Error('Invalid remote file URL');\n    if (this.requests.size >= this.maxRequests) throw new Error('Too many remote files are being fetched at once');\n    const id = this.nextId++;\n    const record = {id, key, size, stored, urls, origins: new Set(origins), state: 0, loaded: 0, error: '', controller: new AbortController()};\n    this.requests.set(id, record);\n    this.waiting.push(record);\n    this.pump();\n    return id;\n  }\n  pump() {\n    while (this.active \x3c this.maxActive && this.waiting.length) {\n      const record = this.waiting.shift();\n      if (this.requests.get(record.id) !== record) continue;\n      this.active++;\n      this.run(record).then(() => { record.state = 1; }, error => { record.state = 2; record.error = String(error?.message ?? error).slice(0, 2048); })\n        .finally(() => { this.active--; this.pump(); try { this.onChange(); } catch {} });\n    }\n  }\n  async run(record) {\n    // In the cache: ready once its blob is at hand.\n    if (this.cache && this.cachedKeys.get(record.key) === record.size) {\n      try {\n        const response = await this.cache.match(keyURL(record.key, record.size));\n        const blob = response && await response.blob();\n        if (blob && blob.size === record.size) { this.blobs.set(record.key, blob); record.loaded = record.stored ?? record.size; return; }\n      } catch {}\n      this.cachedKeys.delete(record.key);\n    }\n    const errors = [];\n    for (let index = 0; index \x3c record.urls.length; index++) {\n      const url = record.urls[index];\n      try {\n        const bytes = await this.download(record, url);\n        await this.check(record, bytes);\n        const blob = new Blob([bytes]);\n        this.blobs.set(record.key, blob);\n        if (this.cache) {\n          try {\n            await this.cache.put(keyURL(record.key, record.size), new Response(blob, {headers: {'content-type': 'application/octet-stream'}}));\n            this.cachedKeys.set(record.key, record.size);\n            // The cache's copy (on disk) in place of the bytes in memory.\n            const kept = await (await this.cache.match(keyURL(record.key, record.size)))?.blob();\n            if (kept?.size === record.size) this.blobs.set(record.key, kept);\n          } catch {}\n        }\n        return;\n      } catch (error) {\n        errors.push(`${url}: ${String(error?.message ?? error)}`);\n        record.loaded = 0;\n      }\n    }\n    throw new Error(errors.join('; '));\n  }\n  async download(record, url) {\n    const transfer = record.stored ?? record.size;\n    const response = await this.fetcher(url, {credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', mode: 'cors', cache: 'no-store', signal: record.controller.signal});\n    const final = new URL(response.url || url);\n    if (!record.origins.has(final.origin)) { response.body?.cancel().catch(() => {}); throw new Error(`redirected to ${final.origin}, which starhermit.txt does not allow`); }\n    if (!response.ok) { response.body?.cancel().catch(() => {}); throw new Error(`HTTP ${response.status}`); }\n    const declared = response.headers.get('content-encoding');\n    if ((!declared || declared === 'identity') && Number(response.headers.get('content-length')) > transfer) { response.body?.cancel().catch(() => {}); throw new Error('the host sends more bytes than the package\\'s index lists'); }\n    const reader = response.body.getReader(); const chunks = []; let total = 0;\n    try {\n      while (true) {\n        const {done, value} = await reader.read();\n        if (done) break;\n        total += value.byteLength;\n        if (total > transfer) throw new Error('the host sends more bytes than the package\\'s index lists');\n        chunks.push(value); record.loaded = total;\n      }\n    } finally { reader.releaseLock(); }\n    if (total !== transfer) throw new Error(`the host sent ${total} bytes where the package's index lists ${transfer}`);\n    const object = new Uint8Array(total); let at = 0;\n    for (const chunk of chunks) { object.set(chunk, at); at += chunk.byteLength; }\n    if (record.stored === null) return object;\n    // A zlib stream, inflated no further than the file's indexed size.\n    const inflated = new Blob([object]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();\n    const out = new Uint8Array(record.size); let length = 0;\n    while (true) {\n      const {done, value} = await inflated.read();\n      if (done) break;\n      if (length + value.byteLength > record.size) { inflated.cancel().catch(() => {}); throw new Error('the compressed object inflates past its indexed size'); }\n      out.set(value, length); length += value.byteLength;\n    }\n    if (length !== record.size) throw new Error('the compressed object inflates short of its indexed size');\n    return out;\n  }\n  async check(record, bytes) {\n    if (bytes.byteLength !== record.size) throw new Error('the host sent other bytes than the package\\'s index pins');\n    const digest = new Uint8Array(await this.digest('SHA-256', bytes));\n    const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');\n    if (hex !== record.key) throw new Error('the host sent other bytes than the package\\'s index pins');\n  }\n  record(id) { const record = this.requests.get(id); if (!record) throw new Error('Unknown remote file request'); return record; }\n  state(id) { return this.record(id).state; }\n  loaded(id) { return this.record(id).loaded; }\n  error(id) { return this.record(id).error; }\n  release(id) { const record = this.requests.get(id); if (!record) return; if (record.state === 0) record.controller.abort(); this.requests.delete(id); }\n  // A ready file's bytes, now.\n  read(key, size, destination) {\n    const blob = this.blobs.get(key);\n    if (!blob || blob.size !== size || destination.byteLength !== size) throw new Error('The remote file is not ready');\n    destination.set(new Uint8Array(new this.Reader().readAsArrayBuffer(blob)));\n    return 1;\n  }\n  // -- Streams --------------------------------------------------------------\n  streamOpen(text) {\n    const request = parse(text);\n    const {key, size, urls, origins, chunks} = request;\n    if (!isHex(key) || !Number.isSafeInteger(size) || size \x3c= 0 || !isArray(urls) || !urls.length || urls.length > 4 || !isArray(origins)\n      || !isArray(chunks) || chunks.length !== Math.ceil(size / PIECE) || !chunks.every(isHex)) throw new Error('Invalid stream request');\n    for (let index = 0; index \x3c urls.length; index++) if (!isURL(urls[index])) throw new Error('Invalid remote file URL');\n    if (this.streams.size >= 16) throw new Error('Too many streams at once');\n    const id = this.nextStream++;\n    const count = chunks.length;\n    const record = {id, key, size, urls, origins: new Set(origins), hashes: chunks, have: new Uint8Array(count), blobs: new Map(), count: 0,\n      want: 0, running: false, tail: false, wholeOnly: false, error: '', joined: false, closed: false, last: null, controller: null, loading: 0,\n      base: 0, failures: []};\n    this.streams.set(id, record);\n    if (this.cachedKeys.get(key) === size) record.joined = true;\n    // Pieces earlier plays kept, each made readable as it loads.\n    const kept = this.pieceKeys.get(`${key}/${size}`);\n    if (kept && this.pieceCache && !record.joined) {\n      for (const index of kept) {\n        if (index >= count) continue;\n        record.loading++;\n        this.pieceCache.match(pieceURL(key, size, index)).then(response => response?.blob()).then(blob => {\n          if (blob && blob.size === this.pieceLength(record, index) && !record.have[index]) { record.blobs.set(index, blob); record.have[index] = 1; record.count++; }\n        }).catch(() => {}).finally(() => { record.loading--; this.changed(); });\n      }\n    }\n    return id;\n  }\n  pieceLength(record, index) { return Math.min(PIECE, record.size - index * PIECE); }\n  stream(id) { const record = this.streams.get(id); if (!record) throw new Error('Unknown stream'); return record; }\n  changed() { try { this.onChange(); } catch {} }\n  streamWant(id, offset) {\n    const record = this.stream(id);\n    record.want = Math.floor(offset / PIECE);\n    this.streamPump(record);\n  }\n  streamAvailable(id, offset) {\n    const record = this.stream(id);\n    if (record.joined) return this.blobs.get(record.key)?.size === record.size ? Math.max(0, record.size - offset) : 0;\n    let index = Math.floor(offset / PIECE), end = offset;\n    while (index \x3c record.have.length && record.have[index]) { index++; end = Math.min(index * PIECE, record.size); }\n    return Math.max(0, end - offset);\n  }\n  streamRead(id, offset, destination) {\n    const record = this.stream(id), length = destination.byteLength;\n    if (record.joined) {\n      const blob = this.blobs.get(record.key);\n      if (!blob || blob.size !== record.size || offset + length > record.size) return 0;\n      destination.set(new Uint8Array(new this.Reader().readAsArrayBuffer(blob.slice(offset, offset + length))));\n      return 1;\n    }\n    let done = 0;\n    while (done \x3c length) {\n      const at = offset + done, index = Math.floor(at / PIECE);\n      if (!record.have[index]) return 0;\n      if (record.last?.index !== index) record.last = {index, bytes: new Uint8Array(new this.Reader().readAsArrayBuffer(record.blobs.get(index)))};\n      const within = at - index * PIECE, take = Math.min(record.last.bytes.length - within, length - done);\n      destination.set(record.last.bytes.subarray(within, within + take), done);\n      done += take;\n    }\n    // The window ahead follows the reader.\n    record.want = Math.floor(offset / PIECE);\n    this.streamPump(record);\n    return 1;\n  }\n  streamProgress(id) {\n    const record = this.stream(id);\n    return record.joined ? 1 : record.count / record.have.length;\n  }\n  streamError(id) { return this.stream(id).error; }\n  streamClose(id) {\n    const record = this.streams.get(id);\n    if (!record) return;\n    record.closed = true;\n    record.controller?.abort();\n    this.streams.delete(id);\n  }\n  // The next piece to ask for, if any.\n  nextPiece(record) {\n    const count = record.have.length;\n    if (!record.tail) {\n      record.tail = true;\n      const first = Math.floor(Math.max(0, record.size - MAX_PAGE) / PIECE);\n      for (let index = first; index \x3c count; index++) if (!record.have[index]) return index;\n    }\n    const end = Math.min(count, record.want + AHEAD);\n    for (let index = record.want; index \x3c end; index++) if (!record.have[index]) return index;\n    return -1;\n  }\n  streamPump(record) {\n    if (record.running || record.joined || record.error || record.closed || record.loading) return;\n    if (record.count === record.have.length) { record.running = true; this.join(record).finally(() => { record.running = false; this.changed(); }); return; }\n    const first = this.nextPiece(record);\n    if (first \x3c 0) return;\n    record.running = true;\n    // A piece that fails asks the next base for it; one no base serves as\n    // pinned fails the stream.\n    this.fetchPieces(record, first).then(\n      () => { record.failures = []; },\n      error => {\n        if (record.closed) return;\n        record.failures.push(`${record.urls[record.base]}: ${String(error?.message ?? error)}`);\n        record.base++;\n        if (record.base >= record.urls.length) record.error = record.failures.join('; ').slice(0, 2048);\n      },\n    ).finally(() => { record.running = false; this.changed(); if (!record.closed) this.streamPump(record); });\n  }\n  // One request from piece `first` on, its pieces checked and kept as they\n  // complete; it stops past the reader's window or at a kept piece.\n  async fetchPieces(record, first) {\n    const url = record.urls[record.base], from = first * PIECE;\n    const controller = record.controller = new AbortController();\n    const init = {credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', mode: 'cors', cache: 'no-store', signal: controller.signal};\n    if (from > 0) init.headers = {Range: `bytes=${from}-`};\n    const response = await this.fetcher(url, init);\n    const final = new URL(response.url || url);\n    if (!record.origins.has(final.origin)) { response.body?.cancel().catch(() => {}); throw new Error(`redirected to ${final.origin}, which starhermit.txt does not allow`); }\n    if (response.status !== 200 && response.status !== 206) { response.body?.cancel().catch(() => {}); throw new Error(`HTTP ${response.status}`); }\n    // A host without ranges sends the whole file: read on from its start.\n    let next = response.status === 206 ? first : 0;\n    if (response.status === 200 && first > 0) record.wholeOnly = true;\n    const reader = response.body.getReader();\n    let parts = [], held = 0;\n    const tail = Math.floor(Math.max(0, record.size - MAX_PAGE) / PIECE);\n    try {\n      while (next \x3c record.have.length) {\n        const length = this.pieceLength(record, next);\n        while (held \x3c length) {\n          const {done, value} = await reader.read();\n          if (done) { if (held || next \x3c record.have.length) throw new Error('the host sent less than the package\\'s index lists'); return; }\n          parts.push(value); held += value.byteLength;\n        }\n        const joined = new Uint8Array(held); let at = 0;\n        for (const part of parts) { joined.set(part, at); at += part.byteLength; }\n        const piece = joined.subarray(0, length);\n        const digest = new Uint8Array(await this.digest('SHA-256', piece));\n        const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');\n        if (hex !== record.hashes[next]) throw new Error('the host sent other bytes than the package\\'s index pins');\n        if (!record.have[next]) {\n          const blob = new Blob([piece]);\n          record.blobs.set(next, blob); record.have[next] = 1; record.count++;\n          const id = `${record.key}/${record.size}`;\n          if (!this.pieceKeys.has(id)) this.pieceKeys.set(id, new Set());\n          this.pieceKeys.get(id).add(next);\n          this.pieceCache?.put(pieceURL(record.key, record.size, next), new Response(blob, {headers: {'content-type': 'application/octet-stream'}})).catch(() => {});\n          this.changed();\n        }\n        parts = held > length ? [joined.slice(length)] : []; held -= length;\n        next++;\n        const past = (next >= record.want + AHEAD || record.have[next]) && next \x3c tail;\n        if (record.closed || (!record.wholeOnly && past)) { reader.cancel().catch(() => {}); return; }\n      }\n      if (held) throw new Error('the host sends more bytes than the package\\'s index lists');\n    } finally { reader.releaseLock?.(); record.controller = null; }\n  }\n  // Every piece is there: joined into the object, checked, kept as one.\n  async join(record) {\n    const parts = [];\n    for (let index = 0; index \x3c record.have.length; index++) parts.push(record.blobs.get(index));\n    const blob = new Blob(parts);\n    const bytes = new Uint8Array(await blob.arrayBuffer());\n    try { await this.check(record, bytes); } catch (error) { record.error = `its pieces do not make the file the package pins: ${error.message}`; return; }\n    this.blobs.set(record.key, blob);\n    if (this.cache) {\n      try {\n        await this.cache.put(keyURL(record.key, record.size), new Response(blob, {headers: {'content-type': 'application/octet-stream'}}));\n        this.cachedKeys.set(record.key, record.size);\n        const kept = await (await this.cache.match(keyURL(record.key, record.size)))?.blob();\n        if (kept?.size === record.size) this.blobs.set(record.key, kept);\n      } catch {}\n    }\n    record.joined = true; record.blobs.clear(); record.last = null;\n    await this.dropPieces(record.key, record.size);\n  }\n  // `destination.byteLength` bytes of a ready file from `offset`, now: a\n  // slice of its blob, so the rest of the file is not read.\n  readRange(key, size, offset, destination) {\n    const blob = this.blobs.get(key), end = offset + destination.byteLength;\n    if (!blob || blob.size !== size || !Number.isSafeInteger(offset) || offset \x3c 0 || end > size) throw new Error('The remote file is not ready');\n    destination.set(new Uint8Array(new this.Reader().readAsArrayBuffer(blob.slice(offset, end))));\n    return 1;\n  }\n}\nreturn {RemoteFetcher};\n})();\n// storage\nconst __storage = (() => {\n// Browser preference snapshots are opaque Rust-validated bytes, not game progress.\nclass PreferenceStore {\n  constructor({indexedDB = globalThis.indexedDB, storage = globalThis.navigator?.storage, maxBytes = 4 * 1024 * 1024, timeoutMs = 2000, onStatus = () => {}} = {}) {\n    this.timeoutMs = timeoutMs; this.storage = storage; this.persisted = false;\n    this.indexedDB = indexedDB; this.maxBytes = maxBytes; this.onStatus = onStatus; this.memory = new Map(); this.status = 'session-only'; this.database = null; this.pending = new Map(); this.writing = null;\n  }\n  async open() {\n    try {\n      if (!this.indexedDB) throw new Error('IndexedDB unavailable');\n      this.database = await new Promise((resolve, reject) => {\n        const request = this.indexedDB.open('starhermit-engine-preferences-v1', 1);\n        let finished = false;\n        const fail = error => { finished = true; clearTimeout(timer); reject(error); };\n        const timer = setTimeout(() => fail(new Error('Preference storage timed out')), this.timeoutMs);\n        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots'); };\n        request.onsuccess = () => { clearTimeout(timer); if (finished) { request.result.close(); return; } finished = true; resolve(request.result); };\n        request.onerror = () => fail(request.error);\n        request.onblocked = () => fail(new Error('Preference storage upgrade blocked'));\n      });\n      this.database.onversionchange = () => { this.database.close(); this.database = null; this.setStatus('session-only', 'Storage version changed'); };\n      this.setStatus('persistent');\n      // Whether the browser may evict it; asked without prompting, and not\n      // awaited (preferences hydrate before the window opens).\n      Promise.resolve(this.storage?.persisted?.()).then(persisted => { this.persisted = Boolean(persisted); }, () => {});\n    } catch (error) { this.setStatus('session-only', error.message); }\n    return this;\n  }\n  setStatus(status, reason = '') { this.status = status; this.reason = reason; this.onStatus({status, reason}); }\n  async transaction(mode, operation) {\n    if (!this.database) throw new Error('Persistent preference storage is unavailable');\n    const database = this.database;\n    return new Promise((resolve, reject) => {\n      let transaction;\n      try { transaction = database.transaction('snapshots', mode, {durability: 'strict'}); }\n      catch { transaction = database.transaction('snapshots', mode); }\n      let value; const timer = setTimeout(() => { try { transaction.abort(); } catch {} reject(new Error('Preference transaction timed out')); }, this.timeoutMs);\n      try { operation(transaction.objectStore('snapshots'), result => { value = result; }); }\n      catch (error) { clearTimeout(timer); try { transaction.abort(); } catch {} reject(error); return; }\n      transaction.oncomplete = () => { clearTimeout(timer); resolve(value); };\n      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error('Preference transaction failed')); };\n    });\n  }\n  // `fresh` reads the database even when this page holds a copy: another\n  // tab may have written since (a takeover hands the partition over).\n  async load(key, {fresh = false} = {}) {\n    if (this.memory.has(key) && !(fresh && this.database)) return this.memory.get(key).slice();\n    if (!this.database) return null;\n    try {\n      const value = await this.transaction('readonly', (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result); });\n      if (value === undefined) return null;\n      if (!(value instanceof ArrayBuffer) || value.byteLength > this.maxBytes) throw new Error('Invalid preference snapshot or byte budget exceeded');\n      const bytes = new Uint8Array(value); this.validate(key, bytes); this.memory.set(key, bytes); return bytes.slice();\n    } catch (error) {\n      // A failed read is not an empty cache. Block overwriting that persistent\n      // partition and let the player continue with session-only preferences.\n      this.setStatus('session-only', error.message); this.database?.close(); this.database = null; throw error;\n    }\n  }\n  validate(key, bytes) {\n    if (typeof key !== 'string' || !key.length || key.length > 4096) throw new Error('Invalid preference partition');\n    if (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxBytes) throw new Error('Preference snapshot byte budget exceeded');\n    if (!this.memory.has(key) && this.memory.size >= 32) throw new Error('Preference partition budget exceeded');\n    let total = bytes.byteLength;\n    for (const [other, value] of this.memory) if (other !== key) total += value.byteLength;\n    if (total > 16 * 1024 * 1024) throw new Error('Preference session byte budget exceeded');\n  }\n  async save(key, bytes) {\n    this.validate(key, bytes);\n    this.memory.set(key, bytes.slice());\n    if (!this.database) return;\n    try { await this.transaction('readwrite', store => store.put(bytes.slice().buffer, key)); }\n    catch (error) { this.setStatus('session-only', error.message); this.database?.close(); this.database = null; }\n  }\n  // Writes in order, one at a time; while one is in flight, each partition's\n  // newest queued snapshot replaces its older one (a game's exit write may\n  // queue several partitions at once).\n  queue(key, bytes) {\n    this.validate(key, bytes);\n    this.pending.delete(key); this.pending.set(key, bytes.slice());\n    if (!this.writing) {\n      this.writing = (async () => { while (this.pending.size) { const [key, bytes] = this.pending.entries().next().value; this.pending.delete(key); await this.save(key, bytes); } })()\n        .finally(() => { this.writing = null; });\n    }\n    return this.writing;\n  }\n  async flush() { if (this.writing) await this.writing; }\n  // Drops a partition's queued snapshot that has not started (the game's\n  // worker writes a newer one itself as the game quits).\n  forget(key) { this.pending.delete(key); }\n  close() { this.database?.close(); this.database = null; }\n}\nreturn {PreferenceStore};\n})();\n// saves\nconst __saves = (() => {\n// Durable browser save slots: one IndexedDB record per partition and slot,\n// mirrored in memory so the game reads synchronously. Writes apply to memory\n// at once and persist in order; a failed write reports session-only status\n// and the cloud copy stays the durable one.\nconst SLOTS = ['current', 'previous', 'remote', 'record'];\n\nclass SaveSlots {\n  constructor({indexedDB = globalThis.indexedDB, storage = globalThis.navigator?.storage, maxSlotBytes = 16 * 1024 * 1024,\n    maxPartitionBytes = 48 * 1024 * 1024, timeoutMs = 5000, onStatus = () => {}} = {}) {\n    this.indexedDB = indexedDB; this.storage = storage; this.maxSlotBytes = maxSlotBytes; this.maxPartitionBytes = maxPartitionBytes;\n    this.timeoutMs = timeoutMs; this.onStatus = onStatus; this.database = null; this.partition = null; this.slots = new Map(); this.memory = new Map();\n    this.status = 'session-only'; this.reason = ''; this.persisted = false; this.readFailed = true; this.queue = Promise.resolve(); this.generation = 0;\n    this.retired = false;\n  }\n  // Writes a partition's slots (`[slot, bytes or null]`) in one transaction\n  // without opening it: the game's worker, as the game quits, writes the\n  // slots with its last save itself (the page takes no more of its\n  // messages and drops its own writes still waiting: `retire`).\n  static async keep(partition, entries, {indexedDB = globalThis.indexedDB, timeoutMs = 5000} = {}) {\n    const slots = new SaveSlots({indexedDB, storage: null, timeoutMs});\n    try {\n      await slots.connect();\n      await slots.transaction('readwrite', store => {\n        for (const [slot, bytes] of entries) {\n          if (!SLOTS.includes(slot)) continue;\n          const key = `${partition}\\n${slot}`;\n          if (bytes instanceof Uint8Array) store.put(bytes.slice().buffer, key); else store.delete(key);\n        }\n      });\n    } finally { slots.close(); }\n  }\n  // The game's worker writes the slots as the game quits: writes waiting\n  // here (older) are dropped, until a partition opens again.\n  retire() { this.retired = true; }\n  setStatus(status, reason = '') { this.status = status; this.reason = reason; try { this.onStatus({status, reason, persisted: this.persisted}); } catch {} }\n  async connect() {\n    if (this.database || !this.indexedDB) return this.database;\n    this.database = await new Promise((resolve, reject) => {\n      const request = this.indexedDB.open('starhermit-engine-saves-v1', 1); let finished = false;\n      const fail = error => { if (finished) return; finished = true; clearTimeout(timer); reject(error); };\n      const timer = setTimeout(() => fail(new Error('Save storage timed out')), this.timeoutMs);\n      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('slots')) request.result.createObjectStore('slots'); };\n      request.onsuccess = () => { clearTimeout(timer); if (finished) { request.result.close(); return; } finished = true; resolve(request.result); };\n      request.onerror = () => fail(request.error || new Error('Save storage failed to open'));\n      request.onblocked = () => fail(new Error('Save storage upgrade blocked'));\n    });\n    this.database.onversionchange = () => { this.database?.close(); this.database = null; this.setStatus('session-only', 'Save storage version changed'); };\n    return this.database;\n  }\n  transaction(mode, operation) {\n    const database = this.database; if (!database) return Promise.reject(new Error('Save storage is unavailable'));\n    return new Promise((resolve, reject) => {\n      let transaction; try { transaction = database.transaction('slots', mode, {durability: 'strict'}); } catch { transaction = database.transaction('slots', mode); }\n      const results = []; const timer = setTimeout(() => { try { transaction.abort(); } catch {} reject(new Error('Save transaction timed out')); }, this.timeoutMs);\n      try { operation(transaction.objectStore('slots'), results); } catch (error) { clearTimeout(timer); try { transaction.abort(); } catch {} reject(error); return; }\n      transaction.oncomplete = () => { clearTimeout(timer); resolve(results); };\n      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error('Save transaction failed')); };\n    });\n  }\n  // Opens one partition (environment/game/account); its slots load into memory.\n  async open(partition) {\n    if (typeof partition !== 'string' || !partition.length || partition.length > 512 || /[\\x00-\\x1f]/.test(partition)) throw new Error('Invalid save partition');\n    const generation = ++this.generation; this.partition = partition; this.retired = false;\n    // A newer open supersedes this one, which then fails without touching\n    // the shared database, slots or status: they belong to the newer open.\n    const superseded = () => generation !== this.generation;\n    const changed = () => new Error('Save partition changed while opening');\n    // Earlier writes land before this read; session-only partitions keep\n    // their in-memory slots across reopening.\n    await this.queue;\n    if (superseded()) throw changed();\n    if (!this.memory.has(partition)) { if (this.memory.size >= 8) this.memory.delete(this.memory.keys().next().value); this.memory.set(partition, new Map()); }\n    this.slots = this.memory.get(partition);\n    try {\n      await this.connect();\n      if (superseded()) throw changed();\n      if (!this.database) throw new Error('IndexedDB unavailable');\n      const values = await this.transaction('readonly', (store, results) => {\n        for (const slot of SLOTS) { const request = store.get(`${partition}\\n${slot}`); request.onsuccess = () => { results.push([slot, request.result]); }; }\n      });\n      if (superseded()) throw changed();\n      let total = 0; const loaded = new Map();\n      for (const [slot, value] of values) {\n        if (value === undefined) continue;\n        if (!(value instanceof ArrayBuffer) || value.byteLength > this.maxSlotBytes) throw new Error('Invalid stored save slot');\n        total += value.byteLength; loaded.set(slot, new Uint8Array(value));\n      }\n      if (total > this.maxPartitionBytes) throw new Error('Stored saves exceed their byte budget');\n      this.memory.set(partition, loaded); this.slots = loaded;\n      // Persistence is requested best effort; a browser that never answers\n      // leaves the slots durable but evictable.\n      const answer = async () => Boolean(await this.storage?.persisted?.()) || Boolean(await this.storage?.persist?.());\n      let persisted = false; try { persisted = await Promise.race([answer(), new Promise(resolve => setTimeout(() => resolve(false), 2000))]); } catch {}\n      if (superseded()) throw changed();\n      this.persisted = persisted; this.setStatus('persistent');\n    } catch (error) {\n      if (superseded()) throw error;\n      // A failed read is not an empty slot: refuse to persist over it.\n      this.readFailed = true; this.database?.close(); this.database = null; this.setStatus('session-only', error.message);\n      throw error;\n    }\n    this.readFailed = false;\n  }\n  read(slot) { if (!SLOTS.includes(slot)) throw new Error('Unknown save slot'); return this.slots.get(slot) || null; }\n  write(slot, bytes) {\n    if (!SLOTS.includes(slot) || this.partition === null) throw new Error('No open save partition');\n    if (bytes !== null && (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxSlotBytes)) throw new Error('Save slot byte budget exceeded');\n    let total = bytes?.byteLength || 0; for (const [other, value] of this.slots) if (other !== slot) total += value.byteLength;\n    if (total > this.maxPartitionBytes) throw new Error('Save partition byte budget exceeded');\n    const copy = bytes && bytes.slice(); const key = `${this.partition}\\n${slot}`;\n    if (copy) this.slots.set(slot, copy); else this.slots.delete(slot);\n    if (!this.database || this.readFailed) return;\n    this.queue = this.queue.then(() => this.retired ? undefined : this.transaction('readwrite', store => copy ? store.put(copy.slice().buffer, key) : store.delete(key)))\n      .catch(error => { this.database?.close(); this.database = null; this.setStatus('session-only', error.message); });\n  }\n  flush() { return this.queue; }\n  close() { this.generation++; this.database?.close(); this.database = null; this.partition = null; this.slots = new Map(); this.memory = new Map(); }\n}\nreturn {SaveSlots};\n})();\n// game-worker\n// The game's worker: where a script game's code runs, in the browser's\n// JavaScript engine, beside the runtime's own module (the page's, started\n// here in its worker mode) that holds the game's host. `starhermit.js`\n// makes this worker from a blob of this script (a classic worker, so a\n// game's classic scripts load with importScripts) and sends it the\n// runtime's compiled module, its configuration and fonts, and the game's\n// start; after that the two exchange bytes only (ticks in, frames out).\n//\n// The game's modules are blob: modules the runtime makes from the game's\n// files (erased to JavaScript, their imports renamed to their modules'\n// URLs). Before any of the game's code runs, this script takes what it\n// needs of the worker's globals and removes from the game's reach what a\n// game has no use for: the network, storage, other workers and the\n// worker's own messaging. The built-in modules reach the runtime through\n// `__starhermitNative`, removed as soon as they loaded.\nconst {AssetFetcher} = __assets;\nconst {RemoteFetcher} = __remote;\nconst {PreferenceStore} = __storage;\nconst {SaveSlots} = __saves;\n\nconst G = globalThis;\nconst encoder = new TextEncoder(), decoder = new TextDecoder();\n// Taken before a game's code can change them.\nconst post = G.postMessage.bind(G);\nconst listen = G.addEventListener.bind(G);\nconst importScriptsNow = G.importScripts?.bind(G);\nconst fetchNow = G.fetch.bind(G);\nconst cachesNow = G.caches ?? null, subtleNow = G.crypto?.subtle, ReaderNow = G.FileReaderSync;\nconst indexedDBNow = G.indexedDB ?? null, closeNow = G.close.bind(G);\nconst Request = G.XMLHttpRequest;\nconst Channel = G.MessageChannel;\nconst PortNow = G.MessagePort, portPost = Function.prototype.call.bind(G.MessagePort.prototype.postMessage);\nconst makeURL = URL.createObjectURL.bind(URL);\nconst BlobNow = G.Blob;\nconst timeout = G.setTimeout.bind(G), clearTimer = G.clearTimeout.bind(G);\nconst randomFill = G.crypto.getRandomValues.bind(G.crypto);\nconst performanceNow = G.performance.now.bind(G.performance);\nconst ConsoleNow = {debug: console.debug.bind(console), log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console)};\nconst Registry = G.FinalizationRegistry;\nconst apply = Reflect.apply;\nconst functionText = Function.prototype.call.bind(Function.prototype.toString);\nconst isArray = Array.isArray, isView = ArrayBuffer.isView, json = JSON.stringify, parseJSON = JSON.parse;\nconst freeze = Object.freeze;\nconst dynamicImport = url => import(url);\nconst languages = [...(G.navigator?.languages?.length ? G.navigator.languages : [G.navigator?.language].filter(Boolean))];\n\n// The handle classes, by tag (the runtime's `Token::ALL` order and names;\n// bind.rs's tests hold the two together).\nconst TOKENS = ['scene node', 'material', 'geometry', 'texture', 'canvas', 'image bitmap', 'path', 'gradient', 'pattern',\n  'audio clip', 'sound', 'audio node', 'audio buffer', 'periodic wave', 'socket', 'sandbox', 'environment', 'table', 'kernel',\n  'scheduled kernel', 'event queue', 'worker', 'material program'];\nconst classes = TOKENS.map(name => ({[name]: class {}})[name]);\nconst handles = new WeakMap();\nconst released = [];\nconst registry = new Registry(held => released.push(held));\n// The typed array kinds, as `starhermit_script::TypedKind` orders them.\nconst TYPED = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];\n\n// The records natives hand back, by kind (`call::Record`'s order and\n// names; call.rs's tests hold the two together): fresh frozen objects made\n// from the runtime's numbers in place, each kind in one shape.\nconst RECORDS = [\n  (n, at) => freeze({x: n[at], y: n[at + 1], width: n[at + 2], height: n[at + 3]}),\n  (n, at) => freeze({x: n[at], y: n[at + 1], width: n[at + 2], height: n[at + 3], scrollTop: n[at + 4], scrollLeft: n[at + 5],\n    scrollHeight: n[at + 6], scrollWidth: n[at + 7], clientHeight: n[at + 8], clientWidth: n[at + 9]}),\n];\nconst RECORD_LENGTHS = [4, 10];\n\nlet instance = null, exportsOf = null, configBytes = new Uint8Array(0), fonts = [], faulted = false;\nlet scratch = new Uint8Array(0);\nconst inbox = [];\n// The running native's arguments, and the values made during the\n// outermost native call (or for a call the runtime makes into script).\nlet args = [], depth = 0, result, failure = null, pending = null;\nconst values = [];\nconst kept = new Map(); let nextKept = 1;\nconst lines = [];\nconst imports = new Map(); let nextImport = 1;\nconst reloads = new Set();\n\nfunction memory(ptr, length) {\n  const buffer = exportsOf.memory.buffer;\n  if (!Number.isInteger(ptr) || !Number.isInteger(length) || ptr \x3c 0 || length \x3c 0 || ptr + length > buffer.byteLength) throw new Error('Invalid worker memory range');\n  return new Uint8Array(buffer, ptr, length);\n}\nconst text = (ptr, length) => decoder.decode(memory(ptr, length));\n// The runtime's memory as numbers, made again when the memory grows.\nlet numbers = new Float64Array(0);\n/** `value_record`: a record of `kind` from the `count` numbers at `ptr` (-1 for no such record). */\nfunction record(kind, ptr, count) {\n  const make = RECORDS[kind], buffer = exportsOf.memory.buffer;\n  if (numbers.buffer !== buffer) numbers = new Float64Array(buffer);\n  const at = (ptr >>> 0) / 8;\n  if (!make || count !== RECORD_LENGTHS[kind] || !Number.isInteger(at) || at + count > numbers.length) return -1;\n  return pushValue(make(numbers, at));\n}\nfunction setScratch(bytes) { scratch = bytes; return bytes.length; }\nfunction slot(tag, payload) {\n  switch (tag) {\n    case 0: return undefined;\n    case 1: return null;\n    case 2: return payload !== 0;\n    case 3: return payload;\n    default: return values[payload];\n  }\n}\nfunction slots(ptr, count) {\n  const bytes = memory(ptr, count * 12), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];\n  for (let at = 0; at \x3c count; at++) out.push(slot(view.getUint32(at * 12, true), view.getFloat64(at * 12 + 4, true)));\n  return out;\n}\nconst pushValue = value => { values.push(value); return values.length - 1; };\nfunction bytesOf(value) {\n  if (value instanceof ArrayBuffer) return new Uint8Array(value);\n  if (isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);\n  return null;\n}\nfunction typedKind(value) {\n  for (let kind = 0; kind \x3c TYPED.length; kind++) if (value instanceof TYPED[kind]) return kind;\n  return -1;\n}\n/** An error the web's way: a DOMException name on an Error (internal.ts's domError). */\nfunction domError(name, message) {\n  switch (name) {\n    case 'TypeError': return new TypeError(message);\n    case 'RangeError': return new RangeError(message);\n    case 'SyntaxError': return new SyntaxError(message);\n    default: {\n      const error = new Error(message);\n      Object.defineProperty(error, 'name', {value: name, writable: true, configurable: true, enumerable: false});\n      return error;\n    }\n  }\n}\n/** An exception as the runtime reads it: \"message\\nstack\". */\nfunction described(error) {\n  let message = 'Uncaught exception', stack = '';\n  try {\n    if (error instanceof Error) { message = `${error.name}: ${error.message}`; stack = String(error.stack ?? ''); }\n    else message = `Uncaught ${String(error)}`;\n  } catch {}\n  return `${message.slice(0, 4096)}\\n${stack.slice(0, 16000)}`;\n}\n\n/** A game's call of native `id` (the built-in modules' `N`). */\nfunction callNative(id, argv) {\n  if (depth === 0) values.length = 0;\n  const saved = args;\n  depth++; args = argv; result = undefined; failure = null;\n  // A native that throws (an import's fault, a trap) leaves the runtime\n  // mid-call, its state lent out: the game ends there, with the native's\n  // error, rather than going on (a game that catches it) to a later fault\n  // that names something else.\n  try { exportsOf.sh_native(id); } catch (error) { fault(`The runtime stopped in a call of the game's: ${error?.message ?? error}`); throw error; }\n  finally { depth--; args = saved; }\n  if (failure !== null) {\n    const {kind, message} = failure; failure = null;\n    switch (kind) {\n      case 0: throw new TypeError(message);\n      case 1: throw new RangeError(message);\n      case 3: { const at = message.indexOf('\\n'); throw domError(message.slice(0, at), message.slice(at + 1)); }\n      case 4: { const error = pending; pending = null; throw error; }\n      default: throw new Error(message);\n    }\n  }\n  return result;\n}\n/** `loadClassic`: a classic script, evaluated in the worker's global scope. */\nfunction classic(name, source) {\n  const url = makeURL(new BlobNow([`${source}\\n//# sourceURL=${name}\\n`], {type: 'text/javascript'}));\n  importScriptsNow(url);\n}\n\nconst scriptImports = {\n  scratch_copy: (out, len) => memory(out, len).set(scratch.subarray(0, len)),\n  arg_count: () => args.length,\n  arg_kind: i => {\n    const value = args[i];\n    switch (typeof value) {\n      case 'undefined': return 0;\n      case 'boolean': return 2;\n      case 'number': return 3;\n      case 'string': return 4;\n      case 'symbol': return 5;\n      case 'function': return 7;\n      case 'bigint': return 8;\n      default: return value === null ? 1 : 6;\n    }\n  },\n  arg_number: i => { const value = args[i]; return typeof value === 'number' ? value : typeof value === 'boolean' ? (value ? 1 : 0) : NaN; },\n  // Bounds come as u32 (`>>> 0`: wasm hands them over as i32).\n  arg_text: (i, max) => { const value = args[i]; if (typeof value !== 'string') return -1; if (value.length > max >>> 0) return -2; return setScratch(encoder.encode(value)); },\n  // Into the runtime's own buffer, where its UTF-8 surely fits (three bytes a UTF-16 unit at most); else -3, and\n  // `arg_text` brings it.\n  arg_text_into: (i, max, out, capacity) => {\n    const value = args[i]; if (typeof value !== 'string') return -1; if (value.length > max >>> 0) return -2;\n    if (value.length * 3 > capacity >>> 0) return -3;\n    return encoder.encodeInto(value, memory(out >>> 0, capacity >>> 0)).written;\n  },\n  arg_function: i => { const value = args[i]; if (typeof value !== 'function') return -1; const id = nextKept++; kept.set(id, value); return id; },\n  arg_function_source: i => { const value = args[i]; if (typeof value !== 'function') return -1; try { return setScratch(encoder.encode(functionText(value))); } catch { return -1; } },\n  arg_host: i => { const found = handles.get(args[i]); return found ? found[0] : -1; },\n  arg_host_id: i => { const found = handles.get(args[i]); return found ? found[1] : -1; },\n  arg_copy: (i, out, len) => { const bytes = bytesOf(args[i]); if (!bytes || bytes.length !== len) return 0; memory(out, len).set(bytes); return 1; },\n  arg_byte_length: i => { const bytes = bytesOf(args[i]); return bytes ? bytes.length : -1; },\n  arg_typed: i => typedKind(args[i]),\n  arg_typed_write: (i, ptr, len) => { const bytes = bytesOf(args[i]); if (!bytes || bytes.length !== len) return 0; bytes.set(memory(ptr, len)); return 1; },\n  arg_numbers: (i, max) => {\n    const value = args[i]; max >>>= 0;\n    let numbers;\n    if (isArray(value)) {\n      if (value.length > max) return -2;\n      numbers = new Float64Array(value.length);\n      for (let k = 0; k \x3c value.length; k++) { const item = value[k]; if (typeof item !== 'number') return -(k + 3); numbers[k] = item; }\n    } else if (typedKind(value) >= 0) {\n      if (value.length > max) return -2;\n      numbers = Float64Array.from(value);\n    } else return -1;\n    return setScratch(new Uint8Array(numbers.buffer));\n  },\n  value_text: (ptr, len) => pushValue(text(ptr, len)),\n  value_json: (ptr, len) => { try { return pushValue(parseJSON(text(ptr, len))); } catch { return -1; } },\n  value_record: record,\n  value_array: (ptr, count) => pushValue(slots(ptr, count)),\n  value_f32s: (ptr, count) => pushValue(new Float32Array(memory(ptr, count * 4).slice().buffer)),\n  value_u8s: (ptr, len) => pushValue(memory(ptr, len).slice()),\n  value_token: (tag, id) => {\n    const Class = classes[tag]; if (!Class) throw new Error('Unknown handle class');\n    const handle = new Class(); handles.set(handle, [tag, id]); registry.register(handle, [tag, id]);\n    return pushValue(handle);\n  },\n  value_error: (ptr, len) => { const message = text(ptr, len); const at = message.indexOf('\\n'); return pushValue(domError(message.slice(0, at), message.slice(at + 1))); },\n  result: (tag, payload) => { result = slot(tag, payload); },\n  fail: (kind, ptr, len) => { failure = {kind, message: text(ptr, len)}; },\n  keep: (tag, payload) => { const id = nextKept++; kept.set(id, slot(tag, payload)); return id; },\n  kept_drop: id => { kept.delete(id); },\n  kept_call: (id, ptr, count) => {\n    const fn = kept.get(id), argv = slots(ptr, count);\n    try { return pushValue(apply(fn, undefined, argv)); } catch (error) { pending = error; return -1; }\n  },\n  kept_call_json: (id, ptr, len) => {\n    const fn = kept.get(id);\n    try { apply(fn, undefined, parseJSON(text(ptr, len))); return 0; } catch (error) { pending = error; return 1; }\n  },\n  kept_length: id => { const bytes = bytesOf(kept.get(id)); return bytes ? bytes.length : -1; },\n  kept_copy: (id, out, len) => { const bytes = bytesOf(kept.get(id)); if (!bytes || bytes.length !== len) return 0; memory(out, len).set(bytes); return 1; },\n  kept_write: (id, ptr, len) => { const bytes = bytesOf(kept.get(id)); if (!bytes || bytes.length !== len) return 0; bytes.set(memory(ptr, len)); return 1; },\n  pending_error: () => { if (pending === null) return -1; const error = pending; pending = null; return setScratch(encoder.encode(described(error))); },\n  released_take: () => {\n    if (!released.length) return -1;\n    const out = new Uint8Array(released.length * 12), view = new DataView(out.buffer);\n    released.forEach(([tag, id], at) => { view.setUint32(at * 12, tag, true); view.setFloat64(at * 12 + 4, id, true); });\n    released.length = 0;\n    return setScratch(out);\n  },\n  console_take: () => {\n    if (!lines.length) return -1;\n    // Each line: its level, its text and the stack frame that wrote it (both length-prefixed).\n    const parts = lines.splice(0).map(([level, line, frame]) => {\n      const bytes = encoder.encode(line), at = encoder.encode(frame || ''), out = new Uint8Array(9 + bytes.length + at.length), view = new DataView(out.buffer);\n      out[0] = level; view.setUint32(1, bytes.length, true); out.set(bytes, 5); view.setUint32(5 + bytes.length, at.length, true); out.set(at, 9 + bytes.length);\n      return out;\n    });\n    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0;\n    for (const part of parts) { out.set(part, at); at += part.length; }\n    return setScratch(out);\n  },\n  module_url: (pathPtr, pathLen, textPtr, textLen) => {\n    const name = text(pathPtr, pathLen), source = text(textPtr, textLen);\n    return setScratch(encoder.encode(makeURL(new BlobNow([`${source}\\n//# sourceURL=${name}\\n`], {type: 'text/javascript'}))));\n  },\n  module_import: (ptr, len) => {\n    const id = nextImport++, record = {state: 0, error: null}; imports.set(id, record);\n    dynamicImport(text(ptr, len)).then(() => { record.state = 1; }, error => { record.state = 2; record.error = error; })\n      .finally(() => { delete G.__starhermitNative; wake(); });\n    return id;\n  },\n  module_state: id => { const record = imports.get(id); if (!record) return 2; if (record.state === 2) pending = record.error; return record.state; },\n  worker_post: (ptr, len) => { const bytes = memory(ptr, len).slice(); post({bytes: bytes.buffer}, [bytes.buffer]); },\n  worker_next: () => inbox.length ? setScratch(inbox.shift()) : -1,\n  // As the game quits the page takes no more messages: the runtime writes\n  // the game's storage snapshots to the page's store (IndexedDB) from\n  // here, then closes the worker once they are written.\n  worker_keep: (keyPtr, keyLen, ptr, len) => {\n    const key = text(keyPtr, keyLen), bytes = memory(ptr, len).slice();\n    keeping = (keeping ?? new PreferenceStore({indexedDB: indexedDBNow, storage: null, maxBytes: 16 * 1024 * 1024}).open())\n      .then(store => { try { store.queue(key, bytes).catch(() => {}); } catch {} return store; });\n  },\n  // The game's save slots as it quits (the runtime checkpointed its last\n  // save on from the page's copy), written together as the worker closes.\n  worker_keep_save: (partitionPtr, partitionLen, slot, ptr, len, present) => {\n    const partition = text(partitionPtr, partitionLen), name = ['current', 'previous', 'remote', 'record'][slot];\n    if (!name) return;\n    if (saving?.partition !== partition) saving = {partition, slots: []};\n    saving.slots.push([name, present ? memory(ptr, len).slice() : null]);\n  },\n  // A request the game's quit leaves, for the page's courier (which adds\n  // the player's credential this worker never holds).\n  worker_send: (headPtr, headLen, ptr, len) => {\n    if (!courierPort) return;\n    const head = text(headPtr, headLen), body = memory(ptr, len).slice();\n    try { portPost(courierPort, {head, body}, [body.buffer]); } catch {}\n  },\n  worker_close: () => {\n    // The courier forgets the credential once it has these.\n    if (courierPort) { try { portPost(courierPort, {done: true}); } catch {} courierPort = null; }\n    const saved = saving ? SaveSlots.keep(saving.partition, saving.slots, {indexedDB: indexedDBNow}).catch(() => {}) : null;\n    Promise.all([Promise.resolve(keeping).then(store => store?.flush()).catch(() => {}), saved]).finally(() => closeNow());\n  },\n};\nlet keeping = null, saving = null, courierPort = null;\n\n// The runtime's imports beyond the engine's, as the page has them.\nconst runtimeImports = {\n  config_take: (out, capacity) => { if (capacity) memory(out, Math.min(capacity, configBytes.length)).set(configBytes.subarray(0, capacity)); return configBytes.length; },\n  font_length: index => fonts[index]?.length ?? 0,\n  font_copy: (index, out, length) => { const bytes = fonts[index]; if (!bytes || bytes.length !== length) return 0; memory(out, length).set(bytes); return 1; },\n  package_read_sync: (pathPtr, pathLength, out, size) => {\n    try {\n      const path = text(pathPtr, pathLength), request = new Request();\n      request.open('GET', new URL(path.split('/').map(encodeURIComponent).join('/'), packageBase), false);\n      request.responseType = 'arraybuffer';\n      request.send();\n      if (request.status !== 200) throw new Error(`${path} could not be read (HTTP ${request.status})`);\n      const bytes = new Uint8Array(request.response);\n      if (bytes.length !== size) throw new Error(`${path} is not the size the package's index gives`);\n      memory(out, size).set(bytes);\n      return 1;\n    } catch (error) { lastError = String(error.message || error); return 0; }\n  },\n  package_reload: (ptr, len) => { try { reloads.add(text(ptr, len)); } catch {} },\n  // Remote files (remote.mjs): fetched, checked and kept for the runtime.\n  remote_start: (ptr, len) => { try { return remote.begin(text(ptr, len)); } catch (error) { lastError = String(error.message || error); return 0; } },\n  remote_state: id => { try { return remote.state(id); } catch { return 2; } },\n  remote_loaded: id => { try { return remote.loaded(id); } catch { return 0; } },\n  remote_error: (id, out, capacity) => { try { const bytes = encoder.encode(remote.error(id)); const count = Math.min(bytes.length, capacity); memory(out, count).set(bytes.subarray(0, count)); return count; } catch { return 0; } },\n  remote_release: id => { try { remote.release(id); } catch {} },\n  remote_cached: (ptr, len, size) => { try { return remote.cached(text(ptr, len), size) ? 1 : 0; } catch { return 0; } },\n  remote_read: (ptr, len, out, size) => { try { return remote.read(text(ptr, len), size, memory(out, size)); } catch (error) { lastError = String(error.message || error); return 0; } },\n  remote_read_range: (ptr, len, size, offset, out, length) => { try { return remote.readRange(text(ptr, len), size, offset, memory(out, length)); } catch (error) { lastError = String(error.message || error); return 0; } },\n  remote_keep: (ptr, len) => { try { remote.keepOnly(parseJSON(text(ptr, len))).catch(() => {}); } catch {} },\n  // Streams (audio.stream): a remote file's pieces as they arrive, each\n  // checked before it is read.\n  stream_remote_open: (ptr, len) => { try { return remote.streamOpen(text(ptr, len)); } catch (error) { lastError = String(error.message || error); return 0; } },\n  stream_remote_available: (id, offset) => { try { return remote.streamAvailable(id, offset); } catch { return 0; } },\n  stream_remote_read: (id, offset, out, length) => { try { return remote.streamRead(id, offset, memory(out, length)); } catch { return 0; } },\n  stream_remote_want: (id, offset) => { try { remote.streamWant(id, offset); } catch {} },\n  stream_remote_progress: id => { try { return remote.streamProgress(id); } catch { return 0; } },\n  stream_remote_error: (id, out, capacity) => { try { const bytes = encoder.encode(remote.streamError(id)); const count = Math.min(bytes.length, capacity); memory(out, count).set(bytes.subarray(0, count)); return count; } catch { return 0; } },\n  stream_remote_close: id => { try { remote.streamClose(id); } catch {} },\n  console_line: (level, ptr, len) => { try { (level >= 3 ? ConsoleNow.error : level === 2 ? ConsoleNow.warn : level === 0 ? ConsoleNow.debug : ConsoleNow.log)(text(ptr, len)); } catch {} },\n  status_report: () => {},\n  game_worker_open: () => 0, game_worker_post: () => {}, game_worker_next: () => -1, game_worker_close: () => {},\n  game_worker_mark: () => 0, game_worker_heard: () => 0,\n};\n\nlet lastError = '', packageBase = '', assets = null, remote = null;\n// The engine's browser imports this worker needs (the clock, randomness,\n// errors, the package's files); the others have nothing to do here.\nfunction engineImports() {\n  const guard = (callback, failed = 0) => { try { return callback(); } catch (error) { lastError = String(error.message || error).slice(0, 4096); return failed; } };\n  return {\n    epoch_ms: () => Date.now(),\n    work_clock: () => performanceNow(),\n    random_fill: (out, len) => guard(() => { if (len > 65536) throw new Error('Randomness request exceeds Web Crypto limit'); randomFill(memory(out, len)); return 1; }),\n    reduced_motion: () => 0,\n    languages_take: (ptr, capacity) => guard(() => {\n      const bytes = encoder.encode(languages.slice(0, 64).join('\\n')); if (capacity === 0) return bytes.length;\n      if (capacity !== bytes.length) throw new Error('Language buffer mismatch');\n      memory(ptr, bytes.length).set(bytes); return bytes.length;\n    }),\n    // Straight into the runtime's memory: reading why the browser refused a buffer needs none.\n    error_copy: (out, capacity) => encoder.encodeInto(lastError, memory(out, capacity)).written,\n    report_error: (ptr, len) => fault(text(ptr, Math.min(len, 4096))),\n    report_note: (ptr, len) => { lastError = text(ptr, Math.min(len, 4096)); },\n    asset_request_begin: (ptr, len, limit) => guard(() => assets.begin(text(ptr, len), limit)),\n    asset_request_poll: id => guard(() => assets.poll(id), 2),\n    asset_request_length: id => guard(() => assets.length(id)),\n    asset_request_copy: (id, offset, ptr, len) => guard(() => assets.copy(id, offset, memory(ptr, len))),\n    asset_request_error: (id, ptr, capacity) => guard(() => { const bytes = encoder.encode(assets.error(id)); const count = Math.min(bytes.length, capacity); memory(ptr, count).set(bytes.subarray(0, count)); return count; }),\n    asset_request_cancel: id => assets.cancel(id),\n  };\n}\n\n/** The runtime's module stopped for good: the page shows why. As text,\n * which the page makes the runtime's message: a worker that stopped for\n * want of memory (a game that holds it all) may have none for a buffer. */\nfunction fault(message) {\n  if (faulted) return;\n  faulted = true;\n  post({fault: String(message).slice(0, 4096)});\n}\n/** Whether `error` is the browser refusing memory for a buffer (as\n * `outOfMemory` in host.mjs, which the page's runtime reads in a fault's\n * text). */\nfunction outOfMemory(error) {\n  return (error instanceof RangeError || error?.name === 'UnknownError') && /allocation failed|failed to allocate|out of memory/i.test(String(error.message));\n}\n\n// The runtime's turns: a page message, a settled import, or a hop the\n// runtime asked for (a call goes on in the next task, after the promise\n// reactions its last entry left).\nconst channel = new Channel();\nlet hopping = false;\nchannel.port1.onmessage = () => { hopping = false; wake(); };\nfunction wake() {\n  if (!exportsOf || faulted) return;\n  try {\n    if (exportsOf.sh_worker_wake() && !hopping) { hopping = true; channel.port2.postMessage(0); }\n  } catch (error) {\n    // A buffer the browser refused (an import's copy) says so itself;\n    // otherwise why an import failed, if one did.\n    const why = outOfMemory(error) ? '' : lastError;\n    fault(why || `The runtime stopped: ${error?.message ?? error}`);\n  }\n}\n\n// The game's console lines go to the game's log (the page shows them), each with the stack frame of the script that\n// wrote it, as the interpreter gives its position.\nconst ErrorNow = G.Error;\nfunction captureConsole() {\n  const line = level => (...items) => {\n    if (lines.length >= 256) return;\n    let joined = '', frame = '';\n    // BigInts print as the native runtime's console prints them (`12n`).\n    const big = (_, value) => typeof value === 'bigint' ? `${value}n` : value;\n    try { joined = items.map(item => typeof item === 'string' ? item : typeof item === 'bigint' ? `${item}n` : (() => { try { return json(item, big) ?? String(item); } catch { return String(item); } })()).join(' '); } catch { joined = '[unprintable]'; }\n    // The frame below this one: V8's stack opens with the message, Firefox's and Safari's with the frames.\n    try { frame = String(new ErrorNow().stack ?? '').split('\\n').filter(text => /:\\d+:\\d+\\)?$/.test(text))[1]?.slice(0, 512) ?? ''; } catch {}\n    lines.push([level, joined, frame]);\n  };\n  const methods = {debug: line(0), log: line(1), info: line(1), warn: line(2), error: line(3), trace: line(1)};\n  for (const [name, method] of Object.entries(methods)) {\n    try { Object.defineProperty(console, name, {value: method, writable: true, configurable: true}); } catch {}\n  }\n}\n/** What a game has no use for, out of its reach, and the rest of the\n * worker's global object made to behave as the interpreter's, where these\n * names do not exist: a game may define its own (a stand-in `fetch`,\n * `WebSocket`, `navigator` or `location` for code written for a page) by\n * assignment or declaration, natively and here alike. */\nfunction lockdown() {\n  const gone = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'indexedDB', 'caches', 'importScripts',\n    'Worker', 'SharedWorker', 'BroadcastChannel', 'postMessage', 'onmessage', 'onmessageerror', 'requestAnimationFrame',\n    'cancelAnimationFrame', 'navigator'];\n  const own = (target, name) => Object.prototype.hasOwnProperty.call(target, name);\n  for (const name of gone) {\n    let kept = false;\n    for (let target = G; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {\n      try { if (own(target, name)) delete target[name]; } catch {}\n      if (own(target, name)) kept = true;\n    }\n    // Removed everywhere, the name is free (`typeof` reads undefined); one\n    // a prototype keeps is shadowed for good, though still assignable.\n    if (kept) try { Object.defineProperty(G, name, {value: undefined, writable: true, configurable: false}); } catch {}\n  }\n  // The worker's own accessors (`location`, `name`, `origin`, `self`, the\n  // `on…` event handlers and the like) become plain values: assigning one\n  // keeps the game's value and does nothing else, as natively, rather than\n  // throwing (no setter) or arming a handler the interpreter never calls.\n  for (let target = G; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {\n    for (const name of Object.getOwnPropertyNames(target)) {\n      const found = Object.getOwnPropertyDescriptor(target, name);\n      if (!found?.get || (target !== G && own(G, name))) continue;\n      let value;\n      try { value = apply(found.get, G, []); } catch { continue; }\n      try { Object.defineProperty(G, name, {value, writable: true, configurable: true, enumerable: found.enumerable}); } catch {}\n    }\n  }\n}\n\nasync function start({module, config, fonts: fontBytes, start, courier}) {\n  // The page's courier comes with the start message only, before any of\n  // the game's code: a port arriving any other way is no courier.\n  if (courier instanceof PortNow) courierPort = courier;\n  configBytes = encoder.encode(json({...config, worker: true}));\n  fonts = fontBytes ?? [];\n  packageBase = new URL(config.package, G.location.href).href;\n  assets = new AssetFetcher({baseURL: packageBase, fetch: (url, init) => {\n    const path = decodeURIComponent(String(url).slice(packageBase.length));\n    return fetchNow(url, {...init, cache: reloads.delete(path) ? 'reload' : 'default'});\n  }, onReady: id => { try { exportsOf?.sh_asset_wake?.(id); } catch {} wake(); }});\n  // One cache per package (its URL), so a game's update replaces its own\n  // objects only.\n  remote = new RemoteFetcher({cacheName: `starhermit-remote ${packageBase}`, fetch: fetchNow, caches: cachesNow, subtle: subtleNow, Reader: ReaderNow, onChange: wake});\n  await remote.open();\n  const provided = {starhermit_script: scriptImports, starhermit_runtime: runtimeImports, starhermit: engineImports()};\n  const object = {};\n  for (const {module: name, name: field} of WebAssembly.Module.imports(module)) {\n    const space = object[name] ??= {};\n    space[field] = provided[name]?.[field] ?? (() => { throw new Error(`${name}.${field} is not available in the game's worker`); });\n  }\n  instance = await WebAssembly.instantiate(module, object);\n  exportsOf = instance.exports;\n  captureConsole();\n  Object.defineProperty(G, '__starhermitNative', {value: Object.freeze({call: callNative, classic}), configurable: true});\n  exportsOf.main(0, 0);\n  lockdown();\n  inbox.push(new Uint8Array(start));\n  wake();\n}\n\nlisten('message', event => {\n  const data = event.data;\n  if (!instance && data?.module) {\n    start(data).catch(error => fault(`The game's worker could not start: ${error?.message ?? error}`));\n    return;\n  }\n  if (data?.bytes instanceof ArrayBuffer) { inbox.push(new Uint8Array(data.bytes)); wake(); }\n});\n// A rejected promise no callback took: the game's fault, as the\n// interpreter's runtime ends a game for it.\nlisten('unhandledrejection', event => { lines.push([3, `Uncaught (in promise) ${described(event.reason).split('\\n')[0]}`]); });\nlisten('error', event => { lines.push([3, String(event.message ?? 'Uncaught error')]); });\n})(globalThis.URL, globalThis.setTimeout, globalThis.clearTimeout, globalThis.AbortController, globalThis.Response, globalThis.Blob, globalThis.DecompressionStream, globalThis.TextEncoder, globalThis.TextDecoder);\n";
const RELEASED = !VERSION.startsWith('__');
// The host API's major version this runtime offers.
const API_MAJOR = 1;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const NO_CACHE = new Set(['starhermit.txt', 'starhermit-files.json']);

function setState(state) { try { document.documentElement.dataset.starhermit = state; } catch {} }

// The page around the canvas: progress, the Start gate and the error screen.
class Frame {
  constructor(canvas) {
    const document = globalThis.document;
    if (!canvas) {
      const holder = document.createElement('div');
      holder.className = 'starhermit-viewport';
      Object.assign(holder.style, {position: 'fixed', inset: '0', background: '#05070d'});
      canvas = document.createElement('canvas');
      holder.append(canvas); (document.body ?? document.documentElement).append(holder);
    }
    Object.assign(canvas.style, {display: 'block', width: '100%', height: '100%', touchAction: 'none'});
    canvas.setAttribute('aria-label', canvas.getAttribute('aria-label') || 'Game');
    this.canvas = canvas;
    const container = canvas.parentElement;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const overlay = this.overlay = document.createElement('div');
    overlay.className = 'starhermit-overlay';
    Object.assign(overlay.style, {position: 'absolute', inset: '0', display: 'grid', placeContent: 'center', gap: '14px', textAlign: 'center',
      font: '15px system-ui, sans-serif', color: '#e4e9f3', background: '#05070dd9', zIndex: '1'});
    // Its messages select (the game's area around it does not), so a player
    // can copy an error to report it.
    for (const name of ['user-select', '-webkit-user-select']) overlay.style.setProperty(name, 'text');
    this.status = document.createElement('p'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    Object.assign(this.status.style, {margin: '0', maxWidth: '36em', whiteSpace: 'pre-wrap', lineHeight: '1.5'});
    this.button = document.createElement('button'); this.button.type = 'button'; this.button.hidden = true;
    Object.assign(this.button.style, {font: 'inherit', fontSize: '17px', color: 'inherit', border: '1px solid #4f5f7a', borderRadius: '8px', background: '#1b2940', padding: '10px 26px', cursor: 'pointer', justifySelf: 'center'});
    overlay.append(this.status, this.button); container.append(overlay);
  }
  progress(text) { this.status.textContent = text; }
  // A Start gate (`runtime.gate`): a press before the game starts.
  gate(label) {
    this.status.textContent = ''; this.button.textContent = label; this.button.hidden = false; this.button.focus();
    return new Promise(resolve => this.button.addEventListener('click', () => { this.button.hidden = true; resolve(); }, {once: true}));
  }
  hide() { this.overlay.hidden = true; this.overlay.style.display = 'none'; }
  // The runtime's error screen (`#starhermit-error`, which checks read).
  error(message) {
    setState('error');
    this.overlay.id = 'starhermit-error'; this.overlay.setAttribute('role', 'alert');
    this.overlay.hidden = false; this.overlay.style.display = 'grid';
    this.status.textContent = `The game could not start.\n\n${message}`;
    this.button.textContent = 'Reload'; this.button.hidden = false;
    this.button.onclick = () => globalThis.location?.reload();
  }
}

async function fetchVerified(url, integrity, what) {
  let response;
  try { response = await fetch(url, {integrity, mode: 'cors', credentials: 'omit'}); }
  catch (error) { throw new Error(`${what} could not be loaded (${error.message}): the network failed or the file does not match the release`); }
  if (!response.ok) throw new Error(`${what} could not be loaded (HTTP ${response.status})`);
  return response;
}

// The release: its manifest and every file this page needs, each checked
// against the manifest's integrity.
async function loadRelease(manifestOption, frame) {
  const manifestURL = new URL(manifestOption.url, import.meta.url);
  const manifest = await (await fetchVerified(manifestURL, manifestOption.integrity, 'The runtime release manifest')).json();
  if (RELEASED && manifest.version !== VERSION) throw new Error(`The runtime release manifest is for StarHermit ${manifest.version}, this runtime is ${VERSION}`);
  if (manifest.api?.major !== API_MAJOR) throw new Error(`The runtime release offers host API ${manifest.api?.major}, this runtime ${API_MAJOR}`);
  const base = new URL('./', import.meta.url);
  const file = async (path, kind) => {
    const entry = manifest.files?.[path];
    if (!entry?.sha384) throw new Error(`The runtime release lists no ${path}`);
    const response = await fetchVerified(new URL(path, base), entry.sha384, `The runtime's ${path}`);
    return kind === 'text' ? response.text() : new Uint8Array(await response.arrayBuffer());
  };
  frame.progress('Loading StarHermit');
  const fonts = Object.keys(manifest.files ?? {}).filter(path => path.startsWith('fonts/')).sort();
  // The audio and voice worklets load by their addresses (worklets load only
  // from where scripts may come from); their copies are checked first.
  const [wasm, mixer, fontBytes] = await Promise.all([
    file('starhermit.wasm'), file('audio-mixer.wasm'), Promise.all(fonts.map(path => file(path))), file('audio-worklet.js'),
    file('voice-worklet.js'),
  ]);
  return {manifest, wasm, mixer, workletURL: new URL('audio-worklet.js', base).href, voiceWorkletURL: new URL('voice-worklet.js', base).href,
    fonts: fontBytes};
}

// The page's courier (courier.mjs), from the sources of its functions.
const COURIER = `(${courier})(${route}, self);`;

// The game's worker: made from the release's worker script, sent the
// runtime's compiled module, its configuration and fonts and the game's
// start; its messages wait here until the runtime takes them (`arrived`
// hears of each: a hidden page takes a turn for it).
class GameWorker {
  constructor() { this.worker = null; this.inbox = []; this.url = null; this.arrived = null; this.courierWorker = null; this.marked = 0; this.heard = 0; this.markers = null; }
  // A numbered marker the page posts itself, which comes back behind the
  // worker's messages that were waiting for the page as it was posted (one
  // task source, in order): the runtime's watchdog counts a call as late
  // only by the time the page had heard the worker to (`heard`, the newest
  // marker back), not by turns the page spent drawing while the worker's
  // answer waited (driver/remote.rs). Without MessageChannel it is heard
  // at once.
  mark() {
    const id = ++this.marked;
    if (!this.markers && typeof MessageChannel === 'function') {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { if (event.data > this.heard) this.heard = event.data; };
      this.markers = channel.port2;
    }
    if (this.markers) this.markers.postMessage(id); else this.heard = id;
    return id;
  }
  // The page's own word that the worker failed, kept as text and made the
  // runtime's message (`ToPage::Fault`) only as the runtime takes it,
  // straight into its memory: a worker that failed for want of memory may
  // have left the page none for a buffer.
  fault(message) { this.inbox.push(String(message).slice(0, 4096)); }
  /** The next message's length in the runtime's terms (-1: none waits). */
  nextLength() {
    const next = this.inbox[0];
    if (next === undefined) return -1;
    if (typeof next !== 'string') return next.length;
    let length = 5;
    for (const character of next) { const code = character.codePointAt(0); length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; }
    return length;
  }
  /** Takes the next message into `out`, which is its length. */
  take(out) {
    const next = this.inbox.shift();
    if (typeof next !== 'string') { out.set(next); return; }
    out[0] = 2; new DataView(out.buffer, out.byteOffset, 5).setUint32(1, out.length - 5, true);
    encoder.encodeInto(next, out.subarray(5));
  }
  open(module, config, fonts, start) {
    const courierFor = this.courierFor; this.courierFor = null;
    this.close();
    if (GAME_WORKER.startsWith('__')) throw new Error('This runtime build has no game worker');
    this.url ??= URL.createObjectURL(new Blob([GAME_WORKER], {type: 'text/javascript'}));
    const worker = this.worker = new Worker(this.url, {name: 'StarHermit game'});
    worker.onmessage = event => {
      if (worker !== this.worker) return;
      if (event.data?.bytes instanceof ArrayBuffer) this.inbox.push(new Uint8Array(event.data.bytes));
      else if (typeof event.data?.fault === 'string') this.fault(event.data.fault);
      this.arrived?.();
    };
    worker.onerror = event => { if (worker === this.worker) { event.preventDefault?.(); this.fault(`The game's worker failed: ${event.message || 'it could not load'}`); } };
    // A signed-in page's courier, its port in the start message (taken
    // before any of the game's code runs).
    let port;
    if (courierFor) {
      this.courierURL ??= URL.createObjectURL(new Blob([COURIER], {type: 'text/javascript'}));
      const courierWorker = this.courierWorker = new Worker(this.courierURL, {name: 'StarHermit courier'});
      const channel = new MessageChannel();
      courierWorker.postMessage({port: channel.port1, ...courierFor}, [channel.port1]);
      port = channel.port2;
    }
    worker.postMessage({module, config, fonts: fonts.map(bytes => bytes.slice()), start: start.buffer, courier: port}, [start.buffer, ...(port ? [port] : [])]);
  }
  post(bytes) { if (this.worker) this.worker.postMessage({bytes: bytes.buffer}, [bytes.buffer]); }
  close() { this.worker?.terminate(); this.worker = null; this.inbox.length = 0; this.courierWorker?.terminate(); this.courierWorker = null; }
  // The next worker opened gets a courier on the page's API `origin` for
  // `game`; `arm` gives it the credential as the game quits.
  courier(origin, game) { this.courierFor = {origin, game}; }
  arm(token) { this.courierWorker?.postMessage({token}); }
  // The game is quitting: its worker writes the game's storage snapshot
  // (`key`) to the page's store itself and closes, so the page's own
  // queued write of it (older) is dropped; one still running ten seconds
  // later is ended. Its messages are no longer taken, and a new worker
  // does not end it.
  // With `saves` it writes the game's save slots too, so the page's save
  // store drops its own writes still waiting (`slots`). Its courier goes
  // with it.
  retire(key, store, saves, slots) {
    const worker = this.worker, courier = this.courierWorker; this.worker = null; this.courierWorker = null; this.inbox.length = 0;
    if (key) store?.forget(key);
    if (saves) slots?.retire();
    if (worker) setTimeout(() => worker.terminate(), 10000);
    if (courier) setTimeout(() => courier.terminate(), 10000);
  }
}

// The files a game hands the player or the player picks for it
// (`files.saveAs`, `files.open`): the page's own download and file
// chooser, never the game's worker. A save is an `<a download>` of a Blob;
// an open an `<input type=file>` the page clicks while the player's press
// still counts (the browser's transient activation), else a bar on the
// page asks the player to choose, its button being the press. Neither
// needs more of the page's Content-Security-Policy than it has.
const MAX_PLAYER_FILE = 64 * 1024 * 1024;
class PlayerFiles {
  constructor() { this.next = 1; this.choices = new Map(); this.bar = null; }
  save(name, type, bytes) {
    const document = globalThis.document, url = URL.createObjectURL(new Blob([bytes], {type}));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.rel = 'noopener'; link.hidden = true;
    (document.body ?? document.documentElement).append(link); link.click(); link.remove();
    // The download has the bytes once it starts.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  open(accept) {
    const document = globalThis.document, handle = this.next++;
    const choice = {state: -1, name: '', bytes: null, error: ''};
    this.choices.set(handle, choice);
    const input = document.createElement('input');
    input.type = 'file'; input.hidden = true; if (accept) input.accept = accept;
    const done = () => { input.remove(); this.closeBar(); };
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; done();
      if (!file) { choice.state = -2; return; }
      if (file.size > MAX_PLAYER_FILE) { choice.error = 'RangeError: the file is larger than the 64 MiB a game opens'; choice.state = -3; return; }
      try { choice.bytes = new Uint8Array(await file.arrayBuffer()); choice.name = file.name; choice.state = choice.bytes.length; }
      catch (error) { choice.error = `NotReadableError: the file could not be read: ${error?.message ?? error}`; choice.state = -3; }
    });
    input.addEventListener('cancel', () => { done(); choice.state = -2; });
    (document.body ?? document.documentElement).append(input);
    // Without the player's press still in hand (a gamepad's press, or it
    // has expired), the browser shows no chooser: the bar asks for one.
    if (globalThis.navigator?.userActivation?.isActive === false) this.showBar(input, () => { done(); choice.state = -2; });
    else input.click();
    return handle;
  }
  showBar(input, cancel) {
    this.closeBar();
    const document = globalThis.document, bar = this.bar = document.createElement('div');
    bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'Open a file');
    Object.assign(bar.style, {position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '2147483647',
      background: '#12141c', color: '#f2f2f2', border: '2px solid #fab847', padding: '12px 16px', font: '16px system-ui, sans-serif',
      display: 'flex', gap: '12px', alignItems: 'center', maxWidth: 'calc(100% - 32px)'});
    const text = document.createElement('span'); text.textContent = 'The game wants to open a file from this device.';
    const button = (label, action) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
      Object.assign(element.style, {font: 'inherit', padding: '6px 12px', background: '#1d2130', color: 'inherit', border: '2px solid #fab847', cursor: 'pointer'});
      element.addEventListener('click', action); return element;
    };
    const cancelButton = button('Cancel', cancel);
    bar.append(text, cancelButton, button('Choose a file…', () => input.click()));
    (document.body ?? document.documentElement).append(bar);
    cancelButton.focus();
  }
  closeBar() { this.bar?.remove(); this.bar = null; }
}

// The imports the runtime has beyond the engine's (`starhermit_runtime`).
function runtimeImports(config, fonts, packageURL, reloads, results) {
  const configBytes = encoder.encode(JSON.stringify(config));
  const game = new GameWorker();
  const playerFiles = new PlayerFiles();
  // The script engine's imports are the game worker's (the same module runs
  // there): the page has none.
  const workerOnly = new Proxy({}, {get: (_, name) => () => { throw new Error(`starhermit_script.${String(name)} runs in the game's worker only`); }});
  return host => ({starhermit_script: workerOnly, starhermit_runtime: {
    game_worker_open: (ptr, len) => host.guard(() => { game.arrived = () => { host.hiddenTurn(); host.audioPump(); }; game.open(host.wasmModule, config, fonts, host.memory(ptr, len).slice()); return 1; }),
    game_worker_post: (ptr, len) => host.guard(() => game.post(host.memory(ptr, len).slice())),
    game_worker_next: (out, capacity) => host.guard(() => {
      const length = game.nextLength(); if (length < 0 || capacity === 0) return length;
      if (capacity !== length) throw new Error('Game worker message size mismatch');
      game.take(host.memory(out, capacity)); return capacity;
    }, -1),
    game_worker_close: () => game.close(),
    game_worker_mark: () => host.guard(() => game.mark()),
    game_worker_heard: () => game.heard,
    game_worker_retire: (ptr, len, saves) => host.guard(() => { game.retire(len ? host.text(ptr, len) : '', host.storage, saves === 1, host.saveSlots); return 1; }),
    game_worker_courier: (ptr, len) => host.guard(() => { game.courier(host.options.api?.origin || globalThis.location?.origin, host.text(ptr, len)); return 1; }),
    game_worker_arm: (ptr, len) => host.guard(() => { game.arm(host.text(ptr, len)); return 1; }),
    config_take: (out, capacity) => { if (capacity) host.memory(out, Math.min(capacity, configBytes.length)).set(configBytes.subarray(0, capacity)); return configBytes.length; },
    font_length: index => fonts[index]?.length ?? 0,
    font_copy: (index, out, length) => host.guard(() => { const bytes = fonts[index]; if (!bytes || bytes.length !== length) return 0; host.memory(out, length).set(bytes); return 1; }),
    // A file a game reads synchronously before it was fetched: the page
    // waits for it (a blocking request; the page's own origin).
    package_read_sync: (pathPtr, pathLength, out, size) => host.guard(() => {
      const path = host.text(pathPtr, pathLength), request = new XMLHttpRequest();
      request.open('GET', new URL(path.split('/').map(encodeURIComponent).join('/'), packageURL), false);
      request.overrideMimeType('text/plain; charset=x-user-defined');
      request.send();
      if (request.status !== 200) throw new Error(`HTTP ${request.status}`);
      const text = request.responseText;
      if (text.length !== size) throw new Error(`it is ${text.length} bytes, not the ${size} the index lists`);
      const bytes = host.memory(out, size);
      for (let at = 0; at < size; at++) bytes[at] = text.charCodeAt(at) & 0xff;
      return 1;
    }),
    package_reload: (pathPtr, pathLength) => { try { reloads.add(host.text(pathPtr, pathLength)); } catch {} },
    // Remote files are fetched in the game's worker (remote.mjs).
    remote_start: () => 0, remote_state: () => 2, remote_loaded: () => 0, remote_error: () => 0, remote_release: () => {},
    remote_cached: () => 0, remote_read: () => 0, remote_read_range: () => 0, remote_keep: () => {},
    stream_remote_open: () => 0, stream_remote_available: () => 0, stream_remote_read: () => 0, stream_remote_want: () => {},
    stream_remote_progress: () => 0, stream_remote_error: () => 0, stream_remote_close: () => {},
    // The Account dialog's Sign in: the page goes to the platform's game
    // sign-in (its route only, on HTTPS or a loopback development host),
    // which brings the player back with a credential in the address.
    sign_in_open: (pointer, length) => host.guard(() => {
      const url = new URL(host.text(pointer, length));
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash
        || !/^\/api\/v1\/auth\/games\/[0-9A-Za-z-]{1,64}\/sign-in$/.test(url.pathname)) throw new Error('Only the platform\'s sign-in is opened');
      globalThis.location.assign(url.href); return 1;
    }, 0),
    file_save: (namePtr, nameLength, typePtr, typeLength, pointer, length) => host.guard(() => {
      if (length > MAX_PLAYER_FILE) throw new Error('The file is too large');
      playerFiles.save(host.text(namePtr, nameLength), host.text(typePtr, typeLength), host.memory(pointer, length).slice()); return 1;
    }),
    file_open: (pointer, length) => host.guard(() => playerFiles.open(host.text(pointer, length))),
    file_state: handle => {
      const choice = playerFiles.choices.get(handle);
      if (!choice) { host.lastError = 'No such file choice'; return -3; }
      if (choice.state === -2) playerFiles.choices.delete(handle);
      if (choice.state === -3) { host.lastError = choice.error; playerFiles.choices.delete(handle); }
      return choice.state;
    },
    file_name: (handle, out, capacity) => {
      const bytes = encoder.encode(playerFiles.choices.get(handle)?.name ?? ''), count = Math.min(bytes.length, capacity);
      try { host.memory(out, count).set(bytes.subarray(0, count)); } catch { return 0; }
      return count;
    },
    file_take: (handle, out, length) => host.guard(() => {
      const choice = playerFiles.choices.get(handle);
      if (!choice?.bytes || choice.bytes.length !== length) throw new Error('File size mismatch');
      host.memory(out, length).set(choice.bytes); playerFiles.choices.delete(handle); return 1;
    }),
    console_line: (level, pointer, length) => { try { const text = host.text(pointer, length); (level >= 3 ? console.error : level === 2 ? console.warn : level === 0 ? console.debug : console.log)(text); } catch {} },
    // A game's copy during the player's press (whose user activation lets
    // the page write); a refusal (no activation, the page without focus,
    // a frame without the clipboard-write permission) is a console warning.
    clipboard_write_text: (pointer, length) => {
      let text; try { text = host.text(pointer, length); } catch { return; }
      const refused = error => console.warn(`The clipboard refused the game's text: ${error?.message ?? error}`);
      try { navigator.clipboard.writeText(text).catch(refused); } catch (error) { refused(error); }
    },
    status_report: (kind, pointer, length) => {
      let text = ''; try { text = host.text(pointer, length); } catch { return; }
      if (kind === 0) setState(text);
      else if (kind === 1) results.error = text;
      else { results.lines.push(text); console.log(text); globalThis.dispatchEvent?.(new CustomEvent('starhermit-result', {detail: text})); }
    },
  }});
}

/** Starts the game at `options.package` on this runtime release. */
export async function start(options = {}) {
  const launch = captureLaunch(globalThis.window);
  setState('loading');
  // The loader's own message (plain markup) gives way to the runtime's.
  for (const id of ['starhermit-status', 'starhermit-message']) {
    const message = globalThis.document?.getElementById(id);
    if (message) message.hidden = true;
  }
  const frame = new Frame(options.canvas);
  // What checks and the development server pass (never the loader).
  const runtime = options.runtime ?? {};
  const results = globalThis.starhermitResults = {lines: [], error: ''};
  let host = null;
  try {
    if (!options.manifest?.url) throw new Error('No runtime release manifest was given');
    const packageURL = new URL(options.package ?? './', globalThis.location?.href);
    if (!packageURL.pathname.endsWith('/')) packageURL.pathname += '/';
    const release = await loadRelease(options.manifest, frame);
    const reloads = new Set();
    const config = {version: release.manifest.version, package: packageURL.href, page: globalThis.location?.href ?? '', environment: runtime.environment ?? 'production',
      dev: !!runtime.dev, ephemeral: !!runtime.ephemeral, play: runtime.play ?? null, quality: runtime.quality ?? null, ceiling: runtime.ceiling ?? null, game: runtime.game ?? null};
    const packagePath = url => { const href = String(url); return href.startsWith(packageURL.href) ? decodeURIComponent(href.slice(packageURL.href.length)) : ''; };
    frame.progress('Loading the game');
    host = await createHost(frame.canvas, {
      wasmBytes: release.wasm, fallback: true, assetBaseURL: packageURL.href, audioOnGesture: true, initializeOnWake: true, hiddenTurns: true, browserDefaults: options.browserDefaults,
      launch, voice: {workletURL: release.voiceWorkletURL},
      assets: {fetch: (url, init) => {
        const path = packagePath(url);
        const cache = reloads.delete(path) ? 'reload' : NO_CACHE.has(path) ? 'no-cache' : 'default';
        return globalThis.fetch(url, {...init, cache});
      }},
      // Game storage shares the store with the preferences: room for it.
      storage: new PreferenceStore({maxBytes: 16 * 1024 * 1024}),
      imports: runtimeImports(config, release.fonts, packageURL, reloads, results),
      audioBridgeFactory: bridge => new AudioBridge({...bridge, soundCeiling: 256}),
      audioFactory: () => new BrowserAudio({module: new WebAssembly.Module(release.mixer), workletURL: release.workletURL, soundCeiling: 256}),
      onProgress: text => frame.progress(text.startsWith('Initializing') ? `Loading the game ${text.replace(/\D+/, '')}` : text),
      onError: message => { console.error(`StarHermit: ${message}`); frame.error(message); },
    });
    if (results.error) throw new Error(results.error);
    if (runtime.gate) await frame.gate('Play');
    frame.progress('Starting');
    await host.start();
    if (results.error) throw new Error(results.error);
    frame.hide();
    globalThis.starhermit = host;
    return host;
  } catch (error) {
    // The runtime's own words first (a panic's message comes before the trap).
    const message = results.error || host?.fatal || error?.message || String(error);
    console.error(`StarHermit: ${message}`);
    frame.error(message);
    if (host) await host.destroy().catch(() => {});
    throw new Error(message);
  }
}

// A loader page's configuration starts the game (see the top).
const configuration = globalThis.document?.getElementById('starhermit-config');
if (configuration?.type === 'application/json') {
  let manifest, browserDefaults;
  try { ({manifest, browserDefaults} = JSON.parse(configuration.textContent)); } catch {}
  start({manifest, browserDefaults, package: new URL('./', globalThis.location.href), canvas: globalThis.document.querySelector('canvas') ?? undefined}).catch(() => {});
}
