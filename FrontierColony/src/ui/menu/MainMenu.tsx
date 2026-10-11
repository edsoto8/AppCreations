import { useEffect, useMemo, useState } from 'react';
import { useGameController } from '../../game';
import type { SaveSlotInfo } from '../../game/save';
import { uiStore, useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { Panel } from '../components/Panel';
import { formatClock, formatRelativeTime, pluralize } from '../lib/format';
import { useGameFlow } from '../lib/useGameFlow';
import { SaveLoadView } from '../panels/SaveLoadView';
import { NewGameForm } from './NewGameForm';

type View = 'home' | 'newGame' | 'load';

/** The newest readable save across all slots (normally the autosave). */
export function newestSave(slots: SaveSlotInfo[]): SaveSlotInfo | null {
  let best: SaveSlotInfo | null = null;
  for (const s of slots) {
    if (!s.exists || !s.summary || !s.savedAt) continue;
    if (!best || Date.parse(s.savedAt) > Date.parse(best.savedAt ?? '')) best = s;
  }
  return best;
}

/** Title screen over the (paused) demo world: Continue, New Game, Load. */
export function MainMenu() {
  const controller = useGameController();
  const flow = useGameFlow();
  const gameStarted = useUiStore((s) => s.gameStarted);
  const resumeName = useUiStore((s) => s.snapshot?.colonyName ?? null);
  const resumeDay = useUiStore((s) => s.snapshot?.day ?? null);
  // After game over the menu opens straight on New Game or Load; the request is consumed here.
  const [view, setView] = useState<View>(() => uiStore.getState().menuView);
  const [slots, setSlots] = useState<SaveSlotInfo[]>(() => controller.listSaves());
  const newest = useMemo(() => newestSave(slots), [slots]);
  const anySave = slots.some((s) => s.exists);
  const effectiveView: View = view === 'load' && !anySave ? 'home' : view;

  useEffect(() => {
    if (uiStore.getState().menuView !== 'home') uiStore.setState({ menuView: 'home' });
  }, []);

  useEffect(() => {
    if (view === 'home') setSlots(controller.listSaves());
  }, [view, controller]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && view !== 'home') {
        e.preventDefault();
        setView('home');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  const continueSave = () => {
    if (newest) flow.loadSlot(newest.slot);
  };

  return (
    <div className="main-menu" data-testid="main-menu">
      <div className="main-menu__vignette" aria-hidden="true" />
      <div className={`main-menu__content ${effectiveView === 'newGame' ? 'is-wide' : ''}`}>
        <header className="title-block">
          <div className="title-block__emblem" aria-hidden="true">
            <Icon name="compass" size={34} />
          </div>
          <h1 className="title">
            <span className="title__line1">Frontier</span>
            <span className="title__line2">Colony</span>
          </h1>
          <p className="tagline">Found a settlement. Feed it. Survive the winter.</p>
        </header>

        {effectiveView === 'home' && (
          <nav className="menu-card glass" aria-label="Main menu">
            {gameStarted && (
              <button type="button" className="menu-btn menu-btn--primary" onClick={() => flow.resume()} data-testid="menu-resume" data-autofocus>
                <span className="menu-btn__title">Resume game</span>
                <span className="menu-btn__sub">
                  {resumeName}
                  {resumeDay !== null && `, day ${resumeDay}`}
                </span>
              </button>
            )}
            {newest?.summary && (
              <button type="button" className={`menu-btn ${gameStarted ? '' : 'menu-btn--primary'}`} onClick={continueSave} data-testid="menu-continue" data-autofocus={gameStarted ? undefined : true}>
                <span className="menu-btn__title">Continue</span>
                <span className="menu-btn__sub">
                  {newest.summary.colonyName}, day {newest.summary.day} {formatClock(newest.summary.timeOfDay)} · {pluralize(newest.summary.population, 'settler')} ·{' '}
                  {formatRelativeTime(newest.savedAt, Date.now())}
                </span>
              </button>
            )}
            <button
              type="button"
              className={`menu-btn ${!gameStarted && !newest ? 'menu-btn--primary' : ''}`}
              onClick={() => setView('newGame')}
              data-testid="menu-new-game"
              data-autofocus={!gameStarted && !newest ? true : undefined}
            >
              <span className="menu-btn__title">New game</span>
              <span className="menu-btn__sub">Choose a landscape and found a colony</span>
            </button>
            {anySave && (
              <button type="button" className="menu-btn" onClick={() => setView('load')} data-testid="menu-load">
                <span className="menu-btn__title">Load game</span>
                <span className="menu-btn__sub">Autosave and three manual slots</span>
              </button>
            )}
          </nav>
        )}

        {effectiveView === 'newGame' && (
          <div className="menu-card menu-card--wide glass">
            <h2 className="menu-card__title">Found a new colony</h2>
            <NewGameForm onBack={() => setView('home')} />
          </div>
        )}
      </div>

      {effectiveView === 'load' && (
        <Panel title="Load game" icon="folder" placement="center" width={560} onClose={() => setView('home')} testId="panel-load">
          <SaveLoadView mode="load" />
        </Panel>
      )}

      <footer className="main-menu__footer">Frontier Colony · early build</footer>
    </div>
  );
}
