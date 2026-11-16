import type { CandidateResult, RunSummary, Scenario, Stat } from '../simulation/types';
import { runScenario } from '../simulation/runner';

export function stat(xs: number[]): Stat {
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / Math.max(1, n);
  const std = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, std, min: Math.min(...xs), max: Math.max(...xs) };
}

/** Run a scenario with several seeds (common random numbers across candidates) and aggregate. */
export function evaluate(s: Scenario, seeds: number[], days: number, params: Record<string, number> = {}): CandidateResult {
  const runs: RunSummary[] = seeds.map((seed) => runScenario({ ...s, seed }, { days }).summary);
  return {
    params,
    runs,
    objective: stat(runs.map((r) => r.objective)),
    throughputPerDay: stat(runs.map((r) => r.throughputPerDay)),
    operatingCost: stat(runs.map((r) => r.operatingCost)),
    onTimeRate: stat(runs.map((r) => r.onTimeRate)),
  };
}

export interface Comparison {
  baseline: CandidateResult;
  variant: CandidateResult;
  rows: { metric: string; baseline: Stat; variant: Stat; better: 'higher' | 'lower' }[];
  bottlenecks: { baseline: string[]; variant: string[] };
}

/** Side-by-side comparison of two scenarios on the same seeds. */
export function compare(baseline: Scenario, variant: Scenario, seeds: number[], days: number): Comparison {
  const a = evaluate(baseline, seeds, days);
  const b = evaluate(variant, seeds, days);
  const pick = (r: CandidateResult, f: (x: RunSummary) => number) => stat(r.runs.map(f));
  const rows: Comparison['rows'] = [
    { metric: 'Throughput (units shipped / day)', baseline: a.throughputPerDay, variant: b.throughputPerDay, better: 'higher' },
    { metric: 'Operating cost (total)', baseline: a.operatingCost, variant: b.operatingCost, better: 'lower' },
    { metric: 'Cost per unit', baseline: pick(a, (x) => x.costPerUnit), variant: pick(b, (x) => x.costPerUnit), better: 'lower' },
    { metric: 'On-time orders', baseline: a.onTimeRate, variant: b.onTimeRate, better: 'higher' },
    { metric: 'Order lead time (h)', baseline: pick(a, (x) => x.avgOrderLeadTimeHours), variant: pick(b, (x) => x.avgOrderLeadTimeHours), better: 'lower' },
    { metric: 'Lateness (order-hours)', baseline: pick(a, (x) => x.latenessHours), variant: pick(b, (x) => x.latenessHours), better: 'lower' },
    { metric: 'Assembly utilisation', baseline: pick(a, (x) => x.utilization.Assembly ?? 0), variant: pick(b, (x) => x.utilization.Assembly ?? 0), better: 'higher' },
    { metric: 'Inspection utilisation', baseline: pick(a, (x) => x.utilization.Inspection ?? 0), variant: pick(b, (x) => x.utilization.Inspection ?? 0), better: 'higher' },
    { metric: 'Packaging utilisation', baseline: pick(a, (x) => x.utilization.Packaging ?? 0), variant: pick(b, (x) => x.utilization.Packaging ?? 0), better: 'higher' },
    { metric: 'Objective ($/day)', baseline: a.objective, variant: b.objective, better: 'higher' },
  ];
  return { baseline: a, variant: b, rows, bottlenecks: { baseline: a.runs.map((r) => r.bottleneck), variant: b.runs.map((r) => r.bottleneck) } };
}
