The post-effect chain's shaders in starhermit-web's graphics.mjs (POST_WGSL:
the ground-truth ambient occlusion and its Poisson denoise, the bloom's
luminosity high pass, Gaussian blurs and composite, the output's tone
mapping and sRGB encoding, and the color grade's place in the chain), the
shared plan that orders and sizes them (starhermit-sys post.rs), and the
SPIR-V, HLSL and GLSL starhermit-sys compiles from them follow three.js
r176's GTAOShader, PoissonDenoiseShader, UnrealBloomPass,
LuminosityHighPassShader, OutputShader and EffectComposer
(https://github.com/mrdoob/three.js, examples/jsm/postprocessing and
examples/jsm/shaders); and the shapes, curves and outline geometries in
starhermit-render-3d's shapes/outline.rs and starhermit-runtime's scene
prelude (prelude/scene_math.ts and scene.ts) are transcribed from three.js
r185's src/extras (Curve, CurvePath, Path, Shape, ShapePath, ShapeUtils and
the 2D curves) and src/geometries (ShapeGeometry, ExtrudeGeometry and
EdgesGeometry); all distributed under the MIT License:

The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
