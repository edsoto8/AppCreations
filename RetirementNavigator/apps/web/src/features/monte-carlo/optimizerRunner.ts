/**
 * Retirement-age optimizer executors (brief §5.6, §9): the Monte Carlo criterion scores every age on
 * the quick-run paths, which takes seconds, so the scan runs in a Web Worker (`optimize` message,
 * `protocol.ts`) and reports progress per age; cancel terminates the worker. Tests and browsers
 * without Worker use the in-process executor, which yields between ages.
 *
 * No financial logic here: results come from `optimizeRetirementAge` (via `optimizeByAge`).
 */
import type { EngineResult, OptimizerResult } from '@rn/engine';
import { optimizeByAge, type OptimizeRequest } from './optimizeSteps';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { ChunkFailed, createWorkerSlot, RunCancelled, spawnWorker } from './runner';

/** Runs one scan at a time. */
export interface OptimizerExecutor {
  readonly kind: 'worker' | 'inProcess';
  /**
   * Resolves with the engine's result (which may be `invalid`); rejects with `RunCancelled`, or with
   * `ChunkFailed` when the worker crashed.
   */
  run(
    req: OptimizeRequest,
    onProgress: (agesDone: number, agesTotal: number) => void,
  ): Promise<EngineResult<OptimizerResult>>;
  /** Stop the in-flight scan (its promise rejects with `RunCancelled`); the executor stays usable. */
  cancel(): void;
  dispose(): void;
}

/** Scans on the calling thread, yielding to the event loop between ages (where it checks for cancel). */
export function createInProcessOptimizer(): OptimizerExecutor {
  let generation = 0;
  return {
    kind: 'inProcess',
    async run(req, onProgress) {
      const mine = ++generation;
      const outcome = await optimizeByAge(req, {
        onProgress: (done, total) => {
          if (generation === mine) onProgress(done, total);
        },
        between: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(generation === mine), 0)),
      });
      if (outcome.status === 'cancelled' || generation !== mine) throw new RunCancelled();
      return outcome;
    },
    cancel() {
      generation++;
    },
    dispose() {
      generation++;
    },
  };
}

/** Scans in a Web Worker; cancel terminates it and the next scan starts a fresh one. */
export function createWorkerOptimizer(spawn: () => Worker = spawnWorker): OptimizerExecutor {
  const slot = createWorkerSlot(spawn);
  let runId = 0;

  return {
    kind: 'worker',
    run(req, onProgress) {
      if (slot.busy()) slot.stop();
      const w = slot.get();
      const id = ++runId;
      return new Promise<EngineResult<OptimizerResult>>((resolve, reject) => {
        const done = () => {
          w.removeEventListener('message', onMessage);
          slot.settle(id);
        };
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (msg.runId !== id) return;
          if (msg.type === 'optimizeProgress') onProgress(msg.agesDone, msg.agesTotal);
          else if (msg.type === 'optimized') {
            done();
            resolve(msg.result);
          } else if (msg.type === 'error') {
            done();
            reject(new ChunkFailed('result' in msg ? { result: msg.result } : { message: msg.message }));
          }
        };
        slot.wait(id, (e) => {
          w.removeEventListener('message', onMessage);
          reject(e);
        });
        w.addEventListener('message', onMessage);
        const message: WorkerRequest = { type: 'optimize', runId: id, ...req };
        w.postMessage(message);
      });
    },
    cancel: () => slot.stop(),
    dispose: () => slot.stop(),
  };
}

/** A worker where the browser has them; otherwise in-process (jsdom). */
export function createDefaultOptimizer(): OptimizerExecutor {
  return typeof Worker === 'undefined' ? createInProcessOptimizer() : createWorkerOptimizer();
}

let optimizerFactory: () => OptimizerExecutor = createDefaultOptimizer;
let shared: OptimizerExecutor | null = null;

/** The app's optimizer executor (one worker, created on the first scan). */
export function getOptimizerExecutor(): OptimizerExecutor {
  return (shared ??= optimizerFactory());
}

/** Tests: replace the optimizer executor (e.g. an in-process one, or one on a fake Worker). */
export function setOptimizerExecutorFactory(factory: () => OptimizerExecutor): void {
  shared?.dispose();
  shared = null;
  optimizerFactory = factory;
}
