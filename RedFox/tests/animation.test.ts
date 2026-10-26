import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBone } from '../src/animation/ik';
import { LEG_IDS, POSED_BONES, Pose, REST_FEET } from '../src/animation/Pose';
import { STATES, walkState } from '../src/animation/states';

describe('solveTwoBone', () => {
  const start = new Vector3(0, 1, 0);
  const lateral = new Vector3(1, 0, 0);

  it('reaches a reachable target with both bone lengths preserved', () => {
    const target = new Vector3(0, 0.3, 0.2);
    const knee = solveTwoBone(start, target, 0.45, 0.5, lateral, new Vector3(0, 0, 1), new Vector3());
    expect(knee.distanceTo(start)).toBeCloseTo(0.45, 6);
    expect(knee.distanceTo(target)).toBeCloseTo(0.5, 6);
  });

  it('bends toward the pole', () => {
    const target = new Vector3(0, 0.2, 0);
    const forward = solveTwoBone(start, target, 0.5, 0.5, lateral, new Vector3(0, 0, 1), new Vector3());
    const back = solveTwoBone(start, target, 0.5, 0.5, lateral, new Vector3(0, 0, -1), new Vector3());
    expect(forward.z).toBeGreaterThan(0);
    expect(back.z).toBeLessThan(0);
  });

  it('straightens toward unreachable targets', () => {
    const target = new Vector3(0, -5, 0);
    const knee = solveTwoBone(start, target, 0.5, 0.5, lateral, new Vector3(0, 0, 1), new Vector3());
    expect(knee.y).toBeCloseTo(0.5, 2);
    expect(Math.abs(knee.z)).toBeLessThan(0.02);
  });
});

describe('Pose', () => {
  it('blends feet linearly and rotations spherically', () => {
    const a = new Pose();
    const b = new Pose();
    b.set('head', 0, Math.PI / 2);
    b.legs.FL.foot.set(1, 0, 0);
    a.legs.FL.foot.set(0, 0, 0);
    a.blend(b, 0.5);
    expect(a.legs.FL.foot.x).toBeCloseTo(0.5);
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    expect(a.rot.head.angleTo(expected)).toBeLessThan(1e-6);
  });

  it('copies every channel', () => {
    const a = new Pose();
    a.set('tail3', 0.3, 0.2);
    a.hips.set(0.1, 0.2, 0.3);
    a.eyelid = 0.7;
    const b = new Pose().copy(a);
    expect(b.rot.tail3.angleTo(a.rot.tail3)).toBeLessThan(1e-6);
    expect(b.hips.equals(a.hips)).toBe(true);
    expect(b.eyelid).toBe(0.7);
  });
});

describe('animation states', () => {
  it('produce finite poses with paws at or above the ground', () => {
    const pose = new Pose();
    for (const state of STATES) {
      for (let t = 0; t <= 12; t += 0.05) {
        state.evaluate(t, pose);
        expect(Number.isFinite(pose.hips.x + pose.hips.y + pose.hips.z)).toBe(true);
        for (const b of POSED_BONES) {
          const q = pose.rot[b];
          expect(Math.abs(q.length() - 1)).toBeLessThan(1e-6);
        }
        for (const leg of LEG_IDS) expect(pose.legs[leg].foot.y).toBeGreaterThanOrEqual(REST_FEET[leg][1] - 1e-9);
      }
    }
  });

  it('walk keeps stance paws planted: they slide back exactly at ground speed', () => {
    const a = new Pose();
    const b = new Pose();
    const dt = 1 / 240;
    let checked = 0;
    for (let t = 0; t < 2; t += 0.037) {
      walkState.evaluate(t, a);
      walkState.evaluate(t + dt, b);
      for (const leg of LEG_IDS) {
        const ya = a.legs[leg].foot.y, yb = b.legs[leg].foot.y;
        const onGround = Math.abs(ya - REST_FEET[leg][1]) < 1e-9 && Math.abs(yb - REST_FEET[leg][1]) < 1e-9;
        if (!onGround) continue;
        const v = (b.legs[leg].foot.z - a.legs[leg].foot.z) / dt;
        expect(v).toBeCloseTo(-a.speed, 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('sit settles into a stable pose', () => {
    const sit = STATES.find((s) => s.id === 'sit')!;
    const a = new Pose();
    const b = new Pose();
    sit.evaluate(3, a);
    sit.evaluate(3.5, b);
    expect(a.hips.y).toBeLessThan(-0.15);
    expect(a.hips.distanceTo(b.hips)).toBeLessThan(0.01);
    expect(a.tailAimWeight).toBeCloseTo(1);
  });
});
