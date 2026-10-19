/**
 * Deterministic dashboard recalculation benchmark (brief §9: target < 100 ms for a typical profile).
 * One "recalculation" is `computeDashboard`: the baseline plus the optimistic and pessimistic reruns.
 * Run with `pnpm bench`; the hardware is printed with the results and written to bench/results/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { expect, it } from 'vitest';
import { HouseholdSchema } from '../src/domain/household';
import { RULES, SAMPLE_PROFILES, computeDashboard } from '../src/index';
import { fixtureRules } from '../src/testing/fixtureRules';

const YEAR = 2026;
const WARMUP = 20;
const RUNS = 100;

function measure(fn: () => void): { medianMs: number; p95Ms: number; maxMs: number } {
  for (let i = 0; i < WARMUP; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
  return { medianMs: at(0.5), p95Ms: at(0.95), maxMs: times[times.length - 1] ?? 0 };
}

it('dashboard recalculation per sample profile', () => {
  const results: Record<string, unknown>[] = [];
  for (const sample of SAMPLE_PROFILES) {
    const h = sample.build(YEAR);
    for (const [rulesName, rules] of [
      ['bundled (unverified)', RULES],
      ['synthetic fixture (verified path)', fixtureRules()],
    ] as const) {
      for (const granularity of ['annual', 'monthly'] as const) {
        const household = HouseholdSchema.parse({ ...h, assumptions: { ...h.assumptions, granularity } });
        const ctx = { currentYear: YEAR, rules };
        const years = (() => {
          const r = computeDashboard(household, ctx);
          return r.status === 'ok' ? r.value.baseline.rows.length : 0;
        })();
        const m = measure(() => computeDashboard(household, ctx));
        results.push({ profile: sample.id, rules: rulesName, granularity, years, ...m });
      }
    }
  }
  const hardware = { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, node: process.version };
  console.table(
    results.map((r) => ({
      ...r,
      medianMs: Number((r.medianMs as number).toFixed(2)),
      p95Ms: Number((r.p95Ms as number).toFixed(2)),
      maxMs: Number((r.maxMs as number).toFixed(2)),
    })),
  );
  console.log('hardware', hardware);
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('./results/dashboard.json', import.meta.url),
    `${JSON.stringify({ measuredOn: hardware, target: 'computeDashboard < 100 ms (typical profile)', warmup: WARMUP, runs: RUNS, results }, null, 2)}\n`,
  );
  expect(results.length).toBeGreaterThan(0);
});
