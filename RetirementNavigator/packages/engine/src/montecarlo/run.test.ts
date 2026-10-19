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
import {
  impliedArithmeticMeans,
  monteCarloReadiness,
  prepareMonteCarlo,
  runMonteCarloChunk,
  runPreparedChunk,
  summarizeMonteCarlo,
} from './run';
import { Stream, cholesky } from './random';

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

describe('arithmetic means and readiness bands', () => {
  it('derives the arithmetic mean from the geometric median and volatility', () => {
    const cma = near().assumptions.capitalMarket;
    const m = impliedArithmeticMeans(cma);
    expect(m.stocks).toBeCloseTo((1 + cma.stocks.geometricReturn) * Math.exp(cma.stocks.volatility ** 2 / 2) - 1, 14);
    expect(m.cash).toBeGreaterThanOrEqual(cma.cash.geometricReturn);
  });

  it('bands success rates at 85% and 70%', () => {
    expect([0.9, 0.85, 0.849, 0.7, 0.699, 0].map(monteCarloReadiness)).toEqual([
      'onTrack',
      'onTrack',
      'borderline',
      'borderline',
      'atRisk',
      'atRisk',
    ]);
  });
});

describe('M6 review: shared work never changes a path; prepared runs; zero volatility with stochastic inflation', () => {
  const stochastic = (median = 0.03, volatility = 0.02): MonteCarloConfig =>
    config({ seed: 99, inflation: { mode: 'stochastic', median, volatility, correlationWithAssets: [0, 0.1, 0.3] } });

  it('each cached path equals an uncached projection of independently rebuilt draws (all samples, both rule sets)', () => {
    for (const rules of [fixtureRules(), RULES]) {
      const context = { currentYear: YEAR, rules };
      for (const s of SAMPLE_PROFILES) {
        const h = HouseholdSchema.parse({
          ...s.build(YEAR),
          assumptions: { ...s.build(YEAR).assumptions, granularity: 'annual' },
        });
        const c = stochastic();
        const chunk = run(h, c, 0, 34, context);
        const base = projectHousehold(h, context);
        if (base.status !== 'ok') throw new Error('baseline');
        const cma = h.assumptions.capitalMarket;
        const corr = c.inflation.mode === 'stochastic' ? c.inflation.correlationWithAssets : [0, 0, 0];
        const m = cma.correlation.map((row, i) => [...row, corr[i]!]);
        m.push([...corr, 1]);
        const L = cholesky(m)!;
        const years = base.value.rows.length;
        for (const p of [0, 7, 33]) {
          const stream = new Stream(99, p);
          const R: Map<string, number>[] = [];
          const I: number[] = [];
          for (let t = 0; t < years; t++) {
            const z = [0, 1, 2, 3].map(() => stream.normal());
            const e = [0, 1, 2, 3].map((i) => L[i]!.reduce((acc, v, j) => acc + v * z[j]!, 0));
            const row = base.value.rows[t]!;
            const byAccount = new Map<string, number>();
            for (const a of h.accounts) {
              const g = row.accounts.find((x) => x.accountId === a.id)!.appliedReturn;
              const shock = a.allocation
                ? a.allocation.stocks * cma.stocks.volatility * e[0]! +
                  a.allocation.bonds * cma.bonds.volatility * e[1]! +
                  a.allocation.cash * cma.cash.volatility * e[2]!
                : cma.blendedVolatility * e[0]!;
              byAccount.set(a.id, Math.exp(Math.log(1 + g) + shock) - 1);
            }
            R.push(byAccount);
            I.push(Math.exp(Math.log(1.03) + 0.02 * e[3]!) - 1);
          }
          const r = projectHousehold(h, context, {
            returnOverride: (t, id) => R[t - 1]!.get(id),
            inflationOverride: (t) => I[t - 1],
          });
          if (r.status !== 'ok') throw new Error('path');
          r.value.rows.forEach((row, y) => {
            expect(chunk.balances[p * years + y]).toBe(row.totals.portfolioEnd / 100);
            expect(chunk.balancesReal[p * years + y]).toBe(row.real.portfolioEnd / 100);
          });
          expect(chunk.success[p]).toBe(r.value.summary.deterministicSuccess ? 1 : 0);
          expect(chunk.depletionAge[p]).toBe(r.value.summary.depletionAge ?? -1);
        }
      }
    }
  });

  it('zero volatility with stochastic inflation at the plan’s own rate equals the baseline, nominal and real', () => {
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
    const chunk = run(flat, stochastic(flat.assumptions.inflation, 0), 0, 3);
    deterministic.value.rows.forEach((row, y) => {
      expect(Math.abs(chunk.balances[y]! - row.totals.portfolioEnd / 100)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(chunk.balancesReal[y]! - row.real.portfolioEnd / 100)).toBeLessThanOrEqual(0.01);
    });
  });

  it('a prepared run gives the same chunks as runMonteCarloChunk, in any split', () => {
    const h = near();
    const c = stochastic();
    const prepared = prepareMonteCarlo(h, ctx, c);
    if (prepared.status !== 'ok') throw new Error('prepare');
    const parts = [
      runPreparedChunk(prepared.value, { pathStart: 0, pathEnd: 11 }),
      runPreparedChunk(prepared.value, { pathStart: 11, pathEnd: 30 }),
    ].map((r) => {
      if (r.status !== 'ok') throw new Error('chunk');
      return r.value;
    });
    same(mergeChunks(parts), run(h, c, 0, 30));
    expect(runPreparedChunk(prepared.value, { pathStart: 3, pathEnd: 2 }).status).toBe('invalid');
  });

  it('spans the histogram to the largest ending balance when almost every path ends at zero', () => {
    const chunk: MonteCarloChunk = {
      pathStart: 0,
      pathEnd: 200,
      years: 1,
      balances: new Float64Array(200).map((_, i) => (i === 199 ? 50_000 : 0)),
      balancesReal: new Float64Array(200).map((_, i) => (i === 199 ? 40_000 : 0)),
      success: new Uint8Array(200),
      depletionAge: new Int16Array(200).fill(80),
    };
    const r = summarizeMonteCarlo([chunk], config(), near(), YEAR as CalendarYear);
    expect(r.histogram.at(-1)!.to).toBe(4_000_000);
    expect(r.histogram.at(-1)!.count).toBe(1);
  });
});
