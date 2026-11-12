import { describe, expect, it } from 'vitest';
import { GridGeometry } from '../../src/sim/mapping/GridGeometry';
import { OccupancyGrid } from '../../src/sim/mapping/OccupancyGrid';
import {
  COST_FREE,
  COST_INSCRIBED,
  COST_LETHAL,
  COST_UNKNOWN,
  Costmap,
} from '../../src/sim/mapping/Costmap';
import { CELL_FREE, CELL_OCCUPIED, CELL_UNKNOWN } from '../../src/sim/world/types';

const PARAMS = { robotRadius: 0.175, inflationRadius: 0.45, safetyMargin: 0.02 };

/** 5 m × 4 m room: free interior, 0.1 m thick walls on the border (inner wall faces at 0.1 / 4.9 / 3.9). */
function room(): OccupancyGrid {
  const occ = new OccupancyGrid(new GridGeometry(0, 0, 100, 80, 0.05));
  occ.setRect({ x: 0, y: 0, w: 5, h: 4 }, CELL_FREE);
  occ.setRect({ x: 0, y: 0, w: 5, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: 0, y: 3.9, w: 5, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: 0, y: 0, w: 0.1, h: 4 }, CELL_OCCUPIED);
  occ.setRect({ x: 4.9, y: 0, w: 0.1, h: 4 }, CELL_OCCUPIED);
  return occ;
}

/** Deterministic LCG for test maps. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Costmap', () => {
  it('inflates walls: 0.1 m → INSCRIBED, 0.3 m → graded, 1 m → free', () => {
    const occ = room();
    const cm = new Costmap(occ.geom, PARAMS);
    cm.update(occ, { noGo: [] });
    const g = occ.geom;
    // Wall face at y = 0.1. Cell centers at 0.225 / 0.425 / 1.125 → 0.125 / 0.325 / 1.025 m from it.
    const k01 = g.index(40, 4);
    const k03 = g.index(40, 8);
    const k1 = g.index(40, 22);
    expect(cm.obstacleDistance[k01]).toBeCloseTo(0.125, 5);
    expect(cm.cost[k01]).toBe(COST_INSCRIBED);
    expect(cm.obstacleDistance[k03]).toBeCloseTo(0.325, 5);
    expect(cm.cost[k03]).toBeGreaterThan(COST_FREE);
    expect(cm.cost[k03]).toBeLessThan(COST_INSCRIBED);
    expect(cm.cost[k1]).toBe(COST_FREE);
    expect(cm.cost[g.indexAt(2.0, 0.05)]).toBe(COST_LETHAL);
    expect(cm.obstacleDistance[g.indexAt(2.0, 0.05)]).toBe(0);
    expect(cm.isTraversable(k01)).toBe(false);
    expect(cm.isTraversable(k03)).toBe(true);
  });

  it('obstacle distance equals the distance from cell center to the wall face (axis-aligned)', () => {
    const occ = room();
    const cm = new Costmap(occ.geom, PARAMS);
    cm.update(occ, { noGo: [] });
    const g = occ.geom;
    for (let j = 2; j < 12; j++) {
      const k = g.index(50, j);
      const expected = Math.min(g.cy(j) - 0.1, PARAMS.inflationRadius + g.cellSize);
      expect(cm.obstacleDistance[k]).toBeCloseTo(expected, 5);
    }
  });

  it('graded cost decreases monotonically with distance and stays in 1..252', () => {
    const occ = room();
    const cm = new Costmap(occ.geom, PARAMS);
    cm.update(occ, { noGo: [] });
    const g = occ.geom;
    let prev = 256;
    for (let j = 2; j < 20; j++) {
      const c = cm.cost[g.index(50, j)];
      expect(c).toBeLessThanOrEqual(prev);
      prev = c;
      const d = cm.obstacleDistance[g.index(50, j)];
      if (d > cm.inscribedRadius && d <= PARAMS.inflationRadius) {
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(252);
      }
    }
    expect(cm.costForDistance(0.2)).toBeGreaterThan(cm.costForDistance(0.4));
    expect(cm.costForDistance(0.5)).toBe(COST_FREE);
  });

  it('exact EDT matches brute force on a random map', () => {
    const g = new GridGeometry(-1, -1, 40, 30, 0.05);
    const occ = new OccupancyGrid(g);
    occ.setRect({ x: -1, y: -1, w: 2, h: 1.5 }, CELL_FREE);
    const rnd = lcg(7);
    for (let n = 0; n < 12; n++) occ.markOccupied(-1 + rnd() * 2, -1 + rnd() * 1.5);
    const cm = new Costmap(g, PARAMS);
    cm.update(occ, { noGo: [] });
    const cap = PARAMS.inflationRadius + g.cellSize;
    for (let k = 0; k < g.size; k++) {
      let best = Infinity;
      const p = g.centerOf(k);
      for (let q = 0; q < g.size; q++) {
        if (!occ.isOccupied(q)) continue;
        const c = g.centerOf(q);
        best = Math.min(best, Math.hypot(c.x - p.x, c.y - p.y));
      }
      const expected = occ.isOccupied(k) ? 0 : Math.min(cap, Math.max(0, best - g.cellSize / 2));
      expect(cm.obstacleDistance[k]).toBeCloseTo(expected, 4);
    }
  });

  it('unknown cells cost COST_UNKNOWN unless unknownIsFree; inflation wins over unknown', () => {
    const occ = room();
    occ.setRect({ x: 3, y: 1, w: 1, h: 1 }, CELL_UNKNOWN);
    occ.setRect({ x: 0.1, y: 2, w: 0.3, h: 0.5 }, CELL_UNKNOWN); // next to the left wall
    const cm = new Costmap(occ.geom, PARAMS);
    const g = occ.geom;
    cm.update(occ, { noGo: [] });
    expect(cm.cost[g.indexAt(3.5, 1.5)]).toBe(COST_UNKNOWN);
    expect(cm.isTraversable(g.indexAt(3.5, 1.5))).toBe(false);
    expect(cm.isTraversable(g.indexAt(3.5, 1.5), true)).toBe(true);
    expect(cm.cost[g.indexAt(0.15, 2.2)]).toBe(COST_INSCRIBED);
    cm.update(occ, { noGo: [], unknownIsFree: true });
    expect(cm.cost[g.indexAt(3.5, 1.5)]).toBe(COST_FREE);
  });

  it('extraLethal cells are lethal and inflated', () => {
    const occ = room();
    const g = occ.geom;
    const extra = new Uint8Array(g.size);
    extra[g.indexAt(2.5, 2.0)] = 1;
    const cm = new Costmap(g, PARAMS);
    cm.update(occ, { noGo: [], extraLethal: extra });
    expect(cm.cost[g.indexAt(2.5, 2.0)]).toBe(COST_LETHAL);
    expect(cm.cost[g.indexAt(2.62, 2.0)]).toBe(COST_INSCRIBED);
    expect(cm.cost[g.indexAt(2.85, 2.0)]).toBeLessThan(COST_INSCRIBED);
    expect(cm.cost[g.indexAt(2.85, 2.0)]).toBeGreaterThan(COST_FREE);
  });

  it('no-go rects are lethal inside and block the robot center within radius + margin', () => {
    const occ = room();
    const g = occ.geom;
    const cm = new Costmap(g, PARAMS);
    const rect = { x: 2.0, y: 1.5, w: 0.6, h: 0.6 };
    cm.update(occ, { noGo: [rect] });
    expect(cm.cost[g.indexAt(2.3, 1.8)]).toBe(COST_LETHAL);
    // Cell centers at 0.125 / 0.175 left of the rect edge → INSCRIBED (< 0.195)
    expect(cm.cost[g.indexAt(1.88, 1.8)]).toBe(COST_INSCRIBED);
    expect(cm.cost[g.indexAt(1.83, 1.8)]).toBe(COST_INSCRIBED);
    // 0.225 → graded, traversable
    expect(cm.obstacleDistance[g.indexAt(1.78, 1.8)]).toBeCloseTo(0.225, 5);
    expect(cm.isTraversable(g.indexAt(1.78, 1.8))).toBe(true);
    // Diagonal from the corner: exact Euclidean distance.
    const k = g.indexAt(2.6 + 0.125, 2.1 + 0.125);
    expect(cm.obstacleDistance[k]).toBeCloseTo(Math.hypot(0.125, 0.125), 5);
    // Every cell center within radius+margin of the rect is not traversable.
    for (let q = 0; q < g.size; q++) {
      const p = g.centerOf(q);
      const dx = Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.w));
      const dy = Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.h));
      if (Math.hypot(dx, dy) <= cm.inscribedRadius) expect(cm.isTraversable(q)).toBe(false);
    }
  });

  it('updates are repeatable (buffers reused) and react to map changes', () => {
    const occ = room();
    const cm = new Costmap(occ.geom, PARAMS);
    cm.update(occ, { noGo: [] });
    const a = cm.cost.slice();
    const v = cm.version;
    cm.update(occ, { noGo: [] });
    expect(cm.cost).toEqual(a);
    expect(cm.version).toBe(v + 1);
    occ.markOccupied(2.5, 2.0);
    cm.update(occ, { noGo: [] });
    expect(cm.cost[occ.geom.indexAt(2.5, 2.0)]).toBe(COST_LETHAL);
    // Empty map (no obstacles at all) works too.
    const empty = new OccupancyGrid(occ.geom);
    empty.setRect({ x: 0, y: 0, w: 5, h: 4 }, CELL_FREE);
    cm.update(empty, { noGo: [] });
    expect(cm.cost.every((c) => c === COST_FREE)).toBe(true);
  });

  it('full update on a 330×250 grid is fast (< 8 ms)', () => {
    const g = new GridGeometry(0, 0, 330, 250, 0.05);
    const occ = new OccupancyGrid(g);
    occ.setRect({ x: 0, y: 0, w: 16.5, h: 12.5 }, CELL_FREE);
    occ.setRect({ x: 12, y: 0, w: 4.5, h: 4 }, CELL_UNKNOWN);
    const rnd = lcg(3);
    for (let n = 0; n < 40; n++) {
      occ.setRect({ x: rnd() * 16, y: rnd() * 12, w: 0.1 + rnd() * 3, h: 0.1 }, CELL_OCCUPIED);
      occ.setRect({ x: rnd() * 16, y: rnd() * 12, w: 0.1, h: 0.1 + rnd() * 3 }, CELL_OCCUPIED);
    }
    const cm = new Costmap(g, PARAMS);
    const inputs = { noGo: [{ x: 3, y: 3, w: 1, h: 1 }] };
    for (let n = 0; n < 5; n++) cm.update(occ, inputs);
    const times: number[] = [];
    for (let n = 0; n < 15; n++) {
      const t0 = performance.now();
      cm.update(occ, inputs);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(`costmap update 330x250: median ${median.toFixed(2)} ms`);
    expect(median).toBeLessThan(8);
  });
});
