import { describe, expect, it } from 'vitest';
import { CHALLENGE_GAPS, PRESETS, cloneLayout, getPreset } from '../../src/sim/world/presets';
import { FURNITURE_CATALOG, legOffsets } from '../../src/sim/world/furnitureCatalog';
import { DOCK, ROBOT } from '../../src/sim/robot/robotSpec';
import type { FurnitureItem, HouseLayout, ObstacleItem, Rect, WallDef } from '../../src/sim/world/types';

// ---------------------------------------------------------------------------------------------
// Small self-contained geometry helpers
// ---------------------------------------------------------------------------------------------

const EPS = 1e-9;
const CELL = 0.05;
const INFLATE = 0.18;

interface Obb {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  rot: number;
}

/** Wall as a solid rect: the segment is extended by thickness/2 at both ends (same as the sim). */
function wallRect(w: WallDef): Rect {
  const t = w.thickness / 2;
  const x0 = Math.min(w.a.x, w.b.x) - t;
  const x1 = Math.max(w.a.x, w.b.x) + t;
  const y0 = Math.min(w.a.y, w.b.y) - t;
  const y1 = Math.max(w.a.y, w.b.y) + t;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function itemObb(it: Pick<FurnitureItem | ObstacleItem, 'x' | 'y' | 'w' | 'd' | 'rotation'>, shrink = 0): Obb {
  return { cx: it.x, cy: it.y, hx: it.w / 2 - shrink, hy: it.d / 2 - shrink, rot: it.rotation };
}

function rectObb(r: Rect, shrink = 0): Obb {
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, hx: r.w / 2 - shrink, hy: r.h / 2 - shrink, rot: 0 };
}

function obbCorners(o: Obb): Array<{ x: number; y: number }> {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => ({ x: o.cx + sx * o.hx * c - sy * o.hy * s, y: o.cy + sx * o.hx * s + sy * o.hy * c }));
}

/** Strict (open-set) overlap test between two OBBs via the separating axis theorem. */
function obbOverlap(a: Obb, b: Obb): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2].map((t) => ({ x: Math.cos(t), y: Math.sin(t) }));
  for (const ax of axes) {
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const p of ca) {
      const d = p.x * ax.x + p.y * ax.y;
      amin = Math.min(amin, d);
      amax = Math.max(amax, d);
    }
    for (const p of cb) {
      const d = p.x * ax.x + p.y * ax.y;
      bmin = Math.min(bmin, d);
      bmax = Math.max(bmax, d);
    }
    if (amax <= bmin + 1e-7 || bmax <= amin + 1e-7) return false;
  }
  return true;
}

function pointInObb(o: Obb, x: number, y: number): boolean {
  const dx = x - o.cx;
  const dy = y - o.cy;
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) < o.hx && Math.abs(ly) < o.hy;
}

const pointInRect = (r: Rect, x: number, y: number, tol = 0) =>
  x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol;

// ---------------------------------------------------------------------------------------------
// Occupancy raster
// ---------------------------------------------------------------------------------------------

type Disc = { cx: number; cy: number; r: number };

/** Blocking footprint at robot height, per the catalog base style. */
function furnitureBlockers(f: FurnitureItem): { obbs: Obb[]; discs: Disc[] } {
  const spec = FURNITURE_CATALOG[f.kind];
  switch (spec.base) {
    case 'solid':
      return { obbs: [itemObb(f)], discs: [] };
    case 'legs4': {
      if (spec.clearance <= ROBOT.height) return { obbs: [itemObb(f)], discs: [] };
      const c = Math.cos(f.rotation);
      const s = Math.sin(f.rotation);
      return {
        obbs: legOffsets(f).map((o) => ({
          cx: f.x + o.x * c - o.y * s,
          cy: f.y + o.x * s + o.y * c,
          hx: spec.legSize / 2,
          hy: spec.legSize / 2,
          rot: f.rotation,
        })),
        discs: [],
      };
    }
    case 'pedestal':
      return { obbs: [], discs: [{ cx: f.x, cy: f.y, r: spec.legSize / 2 }] };
    case 'ring':
      return { obbs: [], discs: [{ cx: f.x, cy: f.y, r: (Math.min(f.w, f.d) * spec.legSize) / 2 }] };
  }
}

class Raster {
  readonly ox: number;
  readonly oy: number;
  readonly nx: number;
  readonly ny: number;
  readonly raw: Uint8Array;
  inflated!: Uint8Array;
  reached!: Uint8Array;

  constructor(bounds: Rect) {
    this.ox = bounds.x - 0.3;
    this.oy = bounds.y - 0.3;
    this.nx = Math.ceil((bounds.w + 0.6) / CELL);
    this.ny = Math.ceil((bounds.h + 0.6) / CELL);
    this.raw = new Uint8Array(this.nx * this.ny);
  }

  cx(i: number) {
    return this.ox + (i + 0.5) * CELL;
  }

  cy(j: number) {
    return this.oy + (j + 0.5) * CELL;
  }

  cellAt(x: number, y: number) {
    const i = Math.floor((x - this.ox) / CELL);
    const j = Math.floor((y - this.oy) / CELL);
    return j * this.nx + i;
  }

  private range(minX: number, minY: number, maxX: number, maxY: number) {
    return {
      i0: Math.max(0, Math.floor((minX - this.ox) / CELL) - 1),
      j0: Math.max(0, Math.floor((minY - this.oy) / CELL) - 1),
      i1: Math.min(this.nx - 1, Math.floor((maxX - this.ox) / CELL) + 1),
      j1: Math.min(this.ny - 1, Math.floor((maxY - this.oy) / CELL) + 1),
    };
  }

  /** Conservative: a cell is blocked if its square overlaps the (open) shape. */
  markObb(o: Obb) {
    const cs = obbCorners(o);
    const xs = cs.map((p) => p.x);
    const ys = cs.map((p) => p.y);
    const r = this.range(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const cell: Obb = { cx: this.cx(i), cy: this.cy(j), hx: CELL / 2, hy: CELL / 2, rot: 0 };
        if (obbOverlap(o, cell)) this.raw[j * this.nx + i] = 1;
      }
    }
  }

  markDisc(d: Disc) {
    const r = this.range(d.cx - d.r, d.cy - d.r, d.cx + d.r, d.cy + d.r);
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const x0 = this.ox + i * CELL;
        const y0 = this.oy + j * CELL;
        const dx = Math.max(x0 - d.cx, 0, d.cx - (x0 + CELL));
        const dy = Math.max(y0 - d.cy, 0, d.cy - (y0 + CELL));
        if (Math.hypot(dx, dy) < d.r - EPS) this.raw[j * this.nx + i] = 1;
      }
    }
  }

  /**
   * Inflate by INFLATE meters: a cell becomes blocked if any point of its square lies within
   * INFLATE of any blocked cell square (square-to-square distance).
   */
  inflate() {
    const k = Math.ceil(INFLATE / CELL) + 1;
    const offsets: number[][] = [];
    for (let dj = -k; dj <= k; dj++) {
      for (let di = -k; di <= k; di++) {
        const gx = Math.max(0, Math.abs(di) - 1) * CELL;
        const gy = Math.max(0, Math.abs(dj) - 1) * CELL;
        if (Math.hypot(gx, gy) <= INFLATE + EPS) offsets.push([di, dj]);
      }
    }
    this.inflated = new Uint8Array(this.raw.length);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        if (!this.raw[j * this.nx + i]) continue;
        for (const [di, dj] of offsets) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < this.nx && jj < this.ny) this.inflated[jj * this.nx + ii] = 1;
        }
      }
    }
  }

  /** 4-connected flood fill over inflated-free cells. */
  flood(x: number, y: number): boolean {
    this.reached = new Uint8Array(this.raw.length);
    const start = this.cellAt(x, y);
    if (this.inflated[start]) return false;
    const stack = [start];
    this.reached[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      const i = idx % this.nx;
      const j = (idx - i) / this.nx;
      const nbrs = [
        [i + 1, j],
        [i - 1, j],
        [i, j + 1],
        [i, j - 1],
      ];
      for (const [ii, jj] of nbrs) {
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue;
        const n = jj * this.nx + ii;
        if (this.inflated[n] || this.reached[n]) continue;
        this.reached[n] = 1;
        stack.push(n);
      }
    }
    return true;
  }
}

function rasterize(layout: HouseLayout): Raster {
  const r = new Raster(layout.bounds);
  // Everything outside every room is "not floor".
  for (let j = 0; j < r.ny; j++) {
    for (let i = 0; i < r.nx; i++) {
      const x = r.cx(i);
      const y = r.cy(j);
      if (!layout.rooms.some((room) => room.rects.some((rc) => pointInRect(rc, x, y)))) r.raw[j * r.nx + i] = 1;
    }
  }
  for (const w of layout.walls) r.markObb(rectObb(wallRect(w)));
  for (const f of layout.furniture) {
    const b = furnitureBlockers(f);
    b.obbs.forEach((o) => r.markObb(o));
    b.discs.forEach((d) => r.markDisc(d));
  }
  for (const o of layout.obstacles) r.markObb(itemObb(o));
  for (const c of layout.cliffs) r.markObb(rectObb(c.rect));
  for (const z of layout.zones) if (z.kind === 'noGo') r.markObb(rectObb(z.rect));
  r.inflate();
  return r;
}

function cellsIn(r: Raster, rect: Rect): number[] {
  const out: number[] = [];
  for (let j = 0; j < r.ny; j++) {
    for (let i = 0; i < r.nx; i++) {
      const x = r.cx(i);
      const y = r.cy(j);
      if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) out.push(j * r.nx + i);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('house presets', () => {
  it('exposes the three presets', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['apartment', 'family', 'challenge']);
    for (const p of PRESETS) expect(getPreset(p.id).id).toBe(p.id);
    expect(() => getPreset('nope')).toThrow();
  });

  it('getPreset returns independent deep copies', () => {
    const a = getPreset('family');
    const b = getPreset('family');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.furniture[0].x += 1;
    a.walls[0].a.x = 99;
    a.rooms[0].rects[0].w = 0;
    a.dock.theta = 3;
    const c = getPreset('family');
    expect(c).toEqual(b);
    const d = cloneLayout(c);
    expect(d).toEqual(c);
    d.rugs[0].rect.x = -5;
    expect(c.rugs[0].rect.x).not.toBe(-5);
  });

  for (const preset of PRESETS) {
    describe(preset.id, () => {
      const layout = getPreset(preset.id);
      const b = layout.bounds;

      it('has unique ids across all entity arrays', () => {
        const ids = [
          ...layout.rooms,
          ...layout.walls,
          ...layout.doors,
          ...layout.furniture,
          ...layout.obstacles,
          ...layout.zones,
          ...layout.rugs,
          ...layout.cliffs,
        ].map((e) => e.id);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(dupes).toEqual([]);
        expect(b.w).toBeLessThanOrEqual(16.2);
        expect(b.h).toBeLessThanOrEqual(12.2);
      });

      it('has axis-aligned walls with positive length and sensible doors', () => {
        expect(layout.walls.length).toBeGreaterThan(4);
        for (const w of layout.walls) {
          const horiz = Math.abs(w.a.y - w.b.y) < EPS;
          const vert = Math.abs(w.a.x - w.b.x) < EPS;
          expect(horiz !== vert, `wall ${w.id} axis-aligned`).toBe(true);
          expect(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)).toBeGreaterThan(0);
          expect([0.12, 0.2]).toContain(w.thickness);
          expect(w.height).toBe(2.5);
          const r = wallRect(w);
          expect(r.x >= b.x - 1e-6 && r.y >= b.y - 1e-6 && r.x + r.w <= b.x + b.w + 1e-6 && r.y + r.h <= b.y + b.h + 1e-6, `wall ${w.id} in bounds`).toBe(true);
        }
        for (const d of layout.doors) {
          expect(d.width).toBeGreaterThanOrEqual(0.8);
          expect(d.width).toBeLessThanOrEqual(1.0);
          expect(d.threshold).toBeGreaterThanOrEqual(0.01);
          expect(d.threshold).toBeLessThanOrEqual(0.015);
          // The opening must really be clear of walls.
          const half = d.width / 2 - 0.01;
          const opening: Obb =
            d.axis === 'x'
              ? { cx: d.center.x, cy: d.center.y, hx: half, hy: d.wallThickness / 2, rot: 0 }
              : { cx: d.center.x, cy: d.center.y, hx: d.wallThickness / 2, hy: half, rot: 0 };
          for (const w of layout.walls) expect(obbOverlap(opening, rectObb(wallRect(w))), `door ${d.id} vs ${w.id}`).toBe(false);
        }
      });

      it('has rooms that tile the interior without overlaps', () => {
        expect(layout.rooms.length).toBeGreaterThanOrEqual(5);
        const rects = layout.rooms.flatMap((r) => r.rects.map((rc) => ({ room: r.id, rc })));
        for (const room of layout.rooms) {
          expect(room.rects.length).toBeGreaterThanOrEqual(1);
          for (const rc of room.rects) {
            expect(rc.w > 0 && rc.h > 0).toBe(true);
            expect(rc.x >= b.x && rc.y >= b.y && rc.x + rc.w <= b.x + b.w && rc.y + rc.h <= b.y + b.h, `room ${room.id} in bounds`).toBe(true);
          }
        }
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            expect(obbOverlap(rectObb(rects[i].rc, 0.001), rectObb(rects[j].rc, 0.001)), `${rects[i].room} vs ${rects[j].room}`).toBe(false);
          }
        }
        // Wall-centerline convention: room area == centerline rectangle area (bounds minus the
        // outer half of the exterior walls).
        const total = rects.reduce((s, r) => s + r.rc.w * r.rc.h, 0);
        expect(total).toBeCloseTo((b.w - 0.2) * (b.h - 0.2), 6);
      });

      it('keeps furniture and obstacles inside the house and out of walls', () => {
        const items: Array<FurnitureItem | ObstacleItem> = [...layout.furniture, ...layout.obstacles];
        expect(layout.furniture.length).toBeGreaterThan(15);
        for (const it of items) {
          const corners = obbCorners(itemObb(it));
          for (const c of corners) {
            expect(pointInRect(b, c.x, c.y), `${it.id} inside bounds`).toBe(true);
            expect(
              layout.rooms.some((r) => r.rects.some((rc) => pointInRect(rc, c.x, c.y, 1e-6))),
              `${it.id} corner inside a room`,
            ).toBe(true);
          }
          const shrunk = itemObb(it, 0.01);
          for (const w of layout.walls) {
            expect(obbOverlap(shrunk, rectObb(wallRect(w))), `${it.id} intersects wall ${w.id}`).toBe(false);
          }
          for (const c of layout.cliffs) expect(obbOverlap(shrunk, rectObb(c.rect)), `${it.id} over cliff ${c.id}`).toBe(false);
        }
        for (const rug of layout.rugs) {
          for (const c of obbCorners(rectObb(rug.rect))) {
            expect(layout.rooms.some((r) => r.rects.some((rc) => pointInRect(rc, c.x, c.y, 1e-6))), `${rug.id} in a room`).toBe(true);
          }
        }
      });

      it('places the dock against a wall with a clear approach corridor', () => {
        const { x, y, theta } = layout.dock;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const blockers: Array<{ id: string; o: Obb }> = [
          ...layout.walls.map((w) => ({ id: w.id, o: rectObb(wallRect(w)) })),
          ...layout.furniture.map((f) => ({ id: f.id, o: itemObb(f) })),
          ...layout.obstacles.map((o) => ({ id: o.id, o: itemObb(o) })),
          ...layout.cliffs.map((cl) => ({ id: cl.id, o: rectObb(cl.rect) })),
          ...layout.zones.filter((z) => z.kind === 'noGo').map((z) => ({ id: z.id, o: rectObb(z.rect) })),
        ];
        for (const bl of blockers) expect(pointInObb(bl.o, x, y), `dock pose inside ${bl.id}`).toBe(false);
        // Approach corridor: 1.0 m behind the pose, 0.4 m wide.
        const corridor: Obb = { cx: x - 0.5 * c, cy: y - 0.5 * s, hx: 0.5, hy: 0.2, rot: theta };
        for (const bl of blockers) expect(obbOverlap(corridor, bl.o), `approach corridor blocked by ${bl.id}`).toBe(false);
        // Robot footprint at the docked pose is clear.
        const body: Obb = { cx: x, cy: y, hx: ROBOT.radius, hy: ROBOT.radius, rot: theta };
        for (const bl of blockers) expect(obbOverlap(body, bl.o), `docked robot overlaps ${bl.id}`).toBe(false);
        // Tower is clear of everything, and its back is 1-2 cm from a wall face.
        const mid = (DOCK.towerFrontX + DOCK.towerBackX) / 2;
        const tower: Obb = { cx: x + mid * c, cy: y + mid * s, hx: (DOCK.towerBackX - DOCK.towerFrontX) / 2 - 0.002, hy: DOCK.width / 2, rot: theta };
        for (const bl of blockers) expect(obbOverlap(tower, bl.o), `dock tower overlaps ${bl.id}`).toBe(false);
        const wallRects = layout.walls.map(wallRect);
        const probe = (dist: number) => wallRects.some((r) => pointInRect(r, x + dist * c, y + dist * s));
        expect(probe(DOCK.towerBackX + 0.005), 'tower back too far from wall face (< 0.5 cm)').toBe(false);
        expect(probe(DOCK.towerBackX + 0.025), 'tower back not within 2.5 cm of a wall face').toBe(true);
      });

      const raster = rasterize(layout);
      const started = raster.flood(layout.dock.x, layout.dock.y);

      it('starts the reachability flood fill at the dock', () => {
        expect(started).toBe(true);
      });

      for (const room of layout.rooms) {
        it(`room '${room.id}' has a substantial reachable area`, () => {
          let free = 0;
          let reach = 0;
          for (const rc of room.rects) {
            for (const idx of cellsIn(raster, rc)) {
              if (!raster.raw[idx]) free++;
              if (raster.reached[idx]) reach++;
            }
          }
          const freeArea = free * CELL * CELL;
          const reachArea = reach * CELL * CELL;
          expect(reachArea, `${room.id}: reachable ${reachArea.toFixed(2)} m² of ${freeArea.toFixed(2)} m²`).toBeGreaterThanOrEqual(1);
          expect(reachArea / freeArea, `${room.id}: reachable ${reachArea.toFixed(2)} m² of ${freeArea.toFixed(2)} m²`).toBeGreaterThanOrEqual(0.4);
        });
      }

      if (preset.id === 'challenge') {
        it('has a passable 0.5 m gap and an impassable 0.38 m gap', () => {
          const pass = CHALLENGE_GAPS.passable;
          const block = CHALLENGE_GAPS.impassable;
          const passCells = cellsIn(raster, pass.rect);
          const blockCells = cellsIn(raster, block.rect);
          expect(passCells.length).toBeGreaterThan(0);
          expect(blockCells.length).toBeGreaterThan(0);
          // Cells lying entirely inside each gap are raw-free (the gap really exists)...
          const inner = (r: Rect): Rect => ({ x: r.x + CELL / 2, y: r.y + CELL / 2, w: r.w - CELL, h: r.h - CELL });
          expect(cellsIn(raster, inner(pass.rect)).every((i) => !raster.raw[i])).toBe(true);
          expect(cellsIn(raster, inner(block.rect)).every((i) => !raster.raw[i])).toBe(true);
          // ...the 0.5 m gap keeps a reachable channel after inflation, the 0.38 m one closes.
          expect(passCells.some((i) => raster.reached[i])).toBe(true);
          expect(blockCells.every((i) => raster.inflated[i])).toBe(true);
          expect(raster.reached[raster.cellAt(pass.behind.x, pass.behind.y)]).toBe(1);
          expect(raster.reached[raster.cellAt(block.behind.x, block.behind.y)]).toBe(0);
          // The measured gap widths match the declared ones.
          const shelfToy = layout.furniture.find((f) => f.id === 'play-toy-shelf')!;
          expect(11.9 - (shelfToy.x + shelfToy.w / 2)).toBeCloseTo(block.width, 6);
          const shelfNook = layout.furniture.find((f) => f.id === 'play-nook-shelf')!;
          expect(4.94 - (shelfNook.y + shelfNook.w / 2)).toBeCloseTo(pass.width, 6);
        });

        it('has the challenge features', () => {
          expect(layout.zones.some((z) => z.kind === 'noGo')).toBe(true);
          expect(layout.zones.some((z) => z.kind === 'noMop')).toBe(true);
          expect(layout.cliffs.length).toBeGreaterThan(0);
          const kinds = new Set(layout.obstacles.map((o) => o.kind));
          for (const k of ['box', 'toy', 'cable', 'sock', 'shoe', 'petBowl'] as const) expect(kinds.has(k), k).toBe(true);
          const legs = layout.furniture.filter((f) => f.kind === 'chair' || f.kind === 'barStool');
          expect(legs.length).toBeGreaterThanOrEqual(12);
        });
      }

      if (preset.id === 'family') {
        it('has the family-home features', () => {
          expect(layout.rooms.filter((r) => r.kind === 'bedroom').length).toBe(2);
          for (const k of ['living', 'kitchen', 'dining', 'bathroom', 'hallway'] as const) {
            expect(layout.rooms.some((r) => r.kind === k), k).toBe(true);
          }
          expect(new Set(layout.rooms.map((r) => r.floor))).toEqual(new Set(['hardwood', 'tile', 'carpet']));
          expect(layout.cliffs).toHaveLength(1);
          expect(layout.rugs.filter((r) => r.floor === 'rug').length).toBeGreaterThanOrEqual(2);
        });
      }
    });
  }
});
