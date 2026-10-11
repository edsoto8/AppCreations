/**
 * Grid lookups built for pathfinding and world analysis. Everything is indexed by tile index
 * (`y * width + x`) or by terrain code, so the inner loop of an A* search is plain array reads.
 *
 * Nothing here is part of GameState: the tables derive from `TERRAIN_DEFS`, and the region
 * labels are cached per `WorldState` object and rebuilt when `world.revision` changes.
 */
import { TERRAIN_DEFS } from './balance';
import type { Terrain, WorldState } from './types';

const TERRAIN_COUNT = Object.keys(TERRAIN_DEFS).length;

/** `TERRAIN_WALKABLE[terrain]`: terrain-only walkability (buildings are not considered). */
export const TERRAIN_WALKABLE: readonly boolean[] = Array.from(
  { length: TERRAIN_COUNT },
  (_, t) => TERRAIN_DEFS[t as Terrain].walkable,
);

/** `TERRAIN_MOVE_COST[terrain]`: cost of entering a tile, `Infinity` for unwalkable terrain. */
export const TERRAIN_MOVE_COST: readonly number[] = Array.from({ length: TERRAIN_COUNT }, (_, t) => {
  const def = TERRAIN_DEFS[t as Terrain];
  return def.walkable ? def.moveCost : Infinity;
});

/** Terrain-only walkability of tile index `i` (no bounds check). */
export function isWalkableIndex(world: WorldState, i: number): boolean {
  return TERRAIN_WALKABLE[world.terrain[i] as number] === true;
}

/** Terrain move cost of tile index `i` (no bounds check); `Infinity` when unwalkable. */
export function moveCostAtIndex(world: WorldState, i: number): number {
  return TERRAIN_MOVE_COST[world.terrain[i] as number] as number;
}

/** Result of labelling connected regions. */
export interface RegionLabels {
  /** Region number per tile (0-based, in scan order of the first tile), or -1 when excluded. */
  labels: Int32Array;
  /** Tile count per region. */
  sizes: number[];
}

/**
 * Label 4-connected regions of tiles for which `include(index)` is true.
 * Scan order is row-major, so the numbering is deterministic.
 */
export function labelRegions(width: number, height: number, include: (index: number) => boolean): RegionLabels {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || !include(start)) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const cur = queue[head++] as number;
      const x = cur % width;
      const y = (cur - x) / width;
      if (x > 0 && labels[cur - 1] === -1 && include(cur - 1)) {
        labels[cur - 1] = id;
        queue[tail++] = cur - 1;
      }
      if (x < width - 1 && labels[cur + 1] === -1 && include(cur + 1)) {
        labels[cur + 1] = id;
        queue[tail++] = cur + 1;
      }
      if (y > 0 && labels[cur - width] === -1 && include(cur - width)) {
        labels[cur - width] = id;
        queue[tail++] = cur - width;
      }
      if (y < height - 1 && labels[cur + width] === -1 && include(cur + width)) {
        labels[cur + width] = id;
        queue[tail++] = cur + width;
      }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

/** Label the 4-connected walkable regions of a terrain array (terrain only, no buildings). */
export function labelWalkRegions(terrain: ArrayLike<number>, width: number, height: number): RegionLabels {
  return labelRegions(width, height, (i) => TERRAIN_WALKABLE[terrain[i] as number] === true);
}

const regionCache = new WeakMap<WorldState, { revision: number; regions: RegionLabels }>();

/**
 * Walkable regions of the world (terrain only). Two tiles can be connected by a path only if
 * they share a region, so pathfinding can reject unreachable targets in O(1). Cached until
 * `world.revision` changes.
 */
export function getWalkRegions(world: WorldState): RegionLabels {
  const cached = regionCache.get(world);
  if (cached && cached.revision === world.revision) return cached.regions;
  const regions = labelWalkRegions(world.terrain, world.width, world.height);
  regionCache.set(world, { revision: world.revision, regions });
  return regions;
}

/** True when both in-bounds tiles lie in the same walkable region. */
export function sameWalkRegion(world: WorldState, indexA: number, indexB: number): boolean {
  const { labels } = getWalkRegions(world);
  const a = labels[indexA] as number;
  return a !== -1 && a === labels[indexB];
}
