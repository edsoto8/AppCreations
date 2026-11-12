import { describe, expect, it } from 'vitest';
import { GridGeometry } from '../../src/sim/mapping/GridGeometry';
import { OccupancyGrid } from '../../src/sim/mapping/OccupancyGrid';
import { COST_INSCRIBED, Costmap } from '../../src/sim/mapping/Costmap';
import { planCoverage, planEdgePaths, polylineLength } from '../../src/sim/navigation/CoveragePlanner';
import type { Lane } from '../../src/sim/navigation/CoveragePlanner';
import type { Rect, Vec2 } from '../../src/sim/world/types';
import { CELL_FREE, CELL_OCCUPIED } from '../../src/sim/world/types';

const PARAMS = { robotRadius: 0.175, inflationRadius: 0.45, safetyMargin: 0.02 };
const SPACING = 0.25;

/** Rectangular room with 0.1 m walls inside a grid; returns occ + room interior rect. */
function room(geom: GridGeometry, r: Rect, obstacles: Rect[] = []): OccupancyGrid {
  const occ = new OccupancyGrid(geom);
  occ.setRect(r, CELL_FREE);
  occ.setRect({ x: r.x, y: r.y, w: r.w, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: r.x, y: r.y + r.h - 0.1, w: r.w, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: r.x, y: r.y, w: 0.1, h: r.h }, CELL_OCCUPIED);
  occ.setRect({ x: r.x + r.w - 0.1, y: r.y, w: 0.1, h: r.h }, CELL_OCCUPIED);
  for (const o of obstacles) occ.setRect(o, CELL_OCCUPIED);
  return occ;
}

function maskOf(geom: GridGeometry, rects: Rect[]): Uint8Array {
  const m = new Uint8Array(geom.size);
  for (const r of rects) {
    const rr = geom.rectRange(r);
    if (!rr) continue;
    for (let j = rr.j0; j <= rr.j1; j++) for (let i = rr.i0; i <= rr.i1; i++) m[geom.index(i, j)] = 1;
  }
  return m;
}

function costmapFor(occ: OccupancyGrid): Costmap {
  const cm = new Costmap(occ.geom, PARAMS);
  cm.update(occ, { noGo: [] });
  return cm;
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Fraction of valid (mask & traversable) cells within `reach` of some lane. */
function coverageFraction(cm: Costmap, mask: Uint8Array, lanes: Lane[], reach: number): number {
  const g = cm.geom;
  let total = 0;
  let covered = 0;
  for (let k = 0; k < g.size; k++) {
    if (mask[k] !== 1 || !cm.isTraversable(k)) continue;
    total++;
    const p = g.centerOf(k);
    if (lanes.some((l) => distToSeg(p, l.a, l.b) <= reach)) covered++;
  }
  return covered / total;
}

/** Max cost sampled every 1 cm along a segment. */
function maxCostAlong(cm: Costmap, a: Vec2, b: Vec2): number {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.01));
  let worst = 0;
  for (let s = 0; s <= n; s++) worst = Math.max(worst, cm.costAt(a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n));
  return worst;
}

function signedArea(pts: Vec2[]): number {
  let A = 0;
  for (let k = 0; k + 1 < pts.length; k++) A += pts[k].x * pts[k + 1].y - pts[k + 1].x * pts[k].y;
  return A / 2;
}

describe('planCoverage', () => {
  const geom = new GridGeometry(0, 0, 110, 90, 0.05);
  const R = { x: 0, y: 0, w: 5, h: 4 };

  it('covers ≥ 90% of a rectangular room with lanes on traversable cells', () => {
    const occ = room(geom, R);
    const cm = costmapFor(occ);
    const mask = maskOf(geom, [R]);
    const lanes = planCoverage(cm, mask, { laneSpacing: SPACING });
    expect(lanes.length).toBeGreaterThan(10);
    for (const l of lanes) {
      expect(maxCostAlong(cm, l.a, l.b)).toBeLessThan(COST_INSCRIBED);
      expect(l.a.y).toBe(l.b.y); // auto axis → x (5 m > 4 m)
    }
    expect(coverageFraction(cm, mask, lanes, SPACING / 2 + 0.05)).toBeGreaterThanOrEqual(0.9);
    // Snake order: each transition to the next lane is short (≤ lane spacing).
    for (let k = 1; k < lanes.length; k++) {
      const d = Math.hypot(lanes[k].a.x - lanes[k - 1].b.x, lanes[k].a.y - lanes[k - 1].b.y);
      expect(d).toBeLessThanOrEqual(SPACING + 1e-9);
    }
    // Spacing between consecutive lane rows ≤ laneSpacing.
    const ys = [...new Set(lanes.map((l) => l.a.y))].sort((a, b) => a - b);
    for (let k = 1; k < ys.length; k++) expect(ys[k] - ys[k - 1]).toBeLessThanOrEqual(SPACING + 1e-9);
  });

  it('honours axis and startNear', () => {
    const occ = room(geom, R);
    const cm = costmapFor(occ);
    const mask = maskOf(geom, [R]);
    const lanes = planCoverage(cm, mask, { laneSpacing: SPACING, axis: 'y', startNear: { x: 4.6, y: 3.6 } });
    for (const l of lanes) expect(l.a.x).toBe(l.b.x);
    expect(Math.hypot(lanes[0].a.x - 4.6, lanes[0].a.y - 3.6)).toBeLessThan(0.3);
    expect(coverageFraction(cm, mask, lanes, SPACING / 2 + 0.05)).toBeGreaterThanOrEqual(0.9);
  });

  it('splits lanes around a central obstacle and never crosses it', () => {
    const obstacle = { x: 2.0, y: 1.5, w: 1.0, h: 1.0 };
    const occ = room(geom, R, [obstacle]);
    const cm = costmapFor(occ);
    const mask = maskOf(geom, [R]);
    const lanes = planCoverage(cm, mask, { laneSpacing: SPACING, axis: 'x' });
    for (const l of lanes) expect(maxCostAlong(cm, l.a, l.b)).toBeLessThan(COST_INSCRIBED);
    // Some rows hold two segments (left and right of the obstacle).
    const perRow = new Map<number, number>();
    for (const l of lanes) perRow.set(l.a.y, (perRow.get(l.a.y) ?? 0) + 1);
    expect([...perRow.values()].some((n) => n === 2)).toBe(true);
    expect(coverageFraction(cm, mask, lanes, SPACING / 2 + 0.05)).toBeGreaterThanOrEqual(0.9);
    // Ordering is sensible: total transit between lanes is a small multiple of the room size.
    let transit = 0;
    for (let k = 1; k < lanes.length; k++) transit += Math.hypot(lanes[k].a.x - lanes[k - 1].b.x, lanes[k].a.y - lanes[k - 1].b.y);
    expect(transit).toBeLessThan(25);
  });

  it('handles a concave (L-shaped) region restricted by the mask', () => {
    const occ = room(geom, R);
    const cm = costmapFor(occ);
    const mask = maskOf(geom, [
      { x: 0, y: 0, w: 5, h: 2 },
      { x: 0, y: 2, w: 2, h: 2 },
    ]);
    const lanes = planCoverage(cm, mask, { laneSpacing: SPACING });
    for (const l of lanes) {
      expect(maxCostAlong(cm, l.a, l.b)).toBeLessThan(COST_INSCRIBED);
      for (const p of [l.a, l.b]) expect(mask[geom.indexAt(p.x, p.y)]).toBe(1);
    }
    expect(coverageFraction(cm, mask, lanes, SPACING / 2 + 0.05)).toBeGreaterThanOrEqual(0.9);
  });

  it('drops segments shorter than minLaneLength and returns [] for an empty region', () => {
    const occ = room(geom, R);
    const cm = costmapFor(occ);
    const lanes = planCoverage(cm, maskOf(geom, [R]), { laneSpacing: SPACING, minLaneLength: 10 });
    expect(lanes).toEqual([]);
    expect(planCoverage(cm, new Uint8Array(geom.size), { laneSpacing: SPACING })).toEqual([]);
    const short = planCoverage(cm, maskOf(geom, [R]), { laneSpacing: SPACING, minLaneLength: 0.15 });
    for (const l of short) expect(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y)).toBeGreaterThanOrEqual(0.15 - 1e-9);
  });

  it('is deterministic and fast on a 330×250 grid (5×4 m room)', () => {
    const big = new GridGeometry(0, 0, 330, 250, 0.05);
    const r = { x: 3, y: 3, w: 5, h: 4 };
    const occ = room(big, r, [{ x: 5, y: 4.5, w: 0.8, h: 0.6 }]);
    const cm = new Costmap(big, PARAMS);
    cm.update(occ, { noGo: [] });
    const mask = maskOf(big, [r]);
    const first = planCoverage(cm, mask, { laneSpacing: SPACING, startNear: { x: 3.5, y: 3.5 } });
    const t0 = performance.now();
    const N = 10;
    let lanes = first;
    for (let n = 0; n < N; n++) lanes = planCoverage(cm, mask, { laneSpacing: SPACING, startNear: { x: 3.5, y: 3.5 } });
    const ms = (performance.now() - t0) / N;
    planEdgePaths(cm, mask); // warm-up
    const t1 = performance.now();
    const edges = planEdgePaths(cm, mask);
    const msEdge = performance.now() - t1;
    console.log(`coverage 5x4 room on 330x250: ${ms.toFixed(2)} ms (${lanes.length} lanes); edge paths ${msEdge.toFixed(2)} ms`);
    expect(lanes).toEqual(first);
    expect(edges.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(20);
  });
});

describe('planEdgePaths', () => {
  const geom = new GridGeometry(0, 0, 110, 90, 0.05);
  const R = { x: 0, y: 0, w: 5, h: 4 };

  function checkMinSafeDistance(cm: Costmap, path: Vec2[]): void {
    const g = cm.geom;
    for (const p of path) {
      const d = cm.obstacleDistance[g.indexAt(p.x, p.y)];
      expect(d).toBeGreaterThan(cm.inscribedRadius);
      expect(d).toBeLessThanOrEqual(cm.inscribedRadius + 2 * g.cellSize + 1e-6);
    }
    for (let k = 1; k < path.length; k++) expect(maxCostAlong(cm, path[k - 1], path[k])).toBeLessThan(COST_INSCRIBED);
  }

  it('traces one closed loop around a rectangular room at minimum safe distance, walls on the right', () => {
    const occ = room(geom, R);
    const cm = costmapFor(occ);
    const paths = planEdgePaths(cm, maskOf(geom, [R]));
    expect(paths.length).toBe(1);
    const p = paths[0];
    expect(p[0]).toEqual(p[p.length - 1]); // closed
    checkMinSafeDistance(cm, p);
    // Inset rectangle ≈ (0.325..4.675) × (0.325..3.675) → perimeter ≈ 15.4 m.
    expect(polylineLength(p)).toBeGreaterThan(14.5);
    expect(polylineLength(p)).toBeLessThan(16);
    // Simplified to (about) the 4 corners.
    expect(p.length).toBeLessThanOrEqual(8);
    // Walls on the right inside a room → counter-clockwise loop.
    expect(signedArea(p)).toBeGreaterThan(0);
  });

  it('adds a loop around an interior obstacle (clockwise: obstacle on the right)', () => {
    const occ = room(geom, R, [{ x: 2.0, y: 1.5, w: 1.0, h: 1.0 }]);
    const cm = costmapFor(occ);
    const paths = planEdgePaths(cm, maskOf(geom, [R]));
    expect(paths.length).toBe(2);
    for (const p of paths) checkMinSafeDistance(cm, p);
    expect(signedArea(paths[0])).toBeGreaterThan(0); // outer room loop (longest first)
    expect(signedArea(paths[1])).toBeLessThan(0); // obstacle loop
    // Obstacle loop ≈ inset-expanded square: (1.0 + 2·0.225)·4 minus rounded corners.
    expect(polylineLength(paths[1])).toBeGreaterThan(4.5);
    expect(polylineLength(paths[1])).toBeLessThan(6.0);
  });

  it('produces open polylines where the region mask cuts the room (doorway into another region)', () => {
    const occ = room(geom, R);
    const cm = costmapFor(occ);
    const paths = planEdgePaths(cm, maskOf(geom, [{ x: 0, y: 0, w: 2.5, h: 4 }]));
    expect(paths.length).toBe(1);
    const p = paths[0];
    expect(Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y)).toBeGreaterThan(1);
    checkMinSafeDistance(cm, p);
  });

  it('drops loops shorter than minLoopLength', () => {
    const occ = room(geom, R);
    const cm = costmapFor(occ);
    expect(planEdgePaths(cm, maskOf(geom, [R]), { minLoopLength: 100 })).toEqual([]);
  });
});
