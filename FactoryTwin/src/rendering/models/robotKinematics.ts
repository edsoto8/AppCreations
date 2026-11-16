import type { RobotAnim } from './anims';

/**
 * Robot arm geometry constants and analytic IK. No React/Three imports: safe for any layer.
 *
 * Frame: arm-local, origin at the floor under the base axis, y up, base yaw 0 = reaching +x.
 * The shoulder joint sits SHOULDER_OFFSET in front of the yaw axis at SHOULDER_HEIGHT.
 * Target = the grip point between the finger tips (centre of a carried item's top half).
 */
export const ROBOT = {
  /** Plinth + base flange height: the turntable starts here. */
  TURNTABLE_Y: 0.49,
  SHOULDER_HEIGHT: 0.98,
  SHOULDER_OFFSET: 0.18,
  UPPER_ARM: 1.15,
  FOREARM: 1.1,
  /** Wrist joint -> grip point (tool points straight down). */
  TOOL_LENGTH: 0.3,
} as const;

/** Max horizontal reach of the grip point at shoulder-minus-tool height (~2.43 m). */
export const ROBOT_REACH = ROBOT.SHOULDER_OFFSET + ROBOT.UPPER_ARM + ROBOT.FOREARM;

/**
 * Solves base/shoulder/elbow/wrist so the gripper points straight down with its grip point at
 * `target` (arm-local [x, y, z]). Elbow-up solution. Returns false if out of reach; `out` then
 * holds the closest stretched-out pose toward the target. grip/carry are not touched.
 */
export function solveRobotIK(target: readonly [number, number, number], out: RobotAnim): boolean {
  const [x, y, z] = target;
  const L1 = ROBOT.UPPER_ARM;
  const L2 = ROBOT.FOREARM;
  out.base = Math.atan2(-z, x);
  const r = Math.hypot(x, z);
  const dx = r - ROBOT.SHOULDER_OFFSET;
  const dy = y + ROBOT.TOOL_LENGTH - ROBOT.SHOULDER_HEIGHT;
  let d = Math.hypot(dx, dy);
  let ok = true;
  const maxD = L1 + L2 - 1e-4;
  const minD = Math.abs(L1 - L2) + 0.05;
  if (d > maxD) {
    d = maxD;
    ok = false;
  } else if (d < minD) {
    d = minD;
    ok = false;
  }
  const c = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const elbow = -Math.acos(Math.max(-1, Math.min(1, c)));
  const shoulder = Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(elbow), L1 + L2 * Math.cos(elbow));
  out.shoulder = shoulder;
  out.elbow = elbow;
  out.wrist = -Math.PI / 2 - shoulder - elbow;
  return ok;
}
