/**
 * Coat painter: decides colour, fur length, fur direction and roughness for every vertex of the
 * rest-pose mesh, using anatomical masks (bone influence, part distances, position, normal).
 */
import { BONE_DEFS, HEAD_OFFSET, JOINTS, TAIL_BONES, boneIndex, type FoxSculpt } from './anatomy';
import { clamp01, fbm3, mix, smoothstep } from './noise';
import { v3, type V3 } from './sdf/primitives';

type RGB = [number, number, number];

const srgb = (hex: number): RGB => {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return [c[0], c[1], c[2]];
};

const PALETTE = {
  orange: srgb(0xd4672a),
  orangeLight: srgb(0xe08a45),
  rust: srgb(0x9c3c16),
  cream: srgb(0xeee2cf),
  white: srgb(0xf5f1ea),
  black: srgb(0x17120f),
  darkBrown: srgb(0x3b2418),
  earInner: srgb(0xe3d3c0),
  earDeep: srgb(0x8f7462),
  nose: srgb(0x0e0c0b),
};

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export interface CoatSample {
  color: RGB;
  roughness: number;
  /** Fur length as a fraction of the global maximum length. */
  furLength: number;
  /** Amount of dark-tipped guard hair (0..1). */
  grizzle: number;
  /** Unit comb direction in rest space, tangent to the surface. */
  furDir: V3;
}

export interface CoatContext {
  p: V3;
  n: V3;
  /** Normalised influence of every bone (length = bone count). */
  boneW: Float64Array;
  /** Raw distance to every SDF part. */
  partDist: Float64Array;
}

/** Comb direction per bone in rest space before projection onto the surface. */
function combFor(name: string): V3 {
  if (name.startsWith('tail')) {
    const i = Math.max(0, TAIL_BONES.indexOf(name));
    return v3.norm(v3.sub(JOINTS.tail[i + 1], JOINTS.tail[i]));
  }
  if (name.startsWith('ear')) return [name.endsWith('_L') ? 0.25 : -0.25, 1, -0.1];
  if (name === 'head') return [0, 0.12, -1];
  if (name === 'neck') return [0, -0.55, -0.8];
  if (name.startsWith('fToe') || name.startsWith('hToe')) return [0, -0.4, 1];
  if (/^(scapula|upperArm|foreArm|hand|thigh|shin|meta)/.test(name)) return [0, -1, -0.05];
  return [0, -0.3, -1];
}

export class CoatPainter {
  private readonly combs: V3[] = BONE_DEFS.map((b) => v3.norm(combFor(b.name)));
  private readonly groups: Record<string, number[]>;
  private readonly part: (name: string) => number;

  constructor(private readonly sculpt: FoxSculpt) {
    const idx = (names: string[]) => names.map(boneIndex);
    const sides = (names: string[]) => names.flatMap((n) => [`${n}_L`, `${n}_R`]);
    this.groups = {
      head: idx(['head']),
      earL: idx(['ear_L']),
      earR: idx(['ear_R']),
      neck: idx(['neck']),
      torso: idx(['hips', 'spine1', 'spine2', 'ribs', 'chest']),
      front: idx(sides(['scapula', 'upperArm', 'foreArm', 'hand', 'fToe'])),
      hind: idx(sides(['thigh', 'shin', 'meta', 'hToe'])),
      tail: idx(TAIL_BONES),
    };
    this.part = (name) => sculpt.model.indexOf(name);
  }

  private group(ctx: CoatContext, name: string): number {
    let s = 0;
    for (const i of this.groups[name]) s += ctx.boneW[i];
    return s;
  }

  /** Position along the tail from base (0) to tip (1), or -1 if not near the tail. */
  private tailParam(p: V3): number {
    const path = this.sculpt.tailPath;
    let best = Infinity, bestT = 0, acc = 0;
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) total += v3.len(v3.sub(path[i + 1], path[i]));
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const ab = v3.sub(b, a);
      const segLen = v3.len(ab);
      const t = clamp01(v3.dot(v3.sub(p, a), ab) / (segLen * segLen));
      const q = v3.add(a, v3.scale(ab, t));
      const d = v3.len(v3.sub(p, q));
      if (d < best) {
        best = d;
        bestT = (acc + t * segLen) / total;
      }
      acc += segLen;
    }
    return bestT;
  }

  paint(ctx: CoatContext): CoatSample {
    const { p, n } = ctx;
    const [x, y, z] = p;
    const ax = Math.abs(x);
    const S = this.sculpt;

    const wHead = this.group(ctx, 'head');
    const wEarL = this.group(ctx, 'earL');
    const wEarR = this.group(ctx, 'earR');
    const wEar = wEarL + wEarR;
    const wNeck = this.group(ctx, 'neck');
    const wTorso = this.group(ctx, 'torso');
    const wFront = this.group(ctx, 'front');
    const wHind = this.group(ctx, 'hind');
    const wTail = this.group(ctx, 'tail');

    // ---- base orange with low-frequency variation
    const nLow = fbm3(x * 9, y * 9, z * 9);
    const nMid = fbm3(x * 31 + 5, y * 31, z * 31);
    let col = mixRGB(PALETTE.orange, PALETTE.orangeLight, smoothstep(0.35, 0.75, nLow) * 0.6);
    // Darker, redder saddle along the back.
    const back = smoothstep(0.25, 0.85, n[1]) * (wTorso + wNeck * 0.7 + wTail * 0.5);
    col = mixRGB(col, PALETTE.rust, back * (0.45 + 0.25 * nMid));

    let furLength = 0.36 + 0.06 * nMid;
    let grizzle = back * 0.6;
    let roughness = 0.88;

    // ---- head (masks are authored in head-local coordinates)
    if (wHead > 0.01) {
      const y = p[1] - HEAD_OFFSET[1];
      const z = p[2] - HEAD_OFFSET[2];
      // White lower muzzle, lips, cheeks and chin below a line running from the nose corner
      // back under the eye toward the jaw.
      const lineY = 0.4375 + (0.392 - z) * 0.3;
      const below = smoothstep(lineY + 0.004, lineY - 0.004, y);
      const lateralMuzzle = smoothstep(0.004, 0.012, ax) + smoothstep(-0.1, -0.5, n[1]);
      const white = clamp01(below * clamp01(lateralMuzzle)) * wHead;
      col = mixRGB(col, PALETTE.white, white);

      // Fur is short on the face and longer on the cheek ruff.
      const cheekRuff = smoothstep(0.03, 0.05, ax) * smoothstep(0.31, 0.27, z) * smoothstep(0.47, 0.43, y);
      const muzzle = smoothstep(0.32, 0.36, z);
      const headLen = mix(mix(0.16, 0.07, muzzle), 0.58, cheekRuff);
      furLength = mix(furLength, headLen, wHead);
      grizzle *= 1 - wHead;
      col = mixRGB(col, PALETTE.white, cheekRuff * 0.55 * wHead * smoothstep(0.455, 0.44, y));

      // Dark mouth line where the upper snout meets the jaw.
      const crease = Math.abs(ctx.partDist[this.part('snout')] - ctx.partDist[this.part('jaw')]);
      const mouth = smoothstep(0.0035, 0.0008, crease) * smoothstep(0.3, 0.33, z) * smoothstep(0.004, 0.0, Math.max(0, y - 0.437));
      col = mixRGB(col, PALETTE.black, mouth * 0.9);

      // Eyes: dark rims, tear streak and no fur on the eyelids.
      for (const side of ['L', 'R'] as const) {
        const e = S.eyes[side];
        const d = v3.len(v3.sub(p, e.center)) / e.radius;
        // Black "eyeliner" around the almond-shaped opening.
        const rim = smoothstep(1.85, 1.3, d);
        col = mixRGB(col, PALETTE.black, rim);
        furLength *= smoothstep(1.35, 2.7, d);
        // Tear streak from the inner corner down the side of the muzzle.
        const inner = v3.add(e.center, [-Math.sign(e.center[0]) * 0.006, -0.005, 0.008]);
        const end = v3.add([Math.sign(e.center[0]) * 0.016, 0.442, 0.375], HEAD_OFFSET);
        const tear = segDist(p, inner, end);
        col = mixRGB(col, PALETTE.darkBrown, smoothstep(0.0042, 0.0018, tear) * 0.75);
      }

      // Black nose leather, glossy and furless.
      const dn = v3.len(v3.sub(p, S.nose));
      const noseMask = smoothstep(0.0148, 0.0122, dn) + smoothstep(0.004, -0.002, ctx.partDist[this.part('nose')]) * smoothstep(0.375, 0.39, z);
      const nm = clamp01(noseMask);
      col = mixRGB(col, PALETTE.nose, nm);
      roughness = mix(roughness, 0.32, nm);
      furLength *= 1 - nm;
    }

    // ---- ears: black backs and tips, creamy furred insides
    if (wEar > 0.01) {
      const ear = wEarL >= wEarR ? S.ears.L : S.ears.R;
      const rel = v3.sub(p, ear.base);
      const t = clamp01(v3.dot(rel, ear.up) / ear.height);
      const facing = v3.dot(n, ear.front);
      const inner = smoothstep(0.05, 0.45, facing);
      const across = Math.abs(v3.dot(rel, ear.side)) / Math.max(ear.halfWidth * (1 - t), 1e-3);
      const innerCore = inner * smoothstep(0.95, 0.6, across);
      const backCol = mixRGB(mixRGB(PALETTE.rust, PALETTE.black, smoothstep(0.08, 0.32, t)), PALETTE.black, 0.15);
      // Cream fur inside, darker skin deep in the base of the cup.
      const inside = mixRGB(PALETTE.earInner, PALETTE.earDeep, smoothstep(0.35, 0.0, t) * smoothstep(0.5, 0.0, across) * 0.7);
      let earCol = mixRGB(backCol, inside, innerCore);
      // Black tips all around.
      earCol = mixRGB(earCol, PALETTE.black, smoothstep(0.72, 0.86, t) * (1 - innerCore * 0.6));
      col = mixRGB(col, earCol, wEar);
      const earLen = mix(0.06, mix(0.34, 0.1, t), innerCore);
      furLength = mix(furLength, earLen, wEar);
      grizzle *= 1 - wEar;
    }

    // ---- throat, chest bib and belly
    const fwdDown = v3.dot(n, v3.norm([0, -0.6, 0.8]));
    const bibZone = smoothstep(0.05, 0.4, fwdDown) * smoothstep(0.06, 0.03, ax) * (wNeck + wTorso * smoothstep(0.08, 0.14, z) + wHead * smoothstep(0.43, 0.42, y - HEAD_OFFSET[1]));
    const belly = smoothstep(-0.4, -0.8, n[1]) * wTorso * smoothstep(0.25, 0.23, y) * smoothstep(-0.15, -0.05, z);
    const bib = clamp01(bibZone);
    col = mixRGB(col, PALETTE.white, bib * 0.95);
    col = mixRGB(col, PALETTE.cream, belly * 0.85);
    furLength = mix(furLength, 0.6, bib * (1 - wHead));
    furLength = mix(furLength, 0.44, belly);
    grizzle *= 1 - bib;

    // ---- legs: black "stockings", lighter inner thighs, short fur
    if (wFront + wHind > 0.01) {
      const frontStocking = smoothstep(0.215, 0.165, y) + smoothstep(0.25, 0.2, y) * smoothstep(0.2, 0.6, n[2]) * 0.8;
      const hindStocking = smoothstep(0.145, 0.11, y) + smoothstep(0.2, 0.14, y) * smoothstep(0.2, 0.7, n[2]) * 0.8;
      const stocking = clamp01(clamp01(frontStocking) * wFront + clamp01(hindStocking) * wHind);
      const innerLeg = smoothstep(0.3, 0.8, -n[0] * Math.sign(x)) * wHind * smoothstep(0.2, 0.26, y);
      col = mixRGB(col, PALETTE.cream, innerLeg * 0.35);
      // Linear-space mixing: even a few percent of orange reads as brown, so go fully black.
      col = mixRGB(col, mixRGB(PALETTE.black, PALETTE.darkBrown, nMid * 0.25), smoothstep(0.0, 0.85, stocking));
      const thighPants = this.group(ctx, 'hind') * smoothstep(0.17, 0.24, y);
      const legLen = mix(0.07, 0.24, smoothstep(0.1, 0.24, y));
      furLength = mix(furLength, mix(legLen, 0.42, thighPants), wFront + wHind);
      grizzle *= 1 - (wFront + wHind);
      // Paw pads are a little shinier.
      const pad = smoothstep(-0.6, -0.9, n[1]) * smoothstep(0.012, 0.004, y);
      roughness = mix(roughness, 0.6, pad);
    }

    // ---- tail: long fur, grizzled top and a white tip
    if (wTail > 0.01) {
      const t = this.tailParam(p);
      const tip = smoothstep(0.84, 0.9, t + (nMid - 0.5) * 0.05);
      const tailTop = smoothstep(-0.2, 0.6, n[1]);
      let tc = mixRGB(col, PALETTE.rust, tailTop * 0.35);
      tc = mixRGB(tc, PALETTE.darkBrown, smoothstep(0.7, 0.82, t) * (1 - tip) * 0.55);
      tc = mixRGB(tc, PALETTE.white, tip);
      col = mixRGB(col, tc, wTail);
      const tailLen = mix(0.55, 1.0, smoothstep(0.0, 0.3, t)) * mix(1, 0.85, smoothstep(0.85, 1, t));
      furLength = mix(furLength, tailLen, wTail);
      grizzle = mix(grizzle, (0.35 + 0.4 * tailTop) * (1 - tip), wTail);
    }

    // Fine per-vertex brightness variation so the coat never looks flat.
    const v = 0.92 + 0.16 * nMid;
    col = [col[0] * v, col[1] * v, col[2] * v];

    return { color: col, roughness, furLength: clamp01(furLength), grizzle: clamp01(grizzle), furDir: this.furDir(ctx) };
  }

  private furDir(ctx: CoatContext): V3 {
    let d: V3 = [0, 0, 0];
    for (let i = 0; i < ctx.boneW.length; i++) {
      const w = ctx.boneW[i];
      if (w > 0) d = v3.add(d, v3.scale(this.combs[i], w));
    }
    // Slight gravity so fur droops on the flanks and belly.
    d = v3.add(d, [0, -0.25, 0]);
    const n = ctx.n;
    let t = v3.sub(d, v3.scale(n, v3.dot(d, n)));
    if (v3.len(t) < 1e-4) t = v3.cross(n, [1, 0, 0]);
    return v3.norm(t);
  }
}

function segDist(p: V3, a: V3, b: V3): number {
  const ab = v3.sub(b, a);
  const t = clamp01(v3.dot(v3.sub(p, a), ab) / v3.dot(ab, ab));
  return v3.len(v3.sub(p, v3.add(a, v3.scale(ab, t))));
}
