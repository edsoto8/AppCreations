import { describe, expect, it } from 'vitest';
import { optimizeRetirementAge, RULES, type EngineContext, type MonteCarloConfig } from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import { nearRetirementHousehold, shortHousehold } from '@/test/monteCarloFixtures';
import { BrokenWorker, FakeWorker } from '@/test/fakeWorker';
import { optimizeByAge, type OptimizerCriterion } from './optimizeSteps';
import { createInProcessOptimizer, createWorkerOptimizer } from './optimizerRunner';
import { RunCancelled, WORKER_START_FAILED } from './runner';

const ctx: EngineContext = { currentYear: TEST_YEAR as EngineContext['currentYear'], rules: RULES };
const config: MonteCarloConfig = {
  paths: 1000,
  quickRunPaths: 200,
  seed: 5,
  inflation: { mode: 'fixed' },
  rebalancing: 'annual',
};
const mc: OptimizerCriterion = { kind: 'monteCarlo', config, minSuccessRate: 0.85 };
const range = { fromAge: 58, toAge: 64 };

describe('optimizeByAge', () => {
  it('equals one optimizeRetirementAge call over the whole range, for both criteria, with progress per age', async () => {
    const household = nearRetirementHousehold();
    for (const criterion of [{ kind: 'deterministic' } as const, mc]) {
      const progress: [number, number][] = [];
      const out = await optimizeByAge(
        { household, ctx, criterion, range },
        { onProgress: (d, t) => progress.push([d, t]) },
      );
      expect(out).toEqual(optimizeRetirementAge(household, ctx, criterion, range));
      expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7].map((d) => [d, 7]));
    }
    const out = await optimizeByAge({ household, ctx, criterion: mc, range });
    if (out.status !== 'ok') throw new Error(out.status);
    expect(out.value.criterion).toBe('monteCarlo');
    expect(out.value.monteCarloPaths).toBe(200);
    expect(out.value.evaluated.every((e) => e.successRate !== null)).toBe(true);
  });

  it('returns the engine’s invalid result for a bad range, a retired first person and unusable correlations', async () => {
    const household = nearRetirementHousehold();
    const backwards = { fromAge: 64, toAge: 60 };
    expect(await optimizeByAge({ household, ctx, criterion: mc, range: backwards })).toEqual(
      optimizeRetirementAge(household, ctx, mc, backwards),
    );
    const retired = shortHousehold();
    const r = await optimizeByAge({ household: retired, ctx, criterion: mc, range: { fromAge: 86, toAge: 88 } });
    expect(r.status).toBe('invalid');
    expect(r).toEqual(optimizeRetirementAge(retired, ctx, mc, { fromAge: 86, toAge: 88 }));
    const notPsd = {
      ...household,
      assumptions: {
        ...household.assumptions,
        capitalMarket: {
          ...household.assumptions.capitalMarket,
          correlation: [
            [1, 0.9, -0.9],
            [0.9, 1, 0.9],
            [-0.9, 0.9, 1],
          ],
        },
      },
    };
    const bad = await optimizeByAge({ household: notPsd, ctx, criterion: mc, range });
    expect(bad.status).toBe('invalid');
    expect(bad).toEqual(optimizeRetirementAge(notPsd, ctx, mc, range));
  });

  it('stops between ages when `between` returns false', async () => {
    let calls = 0;
    const out = await optimizeByAge(
      { household: nearRetirementHousehold(), ctx, criterion: { kind: 'deterministic' }, range },
      { between: () => Promise.resolve(++calls < 3) },
    );
    expect(out).toEqual({ status: 'cancelled' });
    expect(calls).toBe(3);
  });
});

describe('createWorkerOptimizer (optimize message)', () => {
  const spawnInto = (workers: FakeWorker[]) => () => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  };

  it('posts one optimize message, relays per-age progress and returns the engine’s result', async () => {
    const household = nearRetirementHousehold();
    const workers: FakeWorker[] = [];
    const executor = createWorkerOptimizer(spawnInto(workers));
    const progress: number[] = [];
    const result = await executor.run({ household, ctx, criterion: mc, range }, (d) => progress.push(d));
    expect(result).toEqual(optimizeRetirementAge(household, ctx, mc, range));
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toHaveLength(1);
    expect(workers[0]?.posted[0]).toMatchObject({ type: 'optimize', runId: 1, range, criterion: mc });
    // The worker is reused for the next scan.
    await executor.run({ household, ctx, criterion: { kind: 'deterministic' }, range }, () => undefined);
    expect(workers).toHaveLength(1);
  });

  it('cancel terminates the worker and rejects; the next scan starts a fresh worker', async () => {
    const household = nearRetirementHousehold();
    const workers: FakeWorker[] = [];
    const executor = createWorkerOptimizer(spawnInto(workers));
    const pending = executor.run({ household, ctx, criterion: mc, range }, () => undefined);
    executor.cancel();
    await expect(pending).rejects.toBeInstanceOf(RunCancelled);
    expect(workers[0]?.terminated).toBe(true);
    await executor.run(
      { household, ctx, criterion: { kind: 'deterministic' }, range: { fromAge: 60, toAge: 60 } },
      () => undefined,
    );
    expect(workers).toHaveLength(2);
  });

  it('fails clearly when the worker cannot start', async () => {
    const executor = createWorkerOptimizer(() => new BrokenWorker() as unknown as Worker);
    await expect(
      executor.run({ household: nearRetirementHousehold(), ctx, criterion: mc, range }, () => undefined),
    ).rejects.toThrow(WORKER_START_FAILED);
  });
});

describe('createInProcessOptimizer', () => {
  it('matches the engine and can be cancelled between ages', async () => {
    const household = nearRetirementHousehold();
    const executor = createInProcessOptimizer();
    const result = await executor.run({ household, ctx, criterion: mc, range }, () => undefined);
    expect(result).toEqual(optimizeRetirementAge(household, ctx, mc, range));
    const pending = executor.run({ household, ctx, criterion: mc, range }, (done) => {
      if (done === 2) executor.cancel();
    });
    await expect(pending).rejects.toBeInstanceOf(RunCancelled);
  });
});
