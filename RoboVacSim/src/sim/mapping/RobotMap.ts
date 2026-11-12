import type { SimConfig } from '../config';
import { ROBOT } from '../robot/robotSpec';
import type { LidarRay } from '../sensors/Lidar';
import type { FloorType, Rect } from '../world/types';
import { Costmap } from './Costmap';
import { GridGeometry } from './GridGeometry';
import { OccupancyGrid } from './OccupancyGrid';

/** Learned floor types: 255 = unknown, else index into FLOOR_CODES of WorldModel. */
export const SURFACE_UNKNOWN = 255;

/**
 * The robot's belief about the world, built exclusively from its own sensors:
 * - occupancy grid from LiDAR rays (log-odds),
 * - a low-obstacle layer from the front structured-light sensor and bumper hits (things below the
 *   LiDAR plane), cleared again when the front sensor sees the space empty,
 * - a cliff layer from cliff sensor triggers (permanent for the session),
 * - a learned floor-type layer from the downward carpet sensor / floor camera,
 * - the planning costmap combining all of the above with user zones.
 */
export class RobotMap {
  readonly geom: GridGeometry;
  readonly occ: OccupancyGrid;
  readonly costmap: Costmap;
  readonly lowObstacles: Uint8Array;
  readonly cliffs: Uint8Array;
  readonly extraLethal: Uint8Array;
  readonly knownSurface: Uint8Array;
  /** Cells the robot body has physically occupied (definitely free). */
  readonly visited: Uint8Array;
  private noGo: Rect[] = [];
  private costmapTimer = 0;
  private lastOccVersion = -1;
  private masksDirty = true;
  /** Incremented after each costmap rebuild. */
  costmapVersion = 0;
  /** Version of the low-obstacle/cliff/surface layers for renderers. */
  layersVersion = 0;

  constructor(geom: GridGeometry, private readonly cfg: SimConfig['mapping']) {
    this.geom = geom;
    this.occ = new OccupancyGrid(geom);
    this.costmap = new Costmap(geom, { robotRadius: ROBOT.radius, inflationRadius: cfg.inflationRadius, safetyMargin: cfg.safetyMargin });
    this.lowObstacles = new Uint8Array(geom.size);
    this.cliffs = new Uint8Array(geom.size);
    this.extraLethal = new Uint8Array(geom.size);
    this.knownSurface = new Uint8Array(geom.size).fill(SURFACE_UNKNOWN);
    this.visited = new Uint8Array(geom.size);
  }

  setNoGo(zones: Rect[]): void {
    this.noGo = zones.map((z) => ({ ...z }));
    this.masksDirty = true;
  }

  get noGoZones(): readonly Rect[] {
    return this.noGo;
  }

  integrateLidar(rays: readonly LidarRay[], count: number): void {
    for (let k = 0; k < count; k++) {
      const r = rays[k];
      this.occ.integrateRay(r.ox, r.oy, r.ex, r.ey, r.hit);
    }
  }

  /** The robot's own footprint is free space. */
  markRobotFootprint(x: number, y: number): void {
    this.occ.markFreeDisc(x, y, ROBOT.radius * 0.9);
    const idx = this.geom.indexAt(x, y);
    if (idx >= 0 && !this.visited[idx]) this.visited[idx] = 1;
  }

  markLowObstacle(x: number, y: number, radius = 0.03): void {
    this.fillDisc(this.lowObstacles, x, y, radius, 1);
    this.masksDirty = true;
    this.layersVersion++;
  }

  /** Clear low-obstacle memory along a front-sensor ray that saw free space up to `range`. */
  clearLowAlong(ox: number, oy: number, ex: number, ey: number): void {
    const g = this.geom;
    const len = Math.hypot(ex - ox, ey - oy);
    const n = Math.ceil(len / (g.cellSize * 0.5));
    let changed = false;
    for (let k = 0; k <= n; k++) {
      const t = k / Math.max(1, n);
      const idx = g.indexAt(ox + (ex - ox) * t, oy + (ey - oy) * t);
      if (idx >= 0 && this.lowObstacles[idx]) {
        this.lowObstacles[idx] = 0;
        changed = true;
      }
    }
    if (changed) {
      this.masksDirty = true;
      this.layersVersion++;
    }
  }

  markCliff(x: number, y: number): void {
    this.fillDisc(this.cliffs, x, y, 0.06, 1);
    this.masksDirty = true;
    this.layersVersion++;
  }

  senseSurface(x: number, y: number, radius: number, code: (x: number, y: number) => number): void {
    const g = this.geom;
    const range = g.rectRange({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 });
    if (!range) return;
    const r2 = radius * radius;
    let changed = false;
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) {
        const dx = g.cx(i) - x;
        const dy = g.cy(j) - y;
        if (dx * dx + dy * dy > r2) continue;
        const idx = g.index(i, j);
        const c = code(g.cx(i), g.cy(j));
        if (c !== this.knownSurface[idx]) {
          this.knownSurface[idx] = c;
          changed = true;
        }
      }
    }
    if (changed) this.layersVersion++;
  }

  isKnownSoftFloor(idx: number): boolean {
    const s = this.knownSurface[idx];
    return s === 2 || s === 3;
  }

  surfaceKnown(idx: number): FloorType | null {
    const s = this.knownSurface[idx];
    return s === SURFACE_UNKNOWN ? null : (['hardwood', 'tile', 'carpet', 'rug'] as const)[s];
  }

  private fillDisc(mask: Uint8Array, x: number, y: number, r: number, v: number): void {
    const g = this.geom;
    const range = g.rectRange({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
    if (!range) {
      return;
    }
    const r2 = (r + g.cellSize * 0.5) ** 2;
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) {
        const dx = g.cx(i) - x;
        const dy = g.cy(j) - y;
        if (dx * dx + dy * dy <= r2) mask[g.index(i, j)] = v;
      }
    }
  }

  /** Rebuild the costmap if inputs changed and the interval elapsed (or `force`). Returns true if rebuilt. */
  update(dt: number, force = false): boolean {
    this.costmapTimer += dt;
    const changed = this.masksDirty || this.occ.version !== this.lastOccVersion;
    if (!force && (!changed || this.costmapTimer < this.cfg.costmapInterval)) return false;
    this.costmapTimer = 0;
    if (this.masksDirty) {
      const n = this.extraLethal.length;
      for (let i = 0; i < n; i++) this.extraLethal[i] = this.lowObstacles[i] | this.cliffs[i];
    }
    this.costmap.update(this.occ, { noGo: this.noGo, extraLethal: this.extraLethal });
    this.lastOccVersion = this.occ.version;
    this.masksDirty = false;
    this.costmapVersion++;
    return true;
  }

  /** Fraction of the masked cells that are known (free or occupied). */
  knownFraction(mask: Uint8Array): number {
    let total = 0;
    let known = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      total++;
      if (!this.occ.isUnknown(i)) known++;
    }
    return total ? known / total : 1;
  }
}
