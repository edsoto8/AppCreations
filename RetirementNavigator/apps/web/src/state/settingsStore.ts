import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'rn-theme';

function readStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Apply a theme preference to <html>. A choice the person makes (`persist`) is mirrored in
 * localStorage so public/theme-init.js avoids a flash; applying the stored or default theme at
 * start-up or on an OS change writes nothing (so "delete all my data" stays deleted).
 */
export function applyTheme(theme: ThemePreference, persist = false): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
  if (!persist) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the theme still applies for this session.
  }
}

interface SettingsState {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

/** Re-apply "system" when the OS theme changes. Returns an unsubscribe function. */
export function followSystemTheme(getTheme: () => ThemePreference): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getTheme() === 'system') applyTheme('system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme, true);
    set({ theme });
  },
}));

/**
 * "Delete all my data": forget the saved theme (the only localStorage key the app owns) and follow
 * the system theme again, without writing the preference back.
 */
export function clearStoredTheme(): void {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was stored.
  }
  document.documentElement.classList.toggle('dark', prefersDark());
  useSettingsStore.setState({ theme: 'system' });
}
