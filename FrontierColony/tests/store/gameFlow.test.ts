import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NEW_GAME_OPTIONS, createGame } from '../../src/sim';
import { createUiStore } from '../../src/store';
import { createGameFlow, type FlowController } from '../../src/ui/lib/gameFlow';
import type { LoadResult, SaveResult } from '../../src/game/save';

function stubController(load: LoadResult): { controller: FlowController; calls: string[] } {
  const calls: string[] = [];
  const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
  const controller: FlowController = {
    newGame: vi.fn(() => void calls.push('newGame')),
    loadGame: vi.fn((slot) => {
      calls.push(`load:${slot}`);
      return load;
    }),
    saveGame: vi.fn((slot): SaveResult => {
      calls.push(`save:${slot}`);
      return { ok: true, bytes: 1 };
    }),
    getState: () => state,
    setSpeed: vi.fn(() => void calls.push('setSpeed')),
    listSaves: () => [],
    deleteSave: vi.fn(),
  };
  return { controller, calls };
}

const menuStore = () => createUiStore({ screen: 'mainMenu', gameStarted: false, paused: true });

describe('game flow', () => {
  it('startNewGame creates the game, resets speed and enters the game screen', () => {
    const { controller, calls } = stubController({ ok: false, error: 'x' });
    const store = menuStore();
    createGameFlow(controller, store).startNewGame(DEFAULT_NEW_GAME_OPTIONS);
    expect(calls).toEqual(['newGame', 'setSpeed']);
    expect(store.getState()).toMatchObject({ screen: 'playing', gameStarted: true });
  });

  it('loadSlot enters the game only when the load succeeded', () => {
    const failing = stubController({ ok: false, error: 'This save slot is empty.' });
    const store = menuStore();
    const result = createGameFlow(failing.controller, store).loadSlot('slot1');
    expect(result.ok).toBe(false);
    expect(store.getState().screen).toBe('mainMenu');

    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const working = stubController({ ok: true, state, envelope: {} as never });
    const store2 = menuStore();
    expect(createGameFlow(working.controller, store2).loadSlot('autosave').ok).toBe(true);
    expect(store2.getState()).toMatchObject({ screen: 'playing', gameStarted: true });
  });

  it('toMainMenu autosaves a started game and pauses behind the menu', () => {
    const { controller, calls } = stubController({ ok: false, error: 'x' });
    const store = createUiStore(); // in game
    createGameFlow(controller, store).toMainMenu();
    expect(calls).toEqual(['save:autosave']);
    expect(store.getState()).toMatchObject({ screen: 'mainMenu', paused: true });
  });

  it('toMainMenu never autosaves when no game was started', () => {
    const { controller, calls } = stubController({ ok: false, error: 'x' });
    const store = menuStore();
    createGameFlow(controller, store).toMainMenu();
    expect(calls).toEqual([]);
  });

  it('resume returns to the running game', () => {
    const { controller } = stubController({ ok: false, error: 'x' });
    const store = createUiStore();
    const flow = createGameFlow(controller, store);
    flow.toMainMenu();
    flow.resume();
    expect(store.getState()).toMatchObject({ screen: 'playing', paused: false });
  });
});
