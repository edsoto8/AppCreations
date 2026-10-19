/**
 * Monte Carlo runner (brief §5.7, §9): a pool of chunk executors (Web Workers in the browser, an
 * in-process executor in tests) runs the quick run first (paths 0..quick−1), summarizes and reports
 * it, then runs the rest (quick..paths−1) and summarizes every chunk; the quick-run chunks are
 * reused, never recomputed. Paths are split contiguously across executors. Because path i depends
 * only on (seed, i), the result is identical for any split or worker count.
 *
 * No financial logic here: chunks come from `runMonteCarloChunk`, results from `summarizeMonteCarlo`.
 */
import {
  summarizeMonteCarlo,
  type EngineContext,
  type EngineResult,
  type Household,
  type MonteCarloChunk,
  type MonteCarloConfig,
  type MonteCarloResult,
} from '@rn/engine';
import { runInSubChunks, splitRange, SUB_CHUNK_PATHS, type ChunkRequest } from './chunking';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** Thrown (as a rejection) by an executor whose range was cancelled. */
export class RunCancelled extends Error {
  constructor() {
    super('Monte Carlo run cancelled');
    this.name = 'RunCancelled';
  }
}

/** Engine failure for a range (invalid inputs or unverified rules), or a crash message. */
export type ChunkFailure = { result: Exclude<EngineResult<never>, { status: 'ok' }> } | { message: string };

export class ChunkFailed extends Error {
  readonly failure: ChunkFailure;
  constructor(failure: ChunkFailure) {
    super('message' in failure ? failure.message : `Monte Carlo inputs are ${failure.result.status}`);
    this.name = 'ChunkFailed';
    this.failure = failure;
  }
}

/** Runs one contiguous path range at a time. */
export interface ChunkExecutor {
  readonly kind: 'worker' | 'inProcess';
  /** Resolves with the range's chunk; rejects with `RunCancelled` or `ChunkFailed`. */
  run(req: ChunkRequest, onProgress: (pathsDone: number) => void): Promise<MonteCarloChunk>;
  /**
   * Optional: get ready ahead of the first range. A worker loads its module and, given a request,
   * runs it once and discards the result so the engine code is already optimized for the real run.
   */
  warm?(req?: ChunkRequest): void;
  /** Stop the in-flight range (its promise rejects with `RunCancelled`); the executor stays usable. */
  cancel(): void;
  dispose(): void;
}

/**
 * Runs ranges on the calling thread (tests, and browsers without Worker). Yields to the event loop
 * between sub-chunks, where it checks the cancel flag.
 */
export function createInProcessExecutor(opts: { subChunk?: number } = {}): ChunkExecutor {
  let generation = 0;
  return {
    kind: 'inProcess',
    async run(req, onProgress) {
      const mine = ++generation;
      const outcome = await runInSubChunks(req, {
        subChunk: opts.subChunk ?? SUB_CHUNK_PATHS,
        onProgress,
        between: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(generation === mine), 0)),
      });
      if (outcome.status === 'cancelled' || generation !== mine) throw new RunCancelled();
      if (outcome.status !== 'ok') throw new ChunkFailed({ result: outcome });
      return outcome.value;
    },
    cancel() {
      generation++;
    },
    dispose() {
      generation++;
    },
  };
}

/** A same-origin module worker (`worker-src 'self'`); Vite emits it as a separate asset. */
function spawnWorker(): Worker {
  return new Worker(new URL('../../workers/montecarlo.worker.ts', import.meta.url), {
    type: 'module',
    name: 'monte-carlo',
  });
}

/**
 * Runs ranges in a Web Worker. Cancel terminates the worker (instant, even mid-sub-chunk); the next
 * run starts a fresh one.
 */
export function createWorkerExecutor(spawn: () => Worker = spawnWorker): ChunkExecutor {
  let worker: Worker | null = null;
  let runId = 0;
  let pending: { id: number; reject: (e: Error) => void } | null = null;

  const stop = () => {
    worker?.terminate();
    worker = null;
    const p = pending;
    pending = null;
    p?.reject(new RunCancelled());
  };

  return {
    kind: 'worker',
    run(req, onProgress) {
      if (pending) stop();
      const w = (worker ??= spawn());
      const id = ++runId;
      return new Promise<MonteCarloChunk>((resolve, reject) => {
        pending = { id, reject };
        const done = () => {
          w.removeEventListener('message', onMessage);
          w.removeEventListener('error', onError);
          if (pending?.id === id) pending = null;
        };
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (msg.runId !== id) return;
          if (msg.type === 'progress') onProgress(msg.pathsDone);
          else if (msg.type === 'chunk') {
            done();
            resolve(msg.chunk);
          } else {
            done();
            reject(new ChunkFailed('result' in msg ? { result: msg.result } : { message: msg.message }));
          }
        };
        const onError = (event: ErrorEvent) => {
          done();
          // A worker that failed to load or crashed is replaced on the next run.
          w.terminate();
          if (worker === w) worker = null;
          reject(new ChunkFailed({ message: event.message || 'The Monte Carlo worker stopped unexpectedly' }));
        };
        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);
        const message: WorkerRequest = { type: 'run', runId: id, ...req };
        w.postMessage(message);
      });
    },
    warm(req) {
      const w = (worker ??= spawn());
      if (req) w.postMessage({ type: 'warm', ...req } satisfies WorkerRequest);
    },
    cancel: stop,
    dispose: stop,
  };
}

/** min(4, logical cores), 2 when the browser does not say. */
export function defaultPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
  return Math.max(1, Math.min(4, cores || 2));
}

/** Workers where the browser has them; otherwise a single in-process executor (jsdom). */
export function createDefaultPool(): ChunkExecutor[] {
  if (typeof Worker === 'undefined') return [createInProcessExecutor()];
  return Array.from({ length: defaultPoolSize() }, () => createWorkerExecutor());
}

export interface MonteCarloProgress {
  phase: 'quick' | 'full';
  /** Paths finished across both phases. */
  done: number;
  /** Total paths for the run (`config.paths`). */
  total: number;
}

export interface TimedResult {
  result: MonteCarloResult;
  /** Wall time from the start of the run to this summary, in milliseconds. */
  elapsedMs: number;
}

export type MonteCarloOutcome =
  | { status: 'ok'; quick: TimedResult; full: TimedResult; executors: number }
  | { status: 'cancelled' }
  | { status: 'failed'; failure: ChunkFailure };

export interface MonteCarloRunArgs {
  household: Household;
  ctx: EngineContext;
  config: MonteCarloConfig;
  pool: readonly ChunkExecutor[];
  onProgress?: (p: MonteCarloProgress) => void;
  /** The quick run's summary (paths 0..quickRunPaths−1), before the rest is computed. */
  onQuick?: (quick: TimedResult) => void;
  /** Clock for elapsed times (defaults to `performance.now`). */
  now?: () => number;
}

export interface MonteCarloRun {
  promise: Promise<MonteCarloOutcome>;
  cancel: () => void;
}

/** Start a run: quick run first, then the remaining paths; chunks merge into one summary. */
export function runMonteCarlo(args: MonteCarloRunArgs): MonteCarloRun {
  const { household, ctx, config, pool } = args;
  const now = args.now ?? (() => performance.now());
  let cancelled = false;
  // Settles the run as soon as cancel is called, even if an executor is slow to stop.
  let onCancel: (e: Error) => void = () => undefined;
  const cancelSignal = new Promise<never>((_, reject) => (onCancel = reject));
  cancelSignal.catch(() => undefined);
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const e of pool) e.cancel();
    onCancel(new RunCancelled());
  };

  const total = config.paths;
  const quickPaths = Math.min(config.quickRunPaths, total);
  const t0 = now();
  let doneBefore = 0;

  const runPhase = async (phase: MonteCarloProgress['phase'], start: number, end: number) => {
    const ranges = splitRange(start, end, pool.length);
    const doneByRange = ranges.map(() => 0);
    const report = () => args.onProgress?.({ phase, done: doneBefore + doneByRange.reduce((a, b) => a + b, 0), total });
    const running = ranges.map((range, k) => {
      const executor = pool[k];
      if (!executor) throw new Error('Executor pool is empty');
      return executor.run({ household, ctx, config, ...range }, (pathsDone) => {
        doneByRange[k] = pathsDone;
        if (!cancelled) report();
      });
    });
    // Late rejections from ranges that lost the race are expected (cancel or a sibling's failure).
    running.forEach((p) => p.catch(() => undefined));
    const chunks = await Promise.race([Promise.all(running), cancelSignal]);
    doneBefore += end - start;
    return chunks;
  };

  const summarize = (chunks: MonteCarloChunk[], paths: number): TimedResult => ({
    result: summarizeMonteCarlo(chunks, { ...config, paths }, household, ctx.currentYear),
    elapsedMs: now() - t0,
  });

  const promise = (async (): Promise<MonteCarloOutcome> => {
    try {
      if (pool.length === 0) return { status: 'failed', failure: { message: 'No Monte Carlo executors' } };
      args.onProgress?.({ phase: 'quick', done: 0, total });
      const quickChunks = await runPhase('quick', 0, quickPaths);
      if (cancelled) return { status: 'cancelled' };
      const quick = summarize(quickChunks, quickPaths);
      args.onQuick?.(quick);
      if (cancelled) return { status: 'cancelled' };
      if (quickPaths >= total) return { status: 'ok', quick, full: quick, executors: pool.length };
      args.onProgress?.({ phase: 'full', done: quickPaths, total });
      const rest = await runPhase('full', quickPaths, total);
      if (cancelled) return { status: 'cancelled' };
      const full = summarize([...quickChunks, ...rest], total);
      return { status: 'ok', quick, full, executors: pool.length };
    } catch (err) {
      if (cancelled || err instanceof RunCancelled) {
        cancel();
        return { status: 'cancelled' };
      }
      // Stop the other executors' ranges: the run cannot complete.
      for (const e of pool) e.cancel();
      if (err instanceof ChunkFailed) return { status: 'failed', failure: err.failure };
      return { status: 'failed', failure: { message: err instanceof Error ? err.message : String(err) } };
    }
  })();

  return { promise, cancel };
}
