/** Public surface of the game controller, as used by the React UI (via useGameController). */
import type { CommandResult, GameState, NewGameOptions, PlayerCommand, TilePos } from '../sim';
import type { GameSpeed } from '../shared/types';
import type { LoadResult, SaveResult, SaveSlotId, SaveSlotInfo } from './save';

export interface GameControllerApi {
  /** Current state — read-only for callers; prefer the store snapshot in React components. */
  getState(): Readonly<GameState>;
  newGame(options: NewGameOptions): void;
  /** Apply a player command now (between ticks). Failures also raise a toast. */
  dispatch(command: PlayerCommand): CommandResult;
  setSpeed(speed: GameSpeed): void;
  setPaused(paused: boolean): void;
  togglePause(): void;
  saveGame(slot: SaveSlotId): SaveResult;
  loadGame(slot: SaveSlotId): LoadResult;
  listSaves(): SaveSlotInfo[];
  deleteSave(slot: SaveSlotId): void;
  /** Move the camera to a world point in tile units. */
  centerOn(tile: TilePos | { x: number; y: number }): void;
  zoomBy(factor: number): void;
  /** Run n ticks immediately regardless of pause (debug / tests). */
  advanceTicks(n: number): void;
}
