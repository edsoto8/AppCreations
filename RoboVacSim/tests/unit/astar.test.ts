import { describe, expect, it } from 'vitest';
import { GridGeometry } from '../../src/sim/mapping/GridGeometry';
import { OccupancyGrid } from '../../src/sim/mapping/OccupancyGrid';
import { COST_INSCRIBED, Costmap } from '../../src/sim/mapping/Costmap';
import { AStarPlanner, segmentClear } from '../../src/sim/navigation/AStar';
import type { Vec2 } from '../../src/sim/world/types';
import { CELL_FREE, CELL_OCCUPIED, CELL_UNKNOWN } from '../../src/sim/world/types';

const PARAMS = { robotRadius: 0.175, inflationRadius: 0.45, safetyMargin: 0.02 };

/** 6 m × 4 m room with 0.1 m border walls; optional vertical wall at x 2.9..3.1 with a gap. */
function room(gap?: { cy: number; w: number }): OccupancyGrid {
  const occ = new OccupancyGrid(new GridGeometry(0, 0, 120, 80, 0.05));
  occ.setRect({ x: 0, y: 0, w: 6, h: 4 }, CELL_FREE);
  occ.setRect({ x: 0, y: 0, w: 6, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: 0, y: 3.9, w: 6, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: 0, y: 0, w: 0.1, h: 4 }, CELL_OCCUPIED);
  occ.setRect({ x: 5.9, y: 0, w: 0.1, h: 4 }, CELL_OCCUPIED);
  if (gap) {
    occ.setRect({ x: 2.9, y: 0, w: 0.2, h: gap.cy - gap.w / 2 }, CELL_OCCUPIED);
    occ.setRect({ x: 2.9, y: gap.cy + gap.w / 2, w: 0.2, h: 4 - gap.cy - gap.w / 2 }, CELL_OCCUPIED);
  }
  return occ;
}

function costmapFor(occ: OccupancyGrid, unknownIsFree = false): Costmap {
  const cm = new Costmap(occ.geom, PARAMS);
  cm.update(occ, { noGo: [], unknownIsFree });
  return cm;
}

/** Max cost sampled every 1 cm along the polyline (skipping the first `skip` meters). */
function sampleCosts(cm: Costmap, path: Vec2[], skip = 0): number {
  let worst = 0;
  let along = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(L / 0.01));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      if (along + t * L < skip) continue;
      worst = Math.max(worst, cm.costAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
    along += L;
  }
  return worst;
}

describe('AStarPlanner', () => {
  it('finds a path around a wall through a gap, never touching INSCRIBED cells', () => {
    const occ = room({ cy: 3.0, w: 0.8 });
    const cm = costmapFor(occ);
    const planner = new AStarPlanner(occ.geom);
    const start = { x: 1.0, y: 1.0 };
    const goal = { x: 5.0, y: 1.0 };
    const r = planner.plan(cm, start, goal);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.path[0]).toEqual(start);
    expect(r.path[r.path.length - 1]).toEqual(goal);
    expect(sampleCosts(cm, r.path)).toBeLessThan(COST_INSCRIBED);
    // Must go through the gap (y ≈ 2.6..3.4 at x = 3).
    const crossing = r.path.some((p, k) => {
      if (k === 0) return false;
      const a = r.path[k - 1];
      if ((a.x - 3) * (p.x - 3) > 0) return false;
      const t = (3 - a.x) / (p.x - a.x || 1e-9);
      const y = a.y + t * (p.y - a.y);
      return y > 2.6 && y < 3.4;
    });
    expect(crossing).toBe(true);
    // Smoothing reduces the raw cell path to a few waypoints.
    expect(r.path.length).toBeLessThan(r.rawCells / 4);
    expect(r.cost).toBeGreaterThan(4);
    expect(r.expansions).toBeGreaterThan(0);
  });

  it("returns 'noPath' when the wall is sealed", () => {
    const occ = room({ cy: 3.0, w: 0 });
    const cm = costmapFor(occ);
    const r = new AStarPlanner(occ.geom).plan(cm, { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('noPath');
    expect(r.path).toEqual([]);
  });

  it('respects narrow gaps with inflation: 0.5 m passable, 0.3 m not', () => {
    const planner = new AStarPlanner(new GridGeometry(0, 0, 120, 80, 0.05));
    const wide = room({ cy: 2.0, w: 0.5 });
    const cmWide = costmapFor(wide);
    const r1 = planner.plan(cmWide, { x: 1, y: 2 }, { x: 5, y: 2 });
    expect(r1.ok).toBe(true);
    expect(sampleCosts(cmWide, r1.path)).toBeLessThan(COST_INSCRIBED);
    const narrow = room({ cy: 2.0, w: 0.3 });
    const r2 = planner.plan(costmapFor(narrow), { x: 1, y: 2 }, { x: 5, y: 2 });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('noPath');
  });

  it('escapes when the start is inside the inflated zone', () => {
    const occ = room();
    const cm = costmapFor(occ);
    const start = { x: 1.0, y: 0.2 }; // 0.1 m from the bottom wall face
    expect(cm.isTraversable(occ.geom.indexAt(start.x, start.y))).toBe(false);
    const r = new AStarPlanner(occ.geom).plan(cm, start, { x: 4, y: 2 });
    expect(r.ok).toBe(true);
    expect(r.path[0]).toEqual(start);
    // After leaving the inscribed band (≤ inscribed radius + 2 cells of travel) the path is clean.
    expect(sampleCosts(cm, r.path, 0.2)).toBeLessThan(COST_INSCRIBED);
    // The escape moves away from the wall, not along it.
    expect(r.path[1].y).toBeGreaterThan(start.y);
  });

  it('escape does not tunnel through a narrow gap along the inscribed band', () => {
    const occ = room({ cy: 2.0, w: 0.3 });
    const cm = costmapFor(occ);
    // Start right in front of the narrow gap (inside its inscribed zone).
    const r = new AStarPlanner(occ.geom).plan(cm, { x: 2.75, y: 2.0 }, { x: 5, y: 2 });
    expect(r.ok).toBe(false);
  });

  it('substitutes a blocked goal within tolerance, else goalBlocked', () => {
    const occ = room();
    const cm = costmapFor(occ);
    const planner = new AStarPlanner(occ.geom);
    const near = planner.plan(cm, { x: 2, y: 2 }, { x: 5, y: 0.25 });
    expect(near.ok).toBe(true);
    const last = near.path[near.path.length - 1];
    expect(cm.isTraversable(occ.geom.indexAt(last.x, last.y))).toBe(true);
    expect(Math.hypot(last.x - 5, last.y - 0.25)).toBeLessThanOrEqual(0.15);
    expect(near.goal).toEqual(last);
    const inWall = planner.plan(cm, { x: 2, y: 2 }, { x: 5, y: 0.05 });
    expect(inWall.ok).toBe(false);
    expect(inWall.reason).toBe('goalBlocked');
    const wideTol = planner.plan(cm, { x: 2, y: 2 }, { x: 5, y: 0.05 }, { goalTolerance: 0.4 });
    expect(wideTol.ok).toBe(true);
    const outside = planner.plan(cm, { x: 2, y: 2 }, { x: 50, y: 2 });
    expect(outside.reason).toBe('goalBlocked');
    const startOutside = planner.plan(cm, { x: -5, y: 2 }, { x: 2, y: 2 });
    expect(startOutside.reason).toBe('startBlocked');
  });

  it('is deterministic (same inputs → identical path), including across planner instances', () => {
    const occ = room({ cy: 2.0, w: 1.0 });
    const cm = costmapFor(occ);
    const p1 = new AStarPlanner(occ.geom);
    const p2 = new AStarPlanner(occ.geom);
    const a = p1.plan(cm, { x: 0.7, y: 0.7 }, { x: 5.3, y: 3.3 });
    p1.plan(cm, { x: 5, y: 1 }, { x: 1, y: 3 }); // unrelated call in between
    const b = p1.plan(cm, { x: 0.7, y: 0.7 }, { x: 5.3, y: 3.3 });
    const c = p2.plan(cm, { x: 0.7, y: 0.7 }, { x: 5.3, y: 3.3 });
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('plans through unknown space only when allowUnknown', () => {
    const occ = room();
    occ.setRect({ x: 2.5, y: 0.1, w: 1, h: 3.8 }, CELL_UNKNOWN); // band of unknown splits the room
    const cm = costmapFor(occ);
    const planner = new AStarPlanner(occ.geom);
    expect(planner.plan(cm, { x: 1, y: 2 }, { x: 5, y: 2 }).reason).toBe('noPath');
    const r = planner.plan(cm, { x: 1, y: 2 }, { x: 5, y: 2 }, { allowUnknown: true });
    expect(r.ok).toBe(true);
  });

  it("reports 'budget' when maxExpansions is exceeded", () => {
    const occ = room({ cy: 3.0, w: 0.8 });
    const cm = costmapFor(occ);
    const r = new AStarPlanner(occ.geom).plan(cm, { x: 1, y: 1 }, { x: 5, y: 1 }, { maxExpansions: 50 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('budget');
  });

  it('handles start and goal in the same cell', () => {
    const occ = room();
    const cm = costmapFor(occ);
    const r = new AStarPlanner(occ.geom).plan(cm, { x: 2.01, y: 2.01 }, { x: 2.02, y: 2.02 });
    expect(r.ok).toBe(true);
    expect(r.path).toEqual([
      { x: 2.01, y: 2.01 },
      { x: 2.02, y: 2.02 },
    ]);
  });

  it('cost weight keeps paths away from walls in open space', () => {
    const occ = room();
    const cm = costmapFor(occ);
    const planner = new AStarPlanner(occ.geom);
    const r = planner.plan(cm, { x: 1.0, y: 0.35 }, { x: 5.0, y: 0.35 }, { smooth: false });
    const rFlat = planner.plan(cm, { x: 1.0, y: 0.35 }, { x: 5.0, y: 0.35 }, { smooth: false, costWeight: 0 });
    const maxY = Math.max(...r.path.map((p) => p.y));
    const maxYFlat = Math.max(...rFlat.path.map((p) => p.y));
    expect(maxY).toBeGreaterThan(maxYFlat);
  });

  it('distanceField gives metric distances and Infinity when unreachable', () => {
    const occ = room({ cy: 2.0, w: 0 });
    const cm = costmapFor(occ);
    const g = occ.geom;
    const planner = new AStarPlanner(g);
    const f = planner.distanceField(cm, { x: 1.0, y: 2.0 });
    const s = g.indexAt(1.0, 2.0);
    expect(f[s]).toBe(0);
    expect(f[g.index(g.col(1.0) + 10, g.row(2.0))]).toBeCloseTo(0.5, 5);
    expect(f[g.index(g.col(1.0) + 10, g.row(2.0) + 10)]).toBeCloseTo(0.5 * Math.SQRT2, 5);
    expect(f[g.indexAt(5, 2)]).toBe(Infinity); // other side of the sealed wall
    expect(f[g.indexAt(0.05, 2)]).toBe(Infinity); // inside a wall
    const out = new Float32Array(g.size);
    expect(planner.distanceField(cm, { x: 1.0, y: 2.0 }, false, out)).toBe(out);
    expect(Array.from(out)).toEqual(Array.from(f));
  });

  it('segmentClear checks every crossed cell', () => {
    const occ = room({ cy: 3.0, w: 0.8 });
    const cm = costmapFor(occ);
    expect(segmentClear(cm, { x: 1, y: 1 }, { x: 2, y: 2 }, 252)).toBe(true);
    expect(segmentClear(cm, { x: 1, y: 1 }, { x: 5, y: 1 }, 252)).toBe(false);
  });

  it('plans across a 16×12 m grid with walls in < 50 ms', () => {
    const g = new GridGeometry(0, 0, 330, 250, 0.05);
    const occ = new OccupancyGrid(g);
    occ.setRect({ x: 0, y: 0, w: 16.5, h: 12.5 }, CELL_FREE);
    // Border + interior walls with doorways forming a maze-like house.
    occ.setRect({ x: 0, y: 0, w: 16.5, h: 0.1 }, CELL_OCCUPIED);
    occ.setRect({ x: 0, y: 12.4, w: 16.5, h: 0.1 }, CELL_OCCUPIED);
    occ.setRect({ x: 0, y: 0, w: 0.1, h: 12.5 }, CELL_OCCUPIED);
    occ.setRect({ x: 16.4, y: 0, w: 0.1, h: 12.5 }, CELL_OCCUPIED);
    for (let n = 1; n <= 4; n++) {
      const x = n * 3.3;
      const door = n % 2 === 0 ? 1.0 : 10.5;
      occ.setRect({ x, y: 0, w: 0.1, h: door }, CELL_OCCUPIED);
      occ.setRect({ x, y: door + 0.9, w: 0.1, h: 12.5 }, CELL_OCCUPIED);
    }
    occ.setRect({ x: 0, y: 6, w: 2.5, h: 0.1 }, CELL_OCCUPIED);
    const cm = new Costmap(g, PARAMS);
    cm.update(occ, { noGo: [{ x: 5, y: 5, w: 1, h: 1 }] });
    const planner = new AStarPlanner(g);
    const start = { x: 0.6, y: 0.6 };
    const goal = { x: 15.8, y: 11.8 };
    planner.plan(cm, start, goal); // warm-up
    const times: number[] = [];
    let r = planner.plan(cm, start, goal);
    for (let n = 0; n < 7; n++) {
      const t0 = performance.now();
      r = planner.plan(cm, start, goal);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[3];
    const t0 = performance.now();
    const open = planner.plan(cm, { x: 3.8, y: 0.6 }, { x: 6.2, y: 11.5 });
    const tOpen = performance.now() - t0;
    console.log(
      `A* maze 330x250: median ${median.toFixed(2)} ms, ${r.expansions} expansions, ${r.path.length} pts; ` +
        `room-to-room ${tOpen.toFixed(2)} ms (${open.expansions} exp)`,
    );
    expect(r.ok).toBe(true);
    expect(sampleCosts(cm, r.path)).toBeLessThan(COST_INSCRIBED);
    expect(median).toBeLessThan(50);
  });
});
