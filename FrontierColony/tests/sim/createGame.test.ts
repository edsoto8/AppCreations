import { describe, expect, it } from 'vitest';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  MAP_DIMENSIONS,
  NEED_TYPES,
  RESOURCE_TYPES,
  SAVE_SCHEMA_VERSION,
  createGame,
  getHousingCapacity,
  getStorageCapacity,
  stepGame,
  validateGameState,
  type GameState,
  type NewGameOptions,
} from '../../src/sim';

const options: NewGameOptions = { ...DEFAULT_NEW_GAME_OPTIONS, seed: 'unit-test' };

function run(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepGame(state);
}

describe('createGame', () => {
  it('creates a valid, JSON-safe state', () => {
    const state = createGame(options);
    const result = validateGameState(state);
    expect(result).toEqual({ ok: true, state });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state.meta.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it('sizes the map from the preset and fills every tile array', () => {
    const state = createGame({ ...options, mapSize: 'medium' });
    const n = MAP_DIMENSIONS.medium ** 2;
    expect(state.world.width * state.world.height).toBe(n);
    for (const arr of [state.world.terrain, state.world.elevation, state.world.resource, state.world.building]) {
      expect(arr).toHaveLength(n);
    }
  });

  it('starts with five founders, a town center, and consistent ids', () => {
    const state = createGame(options);
    expect(state.settlers).toHaveLength(5);
    const tc = state.buildings.find((b) => b.type === 'townCenter');
    expect(tc?.status).toBe('complete');
    expect(getHousingCapacity(state)).toBe(BUILDING_DEFS.townCenter.housing);
    expect(getStorageCapacity(state)).toBe(BUILDING_DEFS.townCenter.storage);
    const ids = [...state.settlers.map((s) => s.id), ...state.buildings.map((b) => b.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeLessThan(state.nextId);
    expect(new Set(state.settlers.map((s) => s.name)).size).toBe(5);
    for (const s of state.settlers) {
      for (const need of NEED_TYPES) {
        expect(s.needs[need]).toBeGreaterThanOrEqual(0);
        expect(s.needs[need]).toBeLessThanOrEqual(100);
      }
      expect(s.activity.label).not.toBe('');
    }
    for (const r of RESOURCE_TYPES) expect(state.colony.stock[r]).toBeGreaterThanOrEqual(0);
  });

  it('marks the town center footprint in the building layer', () => {
    const state = createGame(options);
    const tc = state.buildings[0]!;
    const covered = state.world.building.filter((id) => id === tc.id).length;
    expect(covered).toBe(tc.footprint.w * tc.footprint.h);
  });

  it('is deterministic: same options give identical states, also after simulating', () => {
    const a = createGame(options);
    const b = createGame(options);
    expect(b).toEqual(a);
    run(a, 500);
    run(b, 500);
    expect(b).toEqual(a);
  });

  it('different seeds give different worlds', () => {
    const a = createGame(options);
    const b = createGame({ ...options, seed: 'another-seed' });
    expect(b.world.terrain).not.toEqual(a.world.terrain);
  });
});

describe('stepGame', () => {
  it('advances the clock and stays valid', () => {
    const state = createGame(options);
    const start = state.time.timeOfDay;
    run(state, 100);
    expect(state.time.tick).toBe(100);
    expect(state.time.timeOfDay).toBeGreaterThan(start);
    expect(validateGameState(state).ok).toBe(true);
  });

  it('rolls over to the next day and reports it', () => {
    const state = createGame(options);
    let dayEvents = 0;
    for (let i = 0; i < 3000 && state.time.day === 1; i++) {
      dayEvents += stepGame(state).filter((e) => e.type === 'dayStarted').length;
    }
    expect(state.time.day).toBe(2);
    expect(dayEvents).toBe(1);
    expect(state.time.timeOfDay).toBeLessThan(24);
  });

  it('records hourly stats samples', () => {
    const state = createGame(options);
    run(state, 400);
    expect(state.stats.history.length).toBeGreaterThan(0);
  });
});
