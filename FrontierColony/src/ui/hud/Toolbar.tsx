import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import { TOOLBAR_PANELS, hotkeyFor } from '../panels/panelDefs';

/** Bottom dock with one button per panel, plus the game menu. */
export function Toolbar() {
  const { openPanel, buildMode } = useUiStore(useShallow((s) => ({ openPanel: s.openPanel, buildMode: s.buildMode })));
  const togglePanel = useUiStore((s) => s.togglePanel);
  const openGameMenu = useUiStore((s) => s.openGameMenu);

  return (
    <nav className="toolbar glass" aria-label="Panels" data-testid="toolbar">
      {TOOLBAR_PANELS.map((def) => {
        const key = hotkeyFor(def.id);
        const active = openPanel === def.id;
        return (
          <Tooltip
            key={def.id}
            side="top"
            title={def.title}
            content={
              <>
                <p>{def.blurb}</p>
                {key && (
                  <p>
                    Shortcut: <span className="kbd">{key}</span>
                  </p>
                )}
              </>
            }
          >
            <button
              type="button"
              className={`tool-btn ${active ? 'is-active' : ''} ${def.id === 'build' && buildMode ? 'is-building' : ''}`}
              aria-pressed={active}
              onClick={() => togglePanel(def.id)}
              data-testid={`tool-${def.id}`}
            >
              <Icon name={def.icon} size={22} />
              <span className="tool-btn__label">{def.short}</span>
              {key && <span className="tool-btn__key">{key}</span>}
            </button>
          </Tooltip>
        );
      })}
      <span className="toolbar__divider" aria-hidden="true" />
      <Tooltip
        side="top"
        title="Game menu"
        content={
          <>
            <p>Resume, save, load, or return to the main menu.</p>
            <p>
              Shortcut: <span className="kbd">Esc</span>
            </p>
          </>
        }
      >
        <button type="button" className="tool-btn" onClick={() => openGameMenu()} data-testid="open-menu">
          <Icon name="flag" size={22} />
          <span className="tool-btn__label">Menu</span>
          <span className="tool-btn__key">Esc</span>
        </button>
      </Tooltip>
    </nav>
  );
}
