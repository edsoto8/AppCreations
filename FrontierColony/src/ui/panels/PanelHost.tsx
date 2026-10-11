import { useUiStore } from '../../store';
import { Panel } from '../components/Panel';
import { BuildPanel } from './BuildPanel';
import { EventsPanel } from './EventsPanel';
import { PrioritiesPanel } from './PrioritiesPanel';
import { StatsPanel } from './StatsPanel';
import { SettlersPanel } from './SettlersPanel';
import { PlaceholderPanel } from './PlaceholderPanel';
import { SaveLoadView } from './SaveLoadView';
import { SettingsPanel } from './SettingsPanel';
import { PANEL_DEFS } from './panelDefs';

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
    case 'priorities':
      body = <PrioritiesPanel />;
      break;
    case 'events':
      body = <EventsPanel />;
      break;
    case 'stats':
      body = <StatsPanel />;
      break;
    default:
      // Every panel now has a real body; PlaceholderPanel stays available for future panels.
      body = <PlaceholderPanel icon={def.icon} heading={def.title} blurb={def.blurb} comingIn={def.comingIn ?? 'a later milestone'} />;
  }

  return (
    <Panel key={openPanel} title={def.title} icon={def.icon} placement={def.placement} width={def.width} onClose={close} testId={`panel-${openPanel}`}>
      {body}
    </Panel>
  );
}
