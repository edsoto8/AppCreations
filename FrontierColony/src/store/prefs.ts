/** Player preferences, persisted as JSON under one localStorage key. Pure helpers: storage is passed in. */

export const PREFS_KEY = 'frontierColony.v1.prefs';

export const UI_SCALES = [90, 100, 110, 125] as const;
export type UiScale = (typeof UI_SCALES)[number];

export interface Prefs {
  /** Interface size in percent. */
  uiScale: UiScale;
  /** Autosave at each new day and when the page is hidden. */
  autosave: boolean;
  /** Show hover tooltips. */
  showTips: boolean;
  /** The first-game tutorial has been finished or skipped. */
  tutorialDone: boolean;
  /** The minimap is expanded. */
  minimapOpen: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  uiScale: 100,
  autosave: true,
  showTips: true,
  tutorialDone: false,
  minimapOpen: true,
};

export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Parse stored JSON, keeping every valid field and falling back to the default for anything else. */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return { ...DEFAULT_PREFS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (typeof data !== 'object' || data === null) return { ...DEFAULT_PREFS };
  const o = data as Record<string, unknown>;
  const bool = (k: keyof Prefs, d: boolean): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d);
  return {
    uiScale: (UI_SCALES as readonly unknown[]).includes(o.uiScale) ? (o.uiScale as UiScale) : DEFAULT_PREFS.uiScale,
    autosave: bool('autosave', DEFAULT_PREFS.autosave),
    showTips: bool('showTips', DEFAULT_PREFS.showTips),
    tutorialDone: bool('tutorialDone', DEFAULT_PREFS.tutorialDone),
    minimapOpen: bool('minimapOpen', DEFAULT_PREFS.minimapOpen),
  };
}

export function loadPrefs(storage: PrefsStorage | null): Prefs {
  try {
    return parsePrefs(storage ? storage.getItem(PREFS_KEY) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Best effort: storage may be full or blocked, in which case preferences last for this session only. */
export function savePrefs(storage: PrefsStorage | null, prefs: Prefs): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore: the UI keeps working with in-memory preferences.
  }
}
