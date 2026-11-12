import type { SimConfig } from '../config';
import type { Rng } from '../core/rng';
import { TAU } from '../core/math';
import { ROBOT } from '../robot/robotSpec';
import type { WorldModel } from '../world/WorldModel';

export interface LidarRay {
  /** Sensor origin. */
  ox: number;
  oy: number;
  /** End point (hit point, or max-range point when no return). */
  ex: number;
  ey: number;
  hit: boolean;
}

/**
 * Rotating 2D LiDAR. The turret spins at `spinHz`; each simulation step emits the number of rays that
 * fall within the swept angle (fractional accumulation keeps the angular resolution exact at any
 * step size). Ranges come from ground-truth ray casts at the sensor height with gaussian noise and
 * random dropouts (seeded).
 */
export class Lidar {
  /** Turret angle relative to the robot heading (rad, accumulated). */
  turretAngle = 0;
  spinning = true;
  /** Rays produced during the latest step (consumed by mapping). */
  readonly stepRays: LidarRay[] = [];
  private stepCount = 0;
  /** Ring buffer of recent hit points (world x, y) for point cloud visualisation. */
  readonly cloud: Float32Array;
  cloudHead = 0;
  cloudCount = 0;
  /** Latest range per angular bin (one revolution) in the robot frame, for the ray overlay. NaN = no return. */
  readonly scanRanges: Float32Array;
  readonly scanAngles: Float32Array;
  totalRays = 0;
  private accum = 0;
  private readonly cfg: SimConfig['lidar'];
  private readonly rng: Rng;

  constructor(cfg: SimConfig['lidar'], rng: Rng) {
    this.cfg = cfg;
    this.rng = rng;
    this.cloud = new Float32Array(cfg.pointCloudSize * 2);
    this.scanRanges = new Float32Array(cfg.raysPerRevolution).fill(NaN);
    this.scanAngles = new Float32Array(cfg.raysPerRevolution);
    for (let i = 0; i < cfg.raysPerRevolution; i++) this.scanAngles[i] = (i / cfg.raysPerRevolution) * TAU;
    for (let i = 0; i < 64; i++) this.stepRays.push({ ox: 0, oy: 0, ex: 0, ey: 0, hit: false });
  }

  /** Number of valid rays in stepRays after the latest step. */
  get rayCount(): number {
    return this.stepCount;
  }

  step(dt: number, x: number, y: number, theta: number, world: WorldModel): void {
    this.stepCount = 0;
    if (!this.spinning) return;
    const cfg = this.cfg;
    const dAngle = TAU / cfg.raysPerRevolution;
    this.accum += cfg.raysPerRevolution * cfg.spinHz * dt;
    const n = Math.floor(this.accum);
    this.accum -= n;
    const ox = x + Math.cos(theta) * ROBOT.lidarOffsetX;
    const oy = y + Math.sin(theta) * ROBOT.lidarOffsetX;
    for (let k = 0; k < n; k++) {
      this.turretAngle += dAngle;
      const rel = this.turretAngle % TAU;
      const a = theta + rel;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let range = world.raycast(ox, oy, dx, dy, cfg.range, ROBOT.lidarHeight);
      const hit = Number.isFinite(range) && range >= cfg.minRange;
      const bin = Math.floor((rel / TAU) * cfg.raysPerRevolution) % cfg.raysPerRevolution;
      this.totalRays++;
      // A dropout (no echo from an object that is there) carries no information: it must NOT be
      // integrated as a max-range "free" ray, or it would carve free space through solid objects.
      if (hit && this.rng.next() < cfg.dropout) {
        this.scanRanges[bin] = NaN;
        continue;
      }
      if (hit) range = Math.max(cfg.minRange, range + this.rng.gaussian() * cfg.noise);
      else range = cfg.range;
      if (this.stepCount >= this.stepRays.length) this.stepRays.push({ ox: 0, oy: 0, ex: 0, ey: 0, hit: false });
      const ray = this.stepRays[this.stepCount++];
      ray.ox = ox;
      ray.oy = oy;
      ray.ex = ox + dx * range;
      ray.ey = oy + dy * range;
      ray.hit = hit;
      this.scanRanges[bin] = hit ? range : NaN;
      if (hit) {
        const h = this.cloudHead;
        this.cloud[h * 2] = ray.ex;
        this.cloud[h * 2 + 1] = ray.ey;
        this.cloudHead = (h + 1) % cfg.pointCloudSize;
        this.cloudCount = Math.min(this.cloudCount + 1, cfg.pointCloudSize);
      }
    }
  }

  clearCloud(): void {
    this.cloudHead = 0;
    this.cloudCount = 0;
    this.scanRanges.fill(NaN);
  }
}
