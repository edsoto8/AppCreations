/**
 * Procedural animation states. Each state writes a full Pose for its local time; the controller
 * crossfades between them. Angles are radians about the bone's local axes: pitch > 0 tips the
 * forward end down (so it raises the backward-pointing tail and tips ears forward), yaw > 0
 * turns toward the fox's left, roll > 0 rolls the top toward the fox's right.
 */
import { MathUtils } from 'three';
import { TAIL_BONES } from '../fox/anatomy';
import { LEG_IDS, REST_FEET, isFront, type LegId, type Pose, type PosedBone } from './Pose';

export type StateId = 'idle' | 'walk' | 'run' | 'sit' | 'look' | 'wag';

export interface AnimState {
  id: StateId;
  label: string;
  /** Crossfade time when entering this state, seconds. */
  fadeIn: number;
  /** Whether the state's clock should restart every time it is entered. */
  restart: boolean;
  evaluate(t: number, out: Pose): void;
}

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const smoother = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const fract = (x: number) => x - Math.floor(x);

/** Smoothly interpolated keyframes [time, value], clamped at both ends. */
function keys(t: number, k: [number, number][]): number {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const [t0, v0] = k[i - 1];
      const [t1, v1] = k[i];
      return v0 + (v1 - v0) * smoother((t - t0) / (t1 - t0));
    }
  }
  return k[k.length - 1][1];
}

const tail = (i: number) => TAIL_BONES[i] as PosedBone;

/** Common relaxed standing posture shared by idle-like states. */
function stand(out: Pose, t: number): void {
  out.reset();
  // Weight shifts and a slow, small head drift.
  out.hips.x = 0.003 * Math.sin(t * 0.45);
  out.hips.y = -0.002 + 0.0015 * Math.sin(t * 0.7);
  out.set('hips', 0.0, 0.01 * Math.sin(t * 0.45), -0.015 * Math.sin(t * 0.45));
  out.set('neck', 0.02 + 0.03 * Math.sin(t * 0.31), 0.06 * Math.sin(t * 0.23));
  out.set('head', -0.04 + 0.03 * Math.sin(t * 0.37 + 1), 0.05 * Math.sin(t * 0.29 + 2), 0.04 * Math.sin(t * 0.21));
  out.set('ear_L', 0, 0.06);
  out.set('ear_R', 0, -0.06);
  // Tail held low and relaxed with a lazy sway.
  for (let i = 0; i < TAIL_BONES.length; i++) {
    const base = i === 0 ? -0.12 : i < 3 ? 0.04 : -0.06;
    out.set(tail(i), base, 0.07 * Math.sin(t * 0.8 - i * 0.6));
  }
}

// ----------------------------------------------------------------------------- idle
export const idleState: AnimState = {
  id: 'idle',
  label: 'Idle',
  fadeIn: 0.6,
  restart: false,
  evaluate(t, out) {
    stand(out, t);
    out.breathRate = 0.32;
    out.breathDepth = 1;
  },
};

// ----------------------------------------------------------------------------- gaits
interface GaitParams {
  period: number;
  duty: number;
  speed: number;
  phase: Record<LegId, number>;
  lift: { front: number; hind: number };
  /** Stance centre offset along z per leg type. */
  centre: { front: number; hind: number };
  /** Lower-segment pitch keyframes through swing (0..1). */
  swingPitch: { front: [number, number][]; hind: [number, number][] };
  heelLift: { front: number; hind: number };
}

const WALK: GaitParams = {
  period: 0.95,
  duty: 0.64,
  speed: 0.34,
  // Lateral-sequence walk: LH, LF, RH, RF.
  phase: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 },
  lift: { front: 0.042, hind: 0.036 },
  centre: { front: -0.008, hind: 0.004 },
  swingPitch: {
    front: [[0, 0.45], [0.35, 1.55], [0.75, -0.12], [1, -0.08]],
    hind: [[0, 0.4], [0.4, 0.95], [0.8, -0.05], [1, 0]],
  },
  heelLift: { front: 0.45, hind: 0.35 },
};

const RUN: GaitParams = {
  period: 0.44,
  duty: 0.34,
  speed: 1.9,
  // Rotary gallop: hind pair, then front pair.
  phase: { HL: 0, HR: 0.09, FL: 0.42, FR: 0.52 },
  lift: { front: 0.075, hind: 0.065 },
  centre: { front: 0.01, hind: -0.01 },
  swingPitch: {
    front: [[0, 0.7], [0.3, 2.0], [0.7, 0.2], [0.9, -0.25], [1, -0.2]],
    hind: [[0, 0.7], [0.35, 1.25], [0.75, 0.0], [1, -0.05]],
  },
  heelLift: { front: 0.6, hind: 0.55 },
};

/** Writes foot goals for a gait cycle position. Returns nothing; pose legs are updated. */
function gaitLegs(out: Pose, cycle: number, g: GaitParams): void {
  const stride = g.speed * g.duty * g.period;
  for (const leg of LEG_IDS) {
    const front = isFront(leg);
    const l = out.legs[leg];
    const rest = REST_FEET[leg];
    const zc = rest[2] + (front ? g.centre.front : g.centre.hind);
    const ph = fract(cycle + g.phase[leg]);
    const lift = front ? g.lift.front : g.lift.hind;
    if (ph < g.duty) {
      // Stance: paw planted, sliding back with the ground.
      const q = ph / g.duty;
      l.foot.set(rest[0], rest[1], zc + stride * (0.5 - q));
      const heel = front ? g.heelLift.front : g.heelLift.hind;
      l.lowerPitch = MathUtils.lerp(-0.08, heel, smooth((q - 0.45) / 0.55));
      l.toePitch = 0;
    } else {
      // Swing: lift, fold, reach forward, plant.
      const s = (ph - g.duty) / (1 - g.duty);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * s);
      // Lands exactly as the swing ends, so the paw never slides on the ground.
      const arc = Math.sin(Math.PI * s) ** 0.8;
      l.foot.set(rest[0], rest[1] + lift * arc, zc + stride * (e - 0.5));
      l.lowerPitch = keys(s, front ? g.swingPitch.front : g.swingPitch.hind);
      l.toePitch = l.lowerPitch * 0.6 + 0.35 * Math.sin(Math.PI * s);
    }
  }
}

export const walkState: AnimState = {
  id: 'walk',
  label: 'Walk',
  fadeIn: 0.45,
  restart: false,
  evaluate(t, out) {
    out.reset();
    const g = WALK;
    const c = t / g.period;
    const w = c * TAU;
    gaitLegs(out, c, g);
    out.speed = g.speed;
    // Two bobs per cycle (one per hind footfall), gentle roll and spinal yaw.
    out.hips.y = -0.008 + 0.004 * Math.cos(w * 2 + 0.6);
    out.hips.x = 0.003 * Math.sin(w);
    out.set('hips', 0.01 * Math.sin(w * 2), 0.03 * Math.sin(w), 0.025 * Math.sin(w + 0.4));
    out.set('spine1', 0, -0.015 * Math.sin(w));
    out.set('spine2', 0, -0.015 * Math.sin(w));
    out.set('chest', -0.01 * Math.sin(w * 2 + 1), -0.02 * Math.sin(w + 0.5), -0.03 * Math.sin(w + 0.9));
    // Head carried low and forward, stabilised against the bob.
    out.set('neck', 0.16 + 0.025 * Math.sin(w * 2 + 1.4), 0.02 * Math.sin(w + 1));
    out.set('head', -0.13 - 0.02 * Math.sin(w * 2 + 1.4), -0.03 * Math.sin(w + 1));
    out.set('ear_L', -0.08, 0.05);
    out.set('ear_R', -0.08, -0.05);
    for (let i = 0; i < TAIL_BONES.length; i++) {
      const base = i === 0 ? 0.1 : i < 3 ? 0.0 : 0.04;
      out.set(tail(i), base + 0.03 * Math.sin(w * 2 - i * 0.7), 0.1 * Math.sin(w - 0.8 - i * 0.55));
    }
    out.breathRate = 0.55;
    out.breathDepth = 1.1;
    out.fidget = 0.5;
  },
};

export const runState: AnimState = {
  id: 'run',
  label: 'Run',
  fadeIn: 0.35,
  restart: false,
  evaluate(t, out) {
    out.reset();
    const g = RUN;
    const c = t / g.period;
    const w = c * TAU;
    gaitLegs(out, c, g);
    out.speed = g.speed;
    // Spine flexes as the hind legs gather and extends after push-off.
    const flex = Math.sin(w - 0.9);
    out.hips.y = -0.03 + 0.022 * Math.sin(w + 0.6);
    out.hips.z = 0.008 * flex;
    out.set('hips', 0.12 * flex, 0.02 * Math.sin(w), 0.02 * Math.sin(w));
    out.set('spine1', -0.07 * flex);
    out.set('spine2', -0.06 * flex);
    out.set('chest', -0.05 * flex + 0.06 * Math.sin(w + 2.2));
    out.set('neck', 0.3 - 0.06 * Math.sin(w + 2.4));
    out.set('head', -0.24 + 0.05 * Math.sin(w + 2.4));
    // Ears pinned back by the wind.
    out.set('ear_L', -0.45, 0.25, 0.1);
    out.set('ear_R', -0.45, -0.25, -0.1);
    // Tail streams out behind, close to horizontal.
    for (let i = 0; i < TAIL_BONES.length; i++) {
      // The first bone cancels most of the hip flexion so the tail keeps streaming out level.
      const base = i === 0 ? 0.3 - 0.1 * flex : i < 3 ? 0.04 : 0.05;
      out.set(tail(i), base + 0.05 * Math.sin(w - 0.5 - i * 0.6), 0.05 * Math.sin(w * 0.5 - i * 0.5));
    }
    out.eyelid = 0.12;
    out.breathRate = 2.2;
    out.breathDepth = 1.4;
    out.fidget = 0.15;
  },
};

// ----------------------------------------------------------------------------- sit
/** Seated tail: heading of each segment in the ground plane (0 = straight back) and its drop. */
const SIT_TAIL_HEADING = [0.35, 1.25, 2.0, 2.55, 2.9, 3.05];
const SIT_TAIL_DROP = [1.2, 0.25, 0.05, 0, 0, 0];
export const sitState: AnimState = {
  id: 'sit',
  label: 'Sit',
  fadeIn: 0.25,
  restart: true,
  evaluate(t, out) {
    stand(out, t);
    // Staggered transition: rump lowers first, the chest rises, then the tail wraps.
    const pr = smoother(t / 1.0);
    const pf = smoother((t - 0.2) / 1.0);
    const pt = smoother((t - 0.55) / 0.9);
    const settle = 0.004 * Math.sin(t * 0.6) * pf;

    out.hips.set(0, MathUtils.lerp(out.hips.y, -0.218, pr), MathUtils.lerp(0, 0.03, pr));
    out.set('hips', -0.72 * pr, 0, 0);
    out.set('spine1', -0.12 * pf);
    out.set('spine2', -0.06 * pf);
    out.set('chest', (0.2 + settle) * pf);
    out.set('neck', 0.28 * pf + 0.02 * Math.sin(t * 0.31), 0.06 * Math.sin(t * 0.23));
    out.set('head', 0.36 * pf - 0.04 + 0.03 * Math.sin(t * 0.37 + 1), 0.05 * Math.sin(t * 0.29 + 2), 0.03 * Math.sin(t * 0.21));

    for (const leg of LEG_IDS) {
      const l = out.legs[leg];
      const side = leg[1] === 'L' ? 1 : -1;
      if (isFront(leg)) {
        // Front legs straight and slightly back under the chest.
        l.foot.set(side * 0.05, REST_FEET[leg][1], MathUtils.lerp(REST_FEET[leg][2], 0.125, pf));
        l.lowerPitch = MathUtils.lerp(0, -0.12, pf);
      } else {
        // Hind legs fold: hocks on the ground, paws forward, knees out and up.
        l.foot.set(side * MathUtils.lerp(0.055, 0.066, pr), REST_FEET[leg][1], MathUtils.lerp(REST_FEET[leg][2], -0.085, pr));
        l.lowerPitch = MathUtils.lerp(0, -1.05, pr);
        l.toePitch = MathUtils.lerp(0, -0.05, pr);
        l.pole.set(side * 0.35, MathUtils.lerp(0, 0.8, pr), 1).normalize();
      }
    }

    // Tail drops to the ground behind the rump, then curls forward around the hind paws on the
    // fox's left. Directions are in root space; the rig aims each tail segment along them.
    for (let i = 0; i < TAIL_BONES.length; i++) {
      const a = SIT_TAIL_HEADING[i] * pt + 0.04 * Math.sin(t * 0.5 - i * 0.6) * pt;
      out.tailAim[i].set(Math.sin(a), -SIT_TAIL_DROP[i], -Math.cos(a)).normalize();
    }
    out.tailAimWeight = pr;
    out.set('ear_L', -0.02, 0.1);
    out.set('ear_R', -0.02, -0.1);
    out.eyelid = 0.12 * pf;
    out.breathRate = 0.28;
    out.breathDepth = 1.1;
  },
};

// ----------------------------------------------------------------------------- look around
const LOOK_PERIOD = 10;
/** Head turn (+1 left, -1 right) and look-up keyframes over one look-around cycle. */
const LOOK_YAW: [number, number][] = [
  [0, 0], [1.2, 0], [2.2, 1], [3.6, 1], [5.0, -1], [6.4, -1], [7.2, 0], [9.0, 0], [LOOK_PERIOD, 0],
];
const LOOK_UP: [number, number][] = [[0, 0], [6.8, 0], [7.5, 1], [8.6, 1], [9.4, 0], [LOOK_PERIOD, 0]];

export const lookState: AnimState = {
  id: 'look',
  label: 'Look Around',
  fadeIn: 0.5,
  restart: true,
  evaluate(t, out) {
    stand(out, t);
    const lt = t % LOOK_PERIOD;
    // Eyes lead, head follows: the yaw keys for the eyes are shifted earlier.
    const yaw = keys(lt, LOOK_YAW);
    const eyeYaw = keys(lt + 0.25, LOOK_YAW) - yaw;
    const up = keys(lt, LOOK_UP);
    const sniff = up * 0.025 * Math.sin(t * 38) * (Math.sin(t * 3) > 0 ? 1 : 0.3);

    out.set('neck', 0.02 - 0.12 * up, 0.42 * yaw, 0);
    out.set('head', -0.06 - 0.32 * up + sniff, 0.55 * yaw, 0.16 * yaw);
    out.set('chest', 0, 0.06 * yaw);
    out.set('spine2', 0, 0.04 * yaw);
    out.eyeYaw = 0.35 * eyeYaw;
    out.eyePitch = 0.12 * up;
    // Ears swivel independently: the ear toward the sound turns out and forward.
    const left = Math.max(0, yaw), right = Math.max(0, -yaw);
    out.set('ear_L', -0.05 - 0.15 * right, 0.1 + 0.45 * left - 0.2 * right, 0);
    out.set('ear_R', -0.05 - 0.15 * left, -0.1 - 0.45 * right + 0.2 * left, 0);
    if (up > 0) {
      out.add('ear_L', -0.12 * up, 0.15 * up);
      out.add('ear_R', -0.12 * up, -0.15 * up);
    }
    out.fidget = 0.35;
    out.breathRate = 0.36 + 0.4 * up;
  },
};

// ----------------------------------------------------------------------------- tail wag
export const wagState: AnimState = {
  id: 'wag',
  label: 'Tail Wag',
  fadeIn: 0.4,
  restart: false,
  evaluate(t, out) {
    stand(out, t);
    const f = 2.6;
    const w = t * f * TAU;
    // Tail raised, sweeping side to side with the wave travelling to the tip.
    for (let i = 0; i < TAIL_BONES.length; i++) {
      const amp = 0.15 + i * 0.05;
      // Carried level and high: the rest pose droops, so lift every segment a little.
      const base = i === 0 ? 0.55 : 0.05;
      out.set(tail(i), base, amp * Math.sin(w - i * 0.55));
    }
    // Hips counter-sway and an excited, slightly lowered head.
    out.set('hips', 0, -0.035 * Math.sin(w), 0.02 * Math.sin(w));
    out.hips.x = -0.003 * Math.sin(w);
    out.set('neck', 0.06 + 0.02 * Math.sin(w * 2), 0.03 * Math.sin(w + 1));
    out.set('head', -0.02, 0.04 * Math.sin(w + 1.5), 0.06 * Math.sin(t * 1.3));
    out.set('ear_L', -0.25, 0.3);
    out.set('ear_R', -0.25, -0.3);
    out.eyelid = 0.28;
    out.breathRate = 1.6;
    out.breathDepth = 1.2;
    out.fidget = 0.4;
  },
};

export const STATES: AnimState[] = [idleState, walkState, runState, sitState, lookState, wagState];
