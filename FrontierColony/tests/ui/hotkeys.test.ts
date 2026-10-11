import { describe, expect, it } from 'vitest';
import { createUiStore } from '../../src/store';
import { applyHotkey, resolveHotkey, type HotkeyInput } from '../../src/ui/lib/hotkeys';

const key = (k: string, extra: Partial<HotkeyInput> = {}): HotkeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  focus: 'other',
  ...extra,
});
const playing = { screen: 'playing', gameMenuOpen: false } as const;

describe('resolveHotkey', () => {
  it('maps Space, 1/2/3 and panel letters', () => {
    expect(resolveHotkey(key(' '), playing)).toEqual({ type: 'togglePause' });
    expect(resolveHotkey(key('1'), playing)).toEqual({ type: 'speed', speed: 1 });
    expect(resolveHotkey(key('2'), playing)).toEqual({ type: 'speed', speed: 2 });
    expect(resolveHotkey(key('3'), playing)).toEqual({ type: 'speed', speed: 4 });
    expect(resolveHotkey(key('b'), playing)).toEqual({ type: 'panel', panel: 'build' });
    expect(resolveHotkey(key('B'), playing)).toEqual({ type: 'panel', panel: 'build' });
    expect(resolveHotkey(key('f'), playing)).toEqual({ type: 'panel', panel: 'saveLoad' });
    expect(resolveHotkey(key('Escape'), playing)).toEqual({ type: 'escape' });
  });

  it('leaves camera keys alone', () => {
    for (const k of ['w', 'a', 's', 'd', 'q', 'e', 'ArrowUp', 'Enter']) expect(resolveHotkey(key(k), playing)).toBeNull();
  });

  it('ignores everything on the main menu', () => {
    const menu = { screen: 'mainMenu', gameMenuOpen: false } as const;
    expect(resolveHotkey(key(' '), menu)).toBeNull();
    expect(resolveHotkey(key('Escape'), menu)).toBeNull();
  });

  it('ignores shortcuts while typing, but still lets Escape through', () => {
    expect(resolveHotkey(key('1', { focus: 'editable' }), playing)).toBeNull();
    expect(resolveHotkey(key('Escape', { focus: 'editable' }), playing)).toEqual({ type: 'escape' });
  });

  it('lets Space press a focused button instead of pausing', () => {
    expect(resolveHotkey(key(' ', { focus: 'button' }), playing)).toBeNull();
    expect(resolveHotkey(key('1', { focus: 'button' }), playing)).toEqual({ type: 'speed', speed: 1 });
  });

  it('only Escape works while the game menu is open', () => {
    const open = { screen: 'playing', gameMenuOpen: true } as const;
    expect(resolveHotkey(key(' '), open)).toBeNull();
    expect(resolveHotkey(key('b'), open)).toBeNull();
    expect(resolveHotkey(key('Escape'), open)).toEqual({ type: 'escape' });
  });

  it('ignores modified keys and auto-repeat', () => {
    expect(resolveHotkey(key('b', { ctrlKey: true }), playing)).toBeNull();
    expect(resolveHotkey(key('1', { metaKey: true }), playing)).toBeNull();
    expect(resolveHotkey(key(' ', { repeat: true }), playing)).toBeNull();
  });
});

describe('applyHotkey', () => {
  it('drives the store', () => {
    const store = createUiStore();
    applyHotkey({ type: 'togglePause' }, store);
    expect(store.getState().paused).toBe(true);
    applyHotkey({ type: 'speed', speed: 4 }, store);
    expect(store.getState()).toMatchObject({ speed: 4, paused: false });
    applyHotkey({ type: 'panel', panel: 'events' }, store);
    expect(store.getState().openPanel).toBe('events');
    applyHotkey({ type: 'panel', panel: 'events' }, store);
    expect(store.getState().openPanel).toBeNull();
    applyHotkey({ type: 'escape' }, store);
    expect(store.getState().gameMenuOpen).toBe(true);
  });
});

describe('build quick-select', () => {
  const withKey = (input: Partial<HotkeyInput>) => key('!', { shiftKey: true, code: 'Digit1', ...input });

  it('selects the Nth building with Shift+digit while the build panel is open or placing', () => {
    expect(resolveHotkey(withKey({}), { ...playing, openPanel: 'build' })).toEqual({ type: 'buildSelect', index: 0 });
    expect(resolveHotkey(withKey({ code: 'Digit4' }), { ...playing, buildMode: 'farm' })).toEqual({ type: 'buildSelect', index: 3 });
  });

  it('does nothing outside the build context, and plain digits still change speed', () => {
    expect(resolveHotkey(withKey({}), playing)).toBeNull();
    expect(resolveHotkey(withKey({}), { ...playing, openPanel: 'settlers' })).toBeNull();
    expect(resolveHotkey(key('2', { code: 'Digit2' }), { ...playing, openPanel: 'build' })).toEqual({ type: 'speed', speed: 2 });
  });

  it('hands the index to the injected handler', () => {
    const store = createUiStore();
    const picked: number[] = [];
    applyHotkey({ type: 'buildSelect', index: 2 }, store, (i) => picked.push(i));
    expect(picked).toEqual([2]);
  });
});
