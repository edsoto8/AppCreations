import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppContext } from '../app/context';
import { useStore } from '../app/store';
import type { AppApi } from '../app/types';
import type { Command, RobotMode } from '../sim/mission/types';
import { canCommand } from '../sim/mission/transitions';
import { SeriesHistory } from './history';

/** The AppController API, or null while it is still mounting. */
export function useApi(): AppApi | null {
  return useContext(AppContext);
}

/** Current robot mode ('idle' before the first telemetry arrives). */
export function useMode(): RobotMode {
  return useStore((s) => s.telemetry?.mode ?? 'idle');
}

/** Whether a command is currently accepted, with the reason when it is not. */
export function useCan(type: Command['type']): { ok: boolean; reason?: string } {
  const mode = useStore((s) => s.telemetry?.mode);
  if (!mode) return { ok: false, reason: 'Simulation starting…' };
  return canCommand(mode, type);
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

// ---------------------------------------------------------------- history (sparklines)

export type TelemetryKey = 'battery' | 'coverage' | 'power';
export const telemetryHistory = new SeriesHistory<TelemetryKey>(['battery', 'coverage', 'power'], 160, 1);
export const fpsHistory = new SeriesHistory<'fps'>(['fps'], 60, 0, 'rolling');

let perfClock = 0;

/** Feed the sparkline histories from the store (call once from the app root). */
export function useHistoryFeed(): void {
  useEffect(() => {
    const unsub = useStore.subscribe((s, p) => {
      if (s.telemetry && s.telemetry !== p.telemetry) {
        const t = s.telemetry;
        telemetryHistory.push(t.time, { battery: t.battery * 100, coverage: t.coverage, power: t.powerW });
      }
      if (s.perf && s.perf !== p.perf) fpsHistory.push(perfClock++, { fps: s.perf.fps });
    });
    return unsub;
  }, []);
}

/** Subscribe a component to a history store (re-renders when a sample is added). */
export function useHistoryVersion(h: { subscribe: (fn: () => void) => () => void; getVersion: () => number }): number {
  return useSyncExternalStore(h.subscribe, h.getVersion, h.getVersion);
}
