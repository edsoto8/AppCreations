import { ROBOT } from '../../../sim/robot/robotSpec';

/**
 * Derived layout for the robot model (meters, robot local frame: +X forward, +Y up, +Z left).
 * Lathe angle convention: a lathe point at angle phi lies at (x, z) = (r sin phi, r cos phi), so
 * +X (forward) is phi = PI/2, +Z (left) is phi = 0 and -X (rear) is phi = 3PI/2.
 */
export const R = ROBOT.radius;

export const Y = {
  /** Bottom face of the underside pan. */
  pan0: ROBOT.groundClearance,
  pan1: ROBOT.groundClearance + 0.007,
  /** Bottom edge of side shell / bumper. */
  shell0: 0.0235,
  shellTop: 0.0665,
  coverStart: 0.0675,
  top: ROBOT.bodyHeight,
  ledFloor: 0.079,
} as const;

/** phi of the forward direction. */
export const PHI_FWD = Math.PI / 2;
/** Bumper sector. */
export const BUMPER_PHI0 = PHI_FWD - ROBOT.bumperArc;
export const BUMPER_PHI_LEN = ROBOT.bumperArc * 2;

/** Rear translucent water tank forms the exterior wall behind this chord (x < TANK_CHORD_X). */
export const TANK_CHORD_X = -0.1255;
export const TANK_OUTER_R = R - 0.0002;
/** Half-angle (around -X) covered by the tank's outer wall. */
export const TANK_HALF = Math.acos(-TANK_CHORD_X / TANK_OUTER_R);
export const PHI_REAR = (Math.PI * 3) / 2;

/** Suspension: chassis rises by this much at suspensionLift = 1. */
export const LIFT_TRAVEL = 0.006;
/** Mop pads drop by this much when lowered. */
export const MOP_DROP = 0.008;

export const WHEEL_Z = ROBOT.wheelBase / 2;

/** Converts a robot-frame direction angle (0 = +X, PI/2 = +Z/left) to lathe phi. */
export function phiOf(dirAngle: number): number {
  return PHI_FWD - dirAngle;
}

/** Point on a circle of radius r at lathe angle phi. */
export function onCircle(r: number, phi: number): { x: number; z: number } {
  return { x: r * Math.sin(phi), z: r * Math.cos(phi) };
}
