import { memo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../app/store';
import type { Telemetry } from '../sim/telemetry';
import { batteryLevel, fmtClock, fmtCount, fmtDist, fmtNum, fmtPct, fmtRange, humanize } from './format';
import { telemetryHistory, useHistoryVersion } from './hooks';
import { Icon, type IconName } from './icons';
import { DOCK_PHASE_LABEL, PHASE_LABEL, RESUME_LABEL } from './labels';
import { Bar, Row, Sparkline, type Tone } from './primitives';

function Card({ title, icon, aside, children, testId }: { title: string; icon: IconName; aside?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="tcard" aria-label={title} data-testid={testId}>
      <header className="tcard-head">
        <Icon name={icon} size={14} />
        <h4>{title}</h4>
        {aside && <span className="tcard-aside">{aside}</span>}
      </header>
      <div className="tcard-body">{children}</div>
    </section>
  );
}

/** Narrow selector helper: pick derived primitives from telemetry with shallow equality. */
function useT<T extends object>(pick: (t: Telemetry) => T, fallback: T): T {
  return useStore(useShallow((s) => (s.telemetry ? pick(s.telemetry) : fallback)));
}

const POWER_PARTS: Array<{ key: keyof Telemetry['power']; label: string; color: string }> = [
  { key: 'suction', label: 'Suction', color: 'var(--accent)' },
  { key: 'drive', label: 'Drive', color: 'var(--info)' },
  { key: 'brushes', label: 'Brushes', color: 'var(--violet)' },
  { key: 'mop', label: 'Mop', color: 'var(--sky)' },
  { key: 'lidar', label: 'LiDAR', color: 'var(--warn)' },
  { key: 'base', label: 'Base', color: 'var(--text-3)' },
];

const EMPTY_POWER = { soc: NaN, wh: 0, w: 0, charge: 0, base: 0, lidar: 0, drive: 0, brushes: 0, suction: 0, mop: 0 };

const PowerCard = memo(function PowerCard() {
  const p = useT((t) => ({ soc: Math.round(t.battery * 1000) / 1000, wh: Math.round(t.batteryWh * 10) / 10, w: Math.round(t.powerW * 10) / 10, charge: Math.round(t.chargeW), ...roundPower(t.power) }), EMPTY_POWER);
  useHistoryVersion(telemetryHistory);
  const hist = telemetryHistory.series('battery').slice();
  const tone: Tone = Number.isFinite(p.soc) ? batteryLevel(p.soc) : 'muted';
  const total = POWER_PARTS.reduce((a, q) => a + p[q.key], 0) || 1;
  return (
    <Card title="Power" icon="battery" aside={p.charge > 0 ? <span className="tone-ok">+{p.charge} W</span> : null} testId="card-power">
      <div className="big-stat">
        <span className={`big tone-${tone}`}>{Number.isFinite(p.soc) ? Math.round(p.soc * 100) : '—'}<small>%</small></span>
        <span className="big-sub">{fmtNum(p.wh, 1, 'Wh')}</span>
      </div>
      <Sparkline values={hist} min={0} max={100} tone={tone === 'muted' ? 'accent' : tone} label="Battery history" width={160} height={22} />
      <div className="stack-bar" role="img" aria-label={`Power draw ${p.w} W`}>
        {POWER_PARTS.map((q) => (p[q.key] > 0.05 ? <span key={q.key} style={{ flexGrow: p[q.key] / total, background: q.color }} title={`${q.label} ${p[q.key].toFixed(1)} W`} /> : null))}
      </div>
      <Row k="Draw" v={fmtNum(p.w, 1, 'W')} />
      <div className="legend">
        {POWER_PARTS.filter((q) => p[q.key] > 0.05).map((q) => (
          <span key={q.key}>
            <i style={{ background: q.color }} />
            {q.label} {p[q.key].toFixed(0)}
          </span>
        ))}
      </div>
    </Card>
  );
});

function roundPower(pw: Telemetry['power']): Telemetry['power'] {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { base: r(pw.base), lidar: r(pw.lidar), drive: r(pw.drive), brushes: r(pw.brushes), suction: r(pw.suction), mop: r(pw.mop) };
}

const EMPTY_PROGRESS = { cov: 0, done: 0, planned: 0, pass: 0, passes: 0, area: 0, target: 0, kind: '', skipped: 0 };

const ProgressCard = memo(function ProgressCard() {
  const p = useT(
    (t) => ({
      cov: Math.round(t.coverage * 10) / 10,
      done: t.mission?.tasksDone ?? 0,
      planned: t.mission?.tasksPlanned ?? 0,
      pass: t.mission?.pass ?? 0,
      passes: t.mission?.passes ?? 0,
      area: Math.round(t.areaCleaned * 10) / 10,
      target: Math.round(t.coverageTarget * 10) / 10,
      kind: t.mission?.kindLabel ?? '',
      skipped: t.mission?.tasksSkipped ?? 0,
    }),
    EMPTY_PROGRESS,
  );
  useHistoryVersion(telemetryHistory);
  const hist = telemetryHistory.series('coverage').slice();
  return (
    <Card title="Progress" icon="pulse" testId="card-progress">
      <div className="big-stat">
        <span className="big tone-accent" data-testid="coverage-value">
          {p.cov.toFixed(1)}
          <small>%</small>
        </span>
        <span className="big-sub">coverage</span>
      </div>
      <Bar value={p.cov / 100} label="Coverage" />
      <Sparkline values={hist} min={0} max={100} label="Coverage history" width={160} height={18} />
      <Row k="Mission" v={p.kind || 'none'} title={p.kind} />
      <Row k="Tasks" v={p.planned ? `${p.done} / ${p.planned}${p.skipped ? ` (${p.skipped} skipped)` : ''}` : '—'} />
      <Row k="Pass" v={p.passes ? `${p.pass} / ${p.passes}` : '—'} />
      <Row k="Area" v={`${p.area.toFixed(1)} / ${p.target.toFixed(0)} m²`} />
    </Card>
  );
});

const EMPTY_CLEAN = { removed: 0, liquid: 0, remaining: 0, dist: 0, mt: 0, eta: 0, bin: 0, binG: 0, clean: 0, cleanMl: 0, dirty: 0, pad: 0 };

const CleaningCard = memo(function CleaningCard() {
  const c = useT(
    (t) => ({
      removed: Math.round(t.dirtRemovedG * 10) / 10,
      liquid: Math.round(t.liquidRemovedMl),
      remaining: Math.round(t.dirtRemainingG * 10) / 10,
      dist: Math.round(t.distance * 10) / 10,
      mt: Math.floor(t.missionTime),
      eta: Math.round(t.eta / 5) * 5,
      bin: Math.round(t.dustbin * 100) / 100,
      binG: Math.round(t.dustbinG),
      clean: Math.round(t.cleanWater * 100) / 100,
      cleanMl: Math.round(t.cleanWaterMl),
      dirty: Math.round(t.dirtyWater * 100) / 100,
      pad: Math.round(t.padSoil * 100) / 100,
    }),
    EMPTY_CLEAN,
  );
  return (
    <Card title="Cleaning" icon="wind" testId="card-cleaning">
      <Row k="Removed" v={`${c.removed.toFixed(1)} g · ${c.liquid} ml`} tone="accent" title="Solid dirt (g) and liquid (ml) picked up" />
      <Row k="Remaining" v={`${c.remaining.toFixed(0)} g`} title="Solid dirt still on the floor" />
      <Row k="Distance" v={fmtDist(c.dist)} />
      <Row k="Mission time" v={fmtClock(c.mt)} />
      <Row k="ETA" v={c.eta > 0 ? fmtClock(c.eta) : '—'} title="Estimated remaining mission time" />
      <div className="mini-bars">
        <MiniBar label="Dustbin" value={c.bin} detail={`${c.binG} g`} tone={c.bin > 0.85 ? 'warn' : 'accent'} />
        <MiniBar label="Clean water" value={c.clean} detail={`${c.cleanMl} ml`} tone={c.clean < 0.15 ? 'warn' : 'info'} />
        <MiniBar label="Dirty water" value={c.dirty} tone={c.dirty > 0.85 ? 'warn' : 'violet'} />
        <MiniBar label="Mop pad soil" value={c.pad} tone={c.pad > 0.7 ? 'warn' : 'muted'} />
      </div>
    </Card>
  );
});

function MiniBar({ label, value, detail, tone }: { label: string; value: number; detail?: string; tone: Tone }) {
  return (
    <div className="mini-bar" title={`${label}: ${fmtPct(value)}${detail ? ` (${detail})` : ''}`}>
      <span className="mini-k">{label}</span>
      <Bar value={value} tone={tone} thin label={label} />
      <span className="mini-v">{fmtPct(value)}</span>
    </div>
  );
}

const EMPTY_NAV = { mode: '—', phase: '', resume: '', target: '—', nav: '—', replans: 0, event: '', recovery: '' };

const NavCard = memo(function NavCard() {
  const n = useT(
    (t) => ({
      mode: t.modeLabel,
      phase: t.mission ? PHASE_LABEL[t.mission.phase] : '',
      resume: t.mission?.resumeReason ? (RESUME_LABEL[t.mission.resumeReason] ?? humanize(t.mission.resumeReason)) : '',
      target: t.target,
      nav: t.nav.state,
      replans: t.nav.replans,
      event: t.nav.lastEvent ?? '',
      recovery: t.nav.recovery ?? '',
    }),
    EMPTY_NAV,
  );
  return (
    <Card title="Navigation" icon="map" testId="card-nav">
      <Row k="State" v={n.mode} />
      <Row k="Phase" v={n.phase || '—'} title={n.phase} />
      {n.resume && <Row k="Resume reason" v={n.resume} tone="warn" />}
      <Row k="Target" v={n.target} title={n.target} />
      <Row k="Nav" v={`${humanize(n.nav)}${n.recovery ? ` · ${humanize(n.recovery)}` : ''}`} tone={n.nav === 'failed' ? 'error' : n.recovery ? 'warn' : undefined} />
      <Row k="Replans" v={n.replans} />
      <div className="last-event" title={n.event}>
        {n.event || 'No navigation events yet'}
      </div>
    </Card>
  );
});

const EMPTY_SENS = { rate: 0, spinning: false, rays: 0, bumper: false, bumps: 0, cliffs: 0, cliffNow: false, front: Infinity, wall: Infinity, surface: '—', mapped: 0 };

const SensorCard = memo(function SensorCard() {
  const s = useT(
    (t) => ({
      rate: t.sensors.lidarRate,
      spinning: t.sensors.lidarSpinning,
      rays: Math.round(t.sensors.lidarRays / 100) * 100,
      bumper: t.sensors.bumper,
      bumps: t.sensors.bumps,
      cliffs: t.sensors.cliffEvents,
      cliffNow: t.sensors.cliffNow,
      front: Number.isFinite(t.sensors.frontNearest) ? Math.round(t.sensors.frontNearest * 100) / 100 : Infinity,
      wall: Number.isFinite(t.sensors.wallGap) ? Math.round(t.sensors.wallGap * 100) / 100 : Infinity,
      surface: t.sensors.surface,
      mapped: Math.round(t.sensors.mapKnownArea * 10) / 10,
    }),
    EMPTY_SENS,
  );
  return (
    <Card title="Sensors" icon="scan" testId="card-sensors">
      <Row k="LiDAR" v={s.spinning ? `${fmtCount(s.rate)} rays/s` : 'stopped'} tone={s.spinning ? 'ok' : 'muted'} title={`${s.rays.toLocaleString()} rays total`} />
      <Row k="Bumper" v={s.bumper ? 'PRESSED' : `ok · ${s.bumps} hits`} tone={s.bumper ? 'warn' : undefined} />
      <Row k="Cliff" v={s.cliffNow ? 'DROP-OFF' : `${s.cliffs} events`} tone={s.cliffNow ? 'error' : undefined} />
      <Row k="Front sensor" v={fmtRange(s.front)} />
      <Row k="Wall gap" v={fmtRange(s.wall)} />
      <Row k="Surface" v={s.surface} />
      <Row k="Mapped" v={`${s.mapped.toFixed(1)} m²`} />
    </Card>
  );
});

const EMPTY_DOCK = { phase: 'idle' as const, progress: 0, clean: 0, dirty: 0, bag: 0, docked: false };

const DockCard = memo(function DockCard() {
  const d = useT(
    (t) => ({
      phase: t.dock.phase,
      progress: Math.round(t.dock.progress * 100) / 100,
      clean: Math.round(t.dock.cleanTank * 100) / 100,
      dirty: Math.round(t.dock.dirtyTank * 100) / 100,
      bag: Math.round(t.dock.dustBag * 100) / 100,
      docked: t.docked,
    }),
    EMPTY_DOCK,
  );
  const busy = d.phase !== 'idle' && d.phase !== 'ready';
  return (
    <Card title="Dock station" icon="dock" aside={<span className={d.docked ? 'tone-ok' : 'muted'}>{d.docked ? 'Docked' : 'Away'}</span>} testId="card-dock">
      <div className="dock-phase">
        <span className={busy ? 'tone-accent' : ''}>{DOCK_PHASE_LABEL[d.phase]}</span>
        {busy && <span className="mono muted">{fmtPct(d.progress)}</span>}
      </div>
      <Bar value={busy ? d.progress : 0} tone="accent" label="Dock phase progress" />
      <div className="mini-bars">
        <MiniBar label="Clean tank" value={d.clean} tone={d.clean < 0.15 ? 'warn' : 'info'} />
        <MiniBar label="Dirty tank" value={d.dirty} tone={d.dirty > 0.85 ? 'warn' : 'violet'} />
        <MiniBar label="Dust bag" value={d.bag} tone={d.bag > 0.85 ? 'warn' : 'muted'} />
      </div>
    </Card>
  );
});

/** All live telemetry cards (bottom strip on desktop, a tab on mobile). */
export const TelemetryCards = memo(function TelemetryCards() {
  const ready = useStore((s) => s.telemetry !== null);
  return (
    <div className={`tcards ${ready ? '' : 'loading'}`} data-testid="telemetry-panel" aria-busy={!ready}>
      <PowerCard />
      <ProgressCard />
      <CleaningCard />
      <NavCard />
      <SensorCard />
      <DockCard />
    </div>
  );
});
