import { describe, expect, it } from 'vitest';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  Terrain,
  applyCommand,
  canPlaceBuilding,
  createGame,
  getAvailableStock,
  getBuildingAt,
  tileIndex,
  type GameState,
} from '../../src/sim';

/** Find an origin where a building of the given footprint fits on grass. */
function findGrassSpot(state: GameState, w: number, h: number): { x: number; y: number } {
  const world = state.world;
  for (let y = 0; y < world.height - h; y++) {
    for (let x = 0; x < world.width - w; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w && ok; dx++) {
          const i = tileIndex(world, x + dx, y + dy);
          ok = world.terrain[i] === Terrain.Grass && world.building[i] === 0;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no grass spot');
}

describe('applyCommand', () => {
  it('places a house, reserves its cost (nothing is deducted yet) and occupies the footprint', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const spot = findGrassSpot(state, 2, 2);
    const woodBefore = state.colony.stock.wood;
    const result = applyCommand(state, { type: 'placeBuilding', buildingType: 'house', ...spot });
    expect(result.ok).toBe(true);
    expect(state.colony.stock.wood).toBe(woodBefore);
    expect(getAvailableStock(state).wood).toBe(woodBefore - (BUILDING_DEFS.house.cost.wood ?? 0));
    const b = getBuildingAt(state, spot.x + 1, spot.y + 1);
    expect(b?.type).toBe('house');
    expect(b?.status).toBe('construction');
  });

  it('rejects overlapping, out-of-bounds and unaffordable placements without changing state', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const tc = state.buildings[0]!;
    const before = JSON.stringify(state);
    const overlap = applyCommand(state, { type: 'placeBuilding', buildingType: 'house', x: tc.origin.x, y: tc.origin.y });
    expect(overlap).toMatchObject({ ok: false, error: 'blocked' });
    const outside = applyCommand(state, { type: 'placeBuilding', buildingType: 'well', x: -1, y: 0 });
    expect(outside).toMatchObject({ ok: false, error: 'outOfBounds' });
    const townCenter = applyCommand(state, { type: 'placeBuilding', buildingType: 'townCenter', x: 0, y: 0 });
    expect(townCenter.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);

    state.colony.stock.wood = 0;
    const spot = findGrassSpot(state, 2, 2);
    expect(canPlaceBuilding(state, 'house', spot.x, spot.y)).toMatchObject({ ok: false, error: 'insufficientResources' });
  });

  it('cancelling a construction site refunds delivered materials and frees the tiles', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const spot = findGrassSpot(state, 2, 2);
    const stockBefore = { ...state.colony.stock };
    const placed = applyCommand(state, { type: 'placeBuilding', buildingType: 'house', ...spot });
    if (!placed.ok || placed.entityId === null) throw new Error('placement failed');
    const cancelled = applyCommand(state, { type: 'cancelBuilding', buildingId: placed.entityId });
    expect(cancelled.ok).toBe(true);
    expect(state.colony.stock).toEqual(stockBefore);
    expect(getBuildingAt(state, spot.x, spot.y)).toBeNull();
  });

  it('rejects locked building types until they are unlocked', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const spot = findGrassSpot(state, 2, 2);
    expect(canPlaceBuilding(state, 'workshop', spot.x, spot.y)).toMatchObject({ ok: false, error: 'locked' });
    state.progress.unlocked.push('workshop');
    state.colony.stock.stone = 100;
    expect(canPlaceBuilding(state, 'workshop', spot.x, spot.y).ok).toBe(true);
  });

  it('keeps accepting commands after victory (sandbox) but not after defeat', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    state.outcome = { status: 'won', reason: 'Thriving', endedTick: 0 };
    expect(applyCommand(state, { type: 'acknowledgeVictory' }).ok).toBe(true);
    expect(state.progress.victoryAcknowledged).toBe(true);
    expect(applyCommand(state, { type: 'setPriority', category: 'mining', level: 1 }).ok).toBe(true);
    state.outcome = { status: 'lost', reason: 'Everyone died', endedTick: 1 };
    expect(applyCommand(state, { type: 'setPriority', category: 'mining', level: 2 })).toMatchObject({ ok: false, error: 'gameOver' });
  });

  it('refuses to remove the town center and validates priorities', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const tc = state.buildings[0]!;
    expect(applyCommand(state, { type: 'demolishBuilding', buildingId: tc.id }).ok).toBe(false);
    expect(applyCommand(state, { type: 'setPriority', category: 'farming', level: 3 }).ok).toBe(true);
    expect(state.colony.priorities.farming).toBe(3);
    expect(applyCommand(state, { type: 'demolishBuilding', buildingId: 9999 })).toMatchObject({ ok: false, error: 'notFound' });
  });
});
