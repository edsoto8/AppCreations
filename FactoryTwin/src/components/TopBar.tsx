import { useRef } from 'react';
import { SPEEDS, useUi, type CameraMode } from '../store';
import { loadScenario, runtime } from '../rendering/runtime';
import { presets } from '../scenarios/presets';
import { exportScenario, importScenario } from '../scenarios/io';
import { downloadText } from './download';

const CAMS: { mode: CameraMode; label: string; title: string }[] = [
  { mode: 'orbit', label: 'Overview', title: 'Reset to the perspective overview (orbit / pan / zoom with the mouse)' },
  { mode: 'top', label: 'Top', title: 'Top-down plan view' },
  { mode: 'focus', label: 'Focus', title: 'Focus on the selected equipment' },
  { mode: 'follow', label: 'Follow', title: 'Follow the selected product, worker or vehicle' },
];

export function TopBar() {
  const ui = useUi();
  const file = useRef<HTMLInputElement>(null);
  const shift = ui.clockLabel.match(/\((.*)\)/)?.[1] ?? '';

  const reset = async (seed?: number) => {
    const rt = runtime.current;
    if (!rt) return;
    const s = JSON.parse(JSON.stringify(rt.scenario));
    if (seed !== undefined) s.seed = seed;
    await loadScenario(s);
  };

  const exportJson = async () => {
    const rt = runtime.current;
    if (!rt) return;
    const s = await rt.host.getScenario();
    downloadText(`${s.id}-seed${s.seed}.json`, exportScenario(s));
  };

  const importJson = async (f: File) => {
    try {
      const s = importScenario(await f.text());
      await loadScenario(s);
    } catch (e) {
      alert(`Could not import scenario: ${(e as Error).message}`);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◆</span> Factory Twin
        <span className="sub">Electronics assembly &amp; packaging</span>
      </div>
      <div className="clock" data-testid="clock">
        <span className="clock-time">{ui.clockLabel.replace(/\s*\(.*\)/, '')}</span>
        <span className={`shift ${shift === 'closed' ? 'closed' : ''}`}>{shift}</span>
      </div>
      <div className="group">
        <button className={`btn ${ui.paused ? 'accent' : ''}`} onClick={() => ui.setPaused(!ui.paused)} data-testid="play" title="Play / pause (space)">
          {ui.paused ? '▶ Play' : '❚❚ Pause'}
        </button>
        {SPEEDS.map((s) => (
          <button key={s} className={`btn small ${ui.speed === s && !ui.paused ? 'on' : ''}`} onClick={() => ui.setSpeed(s)} data-testid={`speed-${s}`}>
            {s}x
          </button>
        ))}
        <label className="check" title="Fast-forward through the closed night hours">
          <input type="checkbox" checked={ui.skipNight} onChange={(e) => ui.setSkipNight(e.target.checked)} /> skip night
        </label>
        <button className="btn small" onClick={() => reset()} title="Restart the current scenario from t = 0">
          ⟲ Reset
        </button>
      </div>
      <div className="group">
        <select
          className="select"
          value={ui.scenarioId}
          data-testid="scenario-select"
          onChange={(e) => {
            const p = presets(ui.seed).find((x) => x.id === e.target.value);
            if (p) void loadScenario(p.scenario);
          }}
        >
          {presets().map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {!presets().some((p) => p.id === ui.scenarioId) && <option value={ui.scenarioId}>{ui.scenarioName}</option>}
        </select>
        <label className="seed" title="Random seed (Enter to restart with it)">
          seed
          <input
            key={ui.seed}
            defaultValue={ui.seed}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void reset(Number((e.target as HTMLInputElement).value) || 1);
            }}
          />
        </label>
        <button className="btn small" onClick={exportJson} title="Export scenario (config, seed, injected events) as JSON">
          Export
        </button>
        <button className="btn small" onClick={() => file.current?.click()} title="Import a scenario JSON and replay it">
          Import
        </button>
        <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
      </div>
      <div className="group">
        {CAMS.map((c) => (
          <button
            key={c.mode}
            className={`btn small ${ui.cameraMode === c.mode ? 'on' : ''}`}
            disabled={(c.mode === 'focus' || c.mode === 'follow') && !ui.selection}
            title={c.title}
            onClick={() => ui.setCameraMode(c.mode)}
            data-testid={`cam-${c.mode}`}
          >
            {c.label}
          </button>
        ))}
        <button className={`btn small ${ui.showPerf ? 'on' : ''}`} onClick={() => ui.setShowPerf(!ui.showPerf)} title="Performance monitor">
          Perf
        </button>
      </div>
    </header>
  );
}
