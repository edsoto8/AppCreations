import { memo, useEffect, useState } from 'react';
import { useStore } from '../app/store';
import type { PresetId } from '../app/types';
import { SPEED_OPTIONS, type SimSpeed } from '../sim/core/clock';
import { batteryLevel, fmtClock } from './format';
import { useApi } from './hooks';
import { Icon } from './icons';
import { MODE_ACTIVE, MODE_TONE, PRESET_OPTIONS } from './labels';
import { useUi } from './uiStore';

function Brand() {
  return (
    <div className="brand">
      <svg className="brand-mark" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7cf2df" />
            <stop offset="1" stopColor="#1fa891" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="13.5" fill="#0d1218" stroke="url(#bm)" strokeWidth="2.5" />
        <circle cx="19.5" cy="16" r="4.2" fill="url(#bm)" />
        <path d="M7.5 12.5a9.5 9.5 0 0 1 4-4.6" stroke="#7cf2df" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.7" />
      </svg>
      <div className="brand-text">
        <span className="brand-name">
          AURA<span className="brand-x">-X1</span>
        </span>
        <span className="brand-sub">Ultimate Robot Vacuum Simulator</span>
      </div>
    </div>
  );
}

export const ModeBadge = memo(function ModeBadge() {
  const mode = useStore((s) => s.telemetry?.mode);
  const label = useStore((s) => s.telemetry?.modeLabel);
  const error = useStore((s) => s.telemetry?.error);
  const tone = mode ? MODE_TONE[mode] : 'muted';
  return (
    <span className={`mode-badge tone-${tone} ${mode && MODE_ACTIVE.has(mode) ? 'live' : ''}`} data-testid="mode-badge" title={error ?? label ?? ''} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {label ?? 'Starting…'}
    </span>
  );
});

const BatteryPill = memo(function BatteryPill() {
  const soc = useStore((s) => s.telemetry?.battery ?? NaN);
  const charging = useStore((s) => (s.telemetry?.chargeW ?? 0) > 0.5);
  const level = Number.isFinite(soc) ? batteryLevel(soc) : 'ok';
  const pct = Number.isFinite(soc) ? Math.round(soc * 100) : null;
  return (
    <span className={`battery-pill tone-${level}`} title={charging ? 'Charging' : 'Battery state of charge'}>
      <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
        <rect x="0.75" y="0.75" width="21.5" height="12.5" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
        <rect x="23.5" y="4.5" width="2" height="5" rx="1" fill="currentColor" fillOpacity="0.55" />
        <rect x="2.5" y="2.5" width={Math.max(0, 18 * (Number.isFinite(soc) ? soc : 0))} height="9" rx="1.6" fill="currentColor" />
      </svg>
      <span className="num" data-testid="battery-value">
        {pct === null ? '—' : `${pct}%`}
      </span>
      {charging && <Icon name="bolt" size={13} className="charge-bolt" />}
    </span>
  );
});

const SimClockReadout = memo(function SimClockReadout() {
  const time = useStore((s) => Math.floor(s.telemetry?.time ?? 0));
  return (
    <span className="clock" title="Simulated time since scenario start">
      <Icon name="clock" size={14} />
      <span className="num">{fmtClock(time)}</span>
    </span>
  );
});

function SpeedSelect() {
  const speed = useStore((s) => s.speed);
  const api = useApi();
  return (
    <label className="select-wrap" title="Simulation speed multiplier">
      <span className="sr-only">Simulation speed</span>
      <Icon name="gauge" size={14} />
      <select
        value={speed}
        data-testid="speed-select"
        onChange={(e) => {
          const v = Number(e.target.value) as SimSpeed;
          if (api) api.setSpeed(v);
          else useStore.setState({ speed: v });
        }}
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s === 20 ? '20x (fast-forward)' : `${s}x`}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScenarioControls() {
  const api = useApi();
  const preset = useStore((s) => s.preset);
  const seed = useStore((s) => s.seed);
  const [seedText, setSeedText] = useState(String(seed));
  useEffect(() => setSeedText(String(seed)), [seed]);
  const parsedSeed = (): number => {
    const n = Math.floor(Number(seedText));
    return Number.isFinite(n) && n >= 0 ? n : seed;
  };
  return (
    <div className="scenario">
      <label className="select-wrap" title="House layout preset">
        <span className="sr-only">House preset</span>
        <Icon name="home" size={14} />
        <select
          value={preset}
          data-testid="preset-select"
          disabled={!api}
          onChange={(e) => api?.reset(e.target.value as PresetId, parsedSeed())}
        >
          {PRESET_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="seed" title="Random seed (dirt distribution, sensor noise)">
        <span className="seed-label">Seed</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') api?.reset(preset, parsedSeed());
          }}
          aria-label="Random seed"
          data-testid="seed-input"
        />
      </label>
      <button type="button" className="btn btn-ghost btn-sm" data-testid="btn-reset" disabled={!api} onClick={() => api?.reset(preset, parsedSeed())} title="Reload the scenario with this preset and seed">
        <Icon name="reset" size={14} />
        <span>Reset</span>
      </button>
    </div>
  );
}

export const TopBar = memo(function TopBar() {
  const set = useUi((s) => s.set);
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-status">
        <ModeBadge />
        <BatteryPill />
        <SimClockReadout />
      </div>
      <div className="topbar-actions">
        <SpeedSelect />
        <ScenarioControls />
        <button type="button" className="icon-btn help-btn" aria-label="Help and keyboard shortcuts (H)" title="Help & shortcuts (H)" onClick={() => set({ helpOpen: true })} data-testid="btn-help">
          <Icon name="help" size={18} />
        </button>
      </div>
    </header>
  );
});
