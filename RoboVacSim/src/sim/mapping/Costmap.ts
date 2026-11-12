import type { Rect } from '../world/types';
import type { GridGeometry } from './GridGeometry';
import type { OccupancyGrid } from './OccupancyGrid';

export const COST_FREE = 0;
export const COST_INSCRIBED = 253;
export const COST_UNKNOWN = 254;
export const COST_LETHAL = 255;
/** Highest graded (traversable) cost. */
export const COST_MAX_GRADED = 252;

export interface CostmapParams {
  /** Robot footprint radius (m). */
  robotRadius: number;
  /** Cost decays to 0 at this obstacle distance (m). */
  inflationRadius: number;
  /** Extra clearance added to robotRadius for the INSCRIBED band (m). */
  safetyMargin: number;
  /**
   * Optional exponential decay rate (1/m) of the graded band. Default: chosen so the cost falls from
   * 252 at the inscribed radius to ~12 at inflationRadius.
   */
  costScaling?: number;
}

export interface CostmapInputs {
  /** User restricted zones: robot footprint must never overlap them. */
  noGo: Rect[];
  /** Optional per-cell mask (1 = lethal), e.g. cliffs detected by cliff sensors, persistent bumper hits. */
  extraLethal?: Uint8Array;
  /** Default false: unknown cells cost COST_UNKNOWN. */
  unknownIsFree?: boolean;
}

const BIG = 1e12;

/**
 * Planning costmap for the robot CENTER.
 *
 * - occupied / extraLethal cells and cells whose center lies inside a no-go rect → LETHAL
 * - obstacle distance ≤ robotRadius + safetyMargin → INSCRIBED (center may not go there)
 * - up to inflationRadius → graded 1..252 (exponential decay)
 * - unknown (neither free nor occupied, not inflated) → COST_UNKNOWN unless `unknownIsFree`
 *
 * Obstacle distance is an exact Euclidean distance transform (Felzenszwalb & Huttenlocher, two 1-D
 * passes, O(cells)) between cell centers, minus half a cell so it approximates the distance from a
 * cell center to the obstacle cell's boundary. No-go rects use exact point-to-rectangle distance.
 * All buffers are preallocated and reused between updates.
 */
export class Costmap {
  readonly cost: Uint8Array;
  /**
   * Distance (m) from each cell center to the nearest lethal cell (boundary of the cell), capped at
   * inflationRadius + cellSize. 0 on lethal cells.
   */
  readonly obstacleDistance: Float32Array;
  /** Incremented on each update. */
  version = 0;
  readonly params: CostmapParams;

  private readonly sq: Float64Array;
  private readonly f: Float64Array;
  private readonly d: Float64Array;
  private readonly v: Int32Array;
  private readonly z: Float64Array;
  private readonly lethal: Uint8Array;
  private readonly costLut: Uint8Array;
  private readonly lutStep: number;

  constructor(
    readonly geom: GridGeometry,
    params: CostmapParams,
  ) {
    this.params = { ...params };
    const n = geom.size;
    this.cost = new Uint8Array(n);
    this.obstacleDistance = new Float32Array(n);
    this.sq = new Float64Array(n);
    this.lethal = new Uint8Array(n);
    const m = Math.max(geom.width, geom.height);
    this.f = new Float64Array(m);
    this.d = new Float64Array(m);
    this.v = new Int32Array(m);
    this.z = new Float64Array(m + 1);

    // Cost lookup table over distance with 1 mm resolution (distance → cost).
    this.lutStep = 0.001;
    const maxD = this.params.inflationRadius + geom.cellSize;
    const lut = new Uint8Array(Math.ceil(maxD / this.lutStep) + 2);
    for (let k = 0; k < lut.length; k++) lut[k] = this.costForDistance(k * this.lutStep);
    this.costLut = lut;
  }

  /** robotRadius + safetyMargin: the center may not be closer than this to an obstacle. */
  get inscribedRadius(): number {
    return this.params.robotRadius + this.params.safetyMargin;
  }

  /** Graded cost function for a (non-lethal) obstacle distance. */
  costForDistance(dist: number): number {
    const { inflationRadius } = this.params;
    const ins = this.inscribedRadius;
    if (dist <= 0) return COST_LETHAL;
    if (dist <= ins) return COST_INSCRIBED;
    if (dist > inflationRadius) return COST_FREE;
    const band = Math.max(1e-6, inflationRadius - ins);
    const k = this.params.costScaling ?? 3 / band;
    const c = Math.round(COST_MAX_GRADED * Math.exp(-k * (dist - ins)));
    return c < 1 ? 1 : c > COST_MAX_GRADED ? COST_MAX_GRADED : c;
  }

  update(occ: OccupancyGrid, inputs: CostmapInputs): void {
    const g = this.geom;
    const W = g.width;
    const H = g.height;
    const N = g.size;
    const cs = g.cellSize;
    const lethal = this.lethal;
    const extra = inputs.extraLethal;
    const lo = occ.logOdds;
    const occT = occ.params.occThreshold;
    const freeT = occ.params.freeThreshold;
    const sq = this.sq;

    // 1. Lethal seeds.
    let any = false;
    for (let k = 0; k < N; k++) {
      const l = lo[k] > occT || (extra !== undefined && extra[k] !== 0) ? 1 : 0;
      lethal[k] = l;
      sq[k] = l ? 0 : BIG;
      if (l) any = true;
    }

    const cap = this.params.inflationRadius + cs;
    const od = this.obstacleDistance;
    if (any) {
      // 2. Exact squared EDT in cell units: columns then rows.
      const f = this.f;
      const d = this.d;
      for (let i = 0; i < W; i++) {
        for (let j = 0; j < H; j++) f[j] = sq[j * W + i];
        this.edt1d(H);
        for (let j = 0; j < H; j++) sq[j * W + i] = d[j];
      }
      for (let j = 0; j < H; j++) {
        const base = j * W;
        for (let i = 0; i < W; i++) f[i] = sq[base + i];
        this.edt1d(W);
        for (let i = 0; i < W; i++) sq[base + i] = d[i];
      }
      const half = cs * 0.5;
      for (let k = 0; k < N; k++) {
        if (lethal[k]) {
          od[k] = 0;
          continue;
        }
        const dist = Math.sqrt(sq[k]) * cs - half;
        od[k] = dist > cap ? cap : dist < 0 ? 0 : dist;
      }
    } else {
      od.fill(cap);
    }

    // 3. No-go rects: exact distance from cell centers to the rectangle.
    for (const r of inputs.noGo) {
      if (!(r.w > 0 && r.h > 0)) continue;
      const rr = g.rectRange({ x: r.x - cap, y: r.y - cap, w: r.w + 2 * cap, h: r.h + 2 * cap });
      if (!rr) continue;
      const x1 = r.x + r.w;
      const y1 = r.y + r.h;
      for (let j = rr.j0; j <= rr.j1; j++) {
        const y = g.cy(j);
        const ddy = y < r.y ? r.y - y : y > y1 ? y - y1 : 0;
        for (let i = rr.i0; i <= rr.i1; i++) {
          const x = g.cx(i);
          const ddx = x < r.x ? r.x - x : x > x1 ? x - x1 : 0;
          const k = j * W + i;
          if (ddx === 0 && ddy === 0) {
            lethal[k] = 1;
            od[k] = 0;
          } else {
            const dist = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dist < od[k]) od[k] = dist;
          }
        }
      }
    }

    // 4. Costs.
    const cost = this.cost;
    const lut = this.costLut;
    const step = this.lutStep;
    const unknownIsFree = inputs.unknownIsFree === true;
    for (let k = 0; k < N; k++) {
      if (lethal[k]) {
        cost[k] = COST_LETHAL;
        continue;
      }
      const dist = od[k];
      let c = dist >= cap ? COST_FREE : lut[Math.round(dist / step)];
      if (c === COST_LETHAL) c = COST_INSCRIBED; // dist rounded to 0 on a non-lethal cell
      if (c !== COST_INSCRIBED && !unknownIsFree) {
        const v = lo[k];
        if (v >= freeT && v <= occT) c = COST_UNKNOWN;
      }
      cost[k] = c;
    }
    this.version++;
  }

  /** cost < COST_INSCRIBED, or == COST_UNKNOWN when allowUnknown. */
  isTraversable(index: number, allowUnknown = false): boolean {
    const c = this.cost[index];
    return c < COST_INSCRIBED || (allowUnknown && c === COST_UNKNOWN);
  }

  /** Cost at a world point (COST_LETHAL outside the grid). */
  costAt(x: number, y: number): number {
    const k = this.geom.indexAt(x, y);
    return k < 0 ? COST_LETHAL : this.cost[k];
  }

  /** Felzenszwalb-Huttenlocher 1-D squared distance transform of this.f[0..n) into this.d. */
  private edt1d(n: number): void {
    const f = this.f;
    const d = this.d;
    const v = this.v;
    const z = this.z;
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      const fq = f[q] + q * q;
      let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }
}
