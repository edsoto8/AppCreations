import { describe, expect, it } from 'vitest';
import { createUiStore } from '../../src/store';
import { ErrorBoundary } from '../../src/ui/components/ErrorBoundary';
import { clearSavedData, type EnumerableStorage } from '../../src/ui/lib/recovery';
import { resolveHotkey } from '../../src/ui/lib/hotkeys';
import { hasMoodletLabel, moodletLabel } from '../../src/ui/lib/settlerInfo';

function fakeStorage(entries: Record<string, string>): EnumerableStorage & { data: Record<string, string> } {
  const data = { ...entries };
  return {
    data,
    get length() {
      return Object.keys(data).length;
    },
    key: (i) => Object.keys(data)[i] ?? null,
    removeItem: (k) => void delete data[k],
  };
}

describe('crash recovery', () => {
  it('turns a render error into state for the recovery screen', () => {
    const err = new Error('bad summary');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('clears only frontierColony.* keys', () => {
    const storage = fakeStorage({
      'frontierColony.v1.save.autosave': '{}',
      'frontierColony.v1.save.slot1': '{}',
      'frontierColony.v1.prefs': '{}',
      'someOtherApp.key': 'keep',
      frontierColonyLookalike: 'keep',
    });
    const removed = clearSavedData(storage);
    expect(removed.sort()).toEqual(['frontierColony.v1.prefs', 'frontierColony.v1.save.autosave', 'frontierColony.v1.save.slot1']);
    expect(Object.keys(storage.data).sort()).toEqual(['frontierColonyLookalike', 'someOtherApp.key']);
  });

  it('survives missing or throwing storage', () => {
    expect(clearSavedData(null)).toEqual([]);
    const broken: EnumerableStorage = {
      length: 1,
      key: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(() => clearSavedData(broken)).not.toThrow();
  });
});

describe('halted simulation', () => {
  it('is a store flag that new games clear', () => {
    const store = createUiStore();
    expect(store.getState().simHalted).toBe(false);
    store.getState().setSimHalted(true);
    expect(store.getState().simHalted).toBe(true);
    store.getState().enterGame();
    expect(store.getState().simHalted).toBe(false);
  });

  it('ignores pause and speed keys but not panels or Escape', () => {
    const base = { ctrlKey: false, metaKey: false, altKey: false, repeat: false, focus: 'other' as const };
    const ui = { screen: 'playing', gameMenuOpen: false, simHalted: true } as const;
    expect(resolveHotkey({ ...base, key: ' ' }, ui)).toBeNull();
    expect(resolveHotkey({ ...base, key: '2' }, ui)).toBeNull();
    expect(resolveHotkey({ ...base, key: 'f' }, ui)).toEqual({ type: 'panel', panel: 'saveLoad' });
    expect(resolveHotkey({ ...base, key: 'Escape' }, ui)).toEqual({ type: 'escape' });
    expect(resolveHotkey({ ...base, key: ' ' }, { ...ui, simHalted: false })).toEqual({ type: 'togglePause' });
  });
});

describe('moodlet labels use own properties only', () => {
  it('does not treat Object.prototype names as known labels', () => {
    expect(hasMoodletLabel('hungry')).toBe(true);
    for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) expect(hasMoodletLabel(id)).toBe(false);
    expect(moodletLabel('constructor')).toBe('Constructor');
  });
});
