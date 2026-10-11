import { PANEL_DEFS, hotkeyFor } from './panelDefs';
import type { PanelId } from '../../store';

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['Space'], action: 'Pause or resume' },
  { keys: ['1', '2', '3'], action: 'Speed 1x, 2x, 4x' },
  { keys: ['Esc'], action: 'Close panel, cancel placement, or open the game menu' },
  ...(['build', 'settlers', 'priorities', 'events', 'saveLoad', 'settings'] as PanelId[]).map((id) => ({
    keys: [hotkeyFor(id) ?? ''],
    action: `${PANEL_DEFS[id].title} panel`,
  })),
];

/** Settings: keyboard reference now; display and audio options arrive with the polish milestone (M6). */
export function SettingsPanel() {
  return (
    <div className="settings" data-testid="settings-panel">
      <h3 className="section-title">Keyboard shortcuts</h3>
      <dl className="shortcut-list">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="shortcut">
            <dt>
              {s.keys.map((k) => (
                <span key={k} className="kbd">
                  {k}
                </span>
              ))}
            </dt>
            <dd>{s.action}</dd>
          </div>
        ))}
      </dl>
      <h3 className="section-title">Display and audio</h3>
      <p className="muted">Quality, volume and accessibility options are coming in M6.</p>
    </div>
  );
}
