/**
 * Merge Monte Carlo chunks into a result (docs/financial-model.md §11): success rate, ending
 * distribution, year-by-year percentile bands (nominal, and real with each path's own deflator),
 * a real ending-balance histogram and depletion ages. Percentiles use the nearest-rank method on the
 * sorted values (documented). Bands are percentile bands, never confidence intervals.
 */
import type { CalendarYear, Cents } from '../domain/primitives';
import type { MonteCarloChunk, MonteCarloConfig, MonteCarloResult, PercentileBand } from '../domain/montecarlo';
import { CONTRACT_VERSION } from '../contractVersion';
import { toCents } from '../money';

/** Nearest-rank percentile of a sorted array (q in [0, 1]). */
export function percentile(sorted: Float64Array | number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1] ?? 0;
}

function bandsFrom(values: Float64Array, paths: number, years: number, firstYear: number): PercentileBand[] {
  const out: PercentileBand[] = [];
  const column = new Float64Array(paths);
  for (let y = 0; y < years; y++) {
    for (let p = 0; p < paths; p++) column[p] = values[p * years + y] ?? 0;
    column.sort();
    out.push({
      year: (firstYear + y) as CalendarYear,
      p10: toCents(percentile(column, 0.1)),
      p25: toCents(percentile(column, 0.25)),
      p50: toCents(percentile(column, 0.5)),
      p75: toCents(percentile(column, 0.75)),
      p90: toCents(percentile(column, 0.9)),
    });
  }
  return out;
}

export interface SummaryExtras {
  impliedArithmeticMeans: MonteCarloResult['impliedArithmeticMeans'];
  assumptions: string[];
}

/** Concatenate chunks in path order (they must cover 0..paths−1 contiguously). */
export function mergeChunks(chunks: readonly MonteCarloChunk[]): MonteCarloChunk {
  const sorted = [...chunks].sort((a, b) => a.pathStart - b.pathStart);
  const years = sorted[0]?.years ?? 0;
  const paths = sorted.reduce((n, c) => n + (c.pathEnd - c.pathStart), 0);
  const balances = new Float64Array(paths * years);
  const balancesReal = new Float64Array(paths * years);
  const success = new Uint8Array(paths);
  const depletionAge = new Int16Array(paths);
  let offset = 0;
  for (const c of sorted) {
    if (c.pathStart !== offset) throw new RangeError('Monte Carlo chunks must be contiguous from path 0');
    balances.set(c.balances, offset * years);
    balancesReal.set(c.balancesReal, offset * years);
    success.set(c.success, offset);
    depletionAge.set(c.depletionAge, offset);
    offset = c.pathEnd;
  }
  return { pathStart: 0, pathEnd: paths, years, balances, balancesReal, success, depletionAge };
}

export function summarize(
  chunks: readonly MonteCarloChunk[],
  config: MonteCarloConfig,
  firstYear: CalendarYear,
  extras: SummaryExtras,
): MonteCarloResult {
  const m = mergeChunks(chunks);
  const paths = m.pathEnd;
  const years = m.years;
  const ending = new Float64Array(paths);
  const endingReal = new Float64Array(paths);
  let successes = 0;
  let sum = 0;
  for (let p = 0; p < paths; p++) {
    ending[p] = m.balances[p * years + years - 1] ?? 0;
    endingReal[p] = m.balancesReal[p * years + years - 1] ?? 0;
    sum += ending[p] ?? 0;
    successes += m.success[p] ?? 0;
  }
  ending.sort();
  endingReal.sort();

  // Histogram of real ending balances: 20 equal-width bins from 0 to the 99th percentile (the top bin
  // also holds everything above it). When nearly every path ends at 0, the bins span to the largest
  // ending balance instead, so they stay meaningful.
  const p99 = percentile(endingReal, 0.99);
  const top = Math.max(1, p99 > 0 ? p99 : percentile(endingReal, 1));
  const bins = 20;
  const width = top / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let p = 0; p < paths; p++) {
    const v = endingReal[p] ?? 0;
    const k = Math.min(bins - 1, Math.max(0, Math.floor(v / width)));
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const depletion = new Map<number, number>();
  for (let p = 0; p < paths; p++) {
    const age = m.depletionAge[p] ?? -1;
    if (age >= 0) depletion.set(age, (depletion.get(age) ?? 0) + 1);
  }
  return {
    contractVersion: CONTRACT_VERSION,
    paths,
    seed: config.seed,
    algorithm: 'xoshiro128**/splitmix32(hash32(seed,path))/box-muller',
    successRate: paths > 0 ? successes / paths : 0,
    ending: {
      p10: toCents(percentile(ending, 0.1)),
      p50: toCents(percentile(ending, 0.5)),
      p90: toCents(percentile(ending, 0.9)),
      mean: toCents(paths > 0 ? sum / paths : 0),
    },
    endingReal: {
      p10: toCents(percentile(endingReal, 0.1)),
      p50: toCents(percentile(endingReal, 0.5)),
      p90: toCents(percentile(endingReal, 0.9)),
    },
    bands: bandsFrom(m.balances, paths, years, firstYear),
    bandsReal: bandsFrom(m.balancesReal, paths, years, firstYear),
    histogram: counts.map((count, k) => ({
      from: toCents(k * width) as Cents,
      to: toCents((k + 1) * width) as Cents,
      count,
    })),
    depletionAgeCounts: [...depletion.entries()].sort((a, b) => a[0] - b[0]).map(([age, count]) => ({ age, count })),
    impliedArithmeticMeans: extras.impliedArithmeticMeans,
    label: 'Model-dependent estimate, not a guarantee.',
    assumptions: extras.assumptions,
  };
}
