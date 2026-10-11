import { useEffect } from 'react';
import { loadPrefs, savePrefs, uiStore, useUiStore, type PrefsStorage } from '../../store';

function browserStorage(): PrefsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Load preferences once at start and save them whenever they change. */
export function usePrefsSync(): void {
  useEffect(() => {
    const storage = browserStorage();
    uiStore.getState().setPrefs(loadPrefs(storage));
    return uiStore.subscribe((s, prev) => {
      if (s.prefs !== prev.prefs) savePrefs(storage, s.prefs);
    });
  }, []);
}

/** UI scale as a factor (0.9 .. 1.25). */
export function useUiScale(): number {
  return useUiStore((s) => s.prefs.uiScale) / 100;
}
