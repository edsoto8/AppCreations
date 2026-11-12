import { describe, expect, it } from 'vitest';
import { GridGeometry } from '../../src/sim/mapping/GridGeometry';
import { OccupancyGrid } from '../../src/sim/mapping/OccupancyGrid';
import { Costmap } from '../../src/sim/mapping/Costmap';
import { findFrontiers } from '../../src/sim/navigation/Frontier';
import { CELL_FREE, CELL_OCCUPIED, CELL_UNKNOWN } from '../../src/sim/world/types';

const PARAMS = { robotRadius: 0.175, inflationRadius: 0.45, safetyMargin: 0.02 };

/** 6 m × 4 m room with border walls; everything known. */
function knownRoom(): OccupancyGrid {
  const occ = new OccupancyGrid(new GridGeometry(0, 0, 120, 80, 0.05));
  occ.setRect({ x: 0, y: 0, w: 6, h: 4 }, CELL_FREE);
  occ.setRect({ x: 0, y: 0, w: 6, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: 0, y: 3.9, w: 6, h: 0.1 }, CELL_OCCUPIED);
  occ.setRect({ x: 0, y: 0, w: 0.1, h: 4 }, CELL_OCCUPIED);
  occ.setRect({ x: 5.9, y: 0, w: 0.1, h: 4 }, CELL_OCCUPIED);
  return occ;
}

function costmapFor(occ: OccupancyGrid): Costmap {
  const cm = new Costmap(occ.geom, PARAMS);
  cm.update(occ, { noGo: [] });
  return cm;
}

describe('findFrontiers', () => {
  it('finds no frontier on a fully known map', () => {
    const occ = knownRoom();
    expect(findFrontiers(occ, costmapFor(occ))).toEqual([]);
  });

  it('finds the boundary between explored and unexplored halves', () => {
    const occ = knownRoom();
    occ.setRect({ x: 3, y: 0, w: 3, h: 4 }, CELL_UNKNOWN); // right half unexplored
    const cm = costmapFor(occ);
    const fs = findFrontiers(occ, cm);
    expect(fs.length).toBe(1);
    const f = fs[0];
    expect(f.id).toBe(0);
    // Frontier column = last free column (center x = 2.975), rows inside the walls.
    expect(f.centroid.x).toBeCloseTo(2.975, 6);
    expect(f.centroid.y).toBeCloseTo(2.0, 1);
    expect(f.size).toBe(76);
    expect(f.cells.length).toBe(f.size);
    for (const k of f.cells) {
      expect(occ.isFree(k)).toBe(true);
      expect(occ.isUnknown(k + 1)).toBe(true);
    }
    // Target: traversable, known free, close to the centroid.
    const tk = occ.geom.indexAt(f.target.x, f.target.y);
    expect(cm.isTraversable(tk)).toBe(true);
    expect(occ.isFree(tk)).toBe(true);
    expect(Math.hypot(f.target.x - f.centroid.x, f.target.y - f.centroid.y)).toBeLessThan(0.1);
  });

  it('clusters separate frontiers and drops small ones', () => {
    const occ = knownRoom();
    occ.setRect({ x: 4.5, y: 0.1, w: 1.4, h: 1.0 }, CELL_UNKNOWN); // bottom-right corner pocket
    occ.setRect({ x: 0.1, y: 3.0, w: 1.0, h: 0.9 }, CELL_UNKNOWN); // top-left corner pocket
    occ.setRect({ x: 2.0, y: 2.0, w: 0.05, h: 0.05 }, CELL_UNKNOWN); // single unknown cell → 4 frontier cells
    const cm = costmapFor(occ);
    const fs = findFrontiers(occ, cm);
    expect(fs.length).toBe(2);
    expect(fs.map((f) => f.id)).toEqual([0, 1]);
    // Scan order: the bottom-right pocket's frontier starts at a lower row.
    expect(fs[0].centroid.x).toBeGreaterThan(4);
    expect(fs[1].centroid.x).toBeLessThan(1.5);
    for (const f of fs) expect(cm.isTraversable(occ.geom.indexAt(f.target.x, f.target.y))).toBe(true);
    // A 2×2 unknown pocket has 8 frontier cells: kept by default (6) but dropped with minCells 10.
    occ.setRect({ x: 2.0, y: 2.0, w: 0.1, h: 0.1 }, CELL_UNKNOWN);
    const cm2 = costmapFor(occ);
    expect(findFrontiers(occ, cm2).length).toBe(3);
    expect(findFrontiers(occ, cm2, 10).length).toBe(2);
  });

  it('picks a traversable target near an L-shaped (concave) frontier', () => {
    const occ = knownRoom();
    occ.setRect({ x: 3, y: 2, w: 2.9, h: 1.9 }, CELL_UNKNOWN); // top-right quadrant unknown
    const cm = costmapFor(occ);
    const fs = findFrontiers(occ, cm);
    expect(fs.length).toBe(1);
    const f = fs[0];
    // The centroid of an L-shaped frontier lies off the frontier, inside the unknown area.
    const tk = occ.geom.indexAt(f.target.x, f.target.y);
    expect(cm.isTraversable(tk)).toBe(true);
    expect(occ.isFree(tk)).toBe(true);
    expect(Math.hypot(f.target.x - f.centroid.x, f.target.y - f.centroid.y)).toBeLessThan(0.75);
  });

  it('drops frontiers with no traversable target (e.g. a gap too narrow for the robot)', () => {
    const occ = knownRoom();
    // Narrow 0.3 m wide corridor of free space leading into unknown: fully inside the inscribed band.
    occ.setRect({ x: 2.0, y: 0.1, w: 0.3, h: 3.8 }, CELL_UNKNOWN);
    occ.setRect({ x: 0.1, y: 0.1, w: 1.9, h: 3.8 }, CELL_OCCUPIED);
    occ.setRect({ x: 2.31, y: 0.1, w: 3.59, h: 3.8 }, CELL_OCCUPIED); // 2.31: avoid float edge at 2.3
    occ.setRect({ x: 2.0, y: 0.1, w: 0.3, h: 1.0 }, CELL_FREE);
    const cm = costmapFor(occ);
    expect(findFrontiers(occ, cm)).toEqual([]);
    // Sanity: a smaller robot fits, so the same frontier is then reported.
    const small = new Costmap(occ.geom, { robotRadius: 0.05, inflationRadius: 0.1, safetyMargin: 0 });
    small.update(occ, { noGo: [] });
    const fs = findFrontiers(occ, small);
    expect(fs.length).toBe(1);
    expect(fs[0].size).toBe(6);
  });

  it('is deterministic', () => {
    const occ = knownRoom();
    occ.setRect({ x: 3, y: 2, w: 2.9, h: 1.9 }, CELL_UNKNOWN);
    occ.setRect({ x: 0.1, y: 0.1, w: 1, h: 1 }, CELL_UNKNOWN);
    const cm = costmapFor(occ);
    expect(findFrontiers(occ, cm)).toEqual(findFrontiers(occ, cm));
  });
});
