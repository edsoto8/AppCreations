import type { MotionSegment, Vec2 } from '../simulation/types';

/** Cumulative arc lengths of a polyline (first entry 0). */
export function cumulativeLengths(points: Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    out.push(out[i - 1] + Math.hypot(dx, dz));
  }
  return out;
}

export function polylineLength(points: Vec2[]): number {
  const c = cumulativeLengths(points);
  return c[c.length - 1];
}

const cache = new WeakMap<Vec2[], number[]>();
function cum(points: Vec2[]): number[] {
  let c = cache.get(points);
  if (!c) {
    c = cumulativeLengths(points);
    cache.set(points, c);
  }
  return c;
}

/** Point and heading (radians, atan2(dx, dz)) at arc length d along a polyline. */
export function pointAtDistance(points: Vec2[], d: number, out?: { x: number; z: number; heading: number }) {
  const o = out ?? { x: 0, z: 0, heading: 0 };
  const c = cum(points);
  const total = c[c.length - 1];
  if (points.length === 1 || total === 0) {
    o.x = points[0][0];
    o.z = points[0][1];
    return o;
  }
  const dd = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < c.length - 1 && c[i] < dd) i++;
  const segLen = c[i] - c[i - 1];
  const f = segLen > 0 ? (dd - c[i - 1]) / segLen : 0;
  const ax = points[i - 1][0];
  const az = points[i - 1][1];
  const bx = points[i][0];
  const bz = points[i][1];
  o.x = ax + (bx - ax) * f;
  o.z = az + (bz - az) * f;
  if (segLen > 0) o.heading = Math.atan2(bx - ax, bz - az);
  return o;
}

/** Arc-length distance along a motion segment at time t (clamped to the segment). */
export function distanceAt(seg: MotionSegment, t: number): number {
  if (t <= seg.t0 || seg.t1 <= seg.t0) return t <= seg.t0 ? seg.d0 : seg.d1;
  if (t >= seg.t1) return seg.d1;
  return seg.d0 + ((seg.d1 - seg.d0) * (t - seg.t0)) / (seg.t1 - seg.t0);
}

export function positionAt(seg: MotionSegment, t: number, out?: { x: number; z: number; heading: number }) {
  return pointAtDistance(seg.points, distanceAt(seg, t), out);
}
