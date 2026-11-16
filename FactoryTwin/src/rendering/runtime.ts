import type { Scenario, SimHost } from '../simulation/types';
import { buildLayout, type FactoryLayout } from '../logistics/layout';
import { LocalSimHost } from '../simulation/host';
import { PlaybackController } from './playback';
import { SnapIndex } from './positions';
import { useUi } from '../store';

export interface SimRuntime {
  host: SimHost & { now?: number };
  playback: PlaybackController;
  layout: FactoryLayout;
  index: SnapIndex;
  scenario: Scenario;
  /** Bumped on every (re)load so scene components can remount. */
  generation: number;
}

/**
 * The live simulation runtime lives outside React. Components read it through `runtime.current`
 * inside useFrame (no per-tick React updates).
 */
export const runtime: { current: SimRuntime | null } = { current: null };
let generation = 0;
const listeners = new Set<() => void>();

export function onRuntimeChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function makeHost(): Promise<SimHost & { now?: number }> {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  if (params.get('worker') === '1') {
    const { WorkerSimHost } = await import('../workers/WorkerSimHost');
    return new WorkerSimHost();
  }
  return new LocalSimHost();
}

export async function loadScenario(s: Scenario): Promise<void> {
  const ui = useUi.getState();
  ui.setLoading(true);
  const prev = runtime.current;
  const host = await makeHost();
  await host.load(s);
  const playback = new PlaybackController();
  playback.speed = ui.speed;
  playback.paused = ui.paused;
  playback.skipNight = ui.skipNight;
  runtime.current = {
    host,
    playback,
    layout: buildLayout(s.config),
    index: new SnapIndex(),
    scenario: JSON.parse(JSON.stringify(s)) as Scenario,
    generation: ++generation,
  };
  prev?.host.dispose();
  ui.setScenarioMeta(s.id, s.name, s.seed);
  ui.select(null);
  ui.setLoading(false);
  listeners.forEach((l) => l());
}
