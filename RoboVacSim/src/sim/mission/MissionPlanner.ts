import type { SimConfig } from '../config';
import type { RobotMap } from '../mapping/RobotMap';
import { planCoverage, planEdgePaths } from '../navigation/CoveragePlanner';
import { densify, pathLength } from '../navigation/Navigator';
import type { Vec2 } from '../world/types';
import type { WorldModel } from '../world/WorldModel';
import type { CleanTask, MissionSettings } from './types';

let taskIds = 1;

/**
 * Region to clean as a cell mask. Rooms are the user's room labels on the app map (annotations),
 * so using their rectangles here is legitimate; the robot still only drives where its own map says
 * it is free.
 */
export function buildRegion(world: WorldModel, settings: MissionSettings, spotSize = 1.6): { mask: Uint8Array; area: number } {
  const g = world.grid;
  const mask = new Uint8Array(g.size);
  const roomIds = new Set(settings.rooms);
  const selected = world.layout.rooms.map((r) => settings.kind !== 'rooms' || roomIds.has(r.id));
  let count = 0;
  if (settings.kind === 'spot') {
    const c = settings.spot ?? { x: world.layout.dock.x, y: world.layout.dock.y };
    const range = g.rectRange({ x: c.x - spotSize / 2, y: c.y - spotSize / 2, w: spotSize, h: spotSize });
    if (range) {
      for (let j = range.j0; j <= range.j1; j++)
        for (let i = range.i0; i <= range.i1; i++) {
          const idx = g.index(i, j);
          if (world.roomIndex[idx] >= 0) {
            mask[idx] = 1;
            count++;
          }
        }
    }
  } else {
    for (let idx = 0; idx < g.size; idx++) {
      const ri = world.roomIndex[idx];
      if (ri >= 0 && selected[ri]) {
        mask[idx] = 1;
        count++;
      }
    }
  }
  return { mask, area: count * g.cellSize * g.cellSize };
}

/** Effective region for this mode: mop-only skips carpets the robot knows about. */
export function effectiveRegion(map: RobotMap, region: Uint8Array, settings: MissionSettings): Uint8Array {
  if (settings.cleanMode !== 'mop') return region;
  const out = new Uint8Array(region.length);
  for (let i = 0; i < region.length; i++) out[i] = region[i] && !map.isKnownSoftFloor(i) ? 1 : 0;
  return out;
}

export function planEdgeTasks(map: RobotMap, region: Uint8Array, pass: number): CleanTask[] {
  const loops = planEdgePaths(map.costmap, region, { minLoopLength: 0.8, simplifyTolerance: 0.03 });
  return loops.map((raw) => {
    const pts = densify(raw, 0.1);
    return { id: taskIds++, kind: 'edge' as const, pass, points: pts, length: pathLength(pts) };
  });
}

export function planLaneTasks(
  map: RobotMap,
  region: Uint8Array,
  pass: number,
  cfg: SimConfig['navigation'],
  startNear: Vec2,
  kind: 'lane' | 'spot' = 'lane',
): CleanTask[] {
  const axis = pass % 2 === 1 ? 'auto' : 'y';
  const lanes = planCoverage(map.costmap, region, { laneSpacing: cfg.laneSpacing, axis, startNear, minLaneLength: 0.12 });
  // For even passes use the perpendicular direction of the first pass (cross-hatching).
  return lanes.map((l) => ({ id: taskIds++, kind, pass, points: [l.a, l.b], length: Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) }));
}

/** Cells of the region that are traversable but have received fewer than `pass` passes. */
export function uncoveredMask(map: RobotMap, region: Uint8Array, passes: Uint8Array, pass: number): { mask: Uint8Array; area: number } {
  const g = map.geom;
  const out = new Uint8Array(region.length);
  let n = 0;
  for (let i = 0; i < region.length; i++) {
    if (region[i] && passes[i] < pass && map.costmap.isTraversable(i)) {
      out[i] = 1;
      n++;
    }
  }
  return { mask: out, area: n * g.cellSize * g.cellSize };
}

/** Remove isolated specks (cells with < 3 masked neighbours) so touch-ups target real gaps. */
export function erodeSpecks(mask: Uint8Array, width: number): number {
  const copy = mask.slice();
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!copy[i]) continue;
    let c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && copy[i + dj * width + di]) c++;
    if (c < 3) mask[i] = 0;
    else n++;
  }
  return n;
}
