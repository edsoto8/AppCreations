/**
 * Monte Carlo view model: picks the engine field for the selected dollar basis and shapes rows for
 * charts and tables. No financial formulas: percentiles, bands, histograms and the illustration all
 * come from the engine; this module only selects, labels and (for the deterministic illustration,
 * as the dashboard does) divides by each row's own deflator.
 */
import type {
  CapitalMarket,
  DollarBasis,
  Household,
  MonteCarloConfig,
  MonteCarloResult,
  ProjectionResult,
  SequenceRiskIllustration,
} from '@rn/engine';
import { agesLabel, inBasis } from '@/features/dashboard/viewModel';

/** Default seed (documented in the methodology panel): fixed so a first run is reproducible. */
export const DEFAULT_SEED = 42;
export const DEFAULT_PATHS = 10_000;
export const QUICK_RUN_PATHS = 1000;

/** Illustrative stochastic-inflation defaults (labeled as assumptions in the UI). */
export const DEFAULT_INFLATION_VOLATILITY = 0.01;
export const DEFAULT_INFLATION_CORRELATION: [number, number, number] = [0, 0, 0];

export const ASSET_CLASSES = ['stocks', 'bonds', 'cash'] as const;
export type AssetClassKey = (typeof ASSET_CLASSES)[number];
export const ASSET_LABELS: Record<AssetClassKey, string> = { stocks: 'Stocks', bonds: 'Bonds', cash: 'Cash' };

export function defaultConfig(seed = DEFAULT_SEED): MonteCarloConfig {
  return {
    paths: DEFAULT_PATHS,
    quickRunPaths: QUICK_RUN_PATHS,
    seed,
    inflation: { mode: 'fixed' },
    rebalancing: 'annual',
  };
}

/**
 * The correlation matrix the engine factors: the 3×3 asset correlations, bordered by inflation's
 * correlations when inflation is stochastic (order stocks, bonds, cash, inflation). Assembly only.
 */
export function correlationMatrix(cma: CapitalMarket, inflation: MonteCarloConfig['inflation'] | null): number[][] {
  const rows = cma.correlation.map((row) => [...row]);
  if (!inflation || inflation.mode !== 'stochastic') return rows;
  const c = inflation.correlationWithAssets;
  return [...rows.map((row, i) => [...row, c[i] ?? 0]), [...c, 1]];
}

/** A random uint32 seed for the "new seed" button (UI only; the engine never draws randomness). */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? DEFAULT_SEED;
}

export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Ending balance percentiles in the selected basis (real: each path's own deflator). */
export function endingPercentiles(result: MonteCarloResult, basis: DollarBasis) {
  const e = basis === 'nominal' ? result.ending : result.endingReal;
  return { p10: e.p10, p50: e.p50, p90: e.p90 };
}

export interface BandPoint {
  year: number;
  ages: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** [p10, p90] and [p25, p75] for range areas. */
  outer: [number, number];
  inner: [number, number];
}

/** Year-by-year percentile bands: `bandsReal` for today's dollars, `bands` for future dollars. */
export function bandPoints(
  result: MonteCarloResult,
  basis: DollarBasis,
  baseline: ProjectionResult | null,
  household: Household,
): BandPoint[] {
  const bands = basis === 'nominal' ? result.bands : result.bandsReal;
  const rows = new Map(baseline?.rows.map((r) => [r.year as number, r]) ?? []);
  return bands.map((b) => {
    const row = rows.get(b.year);
    return {
      year: b.year,
      ages: row ? agesLabel(row, household) : '',
      p10: b.p10,
      p25: b.p25,
      p50: b.p50,
      p75: b.p75,
      p90: b.p90,
      outer: [b.p10, b.p90],
      inner: [b.p25, b.p75],
    };
  });
}

export interface HistogramRow {
  from: number;
  to: number;
  count: number;
  /** Share of paths (count ÷ paths), for display. */
  share: number;
  /** Last bin also holds everything above its upper edge. */
  openEnded: boolean;
}

export function histogramRows(result: MonteCarloResult): HistogramRow[] {
  return result.histogram.map((h, i) => ({
    from: h.from,
    to: h.to,
    count: h.count,
    share: result.paths > 0 ? h.count / result.paths : 0,
    openEnded: i === result.histogram.length - 1,
  }));
}

export interface DepletionRow {
  age: number;
  count: number;
  share: number;
}

export function depletionRows(result: MonteCarloResult): DepletionRow[] {
  return result.depletionAgeCounts.map((d) => ({
    age: d.age,
    count: d.count,
    share: result.paths > 0 ? d.count / result.paths : 0,
  }));
}

/** Paths that run out before the planning age (sum of the engine's depletion counts). */
export function depletedPaths(result: MonteCarloResult): number {
  return result.depletionAgeCounts.reduce((n, d) => n + d.count, 0);
}

export interface SequencePoint {
  year: number;
  ages: string;
  baseline: number;
  bad: number;
  good: number;
  /** Deviation added to each account's return that year, or null outside the window. */
  badDeviation: number | null;
  goodDeviation: number | null;
}

/** Year-end portfolio for the three illustration runs, in the selected basis (row deflators). */
export function sequencePoints(
  illustration: SequenceRiskIllustration,
  household: Household,
  basis: DollarBasis,
): SequencePoint[] {
  const { baseline, badYearsFirst, goodYearsFirst, deviations, startYear } = illustration;
  const reversed = [...deviations].reverse();
  return baseline.rows.map((row, i) => {
    const bad = badYearsFirst.rows[i];
    const good = goodYearsFirst.rows[i];
    const k = row.year - startYear;
    const inWindow = k >= 0 && k < deviations.length;
    return {
      year: row.year,
      ages: agesLabel(row, household),
      baseline: inBasis(row.totals.portfolioEnd, row, basis),
      bad: bad ? inBasis(bad.totals.portfolioEnd, bad, basis) : 0,
      good: good ? inBasis(good.totals.portfolioEnd, good, basis) : 0,
      badDeviation: inWindow ? (deviations[k] ?? null) : null,
      goodDeviation: inWindow ? (reversed[k] ?? null) : null,
    };
  });
}

/** "−20%" / "+8%": a return deviation with an explicit sign. */
export function formatDeviation(d: number): string {
  const pts = Math.round(Math.abs(d) * 1000) / 10;
  if (pts === 0) return '0%';
  return `${d > 0 ? '+' : '−'}${pts}%`;
}

/** Whether two configs describe the same run (field by field; form values may carry extra keys). */
export function sameConfig(a: MonteCarloConfig, b: Partial<MonteCarloConfig> | undefined): boolean {
  if (!b || a.paths !== b.paths || a.seed !== b.seed || a.quickRunPaths !== b.quickRunPaths) return false;
  const x = a.inflation;
  const y = b.inflation;
  if (!y || x.mode !== y.mode) return false;
  if (x.mode === 'fixed' || y.mode === 'fixed') return true;
  return (
    x.median === y.median &&
    x.volatility === y.volatility &&
    x.correlationWithAssets.length === y.correlationWithAssets.length &&
    x.correlationWithAssets.every((v, i) => v === y.correlationWithAssets[i])
  );
}

/** Whether the plan changed since a run (households are plain data; compare their serialization). */
export function sameHousehold(a: Household, b: Household): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
