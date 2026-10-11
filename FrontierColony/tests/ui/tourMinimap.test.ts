import { describe, expect, it } from 'vitest';
import { Terrain } from '../../src/sim';
import { tileToScreen } from '../../src/shared/iso';
import { TOUR_STEPS, clampStep, isStepDone, type TourContext } from '../../src/ui/lib/tour';
import { TERRAIN_RGB, minimapToTile, terrainPixels, tileToMinimap, viewportCorners } from '../../src/ui/lib/minimap';
import { easeOut } from '../../src/ui/lib/useRolledNumber';

const ctx = (o: Partial<TourContext> = {}): TourContext => ({ buildings: [], openPanel: null, selectionKind: null, ...o });

describe('tutorial steps', () => {
  it('has 4 to 8 steps that start and end with a plain card', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(8);
    expect(TOUR_STEPS[0]!.target).toBeNull();
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]!.target).toBeNull();
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });

  it('completes the build steps when that building exists, and the panel steps on use', () => {
    const byId = (id: string) => TOUR_STEPS.find((s) => s.id === id)!;
    expect(isStepDone(byId('farm'), ctx())).toBe(false);
    expect(isStepDone(byId('farm'), ctx({ buildings: [{ type: 'farm' }] }))).toBe(true);
    expect(isStepDone(byId('well'), ctx({ buildings: [{ type: 'farm' }] }))).toBe(false);
    expect(isStepDone(byId('house'), ctx({ buildings: [{ type: 'house' }] }))).toBe(true);
    expect(isStepDone(byId('priorities'), ctx({ openPanel: 'priorities' }))).toBe(true);
    expect(isStepDone(byId('priorities'), ctx({ openPanel: 'build' }))).toBe(false);
    expect(isStepDone(byId('needs'), ctx({ selectionKind: 'settler' }))).toBe(true);
    expect(isStepDone(byId('welcome'), ctx({ openPanel: 'priorities' }))).toBe(false);
  });

  it('clamps step indexes', () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(99)).toBe(TOUR_STEPS.length - 1);
    expect(clampStep(2.7)).toBe(2);
  });
});

describe('minimap maths', () => {
  it('maps tiles to pixels and back, clamped to the map', () => {
    expect(tileToMinimap(32, 16, 64, 128)).toEqual({ x: 64, y: 32 });
    expect(minimapToTile(64, 32, 64, 128)).toEqual({ x: 32, y: 16 });
    expect(minimapToTile(-10, 500, 64, 128)).toEqual({ x: 0, y: 63 });
    expect(minimapToTile(127.9, 0, 64, 128)).toEqual({ x: 63, y: 0 });
  });

  it('colours one pixel per tile, with every terrain known', () => {
    const terrain = [Terrain.DeepWater, Terrain.Grass, Terrain.Mountain, 99];
    const px = terrainPixels(terrain, [0, 0, 6, 0], 6);
    expect(px).toHaveLength(16);
    expect(px[3]).toBe(255);
    for (const t of Object.values(Terrain)) expect(TERRAIN_RGB[t]).toBeDefined();
    // Water is bluer than grass; unknown terrain still gets a colour.
    expect(px[2]!).toBeGreaterThan(px[0]!);
    expect(px[4 * 3 + 3]).toBe(255);
  });

  it('turns the camera view into a quad centred on the camera tile', () => {
    const centre = tileToScreen(20, 30);
    const corners = viewportCorners({ centerX: centre.x, centerY: centre.y, zoom: 1 }, 1280, 720);
    expect(corners).toHaveLength(4);
    const avgX = corners.reduce((a, c) => a + c.x, 0) / 4;
    const avgY = corners.reduce((a, c) => a + c.y, 0) / 4;
    expect(avgX).toBeCloseTo(20, 6);
    expect(avgY).toBeCloseTo(30, 6);
    // Zooming in shrinks the visible area.
    const zoomed = viewportCorners({ centerX: centre.x, centerY: centre.y, zoom: 2 }, 1280, 720);
    const spread = (cs: typeof corners) => Math.max(...cs.map((c) => c.x)) - Math.min(...cs.map((c) => c.x));
    expect(spread(zoomed)).toBeCloseTo(spread(corners) / 2, 6);
  });
});

describe('number roll easing', () => {
  it('runs from 0 to 1 and decelerates', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
