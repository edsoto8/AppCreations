import { useUiStore, type PanelId } from '../../store';
import { Panel } from '../components/Panel';
import { BuildPanel } from './BuildPanel';
import { SettlersPanel } from './SettlersPanel';
import { PlaceholderPanel } from './PlaceholderPanel';
import { SaveLoadView } from './SaveLoadView';
import { SettingsPanel } from './SettingsPanel';
import { PANEL_DEFS } from './panelDefs';

const PLACEHOLDER_TEXT: Partial<Record<PanelId, { heading: string; blurb: string }>> = {
  build: { heading: 'The builder’s catalogue', blurb: 'Every building with its cost, what it needs nearby and what it produces, then click the map to place it.' },
  settlers: { heading: 'Know your people', blurb: 'The settler list and inspector: needs, moods, skills, traits and what each person is doing right now.' },
  priorities: { heading: 'Who does what', blurb: 'Rank farming, woodcutting, mining, hauling and more from never to high, and watch the colony adapt.' },
  events: { heading: 'The colony chronicle', blurb: 'Arrivals, weather, accidents and discoveries, with objectives and decisions that need your answer.' },
  stats: { heading: 'The long view', blurb: 'Stock and population over time.' },
};

/** Renders whichever panel the store says is open. Replace a placeholder here when its milestone lands. */
export function PanelHost() {
  const openPanel = useUiStore((s) => s.openPanel);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const gameMenuOpen = useUiStore((s) => s.gameMenuOpen);
  if (!openPanel || gameMenuOpen) return null;
  const def = PANEL_DEFS[openPanel];
  const close = () => setOpenPanel(null);

  let body;
  switch (openPanel) {
    case 'saveLoad':
      body = <SaveLoadView mode="both" onLoaded={close} />;
      break;
    case 'settings':
      body = <SettingsPanel />;
      break;
    case 'build':
      body = <BuildPanel />;
      break;
    case 'settlers':
      body = <SettlersPanel />;
      break;
    default: {
      const text = PLACEHOLDER_TEXT[openPanel] ?? { heading: def.title, blurb: def.blurb };
      body = <PlaceholderPanel icon={def.icon} heading={text.heading} blurb={text.blurb} comingIn={def.comingIn ?? 'a later milestone'} />;
    }
  }

  return (
    <Panel key={openPanel} title={def.title} icon={def.icon} placement={def.placement} width={def.width} onClose={close} testId={`panel-${openPanel}`}>
      {body}
    </Panel>
  );
}
