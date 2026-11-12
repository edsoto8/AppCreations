import { DOCK, ROBOT } from '../robot/robotSpec';
import { FURNITURE_CATALOG, legOffsets } from './furnitureCatalog';
import type { FurnitureItem, HouseLayout, ObstacleItem, WallDef } from './types';

export type ShapeSource = 'wall' | 'furniture' | 'obstacle' | 'dock';

/**
 * A ground-truth collision/sensing primitive. Oriented box (obb) or circle, with a vertical extent
 * [zMin, zMax] so that sensors at a given height see only what is at that height.
 */
export interface Shape {
  uid: number;
  id: string;
  source: ShapeSource;
  kind: 'obb' | 'circle';
  cx: number;
  cy: number;
  /** OBB half extents along local axes. */
  hx: number;
  hy: number;
  cos: number;
  sin: number;
  /** Circle radius. */
  r: number;
  zMin: number;
  zMax: number;
  /** AABB */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

let uidCounter = 1;

export function makeObb(
  id: string,
  source: ShapeSource,
  cx: number,
  cy: number,
  w: number,
  d: number,
  rotation: number,
  zMin: number,
  zMax: number,
): Shape {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hx = w / 2;
  const hy = d / 2;
  const ex = Math.abs(cos) * hx + Math.abs(sin) * hy;
  const ey = Math.abs(sin) * hx + Math.abs(cos) * hy;
  return {
    uid: uidCounter++,
    id,
    source,
    kind: 'obb',
    cx,
    cy,
    hx,
    hy,
    cos,
    sin,
    r: 0,
    zMin,
    zMax,
    minX: cx - ex,
    minY: cy - ey,
    maxX: cx + ex,
    maxY: cy + ey,
  };
}

export function makeCircle(id: string, source: ShapeSource, cx: number, cy: number, r: number, zMin: number, zMax: number): Shape {
  return {
    uid: uidCounter++,
    id,
    source,
    kind: 'circle',
    cx,
    cy,
    hx: r,
    hy: r,
    cos: 1,
    sin: 0,
    r,
    zMin,
    zMax,
    minX: cx - r,
    minY: cy - r,
    maxX: cx + r,
    maxY: cy + r,
  };
}

export function wallShape(w: WallDef): Shape {
  const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const horizontal = Math.abs(w.b.y - w.a.y) < 1e-9;
  const cx = (w.a.x + w.b.x) / 2;
  const cy = (w.a.y + w.b.y) / 2;
  // Extend by half thickness so corners close.
  const along = len + w.thickness;
  return horizontal
    ? makeObb(w.id, 'wall', cx, cy, along, w.thickness, 0, 0, w.height)
    : makeObb(w.id, 'wall', cx, cy, w.thickness, along, 0, 0, w.height);
}

/** Collision/sensing primitives for one furniture item, following the catalog base style. */
export function furnitureShapes(item: FurnitureItem): Shape[] {
  const spec = FURNITURE_CATALOG[item.kind];
  const out: Shape[] = [];
  const passUnder = spec.clearance > ROBOT.height + 0.005;
  const c = Math.cos(item.rotation);
  const s = Math.sin(item.rotation);
  switch (spec.base) {
    case 'solid':
      out.push(makeObb(item.id, 'furniture', item.x, item.y, item.w, item.d, item.rotation, 0, item.h));
      break;
    case 'legs4':
      if (!passUnder) {
        out.push(makeObb(item.id, 'furniture', item.x, item.y, item.w, item.d, item.rotation, 0, item.h));
      } else {
        for (const o of legOffsets(item)) {
          const lx = item.x + o.x * c - o.y * s;
          const ly = item.y + o.x * s + o.y * c;
          out.push(makeObb(item.id, 'furniture', lx, ly, spec.legSize, spec.legSize, item.rotation, 0, spec.clearance));
        }
        out.push(makeObb(item.id, 'furniture', item.x, item.y, item.w, item.d, item.rotation, spec.clearance, item.h));
      }
      break;
    case 'pedestal':
      out.push(makeCircle(item.id, 'furniture', item.x, item.y, spec.legSize / 2, 0, spec.clearance));
      out.push(makeObb(item.id, 'furniture', item.x, item.y, item.w, item.d, item.rotation, spec.clearance, item.h));
      break;
    case 'ring':
      out.push(makeCircle(item.id, 'furniture', item.x, item.y, (Math.min(item.w, item.d) * spec.legSize) / 2, 0, item.h));
      break;
  }
  return out;
}

export function obstacleShapes(o: ObstacleItem): Shape[] {
  if (o.kind === 'cylinder' || o.kind === 'petBowl') {
    return [makeCircle(o.id, 'obstacle', o.x, o.y, Math.min(o.w, o.d) / 2, 0, o.h)];
  }
  return [makeObb(o.id, 'obstacle', o.x, o.y, o.w, o.d, o.rotation, 0, o.h)];
}

export function dockShapes(layout: HouseLayout): Shape[] {
  const { x, y, theta } = layout.dock;
  const mid = (DOCK.towerFrontX + DOCK.towerBackX) / 2;
  const cx = x + Math.cos(theta) * mid;
  const cy = y + Math.sin(theta) * mid;
  return [makeObb('dock', 'dock', cx, cy, DOCK.towerBackX - DOCK.towerFrontX, DOCK.width, theta, 0, DOCK.towerHeight)];
}

export function buildShapes(layout: HouseLayout): Shape[] {
  const shapes: Shape[] = [];
  for (const w of layout.walls) shapes.push(wallShape(w));
  for (const f of layout.furniture) shapes.push(...furnitureShapes(f));
  for (const o of layout.obstacles) shapes.push(...obstacleShapes(o));
  shapes.push(...dockShapes(layout));
  return shapes;
}

/** Does the shape block a robot of height ROBOT.height at floor level? */
export function blocksRobot(s: Shape): boolean {
  return s.zMin < ROBOT.height && s.zMax > 0.02;
}

/** Ray vs shape. Returns distance along the (unit) direction or Infinity. */
export function rayShape(s: Shape, ox: number, oy: number, dx: number, dy: number): number {
  if (s.kind === 'circle') {
    const fx = ox - s.cx;
    const fy = oy - s.cy;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - s.r * s.r;
    if (c > 0 && b > 0) return Infinity;
    const disc = b * b - c;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : 0;
  }
  // OBB slab test in local frame.
  const rx = ox - s.cx;
  const ry = oy - s.cy;
  const lox = rx * s.cos + ry * s.sin;
  const loy = -rx * s.sin + ry * s.cos;
  const ldx = dx * s.cos + dy * s.sin;
  const ldy = -dx * s.sin + dy * s.cos;
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(ldx) < 1e-12) {
    if (lox < -s.hx || lox > s.hx) return Infinity;
  } else {
    let t1 = (-s.hx - lox) / ldx;
    let t2 = (s.hx - lox) / ldx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(ldy) < 1e-12) {
    if (loy < -s.hy || loy > s.hy) return Infinity;
  } else {
    let t1 = (-s.hy - loy) / ldy;
    let t2 = (s.hy - loy) / ldy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < Math.max(tmin, 0)) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

export interface Contact {
  /** Penetration depth (m), > 0 when overlapping. */
  depth: number;
  /** Unit normal pointing from the shape toward the circle center. */
  nx: number;
  ny: number;
  shape: Shape | null;
}

/** Circle (robot) vs shape penetration test. Writes into `out` and returns true when overlapping. */
export function circleShape(s: Shape, x: number, y: number, r: number, out: Contact): boolean {
  if (s.kind === 'circle') {
    const dx = x - s.cx;
    const dy = y - s.cy;
    const d = Math.hypot(dx, dy);
    const pen = r + s.r - d;
    if (pen <= 0) return false;
    out.depth = pen;
    out.nx = d > 1e-9 ? dx / d : 1;
    out.ny = d > 1e-9 ? dy / d : 0;
    out.shape = s;
    return true;
  }
  const rx = x - s.cx;
  const ry = y - s.cy;
  const lx = rx * s.cos + ry * s.sin;
  const ly = -rx * s.sin + ry * s.cos;
  const qx = Math.max(-s.hx, Math.min(s.hx, lx));
  const qy = Math.max(-s.hy, Math.min(s.hy, ly));
  let ddx = lx - qx;
  let ddy = ly - qy;
  let d = Math.hypot(ddx, ddy);
  let pen: number;
  if (d > 1e-9) {
    pen = r - d;
    if (pen <= 0) return false;
    ddx /= d;
    ddy /= d;
  } else {
    // Center inside the box: push out along the axis of least penetration.
    const px = s.hx - Math.abs(lx);
    const py = s.hy - Math.abs(ly);
    if (px < py) {
      ddx = Math.sign(lx) || 1;
      ddy = 0;
      d = px;
    } else {
      ddx = 0;
      ddy = Math.sign(ly) || 1;
      d = py;
    }
    pen = r + d;
  }
  out.depth = pen;
  out.nx = ddx * s.cos - ddy * s.sin;
  out.ny = ddx * s.sin + ddy * s.cos;
  out.shape = s;
  return true;
}
