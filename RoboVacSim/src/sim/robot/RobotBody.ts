import type { SimConfig } from '../config';
import type { Rng } from '../core/rng';
import { approach, clamp, wrapAngle } from '../core/math';
import type { WorldModel } from '../world/WorldModel';
import { ROBOT } from './robotSpec';

/**
 * Differential-drive robot body. Integrates commanded (v, w) with acceleration limits into wheel
 * speeds, applies small seeded wheel-slip noise, resolves collisions against the ground-truth world
 * (bumper events) and enforces the cliff-sensor reflex (motion that would put a cliff sensor over a
 * drop is cancelled).
 */
export class RobotBody {
  x = 0;
  y = 0;
  theta = 0;
  /** Actual linear / angular velocity after limits. */
  v = 0;
  w = 0;
  vl = 0;
  vr = 0;
  leftWheelAngle = 0;
  rightWheelAngle = 0;
  casterYaw = 0;
  odometer = 0;
  /** Bumper state for this step. */
  bumped = false;
  bumpAngle = 0;
  bumpX = 0;
  bumpY = 0;
  /** Smoothed bumper compression 0..1 for animation. */
  bumperCompression = 0;
  cliffTriggered = false;
  cliffSensor = -1;
  cliffX = 0;
  cliffY = 0;
  /** Suspension lift 0..1 (thresholds/rugs). */
  suspensionLift = 0;
  /** True when we are deliberately allowing the robot to rest on the dock base plate. */
  onDock = false;

  private readonly cfg: SimConfig['robot'];
  private readonly rng: Rng;

  constructor(cfg: SimConfig['robot'], rng: Rng) {
    this.cfg = cfg;
    this.rng = rng;
  }

  setPose(x: number, y: number, theta: number): void {
    this.x = x;
    this.y = y;
    this.theta = wrapAngle(theta);
    this.v = 0;
    this.w = 0;
  }

  /** Cliff sensor world positions for a hypothetical pose. */
  cliffSensorWorld(k: number, x: number, y: number, theta: number): { x: number; y: number } {
    const s = ROBOT.cliffSensors[k];
    // local (x forward, z left) -> sim: left is +90deg
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    return { x: x + s.x * c - s.z * sn, y: y + s.x * sn + s.z * c };
  }

  step(dt: number, vCmd: number, wCmd: number, world: WorldModel, dragFactor: number): void {
    const cfg = this.cfg;
    const maxV = cfg.maxSpeed / dragFactor;
    const targetV = clamp(vCmd, -maxV, maxV);
    const targetW = clamp(wCmd, -cfg.maxTurnRate, cfg.maxTurnRate);
    this.v = approach(this.v, targetV, cfg.accel * dt);
    this.w = approach(this.w, targetW, cfg.angularAccel * dt);

    const half = ROBOT.wheelBase / 2;
    let vl = this.v - this.w * half;
    let vr = this.v + this.w * half;
    if (cfg.wheelSlipNoise > 0 && (vl !== 0 || vr !== 0)) {
      vl *= 1 + this.rng.gaussian() * cfg.wheelSlipNoise;
      vr *= 1 + this.rng.gaussian() * cfg.wheelSlipNoise;
    }
    const v = (vl + vr) / 2;
    const w = (vr - vl) / ROBOT.wheelBase;
    const thMid = this.theta + (w * dt) / 2;
    let nx = this.x + Math.cos(thMid) * v * dt;
    let ny = this.y + Math.sin(thMid) * v * dt;
    let nth = wrapAngle(this.theta + w * dt);

    // Cliff reflex: refuse motion that would put any relevant cliff sensor over a drop.
    this.cliffTriggered = false;
    this.cliffSensor = -1;
    for (let k = 0; k < ROBOT.cliffSensors.length; k++) {
      const front = ROBOT.cliffSensors[k].x > 0;
      if (v > 1e-4 && !front) continue;
      if (v < -1e-4 && front) continue;
      const p = this.cliffSensorWorld(k, nx, ny, nth);
      if (world.isCliff(p.x, p.y)) {
        this.cliffTriggered = true;
        this.cliffSensor = k;
        this.cliffX = p.x;
        this.cliffY = p.y;
        break;
      }
    }
    if (this.cliffTriggered) {
      // Refuse the whole motion (translation AND rotation): turning in place can also swing a
      // sensor over the edge.
      nx = this.x;
      ny = this.y;
      nth = this.theta;
      this.v = 0;
      this.w = 0;
    }

    // Collision resolution (iterative push-out).
    this.bumped = false;
    for (let iter = 0; iter < 3; iter++) {
      const c = world.collide(nx, ny, ROBOT.radius);
      if (c.depth <= 1e-6) break;
      nx += c.nx * (c.depth + 1e-4);
      ny += c.ny * (c.depth + 1e-4);
      const hitDir = Math.atan2(-c.ny, -c.nx);
      const rel = wrapAngle(hitDir - nth);
      if (Math.abs(rel) <= ROBOT.bumperArc) {
        if (!this.bumped) {
          this.bumped = true;
          this.bumpAngle = rel;
          this.bumpX = nx - c.nx * ROBOT.radius;
          this.bumpY = ny - c.ny * ROBOT.radius;
        }
      }
    }
    if (this.bumped && this.v > 0) this.v = 0;

    const moved = Math.hypot(nx - this.x, ny - this.y);
    this.odometer += moved;
    this.x = nx;
    this.y = ny;
    this.theta = nth;
    this.vl = vl;
    this.vr = vr;
    this.leftWheelAngle += (vl * dt) / ROBOT.wheelRadius;
    this.rightWheelAngle += (vr * dt) / ROBOT.wheelRadius;
    if (Math.abs(v) > 0.01 || Math.abs(w) > 0.05) {
      const desired = Math.atan2(w * ROBOT.casterOffsetX, v);
      this.casterYaw += wrapAngle(desired - this.casterYaw) * Math.min(1, dt * 8);
    }
    this.bumperCompression = this.bumped ? 1 : Math.max(0, this.bumperCompression - dt * 6);
    const bump = world.onThreshold(this.x, this.y) ? 1 : 0;
    this.suspensionLift += (bump - this.suspensionLift) * Math.min(1, dt * 10);
  }
}
