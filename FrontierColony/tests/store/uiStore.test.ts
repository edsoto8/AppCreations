import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_GAME_OPTIONS, createGame, stepGame } from '../../src/sim';
import { MAX_TOASTS, buildHudSnapshot, createUiStore } from '../../src/store';

describe('ui store', () => {
  it('enters build mode clearing selection, and toggles pause and panels', () => {
    const store = createUiStore();
    store.getState().select({ kind: 'settler', id: 3 });
    store.getState().setBuildMode('farm');
    expect(store.getState()).toMatchObject({ buildMode: 'farm', selection: null });
    store.getState().togglePause();
    expect(store.getState().paused).toBe(true);
    store.getState().togglePanel('build');
    store.getState().togglePanel('build');
    expect(store.getState().openPanel).toBeNull();
  });

  it('caps toasts', () => {
    const store = createUiStore();
    for (let i = 0; i < MAX_TOASTS + 3; i++) store.getState().pushToast(`t${i}`);
    expect(store.getState().toasts).toHaveLength(MAX_TOASTS);
    const first = store.getState().toasts[0]!;
    store.getState().dismissToast(first.id);
    expect(store.getState().toasts).toHaveLength(MAX_TOASTS - 1);
  });
});

describe('buildHudSnapshot', () => {
  it('copies state without sharing references', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const snap = buildHudSnapshot(state);
    expect(snap.population).toBe(5);
    expect(snap.settlers[0]!.name).toBe(state.settlers[0]!.name);
    const woodBefore = snap.stock.wood;
    state.colony.stock.wood += 100;
    state.settlers[0]!.needs.hunger = 1;
    for (let i = 0; i < 50; i++) stepGame(state);
    expect(snap.stock.wood).toBe(woodBefore);
    expect(snap.settlers[0]!.needs.hunger).not.toBe(1);
  });
});
