/**
 * Monte Carlo gates (BRIEF M6): seed determinism, quick-run equality and chunking independence,
 * zero volatility reproduces the deterministic baseline, PSD validation; plus the return model's
 * median and the per-path real series under stochastic inflation.
 */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type Household } from '../domain/household';
import type { CalendarYear } from '../domain/primitives';
import type { MonteCarloChunk, MonteCarloConfig } from '../domain/montecarlo';
import { SAMPLE_PROFILES } from '../samples/profiles';
import { projectHousehold } from '../projection/project';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import { RULES } from '../rules/index';
import * as api from '../api';
import { mergeChunks } from './summary';
import { runMonteCarloChunk, summarizeMonteCarlo } from './run';

const YEAR = FIXTURE_YEAR;
const ctx = { currentYear: YEAR, rules: fixtureRules() };
const near = () => SAMPLE_PROFILES.find((s) => s.id === 'nearRetirement')!.build(YEAR);
const config = (over: Partial<MonteCarloConfig> = {}): MonteCarloConfig => ({
  paths: 1000,
  quickRunPaths: 1000,
  seed: 20261019,
  inflation: { mode: 'fixed' },
  rebalancing: 'annual',
  ...over,
});
const run = (h: Household, c: MonteCarloConfig, pathStart: number, pathEnd: number, context = ctx) => {
  const r = runMonteCarloChunk(h, context, c, { pathStart, pathEnd });
  if (r.status !== 'ok') throw new Error(JSON.stringify(r));
  return r.value;
};
const same = (a: MonteCarloChunk, b: MonteCarloChunk) => {
  expect([...a.balances]).toEqual([...b.balances]);
  expect([...a.balancesReal]).toEqual([...b.balancesReal]);
  expect([...a.success]).toEqual([...b.success]);
  expect([...a.depletionAge]).toEqual([...b.depletionAge]);
};

describe('Monte Carlo runner', () => {
  it('is wired into the frozen API', () => {
    expect(api.runMonteCarloChunk).toBe(runMonteCarloChunk);
    expect(api.summarizeMonteCarlo).toBe(summarizeMonteCarlo);
    expect(api.isPositiveSemiDefinite([[1]])).toBe(true);
  });

  it('gives identical results for the same seed and inputs, and different ones for another seed', () => {
    const h = near();
    same(run(h, config(), 0, 40), run(h, config(), 0, 40));
    const other = run(h, config({ seed: 7 }), 0, 40);
    expect([...other.balances]).not.toEqual([...run(h, config(), 0, 40).balances]);
  });

  it('does not depend on chunking or the path count: the quick run is a prefix of the full run', () => {
    const h = near();
    const whole = run(h, config({ paths: 2000 }), 0, 60);
    const pieces = mergeChunks([run(h, config(), 35, 60), run(h, config(), 0, 20), run(h, config(), 20, 35)]);
    same(whole, pieces);
    const quick = run(h, config({ paths: 1000 }), 0, 25);
    expect([...quick.balances]).toEqual([...whole.balances.slice(0, 25 * whole.years)]);
  });

  it('with zero volatility every path equals the deterministic baseline (taxes and withdrawals included)', () => {
    const base = near();
    const cma = base.assumptions.capitalMarket;
    const flat = HouseholdSchema.parse({
      ...base,
      assumptions: {
        ...base.assumptions,
        capitalMarket: {
          ...cma,
          stocks: { ...cma.stocks, volatility: 0 },
          bonds: { ...cma.bonds, volatility: 0 },
          cash: { ...cma.cash, volatility: 0 },
          blendedVolatility: 0,
        },
      },
    });
    const deterministic = projectHousehold(flat, ctx);
    if (deterministic.status !== 'ok') throw new Error('baseline');
    const chunk = run(flat, config(), 0, 5);
    const rows = deterministic.value.rows;
    for (let p = 0; p < 5; p++) {
      rows.forEach((row, y) => {
        // exp(ln(1 + g)) − 1 differs from g by float rounding only: within a cent.
        expect(Math.abs(chunk.balances[p * chunk.years + y]! - row.totals.portfolioEnd / 100)).toBeLessThanOrEqual(
          0.01,
        );
      });
      expect(chunk.success[p]).toBe(deterministic.value.summary.deterministicSuccess ? 1 : 0);
    }
    const result = summarizeMonteCarlo([chunk], config(), flat, YEAR as CalendarYear);
    expect(Math.abs(result.ending.p50 - deterministic.value.summary.endingBalance)).toBeLessThanOrEqual(1);
    expect(result.successRate).toBe(deterministic.value.summary.deterministicSuccess ? 1 : 0);
  });

  it('centers each year’s return on the baseline return (median), with the arithmetic mean above it', () => {
    // One cash-only account with an allocation of 100% stocks: its median growth factor over many
    // paths is the baseline's.
    const h = HouseholdSchema.parse({
      ...near(),
      accounts: near()
        .accounts.slice(0, 1)
        .map((a) => ({ ...a, allocation: { stocks: 1, bonds: 0, cash: 0 }, contribution: null })),
      oneTimeEvents: [],
      pensions: [],
    });
    const chunk = run(h, config(), 0, 400);
    const deterministic = projectHousehold(h, ctx);
    if (deterministic.status !== 'ok') throw new Error('baseline');
    const first = deterministic.value.rows[0]!;
    const median = [...Array(400).keys()].map((p) => chunk.balances[p * chunk.years]!).sort((x, y) => x - y)[200]!;
    // Year 1 end balance: the median path is within 4% of the baseline at 400 paths.
    expect(Math.abs(median / (first.totals.portfolioEnd / 100) - 1)).toBeLessThan(0.04);
    const result = summarizeMonteCarlo([chunk], config(), h, YEAR as CalendarYear);
    const s = h.assumptions.capitalMarket.stocks;
    expect(result.impliedArithmeticMeans.stocks).toBeCloseTo(
      (1 + s.geometricReturn) * Math.exp(s.volatility ** 2 / 2) - 1,
      12,
    );
    expect(result.label).toBe('Model-dependent estimate, not a guarantee.');
    expect(result.assumptions.join(' ')).toContain('seed 20261019');
  });

  it('gives each path its own real series under stochastic inflation', () => {
    const h = near();
    const chunk = run(
      h,
      config({
        inflation: { mode: 'stochastic', median: 0.025, volatility: 0.02, correlationWithAssets: [0, 0.1, 0.3] },
      }),
      0,
      30,
    );
    const ratios = new Set<number>();
    const y = 10; // mid-horizon, before any path can be depleted
    for (let p = 0; p < 30; p++)
      ratios.add(Math.round((chunk.balances[p * chunk.years + y]! / chunk.balancesReal[p * chunk.years + y]!) * 1e6));
    expect(ratios.size).toBeGreaterThan(25); // deflators differ by path
  });

  it('rejects a correlation matrix that is not positive semi-definite, and bad ranges or configs', () => {
    const h = near();
    const bad = runMonteCarloChunk(
      h,
      ctx,
      config({
        inflation: { mode: 'stochastic', median: 0.02, volatility: 0.01, correlationWithAssets: [0.99, -0.99, 0.99] },
      }),
      { pathStart: 0, pathEnd: 10 },
    );
    expect(bad.status).toBe('invalid');
    if (bad.status === 'invalid') expect(bad.issues[0]!.message).toMatch(/not positive semi-definite/);
    expect(runMonteCarloChunk(h, ctx, config(), { pathStart: 10, pathEnd: 10 }).status).toBe('invalid');
    expect(runMonteCarloChunk(h, ctx, config({ paths: 5 }), { pathStart: 0, pathEnd: 10 }).status).toBe('invalid');
    expect(runMonteCarloChunk(h, ctx, config(), { pathStart: 0, pathEnd: 10_001 }).status).toBe('invalid');
  });

  it('runs with the bundled (unverified) rules, before taxes like the deterministic forecast', () => {
    const chunk = run(near(), config(), 0, 5, { currentYear: YEAR, rules: RULES });
    expect(chunk.pathEnd - chunk.pathStart).toBe(5);
    expect(chunk.balances.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
});

describe('Monte Carlo error paths and stochastic summary', () => {
  it('returns invalid for a household that fails validation or cannot project', () => {
    const h = near();
    expect(runMonteCarloChunk({ ...h, people: [] } as never, ctx, config(), { pathStart: 0, pathEnd: 2 }).status).toBe(
      'invalid',
    );
    const past = HouseholdSchema.parse({
      ...h,
      people: h.people.map((p) => ({ ...p, retirementAge: 30, planningAge: YEAR - p.birthYear - 1 })),
    });
    expect(runMonteCarloChunk(past, ctx, config(), { pathStart: 0, pathEnd: 2 }).status).toBe('invalid');
  });

  it('states stochastic inflation in the assumptions beside the success rate', () => {
    const c = config({
      inflation: { mode: 'stochastic', median: 0.03, volatility: 0.01, correlationWithAssets: [0, 0, 0] },
    });
    const chunk = run(near(), c, 0, 3);
    const result = summarizeMonteCarlo([chunk], c, near(), YEAR as CalendarYear);
    expect(result.assumptions.join(' ')).toContain('Inflation: stochastic, median 3%, volatility 1%.');
    const fixed = summarizeMonteCarlo([chunk], config(), near(), YEAR as CalendarYear);
    expect(fixed.assumptions.join(' ')).toMatch(/Inflation: fixed at/);
  });
});
