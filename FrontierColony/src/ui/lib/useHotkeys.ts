import { useEffect } from 'react';
import { uiStore } from '../../store';
import { CATALOGUE } from '../panels/BuildPanel';
import { applyHotkey, resolveHotkey, type HotkeyInput } from './hotkeys';

function focusKind(el: Element | null): HotkeyInput['focus'] {
  if (!(el instanceof HTMLElement)) return 'other';
  if (el.isContentEditable || el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select')) return 'editable';
  if (el.matches('button, a[href], summary, [role="button"], input[type="checkbox"], input[type="radio"]')) return 'button';
  return 'other';
}

/**
 * Global keyboard shortcuts (see hotkeys.ts). Also drops keyboard focus from buttons after a mouse
 * click, so Space keeps meaning "pause" instead of re-pressing the last clicked button.
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = resolveHotkey(
        { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat, shiftKey: e.shiftKey, code: e.code, focus: focusKind(document.activeElement) },
        uiStore.getState(),
      );
      if (!action) return;
      e.preventDefault();
      applyHotkey(action, uiStore, (index) => {
        const type = CATALOGUE[index];
        const unlocked = uiStore.getState().snapshot?.progress.unlocked;
        if (type && (!unlocked || unlocked.includes(type))) uiStore.getState().setBuildMode(type);
      });
    };
    const onClick = (e: MouseEvent) => {
      // detail === 0 means the click came from the keyboard (Enter/Space): keep focus there.
      if (e.detail === 0 || !(e.target instanceof Element)) return;
      const button = e.target.closest('button');
      if (button && !button.closest('[data-keep-focus]')) button.blur();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    };
  }, []);
}
