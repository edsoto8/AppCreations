import { UI_SCALES, useUiStore, type PanelId, type UiScale } from '../../store';
import { Switch } from '../components/Switch';
import { RadioCards } from '../menu/RadioCards';
import { PANEL_DEFS, hotkeyFor } from './panelDefs';

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['Space'], action: 'Pause or resume' },
  { keys: ['1', '2', '3'], action: 'Speed 1x, 2x, 4x' },
  { keys: ['Esc'], action: 'Cancel placement, close a panel, or open the game menu' },
  ...(['build', 'settlers', 'priorities', 'events', 'stats', 'saveLoad', 'settings', 'help'] as PanelId[]).map((id) => ({
    keys: [hotkeyFor(id) ?? ''],
    action: `${PANEL_DEFS[id].title} panel`,
  })),
];

/** Settings: interface size, autosave, tooltips, the tutorial, and the keyboard reference. Saved as you change them. */
export function SettingsPanel({ onOpenHelp }: { onOpenHelp?: () => void } = {}) {
  const prefs = useUiStore((s) => s.prefs);
  const setPrefs = useUiStore((s) => s.setPrefs);
  const startTour = useUiStore((s) => s.startTour);
  const screen = useUiStore((s) => s.screen);
  const gameStarted = useUiStore((s) => s.gameStarted);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);

  return (
    <div className="settings" data-testid="settings-panel">
      <h3 className="section-title">Interface</h3>
      <RadioCards<`${UiScale}`>
        name="ui-scale"
        legend="Interface size"
        value={`${prefs.uiScale}`}
        onChange={(v) => setPrefs({ uiScale: Number(v) as UiScale })}
        testIdPrefix="scale"
        options={UI_SCALES.map((s) => ({ value: `${s}` as const, label: `${s}%` }))}
      />
      <div className="settings__switches">
        <Switch label="Show tooltips" hint="Hover hints on buttons, resources and settlers." checked={prefs.showTips} onChange={(showTips) => setPrefs({ showTips })} testId="pref-tips" />
        <Switch label="Autosave" hint="Save at the start of each day and when you leave the page." checked={prefs.autosave} onChange={(autosave) => setPrefs({ autosave })} testId="pref-autosave" />
      </div>

      <h3 className="section-title">Help</h3>
      <div className="settings__buttons">
        <button type="button" className="btn small" onClick={() => (onOpenHelp ? onOpenHelp() : setOpenPanel('help'))} data-testid="open-howto">
          How to play
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setPrefs({ tutorialDone: false });
            if (screen === 'playing' && gameStarted) {
              setOpenPanel(null);
              startTour();
            }
          }}
          data-testid="reset-tutorial"
        >
          Replay the tutorial
        </button>
      </div>

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
    </div>
  );
}
