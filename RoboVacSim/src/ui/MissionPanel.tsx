import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../app/store';
import type { Command } from '../sim/mission/types';
import { fmtClock } from './format';
import { useApi, useCan, useMode } from './hooks';
import { Icon, type IconName } from './icons';
import { CLEAN_MODES, MISSION_KINDS, SUCTION_LEVELS, WATER_LEVELS } from './labels';
import { Field, Kbd, Section, Segmented, Toggle } from './primitives';
import { ManualPad } from './ManualPad';

type Transport = 'start' | 'pause' | 'resume' | 'stop' | 'dock';

const TRANSPORT: Record<Transport, { label: string; icon: IconName; cmd: Command['type']; kind: string }> = {
  start: { label: 'Start', icon: 'play', cmd: 'start', kind: 'primary' },
  pause: { label: 'Pause', icon: 'pause', cmd: 'pause', kind: 'secondary' },
  resume: { label: 'Resume', icon: 'play', cmd: 'resume', kind: 'primary' },
  stop: { label: 'Stop', icon: 'stop', cmd: 'stop', kind: 'danger' },
  dock: { label: 'Dock', icon: 'home', cmd: 'dock', kind: 'secondary' },
};

function TransportButton({ id }: { id: Transport }) {
  const api = useApi();
  const def = TRANSPORT[id];
  const can = useCan(def.cmd);
  const enabled = !!api && can.ok;
  const onClick = () => {
    if (!api) return;
    if (id === 'start') api.startMission();
    else api.command({ type: def.cmd } as Command);
  };
  const title = enabled ? (id === 'dock' ? 'Return to dock' : def.label) : can.reason;
  return (
    <button
      type="button"
      className={`btn btn-${def.kind} transport`}
      data-testid={`btn-${id}`}
      disabled={!enabled}
      aria-disabled={!enabled}
      title={title}
      aria-label={id === 'dock' ? 'Return to dock' : def.label}
      onClick={onClick}
    >
      <Icon name={def.icon} size={15} />
      <span>{def.label}</span>
    </button>
  );
}

/** Start / Pause / Resume / Stop / Dock — always visible at the top of the sidebar. */
export const TransportBar = memo(function TransportBar() {
  const mode = useMode();
  const paused = mode === 'paused';
  return (
    <div className="transport-bar" role="toolbar" aria-label="Mission controls">
      <TransportButton id="start" />
      {paused ? <TransportButton id="resume" /> : <TransportButton id="pause" />}
      <TransportButton id="stop" />
      <TransportButton id="dock" />
    </div>
  );
});

type ControlMode = 'auto' | 'manual' | 'diagnostic';

export const ControlModeSwitch = memo(function ControlModeSwitch() {
  const api = useApi();
  const mode = useMode();
  const current: ControlMode = mode === 'manual' ? 'manual' : mode === 'diagnostic' ? 'diagnostic' : 'auto';
  const canManual = useCan('manual');
  const canDiag = useCan('diagnostic');
  const onChange = useCallback(
    (v: ControlMode) => {
      if (!api || v === current) return;
      if (v === 'manual') api.command({ type: 'manual', enable: true });
      else if (v === 'diagnostic') {
        if (current === 'manual') api.command({ type: 'manual', enable: false });
        api.command({ type: 'diagnostic' });
      } else if (current === 'manual') api.command({ type: 'manual', enable: false });
      else if (current === 'diagnostic') api.command({ type: 'stop' });
    },
    [api, current],
  );
  return (
    <Segmented<ControlMode>
      label="Control mode"
      value={current}
      onChange={onChange}
      testId="control-mode"
      options={[
        { value: 'auto', label: 'Autonomous', testId: 'ctl-auto' },
        { value: 'manual', label: 'Manual drive', title: canManual.ok ? 'Drive with WASD / arrow keys (M)' : canManual.reason, disabled: !canManual.ok && current !== 'manual', testId: 'ctl-manual' },
        { value: 'diagnostic', label: 'Diagnostic', title: canDiag.ok ? 'Run the self-test' : canDiag.reason, disabled: !canDiag.ok && current !== 'diagnostic', testId: 'ctl-diagnostic' },
      ]}
    />
  );
});

function RoomChips() {
  const rooms = useStore((s) => s.rooms);
  const selected = useStore((s) => s.draft.rooms);
  const setDraft = useStore((s) => s.setDraft);
  const toggle = (id: string) => setDraft({ rooms: selected.includes(id) ? selected.filter((r) => r !== id) : [...selected, id] });
  return (
    <Field
      label={
        <>
          Rooms <span className="muted">· {selected.length ? `${selected.length} selected` : 'tap to choose, or click rooms on the map'}</span>
        </>
      }
    >
      <div className="chips" role="group" aria-label="Rooms to clean">
        {rooms.map((r) => {
          const on = selected.includes(r.id);
          return (
            <button key={r.id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(r.id)} data-testid={`room-${r.id}`}>
              {on && <Icon name="check" size={12} />}
              {r.name}
              <span className="chip-meta">{r.area.toFixed(0)} m²</span>
            </button>
          );
        })}
      </div>
      <div className="chip-actions">
        <button type="button" className="link-btn" onClick={() => setDraft({ rooms: rooms.map((r) => r.id) })}>
          Select all
        </button>
        <button type="button" className="link-btn" onClick={() => setDraft({ rooms: [] })} disabled={!selected.length}>
          Clear
        </button>
      </div>
    </Field>
  );
}

function SpotPicker() {
  const spot = useStore((s) => s.draft.spot);
  const tool = useStore((s) => s.tool);
  const set = useStore((s) => s.set);
  const picking = tool === 'spot';
  return (
    <Field label="Spot location" hint={picking ? 'Click the floor in the 3D view or on the 2D map.' : undefined}>
      <div className="row gap">
        <button type="button" className={`btn btn-sm ${picking ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={picking} onClick={() => set({ tool: picking ? 'none' : 'spot' })} data-testid="btn-pick-spot">
          <Icon name="target" size={14} />
          {picking ? 'Picking… (Esc)' : 'Pick on map'}
        </button>
        <span className="mono muted">{spot ? `x ${spot.x.toFixed(2)} · y ${spot.y.toFixed(2)} m` : 'No spot chosen'}</span>
      </div>
    </Field>
  );
}

const MissionSettings = memo(function MissionSettings() {
  const api = useApi();
  const draft = useStore(useShallow((s) => ({ kind: s.draft.kind, cleanMode: s.draft.cleanMode, suction: s.draft.suction, water: s.draft.water, passes: s.draft.passes })));
  const setDraft = useStore((s) => s.setDraft);
  const mopping = draft.cleanMode !== 'vacuum';
  const vacuuming = draft.cleanMode !== 'mop';
  return (
    <Section title="Mission">
      <Field label="Mission type">
        <Segmented
          label="Mission type"
          value={draft.kind}
          onChange={(kind) => setDraft({ kind })}
          testId="mission-kind"
          options={MISSION_KINDS.map((k) => ({ value: k.value, label: k.short, title: k.label, testId: `kind-${k.value}` }))}
        />
      </Field>
      {draft.kind === 'rooms' && <RoomChips />}
      {draft.kind === 'spot' && <SpotPicker />}
      <Field label="Cleaning mode">
        <Segmented label="Cleaning mode" value={draft.cleanMode} onChange={(cleanMode) => setDraft({ cleanMode })} options={CLEAN_MODES} testId="clean-mode" />
      </Field>
      <Field label={<>Suction {!vacuuming && <span className="muted">· not used when mopping only</span>}</>}>
        <Segmented
          label="Suction power"
          value={draft.suction}
          onChange={(s) => (api ? api.setSuction(s) : setDraft({ suction: s }))}
          options={SUCTION_LEVELS}
          testId="suction"
        />
      </Field>
      <div className="grid-2">
        <Field label="Water flow">
          <Segmented size="sm" label="Water flow" value={draft.water} onChange={(w) => (api ? api.setWater(w) : setDraft({ water: w }))} options={WATER_LEVELS.map((w) => ({ ...w, title: `${w.value} water flow` }))} disabled={!mopping} testId="water" />
        </Field>
        <Field label="Passes">
          <Segmented size="sm" label="Passes" value={draft.passes} onChange={(p) => setDraft({ passes: p })} options={[1, 2, 3].map((p) => ({ value: p as 1 | 2 | 3, label: `${p}×` }))} testId="passes" />
        </Field>
      </div>
    </Section>
  );
});

const DIAG_TONE = { pending: 'muted', running: 'info', pass: 'ok', fail: 'error' } as const;

const DiagnosticsCard = memo(function DiagnosticsCard() {
  const diag = useStore((s) => s.telemetry?.diag);
  if (!diag || diag.length === 0) return null;
  const done = diag.filter((d) => d.status === 'pass' || d.status === 'fail').length;
  return (
    <Section title="Self-test" aside={<span className="muted mono">{done}/{diag.length}</span>}>
      <ol className="diag-list">
        {diag.map((d) => (
          <li key={d.name} className={`diag tone-${DIAG_TONE[d.status]}`}>
            <span className="diag-icon" aria-hidden="true">
              {d.status === 'pass' ? <Icon name="check" size={13} /> : d.status === 'fail' ? <Icon name="close" size={13} /> : d.status === 'running' ? <span className="spinner" /> : <span className="dot" />}
            </span>
            <span className="diag-name">{d.name}</span>
            <span className="diag-detail">{d.detail || d.status}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
});

const ManualCard = memo(function ManualCard() {
  const vacuum = useStore((s) => s.manualVacuum);
  const set = useStore((s) => s.set);
  const v = useStore((s) => s.telemetry?.velocity.v ?? 0);
  const w = useStore((s) => s.telemetry?.velocity.w ?? 0);
  return (
    <Section title="Manual drive" aside={<span className="mono muted">{v.toFixed(2)} m/s · {w.toFixed(2)} rad/s</span>}>
      <div className="manual">
        <ManualPad />
        <div className="manual-help">
          <p>
            <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd> or arrow keys drive the robot (robot-centric).
          </p>
          <p>
            <Kbd>Space</Kbd> toggles the vacuum.
          </p>
          <Toggle on={vacuum} onChange={(on) => set({ manualVacuum: on })} label="Vacuum on" testId="manual-vacuum" />
        </div>
      </div>
    </Section>
  );
});

function ErrorCard() {
  const error = useStore((s) => s.telemetry?.error);
  const api = useApi();
  const can = useCan('clearError');
  if (!error) return null;
  return (
    <div className="callout tone-error" role="alert">
      <Icon name="alert" size={16} />
      <div>
        <strong>Robot error</strong>
        <p>{error}</p>
      </div>
      <button type="button" className="btn btn-sm btn-ghost" disabled={!can.ok} onClick={() => api?.command({ type: 'clearError' })}>
        Clear
      </button>
    </div>
  );
}

function MissionSummary() {
  const m = useStore(
    useShallow((s) => {
      const t = s.telemetry;
      return { result: t?.mission?.result ?? null, kind: t?.mission?.kindLabel ?? null, time: t?.missionTime ?? 0, phase: t?.mission?.phase ?? null };
    }),
  );
  if (!m.result || !m.kind) return null;
  const ok = m.phase === 'completed';
  return (
    <div className={`callout tone-${ok ? 'ok' : 'warn'}`}>
      <Icon name={ok ? 'check' : 'info'} size={16} />
      <div>
        <strong>{m.kind}</strong>
        <p>
          {m.result} · {fmtClock(m.time)}
        </p>
      </div>
    </div>
  );
}

export const MissionPanel = memo(function MissionPanel() {
  const mode = useMode();
  return (
    <div className="panel-stack">
      <ErrorCard />
      {mode === 'manual' && <ManualCard />}
      <DiagnosticsCard />
      <MissionSettings />
      <MissionSummary />
    </div>
  );
});
