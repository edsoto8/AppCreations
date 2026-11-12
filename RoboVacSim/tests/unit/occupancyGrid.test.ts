import { describe, expect, it } from 'vitest';
import { GridGeometry } from '../../src/sim/mapping/GridGeometry';
import { OccupancyGrid } from '../../src/sim/mapping/OccupancyGrid';
import { CELL_FREE, CELL_OCCUPIED, CELL_UNKNOWN } from '../../src/sim/world/types';

const CS = 0.05;
function makeGrid(): OccupancyGrid {
  return new OccupancyGrid(new GridGeometry(0, 0, 80, 60, CS)); // 4 m × 3 m
}

describe('OccupancyGrid', () => {
  it('starts unknown with default params', () => {
    const occ = makeGrid();
    expect(occ.params.lHit).toBeCloseTo(0.85);
    expect(occ.params.lMiss).toBeCloseTo(-0.4);
    expect(occ.knownArea()).toBe(0);
    expect(occ.state(0)).toBe(CELL_UNKNOWN);
    expect(occ.isUnknown(123)).toBe(true);
  });

  it('a hit ray marks traversed cells free and the end cell occupied', () => {
    const occ = makeGrid();
    const g = occ.geom;
    const v0 = occ.version;
    occ.integrateRay(0.525, 0.525, 1.525, 0.525, true);
    expect(occ.version).toBeGreaterThan(v0);
    for (let i = g.col(0.525); i < g.col(1.525); i++) {
      expect(occ.isFree(g.index(i, g.row(0.525)))).toBe(true);
    }
    const end = g.indexAt(1.525, 0.525);
    expect(occ.isOccupied(end)).toBe(true);
    expect(occ.state(end)).toBe(CELL_OCCUPIED);
    // Neighbouring rows untouched.
    expect(occ.isUnknown(g.indexAt(1.0, 0.625))).toBe(true);
    // Beyond the end untouched.
    expect(occ.isUnknown(g.indexAt(1.575, 0.525))).toBe(true);
  });

  it('a max-range (no hit) ray marks the end cell free too', () => {
    const occ = makeGrid();
    occ.integrateRay(0.5, 0.5, 2.0, 0.5, false);
    expect(occ.isFree(occ.geom.indexAt(2.0, 0.5))).toBe(true);
  });

  it('diagonal rays visit every cell the segment crosses (DDA)', () => {
    const occ = makeGrid();
    const g = occ.geom;
    const ax = 0.31;
    const ay = 0.27;
    const bx = 3.13;
    const by = 2.41;
    occ.integrateRay(ax, ay, bx, by, true);
    const endIdx = g.indexAt(bx, by);
    for (let t = 0; t <= 1; t += 0.0005) {
      const k = g.indexAt(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (k === endIdx) continue;
      expect(occ.logOdds[k]).toBeLessThan(0);
    }
    expect(occ.isOccupied(endIdx)).toBe(true);
    // The traversal is thin: only cells near the line were touched.
    let touched = 0;
    for (let k = 0; k < g.size; k++) if (occ.logOdds[k] !== 0) touched++;
    const expected = Math.abs(g.col(bx) - g.col(ax)) + Math.abs(g.row(by) - g.row(ay)) + 1;
    expect(touched).toBe(expected);
  });

  it('repeated misses clear an occupied cell, log-odds are clamped', () => {
    const occ = makeGrid();
    const g = occ.geom;
    occ.markOccupied(1.0, 1.0);
    const k = g.indexAt(1.0, 1.0);
    expect(occ.isOccupied(k)).toBe(true);
    expect(occ.logOdds[k]).toBeCloseTo(occ.params.lMax);
    for (let n = 0; n < 5; n++) occ.integrateRay(0.2, 1.0, 2.0, 1.0, true);
    expect(occ.isOccupied(k)).toBe(true); // a few misses are not enough
    for (let n = 0; n < 15; n++) occ.integrateRay(0.2, 1.0, 2.0, 1.0, true);
    expect(occ.isFree(k)).toBe(true);
    for (let n = 0; n < 50; n++) occ.integrateRay(0.2, 1.0, 2.0, 1.0, true);
    expect(occ.logOdds[k]).toBeCloseTo(occ.params.lMin);
    expect(occ.logOdds[g.indexAt(2.0, 1.0)]).toBeCloseTo(occ.params.lMax);
  });

  it('rays partly outside the grid are clamped and do not throw', () => {
    const occ = makeGrid();
    const g = occ.geom;
    occ.integrateRay(2.0, 1.0, 6.0, 1.0, true); // ends outside
    expect(occ.isFree(g.indexAt(3.9, 1.0))).toBe(true);
    occ.integrateRay(-2.0, 2.0, 1.0, 2.0, true); // starts outside
    expect(occ.isFree(g.indexAt(0.02, 2.0))).toBe(true);
    expect(occ.isOccupied(g.indexAt(1.0, 2.0))).toBe(true);
    occ.integrateRay(-1, -1, -2, -3, true); // fully outside
  });

  it('a zero-length ray only updates its own cell', () => {
    const occ = makeGrid();
    occ.integrateRay(1.0, 1.0, 1.01, 1.01, true);
    expect(occ.isOccupied(occ.geom.indexAt(1.0, 1.0))).toBe(true);
    expect(occ.counts().occupied).toBe(1);
    expect(occ.counts().free).toBe(0);
  });

  it('markFreeDisc frees cells whose centers are inside the disc', () => {
    const occ = makeGrid();
    const g = occ.geom;
    occ.markOccupied(1.5, 1.5);
    occ.markFreeDisc(1.5, 1.5, 0.175);
    expect(occ.isFree(g.indexAt(1.5, 1.5))).toBe(true);
    expect(occ.isFree(g.indexAt(1.5 + 0.15, 1.5))).toBe(true);
    expect(occ.isUnknown(g.indexAt(1.5 + 0.25, 1.5))).toBe(true);
    const nFree = occ.counts().free;
    let expected = 0;
    for (let k = 0; k < g.size; k++) {
      const c = g.centerOf(k);
      if (Math.hypot(c.x - 1.5, c.y - 1.5) <= 0.175) expected++;
    }
    expect(nFree).toBe(expected);
    expect(Math.abs(nFree - (Math.PI * 0.175 * 0.175) / (CS * CS))).toBeLessThan(10);
    expect(occ.knownArea()).toBeCloseTo(nFree * CS * CS, 9);
  });

  it('markOccupied with a radius marks a disc', () => {
    const occ = makeGrid();
    const g = occ.geom;
    occ.markOccupied(2.0, 1.0, 0.1);
    expect(occ.isOccupied(g.indexAt(2.0, 1.0))).toBe(true);
    expect(occ.isOccupied(g.indexAt(2.07, 1.0))).toBe(true);
    expect(occ.isUnknown(g.indexAt(2.2, 1.0))).toBe(true);
    expect(occ.counts().occupied).toBeGreaterThan(9);
  });

  it('setRect, states(), counts, knownArea and reset', () => {
    const occ = makeGrid();
    occ.setRect({ x: 0, y: 0, w: 1, h: 1 }, CELL_FREE);
    occ.setRect({ x: 1, y: 0, w: 0.5, h: 1 }, CELL_OCCUPIED);
    expect(occ.counts()).toEqual({ free: 400, occupied: 200, unknown: 80 * 60 - 600 });
    expect(occ.knownArea()).toBeCloseTo(1.5, 6);
    expect(occ.freeArea()).toBeCloseTo(1.0, 6);
    const st = occ.states();
    expect(st[occ.geom.indexAt(0.5, 0.5)]).toBe(CELL_FREE);
    expect(st[occ.geom.indexAt(1.2, 0.5)]).toBe(CELL_OCCUPIED);
    expect(st[occ.geom.indexAt(3, 2)]).toBe(CELL_UNKNOWN);
    expect(occ.probability(occ.geom.indexAt(1.2, 0.5))).toBeGreaterThan(0.9);
    const v = occ.version;
    occ.reset();
    expect(occ.version).toBeGreaterThan(v);
    expect(occ.knownArea()).toBe(0);
  });

  it('accepts custom params', () => {
    const occ = new OccupancyGrid(new GridGeometry(0, 0, 10, 10, 0.1), { lHit: 2, occThreshold: 1.5 });
    occ.integrateRay(0.05, 0.05, 0.55, 0.05, true);
    expect(occ.logOdds[occ.geom.indexAt(0.55, 0.05)]).toBeCloseTo(2);
    expect(occ.isOccupied(occ.geom.indexAt(0.55, 0.05))).toBe(true);
  });
});
