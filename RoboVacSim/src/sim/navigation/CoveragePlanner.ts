import type { Vec2 } from '../world/types';
import { COST_INSCRIBED, COST_MAX_GRADED, COST_UNKNOWN } from '../mapping/Costmap';
import { segmentClear } from './AStar';
import type { Costmap } from '../mapping/Costmap';

export interface CoverageOptions {
  /** Distance between adjacent lanes (m). */
  laneSpacing: number;
  /** Lane direction: 'x' = lanes parallel to the x axis. 'auto' (default) = longer bbox extent. */
  axis?: 'x' | 'y' | 'auto';
  /** Segments shorter than this are dropped (m). Default 0.15. */
  minLaneLength?: number;
  /** The first lane starts near this point (default: bbox min corner). */
  startNear?: Vec2;
}

export interface Lane {
  a: Vec2;
  b: Vec2;
}

interface Seg {
  /** Lane row index (0..nRows-1) and grid line coordinate v. */
  row: number;
  v: number;
  u0: number;
  u1: number;
  next: number;
  prev: number;
  nSucc: number;
  nPred: number;
}

/**
 * Boustrophedon coverage of the cells where regionMask[i] === 1 AND the costmap is traversable
 * (known free, cost < INSCRIBED).
 *
 * Lane rows are spread evenly (spacing ≤ laneSpacing) between the first and last valid grid line of
 * the region, on cell centers. Each lane row is split into runs of consecutive valid cells
 * (obstacles/concavities split lanes); runs shorter than minLaneLength are dropped. Runs on
 * consecutive lane rows whose extents overlap one-to-one are chained into "sweeps" (a boustrophedon
 * cell). Sweeps are visited greedily (nearest lane endpoint from the current position, starting at
 * startNear) and traversed in snake order; each lane is oriented so it starts at the endpoint nearest
 * the previous lane's end.
 */
export function planCoverage(cm: Costmap, regionMask: Uint8Array, opts: CoverageOptions): Lane[] {
  const g = cm.geom;
  const W = g.width;
  const H = g.height;
  const cs = g.cellSize;
  const cost = cm.cost;
  const valid = (k: number): boolean => regionMask[k] === 1 && cost[k] < COST_INSCRIBED;

  // Bounding box of valid cells.
  let i0 = W;
  let i1 = -1;
  let j0 = H;
  let j1 = -1;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!valid(j * W + i)) continue;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  }
  if (i1 < 0) return [];

  const axis = opts.axis === 'x' || opts.axis === 'y' ? opts.axis : i1 - i0 >= j1 - j0 ? 'x' : 'y';
  // (u, v): u along the lane, v across lanes.
  const alongX = axis === 'x';
  const u0 = alongX ? i0 : j0;
  const u1 = alongX ? i1 : j1;
  const v0 = alongX ? j0 : i0;
  const v1 = alongX ? j1 : i1;
  const idx = (u: number, v: number): number => (alongX ? v * W + u : u * W + v);
  const toWorld = (u: number, v: number): Vec2 => (alongX ? { x: g.cx(u), y: g.cy(v) } : { x: g.cx(v), y: g.cy(u) });

  const step = Math.max(1, Math.floor(opts.laneSpacing / cs + 1e-9));
  const span = v1 - v0;
  const nRows = span === 0 ? 1 : Math.ceil(span / step) + 1;
  const minLen = opts.minLaneLength ?? 0.15;
  const minCells = Math.max(1, Math.ceil(minLen / cs - 1e-9) + 1);

  // Lane segments per row.
  const segs: Seg[] = [];
  const rowStart: number[] = [];
  for (let r = 0; r < nRows; r++) {
    rowStart.push(segs.length);
    const v = nRows === 1 ? v0 : v0 + Math.round((r * span) / (nRows - 1));
    let runStart = -1;
    for (let u = u0; u <= u1 + 1; u++) {
      const ok = u <= u1 && valid(idx(u, v));
      if (ok && runStart < 0) runStart = u;
      else if (!ok && runStart >= 0) {
        if (u - runStart >= minCells) {
          segs.push({ row: r, v, u0: runStart, u1: u - 1, next: -1, prev: -1, nSucc: 0, nPred: 0 });
        }
        runStart = -1;
      }
    }
  }
  rowStart.push(segs.length);
  if (segs.length === 0) return [];

  // Overlap graph between consecutive rows.
  for (let r = 0; r + 1 < nRows; r++) {
    for (let a = rowStart[r]; a < rowStart[r + 1]; a++) {
      for (let b = rowStart[r + 1]; b < rowStart[r + 2]; b++) {
        const A = segs[a];
        const B = segs[b];
        if (A.u0 <= B.u1 && B.u0 <= A.u1) {
          A.nSucc++;
          B.nPred++;
          A.next = b;
          B.prev = a;
        }
      }
    }
  }

  // Sweeps: maximal chains where links are one-to-one.
  const sweepOf = new Int32Array(segs.length).fill(-1);
  const sweeps: number[][] = [];
  for (let s = 0; s < segs.length; s++) {
    if (sweepOf[s] >= 0) continue;
    // Walk up to the chain head.
    let head = s;
    for (;;) {
      const S = segs[head];
      if (S.nPred !== 1) break;
      const p = S.prev;
      if (segs[p].nSucc !== 1 || sweepOf[p] >= 0) break;
      head = p;
    }
    const chain: number[] = [];
    let cur = head;
    for (;;) {
      chain.push(cur);
      sweepOf[cur] = sweeps.length;
      const S = segs[cur];
      if (S.nSucc !== 1) break;
      const nx = S.next;
      if (segs[nx].nPred !== 1 || sweepOf[nx] >= 0) break;
      cur = nx;
    }
    sweeps.push(chain);
  }

  // Greedy ordering of sweeps; snake within.
  const out: Lane[] = [];
  const pos: Vec2 = opts.startNear ? { x: opts.startNear.x, y: opts.startNear.y } : toWorld(u0, v0);
  const used = new Uint8Array(sweeps.length);
  const d2 = (p: Vec2, q: Vec2): number => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
  for (let done = 0; done < sweeps.length; done++) {
    let best = -1;
    let bestFromTop = true;
    let bestD = Infinity;
    for (let w = 0; w < sweeps.length; w++) {
      if (used[w]) continue;
      const chain = sweeps[w];
      const top = segs[chain[0]];
      const bot = segs[chain[chain.length - 1]];
      const cand: Array<[number, boolean]> = [
        [Math.min(d2(pos, toWorld(top.u0, top.v)), d2(pos, toWorld(top.u1, top.v))), true],
        [Math.min(d2(pos, toWorld(bot.u0, bot.v)), d2(pos, toWorld(bot.u1, bot.v))), false],
      ];
      for (const [d, fromTop] of cand) {
        if (d < bestD - 1e-12) {
          bestD = d;
          best = w;
          bestFromTop = fromTop;
        }
      }
    }
    used[best] = 1;
    const chain = bestFromTop ? sweeps[best] : sweeps[best].slice().reverse();
    for (const s of chain) {
      const S = segs[s];
      const pa = toWorld(S.u0, S.v);
      const pb = toWorld(S.u1, S.v);
      if (d2(pos, pa) <= d2(pos, pb)) {
        out.push({ a: pa, b: pb });
        pos.x = pb.x;
        pos.y = pb.y;
      } else {
        out.push({ a: pb, b: pa });
        pos.x = pa.x;
        pos.y = pa.y;
      }
    }
  }
  return out;
}

const N8I = [1, 1, 0, -1, -1, -1, 0, 1];
const N8J = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Wall/edge-following paths: ordered points tracing the boundary of the traversable area inside
 * regionMask — traversable region cells with a 4-neighbour that is INSCRIBED or LETHAL — so the
 * robot center skims walls & furniture at the minimum safe distance. Boundary cells are chained by
 * 8-connected walking (4-neighbours preferred), extended in both directions from the seed; chains
 * whose ends are adjacent are closed into loops. Each polyline is oriented so obstacles are on the
 * robot's RIGHT (side-brush side), then simplified with Douglas-Peucker under the constraint that
 * every simplified segment stays on traversable cells. Polylines shorter than minLoopLength are
 * dropped. Returned longest first.
 */
export function planEdgePaths(
  cm: Costmap,
  regionMask: Uint8Array,
  opts: { minLoopLength?: number; simplifyTolerance?: number } = {},
): Vec2[][] {
  const g = cm.geom;
  const W = g.width;
  const H = g.height;
  const N = g.size;
  const cs = g.cellSize;
  const cost = cm.cost;
  const minLoop = opts.minLoopLength ?? 0.4;
  const tol = opts.simplifyTolerance ?? 0.025;
  const blocked = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const c = cost[j * W + i];
    return c >= COST_INSCRIBED && c !== COST_UNKNOWN;
  };

  const boundary = new Uint8Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (regionMask[k] !== 1 || cost[k] >= COST_INSCRIBED) continue;
      if (blocked(i - 1, j) || blocked(i + 1, j) || blocked(i, j - 1) || blocked(i, j + 1)) boundary[k] = 1;
    }
  }

  const trav = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < W && j < H && cost[j * W + i] < COST_INSCRIBED;
  /**
   * For a step a→b between 8-adjacent cells: -1 = direct step is safe, ≥0 = traversable orthogonal
   * cell to pass through (diagonal would clip an inscribed corner), -2 = no safe connection.
   */
  const bridge = (a: number, b: number): number => {
    const ai = a % W;
    const aj = (a - ai) / W;
    const bi = b % W;
    const bj = (b - bi) / W;
    if (ai === bi || aj === bj) return -1;
    const t1 = trav(bi, aj);
    const t2 = trav(ai, bj);
    if (t1 && t2) return -1;
    if (t1) return aj * W + bi;
    if (t2) return bj * W + ai;
    return -2;
  };

  const visited = new Uint8Array(N);
  const walk = (from: number, chain: number[]): void => {
    let cur = from;
    for (;;) {
      const ci = cur % W;
      const cj = (cur - ci) / W;
      let nxt = -1;
      let via = -1;
      // 4-neighbours first (even n), then diagonals.
      for (let pass = 0; pass < 2 && nxt < 0; pass++) {
        for (let n = pass; n < 8; n += 2) {
          const ni = ci + N8I[n];
          const nj = cj + N8J[n];
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const k = nj * W + ni;
          if (!boundary[k] || visited[k]) continue;
          const b = bridge(cur, k);
          if (b === -2) continue;
          nxt = k;
          via = b;
          break;
        }
      }
      if (nxt < 0) return;
      visited[nxt] = 1;
      if (via >= 0) chain.push(via);
      chain.push(nxt);
      cur = nxt;
    }
  };
  const adjacent = (a: number, b: number): boolean => {
    const ai = a % W;
    const bi = b % W;
    return Math.abs(ai - bi) <= 1 && Math.abs((a - ai) / W - (b - bi) / W) <= 1 && bridge(a, b) !== -2;
  };

  const result: Vec2[][] = [];
  for (let s = 0; s < N; s++) {
    if (!boundary[s] || visited[s]) continue;
    visited[s] = 1;
    const fwd: number[] = [s];
    walk(s, fwd);
    const back: number[] = [];
    walk(s, back);
    const chain = back.reverse().concat(fwd);
    const closed = chain.length > 3 && adjacent(chain[0], chain[chain.length - 1]);
    if (closed) {
      const via = bridge(chain[chain.length - 1], chain[0]);
      if (via >= 0) chain.push(via);
    }
    let pts: Vec2[] = chain.map((k) => g.centerOf(k));
    if (closed) pts.push({ x: pts[0].x, y: pts[0].y });
    if (polylineLength(pts) < minLoop) continue;

    // Orient so the obstacle side is on the right.
    let right = 0;
    for (let q = 0; q + 1 < pts.length; q++) {
      const dx = pts[q + 1].x - pts[q].x;
      const dy = pts[q + 1].y - pts[q].y;
      const L = Math.hypot(dx, dy) || 1;
      const mx = (pts[q].x + pts[q + 1].x) / 2;
      const my = (pts[q].y + pts[q + 1].y) / 2;
      const rx = (dy / L) * cs;
      const ry = (-dx / L) * cs;
      const rb = blocked(g.col(mx + rx), g.row(my + ry));
      const lb = blocked(g.col(mx - rx), g.row(my - ry));
      if (rb && !lb) right++;
      else if (lb && !rb) right--;
    }
    if (right < 0) pts.reverse();

    pts = simplifyConstrained(cm, pts, tol);
    result.push(pts);
  }
  result.sort((p, q) => polylineLength(q) - polylineLength(p));
  return result;
}

export function polylineLength(pts: Vec2[]): number {
  let L = 0;
  for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  return L;
}

/** Segment a→b crosses only traversable (known, non-inscribed) cells (supercover traversal). */
function segmentTraversable(cm: Costmap, a: Vec2, b: Vec2): boolean {
  const k = cm.geom.indexAt(a.x, a.y);
  return k >= 0 && cm.cost[k] < COST_INSCRIBED && segmentClear(cm, a, b, COST_MAX_GRADED, false);
}

/** Douglas-Peucker that only accepts a simplified segment if it stays on traversable cells. */
function simplifyConstrained(cm: Costmap, pts: Vec2[], tol: number): Vec2[] {
  const n = pts.length;
  if (n <= 2 || tol <= 0) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    if (b - a < 2) continue;
    const A = pts[a];
    const B = pts[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = -1;
    for (let k = a + 1; k < b; k++) {
      const P = pts[k];
      let d: number;
      if (L2 < 1e-12) d = Math.hypot(P.x - A.x, P.y - A.y);
      else {
        const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / L2));
        d = Math.hypot(P.x - A.x - t * dx, P.y - A.y - t * dy);
      }
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worstD > tol || L2 < 1e-12 || !segmentTraversable(cm, A, B)) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k]);
  return out;
}
