import { describe, expect, it } from 'vitest';
import { PathFollower } from '../../src/sim/navigation/PathFollower';
import type { Pose2, Vec2 } from '../../src/sim/world/types';

const DT = 0.02;

interface SimResult {
  pose: Pose2;
  steps: number;
  done: boolean;
  maxCte: number;
  maxV: number;
  maxW: number;
  progressMonotonic: boolean;
  trace: Pose2[];
}

/** Integrates a unicycle (x += v cos θ dt, y += v sin θ dt, θ += w dt) under the follower. */
function simulate(f: PathFollower, start: Pose2, maxSteps = 5000): SimResult {
  const pose = { ...start };
  let maxCte = 0;
  let maxV = 0;
  let maxW = 0;
  let lastProgress = 0;
  let progressMonotonic = true;
  const trace: Pose2[] = [];
  for (let n = 0; n < maxSteps; n++) {
    const out = f.update(pose.x, pose.y, pose.theta);
    if (f.progress < lastProgress - 1e-12) progressMonotonic = false;
    lastProgress = f.progress;
    if (out.done) return { pose, steps: n, done: true, maxCte, maxV, maxW, progressMonotonic, trace };
    maxCte = Math.max(maxCte, Math.abs(out.crossTrackError));
    maxV = Math.max(maxV, Math.abs(out.v));
    maxW = Math.max(maxW, Math.abs(out.w));
    pose.x += out.v * Math.cos(pose.theta) * DT;
    pose.y += out.v * Math.sin(pose.theta) * DT;
    pose.theta += out.w * DT;
    trace.push({ ...pose });
  }
  return { pose, steps: maxSteps, done: false, maxCte, maxV, maxW, progressMonotonic, trace };
}

describe('PathFollower', () => {
  it('uses the documented defaults', () => {
    const f = new PathFollower();
    expect(f.params).toEqual({
      lookahead: 0.25,
      maxV: 0.3,
      maxW: 1.8,
      goalTolerance: 0.06,
      rotateInPlaceAngle: 0.6,
      slowdownRadius: 0.3,
    });
  });

  it('drives a unicycle along an L-shaped path to the goal without overshooting', () => {
    const f = new PathFollower();
    const path: Vec2[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1.5 },
    ];
    f.setPath(path);
    expect(f.path).toEqual(path);
    expect(f.length).toBeCloseTo(3.5);
    const r = simulate(f, { x: 0, y: 0, theta: 0 });
    expect(r.done).toBe(true);
    expect(Math.hypot(r.pose.x - 2, r.pose.y - 1.5)).toBeLessThanOrEqual(0.06);
    // Never beyond the goal along the final segment direction (+y).
    for (const p of r.trace) expect(p.y).toBeLessThanOrEqual(1.5 + 0.06);
    expect(r.maxCte).toBeLessThan(0.15);
    expect(r.maxV).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(r.maxW).toBeLessThanOrEqual(1.8 + 1e-9);
    expect(r.progressMonotonic).toBe(true);
    // Reasonable time: 3.5 m at ≤ 0.3 m/s plus turning, well under 30 s.
    expect(r.steps * DT).toBeLessThan(30);
    // Stays done.
    const again = f.update(r.pose.x, r.pose.y, r.pose.theta);
    expect(again.done).toBe(true);
    expect(again.v).toBe(0);
    expect(again.w).toBe(0);
    expect(f.remainingDistance(r.pose.x, r.pose.y)).toBeLessThan(0.1);
  });

  it('rotates in place for a 180° turn before driving', () => {
    const f = new PathFollower();
    f.setPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    const first = f.update(0, 0, Math.PI);
    expect(first.v).toBe(0);
    expect(Math.abs(first.w)).toBeGreaterThan(0.5);
    expect(first.done).toBe(false);
    const r = simulate(f, { x: 0, y: 0, theta: Math.PI });
    expect(r.done).toBe(true);
    expect(Math.hypot(r.pose.x - 1, r.pose.y)).toBeLessThanOrEqual(0.06);
    // While the heading error was large the robot did not translate.
    const moved = r.trace.findIndex((p) => Math.hypot(p.x, p.y) > 1e-9);
    const thetaAtMove = r.trace[moved].theta;
    const err = Math.atan2(Math.sin(thetaAtMove), Math.cos(thetaAtMove));
    expect(Math.abs(err)).toBeLessThan(0.6);
  });

  it('handles heading wrap-around (turns the short way)', () => {
    const f = new PathFollower();
    // Path heading ≈ π - 0.1, robot heading -π + 0.1: real error is -0.2 rad.
    f.setPath([
      { x: 0, y: 0 },
      { x: -2 * Math.cos(0.1), y: 2 * Math.sin(0.1) },
    ]);
    const out = f.update(0, 0, -Math.PI + 0.1);
    expect(out.v).toBeGreaterThan(0);
    expect(out.w).toBeLessThan(0);
    // Same with θ offset by multiples of 2π.
    const f2 = new PathFollower();
    f2.setPath(f.path);
    const out2 = f2.update(0, 0, -Math.PI + 0.1 + 6 * Math.PI);
    expect(out2.v).toBeCloseTo(out.v, 9);
    expect(out2.w).toBeCloseTo(out.w, 9);
  });

  it('slows down near the goal', () => {
    const f = new PathFollower();
    f.setPath([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
    const far = f.update(0.5, 0, 0).v;
    // Progress catches up within a bounded window per update; step the robot forward.
    for (let x = 0.6; x < 2.85; x += 0.1) f.update(x, 0, 0);
    const near = f.update(2.85, 0, 0).v;
    expect(far).toBeCloseTo(0.3, 6);
    expect(near).toBeLessThan(0.2);
    expect(near).toBeGreaterThan(0);
  });

  it('progress is monotonic and does not jump to a later, nearby part of the path', () => {
    const f = new PathFollower();
    // U-turn: the return leg passes 0.3 m from the start.
    f.setPath([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 0.3 },
      { x: 0, y: 0.3 },
    ]);
    const out = f.update(0.1, 0.2, 0);
    expect(out.segmentIndex).toBe(0);
    expect(out.crossTrackError).toBeCloseTo(0.2, 6); // left of the first segment
    expect(f.progress).toBeCloseTo(0.1, 6);
    // Moving backwards does not reduce progress.
    f.update(0.0, 0.0, 0);
    expect(f.progress).toBeCloseTo(0.1, 6);
    const r = simulate(f, { x: 0, y: 0, theta: 0 });
    expect(r.done).toBe(true);
    expect(Math.hypot(r.pose.x, r.pose.y - 0.3)).toBeLessThanOrEqual(0.06);
    expect(r.progressMonotonic).toBe(true);
  });

  it('reuses its output object and handles degenerate paths', () => {
    const f = new PathFollower();
    const a = f.update(0, 0, 0);
    expect(a.done).toBe(true); // no path
    f.setPath([{ x: 1, y: 0 }]);
    const b = f.update(0, 0, 0);
    expect(b).toBe(a);
    expect(b.done).toBe(false);
    expect(b.v).toBeGreaterThan(0);
    const r = simulate(f, { x: 0, y: 0, theta: 0 });
    expect(r.done).toBe(true);
    expect(Math.hypot(r.pose.x - 1, r.pose.y)).toBeLessThanOrEqual(0.06);
    // Duplicate points / zero-length segments.
    f.setPath([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0 },
    ]);
    const r2 = simulate(f, { x: 0, y: 0, theta: 0 });
    expect(r2.done).toBe(true);
    expect(Math.hypot(r2.pose.x - 1, r2.pose.y)).toBeLessThanOrEqual(0.06);
  });

  it('remainingDistance decreases as the robot advances', () => {
    const f = new PathFollower();
    f.setPath([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(f.remainingDistance(0, 0)).toBeCloseTo(3, 6);
    f.update(1, 0.1, 0);
    expect(f.remainingDistance(1, 0.1)).toBeCloseTo(2.1, 6);
  });
});
