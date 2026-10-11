/**
 * Zustand store for UI state. It holds the player's *intent* (speed, pause, selection, build mode,
 * overlay, open panel) plus the throttled HUD snapshot and toasts. It never holds GameState.
 *
 * Data flow:
 *  - React components read with `useUiStore(selector)` and write with the actions below.
 *  - The GameController subscribes to the store and applies intent: speed/pause drive the loop,
 *    selection/buildMode/overlay are forwarded to the renderer.
 *  - The GameController writes `snapshot`, `hoverTile` and toasts.
 *  - Game-changing actions (place building, save, load, ...) go through the controller
 *    (`useGameController()`), not through the store.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { BuildingType, LogSeverity, TilePos } from '../sim';
import type { GameSpeed, OverlayMode, Selection } from '../shared/types';
import type { HudSnapshot } from './snapshot';

export type Screen = 'mainMenu' | 'playing';
/** Which view the main menu opens on (set by `showMainMenu`, e.g. after game over). */
export type MenuView = 'home' | 'newGame' | 'load';
export type PanelId = 'build' | 'settlers' | 'priorities' | 'events' | 'stats' | 'saveLoad' | 'settings';

export interface Toast {
  id: number;
  message: string;
  severity: LogSeverity;
  /** performance.now() when created; the UI auto-dismisses after its own timeout. */
  createdAt: number;
}

export interface UiState {
  screen: Screen;
  /**
   * True once a game has been started or loaded in this page session. The main menu offers
   * "Resume" only then, and the controller should only autosave on page hide when this is true
   * (otherwise the placeholder demo world would overwrite the player's real autosave).
   */
  gameStarted: boolean;
  /** The Esc game menu (resume / save-load / main menu) is open. */
  gameMenuOpen: boolean;
  /** Pause flag to restore when the game menu closes. */
  pausedBeforeMenu: boolean;
  /** The view the main menu should open on next. */
  menuView: MenuView;
  /** Id of the newest event-log entry the player has seen (drives the unread badge); null until first measured. */
  eventsSeenId: number | null;
  speed: GameSpeed;
  paused: boolean;
  selection: Selection | null;
  /** Building type being placed, or null when not in build mode. */
  buildMode: BuildingType | null;
  hoverTile: TilePos | null;
  overlay: OverlayMode;
  openPanel: PanelId | null;
  snapshot: HudSnapshot | null;
  toasts: Toast[];
}

/** What a press of Escape did (see `pressEscape`). */
export type EscapeResult = 'closedGameMenu' | 'closedPanel' | 'cancelledBuild' | 'clearedSelection' | 'openedGameMenu' | 'none';

export interface UiActions {
  setScreen(screen: Screen): void;
  /** Go to the main menu: pauses the game and closes menus/panels/build mode. The game stays resumable. */
  showMainMenu(view?: MenuView): void;
  /** Record the newest log id the player has seen. Never moves backwards except to a smaller id after a new game (pass `force`). */
  markEventsSeen(id: number, force?: boolean): void;
  /** Switch to the in-game screen after a game was started or loaded (the controller sets the pause flag). */
  enterGame(): void;
  /** Leave the main menu for the game that is still running behind it, restoring its pause flag. */
  resumeGame(): void;
  /** Choose a speed and unpause. */
  playAtSpeed(speed: GameSpeed): void;
  openGameMenu(): void;
  /** Close the game menu; restores the pause flag it saved unless `restorePause` is false. */
  closeGameMenu(restorePause?: boolean): void;
  /**
   * Escape key: closes the game menu, else cancels build mode, else closes the open panel, else clears the
   * selection, else opens the game menu. Does nothing on the main menu.
   */
  pressEscape(): EscapeResult;
  setSpeed(speed: GameSpeed): void;
  setPaused(paused: boolean): void;
  togglePause(): void;
  select(selection: Selection | null): void;
  /** Entering build mode clears the selection. */
  setBuildMode(type: BuildingType | null): void;
  setHoverTile(tile: TilePos | null): void;
  setOverlay(overlay: OverlayMode): void;
  setOpenPanel(panel: PanelId | null): void;
  togglePanel(panel: PanelId): void;
  setSnapshot(snapshot: HudSnapshot | null): void;
  pushToast(message: string, severity?: LogSeverity): void;
  dismissToast(id: number): void;
}

export type UiStore = UiState & UiActions;

/** Max toasts kept; older ones are dropped. */
export const MAX_TOASTS = 5;

export const initialUiState: UiState = {
  screen: 'playing',
  gameStarted: true,
  gameMenuOpen: false,
  pausedBeforeMenu: false,
  menuView: 'home',
  eventsSeenId: null,
  speed: 1,
  paused: false,
  selection: null,
  buildMode: null,
  hoverTile: null,
  overlay: 'none',
  openPanel: null,
  snapshot: null,
  toasts: [],
};

/** Create an independent store (tests create their own; the app uses `uiStore`). */
export function createUiStore(initial: Partial<UiState> = {}): StoreApi<UiStore> {
  let nextToastId = 1;
  return createStore<UiStore>()((set, get) => ({
    ...initialUiState,
    ...initial,
    setScreen: (screen) => set({ screen }),
    markEventsSeen: (id, force = false) => set((s) => (force || s.eventsSeenId === null || id > s.eventsSeenId ? { eventsSeenId: id } : s)),
    showMainMenu: (view = 'home') =>
      set((s) => ({
        screen: 'mainMenu',
        menuView: view,
        // Keep the pause state from before the game menu so "Resume" returns to what the player had.
        paused: true,
        pausedBeforeMenu: s.gameMenuOpen ? s.pausedBeforeMenu : s.paused,
        gameMenuOpen: false,
        openPanel: null,
        buildMode: null,
        selection: null,
      })),
    enterGame: () =>
      set({ screen: 'playing', gameStarted: true, gameMenuOpen: false, openPanel: null, buildMode: null, eventsSeenId: null }),
    resumeGame: () => set((s) => ({ screen: 'playing', paused: s.pausedBeforeMenu })),
    playAtSpeed: (speed) => set({ speed, paused: false }),
    openGameMenu: () =>
      set((s) =>
        s.gameMenuOpen || s.screen !== 'playing'
          ? s
          : { gameMenuOpen: true, pausedBeforeMenu: s.paused, paused: true, buildMode: null },
      ),
    closeGameMenu: (restorePause = true) =>
      set((s) => (s.gameMenuOpen ? { gameMenuOpen: false, paused: restorePause ? s.pausedBeforeMenu : s.paused } : s)),
    pressEscape: () => {
      const s = get();
      if (s.screen !== 'playing') return 'none';
      if (s.gameMenuOpen) {
        s.closeGameMenu();
        return 'closedGameMenu';
      }
      if (s.buildMode) {
        set({ buildMode: null });
        return 'cancelledBuild';
      }
      if (s.openPanel) {
        set({ openPanel: null });
        return 'closedPanel';
      }
      if (s.selection) {
        set({ selection: null });
        return 'clearedSelection';
      }
      s.openGameMenu();
      return 'openedGameMenu';
    },
    setSpeed: (speed) => set({ speed }),
    setPaused: (paused) => set({ paused }),
    togglePause: () => set((s) => ({ paused: !s.paused })),
    select: (selection) => set({ selection }),
    setBuildMode: (buildMode) => set(buildMode ? { buildMode, selection: null } : { buildMode }),
    setHoverTile: (hoverTile) => set({ hoverTile }),
    setOverlay: (overlay) => set({ overlay }),
    setOpenPanel: (openPanel) => set({ openPanel }),
    togglePanel: (panel) => set((s) => ({ openPanel: s.openPanel === panel ? null : panel })),
    setSnapshot: (snapshot) => set({ snapshot }),
    pushToast: (message, severity = 'info') =>
      set((s) => ({
        // An identical toast already on screen is replaced (moved to the end with a fresh timer), so
        // a repeated failure does not stack up copies.
        toasts: [
          ...s.toasts.filter((t) => t.message !== message || t.severity !== severity),
          { id: nextToastId++, message, severity, createdAt: performance.now() },
        ].slice(-MAX_TOASTS),
      })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }));
}

/**
 * The app-wide store instance. The app boots on the main menu with the (demo) world paused behind it;
 * tests that call `createUiStore()` get the in-game defaults instead.
 */
export const uiStore = createUiStore({ screen: 'mainMenu', gameStarted: false, paused: true });

/** React hook: `const speed = useUiStore((s) => s.speed)`. Select narrowly to avoid re-renders. */
export function useUiStore<T>(selector: (state: UiStore) => T): T {
  return useStore(uiStore, selector);
}
