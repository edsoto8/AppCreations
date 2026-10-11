import { describe, expect, it } from 'vitest';
import { buildingDepth, settlerDepth, tileBaseDepth, tileObjectDepth } from '../../src/render/depthKeys';
import { buildingHeight, farmStage, pileLevel } from '../../src/render/entities/buildingTextures';
import { BUILDING_TYPES } from '../../src/sim';

describe('depth keys', () => {
  it('a settler is never drawn behind the base of the tile it stands on', () => {
    for (const [x, y] of [
      [3.01, 4.01],
      [3.5, 4.5],
      [3.99, 4.99],
    ] as const) {
      expect(settlerDepth(x, y)).toBeGreaterThan(tileBaseDepth(Math.floor(x), Math.floor(y)));
    }
  });

  it('a settler in front of a tree is drawn after it, one behind is drawn before', () => {
    const treeAt = tileObjectDepth(5, 5);
    expect(settlerDepth(6.5, 6.5)).toBeGreaterThan(treeAt);
    expect(settlerDepth(4.5, 4.5)).toBeLessThan(treeAt);
  });

  it('tile objects behind a building sort before it, in front after it', () => {
    const b = buildingDepth(10, 10, 2, 2);
    expect(tileObjectDepth(9, 9)).toBeLessThan(b);
    expect(tileObjectDepth(12, 12)).toBeGreaterThan(b);
  });

  it('a settler beside or in front of a building is drawn after it', () => {
    const b = buildingDepth(10, 10, 2, 2);
    expect(settlerDepth(12.5, 10.2)).toBeGreaterThan(b);
    expect(settlerDepth(11, 12.6)).toBeGreaterThan(b);
    expect(settlerDepth(9.2, 10.5)).toBeLessThan(b);
  });

  it('settlers further along the diagonal always draw later', () => {
    expect(settlerDepth(7.2, 7.2)).toBeLessThan(settlerDepth(8.2, 7.2));
    expect(settlerDepth(7.2, 7.2)).toBeLessThan(settlerDepth(7.2, 8.2));
  });
});

describe('building visuals', () => {
  it('has a height for every building type', () => {
    for (const t of BUILDING_TYPES) expect(buildingHeight(t)).toBeGreaterThan(0);
  });

  it('farm growth follows progress and is fallow in winter', () => {
    expect(farmStage(0, 'spring')).toBe(0);
    expect(farmStage(0.2, 'summer')).toBe(1);
    expect(farmStage(0.5, 'summer')).toBe(2);
    expect(farmStage(0.7, 'autumn')).toBe(3);
    expect(farmStage(0.95, 'autumn')).toBe(4);
    expect(farmStage(0.95, 'winter')).toBe(5);
  });

  it('pile levels step up with the amount', () => {
    const steps = [1, 6, 14, 26];
    expect(pileLevel(0, steps)).toBe(0);
    expect(pileLevel(1, steps)).toBe(1);
    expect(pileLevel(13, steps)).toBe(2);
    expect(pileLevel(99, steps)).toBe(4);
  });
});
