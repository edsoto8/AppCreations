/**
 * Monte Carlo benchmark (brief §9: 10,000 paths × 60-year horizon, with withdrawals and the
 * simplified tax model, < 3 s on a typical laptop, < 10 s on a mid-range phone). This measures one
 * thread in Node; the app splits paths across Web Workers (one per core, up to 4), so the wall time
 * there is about this time ÷ workers. The browser measurement (real workers) is recorded by the
 * Playwright Monte Carlo spec. Run with `pnpm bench`; results go to bench/results/montecarlo.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { expect, it } from 'vitest';
import { HouseholdSchema } from '../src/domain/household';
import { RULES, SAMPLE_PROFILES, runMonteCarloChunk, summarizeMonteCarlo } from '../src/index';
import type { CalendarYear } from '../src/domain/primitives';
import type { MonteCarloConfig } from '../src/domain/montecarlo';
import { fixtureRules } from '../src/testing/fixtureRules';

const YEAR = 2026;
const PATHS = 10_000;

it('10,000 paths over a 60-year horizon, single thread', () => {
  const sample = SAMPLE_PROFILES.find((s) => s.id === 'midCareerCouple')!.build(YEAR);
  // Planning ages set so the horizon is exactly 60 years.
  const last = YEAR + 59;
  const household = HouseholdSchema.parse({
    ...sample,
    people: sample.people.map((p) => ({ ...p, planningAge: last - p.birthYear })),
  });
  const config: MonteCarloConfig = {
    paths: PATHS,
    quickRunPaths: 1000,
    seed: 1,
    inflation: { mode: 'stochastic', median: 0.025, volatility: 0.015, correlationWithAssets: [0, 0.1, 0.4] },
    rebalancing: 'annual',
  };
  const results: Record<string, unknown>[] = [];
  for (const [rulesName, rules] of [
    ['bundled (unverified; before taxes)', RULES],
    ['synthetic fixture (verified path; taxes and gross-up)', fixtureRules()],
  ] as const) {
    const ctx = { currentYear: YEAR, rules };
    runMonteCarloChunk(household, ctx, config, { pathStart: 0, pathEnd: 200 }); // warm-up
    const t0 = performance.now();
    const quick = runMonteCarloChunk(household, ctx, config, { pathStart: 0, pathEnd: 1000 });
    const t1 = performance.now();
    const full = runMonteCarloChunk(household, ctx, config, { pathStart: 0, pathEnd: PATHS });
    const t2 = performance.now();
    if (quick.status !== 'ok' || full.status !== 'ok') throw new Error('run failed');
    const summary = summarizeMonteCarlo([full.value], config, household, YEAR as CalendarYear);
    const t3 = performance.now();
    const fullMs = t2 - t1;
    results.push({
      rules: rulesName,
      years: full.value.years,
      quickRun1000Ms: Math.round(t1 - t0),
      full10000Ms: Math.round(fullMs),
      summarizeMs: Math.round(t3 - t2),
      msPerPath: Number((fullMs / PATHS).toFixed(3)),
      projectedWallMs4Workers: Math.round(fullMs / 4 + (t3 - t2)),
      successRate: summary.successRate,
    });
  }
  const hardware = { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, node: process.version };
  console.table(results);
  console.log('hardware', hardware);
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('./results/montecarlo.json', import.meta.url),
    `${JSON.stringify({ measuredOn: hardware, target: '10,000 paths × 60 years < 3 s (laptop), < 10 s (phone)', note: 'Single Node thread; the app divides paths across up to 4 Web Workers (projected wall time = full ÷ 4 + summarize, not a measurement).', results }, null, 2)}\n`,
  );
  expect(results).toHaveLength(2);
});
