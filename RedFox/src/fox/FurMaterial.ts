/**
 * Physically based fur: a skin material for the base mesh and alpha-tested shell materials.
 *
 * Shells are copies of the skinned body pushed out along the skinned normal. Each fragment
 * decides whether it lies inside a hair strand with 3D value noise evaluated in rest-pose space,
 * so strands stick to the body while it animates. Strands taper with height, clump together,
 * vary in length, lean along the anatomical comb direction and droop under gravity.
 */
import { Color, MeshPhysicalMaterial, Vector3, type IUniform, type WebGLProgramParametersWithUniforms } from 'three';

export interface FurUniforms {
  [name: string]: IUniform;
  uFurLength: IUniform<number>;
  uComb: IUniform<number>;
  uGravity: IUniform<number>;
  uDensity: IUniform<number>;
  uWind: IUniform<Vector3>;
  uTime: IUniform<number>;
  uFurOn: IUniform<number>;
}

export function createFurUniforms(): FurUniforms {
  return {
    uFurLength: { value: 0.034 },
    uComb: { value: 0.75 },
    uGravity: { value: 0.18 },
    uDensity: { value: 380 },
    uWind: { value: new Vector3() },
    uTime: { value: 0 },
    uFurOn: { value: 1 },
  };
}

const NOISE_GLSL = /* glsl */ `
float furHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 furHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float furNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = furHash(i), n100 = furHash(i + vec3(1, 0, 0));
  float n010 = furHash(i + vec3(0, 1, 0)), n110 = furHash(i + vec3(1, 1, 0));
  float n001 = furHash(i + vec3(0, 0, 1)), n101 = furHash(i + vec3(1, 0, 1));
  float n011 = furHash(i + vec3(0, 1, 1)), n111 = furHash(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
// Nearest jittered hair root (3D cellular noise, 2x2x2 search). x: distance, y: hair id.
vec2 furCells(vec3 p) {
  vec3 base = floor(p - 0.5);
  float best = 1e9;
  float id = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 c = base + vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    vec3 h = furHash3(c);
    vec3 d = p - (c + 0.5 + (h - 0.5) * 0.7);
    float dd = dot(d, d);
    if (dd < best) {
      best = dd;
      id = h.z;
    }
  }
  return vec2(sqrt(best), id);
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 furData;
attribute vec3 furDir;
uniform float uShellH;
uniform float uFurLength;
uniform float uComb;
uniform float uGravity;
uniform vec3 uWind;
uniform float uTime;
varying vec3 vRestPos;
varying vec4 vFurData;
`;

const VERTEX_DISPLACE = /* glsl */ `
vRestPos = position;
vFurData = furData;
#ifdef FUR_SHELL
{
  #ifdef USE_SKINNING
    vec3 fDir = (skinMatrix * vec4(furDir, 0.0)).xyz;
  #else
    vec3 fDir = furDir;
  #endif
  float furL = furData.x * uFurLength;
  float h = uShellH;
  vec3 nrm = normalize(objectNormal);
  // Gentle sway so the coat never looks frozen; stronger at the tips.
  float sway = sin(uTime * 2.3 + position.z * 40.0 + position.y * 23.0) * 0.12;
  vec3 bend = normalize(fDir + vec3(1e-5)) * uComb + vec3(0.0, -uGravity, 0.0) + uWind + fDir * sway;
  transformed += nrm * (furL * h) + bend * (furL * h * h);
}
#endif
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uShellH;
uniform float uDensity;
uniform float uFurOn;
varying vec3 vRestPos;
varying vec4 vFurData;
${NOISE_GLSL}
`;

const FRAGMENT_COLOR = /* glsl */ `
#ifdef FUR_SHELL
{
  float h = uShellH;
  float len = vFurData.x;
  if (len < 0.03) discard;
  // Individual hairs: round cross-sections around jittered roots in rest space, each with its
  // own length and tone. Combing in the vertex shader leans them into streaks.
  vec3 sp = vRestPos * uDensity;
  vec2 cell = furCells(sp);
  float hairRand = fract(cell.y * 7.13);
  float clump = furNoise(vRestPos * (uDensity * 0.16) + 7.1);
  float hairLen = mix(0.5, 1.0, hairRand) * mix(0.72, 1.0, clump);
  float taper = clamp(h / hairLen, 0.0, 1.0);
  float a = mix(0.44, 0.07, taper) - cell.x;
  a = min(a, (hairLen - h) * 2.0);
  // Dense, short underfur fills the gaps near the skin.
  float under = 0.32 - h * 1.5 + (furNoise(sp * 0.8) - 0.5) * 0.25;
  a = max(a, under);
  // When hairs shrink below a pixel, fall back to their expected coverage.
  float fw = clamp(length(fwidth(sp)) * 1.2 - 0.6, 0.0, 1.0);
  float soft = (1.0 - taper) * 0.8 - 0.3;
  diffuseColor.a = 0.5 + mix(a, soft, fw);

  // Self-shadowing toward the roots, per-hair tone and dark-tipped guard hairs.
  float ao = mix(0.6, 1.0, pow(h, 0.6));
  float tone = mix(0.92, 1.06, fract(cell.y * 3.71));
  diffuseColor.rgb *= ao * tone;
  float guard = step(fract(cell.y * 11.3), vFurData.y * 0.7) * smoothstep(0.5, 0.85, taper);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.18, guard);
}
#else
  // Under the coat the skin reads as dense, shadowed underfur.
  diffuseColor.rgb *= mix(1.0, mix(0.6, 1.0, smoothstep(0.08, 0.0, vFurData.x)), uFurOn);
#endif
`;

export interface FurMaterialOptions {
  /** Normalised shell height (0..1); omit for the base skin. */
  shellHeight?: number;
  uniforms: FurUniforms;
}

export function createFurMaterial(opts: FurMaterialOptions): MeshPhysicalMaterial {
  const isShell = opts.shellHeight !== undefined;
  const mat = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    sheen: 0.3,
    specularIntensity: 0.45,
    sheenRoughness: 0.55,
    sheenColor: new Color(0xfff0e0),
    alphaTest: isShell ? 0.5 : 0,
    alphaToCoverage: isShell,
  });
  mat.name = isShell ? 'FurShell' : 'FurSkin';
  if (isShell) mat.defines = { FUR_SHELL: '' };
  const shellH = { value: opts.shellHeight ?? 0 };
  mat.userData.shellH = shellH;

  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, opts.uniforms, { uShellH: shellH });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${VERTEX_DISPLACE}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vFurData.w;')
      // Sheen tinted by the local coat colour gives fur its soft, back-lit glow.
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor = sheenColor * diffuseColor.rgb * 1.4 * smoothstep(0.02, 0.12, dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)));\n#endif',
      );
  };
  mat.customProgramCacheKey = () => (isShell ? 'fox-fur-shell' : 'fox-fur-skin');
  return mat;
}
