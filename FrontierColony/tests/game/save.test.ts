import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_BACKUP_KEY,
  createMemoryStorage,
  deserializeGame,
  listSaveSlots,
  loadFromSlot,
  saveKey,
  saveMetaKey,
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

  it('refuses to write a state that would not load back, keeping the previous save', () => {
    const storage = createMemoryStorage();
    const good = createGame(DEFAULT_NEW_GAME_OPTIONS);
    expect(saveToSlot(storage, 'slot1', good).ok).toBe(true);
    const before = storage.data.get(saveKey('slot1'));
    const bad = createGame(DEFAULT_NEW_GAME_OPTIONS);
    bad.settlers[0]!.pos.x = Number.NaN;
    const result = saveToSlot(storage, 'slot1', bad);
    expect(result.ok).toBe(false);
    expect(storage.data.get(saveKey('slot1'))).toBe(before);
  });

  it('keeps the replaced autosave as a one-generation backup', () => {
    const storage = createMemoryStorage();
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    saveToSlot(storage, 'autosave', state);
    const first = storage.data.get(saveKey('autosave'));
    stepGame(state);
    saveToSlot(storage, 'autosave', state);
    expect(storage.data.get(AUTOSAVE_BACKUP_KEY)).toBe(first);
    expect(storage.data.get(saveKey('autosave'))).not.toBe(first);
  });

  it('lists slots from the metadata record and falls back to the full save when it is missing or stale', () => {
    const storage = createMemoryStorage();
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    saveToSlot(storage, 'slot2', state, new Date('2026-03-01T10:00:00Z'));
    expect(storage.data.has(saveMetaKey('slot2'))).toBe(true);
    const fromMeta = listSaveSlots(storage).find((s) => s.slot === 'slot2')!;
    expect(fromMeta.summary?.colonyName).toBe(state.colony.name);
    expect(fromMeta.savedAt).toBe('2026-03-01T10:00:00.000Z');

    // A stale meta record (from another save) is ignored in favour of the real save.
    storage.data.set(saveMetaKey('slot2'), storage.data.get(saveMetaKey('slot2'))!.replace('2026-03-01T10', '2020-01-01T10'));
    expect(listSaveSlots(storage).find((s) => s.slot === 'slot2')!.savedAt).toBe('2026-03-01T10:00:00.000Z');

    // Missing meta: still listed, from the full parse.
    storage.data.delete(saveMetaKey('slot2'));
    expect(listSaveSlots(storage).find((s) => s.slot === 'slot2')!.summary?.colonyName).toBe(state.colony.name);
  });

  it('migrates a v1 save (no Activity.indoorsBuildingId) to the current schema', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    for (let i = 0; i < 50; i++) stepGame(state);
    const env = JSON.parse(serializeGame(state, new Date('2026-01-01T00:00:00Z'))) as {
      schemaVersion: number;
      state: { meta: { schemaVersion: number }; settlers: { activity: Record<string, unknown> }[] };
    };
    env.schemaVersion = 1;
    env.state.meta.schemaVersion = 1;
    for (const s of env.state.settlers) delete s.activity.indoorsBuildingId;
    const loaded = deserializeGame(JSON.stringify(env));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state.meta.schemaVersion).toBe(2);
    for (const s of loaded.state.settlers) expect(s.activity.indoorsBuildingId).toBeNull();
  });
});
