import { FURNITURE_CATALOG, OBSTACLE_CATALOG } from '../furnitureCatalog';
import type { DoorDef, FurnitureItem, FurnitureKind, ObstacleItem, ObstacleKind, Vec2, WallDef } from '../types';

/**
 * Layout-authoring helpers shared by the presets.
 *
 * CONVENTIONS used by every preset:
 * - Room rects are bounded by WALL CENTERLINES (exterior and interior), so rooms tile the whole
 *   interior with no gaps under walls or doorways (the sim treats floor outside every room as a drop).
 * - Wall segments are stored the way the sim and renderer consume them: a segment from a to b is
 *   extended by thickness/2 at BOTH ends when turned into a solid box (this closes corners). Corner
 *   and T-junction endpoints are therefore placed on wall centerline intersections, and endpoints
 *   next to a door/passage opening are pulled back by thickness/2 so that the extended wall ends
 *   exactly at the opening edge (the clear opening width equals `Opening.width`).
 * - Furniture "front" faces the item's local +y axis (rotation 0 = facing +y). Beds are the
 *   exception: they are long along local x with the headboard at local -x (rotation 0 = foot at +x).
 */

export const EXTERIOR_THICKNESS = 0.2;
export const INTERIOR_THICKNESS = 0.12;
export const WALL_HEIGHT = 2.5;
export const DEFAULT_THRESHOLD = 0.012;

/** Rotation that makes a standard item's front face the given sim direction. */
export const FACING = {
  /** Front toward +y. */
  posY: 0,
  /** Front toward -y. */
  negY: Math.PI,
  /** Front toward +x. */
  posX: -Math.PI / 2,
  /** Front toward -x. */
  negX: Math.PI / 2,
} as const;

/** Bed rotation (bed foot direction). */
export const BED_FOOT = {
  posX: 0,
  negX: Math.PI,
  posY: Math.PI / 2,
  negY: -Math.PI / 2,
} as const;

export interface Opening {
  /** Distance from wall point `a` (along a->b) to the opening center, meters. */
  at: number;
  /** Clear opening width, meters. */
  width: number;
  /** false = open passage (no DoorDef, no threshold/frame). Default true. */
  door?: boolean;
  threshold?: number;
  id?: string;
}

export const p = (x: number, y: number): Vec2 => ({ x, y });

/**
 * Split a straight, axis-aligned wall from a to b around openings.
 * Returns the wall segments (see the endpoint convention above) and a DoorDef per door opening.
 */
export function wallWithOpenings(
  id: string,
  a: Vec2,
  b: Vec2,
  openings: Opening[],
  thickness: number,
  height: number,
  exterior: boolean,
): { walls: WallDef[]; doors: DoorDef[] } {
  const horizontal = Math.abs(a.y - b.y) < 1e-9;
  const vertical = Math.abs(a.x - b.x) < 1e-9;
  if (horizontal === vertical) throw new Error(`wall ${id} must be axis-aligned with positive length`);
  const len = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
  const dir = horizontal ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y);
  const at = (s: number): Vec2 => (horizontal ? { x: a.x + dir * s, y: a.y } : { x: a.x, y: a.y + dir * s });

  const sorted = [...openings].sort((o1, o2) => o1.at - o2.at);
  const half = thickness / 2;
  const walls: WallDef[] = [];
  const doors: DoorDef[] = [];
  // Intervals [s0, s1] along the wall, with flags telling whether each end touches an opening.
  let cursor = 0;
  let cursorAtOpening = false;
  const pushSeg = (s0: number, s1: number, startOpen: boolean, endOpen: boolean) => {
    const d0 = s0 + (startOpen ? half : 0);
    const d1 = s1 - (endOpen ? half : 0);
    if (s1 - s0 < 1e-6) return;
    if (d1 - d0 < 0.001) throw new Error(`wall ${id}: segment [${s0}, ${s1}] too short next to an opening`);
    walls.push({ id: `${id}-${walls.length + 1}`, a: at(d0), b: at(d1), thickness, height, exterior });
  };
  sorted.forEach((o, i) => {
    const s0 = o.at - o.width / 2;
    const s1 = o.at + o.width / 2;
    if (s0 < cursor - 1e-9 || s1 > len + 1e-9) throw new Error(`wall ${id}: opening ${i} out of range or overlapping`);
    pushSeg(cursor, s0, cursorAtOpening, true);
    cursor = s1;
    cursorAtOpening = true;
    if (o.door !== false) {
      doors.push({
        id: o.id ?? `${id}-door${i + 1}`,
        center: at(o.at),
        width: o.width,
        axis: horizontal ? 'x' : 'y',
        threshold: o.threshold ?? DEFAULT_THRESHOLD,
        wallThickness: thickness,
      });
    }
  });
  pushSeg(cursor, len, cursorAtOpening, false);
  return { walls, doors };
}

/** Accumulates walls + doors for a layout. */
export class WallSet {
  readonly walls: WallDef[] = [];
  readonly doors: DoorDef[] = [];

  /** Exterior wall (0.2 m). */
  ext(id: string, a: Vec2, b: Vec2, openings: Opening[] = []): this {
    return this.add(wallWithOpenings(id, a, b, openings, EXTERIOR_THICKNESS, WALL_HEIGHT, true));
  }

  /** Interior wall (0.12 m). */
  int(id: string, a: Vec2, b: Vec2, openings: Opening[] = []): this {
    return this.add(wallWithOpenings(id, a, b, openings, INTERIOR_THICKNESS, WALL_HEIGHT, false));
  }

  /** Four exterior walls along the centerline rectangle [x0, x1] x [y0, y1]. */
  perimeter(x0: number, y0: number, x1: number, y1: number): this {
    this.ext('ext-south', p(x0, y0), p(x1, y0));
    this.ext('ext-north', p(x0, y1), p(x1, y1));
    this.ext('ext-west', p(x0, y0), p(x0, y1));
    this.ext('ext-east', p(x1, y0), p(x1, y1));
    return this;
  }

  private add(r: { walls: WallDef[]; doors: DoorDef[] }): this {
    this.walls.push(...r.walls);
    this.doors.push(...r.doors);
    return this;
  }
}

type SizeOverrides = Partial<Pick<FurnitureItem, 'w' | 'd' | 'h' | 'color'>>;

/** Furniture item with catalog default sizes unless overridden. */
export function furn(id: string, kind: FurnitureKind, x: number, y: number, rotation: number, o: SizeOverrides = {}): FurnitureItem {
  const def = FURNITURE_CATALOG[kind].defaults;
  const item: FurnitureItem = { id, kind, x, y, rotation, w: o.w ?? def.w, d: o.d ?? def.d, h: o.h ?? def.h };
  if (o.color) item.color = o.color;
  return item;
}

/** User obstacle with catalog default sizes unless overridden. */
export function obst(
  id: string,
  kind: ObstacleKind,
  x: number,
  y: number,
  rotation = 0,
  o: Partial<Pick<ObstacleItem, 'w' | 'd' | 'h'>> = {},
): ObstacleItem {
  const def = OBSTACLE_CATALOG[kind].defaults;
  return { id, kind, x, y, rotation, w: o.w ?? def.w, d: o.d ?? def.d, h: o.h ?? def.h };
}

/**
 * Four chairs (or fewer) tucked around a rectangular table whose long axis is along x
 * (`rotated` = long axis along y). Chairs overlap the table edge by `tuck` meters.
 */
export function chairsAround(
  prefix: string,
  table: { x: number; y: number; w: number; d: number; rotated?: boolean },
  opts: { perSide: number; ends: boolean; tuck?: number; color?: string },
): FurnitureItem[] {
  const tuck = opts.tuck ?? 0.1;
  const chairD = FURNITURE_CATALOG.chair.defaults.d;
  const lx = table.rotated ? table.d : table.w; // extent along x
  const ly = table.rotated ? table.w : table.d; // extent along y
  const longAlongX = !table.rotated;
  const out: FurnitureItem[] = [];
  const c = opts.color ? { color: opts.color } : {};
  const add = (x: number, y: number, rot: number) => out.push(furn(`${prefix}-${out.length + 1}`, 'chair', x, y, rot, c));
  const off = chairD / 2 - tuck;
  if (longAlongX) {
    for (let i = 0; i < opts.perSide; i++) {
      const x = table.x - lx / 2 + (lx * (i + 0.5)) / opts.perSide;
      add(x, table.y - ly / 2 - off, FACING.posY);
      add(x, table.y + ly / 2 + off, FACING.negY);
    }
    if (opts.ends) {
      add(table.x - lx / 2 - off, table.y, FACING.posX);
      add(table.x + lx / 2 + off, table.y, FACING.negX);
    }
  } else {
    for (let i = 0; i < opts.perSide; i++) {
      const y = table.y - ly / 2 + (ly * (i + 0.5)) / opts.perSide;
      add(table.x - lx / 2 - off, y, FACING.posX);
      add(table.x + lx / 2 + off, y, FACING.negX);
    }
    if (opts.ends) {
      add(table.x, table.y - ly / 2 - off, FACING.posY);
      add(table.x, table.y + ly / 2 + off, FACING.negY);
    }
  }
  return out;
}
