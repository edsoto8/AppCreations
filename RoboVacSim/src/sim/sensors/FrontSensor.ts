import type { WorldModel } from '../world/WorldModel';
import { ROBOT } from '../robot/robotSpec';

export interface FrontDetection {
  x: number;
  y: number;
  range: number;
}

/**
 * Front camera + structured-light obstacle sensor. The LiDAR scans a single plane at ~9 cm height, so
 * low objects (cables, socks, pet bowls) are invisible to it. This sensor samples a short-range cone
 * in front of the robot at two low heights and reports hit points, which navigation marks as
 * obstacles. Simplified: no image processing, it reads ground truth geometry within its cone.
 */
export class FrontSensor {
  readonly range = 0.55;
  readonly halfFov = (35 * Math.PI) / 180;
  readonly rays = 11;
  readonly heights = [0.015, 0.05];
  readonly interval = 0.1;
  private timer = 0;
  readonly detections: FrontDetection[] = [];
  /** Range per ray from the last sample (Infinity = nothing within range). */
  readonly rayRange = new Float32Array(11).fill(Infinity);
  /** Nearest detection range from the last sample (Infinity if clear). */
  nearest = Infinity;

  step(dt: number, x: number, y: number, theta: number, world: WorldModel): boolean {
    this.timer += dt;
    if (this.timer < this.interval) return false;
    this.timer = 0;
    this.detections.length = 0;
    this.nearest = Infinity;
    const ox = x + Math.cos(theta) * (ROBOT.radius - 0.02);
    const oy = y + Math.sin(theta) * (ROBOT.radius - 0.02);
    for (let k = 0; k < this.rays; k++) {
      const a = theta - this.halfFov + (2 * this.halfFov * k) / (this.rays - 1);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let best = Infinity;
      for (const z of this.heights) best = Math.min(best, world.raycast(ox, oy, dx, dy, this.range, z));
      this.rayRange[k] = best;
      if (Number.isFinite(best)) {
        this.detections.push({ x: ox + dx * best, y: oy + dy * best, range: best });
        this.nearest = Math.min(this.nearest, best);
      }
    }
    return true;
  }
}
