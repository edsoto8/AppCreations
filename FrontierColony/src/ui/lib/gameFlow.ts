/**
 * Screen-flow logic for starting, loading, leaving and resuming a game. It sits between the menus
 * (React) and the controller + store, and is plain TypeScript so it can be unit tested with a stub.
 */
import type { StoreApi } from 'zustand/vanilla';
import type { NewGameOptions } from '../../sim';
import type { GameControllerApi } from '../../game/types';
import type { LoadResult, SaveSlotId } from '../../game/save';
import type { MenuView, UiStore } from '../../store';

export type FlowController = Pick<GameControllerApi, 'newGame' | 'loadGame' | 'saveGame' | 'getState' | 'setSpeed' | 'listSaves' | 'deleteSave'>;

export interface GameFlow {
  startNewGame(options: NewGameOptions): void;
  /** Load a slot and, on success, enter the game. Failures leave the screen unchanged (the controller raises a toast). */
  loadSlot(slot: SaveSlotId): LoadResult;
  /** Return from the main menu to the game that is still running behind it. */
  resume(): void;
  /** Autosave, then show the main menu (the game stays resumable). */
  toMainMenu(view?: MenuView): void;
}

export function createGameFlow(controller: FlowController, store: StoreApi<UiStore>): GameFlow {
  return {
    startNewGame(options) {
      controller.newGame(options);
      controller.setSpeed(1);
      store.getState().enterGame();
    },
    loadSlot(slot) {
      const result = controller.loadGame(slot);
      if (result.ok) store.getState().enterGame();
      return result;
    },
    resume() {
      store.getState().resumeGame();
    },
    toMainMenu(view = 'home') {
      const ui = store.getState();
      if (ui.gameStarted && controller.getState().outcome.status !== 'lost') controller.saveGame('autosave');
      ui.showMainMenu(view);
    },
  };
}
