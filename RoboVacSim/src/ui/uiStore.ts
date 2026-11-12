import { create } from 'zustand';

/** Dashboard-only state that the AppController never needs (kept out of the shared store). */
export interface LocalUiState {
  helpOpen: boolean;
  /** 2D map card size on wide screens. */
  mapSize: 'collapsed' | 'normal' | 'large';
  /** Bottom-sheet tab on narrow screens (store.sidebarTab is used for the shared tabs). */
  mobileTab: 'controls' | 'map' | 'stats' | 'log';
  sheetOpen: boolean;
  set: (patch: Partial<LocalUiState>) => void;
}

export const useUi = create<LocalUiState>((set) => ({
  helpOpen: false,
  mapSize: 'normal',
  mobileTab: 'controls',
  sheetOpen: true,
  set: (patch) => set(patch),
}));
