import { ROBOT } from '../robot/robotSpec';
import type { WorldModel } from '../world/WorldModel';

/**
 * Right-side time-of-flight wall sensor (as used for edge cleaning on real robots). Measures the gap
 * between the robot's right shell and a wall at low height, plus a 45° forward-right ray to anticipate
 * corners. Reports Infinity when nothing is within range.
 */
export class WallSensor {
  readonly range = 0.18;
  readonly height = 0.04;
  /** Gap (m) between the shell and the wall perpendicular to the right side. */
  side = Infinity;
  /** Gap along the 45° forward-right ray. */
  diagonal = Infinity;

  step(x: number, y: number, theta: number, world: WorldModel): void {
    const r = ROBOT.radius - 0.005;
    const a = theta - Math.PI / 2;
    const ox = x + Math.cos(a) * r;
    const oy = y + Math.sin(a) * r;
    const d = world.raycast(ox, oy, Math.cos(a), Math.sin(a), this.range, this.height);
    this.side = Number.isFinite(d) ? Math.max(0, d - 0.005) : Infinity;
    const b = theta - Math.PI / 4;
    const bx = x + Math.cos(b) * r;
    const by = y + Math.sin(b) * r;
    const d2 = world.raycast(bx, by, Math.cos(b), Math.sin(b), this.range, this.height);
    this.diagonal = Number.isFinite(d2) ? Math.max(0, d2 - 0.005) : Infinity;
  }
}
