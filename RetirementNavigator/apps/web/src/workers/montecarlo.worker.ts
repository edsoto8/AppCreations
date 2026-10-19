/**
 * Monte Carlo worker (brief §2: heavy compute off the main thread). Runs one contiguous path range
 * in sub-chunks, posting progress after each, then transfers the merged chunk's buffers back.
 * Loaded as a same-origin module worker (`worker-src 'self'`; no blob: URLs). Protocol:
 * `features/monte-carlo/protocol.ts`.
 */
import '../zodConfig';
import { chunkBuffers, runInSubChunks } from '@/features/monte-carlo/chunking';
import type { WorkerRequest, WorkerResponse } from '@/features/monte-carlo/protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function reply(message: WorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

/** Incremented by every message, so a warm-up stops as soon as anything else arrives. */
let generation = 0;
const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const mine = ++generation;
  if (msg.type === 'warm') {
    void runInSubChunks(msg, {
      subChunk: 50,
      between: async () => {
        await yieldToEvents();
        return generation === mine;
      },
    }).catch(() => undefined);
    return;
  }
  if (msg.type !== 'run') return;
  const { runId } = msg;
  const total = msg.pathEnd - msg.pathStart;
  runInSubChunks(msg, {
    onProgress: (pathsDone) => reply({ type: 'progress', runId, pathsDone, pathsTotal: total }),
  })
    .then((outcome) => {
      if (outcome.status === 'ok') reply({ type: 'chunk', runId, chunk: outcome.value }, chunkBuffers(outcome.value));
      else if (outcome.status === 'cancelled') reply({ type: 'error', runId, message: 'cancelled' });
      else reply({ type: 'error', runId, result: outcome });
    })
    .catch((err: unknown) => {
      reply({ type: 'error', runId, message: err instanceof Error ? err.message : String(err) });
    });
};
