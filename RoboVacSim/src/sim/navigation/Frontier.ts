import type { Vec2 } from '../world/types';
import type { Costmap } from '../mapping/Costmap';
import type { OccupancyGrid } from '../mapping/OccupancyGrid';

export interface Frontier {
  id: number;
  centroid: Vec2;
  /** Number of frontier cells in the cluster. */
  size: number;
  /** A traversable cell (center) adjacent to/inside the frontier, nearest the centroid. */
  target: Vec2;
  /** Grid indices of the frontier cells (extra, for rendering/debugging). */
  cells: Int32Array;
}

/** How far (m) from the frontier cells a target may be searched (through known-free space). */
export const FRONTIER_TARGET_SEARCH = 0.6;

const N8I = [1, 0, -1, 0, 1, -1, -1, 1];
const N8J = [0, 1, 0, -1, 1, 1, -1, -1];

/**
 * Frontier cell = known-free cell with at least one 4-neighbour unknown. Frontier cells are clustered
 * with 8-connectivity (BFS in scan order, so ids are deterministic); clusters smaller than `minCells`
 * are dropped. The target is found by a bounded BFS from the cluster cells through known-free cells
 * (≤ 0.6 m): the costmap-traversable visited cell nearest the centroid wins. Clusters without any
 * reachable traversable target (e.g. a gap under furniture too low/narrow for the robot) are dropped.
 */
export function findFrontiers(occ: OccupancyGrid, cm: Costmap, minCells = 6): Frontier[] {
  const g = occ.geom;
  const W = g.width;
  const H = g.height;
  const N = g.size;
  const lo = occ.logOdds;
  const freeT = occ.params.freeThreshold;
  const occT = occ.params.occThreshold;
  const isFree = (k: number): boolean => lo[k] < freeT;
  const isUnknown = (k: number): boolean => lo[k] >= freeT && lo[k] <= occT;

  // 1 = frontier cell, 2 = frontier cell already clustered.
  const mark = new Uint8Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!isFree(k)) continue;
      if (
        (i > 0 && isUnknown(k - 1)) ||
        (i < W - 1 && isUnknown(k + 1)) ||
        (j > 0 && isUnknown(k - W)) ||
        (j < H - 1 && isUnknown(k + W))
      ) {
        mark[k] = 1;
      }
    }
  }

  const result: Frontier[] = [];
  const queue = new Int32Array(N);
  const seen = new Uint32Array(N); // BFS stamps for target search
  let stampGen = 0;
  const cs = g.cellSize;
  const maxSteps = Math.max(1, Math.round(FRONTIER_TARGET_SEARCH / cs));
  const depth = new Int32Array(N);

  for (let start = 0; start < N; start++) {
    if (mark[start] !== 1) continue;
    // Cluster BFS (8-connectivity).
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    mark[start] = 2;
    while (head < tail) {
      const u = queue[head++];
      const ui = u % W;
      const uj = (u - ui) / W;
      for (let n = 0; n < 8; n++) {
        const ni = ui + N8I[n];
        const nj = uj + N8J[n];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const k = nj * W + ni;
        if (mark[k] === 1) {
          mark[k] = 2;
          queue[tail++] = k;
        }
      }
    }
    const size = tail;
    if (size < minCells) continue;
    const cells = queue.slice(0, size);
    let sx = 0;
    let sy = 0;
    for (let q = 0; q < size; q++) {
      const k = cells[q];
      const i = k % W;
      sx += g.cx(i);
      sy += g.cy((k - i) / W);
    }
    const centroid = { x: sx / size, y: sy / size };

    // Target: bounded multi-source BFS from the cluster through known-free cells.
    stampGen++;
    head = 0;
    tail = 0;
    for (let q = 0; q < size; q++) {
      seen[cells[q]] = stampGen;
      depth[cells[q]] = 0;
      queue[tail++] = cells[q];
    }
    let best = -1;
    let bestD = Infinity;
    while (head < tail) {
      const u = queue[head++];
      const ui = u % W;
      const uj = (u - ui) / W;
      if (cm.isTraversable(u, false)) {
        const dx = g.cx(ui) - centroid.x;
        const dy = g.cy(uj) - centroid.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD || (d2 === bestD && u < best)) {
          bestD = d2;
          best = u;
        }
      }
      if (depth[u] >= maxSteps) continue;
      for (let n = 0; n < 8; n++) {
        const ni = ui + N8I[n];
        const nj = uj + N8J[n];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const k = nj * W + ni;
        if (seen[k] === stampGen || !isFree(k)) continue;
        seen[k] = stampGen;
        depth[k] = depth[u] + 1;
        queue[tail++] = k;
      }
    }
    if (best < 0) continue;
    result.push({ id: result.length, centroid, size, target: g.centerOf(best), cells });
  }
  return result;
}
