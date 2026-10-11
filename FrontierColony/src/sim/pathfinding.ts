/**
 * A* pathfinding on the tile grid.
 *
 * - 8-direction movement; a diagonal step needs both orthogonal neighbours to be passable, so
 *   paths never cut a corner through a blocked tile.
 * - Entering a tile costs its terrain `moveCost` (x sqrt(2) for diagonals). Water-deep and
 *   mountains are impassable, and so is every tile covered by a building footprint.
 * - The goal is a rectangle of acceptable standing tiles (a 1x1 rect for a single tile, a
 *   footprint expanded by one for "walk up to a building").
 * - Binary heap with lazy deletion and generation-stamped typed-array scratch buffers that are
 *   reused between searches, so a search allocates nothing but its result path.
 * - An iteration cap bounds the worst case, and `getWalkRegions` rejects unreachable goals
 *   before any node is expanded.
 *
 * Only IEEE-exact float operations are used (see CLAUDE.md "Engine-independent math").
 */
import { AI } from './balance';
import { getWalkRegions, TERRAIN_MOVE_COST, TERRAIN_WALKABLE } from './grid';
import type { TilePos, WorldState } from './types';

const SQRT2 = 1.4142135623730951;
/** Octile heuristic factor: diagonal steps save `2 - sqrt(2)` over two orthogonal ones. */
const DIAG_SAVING = SQRT2 - 2;

/** Inclusive rectangle of tiles where the path may end. */
export interface PathGoal {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PathResult {
  /** Tiles to walk through, excluding the start tile, ending on a goal tile. Empty when already there. */
  path: TilePos[];
  /** Total move cost. */
  cost: number;
}

export interface PathStats {
  /** Nodes popped from the open list in the last search. */
  iterations: number;
  /** True when the last search gave up at the iteration cap. */
  capped: boolean;
  /** True when the last search was rejected without expanding any node. */
  rejected: boolean;
}

const stats: PathStats = { iterations: 0, capped: false, rejected: false };
export function getLastPathStats(): Readonly<PathStats> {
  return stats;
}

// Scratch buffers, reallocated only when the map size changes.
let capacity = 0;
let gScore = new Float64Array(0);
let parent = new Int32Array(0);
let openGen = new Int32Array(0);
let closedGen = new Int32Array(0);
let generation = 0;
let heapF = new Float64Array(0);
let heapI = new Int32Array(0);
let heapSize = 0;

function ensureScratch(n: number): void {
  if (capacity !== n) {
    capacity = n;
    gScore = new Float64Array(n);
    parent = new Int32Array(n);
    openGen = new Int32Array(n);
    closedGen = new Int32Array(n);
    heapF = new Float64Array(n * 2);
    heapI = new Int32Array(n * 2);
    generation = 0;
  }
  if (++generation >= 2147483647) {
    openGen.fill(0);
    closedGen.fill(0);
    generation = 1;
  }
  heapSize = 0;
}

function heapPush(f: number, node: number): void {
  if (heapSize === heapF.length) {
    const nf = new Float64Array(heapSize * 2);
    nf.set(heapF);
    heapF = nf;
    const ni = new Int32Array(heapSize * 2);
    ni.set(heapI);
    heapI = ni;
  }
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    const pf = heapF[p] as number;
    // Strictly smaller f moves up; equal f keeps insertion order (deterministic).
    if (pf <= f) break;
    heapF[i] = pf;
    heapI[i] = heapI[p] as number;
    i = p;
  }
  heapF[i] = f;
  heapI[i] = node;
}

/** Pops the smallest entry and returns its node. */
function heapPop(): number {
  const top = heapI[0] as number;
  heapSize--;
  if (heapSize > 0) {
    const f = heapF[heapSize] as number;
    const node = heapI[heapSize] as number;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= heapSize) break;
      if (c + 1 < heapSize && (heapF[c + 1] as number) < (heapF[c] as number)) c++;
      const cf = heapF[c] as number;
      if (cf >= f) break;
      heapF[i] = cf;
      heapI[i] = heapI[c] as number;
      i = c;
    }
    heapF[i] = f;
    heapI[i] = node;
  }
  return top;
}

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DY = [-1, 0, 1, 0, -1, 1, 1, -1];

/** Whether a settler can stand on tile index `i`: walkable terrain and no building footprint. */
export function isPassable(world: WorldState, i: number): boolean {
  return TERRAIN_WALKABLE[world.terrain[i] as number] === true && world.building[i] === 0;
}

/** Goal rectangle covering a single tile. */
export function tileGoal(x: number, y: number): PathGoal {
  return { x0: x, y0: y, x1: x, y1: y };
}

/** Goal rectangle of the ring of tiles around a footprint (the tiles a settler can use to reach it). */
export function accessGoal(originX: number, originY: number, w: number, h: number): PathGoal {
  return { x0: originX - 1, y0: originY - 1, x1: originX + w, y1: originY + h };
}

/**
 * Find the cheapest path from the tile (sx, sy) to any passable tile of `goal`.
 * Returns null when there is none, the goal is unreachable, or the iteration cap was hit.
 */
export function findPath(
  world: WorldState,
  sx: number,
  sy: number,
  goal: PathGoal,
  maxIterations: number = AI.pathIterationCap,
): PathResult | null {
  const W = world.width;
  const H = world.height;
  stats.iterations = 0;
  stats.capped = false;
  stats.rejected = false;
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const gx0 = Math.max(0, goal.x0);
  const gy0 = Math.max(0, goal.y0);
  const gx1 = Math.min(W - 1, goal.x1);
  const gy1 = Math.min(H - 1, goal.y1);
  if (gx0 > gx1 || gy0 > gy1) return null;
  const start = sy * W + sx;
  if (sx >= gx0 && sx <= gx1 && sy >= gy0 && sy <= gy1) return { path: [], cost: 0 };

  // Early reject: some passable goal tile must lie in the start tile's walkable region.
  const { labels } = getWalkRegions(world);
  const startRegion = labels[start] as number;
  if (startRegion !== -1) {
    let reachable = false;
    for (let y = gy0; y <= gy1 && !reachable; y++) {
      for (let x = gx0; x <= gx1; x++) {
        const i = y * W + x;
        if (labels[i] === startRegion && world.building[i] === 0) {
          reachable = true;
          break;
        }
      }
    }
    if (!reachable) {
      stats.rejected = true;
      return null;
    }
  }

  ensureScratch(W * H);
  const gen = generation;
  const terrain = world.terrain;
  const building = world.building;

  const heuristic = (x: number, y: number): number => {
    const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0;
    const dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : 0;
    return dx + dy + DIAG_SAVING * (dx < dy ? dx : dy);
  };

  gScore[start] = 0;
  parent[start] = -1;
  openGen[start] = gen;
  heapPush(heuristic(sx, sy), start);

  let iterations = 0;
  while (heapSize > 0) {
    const cur = heapPop();
    if (closedGen[cur] === gen) continue;
    closedGen[cur] = gen;
    if (++iterations > maxIterations) {
      stats.iterations = iterations;
      stats.capped = true;
      return null;
    }
    const cx = cur % W;
    const cy = (cur - cx) / W;
    if (cx >= gx0 && cx <= gx1 && cy >= gy0 && cy <= gy1) {
      stats.iterations = iterations;
      const path: TilePos[] = [];
      for (let n = cur; n !== start; n = parent[n] as number) {
        const nx = n % W;
        path.push({ x: nx, y: (n - nx) / W });
      }
      path.reverse();
      return { path, cost: gScore[cur] as number };
    }
    const g = gScore[cur] as number;
    for (let d = 0; d < 8; d++) {
      const nx = cx + (DX[d] as number);
      const ny = cy + (DY[d] as number);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (closedGen[ni] === gen) continue;
      if (TERRAIN_WALKABLE[terrain[ni] as number] !== true || building[ni] !== 0) continue;
      let step = TERRAIN_MOVE_COST[terrain[ni] as number] as number;
      if (d >= 4) {
        // No corner cutting: both orthogonal neighbours must be passable too.
        const ai = cy * W + nx;
        const bi = ny * W + cx;
        if (TERRAIN_WALKABLE[terrain[ai] as number] !== true || building[ai] !== 0) continue;
        if (TERRAIN_WALKABLE[terrain[bi] as number] !== true || building[bi] !== 0) continue;
        step *= SQRT2;
      }
      const ng = g + step;
      if (openGen[ni] === gen && (gScore[ni] as number) <= ng) continue;
      openGen[ni] = gen;
      gScore[ni] = ng;
      parent[ni] = cur;
      heapPush(ng + heuristic(nx, ny), ni);
    }
  }
  stats.iterations = iterations;
  return null;
}
