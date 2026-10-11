/** Keyboard shortcut resolution: pure, so it can be unit tested without a DOM. */
import type { StoreApi } from 'zustand/vanilla';
import type { GameSpeed } from '../../shared/types';
import type { PanelId, UiStore } from '../../store';

export type HotkeyAction =
  | { type: 'togglePause' }
  | { type: 'speed'; speed: GameSpeed }
  | { type: 'escape' }
  | { type: 'panel'; panel: PanelId }
  /** Shift+1..9: pick the Nth building of the catalogue (only while the Build panel or build mode is active). */
  | { type: 'buildSelect'; index: number };

export interface HotkeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  shiftKey?: boolean;
  /** `KeyboardEvent.code`, e.g. 'Digit2' (Shift changes `key` but not `code`). */
  code?: string;
  /** What has keyboard focus: a text field, a button/link/select, or something else. */
  focus: 'editable' | 'button' | 'other';
}

/** Letters avoid W A S D Q E, which the camera may use. */
export const PANEL_HOTKEYS: Record<string, PanelId> = {
  b: 'build',
  t: 'settlers',
  p: 'priorities',
  j: 'events',
  g: 'stats',
  f: 'saveLoad',
  o: 'settings',
};

export const SPEED_HOTKEYS: Record<string, GameSpeed> = { '1': 1, '2': 2, '3': 4 };

/** Which action (if any) a key press means, given the UI state. */
export function resolveHotkey(input: HotkeyInput, ui: Pick<UiStore, 'screen' | 'gameMenuOpen'> & Partial<Pick<UiStore, 'openPanel' | 'buildMode'>>): HotkeyAction | null {
  if (ui.screen !== 'playing') return null;
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.key === 'Escape') return input.focus === 'editable' && input.repeat ? null : { type: 'escape' };
  if (input.focus === 'editable' || ui.gameMenuOpen || input.repeat) return null;
  if (input.shiftKey && input.code && /^Digit[1-9]$/.test(input.code)) {
    return ui.openPanel === 'build' || ui.buildMode ? { type: 'buildSelect', index: Number(input.code.slice(5)) - 1 } : null;
  }
  if (input.key === ' ' || input.key === 'Spacebar') {
    // On a focused button Space means "press it".
    return input.focus === 'button' ? null : { type: 'togglePause' };
  }
  const speed = SPEED_HOTKEYS[input.key];
  if (speed !== undefined) return { type: 'speed', speed };
  const panel = PANEL_HOTKEYS[input.key.toLowerCase()];
  if (panel !== undefined) return { type: 'panel', panel };
  return null;
}

/** `onBuildSelect` maps a catalogue index to a building type (it lives in the UI, so it is injected). */
export function applyHotkey(action: HotkeyAction, store: StoreApi<UiStore>, onBuildSelect?: (index: number) => void): void {
  const ui = store.getState();
  switch (action.type) {
    case 'togglePause':
      ui.togglePause();
      return;
    case 'speed':
      ui.playAtSpeed(action.speed);
      return;
    case 'escape':
      ui.pressEscape();
      return;
    case 'panel':
      ui.togglePanel(action.panel);
      return;
    case 'buildSelect':
      if (onBuildSelect) onBuildSelect(action.index);
      return;
  }
}
