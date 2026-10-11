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

export interface UiActions {
  setScreen(screen: Screen): void;
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
  return createStore<UiStore>()((set) => ({
    ...initialUiState,
    ...initial,
    setScreen: (screen) => set({ screen }),
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
        toasts: [...s.toasts, { id: nextToastId++, message, severity, createdAt: performance.now() }].slice(-MAX_TOASTS),
      })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }));
}

/** The app-wide store instance. */
export const uiStore = createUiStore();

/** React hook: `const speed = useUiStore((s) => s.speed)`. Select narrowly to avoid re-renders. */
export function useUiStore<T>(selector: (state: UiStore) => T): T {
  return useStore(uiStore, selector);
}
