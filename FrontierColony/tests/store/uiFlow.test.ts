import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, createUiStore, uiStore } from '../../src/store';

describe('app store boot state', () => {
  it('starts on the main menu, paused, with no game started', () => {
    const s = uiStore.getState();
    expect(s.screen).toBe('mainMenu');
    expect(s.paused).toBe(true);
    expect(s.gameStarted).toBe(false);
  });
});

describe('game menu and pause', () => {
  it('pauses while open and restores the previous pause flag on close', () => {
    const store = createUiStore();
    store.getState().openGameMenu();
    expect(store.getState()).toMatchObject({ gameMenuOpen: true, paused: true, pausedBeforeMenu: false });
    store.getState().closeGameMenu();
    expect(store.getState()).toMatchObject({ gameMenuOpen: false, paused: false });

    store.getState().setPaused(true);
    store.getState().openGameMenu();
    store.getState().closeGameMenu();
    expect(store.getState().paused).toBe(true);
  });

  it('keeps the pause flag the controller set when closing without restoring (after a load)', () => {
    const store = createUiStore();
    store.getState().openGameMenu();
    store.getState().setPaused(false); // what the controller does when it loads a game
    store.getState().closeGameMenu(false);
    expect(store.getState().paused).toBe(false);
  });

  it('opening twice does not overwrite the saved pause flag', () => {
    const store = createUiStore();
    store.getState().openGameMenu();
    store.getState().openGameMenu();
    store.getState().closeGameMenu();
    expect(store.getState().paused).toBe(false);
  });

  it('does not open on the main menu', () => {
    const store = createUiStore({ screen: 'mainMenu' });
    store.getState().openGameMenu();
    expect(store.getState().gameMenuOpen).toBe(false);
  });
});

describe('pressEscape', () => {
  it('peels off one layer per press: menu, build mode, panel, selection, then opens the menu', () => {
    const store = createUiStore();
    const s = () => store.getState();

    s().openGameMenu();
    s().setOpenPanel('build');
    expect(s().pressEscape()).toBe('closedGameMenu');
    expect(s().gameMenuOpen).toBe(false);
    expect(s().openPanel).toBe('build');

    // While placing, Esc cancels the placement first and leaves the Build panel open to pick again.
    s().setBuildMode('farm');
    expect(s().pressEscape()).toBe('cancelledBuild');
    expect(s().buildMode).toBeNull();
    expect(s().openPanel).toBe('build');

    expect(s().pressEscape()).toBe('closedPanel');
    expect(s().openPanel).toBeNull();

    s().select({ kind: 'tile', x: 1, y: 2 });
    expect(s().pressEscape()).toBe('clearedSelection');
    expect(s().selection).toBeNull();

    expect(s().pressEscape()).toBe('openedGameMenu');
    expect(s().gameMenuOpen).toBe(true);
    expect(s().paused).toBe(true);
  });

  it('does nothing on the main menu', () => {
    const store = createUiStore({ screen: 'mainMenu' });
    expect(store.getState().pressEscape()).toBe('none');
    expect(store.getState().gameMenuOpen).toBe(false);
  });
});

describe('screen transitions', () => {
  it('showMainMenu pauses, closes overlays and remembers the pause flag for Resume', () => {
    const store = createUiStore();
    store.getState().setOpenPanel('settlers');
    store.getState().setBuildMode('house');
    store.getState().showMainMenu();
    expect(store.getState()).toMatchObject({ screen: 'mainMenu', paused: true, openPanel: null, buildMode: null, gameMenuOpen: false });
    store.getState().resumeGame();
    expect(store.getState()).toMatchObject({ screen: 'playing', paused: false });
  });

  it('showMainMenu from the game menu resumes into the pause state from before the menu', () => {
    const store = createUiStore();
    store.getState().setPaused(true);
    store.getState().openGameMenu();
    store.getState().showMainMenu();
    store.getState().resumeGame();
    expect(store.getState().paused).toBe(true);
  });

  it('enterGame marks the game started and clears overlays', () => {
    const store = createUiStore({ screen: 'mainMenu', gameStarted: false, paused: true });
    store.getState().enterGame();
    expect(store.getState()).toMatchObject({ screen: 'playing', gameStarted: true, gameMenuOpen: false, openPanel: null });
  });

  it('playAtSpeed sets the speed and unpauses', () => {
    const store = createUiStore({ paused: true });
    store.getState().playAtSpeed(4);
    expect(store.getState()).toMatchObject({ speed: 4, paused: false });
  });
});

describe('toasts', () => {
  it('replaces an identical toast instead of stacking copies', () => {
    const store = createUiStore();
    store.getState().pushToast('Not enough wood.', 'warning');
    store.getState().pushToast('Other', 'info');
    store.getState().pushToast('Not enough wood.', 'warning');
    const toasts = store.getState().toasts;
    expect(toasts.map((t) => t.message)).toEqual(['Other', 'Not enough wood.']);
  });

  it('keeps distinct severities apart and still caps the stack', () => {
    const store = createUiStore();
    store.getState().pushToast('x', 'info');
    store.getState().pushToast('x', 'danger');
    expect(store.getState().toasts).toHaveLength(2);
    for (let i = 0; i < MAX_TOASTS + 2; i++) store.getState().pushToast(`m${i}`);
    expect(store.getState().toasts).toHaveLength(MAX_TOASTS);
  });
});

describe('main menu view and unread events', () => {
  it('opens the main menu on the requested view', () => {
    const store = createUiStore();
    store.getState().showMainMenu('newGame');
    expect(store.getState()).toMatchObject({ screen: 'mainMenu', menuView: 'newGame', paused: true });
    store.getState().showMainMenu();
    expect(store.getState().menuView).toBe('home');
  });

  it('tracks the newest seen log id, only moving forward unless forced', () => {
    const store = createUiStore();
    expect(store.getState().eventsSeenId).toBeNull();
    store.getState().markEventsSeen(5);
    store.getState().markEventsSeen(3);
    expect(store.getState().eventsSeenId).toBe(5);
    store.getState().markEventsSeen(2, true);
    expect(store.getState().eventsSeenId).toBe(2);
  });

  it('forgets what was seen when a new game or load starts', () => {
    const store = createUiStore();
    store.getState().markEventsSeen(40);
    store.getState().enterGame();
    expect(store.getState().eventsSeenId).toBeNull();
  });
});
