/**
 * Turns the sculpted SDF into skinned, painted mesh data. Pure and DOM-free so it can run in a
 * worker (see foxWorker.ts) and in unit tests.
 */
import { BONE_DEFS, sculptFox, type EyePlacement, type FoxSculpt } from './anatomy';
import { CoatPainter } from './coat';
import { surfaceNets } from './sdf/surfaceNets';
import type { EarFrame, V3 } from './sdf/primitives';

export interface FoxMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  colors: Float32Array;
  /** x: fur length (0..1), y: grizzle, z: random per-vertex value, w: roughness. */
  furData: Float32Array;
  furDir: Float32Array;
  eyes: { L: EyePlacement; R: EyePlacement };
  ears: { L: EarFrame; R: EarFrame };
  buildMs: number;
}

export interface BuildOptions {
  /** Voxel size in metres; smaller is smoother but slower. */
  cell: number;
  onProgress?: (fraction: number, stage: string) => void;
}

/** Width of the skin-weight blend across joints (metres of SDF distance). */
const SKIN_SOFTNESS = 0.012;

export function buildFoxMesh(opts: BuildOptions): FoxMeshData {
  const t0 = performance.now();
  const sculpt: FoxSculpt = sculptFox();
  const model = sculpt.model;
  // Largest blend radius + the mesher's empty-space threshold + margin (see SdfModel.accelerate).
  model.accelerate(sculpt.bounds.min, sculpt.bounds.max, 0.03, 0.13);
  const evalSdf = (x: number, y: number, z: number) => model.eval(x, y, z);

  opts.onProgress?.(0, 'Sculpting body');
  const raw = surfaceNets(evalSdf, {
    min: sculpt.bounds.min,
    max: sculpt.bounds.max,
    cell: opts.cell,
    onProgress: (f) => opts.onProgress?.(f * 0.7, 'Sculpting body'),
  });

  const vCount = raw.positions.length / 3;
  const positions = raw.positions;
  const normals = new Float32Array(vCount * 3);
  const g: [number, number, number] = [0, 0, 0];
  const eps = opts.cell * 0.35;

  // Project vertices onto the true surface and take normals from the field gradient.
  opts.onProgress?.(0.7, 'Refining surface');
  for (let i = 0; i < vCount; i++) {
    let x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = model.eval(x, y, z);
      model.gradient(x, y, z, eps, g);
      const gl2 = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (4 * eps * eps);
      if (gl2 < 1e-8) break;
      let s = d / gl2 / (2 * eps);
      // Never move more than half a voxel; this keeps thin parts (ears) intact.
      const step = Math.abs(s) * Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
      const maxStep = opts.cell * 0.5;
      if (step > maxStep) s *= maxStep / step;
      x -= g[0] * s;
      y -= g[1] * s;
      z -= g[2] * s;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    model.gradient(x, y, z, eps, g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    normals[i * 3] = g[0] / l;
    normals[i * 3 + 1] = g[1] / l;
    normals[i * 3 + 2] = g[2] / l;
  }

  // Skin weights and coat.
  opts.onProgress?.(0.8, 'Painting coat');
  const boneCount = BONE_DEFS.length;
  const skinIndex = new Uint16Array(vCount * 4);
  const skinWeight = new Float32Array(vCount * 4);
  const colors = new Float32Array(vCount * 3);
  const furData = new Float32Array(vCount * 4);
  const furDir = new Float32Array(vCount * 3);
  const partDist = new Float64Array(model.parts.length);
  const boneDist = new Float64Array(boneCount);
  const boneW = new Float64Array(boneCount);
  const painter = new CoatPainter(sculpt);

  for (let i = 0; i < vCount; i++) {
    const p: V3 = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const n: V3 = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    model.partDistances(p[0], p[1], p[2], partDist);

    boneDist.fill(Infinity);
    for (let k = 0; k < model.parts.length; k++) {
      const part = model.parts[k];
      if (part.op !== 'union') continue;
      if (partDist[k] < boneDist[part.bone]) boneDist[part.bone] = partDist[k];
    }
    let dMin = Infinity;
    for (let b = 0; b < boneCount; b++) dMin = Math.min(dMin, boneDist[b]);
    let wSum = 0;
    for (let b = 0; b < boneCount; b++) {
      const e = (boneDist[b] - dMin) / SKIN_SOFTNESS;
      const w = e < 3 ? Math.exp(-e * e) : 0;
      boneW[b] = w;
      wSum += w;
    }
    for (let b = 0; b < boneCount; b++) boneW[b] /= wSum;

    writeTopInfluences(boneW, skinIndex, skinWeight, i);

    const coat = painter.paint({ p, n, boneW, partDist });
    colors.set(coat.color, i * 3);
    furData[i * 4] = coat.furLength;
    furData[i * 4 + 1] = coat.grizzle;
    furData[i * 4 + 2] = fract(Math.sin(i * 12.9898) * 43758.5453);
    furData[i * 4 + 3] = coat.roughness;
    furDir.set(coat.furDir, i * 3);
  }
  opts.onProgress?.(1, 'Done');

  return {
    positions,
    normals,
    indices: raw.indices,
    skinIndex,
    skinWeight,
    colors,
    furData,
    furDir,
    eyes: sculpt.eyes,
    ears: sculpt.ears,
    buildMs: performance.now() - t0,
  };
}

/** Keeps the four strongest bone influences and renormalises them. */
function writeTopInfluences(w: Float64Array, outIdx: Uint16Array, outW: Float32Array, v: number): void {
  const top = [-1, -1, -1, -1];
  const topW = [0, 0, 0, 0];
  for (let b = 0; b < w.length; b++) {
    const val = w[b];
    if (val <= topW[3]) continue;
    let slot = 3;
    while (slot > 0 && val > topW[slot - 1]) {
      top[slot] = top[slot - 1];
      topW[slot] = topW[slot - 1];
      slot--;
    }
    top[slot] = b;
    topW[slot] = val;
  }
  const sum = topW[0] + topW[1] + topW[2] + topW[3] || 1;
  for (let s = 0; s < 4; s++) {
    outIdx[v * 4 + s] = Math.max(top[s], 0);
    outW[v * 4 + s] = topW[s] / sum;
  }
}

const fract = (x: number) => x - Math.floor(x);
