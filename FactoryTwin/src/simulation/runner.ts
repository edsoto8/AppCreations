import type { RunSummary, Scenario } from './types';
import { Factory } from '../production/factory';
import { checkInvariants } from '../production/invariants';

export const DAY_SEC = 86400;

export interface RunOptions {
  days: number;
  keepLog?: boolean;
  /** Check invariants every N sim-seconds (0 = only at the end). */
  checkEvery?: number;
  /** Advance in chunks of this many sim-seconds (playback-like stepping). */
  stepSec?: number;
}

export interface RunResult {
  factory: Factory;
  summary: RunSummary;
  violations: string[];
  events: number;
}

/** Run a scenario headless (Node or worker) for N simulated days. */
export function runScenario(scenario: Scenario, opts: RunOptions): RunResult {
  const f = new Factory(scenario, { keepLog: opts.keepLog });
  const end = opts.days * DAY_SEC;
  const step = opts.stepSec ?? end;
  const violations: string[] = [];
  let nextCheck = opts.checkEvery && opts.checkEvery > 0 ? opts.checkEvery : Infinity;
  for (let t = Math.min(step, end); ; t = Math.min(t + step, end)) {
    if (nextCheck < t) {
      while (nextCheck < t) {
        f.engine.advanceTo(nextCheck);
        for (const v of checkInvariants(f)) violations.push(`t=${f.engine.now.toFixed(0)}: ${v}`);
        nextCheck += opts.checkEvery!;
      }
    }
    f.engine.advanceTo(t);
    if (t >= end) break;
  }
  for (const v of checkInvariants(f)) violations.push(`end: ${v}`);
  return { factory: f, summary: summarize(f, opts.days), violations, events: f.engine.processed };
}

/** Lateness of shipped orders plus overdue open orders, in order-hours. */
export function latenessHours(f: Factory): number {
  const now = f.engine.now;
  let open = 0;
  for (const o of f.orders.orders.values()) if (o.state !== 'shipped' && now > o.dueAt) open += now - o.dueAt;
  return (f.metrics.c.latenessSec + open) / 3600;
}

export function summarize(f: Factory, days: number): RunSummary {
  const now = f.engine.now;
  const m = f.metrics.snapshot(now);
  const t = m.totals;
  const late = latenessHours(f);
  const objective = (t.revenue - t.operatingCost - late * f.cfg.costs.latenessPenaltyPerHour) / days;
  const util: Record<string, number> = {};
  for (const [k, v] of Object.entries(m.current.utilization)) util[k] = v;
  return {
    seed: f.scenario.seed,
    days,
    unitsShipped: t.unitsShipped,
    unitsPacked: t.unitsPacked,
    throughputPerDay: t.unitsShipped / days,
    operatingCost: t.operatingCost,
    revenue: t.revenue,
    costPerUnit: t.unitsShipped > 0 ? t.operatingCost / t.unitsShipped : 0,
    onTimeRate: t.onTimeRate,
    avgOrderLeadTimeHours: t.avgOrderLeadTimeSec / 3600,
    latenessHours: late,
    objective,
    utilization: util,
    bottleneck: m.bottleneck.ranking[0]?.stage ?? '—',
    logHash: f.log.digest(),
  };
}
