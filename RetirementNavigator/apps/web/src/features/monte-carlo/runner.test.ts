import { describe, expect, it } from 'vitest';
import {
  RULES,
  runMonteCarloChunk,
  summarizeMonteCarlo,
  type EngineContext,
  type Household,
  type MonteCarloChunk,
  type MonteCarloConfig,
} from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import { shortHousehold } from '@/test/monteCarloFixtures';
import { runInSubChunks, splitRange, type ChunkRequest, type PathRange } from './chunking';
import type { WorkerRequest, WorkerResponse } from './protocol';
import {
  createInProcessExecutor,
  createWorkerExecutor,
  runMonteCarlo,
  type ChunkExecutor,
  type MonteCarloProgress,
} from './runner';

const ctx: EngineContext = { currentYear: TEST_YEAR as EngineContext['currentYear'], rules: RULES };

const config: MonteCarloConfig = {
  paths: 1000,
  quickRunPaths: 200,
  seed: 7,
  inflation: { mode: 'fixed' },
  rebalancing: 'annual',
};

function direct(household: Household, cfg: MonteCarloConfig, start: number, end: number): MonteCarloChunk {
  const r = runMonteCarloChunk(household, ctx, cfg, { pathStart: start, pathEnd: end });
  if (r.status !== 'ok') throw new Error(`engine ${r.status}`);
  return r.value;
}

/** Wraps an executor and records every range it is asked to run. */
function spy(inner: ChunkExecutor, calls: PathRange[]): ChunkExecutor {
  return {
    kind: inner.kind,
    run: (req, onProgress) => {
      calls.push({ pathStart: req.pathStart, pathEnd: req.pathEnd });
      return inner.run(req, onProgress);
    },
    cancel: () => inner.cancel(),
    dispose: () => inner.dispose(),
  };
}

describe('splitRange', () => {
  it('splits contiguously with sizes differing by at most one', () => {
    expect(splitRange(0, 10, 3)).toEqual([
      { pathStart: 0, pathEnd: 4 },
      { pathStart: 4, pathEnd: 7 },
      { pathStart: 7, pathEnd: 10 },
    ]);
    expect(splitRange(1000, 10_000, 4).map((r) => r.pathEnd - r.pathStart)).toEqual([2250, 2250, 2250, 2250]);
    expect(splitRange(0, 2, 4)).toEqual([
      { pathStart: 0, pathEnd: 1 },
      { pathStart: 1, pathEnd: 2 },
    ]);
  });
});

describe('runInSubChunks', () => {
  it('stitches sub-chunks into exactly the chunk the engine returns for the whole range', async () => {
    const household = shortHousehold();
    const req: ChunkRequest = { household, ctx, config, pathStart: 37, pathEnd: 290 };
    const progress: number[] = [];
    const out = await runInSubChunks(req, { subChunk: 100, onProgress: (n) => progress.push(n) });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.value).toEqual(direct(household, config, 37, 290));
    expect(progress).toEqual([100, 200, 253]);
  });
});

describe('runMonteCarlo', () => {
  it('shows the quick run first, reuses its chunk, and equals a direct engine run', async () => {
    const household = shortHousehold();
    const calls: PathRange[] = [];
    const quicks: unknown[] = [];
    let t = 0;
    const run = runMonteCarlo({
      household,
      ctx,
      config,
      pool: [spy(createInProcessExecutor(), calls)],
      onQuick: (q) => quicks.push(q.result),
      now: () => (t += 250),
    });
    const outcome = await run.promise;
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    // Paths 0..199 are computed once (quick run), then 200..999.
    expect(calls).toEqual([
      { pathStart: 0, pathEnd: 200 },
      { pathStart: 200, pathEnd: 1000 },
    ]);
    const quickDirect = summarizeMonteCarlo(
      [direct(household, config, 0, 200)],
      { ...config, paths: 200 },
      household,
      ctx.currentYear,
    );
    expect(quicks).toEqual([quickDirect]);
    expect(outcome.quick.result).toEqual(quickDirect);
    expect(outcome.quick.result.paths).toBe(200);
    expect(outcome.quick.result.assumptions[0]).toMatch(/^200 paths/);

    const fullDirect = summarizeMonteCarlo([direct(household, config, 0, 1000)], config, household, ctx.currentYear);
    expect(outcome.full.result).toEqual(fullDirect);
    expect(outcome.full.result.paths).toBe(1000);
    // Elapsed wall time is recorded for both summaries.
    expect(outcome.quick.elapsedMs).toBeGreaterThan(0);
    expect(outcome.full.elapsedMs).toBeGreaterThan(outcome.quick.elapsedMs);
  });

  it('splits paths contiguously across a pool of 3 and gives the same summary as one chunk', async () => {
    const household = shortHousehold();
    const calls: PathRange[][] = [[], [], []];
    const pool = calls.map((c) => spy(createInProcessExecutor({ subChunk: 64 }), c));
    const outcome = await runMonteCarlo({ household, ctx, config, pool }).promise;
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.executors).toBe(3);
    expect(calls).toEqual([
      [
        { pathStart: 0, pathEnd: 67 },
        { pathStart: 200, pathEnd: 467 },
      ],
      [
        { pathStart: 67, pathEnd: 134 },
        { pathStart: 467, pathEnd: 734 },
      ],
      [
        { pathStart: 134, pathEnd: 200 },
        { pathStart: 734, pathEnd: 1000 },
      ],
    ]);
    const single = summarizeMonteCarlo([direct(household, config, 0, 1000)], config, household, ctx.currentYear);
    expect(outcome.full.result).toEqual(single);
  });

  it('reports progress through the quick run and then the rest', async () => {
    const household = shortHousehold();
    const progress: MonteCarloProgress[] = [];
    await runMonteCarlo({
      household,
      ctx,
      config,
      pool: [createInProcessExecutor({ subChunk: 50 }), createInProcessExecutor({ subChunk: 50 })],
      onProgress: (p) => progress.push(p),
    }).promise;
    expect(progress[0]).toEqual({ phase: 'quick', done: 0, total: 1000 });
    expect(progress.at(-1)).toEqual({ phase: 'full', done: 1000, total: 1000 });
    const quick = progress.filter((p) => p.phase === 'quick');
    expect(quick.at(-1)?.done).toBe(200);
    expect(progress.length).toBeGreaterThan(10);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]!.done).toBeGreaterThanOrEqual(progress[i - 1]!.done);
    }
  });

  it('cancel stops further chunks', async () => {
    const household = shortHousehold();
    const calls: PathRange[] = [];
    let cancel: () => void = () => undefined;
    const run = runMonteCarlo({
      household,
      ctx,
      config,
      pool: [spy(createInProcessExecutor(), calls)],
      onQuick: () => cancel(),
    });
    cancel = run.cancel;
    expect(await run.promise).toEqual({ status: 'cancelled' });
    expect(calls).toEqual([{ pathStart: 0, pathEnd: 200 }]);
  });

  it('cancel mid-range stops the executor between sub-chunks', async () => {
    const household = shortHousehold();
    const progress: MonteCarloProgress[] = [];
    let cancel: () => void = () => undefined;
    const run = runMonteCarlo({
      household,
      ctx,
      config: { ...config, quickRunPaths: 1000 },
      pool: [createInProcessExecutor({ subChunk: 50 })],
      onProgress: (p) => {
        progress.push(p);
        if (p.done >= 100) cancel();
      },
    });
    cancel = run.cancel;
    expect(await run.promise).toEqual({ status: 'cancelled' });
    expect(Math.max(...progress.map((p) => p.done))).toBe(100);
  });

  it('reports invalid inputs from the engine', async () => {
    const household = shortHousehold();
    const bad = {
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
    const outcome = await runMonteCarlo({ household: bad, ctx, config, pool: [createInProcessExecutor()] }).promise;
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed' || !('result' in outcome.failure)) throw new Error('expected an engine failure');
    expect(outcome.failure.result.status).toBe('invalid');
  });
});

/** Minimal stand-in for a module Worker: runs the same sub-chunk loop and posts protocol messages. */
class FakeWorker extends EventTarget {
  terminated = false;
  posted: WorkerRequest[] = [];
  postMessage(msg: WorkerRequest) {
    this.posted.push(msg);
    if (msg.type !== 'run') return;
    setTimeout(() => {
      void runInSubChunks(msg, {
        subChunk: 100,
        onProgress: (pathsDone) => this.emit({ type: 'progress', runId: msg.runId, pathsDone, pathsTotal: 0 }),
        between: () => new Promise((r) => setTimeout(() => r(!this.terminated), 0)),
      }).then((out) => {
        if (msg.type !== 'run') return;
        if (out.status === 'ok') this.emit({ type: 'chunk', runId: msg.runId, chunk: out.value });
        else if (out.status !== 'cancelled') this.emit({ type: 'error', runId: msg.runId, result: out });
      });
    }, 0);
  }
  terminate() {
    this.terminated = true;
  }
  private emit(data: WorkerResponse) {
    if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

describe('createWorkerExecutor', () => {
  it('speaks the run/progress/chunk protocol and matches a direct run', async () => {
    const household = shortHousehold();
    const workers: FakeWorker[] = [];
    const executor = createWorkerExecutor(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    const progress: number[] = [];
    const chunk = await executor.run({ household, ctx, config, pathStart: 0, pathEnd: 250 }, (n) => progress.push(n));
    expect(chunk).toEqual(direct(household, config, 0, 250));
    expect(progress).toEqual([100, 200, 250]);
    expect(workers[0]?.posted[0]).toMatchObject({ type: 'run', runId: 1, pathStart: 0, pathEnd: 250 });
    // The worker is reused for the next range.
    await executor.run({ household, ctx, config, pathStart: 250, pathEnd: 300 }, () => undefined);
    expect(workers).toHaveLength(1);
  });

  it('warm spawns the worker ahead of the first run and posts a discarded warm-up range', async () => {
    const household = shortHousehold();
    const workers: FakeWorker[] = [];
    const executor = createWorkerExecutor(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    executor.warm?.({ household, ctx, config, pathStart: 0, pathEnd: 50 });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted[0]).toMatchObject({ type: 'warm', pathStart: 0, pathEnd: 50 });
    const chunk = await executor.run({ household, ctx, config, pathStart: 0, pathEnd: 120 }, () => undefined);
    expect(chunk).toEqual(direct(household, config, 0, 120));
    expect(workers).toHaveLength(1);
  });

  it('cancel terminates the worker, rejects the range, and the next run starts a fresh worker', async () => {
    const household = shortHousehold();
    const workers: FakeWorker[] = [];
    const executor = createWorkerExecutor(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    const pending = executor.run({ household, ctx, config, pathStart: 0, pathEnd: 1000 }, () => undefined);
    executor.cancel();
    await expect(pending).rejects.toThrow('cancelled');
    expect(workers[0]?.terminated).toBe(true);
    await executor.run({ household, ctx, config, pathStart: 0, pathEnd: 10 }, () => undefined);
    expect(workers).toHaveLength(2);
  });
});
