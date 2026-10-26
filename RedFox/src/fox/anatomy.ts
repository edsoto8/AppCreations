/**
 * Fox anatomy: the skeleton (rest pose) and the sculpted signed-distance body.
 *
 * Units are metres. The fox faces +Z, +Y is up and +X is the fox's left side. All bones have
 * identity rotation in the rest pose, so a bone's local axes match the world axes at rest; this
 * keeps the IK and procedural animation code simple.
 */
import { Ear, Ellipsoid, RoundCone, Sphere, v3, type EarFrame, type V3 } from './sdf/primitives';
import { SdfModel } from './sdf/SdfModel';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Rest position in fox (model) space. */
  pos: V3;
}

const L = (p: V3): V3 => p;
const R = (p: V3): V3 => v3.mirrorX(p);

function sided(name: string, parent: string | null, pos: V3, parentSided: boolean): BoneDef[] {
  return [
    { name: `${name}_L`, parent: parent && parentSided ? `${parent}_L` : parent, pos: L(pos) },
    { name: `${name}_R`, parent: parent && parentSided ? `${parent}_R` : parent, pos: R(pos) },
  ];
}

/**
 * Offset applied to every head feature. Lets the head carriage be tuned without re-entering
 * dozens of coordinates (the coat painter subtracts it to get head-local positions).
 */
export const HEAD_OFFSET: V3 = [0, -0.014, -0.006];
function hp(p: V3): V3 {
  return [p[0] + HEAD_OFFSET[0], p[1] + HEAD_OFFSET[1], p[2] + HEAD_OFFSET[2]];
}

/** Key joint positions (left side where sided). */
export const JOINTS = {
  hips: [0, 0.345, -0.17] as V3,
  spine1: [0, 0.355, -0.075] as V3,
  spine2: [0, 0.36, 0.02] as V3,
  ribs: [0, 0.3, 0.02] as V3,
  chest: [0, 0.355, 0.11] as V3,
  neck: [0, 0.375, 0.185] as V3,
  head: hp([0, 0.448, 0.262]),
  ear: hp([0.031, 0.494, 0.27]),
  scapula: [0.045, 0.355, 0.125] as V3,
  shoulder: [0.058, 0.282, 0.15] as V3,
  elbow: [0.056, 0.19, 0.1] as V3,
  wrist: [0.054, 0.055, 0.14] as V3,
  fPaw: [0.054, 0.018, 0.158] as V3,
  fToeEnd: [0.054, 0.012, 0.19] as V3,
  hip: [0.056, 0.31, -0.195] as V3,
  knee: [0.06, 0.205, -0.13] as V3,
  hock: [0.056, 0.095, -0.248] as V3,
  hPaw: [0.055, 0.02, -0.215] as V3,
  hToeEnd: [0.055, 0.012, -0.18] as V3,
  tail: [
    [0, 0.338, -0.265],
    [0, 0.312, -0.345],
    [0, 0.275, -0.425],
    [0, 0.238, -0.505],
    [0, 0.208, -0.585],
    [0, 0.19, -0.66],
    [0, 0.185, -0.725],
  ] as V3[],
};

export const TAIL_BONES = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'];

export const BONE_DEFS: BoneDef[] = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: JOINTS.hips },
  { name: 'spine1', parent: 'hips', pos: JOINTS.spine1 },
  { name: 'spine2', parent: 'spine1', pos: JOINTS.spine2 },
  { name: 'ribs', parent: 'spine2', pos: JOINTS.ribs },
  { name: 'chest', parent: 'spine2', pos: JOINTS.chest },
  { name: 'neck', parent: 'chest', pos: JOINTS.neck },
  { name: 'head', parent: 'neck', pos: JOINTS.head },
  ...sided('ear', 'head', JOINTS.ear, false),
  ...sided('scapula', 'chest', JOINTS.scapula, false),
  ...sided('upperArm', 'scapula', JOINTS.shoulder, true),
  ...sided('foreArm', 'upperArm', JOINTS.elbow, true),
  ...sided('hand', 'foreArm', JOINTS.wrist, true),
  ...sided('fToe', 'hand', JOINTS.fPaw, true),
  ...sided('fToeEnd', 'fToe', JOINTS.fToeEnd, true),
  ...sided('thigh', 'hips', JOINTS.hip, false),
  ...sided('shin', 'thigh', JOINTS.knee, true),
  ...sided('meta', 'shin', JOINTS.hock, true),
  ...sided('hToe', 'meta', JOINTS.hPaw, true),
  ...sided('hToeEnd', 'hToe', JOINTS.hToeEnd, true),
  ...TAIL_BONES.map((name, i) => ({
    name,
    parent: i === 0 ? 'hips' : TAIL_BONES[i - 1],
    pos: JOINTS.tail[i],
  })),
  { name: 'tailEnd', parent: 'tail6', pos: JOINTS.tail[6] },
];

export const BONE_INDEX: Record<string, number> = Object.fromEntries(BONE_DEFS.map((b, i) => [b.name, i]));

export function boneIndex(name: string): number {
  const i = BONE_INDEX[name];
  if (i === undefined) throw new Error(`Unknown bone '${name}'`);
  return i;
}

export const EYE_RADIUS = 0.0105;
const NOSE: V3 = hp([0, 0.44, 0.4115]);

export interface EyePlacement {
  center: V3;
  /** Unit gaze direction at rest. */
  gaze: V3;
  radius: number;
}

export interface FoxSculpt {
  model: SdfModel;
  eyes: { L: EyePlacement; R: EyePlacement };
  ears: { L: EarFrame; R: EarFrame };
  nose: V3;
  tailPath: V3[];
  bounds: { min: V3; max: V3 };
}

/** Builds the fox's signed distance body. Deterministic and pure (runs inside a worker). */
export function sculptFox(): FoxSculpt {
  const m = new SdfModel();
  const b = boneIndex;
  const both = (fn: (s: 'L' | 'R', mirror: (p: V3) => V3) => void) => {
    fn('L', L);
    fn('R', R);
  };

  // ---------------------------------------------------------------- torso
  m.add({ name: 'ribcage', prim: new Ellipsoid([0, 0.302, 0.03], [0.064, 0.086, 0.11], [0.12, 0, 0]), bone: b('ribs'), k: 0, op: 'union' });
  m.add({ name: 'chest', prim: new Ellipsoid([0, 0.298, 0.105], [0.062, 0.094, 0.08], [-0.25, 0, 0]), bone: b('chest'), k: 0.05, op: 'union' });
  m.add({ name: 'withers', prim: new Ellipsoid([0, 0.345, 0.08], [0.048, 0.045, 0.085]), bone: b('chest'), k: 0.04, op: 'union' });
  m.add({ name: 'waist', prim: new Ellipsoid([0, 0.327, -0.1], [0.052, 0.058, 0.085], [-0.06, 0, 0]), bone: b('spine1'), k: 0.055, op: 'union' });
  m.add({ name: 'rump', prim: new Ellipsoid([0, 0.322, -0.188], [0.06, 0.066, 0.08]), bone: b('hips'), k: 0.05, op: 'union' });
  m.add({ name: 'brisket', prim: new Ellipsoid([0, 0.252, 0.135], [0.046, 0.058, 0.05], [0.35, 0, 0]), bone: b('chest'), k: 0.045, op: 'union' });

  // ---------------------------------------------------------------- neck
  m.add({
    name: 'neck',
    prim: new RoundCone([0, 0.318, 0.13], hp([0, 0.43, 0.262]), 0.066, 0.048, [0.84, 1]),
    bone: b('neck'),
    k: 0.04,
    op: 'union',
  });
  m.add({ name: 'throat', prim: new Ellipsoid([0, 0.355, 0.208], [0.044, 0.056, 0.05], [0.6, 0, 0]), bone: b('neck'), k: 0.035, op: 'union' });

  // ---------------------------------------------------------------- head
  m.add({ name: 'cranium', prim: new Ellipsoid(hp([0, 0.458, 0.283]), [0.048, 0.043, 0.054]), bone: b('head'), k: 0.03, op: 'union' });
  both((s, f) =>
    m.add({ name: `cheek_${s}`, prim: new Ellipsoid(f(hp([0.034, 0.44, 0.283])), [0.03, 0.028, 0.038], [0, 0, 0]), bone: b('head'), k: 0.022, op: 'union' }),
  );
  m.add({
    name: 'snout',
    prim: new RoundCone(hp([0, 0.45, 0.31]), hp([0, 0.4385, 0.403]), 0.027, 0.0102, [0.95, 0.86]),
    bone: b('head'),
    k: 0.022,
    op: 'union',
  });
  m.add({ name: 'muzzleBridge', prim: new Ellipsoid(hp([0, 0.455, 0.345]), [0.019, 0.013, 0.045], [0.14, 0, 0]), bone: b('head'), k: 0.014, op: 'union' });
  m.add({
    name: 'jaw',
    prim: new RoundCone(hp([0, 0.426, 0.298]), hp([0, 0.4255, 0.389]), 0.022, 0.0075, [1, 0.8]),
    bone: b('head'),
    k: 0.012,
    op: 'union',
  });
  m.add({ name: 'nose', prim: new Ellipsoid(NOSE, [0.0112, 0.0088, 0.0095]), bone: b('head'), k: 0.006, op: 'union' });
  both((s, f) =>
    m.add({ name: `brow_${s}`, prim: new Ellipsoid(f(hp([0.024, 0.47, 0.322])), [0.017, 0.011, 0.02], [0, 0.3, 0]), bone: b('head'), k: 0.016, op: 'union' }),
  );

  // Ears: large, cupped, set wide and angled slightly outward.
  const ears: Partial<Record<'L' | 'R', EarFrame>> = {};
  both((s, f) => {
    const ear = new Ear(f(hp([0.039, 0.482, 0.272])), f(hp([0.074, 0.572, 0.248])), f([0.55, 0.08, 1]), 0.036, 0.0045, 0.014, 0.003);
    ears[s] = ear.frame;
    m.add({ name: `ear_${s}`, prim: ear, bone: b(`ear_${s}`), k: 0.012, op: 'union' });
  });

  // ---------------------------------------------------------------- front legs
  both((s, f) => {
    m.add({ name: `shoulderMass_${s}`, prim: new Ellipsoid(f([0.047, 0.29, 0.135]), [0.032, 0.07, 0.048], [-0.35, 0, 0]), bone: b(`scapula_${s}`), k: 0.03, op: 'union' });
    m.add({ name: `upperArm_${s}`, prim: new RoundCone(f(JOINTS.shoulder), f(JOINTS.elbow), 0.03, 0.018), bone: b(`upperArm_${s}`), k: 0.025, op: 'union' });
    m.add({ name: `forearmMuscle_${s}`, prim: new Ellipsoid(f([0.056, 0.155, 0.108]), [0.016, 0.04, 0.018], [0.28, 0, 0]), bone: b(`foreArm_${s}`), k: 0.012, op: 'union' });
    m.add({ name: `foreArm_${s}`, prim: new RoundCone(f(JOINTS.elbow), f(JOINTS.wrist), 0.016, 0.0092), bone: b(`foreArm_${s}`), k: 0.012, op: 'union' });
    m.add({ name: `hand_${s}`, prim: new RoundCone(f(JOINTS.wrist), f([0.054, 0.022, 0.152]), 0.0095, 0.0112), bone: b(`hand_${s}`), k: 0.008, op: 'union' });
    m.add({ name: `fPaw_${s}`, prim: new Ellipsoid(f([0.054, 0.0145, 0.165]), [0.0165, 0.0135, 0.0245]), bone: b(`fToe_${s}`), k: 0.01, op: 'union' });
  });

  // ---------------------------------------------------------------- hind legs
  both((s, f) => {
    // Broad, laterally flattened thigh that tapers into the stifle, like a fox's furry "pants".
    m.add({ name: `thighMass_${s}`, prim: new Ellipsoid(f([0.05, 0.262, -0.172]), [0.031, 0.086, 0.066], [-0.28, 0, 0]), bone: b(`thigh_${s}`), k: 0.045, op: 'union' });
    m.add({ name: `thigh_${s}`, prim: new RoundCone(f(JOINTS.hip), f(JOINTS.knee), 0.028, 0.0135, [0.8, 1]), bone: b(`thigh_${s}`), k: 0.03, op: 'union' });
    m.add({ name: `calf_${s}`, prim: new Ellipsoid(f([0.058, 0.158, -0.178]), [0.0135, 0.04, 0.019], [-0.75, 0, 0]), bone: b(`shin_${s}`), k: 0.016, op: 'union' });
    m.add({ name: `shin_${s}`, prim: new RoundCone(f(JOINTS.knee), f(JOINTS.hock), 0.0135, 0.0088, [0.85, 1]), bone: b(`shin_${s}`), k: 0.014, op: 'union' });
    m.add({ name: `heel_${s}`, prim: new Sphere(f([0.056, 0.097, -0.253]), 0.0095), bone: b(`meta_${s}`), k: 0.01, op: 'union' });
    m.add({ name: `meta_${s}`, prim: new RoundCone(f(JOINTS.hock), f([0.055, 0.024, -0.222]), 0.009, 0.0098), bone: b(`meta_${s}`), k: 0.008, op: 'union' });
    m.add({ name: `hPaw_${s}`, prim: new Ellipsoid(f([0.055, 0.0145, -0.206]), [0.0165, 0.0135, 0.025]), bone: b(`hToe_${s}`), k: 0.01, op: 'union' });
  });

  // ---------------------------------------------------------------- tail (thick, bushy core)
  // Many short cones along a Catmull-Rom spline through the tail joints, with a smooth radius
  // profile, so the tail reads as one plume instead of a string of beads.
  const TAIL_SAMPLES = 24;
  const tailProfile: [number, number][] = [[0, 0.021], [0.12, 0.03], [0.32, 0.039], [0.55, 0.0425], [0.75, 0.04], [0.9, 0.032], [1, 0.017]];
  const radiusAt = (t: number) => {
    for (let i = 1; i < tailProfile.length; i++) {
      const [t0, r0] = tailProfile[i - 1], [t1, r1] = tailProfile[i];
      if (t <= t1) {
        const u = (t - t0) / (t1 - t0);
        return r0 + (r1 - r0) * u * u * (3 - 2 * u);
      }
    }
    return tailProfile[tailProfile.length - 1][1];
  };
  let prev = catmullRom(JOINTS.tail, 0);
  for (let i = 1; i <= TAIL_SAMPLES; i++) {
    const t0 = (i - 1) / TAIL_SAMPLES, t1 = i / TAIL_SAMPLES;
    const next = catmullRom(JOINTS.tail, t1);
    const bone = TAIL_BONES[Math.min(TAIL_BONES.length - 1, Math.floor(((t0 + t1) / 2) * TAIL_BONES.length))];
    m.add({
      name: `tail_${i}`,
      prim: new RoundCone(prev, next, radiusAt(t0), radiusAt(t1), [1.06, 0.95]),
      bone: b(bone),
      k: i === 1 ? 0.035 : 0.012,
      op: 'union',
    });
    prev = next;
  }

  // ---------------------------------------------------------------- eyes
  // Place each eye so it sits partly sunk in the head surface along its gaze direction.
  const gazeL = v3.norm([0.5, 0.06, 1]);
  const eyeL = placeEye(m, hp([0.012, 0.462, 0.315]), gazeL, EYE_RADIUS);
  const eyeR: EyePlacement = { center: R(eyeL.center), gaze: R(eyeL.gaze), radius: eyeL.radius };
  // A shallow socket keeps the skin from poking through the eyeball where they meet.
  both((s) => {
    const e = s === 'L' ? eyeL : eyeR;
    m.add({ name: `eyeSocket_${s}`, prim: new Sphere(e.center, e.radius * 0.97), bone: b('head'), k: 0.002, op: 'subtract' });
  });
  // Nostrils.
  both((s, f) =>
    m.add({ name: `nostril_${s}`, prim: new Sphere(f(hp([0.0052, 0.4392, 0.4205])), 0.003), bone: b('head'), k: 0.002, op: 'subtract' }),
  );

  return {
    model: m,
    eyes: { L: eyeL, R: eyeR },
    ears: { L: ears.L!, R: ears.R! },
    nose: NOSE,
    tailPath: JOINTS.tail,
    bounds: { min: [-0.15, -0.004, -0.79], max: [0.15, 0.62, 0.44] },
  };
}

/** Uniform Catmull-Rom spline through `pts`, t in [0, 1]. */
function catmullRom(pts: V3[], t: number): V3 {
  const n = pts.length - 1;
  const f = Math.min(t * n, n - 1e-9);
  const i = Math.floor(f);
  const u = f - i;
  const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n)];
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] =
      0.5 *
      (2 * p1[k] + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u);
  }
  return out;
}

/**
 * Slides an eye outward along its gaze from a point inside the skull until the surface sits at
 * the requested depth on the eyeball (about 45% of the eyeball shows).
 */
function placeEye(m: SdfModel, seed: V3, gaze: V3, radius: number): EyePlacement {
  // How far the front of the eyeball rises above the skin.
  const protrude = radius * 0.42;
  let lo = 0, hi = 0.06;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const c = v3.add(seed, v3.scale(gaze, mid));
    // Distance from the eye's front point to the surface.
    const front = v3.add(c, v3.scale(gaze, radius));
    const d = m.eval(front[0], front[1], front[2]);
    if (d < protrude) lo = mid;
    else hi = mid;
  }
  const center = v3.add(seed, v3.scale(gaze, (lo + hi) / 2));
  return { center, gaze, radius };
}
