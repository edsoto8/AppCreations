/**
 * A parametric pose. States write poses; the controller blends them; the rig applies the result.
 *
 * Legs are described by goals (paw position, lower-segment pitch, toe pitch, knee pole) rather
 * than joint angles, so blending two poses keeps the paws on the ground and transitions such as
 * stand -> sit stay anatomically plausible. Everything else is a local bone rotation.
 */
import { Euler, Quaternion, Vector3 } from 'three';
import { JOINTS, TAIL_BONES } from '../fox/anatomy';
import type { V3 } from '../fox/sdf/primitives';

export const LEG_IDS = ['FL', 'FR', 'HL', 'HR'] as const;
export type LegId = (typeof LEG_IDS)[number];

/** Bones whose local rotation comes straight from the pose. Legs are solved by IK. */
export const POSED_BONES = ['hips', 'spine1', 'spine2', 'chest', 'neck', 'head', 'ear_L', 'ear_R', ...TAIL_BONES] as const;
export type PosedBone = (typeof POSED_BONES)[number];

export interface LegPose {
  /** Paw (toe joint) position in fox root space. */
  foot: Vector3;
  /** Rotation of the lower segment (metacarpus / metatarsus) about the lateral axis, relative to rest. Positive tips the paw backward. */
  lowerPitch: number;
  /** Rotation of the toes about the lateral axis relative to rest (positive curls them back). */
  toePitch: number;
  /** Direction the elbow/knee should point, in root space. */
  pole: Vector3;
}

export const REST_FEET: Record<LegId, V3> = {
  FL: JOINTS.fPaw,
  FR: [-JOINTS.fPaw[0], JOINTS.fPaw[1], JOINTS.fPaw[2]],
  HL: JOINTS.hPaw,
  HR: [-JOINTS.hPaw[0], JOINTS.hPaw[1], JOINTS.hPaw[2]],
};

export const isFront = (leg: LegId) => leg[0] === 'F';

export class Pose {
  /** Translation of the hips from rest, in root space. */
  readonly hips = new Vector3();
  readonly rot = {} as Record<PosedBone, Quaternion>;
  readonly legs = {} as Record<LegId, LegPose>;
  /** Extra eyelid closure (0 open .. 1 closed) on top of blinking. */
  eyelid = 0;
  eyeYaw = 0;
  eyePitch = 0;
  /** Breaths per second and depth (1 = calm idle). */
  breathRate = 0.3;
  breathDepth = 1;
  /** How much random ear twitching / gaze darting is allowed (0..1). */
  fidget = 1;
  /** Ground speed in m/s (drives scrolling and fur wind). */
  speed = 0;
  /**
   * Optional root-space directions for each tail segment, blended over the FK tail by
   * `tailAimWeight`. Lets a state lay the tail along the ground in any shape.
   */
  readonly tailAim: Vector3[] = TAIL_BONES.map(() => new Vector3(0, 0, -1));
  tailAimWeight = 0;

  constructor() {
    for (const b of POSED_BONES) this.rot[b] = new Quaternion();
    for (const leg of LEG_IDS) {
      this.legs[leg] = { foot: new Vector3(), lowerPitch: 0, toePitch: 0, pole: new Vector3() };
    }
    this.reset();
  }

  /** Back to the sculpted rest stance. */
  reset(): this {
    this.hips.set(0, 0, 0);
    for (const b of POSED_BONES) this.rot[b].identity();
    for (const leg of LEG_IDS) {
      const l = this.legs[leg];
      l.foot.set(...REST_FEET[leg]);
      l.lowerPitch = 0;
      l.toePitch = 0;
      l.pole.set(0, 0, isFront(leg) ? -1 : 1);
    }
    this.eyelid = 0;
    this.eyeYaw = 0;
    this.eyePitch = 0;
    this.breathRate = 0.3;
    this.breathDepth = 1;
    this.fidget = 1;
    this.speed = 0;
    for (const d of this.tailAim) d.set(0, 0, -1);
    this.tailAimWeight = 0;
    return this;
  }

  private static readonly euler = new Euler(0, 0, 0, 'YXZ');
  private static readonly q = new Quaternion();

  /** Sets a bone rotation from pitch (x), yaw (y) and roll (z) in radians. */
  set(bone: PosedBone, pitch: number, yaw = 0, roll = 0): this {
    this.rot[bone].setFromEuler(Pose.euler.set(pitch, yaw, roll, 'YXZ'));
    return this;
  }

  /** Multiplies an extra rotation onto a bone (applied in the bone's local frame). */
  add(bone: PosedBone, pitch: number, yaw = 0, roll = 0): this {
    Pose.q.setFromEuler(Pose.euler.set(pitch, yaw, roll, 'YXZ'));
    this.rot[bone].multiply(Pose.q);
    return this;
  }

  copy(src: Pose): this {
    this.hips.copy(src.hips);
    for (const b of POSED_BONES) this.rot[b].copy(src.rot[b]);
    for (const leg of LEG_IDS) {
      const a = this.legs[leg], s = src.legs[leg];
      a.foot.copy(s.foot);
      a.lowerPitch = s.lowerPitch;
      a.toePitch = s.toePitch;
      a.pole.copy(s.pole);
    }
    this.eyelid = src.eyelid;
    this.eyeYaw = src.eyeYaw;
    this.eyePitch = src.eyePitch;
    this.breathRate = src.breathRate;
    this.breathDepth = src.breathDepth;
    this.fidget = src.fidget;
    this.speed = src.speed;
    for (let i = 0; i < this.tailAim.length; i++) this.tailAim[i].copy(src.tailAim[i]);
    this.tailAimWeight = src.tailAimWeight;
    return this;
  }

  /** this = lerp(this, other, t). Rotations use slerp. */
  blend(other: Pose, t: number): this {
    if (t <= 0) return this;
    if (t >= 1) return this.copy(other);
    this.hips.lerp(other.hips, t);
    for (const b of POSED_BONES) this.rot[b].slerp(other.rot[b], t);
    for (const leg of LEG_IDS) {
      const a = this.legs[leg], s = other.legs[leg];
      a.foot.lerp(s.foot, t);
      a.lowerPitch += (s.lowerPitch - a.lowerPitch) * t;
      a.toePitch += (s.toePitch - a.toePitch) * t;
      a.pole.lerp(s.pole, t);
    }
    const mix = (x: number, y: number) => x + (y - x) * t;
    this.eyelid = mix(this.eyelid, other.eyelid);
    this.eyeYaw = mix(this.eyeYaw, other.eyeYaw);
    this.eyePitch = mix(this.eyePitch, other.eyePitch);
    this.breathRate = mix(this.breathRate, other.breathRate);
    this.breathDepth = mix(this.breathDepth, other.breathDepth);
    this.fidget = mix(this.fidget, other.fidget);
    this.speed = mix(this.speed, other.speed);
    // Keep aim directions meaningful even when only one side uses them.
    const wa = this.tailAimWeight, wb = other.tailAimWeight;
    if (wb > 0 && wa > 0) for (let i = 0; i < this.tailAim.length; i++) this.tailAim[i].lerp(other.tailAim[i], t).normalize();
    else if (wb > 0) for (let i = 0; i < this.tailAim.length; i++) this.tailAim[i].copy(other.tailAim[i]);
    this.tailAimWeight = mix(wa, wb);
    return this;
  }
}
