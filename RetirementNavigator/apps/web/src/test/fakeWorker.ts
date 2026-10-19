/**
 * Test stand-ins for the Monte Carlo module Worker (`workers/montecarlo.worker.ts`): they run the same
 * loops as the worker (`runInSubChunks`, `optimizeByAge`) on the calling thread and post the same
 * protocol messages (`features/monte-carlo/protocol.ts`).
 */
import { runInSubChunks } from '@/features/monte-carlo/chunking';
import { optimizeByAge } from '@/features/monte-carlo/optimizeSteps';
import type { WorkerRequest, WorkerResponse } from '@/features/monte-carlo/protocol';

/** Minimal stand-in for a module Worker: runs the same loops as the worker and posts protocol messages. */
export class FakeWorker extends EventTarget {
  terminated = false;
  posted: WorkerRequest[] = [];
  postMessage(msg: WorkerRequest) {
    this.posted.push(msg);
    if (msg.type === 'optimize') {
      setTimeout(() => {
        void optimizeByAge(msg, {
          onProgress: (agesDone, agesTotal) =>
            this.emit({ type: 'optimizeProgress', runId: msg.runId, agesDone, agesTotal }),
          between: () => new Promise((r) => setTimeout(() => r(!this.terminated), 0)),
        }).then((out) => {
          if (out.status !== 'cancelled') this.emit({ type: 'optimized', runId: msg.runId, result: out });
        });
      }, 0);
      return;
    }
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

/** A worker whose module fails to load: it fires `error` soon after it is created and never replies. */
export class BrokenWorker extends EventTarget {
  terminated = false;
  posted: WorkerRequest[] = [];
  constructor() {
    super();
    setTimeout(() => {
      if (!this.terminated) this.dispatchEvent(Object.assign(new Event('error'), { message: '' }));
    }, 0);
  }
  postMessage(msg: WorkerRequest) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
}
