import type { Vec2 } from '../world/types';
import type { GridGeometry } from '../mapping/GridGeometry';
import { COST_INSCRIBED, COST_LETHAL, COST_MAX_GRADED, COST_UNKNOWN } from '../mapping/Costmap';
import type { Costmap } from '../mapping/Costmap';
import { BinaryHeap } from './BinaryHeap';

export interface PlanOptions {
  /** Unknown cells (COST_UNKNOWN) are traversable. Default false. */
  allowUnknown?: boolean;
  /** If the goal cell is not traversable, use the nearest traversable cell within this distance (m). Default 0.15. */
  goalTolerance?: number;
  /** Search budget (popped nodes). Default: number of cells. */
  maxExpansions?: number;
  /** Step cost = length × (1 + costWeight × cost/252). Default 3. */
  costWeight?: number;
  /** Line-of-sight smoothing (default true). */
  smooth?: boolean;
}

export interface PlanResult {
  ok: boolean;
  /** World points: path[0] = start, last = goal (or substituted goal). Empty when !ok. */
  path: Vec2[];
  /** Number of grid cells in the raw (unsmoothed) path. */
  rawCells: number;
  expansions: number;
  reason?: 'startBlocked' | 'goalBlocked' | 'noPath' | 'budget';
  /** Accumulated weighted path cost (m-equivalent) of the raw path. */
  cost: number;
  /** The goal actually planned to (differs from the requested goal when it was substituted). */
  goal?: Vec2;
}

/** Equivalent graded cost used for unknown cells when allowUnknown (moderate penalty). */
const UNKNOWN_COST_EQUIV = 120;
/** Line-of-sight shortcuts may not cross cells costlier than max(this, highest cost they replace). */
const SMOOTH_COST_THRESHOLD = 128;
const SQRT2 = Math.SQRT2;
const DI = [1, 0, -1, 0, 1, -1, -1, 1];
const DJ = [0, 1, 0, -1, 1, 1, -1, -1];

/**
 * 8-connected grid A* on a {@link Costmap} with an octile heuristic and no corner cutting.
 * All search buffers are preallocated in the constructor and reused (generation stamps avoid clears).
 */
export class AStarPlanner {
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: BinaryHeap;
  /** Per-call passability: 0 blocked, 1 traversable, 2 escape-only (INSCRIBED near a blocked start). */
  private readonly mask: Uint8Array;
  private gen = 0;

  constructor(readonly geom: GridGeometry) {
    const n = geom.size;
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new BinaryHeap(Math.max(1024, n >> 2));
    this.mask = new Uint8Array(n);
  }

  plan(cm: Costmap, start: Vec2, goal: Vec2, opts: PlanOptions = {}): PlanResult {
    const geom = this.geom;
    const W = geom.width;
    const H = geom.height;
    const cs = geom.cellSize;
    const allowUnknown = opts.allowUnknown === true;
    const tol = opts.goalTolerance ?? 0.15;
    const maxExp = opts.maxExpansions ?? geom.size;
    const cw = opts.costWeight ?? 3;
    const cost = cm.cost;

    const s = geom.indexAt(start.x, start.y);
    if (s < 0) return fail('startBlocked', 0);
    let gIdx = geom.indexAt(goal.x, goal.y);
    let goalPt: Vec2 = { x: goal.x, y: goal.y };
    if (gIdx < 0 || !cm.isTraversable(gIdx, allowUnknown)) {
      gIdx = this.nearestTraversable(cm, goal, tol, allowUnknown);
      if (gIdx < 0) return fail('goalBlocked', 0);
      goalPt = geom.centerOf(gIdx);
    }

    const startBlocked = !cm.isTraversable(s, allowUnknown);
    if (s === gIdx) return okResult([{ x: start.x, y: start.y }, goalPt], 1, 0, 0, goalPt);

    const gArr = this.g;
    const parent = this.parent;
    const stamp = this.stamp;
    const closed = this.closed;
    const heap = this.heap;
    const gen = this.nextGen();
    heap.clear();

    const si = s % W;
    const sj = (s - si) / W;
    const gi = gIdx % W;
    const gj = (gIdx - gi) / W;
    const mask = this.buildMask(cm, allowUnknown, s, startBlocked);

    const heur = (i: number, j: number): number => {
      const dx = Math.abs(i - gi);
      const dy = Math.abs(j - gj);
      return (dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx) * cs;
    };

    stamp[s] = gen;
    gArr[s] = 0;
    parent[s] = -1;
    heap.push(s, heur(si, sj), heur(si, sj));
    let expansions = 0;
    let found = false;
    const ins = cm.inscribedRadius;
    const od = cm.obstacleDistance;

    while (heap.length > 0) {
      const u = heap.pop();
      if (closed[u] === gen) continue;
      closed[u] = gen;
      if (u === gIdx) {
        found = true;
        break;
      }
      if (++expansions > maxExp) return fail('budget', expansions);
      const ui = u % W;
      const uj = (u - ui) / W;
      // From a traversable cell only traversable cells (1) may be entered; from an escape cell also 2.
      const lim = mask[u] === 1 ? 1 : 2;
      const gu = gArr[u];
      for (let n = 0; n < 8; n++) {
        const ni = ui + DI[n];
        const nj = uj + DJ[n];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const k = nj * W + ni;
        const mk = mask[k];
        if (mk === 0 || mk > lim || closed[k] === gen) continue;
        let len = cs;
        if (n >= 4) {
          // No corner cutting: both orthogonal neighbours must be passable too.
          const m1 = mask[uj * W + ni];
          const m2 = mask[nj * W + ui];
          if (m1 === 0 || m1 > lim || m2 === 0 || m2 > lim) continue;
          len = cs * SQRT2;
        }
        const c = cost[k];
        let mult: number;
        if (c <= COST_MAX_GRADED) mult = 1 + (cw * c) / COST_MAX_GRADED;
        else if (c === COST_UNKNOWN) mult = 1 + (cw * UNKNOWN_COST_EQUIV) / COST_MAX_GRADED;
        else mult = (1 + cw) * (2 + (ins - od[k]) / ins); // escape through INSCRIBED: steer outward
        const ng = gu + len * mult;
        if (stamp[k] !== gen || ng < gArr[k]) {
          stamp[k] = gen;
          gArr[k] = ng;
          parent[k] = u;
          const h = heur(ni, nj);
          heap.push(k, ng + h, h);
        }
      }
    }

    if (!found) return fail(startBlocked ? 'startBlocked' : 'noPath', expansions);

    // Reconstruct raw cell path.
    const cells: number[] = [];
    for (let k = gIdx; k !== -1; k = parent[k]) cells.push(k);
    cells.reverse();
    const totalCost = gArr[gIdx];

    const pts: Vec2[] = new Array<Vec2>(cells.length);
    pts[0] = { x: start.x, y: start.y };
    for (let k = 1; k < cells.length - 1; k++) pts[k] = geom.centerOf(cells[k]);
    pts[cells.length - 1] = goalPt;

    const path = opts.smooth === false ? pts : this.smoothPath(cm, cells, pts, allowUnknown);
    return okResult(path, cells.length, expansions, totalCost, goalPt);

    function fail(reason: NonNullable<PlanResult['reason']>, exp: number): PlanResult {
      return { ok: false, path: [], rawCells: 0, expansions: exp, reason, cost: Infinity };
    }
    function okResult(path: Vec2[], raw: number, exp: number, c: number, gp: Vec2): PlanResult {
      return { ok: true, path, rawCells: raw, expansions: exp, cost: c, goal: gp };
    }
  }

  /**
   * Single-source Dijkstra over traversable cells (8-connected, no corner cutting, metric step
   * lengths). Returns distance (m) from `start` to every cell center, Infinity if unreachable.
   * A start inside the inflated zone may escape through INSCRIBED cells as in {@link plan}.
   */
  distanceField(cm: Costmap, start: Vec2, allowUnknown = false, out?: Float32Array): Float32Array {
    const geom = this.geom;
    const W = geom.width;
    const H = geom.height;
    const cs = geom.cellSize;
    const field = out ?? new Float32Array(geom.size);
    field.fill(Infinity);
    const s = geom.indexAt(start.x, start.y);
    if (s < 0) return field;
    const mask = this.buildMask(cm, allowUnknown, s, !cm.isTraversable(s, allowUnknown));

    const gArr = this.g;
    const closed = this.closed;
    const stamp = this.stamp;
    const heap = this.heap;
    const gen = this.nextGen();
    heap.clear();
    stamp[s] = gen;
    gArr[s] = 0;
    heap.push(s, 0, 0);
    const diag = cs * SQRT2;
    while (heap.length > 0) {
      const u = heap.pop();
      if (closed[u] === gen) continue;
      closed[u] = gen;
      const gu = gArr[u];
      field[u] = gu;
      const ui = u % W;
      const uj = (u - ui) / W;
      const lim = mask[u] === 1 ? 1 : 2;
      for (let n = 0; n < 8; n++) {
        const ni = ui + DI[n];
        const nj = uj + DJ[n];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const k = nj * W + ni;
        const mk = mask[k];
        if (mk === 0 || mk > lim || closed[k] === gen) continue;
        let len = cs;
        if (n >= 4) {
          const m1 = mask[uj * W + ni];
          const m2 = mask[nj * W + ui];
          if (m1 === 0 || m1 > lim || m2 === 0 || m2 > lim) continue;
          len = diag;
        }
        const ng = gu + len;
        if (stamp[k] !== gen || ng < gArr[k]) {
          stamp[k] = gen;
          gArr[k] = ng;
          heap.push(k, ng, 0);
        }
      }
    }
    return field;
  }

  /** Nearest traversable cell (by distance from `p` to the cell center) within `tol`, or -1. */
  nearestTraversable(cm: Costmap, p: Vec2, tol: number, allowUnknown = false): number {
    const geom = this.geom;
    const W = geom.width;
    const i0 = Math.max(0, geom.col(p.x - tol));
    const i1 = Math.min(W - 1, geom.col(p.x + tol));
    const j0 = Math.max(0, geom.row(p.y - tol));
    const j1 = Math.min(geom.height - 1, geom.row(p.y + tol));
    let best = -1;
    let bestD = tol * tol + 1e-12;
    for (let j = j0; j <= j1; j++) {
      const dy = geom.cy(j) - p.y;
      for (let i = i0; i <= i1; i++) {
        const dx = geom.cx(i) - p.x;
        const d2 = dx * dx + dy * dy;
        const k = j * W + i;
        if (d2 < bestD && cm.isTraversable(k, allowUnknown)) {
          bestD = d2;
          best = k;
        }
      }
    }
    return best;
  }

  /**
   * Fills the passability mask: 1 = traversable; 2 = INSCRIBED (not LETHAL) cell within
   * inscribedRadius + 1 cell of a blocked start (escape band); 0 = blocked. The start cell itself is
   * always enterable (2 when blocked).
   */
  private buildMask(cm: Costmap, allowUnknown: boolean, s: number, startBlocked: boolean): Uint8Array {
    const mask = this.mask;
    const cost = cm.cost;
    const N = cost.length;
    for (let k = 0; k < N; k++) {
      const c = cost[k];
      mask[k] = c < COST_INSCRIBED || (allowUnknown && c === COST_UNKNOWN) ? 1 : 0;
    }
    if (startBlocked) {
      const geom = this.geom;
      const W = geom.width;
      const cs = geom.cellSize;
      const si = s % W;
      const sj = (s - si) / W;
      const r = Math.ceil(cm.inscribedRadius / cs) + 1;
      const r2 = r * r;
      for (let j = Math.max(0, sj - r); j <= Math.min(geom.height - 1, sj + r); j++) {
        for (let i = Math.max(0, si - r); i <= Math.min(W - 1, si + r); i++) {
          const k = j * W + i;
          if (cost[k] === COST_INSCRIBED && (i - si) * (i - si) + (j - sj) * (j - sj) <= r2) mask[k] = 2;
        }
      }
      mask[s] = 2;
    }
    return mask;
  }

  private nextGen(): number {
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    return this.gen;
  }

  /**
   * Greedy line-of-sight shortcutting: from each anchor, extend to the farthest consecutive raw point
   * whose straight segment crosses only traversable cells no costlier than
   * max(SMOOTH_COST_THRESHOLD, highest raw cost on the replaced span). Endpoints are preserved.
   */
  private smoothPath(cm: Costmap, cells: number[], pts: Vec2[], allowUnknown: boolean): Vec2[] {
    const n = pts.length;
    if (n <= 2) return pts.slice();
    const cost = cm.cost;
    const rawCost = (k: number): number => {
      const c = cost[cells[k]];
      return c === COST_UNKNOWN ? UNKNOWN_COST_EQUIV : c > COST_MAX_GRADED ? COST_LETHAL : c;
    };
    const out: Vec2[] = [pts[0]];
    let a = 0;
    while (a < n - 1) {
      let b = a + 1;
      let spanMax = Math.max(rawCost(a), rawCost(b));
      // Only shortcut from a traversable anchor (escape steps stay raw).
      if (rawCost(a) <= COST_MAX_GRADED) {
        while (b + 1 < n) {
          const cand = Math.max(spanMax, rawCost(b + 1));
          const limit = Math.max(SMOOTH_COST_THRESHOLD, cand);
          if (limit > COST_MAX_GRADED) break;
          if (!segmentClear(cm, pts[a], pts[b + 1], limit, allowUnknown)) break;
          spanMax = cand;
          b++;
        }
      }
      out.push(pts[b]);
      a = b;
    }
    return out;
  }
}

/**
 * True when every cell touched by segment a→b (supercover traversal, both cells at exact vertex
 * crossings) has cost ≤ maxCost (unknown counts as UNKNOWN_COST_EQUIV when allowUnknown, otherwise
 * blocks). The cell containing `a` is not checked (it is the current anchor).
 */
export function segmentClear(cm: Costmap, a: Vec2, b: Vec2, maxCost: number, allowUnknown = false): boolean {
  const g = cm.geom;
  const W = g.width;
  const H = g.height;
  const cs = g.cellSize;
  const cost = cm.cost;
  const ok = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const c = cost[j * W + i];
    if (c === COST_UNKNOWN) return allowUnknown && UNKNOWN_COST_EQUIV <= maxCost;
    return c <= COST_MAX_GRADED && c <= maxCost;
  };
  let i = g.col(a.x);
  let j = g.row(a.y);
  const ie = g.col(b.x);
  const je = g.row(b.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tdx = sx !== 0 ? cs / Math.abs(dx) : Infinity;
  const tdy = sy !== 0 ? cs / Math.abs(dy) : Infinity;
  let tmx = sx !== 0 ? (g.originX + (i + (sx > 0 ? 1 : 0)) * cs - a.x) / dx : Infinity;
  let tmy = sy !== 0 ? (g.originY + (j + (sy > 0 ? 1 : 0)) * cs - a.y) / dy : Infinity;
  let guard = Math.abs(ie - i) + Math.abs(je - j) + 2;
  while ((i !== ie || j !== je) && guard-- > 0) {
    const diff = tmx - tmy;
    if (Math.abs(diff) < 1e-9) {
      // Passing exactly through a vertex: both side cells must be clear.
      if (!ok(i + sx, j) || !ok(i, j + sy)) return false;
      i += sx;
      j += sy;
      tmx += tdx;
      tmy += tdy;
    } else if (diff < 0) {
      i += sx;
      tmx += tdx;
    } else {
      j += sy;
      tmy += tdy;
    }
    if (!ok(i, j)) return false;
  }
  return true;
}

