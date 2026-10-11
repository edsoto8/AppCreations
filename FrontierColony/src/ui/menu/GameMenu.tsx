import { useEffect, useState } from 'react';
import { useUiStore } from '../../store';
import { Icon, type IconName } from '../components/Icon';
import { Panel } from '../components/Panel';
import { useGameFlow } from '../lib/useGameFlow';
import { SaveLoadView } from '../panels/SaveLoadView';
import { SettingsPanel } from '../panels/SettingsPanel';

type View = 'main' | 'saveLoad' | 'settings' | 'confirmQuit';

const TITLES: Record<View, string> = { main: 'Game menu', saveLoad: 'Save & Load', settings: 'Settings', confirmQuit: 'Game menu' };

/** The Esc menu: resume, save/load, settings, main menu. The game is paused while it is open. */
export function GameMenu() {
  const open = useUiStore((s) => s.gameMenuOpen);
  if (!open) return null;
  return <GameMenuDialog />;
}

function GameMenuDialog() {
  const [view, setView] = useState<View>('main');
  const closeGameMenu = useUiStore((s) => s.closeGameMenu);
  const colony = useUiStore((s) => s.snapshot?.colonyName ?? '');
  const day = useUiStore((s) => s.snapshot?.day ?? 1);
  const flow = useGameFlow();

  // Escape steps back out of a sub-view before it closes the whole menu. This runs in the capture phase
  // on document, which is before the global hotkey listener on window sees the event.
  useEffect(() => {
    if (view === 'main') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setView('main');
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [view]);

  const item = (icon: IconName, title: string, sub: string, onClick: () => void, testId: string, primary = false) => (
    <button type="button" className={`menu-btn ${primary ? 'menu-btn--primary' : ''}`} onClick={onClick} data-testid={testId} data-autofocus={primary ? true : undefined}>
      <Icon name={icon} size={22} className="menu-btn__icon" />
      <span className="menu-btn__text">
        <span className="menu-btn__title">{title}</span>
        <span className="menu-btn__sub">{sub}</span>
      </span>
    </button>
  );

  return (
    <Panel
      key={view}
      title={TITLES[view]}
      icon="flag"
      placement="center"
      width={view === 'saveLoad' ? 560 : view === 'settings' ? 520 : 400}
      onClose={() => closeGameMenu()}
      testId="game-menu"
      actions={
        view !== 'main' && (
          <button type="button" className="btn ghost small" onClick={() => setView('main')} data-testid="game-menu-back">
            <Icon name="back" size={14} /> Back
          </button>
        )
      }
    >
      {view === 'main' && (
        <div className="game-menu">
          <p className="game-menu__sub">
            {colony}, day {day}
          </p>
          {item('play1', 'Resume', 'Back to the colony', () => closeGameMenu(), 'game-menu-resume', true)}
          {item('save', 'Save / Load', 'Manage your saved games', () => setView('saveLoad'), 'game-menu-saveload')}
          {item('settings', 'Settings', 'Keyboard shortcuts and options', () => setView('settings'), 'game-menu-settings')}
          {item('home', 'Main menu', 'Autosaves, then leaves the colony', () => setView('confirmQuit'), 'game-menu-quit')}
        </div>
      )}
      {view === 'confirmQuit' && (
        <div className="game-menu" data-testid="confirm-quit">
          <p>Return to the main menu? The colony is autosaved first, so you can pick it up again with Continue.</p>
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => setView('main')} data-testid="quit-cancel" data-autofocus>
              Stay
            </button>
            <button type="button" className="btn primary" onClick={() => flow.toMainMenu()} data-testid="quit-confirm">
              Leave to main menu
            </button>
          </div>
        </div>
      )}
      {view === 'saveLoad' && <SaveLoadView mode="both" onLoaded={() => closeGameMenu(false)} />}
      {view === 'settings' && <SettingsPanel />}
    </Panel>
  );
}
