import { useState } from 'react';
import type { IncidentKind, InjectedEvent, InjectedKind, MaterialId } from '../simulation/types';
import { MATERIAL_IDS } from '../simulation/types';
import { useUi } from '../store';
import { runtime } from '../rendering/runtime';
import { formatTime } from '../simulation/clock';
import { INCIDENT_LABELS } from '../production/incidents';
import { SERIES, STATUS } from '../dashboard/palette';

interface IncidentForm {
  kind: IncidentKind;
  targets?: () => { id: string; label: string }[];
  param?: { key: string; label: string; value: number; step?: number };
  hint: string;
}

const cells = () => (runtime.current?.layout.cells ?? []).map((c) => ({ id: `cell-${c.index}`, label: `Assembly Cell ${c.index + 1}` }));
const stations = () => [
  ...cells(),
  ...(runtime.current?.layout.inspection ?? []).map((s) => ({ id: `insp-${s.index}`, label: `Inspection ${s.index + 1}` })),
  { id: 'pack', label: 'Packaging' },
];

const FORMS: IncidentForm[] = [
  { kind: 'machine-failure', targets: stations, param: { key: 'repairMin', label: 'repair min', value: 120 }, hint: 'Breaks the machine now; repair starts when a technician arrives.' },
  {
    kind: 'conveyor-breakdown',
    targets: () => (runtime.current?.layout.conveyors ?? []).map((c) => ({ id: c.id, label: c.id })).reverse(),
    param: { key: 'repairMin', label: 'repair min', value: 45 },
    hint: 'Belt stops, items freeze, upstream stations block.',
  },
  { kind: 'material-shortage', targets: () => MATERIAL_IDS.map((m) => ({ id: m, label: m })), param: { key: 'quarantinePct', label: '% quarantined', value: 85 }, hint: 'Quarantines stock and delays the supplier by 24 h.' },
  { kind: 'worker-absence', targets: () => [...stations(), { id: 'forklift-0', label: 'Forklift driver' }], param: { key: 'durationHours', label: 'hours', value: 4, step: 0.5 }, hint: 'The operator leaves; the floater covers if free.' },
  { kind: 'inspection-spike', param: { key: 'rejectRate', label: 'reject rate', value: 0.3, step: 0.05 }, hint: 'Reject rate jumps for 2 h: more rework traffic and scrap.' },
  { kind: 'order-surge', param: { key: 'orders', label: 'orders', value: 10 }, hint: 'Rush orders (high priority) arrive at once.' },
  { kind: 'shipping-bottleneck', param: { key: 'durationHours', label: 'hours', value: 6 }, hint: 'One bay closed and carriers 3× slower.' },
  { kind: 'packaging-slowdown', param: { key: 'factor', label: 'speed factor', value: 0.5, step: 0.1 }, hint: 'Packaging runs slower for 3 h.' },
];

const KIND_COLOR: Partial<Record<InjectedKind, string>> = {
  'machine-failure': STATUS.critical,
  'conveyor-breakdown': STATUS.critical,
  'material-shortage': STATUS.warning,
  'worker-absence': STATUS.serious,
  'inspection-spike': STATUS.serious,
  'order-surge': SERIES[6],
  'shipping-bottleneck': STATUS.warning,
  'packaging-slowdown': STATUS.serious,
};

function inject(ev: Omit<InjectedEvent, 'at'>) {
  const rt = runtime.current;
  if (!rt) return;
  rt.host.inject({ ...ev, at: rt.playback.renderTime });
}

function FormRow({ f }: { f: IncidentForm }) {
  const opts = f.targets?.() ?? [];
  const [target, setTarget] = useState(opts[0]?.id ?? '');
  const [value, setValue] = useState(f.param?.value ?? 0);
  return (
    <div className="card" style={{ padding: '6px 8px' }}>
      <div className="row gap" style={{ justifyContent: 'space-between' }}>
        <b style={{ fontSize: 12 }}>{INCIDENT_LABELS[f.kind]}</b>
        <button
          className="btn small danger"
          data-testid={`inject-${f.kind}`}
          onClick={() => inject({ kind: f.kind, target: target || undefined, params: f.param ? { [f.param.key]: value } : undefined })}
        >
          Inject
        </button>
      </div>
      <div className="row gap" style={{ marginTop: 4 }}>
        {opts.length > 0 && (
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} style={{ flex: 1 }}>
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {f.param && (
          <label className="seed" style={{ flex: 1 }}>
            {f.param.label}
            <input type="number" step={f.param.step ?? 1} value={value} onChange={(e) => setValue(Number(e.target.value))} />
          </label>
        )}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
        {f.hint}
      </div>
    </div>
  );
}

/** Incident injection, timeline and recovery actions. Every action is recorded into the scenario. */
export function IncidentsPanel() {
  const m = useUi((s) => s.metrics);
  const simTime = useUi((s) => s.simTime);
  const incidents = m?.incidents ?? [];
  const snap = runtime.current?.index.snap;
  const failedStations = snap?.stations.filter((s) => s.state === 'failed') ?? [];
  const failedConveyors = snap?.conveyors.filter((c) => c.state === 'failed') ?? [];
  const onShift = snap?.workers.filter((w) => w.state !== 'off-shift' && w.state !== 'absent' && w.role !== 'technician') ?? [];
  const [worker, setWorker] = useState('');
  const [station, setStation] = useState('cell-0');
  const [material, setMaterial] = useState<MaterialId>('PCB');

  const window0 = Math.max(0, simTime - 12 * 3600);
  const span = Math.max(1, simTime + 2 * 3600 - window0);
  const x = (t: number) => `${((t - window0) / span) * 100}%`;
  const visible = incidents.filter((i) => (i.end ?? simTime) >= window0).slice(-8);

  return (
    <div className="dash" data-testid="incidents">
      <div className="card">
        <h4>
          Incident timeline <span className="muted">last 12 h</span>
        </h4>
        <div className="timeline" style={{ height: Math.max(40, visible.length * 17 + 8) }}>
          {visible.map((i, k) => (
            <div
              key={i.id}
              className="seg"
              title={`${formatTime(i.start)} ${i.description}`}
              style={{
                left: x(Math.max(i.start, window0)),
                width: `max(6px, calc(${x(Math.min(i.end ?? simTime, simTime + 2 * 3600))} - ${x(Math.max(i.start, window0))}))`,
                top: 4 + k * 17,
                background: KIND_COLOR[i.kind] ?? SERIES[0],
              }}
            >
              {INCIDENT_LABELS[i.kind]}
            </div>
          ))}
          <div className="now" style={{ left: x(simTime) }} />
        </div>
        <ul className="alerts" data-testid="incident-list">
          {[...incidents].reverse().map((i) => (
            <li key={i.id} className={i.kind.includes('failure') || i.kind.includes('breakdown') ? 'critical' : 'warning'}>
              <span className="t">{formatTime(i.start)}</span>
              {i.description}
              {i.end !== null && i.end <= simTime && <span className="muted"> — ended {formatTime(i.end)}</span>}
            </li>
          ))}
          {incidents.length === 0 && <li className="muted">No incidents yet. Inject one below.</li>}
        </ul>
      </div>

      <div className="card">
        <h4>Recovery actions</h4>
        {failedStations.length + failedConveyors.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Nothing is broken right now.</div>}
        {[...failedStations.map((s) => ({ id: s.id, name: s.name })), ...failedConveyors.map((c) => ({ id: c.id, name: `Conveyor ${c.id}` }))].map((r) => (
          <div key={r.id} className="row gap" style={{ margin: '4px 0', justifyContent: 'space-between' }}>
            <span>⛔ {r.name} is down</span>
            <span className="row gap">
              <button className="btn small good" data-testid={`repair-${r.id}`} onClick={() => inject({ kind: 'repair-now', target: r.id, params: { minutes: 5 } })}>
                Repair now
              </button>
              {r.id.startsWith('cell-') && (
                <button className="btn small" onClick={() => inject({ kind: 'reroute', target: r.id, params: { durationHours: 2 } })}>
                  Reroute
                </button>
              )}
            </span>
          </div>
        ))}
        <div className="row gap" style={{ marginTop: 8 }}>
          <select className="select" value={worker} onChange={(e) => setWorker(e.target.value)} style={{ flex: 1 }}>
            <option value="">Worker…</option>
            {onShift.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.role}{w.stationId ? ` @ ${w.stationId}` : ''})
              </option>
            ))}
          </select>
          <select className="select" value={station} onChange={(e) => setStation(e.target.value)}>
            {[...stations(), { id: 'forklift-0', label: 'Forklift' }].map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={!worker} onClick={() => inject({ kind: 'reassign-worker', target: worker, params: { station } })}>
            Reassign
          </button>
        </div>
        <div className="row gap" style={{ marginTop: 6 }}>
          <select className="select" value={material} onChange={(e) => setMaterial(e.target.value as MaterialId)} style={{ flex: 1 }}>
            {MATERIAL_IDS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <button className="btn small" onClick={() => inject({ kind: 'expedite-material', target: material })}>
            Expedite materials
          </button>
        </div>
      </div>

      <h3 style={{ margin: '4px 2px 0' }}>Inject incident</h3>
      {FORMS.map((f) => (
        <FormRow key={f.kind} f={f} />
      ))}
    </div>
  );
}
