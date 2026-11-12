import { CELL_FREE, CELL_OCCUPIED, CELL_UNKNOWN } from '../world/types';
import type { CellState, Rect } from '../world/types';
import type { GridGeometry } from './GridGeometry';

/** Log-odds sensor model parameters. */
export interface OccupancyParams {
  /** Log-odds added to the cell where a ray ends on an obstacle. */
  lHit: number;
  /** Log-odds added (negative) to every cell a ray passes through. */
  lMiss: number;
  /** Clamp bounds (keep the map responsive to change). */
  lMin: number;
  lMax: number;
  /** Cell is OCCUPIED when logOdds > occThreshold. */
  occThreshold: number;
  /** Cell is FREE when logOdds < freeThreshold. */
  freeThreshold: number;
}

export const DEFAULT_OCCUPANCY_PARAMS: OccupancyParams = {
  lHit: 0.85,
  lMiss: -0.4,
  lMin: -2,
  lMax: 3.5,
  occThreshold: 0.6,
  freeThreshold: -0.3,
};

/**
 * Log-odds occupancy grid built ONLY from sensor data (LiDAR rays, bumper and cliff events), never
 * from ground truth. Cell layout follows {@link GridGeometry} (row-major, index = j * width + i).
 */
export class OccupancyGrid {
  readonly params: OccupancyParams;
  readonly logOdds: Float32Array;
  /** Incremented on every mutation (lets consumers cheaply detect changes). */
  version = 0;

  private countsVersion = -1;
  private nFree = 0;
  private nOcc = 0;

  constructor(
    readonly geom: GridGeometry,
    params?: Partial<OccupancyParams>,
  ) {
    this.params = { ...DEFAULT_OCCUPANCY_PARAMS, ...params };
    this.logOdds = new Float32Array(geom.size);
  }

  /**
   * Integrates one range measurement. Cells strictly before the end cell get a miss; the end cell
   * gets a hit if `hit`, else a miss (max-range return). Exact grid traversal (Amanatides-Woo DDA);
   * cells outside the grid are skipped.
   */
  integrateRay(ox: number, oy: number, ex: number, ey: number, hit: boolean): void {
    const g = this.geom;
    const lo = this.logOdds;
    const { lHit, lMiss, lMin, lMax } = this.params;
    const cs = g.cellSize;
    let i = g.col(ox);
    let j = g.row(oy);
    const ie = g.col(ex);
    const je = g.row(ey);
    const w = g.width;
    const h = g.height;
    const endInside = ie >= 0 && je >= 0 && ie < w && je < h;
    const endIdx = endInside ? je * w + ie : -1;

    const dx = ex - ox;
    const dy = ey - oy;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? cs / Math.abs(dx) : Infinity;
    const tDeltaY = stepY !== 0 ? cs / Math.abs(dy) : Infinity;
    let tMaxX = stepX !== 0 ? (g.originX + (i + (stepX > 0 ? 1 : 0)) * cs - ox) / dx : Infinity;
    let tMaxY = stepY !== 0 ? (g.originY + (j + (stepY > 0 ? 1 : 0)) * cs - oy) / dy : Infinity;
    const n = Math.abs(ie - i) + Math.abs(je - j);

    for (let k = 0; k < n; k++) {
      if (i >= 0 && j >= 0 && i < w && j < h) {
        const idx = j * w + i;
        if (idx !== endIdx) {
          const v = lo[idx] + lMiss;
          lo[idx] = v < lMin ? lMin : v;
        }
      }
      if (tMaxX < tMaxY) {
        i += stepX;
        tMaxX += tDeltaX;
      } else {
        j += stepY;
        tMaxY += tDeltaY;
      }
    }
    if (endInside) {
      const v = lo[endIdx] + (hit ? lHit : lMiss);
      lo[endIdx] = v > lMax ? lMax : v < lMin ? lMin : v;
    }
    this.version++;
  }

  /** Force cell(s) occupied (bumper/cliff detections). radius 0 → the single containing cell. */
  markOccupied(x: number, y: number, radius = 0): void {
    const lMax = this.params.lMax;
    const c = this.geom.indexAt(x, y);
    if (c >= 0) this.logOdds[c] = lMax;
    if (radius > 0) this.forDisc(x, y, radius, (idx) => (this.logOdds[idx] = lMax));
    this.version++;
  }

  /** Mark a disc as free (the robot's own footprint is free space): cells whose center is inside. */
  markFreeDisc(x: number, y: number, r: number): void {
    const lMin = this.params.lMin;
    this.forDisc(x, y, r, (idx) => (this.logOdds[idx] = lMin));
    this.version++;
  }

  /**
   * Helper (tests, scripted maps, debug tools): set every cell overlapping `rect` to a definite state
   * (FREE → lMin, OCCUPIED → lMax, UNKNOWN → 0).
   */
  setRect(rect: Rect, state: CellState): void {
    const rr = this.geom.rectRange(rect);
    if (rr) {
      const v = state === CELL_FREE ? this.params.lMin : state === CELL_OCCUPIED ? this.params.lMax : 0;
      const w = this.geom.width;
      for (let j = rr.j0; j <= rr.j1; j++) this.logOdds.fill(v, j * w + rr.i0, j * w + rr.i1 + 1);
    }
    this.version++;
  }

  state(index: number): 0 | 1 | 2 {
    const v = this.logOdds[index];
    if (v > this.params.occThreshold) return CELL_OCCUPIED;
    if (v < this.params.freeThreshold) return CELL_FREE;
    return CELL_UNKNOWN;
  }

  isFree(i: number): boolean {
    return this.logOdds[i] < this.params.freeThreshold;
  }

  isOccupied(i: number): boolean {
    return this.logOdds[i] > this.params.occThreshold;
  }

  isUnknown(i: number): boolean {
    const v = this.logOdds[i];
    return v >= this.params.freeThreshold && v <= this.params.occThreshold;
  }

  /** Occupancy probability 0..1 of a cell. */
  probability(index: number): number {
    return 1 - 1 / (1 + Math.exp(this.logOdds[index]));
  }

  /** Writes CELL_* states of all cells into `out` (allocated if omitted). Handy for rendering. */
  states(out: Uint8Array = new Uint8Array(this.geom.size)): Uint8Array {
    const lo = this.logOdds;
    const { occThreshold, freeThreshold } = this.params;
    for (let k = 0; k < lo.length; k++) {
      const v = lo[k];
      out[k] = v > occThreshold ? CELL_OCCUPIED : v < freeThreshold ? CELL_FREE : CELL_UNKNOWN;
    }
    return out;
  }

  /** m² of free + occupied cells. Recomputed lazily when the version changed. */
  knownArea(): number {
    this.refreshCounts();
    const cs = this.geom.cellSize;
    return (this.nFree + this.nOcc) * cs * cs;
  }

  /** m² of known-free cells. */
  freeArea(): number {
    this.refreshCounts();
    const cs = this.geom.cellSize;
    return this.nFree * cs * cs;
  }

  /** Number of cells in each state. */
  counts(): { free: number; occupied: number; unknown: number } {
    this.refreshCounts();
    return { free: this.nFree, occupied: this.nOcc, unknown: this.geom.size - this.nFree - this.nOcc };
  }

  reset(): void {
    this.logOdds.fill(0);
    this.version++;
  }

  private refreshCounts(): void {
    if (this.countsVersion === this.version) return;
    const lo = this.logOdds;
    const { occThreshold, freeThreshold } = this.params;
    let f = 0;
    let o = 0;
    for (let k = 0; k < lo.length; k++) {
      const v = lo[k];
      if (v > occThreshold) o++;
      else if (v < freeThreshold) f++;
    }
    this.nFree = f;
    this.nOcc = o;
    this.countsVersion = this.version;
  }

  private forDisc(x: number, y: number, r: number, fn: (idx: number) => void): void {
    const g = this.geom;
    const i0 = Math.max(0, g.col(x - r));
    const i1 = Math.min(g.width - 1, g.col(x + r));
    const j0 = Math.max(0, g.row(y - r));
    const j1 = Math.min(g.height - 1, g.row(y + r));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const ddy = g.cy(j) - y;
      for (let i = i0; i <= i1; i++) {
        const ddx = g.cx(i) - x;
        if (ddx * ddx + ddy * ddy <= r2) fn(j * g.width + i);
      }
    }
  }
}
