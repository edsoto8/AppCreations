import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY, UI_SCALES, createUiStore, loadPrefs, parsePrefs, savePrefs, type PrefsStorage } from '../../src/store';

const memory = (initial: Record<string, string> = {}): PrefsStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe('preferences', () => {
  it('uses the documented storage key', () => {
    expect(PREFS_KEY).toBe('frontierColony.v1.prefs');
  });

  it('falls back to defaults for missing, corrupt or non-object data', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid fields and replaces invalid ones one by one', () => {
    const p = parsePrefs(JSON.stringify({ uiScale: 125, autosave: false, showTips: 'yes', tutorialDone: true, minimapOpen: 0 }));
    expect(p).toEqual({ ...DEFAULT_PREFS, uiScale: 125, autosave: false, tutorialDone: true });
    expect(parsePrefs(JSON.stringify({ uiScale: 77 })).uiScale).toBe(100);
    for (const s of UI_SCALES) expect(parsePrefs(JSON.stringify({ uiScale: s })).uiScale).toBe(s);
  });

  it('round-trips through storage and tolerates a storage that throws', () => {
    const storage = memory();
    savePrefs(storage, { ...DEFAULT_PREFS, uiScale: 90, minimapOpen: false });
    expect(loadPrefs(storage)).toMatchObject({ uiScale: 90, minimapOpen: false });
    const broken: PrefsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(broken, DEFAULT_PREFS)).not.toThrow();
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('updates preferences in the store, merging patches', () => {
    const store = createUiStore();
    store.getState().setPrefs({ uiScale: 110 });
    store.getState().setPrefs({ autosave: false });
    expect(store.getState().prefs).toEqual({ ...DEFAULT_PREFS, uiScale: 110, autosave: false });
  });
});

describe('tutorial state', () => {
  it('starts at step 0, moves, and ending marks it done', () => {
    const store = createUiStore();
    expect(store.getState().tourStep).toBeNull();
    store.getState().startTour();
    store.getState().setTourStep(3);
    expect(store.getState().tourStep).toBe(3);
    store.getState().endTour();
    expect(store.getState()).toMatchObject({ tourStep: null });
    expect(store.getState().prefs.tutorialDone).toBe(true);
  });
});
