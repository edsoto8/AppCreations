import { Vector3 } from 'three';

const _u = new Vector3();
const _v = new Vector3();

/**
 * Analytic two-bone IK. Returns the middle joint (elbow / knee) position for a chain rooted at
 * `start` reaching for `target`, bending in the plane whose normal is `planeNormal`, on the side
 * that `pole` points to. Unreachable targets are approached as closely as possible.
 */
export function solveTwoBone(
  start: Vector3,
  target: Vector3,
  l1: number,
  l2: number,
  planeNormal: Vector3,
  pole: Vector3,
  out: Vector3,
): Vector3 {
  _u.copy(target).sub(start);
  let dist = _u.length();
  if (dist < 1e-6) _u.set(0, -1, 0);
  else _u.divideScalar(dist);
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995);
  // Bend direction: perpendicular to the reach, inside the bending plane, toward the pole.
  _v.crossVectors(planeNormal, _u);
  if (_v.lengthSq() < 1e-10) _v.copy(pole);
  _v.normalize();
  if (_v.dot(pole) < 0) _v.negate();
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  return out.copy(start).addScaledVector(_u, l1 * cosA).addScaledVector(_v, l1 * sinA);
}
