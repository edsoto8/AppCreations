/**
 * Monte Carlo summary (docs/financial-model.md §11): nearest-rank percentiles, chunk merging in path
 * order, and the result fields built from hand-made chunks.
 */
import { describe, expect, it } from 'vitest';
import type { CalendarYear } from '../domain/primitives';
import type { MonteCarloChunk, MonteCarloConfig } from '../domain/montecarlo';
import { CONTRACT_VERSION } from '../contractVersion';
import { dollars } from '../money';
import { mergeChunks, percentile, summarize } from './summary';

/** A chunk for paths [start, end) with 2 years; path p ends at (p + 1) × $1,000 nominal, half that real. */
function chunk(start: number, end: number, depletion: (p: number) => number = () => -1): MonteCarloChunk {
  const n = end - start;
  const years = 2;
  const balances = new Float64Array(n * years);
  const balancesReal = new Float64Array(n * years);
  const success = new Uint8Array(n);
  const depletionAge = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const p = start + i;
    balances[i * years] = 500 * (p + 1);
    balances[i * years + 1] = 1_000 * (p + 1);
    balancesReal[i * years] = 400 * (p + 1);
    balancesReal[i * years + 1] = 500 * (p + 1);
    success[i] = p % 2 === 0 ? 1 : 0;
    depletionAge[i] = depletion(p);
  }
  return { pathStart: start, pathEnd: end, years, balances, balancesReal, success, depletionAge };
}

const config: MonteCarloConfig = {
  paths: 1000,
  quickRunPaths: 1000,
  seed: 7,
  inflation: { mode: 'fixed' },
  rebalancing: 'annual',
};
const extras = {
  impliedArithmeticMeans: { stocks: 0.07, bonds: 0.04, cash: 0.02 },
  assumptions: ['test'],
  minimumEndingReal: 0,
};

describe('percentile (nearest rank)', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it('takes the ceil(q·n)-th value, clamped to the first and last', () => {
    expect(percentile(sorted, 0.1)).toBe(1);
    expect(percentile(sorted, 0.25)).toBe(3);
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.9)).toBe(9);
    expect(percentile(sorted, 1)).toBe(10);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(new Float64Array([4]), 0.5)).toBe(4);
  });

  it('is 0 for an empty sample', () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('mergeChunks', () => {
  it('concatenates chunks in path order whatever order they arrive in', () => {
    const whole = chunk(0, 10);
    const merged = mergeChunks([chunk(6, 10), chunk(0, 3), chunk(3, 6)]);
    expect(merged.pathStart).toBe(0);
    expect(merged.pathEnd).toBe(10);
    expect([...merged.balances]).toEqual([...whole.balances]);
    expect([...merged.balancesReal]).toEqual([...whole.balancesReal]);
    expect([...merged.success]).toEqual([...whole.success]);
  });

  it('rejects chunks that leave a gap', () => {
    expect(() => mergeChunks([chunk(0, 3), chunk(4, 10)])).toThrow(RangeError);
  });

  it('merges nothing into an empty result', () => {
    expect(mergeChunks([]).pathEnd).toBe(0);
  });
});

describe('summarize', () => {
  const first = 2026 as CalendarYear;

  it('reports success, ending percentiles, bands, a histogram and depletion ages', () => {
    const depletion = (p: number) => (p === 1 ? 88 : p === 3 || p === 5 ? 84 : -1);
    const r = summarize([chunk(5, 10, depletion), chunk(0, 5, depletion)], config, first, extras);
    expect(r.contractVersion).toBe(CONTRACT_VERSION);
    expect(r.paths).toBe(10);
    expect(r.seed).toBe(7);
    expect(r.successRate).toBe(0.5);
    // Nominal endings $1,000 … $10,000: p10 = 1st, p50 = 5th, p90 = 9th; mean $5,500.
    expect(r.ending).toEqual({ p10: dollars(1_000), p50: dollars(5_000), p90: dollars(9_000), mean: dollars(5_500) });
    expect(r.endingReal).toEqual({ p10: dollars(500), p50: dollars(2_500), p90: dollars(4_500) });
    expect(r.bands).toHaveLength(2);
    expect(r.bands[0]).toEqual({
      year: 2026,
      p10: dollars(500),
      p25: dollars(1_500),
      p50: dollars(2_500),
      p75: dollars(4_000),
      p90: dollars(4_500),
    });
    expect(r.bandsReal[1]!.year).toBe(2027);
    expect(r.bandsReal[1]!.p50).toBe(dollars(2_500));
    // 20 bins from 0 to the 99th percentile ($5,000 real); the top bin also holds the maximum.
    expect(r.histogram).toHaveLength(20);
    expect(r.histogram.reduce((n, b) => n + b.count, 0)).toBe(10);
    expect(r.histogram[0]!.from).toBe(0);
    expect(r.histogram[19]!.to).toBe(dollars(5_000));
    expect(r.histogram[19]!.count).toBe(1);
    expect(r.depletionAgeCounts).toEqual([
      { age: 84, count: 2 },
      { age: 88, count: 1 },
    ]);
    expect(r.label).toBe('Model-dependent estimate, not a guarantee.');
    expect(r.assumptions).toEqual(['test']);
  });

  it('handles no paths without dividing by zero', () => {
    const r = summarize([], config, first, extras);
    expect(r.paths).toBe(0);
    expect(r.successRate).toBe(0);
    expect(r.ending.mean).toBe(0);
    expect(r.bands).toEqual([]);
  });
});
