/**
 * Applies blended poses to the skeleton: posed bone rotations, leg IK, breathing, blinking,
 * ear twitches, eye darts, the additive tail-wag layer and spring-driven tail dynamics.
 */
import { MathUtils, Matrix4, Quaternion, Vector3, type Bone } from 'three';
import { BONE_DEFS, BONE_INDEX, TAIL_BONES } from '../fox/anatomy';
import type { FoxModel } from '../fox/FoxModel';
import { LEG_IDS, POSED_BONES, isFront, type LegId, type LegPose, type Pose } from './Pose';
import { solveTwoBone } from './ik';

interface LegChain {
  id: LegId;
  scapula: Bone | null;
  upper: Bone;
  mid: Bone;
  lower: Bone;
  toe: Bone;
  /** Bone whose X axis defines the leg's bending plane. */
  frame: Bone;
  l1: number;
  l2: number;
  l3: number;
  restDir: { upper: Vector3; mid: Vector3; lower: Vector3; toe: Vector3 };
  restFoot: Vector3;
}

interface Spring {
  pitch: number;
  yaw: number;
  vPitch: number;
  vYaw: number;
}

interface Twitch {
  wait: number;
  t: number;
  dur: number;
  yaw: number;
  pitch: number;
}

const X = new Vector3(1, 0, 0);
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _A = new Vector3(), _B = new Vector3(), _C = new Vector3();
const _m0 = new Matrix4(), _m1 = new Matrix4();
const _q0 = new Quaternion(), _q1 = new Quaternion(), _qp = new Quaternion();
const _v0 = new Vector3(), _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3();
const _w0 = new Vector3(), _w1 = new Vector3(), _knee = new Vector3(), _rootQ = new Quaternion();
const _qa = new Quaternion(), _qb = new Quaternion(), _rest = new Vector3();

export class FoxRig {
  /** Additive tail-wag layer target (0 off .. 1 on). */
  wagLayer = 0;
  private wagWeight = 0;
  private wagPhase = 0;

  private readonly bones: Record<string, Bone>;
  private readonly legs: LegChain[];
  private readonly restHips: Vector3;
  private readonly restLocal = new Map<Bone, Vector3>();
  private readonly springs: Spring[] = TAIL_BONES.map(() => ({ pitch: 0, yaw: 0, vPitch: 0, vYaw: 0 }));
  private readonly prevHips = new Vector3();
  private readonly hipsVel = new Vector3();
  private readonly hipsAcc = new Vector3();
  private hasPrev = false;
  private breathPhase = 0;
  private blinkWait = 1.5;
  private blinkT = -1;
  private doubleBlink = false;
  private readonly twitches: Record<'L' | 'R', Twitch> = {
    L: { wait: 2.5, t: -1, dur: 0.3, yaw: 0, pitch: 0 },
    R: { wait: 4.0, t: -1, dur: 0.3, yaw: 0, pitch: 0 },
  };
  private saccadeWait = 1;
  private readonly saccade = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
  private rng = 1234567;

  constructor(private readonly fox: FoxModel) {
    this.bones = fox.bones;
    for (const def of BONE_DEFS) this.restLocal.set(this.bones[def.name], this.bones[def.name].position.clone());
    this.restHips = this.bones.hips.position.clone();
    this.legs = LEG_IDS.map((id) => this.makeChain(id));
  }

  private makeChain(id: LegId): LegChain {
    const s = id[1];
    const b = this.bones;
    const front = isFront(id);
    const upper = b[front ? `upperArm_${s}` : `thigh_${s}`];
    const mid = b[front ? `foreArm_${s}` : `shin_${s}`];
    const lower = b[front ? `hand_${s}` : `meta_${s}`];
    const toe = b[front ? `fToe_${s}` : `hToe_${s}`];
    const toeEnd = b[front ? `fToeEnd_${s}` : `hToeEnd_${s}`];
    const dir = (child: Bone) => child.position.clone().normalize();
    const pos = (name: string) => new Vector3(...BONE_DEFS[BONE_INDEX[name]].pos);
    return {
      id,
      scapula: front ? b[`scapula_${s}`] : null,
      upper,
      mid,
      lower,
      toe,
      frame: front ? b.chest : b.hips,
      l1: mid.position.length(),
      l2: lower.position.length(),
      l3: toe.position.length(),
      restDir: { upper: dir(mid), mid: dir(lower), lower: dir(toe), toe: dir(toeEnd) },
      restFoot: pos(toe.name),
    };
  }

  private random(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return this.rng / 2147483647;
  }

  /** Applies `pose` for a frame lasting `dt` seconds (already scaled by playback speed). */
  apply(pose: Pose, dt: number, time: number): void {
    const b = this.bones;
    b.hips.position.copy(this.restHips).add(pose.hips);
    for (const name of POSED_BONES) b[name].quaternion.copy(pose.rot[name]);
    // Leg bones are fully overwritten by IK, but reset scapulae to rest first.
    b.scapula_L.quaternion.identity();
    b.scapula_R.quaternion.identity();

    this.applyBreathing(pose, dt);
    this.applyEars(pose, dt);
    this.applyTail(dt);

    const root = b.root;
    root.updateMatrixWorld(true);
    if (pose.tailAimWeight > 0.001) this.aimTail(pose);
    this.keepTailAboveGround();
    for (const leg of this.legs) this.solveLeg(leg, pose.legs[leg.id]);
    this.trackHips(dt);
    this.applyEyes(pose, dt);
    this.fox.update(time);
  }

  // ------------------------------------------------------------------ breathing
  private applyBreathing(pose: Pose, dt: number): void {
    this.breathPhase += dt * pose.breathRate * Math.PI * 2;
    // Inhale is a little quicker than exhale.
    const s = Math.sin(this.breathPhase);
    const breath = (s + 0.25 * Math.sin(this.breathPhase * 2)) * 0.5 + 0.5;
    const d = pose.breathDepth;
    const ribs = this.bones.ribs;
    ribs.scale.set(1 + 0.03 * d * breath, 1 + 0.045 * d * breath, 1 + 0.012 * d * breath);
    _q0.setFromAxisAngle(X, -0.012 * d * breath);
    this.bones.chest.quaternion.multiply(_q0);
  }

  // ------------------------------------------------------------------ ears
  private applyEars(pose: Pose, dt: number): void {
    for (const side of ['L', 'R'] as const) {
      const tw = this.twitches[side];
      if (tw.t < 0) {
        tw.wait -= dt * pose.fidget;
        if (tw.wait <= 0) {
          tw.t = 0;
          tw.dur = 0.22 + this.random() * 0.2;
          const sgn = side === 'L' ? 1 : -1;
          tw.yaw = sgn * (0.2 + this.random() * 0.35) * (this.random() < 0.5 ? 1 : -0.6);
          tw.pitch = -(0.05 + this.random() * 0.25);
        }
      } else {
        tw.t += dt;
        if (tw.t >= tw.dur * 2.2) {
          tw.t = -1;
          tw.wait = 1.5 + this.random() * 5;
        }
      }
      if (tw.t >= 0) {
        // Quick flick out, slower settle.
        const x = tw.t / tw.dur;
        const k = x < 1 ? Math.sin((x * Math.PI) / 2) : Math.max(0, 1 - (x - 1) / 1.2) ** 2;
        _q0.setFromAxisAngle(_v0.set(0, 1, 0), tw.yaw * k);
        _q1.setFromAxisAngle(X, tw.pitch * k);
        this.bones[`ear_${side}`].quaternion.multiply(_q0).multiply(_q1);
      }
    }
  }

  // ------------------------------------------------------------------ tail
  private applyTail(dt: number): void {
    // Additive wag layer.
    this.wagWeight += (this.wagLayer - this.wagWeight) * Math.min(1, dt * 4);
    this.wagPhase += dt * 2.6 * Math.PI * 2;
    // Spring-damper lag driven by the hips' acceleration (in root space).
    const acc = this.hipsAcc;
    const h = Math.min(dt, 1 / 30);
    for (let i = 0; i < TAIL_BONES.length; i++) {
      const s = this.springs[i];
      const k = 160 - i * 16;
      const c = 2 * 0.6 * Math.sqrt(k);
      const gain = 0.35 + i * 0.08;
      const fPitch = -acc.y * gain;
      const fYaw = acc.x * gain;
      if (h > 0) {
        s.vPitch += (-k * s.pitch - c * s.vPitch + fPitch) * h;
        s.vYaw += (-k * s.yaw - c * s.vYaw + fYaw) * h;
        s.pitch = MathUtils.clamp(s.pitch + s.vPitch * h, -0.3, 0.3);
        s.yaw = MathUtils.clamp(s.yaw + s.vYaw * h, -0.3, 0.3);
      }
      const wag = this.wagWeight * (0.16 + i * 0.05) * Math.sin(this.wagPhase - i * 0.55);
      // Positive pitch raises the tail: a wagging tail is carried higher.
      const lift = this.wagWeight * (i === 0 ? 0.35 : 0.03);
      _q0.setFromAxisAngle(_v0.set(0, 1, 0), s.yaw + wag);
      _q1.setFromAxisAngle(X, s.pitch + lift);
      this.bones[TAIL_BONES[i]].quaternion.multiply(_q1).multiply(_q0);
    }
  }

  /** Blends each tail bone toward the pose's root-space aim direction. */
  private aimTail(pose: Pose): void {
    const rootQ = this.bones.root.getWorldQuaternion(_rootQ);
    for (let i = 0; i < TAIL_BONES.length; i++) {
      const bone = this.bones[TAIL_BONES[i]];
      const child = this.bones[i + 1 < TAIL_BONES.length ? TAIL_BONES[i + 1] : 'tailEnd'];
      const dir = _w0.copy(pose.tailAim[i]).applyQuaternion(rootQ);
      // Keep each segment's side axis level so the tail lies flat as it curls.
      const lateral = _w1.crossVectors(dir, _v4.set(0, 1, 0).applyQuaternion(rootQ)).normalize();
      bone.getWorldQuaternion(_qa);
      const aimed = aimQuaternion(_rest.copy(child.position).normalize(), dir, lateral, _qb);
      _qa.slerp(aimed, pose.tailAimWeight);
      bone.parent!.getWorldQuaternion(_qp);
      bone.quaternion.copy(_qp.invert().multiply(_qa));
      bone.updateMatrixWorld(true);
    }
  }

  /** Lifts tail joints that would sink below the floor (fur included). */
  private keepTailAboveGround(): void {
    const obj = this.fox.object;
    for (let i = 0; i < TAIL_BONES.length; i++) {
      const bone = this.bones[TAIL_BONES[i]];
      const child = this.bones[i + 1 < TAIL_BONES.length ? TAIL_BONES[i + 1] : 'tailEnd'];
      const floor = 0.05 - i * 0.003;
      const start = obj.worldToLocal(bone.getWorldPosition(_v0));
      const end = obj.worldToLocal(child.getWorldPosition(_v1));
      if (end.y >= floor) continue;
      const len = start.distanceTo(end);
      const current = Math.asin(MathUtils.clamp((end.y - start.y) / len, -1, 1));
      const wanted = Math.asin(MathUtils.clamp((floor - start.y) / len, -1, 1));
      // Positive pitch raises a backward-pointing tail.
      _q0.setFromAxisAngle(X, wanted - current);
      bone.quaternion.multiply(_q0);
      bone.updateMatrixWorld(true);
    }
  }

  private trackHips(dt: number): void {
    const p = this.bones.hips.getWorldPosition(_v0);
    this.fox.object.worldToLocal(p);
    if (this.hasPrev && dt > 1e-4) {
      _v1.copy(p).sub(this.prevHips).divideScalar(dt);
      _v2.copy(_v1).sub(this.hipsVel).divideScalar(dt);
      // Low-pass the acceleration to avoid jitter from variable frame times.
      this.hipsAcc.lerp(_v2.clampLength(0, 40), Math.min(1, dt * 12));
      this.hipsVel.copy(_v1);
    }
    this.prevHips.copy(p);
    this.hasPrev = true;
  }

  // ------------------------------------------------------------------ legs
  private solveLeg(leg: LegChain, goal: LegPose): void {
    const root = this.bones.root;
    const rootQ = root.getWorldQuaternion(_rootQ);

    // Lateral (bending-plane normal) axis from the body frame.
    const lateral = _v4.copy(X).applyQuaternion(leg.frame.getWorldQuaternion(_qp));

    // Shoulder blades swing with the leg to extend its reach.
    if (leg.scapula) {
      const dz = goal.foot.z - leg.restFoot.z;
      leg.scapula.quaternion.setFromAxisAngle(X, MathUtils.clamp(-dz * 2.6, -0.45, 0.45));
      leg.scapula.updateMatrixWorld(true);
    }

    const footW = root.localToWorld(_v0.copy(goal.foot));
    const lowerDir = _v1.copy(leg.restDir.lower).applyAxisAngle(X, goal.lowerPitch).applyQuaternion(rootQ);
    const lowerTarget = _v2.copy(footW).addScaledVector(lowerDir, -leg.l3);
    const upperPos = leg.upper.getWorldPosition(_v3);
    const pole = _w0.copy(goal.pole).applyQuaternion(rootQ);
    const knee = solveTwoBone(upperPos, lowerTarget, leg.l1, leg.l2, lateral, pole, _knee);

    aimBone(leg.upper, leg.restDir.upper, _w1.copy(knee).sub(upperPos), lateral);
    aimBone(leg.mid, leg.restDir.mid, _w1.copy(lowerTarget).sub(knee), lateral);
    aimBone(leg.lower, leg.restDir.lower, lowerDir, lateral);
    const toeDir = _w1.copy(leg.restDir.toe).applyAxisAngle(X, goal.toePitch).applyQuaternion(rootQ);
    aimBone(leg.toe, leg.restDir.toe, toeDir, lateral);
  }

  // ------------------------------------------------------------------ eyes
  private applyEyes(pose: Pose, dt: number): void {
    // Blinks.
    let blink = 0;
    if (this.blinkT < 0) {
      this.blinkWait -= dt;
      if (this.blinkWait <= 0) {
        this.blinkT = 0;
        this.doubleBlink = this.random() < 0.2;
      }
    } else {
      this.blinkT += dt;
      const dur = this.doubleBlink ? 0.42 : 0.17;
      const x = this.blinkT % 0.21;
      blink = x < 0.06 ? x / 0.06 : Math.max(0, 1 - (x - 0.06) / 0.11);
      if (this.blinkT >= dur) {
        this.blinkT = -1;
        this.blinkWait = 2 + this.random() * 4;
        blink = 0;
      }
    }
    const lid = Math.max(pose.eyelid, blink);

    // Small gaze darts.
    const sc = this.saccade;
    this.saccadeWait -= dt;
    if (this.saccadeWait <= 0) {
      this.saccadeWait = 0.7 + this.random() * 2.2;
      sc.tYaw = (this.random() - 0.5) * 0.3;
      sc.tPitch = (this.random() - 0.5) * 0.14;
    }
    const k = Math.min(1, dt * 25);
    sc.yaw += (sc.tYaw - sc.yaw) * k;
    sc.pitch += (sc.tPitch - sc.pitch) * k;
    const yaw = pose.eyeYaw + sc.yaw * pose.fidget;
    const pitch = pose.eyePitch + sc.pitch * pose.fidget;
    for (const side of ['L', 'R'] as const) {
      const eye = this.fox.eyes[side];
      eye.setBlink(lid);
      // Both eye frames have local +X toward the fox's left, so one yaw works for both.
      eye.setLook(yaw, pitch);
    }
  }
}

/**
 * World rotation that turns a bone's rest direction (local = model space at rest) to `worldDir`,
 * keeping its local X axis as close as possible to `lateral`.
 */
function aimQuaternion(restDir: Vector3, worldDir: Vector3, lateral: Vector3, out: Quaternion): Quaternion {
  _a.copy(restDir).normalize();
  _b.copy(X).addScaledVector(_a, -_a.dot(X)).normalize();
  _c.crossVectors(_a, _b);
  _A.copy(worldDir).normalize();
  _B.copy(lateral).addScaledVector(_A, -_A.dot(lateral)).normalize();
  _C.crossVectors(_A, _B);
  _m0.makeBasis(_a, _b, _c);
  _m1.makeBasis(_A, _B, _C);
  _q0.setFromRotationMatrix(_m0).invert();
  return out.setFromRotationMatrix(_m1).multiply(_q0);
}

/** Rotates `bone` to point along `worldDir` (see aimQuaternion) and updates its matrices. */
function aimBone(bone: Bone, restDir: Vector3, worldDir: Vector3, lateral: Vector3): void {
  aimQuaternion(restDir, worldDir, lateral, _q1);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q1));
  bone.updateMatrixWorld(true);
}
