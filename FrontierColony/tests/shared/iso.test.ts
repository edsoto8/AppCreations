import { describe, expect, it } from 'vitest';
import {
  ELEVATION_STEP,
  HALF_TILE_HEIGHT,
  HALF_TILE_WIDTH,
  isoDepth,
  mapScreenBounds,
  pickTile,
  screenToTile,
  screenToTileFloor,
  tileCenterToScreen,
  tileToScreen,
} from '../../src/shared/iso';

describe('iso projection', () => {
  it('places tile (0,0) top vertex at the origin and follows the 2:1 diamond', () => {
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(tileToScreen(1, 0)).toEqual({ x: HALF_TILE_WIDTH, y: HALF_TILE_HEIGHT });
    expect(tileToScreen(0, 1)).toEqual({ x: -HALF_TILE_WIDTH, y: HALF_TILE_HEIGHT });
    expect(tileCenterToScreen(0, 0)).toEqual({ x: 0, y: HALF_TILE_HEIGHT });
  });

  it('lifts points by ELEVATION_STEP per level', () => {
    expect(tileToScreen(3, 4, 2).y).toBe(tileToScreen(3, 4).y - 2 * ELEVATION_STEP);
  });

  it('round-trips world → screen → world at any elevation', () => {
    for (const [x, y, e] of [
      [0, 0, 0],
      [3.25, 7.5, 0],
      [10.9, 0.1, 3],
      [63.5, 63.5, 6],
    ] as const) {
      const s = tileToScreen(x, y, e);
      const back = screenToTile(s.x, s.y, e);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });

  it('screenToTileFloor returns the tile whose diamond contains the centre point', () => {
    for (let ty = 0; ty < 5; ty++) {
      for (let tx = 0; tx < 5; tx++) {
        const c = tileCenterToScreen(tx, ty);
        expect(screenToTileFloor(c.x, c.y)).toEqual({ x: tx, y: ty });
      }
    }
  });

  it('pickTile prefers raised tiles drawn over the ground position', () => {
    // 3x3 map, tile (2,2) raised by 2 levels.
    const elevation = (x: number, y: number) => (x < 0 || y < 0 || x > 2 || y > 2 ? null : x === 2 && y === 2 ? 2 : 0);
    const raisedCentre = tileCenterToScreen(2, 2, 2);
    expect(pickTile(raisedCentre.x, raisedCentre.y, 6, elevation)).toEqual({ x: 2, y: 2 });
    const flatCentre = tileCenterToScreen(1, 0, 0);
    expect(pickTile(flatCentre.x, flatCentre.y, 6, elevation)).toEqual({ x: 1, y: 0 });
  });

  it('depth increases toward the viewer', () => {
    expect(isoDepth(1, 1)).toBeGreaterThan(isoDepth(0, 1));
    const b = mapScreenBounds(10, 10);
    expect(b.minX).toBe(-10 * HALF_TILE_WIDTH);
    expect(b.maxX).toBe(10 * HALF_TILE_WIDTH);
    expect(b.maxY).toBe(20 * HALF_TILE_HEIGHT);
  });
});
