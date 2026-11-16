import { lazy, Suspense } from 'react';
import { useUi, type PanelTab } from '../store';
import { Inspector } from './Inspector';

const Dashboard = lazy(() => import('../dashboard/Dashboard').then((m) => ({ default: m.Dashboard })));
const IncidentsPanel = lazy(() => import('./IncidentsPanel').then((m) => ({ default: m.IncidentsPanel })));
const ExperimentsPanel = lazy(() => import('./ExperimentsPanel').then((m) => ({ default: m.ExperimentsPanel })));

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'experiments', label: 'Experiments' },
];

export function SidePanel() {
  const tab = useUi((s) => s.tab);
  const open = useUi((s) => s.panelOpen);
  const setTab = useUi((s) => s.setTab);
  const setOpen = useUi((s) => s.setPanelOpen);
  return (
    <aside className={`side ${open ? '' : 'collapsed'}`}>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
          </button>
        ))}
        <button className="tab collapse" onClick={() => setOpen(!open)} title={open ? 'Collapse panel' : 'Expand panel'}>
          {open ? '›' : '‹'}
        </button>
      </nav>
      {open && (
        <div className="panel-body">
          <Suspense fallback={<div className="muted pad">Loading…</div>}>
            {tab === 'dashboard' && <Dashboard />}
            {tab === 'inspector' && <Inspector />}
            {tab === 'incidents' && <IncidentsPanel />}
            {tab === 'experiments' && <ExperimentsPanel />}
          </Suspense>
        </div>
      )}
    </aside>
  );
}
