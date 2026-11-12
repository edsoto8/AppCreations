import { memo, type ReactNode } from 'react';
import { useStore, type UiState } from '../app/store';
import { EduPanel } from './education/EduPanel';
import { EnvironmentPanel } from './EnvironmentPanel';
import { EventLog } from './EventLog';
import { Icon, type IconName } from './icons';
import { MapPanel } from './map/MapPanel';
import { ControlModeSwitch, MissionPanel, TransportBar } from './MissionPanel';
import { TelemetryCards } from './Telemetry';
import { useUi, type LocalUiState } from './uiStore';
import { ViewPanel } from './ViewPanel';

type SharedTab = UiState['sidebarTab'];
type MobileOnly = Exclude<LocalUiState['mobileTab'], 'controls'>;
type TabId = SharedTab | MobileOnly;

const TABS: Array<{ id: TabId; label: string; icon: IconName; mobileOnly?: boolean }> = [
  { id: 'mission', label: 'Mission', icon: 'play' },
  { id: 'map', label: 'Map', icon: 'map', mobileOnly: true },
  { id: 'stats', label: 'Stats', icon: 'pulse', mobileOnly: true },
  { id: 'environment', label: 'Environment', icon: 'sliders' },
  { id: 'view', label: 'View', icon: 'eye' },
  { id: 'engineering', label: 'Learn', icon: 'cap' },
  { id: 'log', label: 'Log', icon: 'list', mobileOnly: true },
];

const isMobileOnly = (t: TabId): t is MobileOnly => t === 'map' || t === 'stats' || t === 'log';

function panelFor(tab: TabId): ReactNode {
  switch (tab) {
    case 'mission':
      return <MissionPanel />;
    case 'environment':
      return <EnvironmentPanel />;
    case 'view':
      return <ViewPanel />;
    case 'engineering':
      return <EduPanel />;
    case 'map':
      return <MapPanel variant="sheet" />;
    case 'stats':
      return <TelemetryCards />;
    case 'log':
      return <EventLog />;
  }
}

export const Sidebar = memo(function Sidebar({ mobile }: { mobile: boolean }) {
  const sharedTab = useStore((s) => s.sidebarTab);
  const eduOn = useStore((s) => s.eduEnabled);
  const set = useStore((s) => s.set);
  const mobileTab = useUi((s) => s.mobileTab);
  const sheetOpen = useUi((s) => s.sheetOpen);
  const setUi = useUi((s) => s.set);
  const active: TabId = mobile && mobileTab !== 'controls' ? mobileTab : sharedTab;
  const tabs = TABS.filter((t) => mobile || !t.mobileOnly);

  const choose = (id: TabId) => {
    if (isMobileOnly(id)) setUi({ mobileTab: id, sheetOpen: true });
    else {
      set({ sidebarTab: id });
      setUi({ mobileTab: 'controls', sheetOpen: true });
    }
  };

  return (
    <aside className={`sidebar ${mobile ? 'sheet' : ''} ${mobile && !sheetOpen ? 'sheet-closed' : ''}`} aria-label="Controls">
      {mobile && (
        <button type="button" className="sheet-handle" aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'} aria-expanded={sheetOpen} onClick={() => setUi({ sheetOpen: !sheetOpen })}>
          <span />
        </button>
      )}
      <div className="sidebar-top">
        <ControlModeSwitch />
        <TransportBar />
      </div>
      <nav className="tabs" role="tablist" aria-label="Panels">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls="sidebar-panel"
            className={`tab ${active === t.id ? 'on' : ''}`}
            onClick={() => choose(t.id)}
            data-testid={`tab-${t.id}`}
          >
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
            {t.id === 'engineering' && eduOn && <span className="tab-dot" aria-label="(on)" />}
          </button>
        ))}
      </nav>
      <div className="tab-body" id="sidebar-panel" role="tabpanel" aria-labelledby={`tab-${active}`} hidden={mobile && !sheetOpen}>
        {panelFor(active)}
      </div>
    </aside>
  );
});
