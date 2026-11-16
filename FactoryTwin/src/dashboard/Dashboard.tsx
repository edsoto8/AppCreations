import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useUi } from '../store';
import { formatDuration, formatTime } from '../simulation/clock';
import type { MetricsSnapshot, ResourceStats } from '../simulation/types';
import { AXIS, GRID, MATERIAL_COLOR, SERIES, STAGE_COLOR, STATUS } from './palette';

const money = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${v.toFixed(0)}`);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const tooltipStyle = {
  contentStyle: { background: '#0b1220', border: '1px solid #243247', borderRadius: 6, fontSize: 11 },
  labelStyle: { color: '#8b9bb2' },
  labelFormatter: (t: unknown) => formatTime(Number(t)),
};

function Tile({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="tile" data-testid={testId}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** KPI tiles, trends, utilisation, inventory, bottleneck and alerts. All values come from the simulation. */
export function Dashboard() {
  const m = useUi((s) => s.metrics);
  if (!m) return <div className="pad muted">Waiting for simulation data…</div>;
  return <DashboardBody m={m} />;
}

function DashboardBody({ m }: { m: MetricsSnapshot }) {
  const t = m.totals;
  const series = m.series;
  const xDomain: [number, number] = [series[0]?.t ?? 0, Math.max(m.time, series[series.length - 1]?.t ?? 1)];
  const invData = useMemo(() => series.map((s) => ({ t: s.t, ...s.inventory })), [series]);
  const utilData = useMemo(() => series.map((s) => ({ t: s.t, ...s.utilization })), [series]);
  const machines = m.resources.filter((r) => r.kind === 'assembly' || r.kind === 'inspection' || r.kind === 'packaging' || r.kind === 'palletizer');
  const vehicles = m.resources.filter((r) => r.kind === 'agv' || r.kind === 'forklift');
  return (
    <div className="dash" data-testid="dashboard">
      <div className="tiles">
        <Tile label="Manufactured" value={t.unitsPacked.toLocaleString()} hint={`${t.unitsShipped.toLocaleString()} shipped`} testId="kpi-manufactured" />
        <Tile label="Per hour" value={String(m.current.unitsPerHour)} hint="packed, last sim hour" testId="kpi-rate" />
        <Tile label="Active orders" value={String(t.activeOrders)} hint={`${t.ordersShipped} shipped`} />
        <Tile label="Rejected" value={String(t.unitsRejected)} hint={`${t.unitsScrapped} scrapped · ${t.unitsInspected ? pct(t.unitsRejected / t.unitsInspected) : '0%'}`} />
        <Tile label="Avg cycle time" value={formatDuration(t.avgCycleTimeSec)} hint="release → packed" />
        <Tile label="WIP" value={String(t.wip)} hint="units in production" testId="kpi-wip" />
        <Tile label="On-time" value={pct(t.onTimeRate)} hint={`lead ${formatDuration(t.avgOrderLeadTimeSec)}`} />
        <Tile label="Operating cost" value={money(t.operatingCost)} hint={t.unitsShipped ? `${money(t.operatingCost / t.unitsShipped)} / unit` : '—'} />
        <Tile label="Revenue" value={money(t.revenue)} hint={`margin ${money(t.revenue - t.operatingCost)}`} />
      </div>

      <div className="card">
        <h4>
          Production per hour <span className="muted">units packed, rolling hour</span>
        </h4>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={series} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" type="number" domain={xDomain} tickFormatter={(v) => formatTime(v)} {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip {...tooltipStyle} formatter={(v) => [`${v} units/h`, 'Production']} />
            <Area type="monotone" dataKey="unitsPerHour" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h4>WIP and active orders</h4>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={series} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" type="number" domain={xDomain} tickFormatter={(v) => formatTime(v)} {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="wip" name="WIP (units)" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="activeOrders" name="Active orders" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card" data-testid="utilization">
        <h4>
          Utilisation per machine <span className="muted">share of open time</span>
        </h4>
        {machines.map((r) => (
          <StateBar key={r.id} r={r} />
        ))}
        <div className="row gap muted" style={{ fontSize: 10.5, marginTop: 4, flexWrap: 'wrap' }}>
          <Key c={SERIES[0]} l="busy" /> <Key c={STATUS.serious} l="blocked" /> <Key c={STATUS.critical} l="down" /> <Key c={STATUS.neutral} l="starved / idle" />
        </div>
        <h4 style={{ marginTop: 8 }}>Vehicles</h4>
        {vehicles.map((r) => (
          <StateBar key={r.id} r={r} />
        ))}
      </div>

      <div className="card">
        <h4>Utilisation trend by stage</h4>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={utilData} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" type="number" domain={xDomain} tickFormatter={(v) => formatTime(v)} {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip {...tooltipStyle} formatter={(v, n) => [pct(Number(v)), String(n)]} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            {Object.entries(STAGE_COLOR).map(([k, c]) => (
              <Line key={k} type="monotone" dataKey={k} stroke={c} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h4>
          Raw material inventory <span className="muted">units on hand</span>
        </h4>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={invData} margin={{ top: 4, right: 6, bottom: 0, left: -10 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" type="number" domain={xDomain} tickFormatter={(v) => formatTime(v)} {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            {Object.entries(MATERIAL_COLOR).map(([k, c]) => (
              <Line key={k} type="stepAfter" dataKey={k} stroke={c} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card" data-testid="bottleneck">
        <h4>Bottleneck</h4>
        <p className="explain">{m.bottleneck.explanation}</p>
        {m.bottleneck.ranking.map((b, i) => (
          <div className="bar-row" key={b.stage}>
            <span>
              {i + 1}. {b.stage}
            </span>
            <span className="bar">
              <span style={{ width: `${Math.min(100, (b.score / 1.15) * 100)}%`, background: i === 0 ? SERIES[1] : SERIES[0] }} />
            </span>
            <span className="num">{b.score.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h4>Operating cost breakdown</h4>
        <table className="cmp">
          <tbody>
            <tr><td>Materials consumed</td><td>{money(t.materialCost)}</td></tr>
            <tr><td>Machines &amp; conveyors (open hours)</td><td>{money(t.machineCost)}</td></tr>
            <tr><td>Vehicles</td><td>{money(t.vehicleCost)}</td></tr>
            <tr><td>Labour (hours present)</td><td>{money(t.laborCost)}</td></tr>
            <tr><td>Expedite fees</td><td>{money(t.otherCost)}</td></tr>
            <tr><th>Total</th><th>{money(t.operatingCost)}</th></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h4>Alerts</h4>
        <ul className="alerts" data-testid="alerts">
          {[...m.alerts].reverse().map((a, i) => (
            <li key={i} className={a.severity}>
              <span className="t">{formatTime(a.t)}</span>
              <b>{a.severity === 'critical' ? '⛔' : a.severity === 'warning' ? '⚠' : 'ℹ'}</b> {a.message}
            </li>
          ))}
          {m.alerts.length === 0 && <li className="muted">No alerts.</li>}
        </ul>
      </div>
    </div>
  );
}

function Key({ c, l }: { c: string; l: string }) {
  return (
    <span>
      <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 3 }} />
      {l}
    </span>
  );
}

function StateBar({ r }: { r: ResourceStats }) {
  const busy = Math.max(0, r.utilization);
  const blocked = r.blockedFrac;
  const down = r.failedFrac;
  const starved = Math.max(0, 1 - busy - blocked - down);
  const seg = (w: number, c: string) => <span style={{ width: `${w * 100}%`, background: c, display: 'inline-block', borderRadius: 0 }} />;
  return (
    <div className="bar-row" title={`${r.name}: busy ${pct(busy)}, blocked ${pct(blocked)}, down ${pct(down)}, starved/idle ${pct(starved)}`}>
      <span>{r.name}</span>
      <span className="bar" style={{ display: 'flex', gap: 2, background: 'transparent' }}>
        {seg(busy, SERIES[0])}
        {blocked > 0.002 && seg(blocked, STATUS.serious)}
        {down > 0.002 && seg(down, STATUS.critical)}
        {seg(starved, STATUS.neutral)}
      </span>
      <span className="num">{pct(busy)}</span>
    </div>
  );
}
