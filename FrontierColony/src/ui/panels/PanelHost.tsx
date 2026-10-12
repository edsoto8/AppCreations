import { useEffect, useState } from 'react';
import { useUiStore, type PanelId } from '../../store';
import { Panel } from '../components/Panel';
import { BuildPanel } from './BuildPanel';
import { EventsPanel } from './EventsPanel';
import { PrioritiesPanel } from './PrioritiesPanel';
import { StatsPanel } from './StatsPanel';
import { SettlersPanel } from './SettlersPanel';
import { SaveLoadView } from './SaveLoadView';
import { HowToPlay } from './HowToPlay';
import { SettingsPanel } from './SettingsPanel';
import { PANEL_DEFS } from './panelDefs';


/** Keeps the last panel mounted for `ms` after it closes, so it can animate out. */
function useClosing(open: PanelId | null, ms = 150): { shown: PanelId | null; closing: boolean } {
  const [shown, setShown] = useState<PanelId | null>(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(open);
      setClosing(false);
      return;
    }
    if (!shown) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, ms);
    return () => window.clearTimeout(t);
    // `shown` is only read to know whether there is anything to close.
  }, [open, ms]);
  return { shown: open ?? shown, closing: open === null && closing };
}

export function PanelHost() {
  const current = useUiStore((s) => s.openPanel);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const gameMenuOpen = useUiStore((s) => s.gameMenuOpen);
  const { shown: openPanel, closing } = useClosing(current);
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
    case 'help':
      body = <HowToPlay />;
      break;
  }

  return (
    <Panel key={openPanel} title={def.title} icon={def.icon} placement={def.placement} width={def.width} onClose={close} closing={closing} testId={`panel-${openPanel}`}>
      {body}
    </Panel>
  );
}
