import { describe, expect, it } from 'vitest';
import {
  createMemoryStorage,
  deserializeGame,
  listSaveSlots,
  loadFromSlot,
  saveKey,
  saveToSlot,
  serializeGame,
  type KeyValueStorage,
} from '../../src/game/save';
import { DEFAULT_NEW_GAME_OPTIONS, createGame, stepGame } from '../../src/sim';

describe('save / load', () => {
  it('round-trips a game exactly, and the loaded game continues identically', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    for (let i = 0; i < 250; i++) stepGame(state);
    const loaded = deserializeGame(serializeGame(state, new Date('2026-01-01T00:00:00Z')));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state).toEqual(state);
    expect(loaded.envelope.summary.colonyName).toBe(state.colony.name);
    for (let i = 0; i < 250; i++) {
      stepGame(state);
      stepGame(loaded.state);
    }
    expect(loaded.state).toEqual(state);
  });

  it('stores slots under versioned keys and lists them', () => {
    const storage = createMemoryStorage();
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    expect(saveToSlot(storage, 'slot1', state).ok).toBe(true);
    expect(storage.data.has(saveKey('slot1'))).toBe(true);
    expect(saveKey('slot1')).toMatch(/^frontierColony\.v\d+\.save\.slot1$/);
    const slots = listSaveSlots(storage);
    expect(slots.find((s) => s.slot === 'slot1')).toMatchObject({ exists: true, error: null });
    expect(slots.find((s) => s.slot === 'slot2')).toMatchObject({ exists: false, error: null });
  });

  it('handles missing, corrupt, foreign and invalid saves gracefully', () => {
    const storage = createMemoryStorage();
    expect(loadFromSlot(storage, 'slot1')).toMatchObject({ ok: false });

    storage.setItem(saveKey('slot1'), '{not json');
    expect(loadFromSlot(storage, 'slot1')).toMatchObject({ ok: false });

    storage.setItem(saveKey('slot2'), JSON.stringify({ hello: 'world' }));
    expect(loadFromSlot(storage, 'slot2')).toMatchObject({ ok: false });

    const env = JSON.parse(serializeGame(createGame(DEFAULT_NEW_GAME_OPTIONS), new Date())) as { state: { world: { terrain: number[] } } };
    env.state.world.terrain.pop();
    storage.setItem(saveKey('slot3'), JSON.stringify(env));
    const invalid = loadFromSlot(storage, 'slot3');
    expect(invalid.ok).toBe(false);

    const future = JSON.parse(serializeGame(createGame(DEFAULT_NEW_GAME_OPTIONS), new Date())) as { schemaVersion: number };
    future.schemaVersion = 999;
    expect(deserializeGame(JSON.stringify(future))).toMatchObject({ ok: false });

    expect(listSaveSlots(storage).find((s) => s.slot === 'slot1')).toMatchObject({ exists: true });
    expect(listSaveSlots(storage).find((s) => s.slot === 'slot1')?.error).not.toBeNull();
  });

  it('reports storage failures instead of throwing', () => {
    const failing: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    expect(saveToSlot(failing, 'slot1', state)).toEqual({ ok: false, error: 'Not enough browser storage to save.' });
    expect(loadFromSlot(failing, 'slot1')).toMatchObject({ ok: false });
  });
});
