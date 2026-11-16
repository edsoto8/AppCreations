import { useEffect, useState } from 'react';
import { useUi } from '../store';
import { loadScenario, onRuntimeChange, runtime } from '../rendering/runtime';
import { clockInfo } from '../simulation/clock';
import { presets } from '../scenarios/presets';
import { TopBar } from './TopBar';
import { SidePanel } from './SidePanel';
import { FactoryCanvas } from '../rendering/FactoryCanvas';
import { HoverTooltip } from './HoverTooltip';
import { PerfOverlay } from './PerfOverlay';
import { Legend } from './Legend';

/**
 * Optional URL state for demos and screenshots: ?scenario=breakdown&t=9.5 (sim hours to
 * fast-forward) &paused=1 &speed=10 &select=station:cell-1 &cam=focus &tab=dashboard &perf=1
 */
function applyUrlState(params: URLSearchParams) {
  const rt = runtime.current;
  const ui = useUi.getState();
  if (!rt) return;
  const t = Number(params.get('t'));
  if (t > 0) {
    rt.host.advanceTo(t * 3600);
    rt.playback.renderTime = t * 3600;
    rt.index.update(rt.host.snapshot);
  }
  if (params.get('speed')) ui.setSpeed(Number(params.get('speed')));
  if (params.get('paused') === '1') ui.setPaused(true);
  const sel = params.get('select');
  if (sel) {
    const [kind, id] = sel.split(':');
    ui.select({ kind: kind as 'station', id });
  }
  const cam = params.get('cam');
  if (cam) ui.setCameraMode(cam as 'orbit');
  const tab = params.get('tab');
  if (tab) ui.setTab(tab as 'dashboard');
  if (params.get('perf') === '1') ui.setShowPerf(true);
}

export function App() {
  const [gen, setGen] = useState(0);
  const paused = useUi((s) => s.paused);
  const speed = useUi((s) => s.speed);
  const skipNight = useUi((s) => s.skipNight);
  const showPerf = useUi((s) => s.showPerf);
  const loading = useUi((s) => s.loading);

  useEffect(() => {
    const off = onRuntimeChange(() => setGen(runtime.current?.generation ?? 0));
    const params = new URLSearchParams(location.search);
    const id = params.get('scenario') ?? 'normal';
    const preset = presets().find((p) => p.id === id) ?? presets()[0];
    void loadScenario(preset.scenario).then(() => applyUrlState(params));
    return () => {
      off();
    };
  }, []);

  // push playback controls into the (non-React) playback controller
  useEffect(() => {
    const pb = runtime.current?.playback;
    if (!pb) return;
    pb.paused = paused;
    pb.speed = speed;
    pb.skipNight = skipNight;
  }, [paused, speed, skipNight, gen]);

  // throttled dashboard samples: at most 4 React updates per second
  useEffect(() => {
    const id = setInterval(() => {
      const rt = runtime.current;
      if (!rt) return;
      const t = rt.playback.renderTime;
      useUi.getState().setMetrics(rt.host.metrics, clockInfo(t, rt.scenario.config.shifts).label, t);
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <div className="viewport">
          {gen > 0 && <FactoryCanvas key={gen} />}
          <HoverTooltip />
          <Legend />
          {showPerf && <PerfOverlay />}
          {loading && <div className="loading">Loading factory…</div>}
        </div>
        <SidePanel />
      </div>
    </div>
  );
}
