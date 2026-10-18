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

/** Apply a theme preference to <html>. Mirrored in localStorage so public/theme-init.js avoids a flash. */
export function applyTheme(theme: ThemePreference): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
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

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
