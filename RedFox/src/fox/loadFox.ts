import type { FoxMeshData } from './FoxBuilder';
import type { FoxWorkerMessage, FoxWorkerRequest } from './foxWorker';

/** Builds the fox mesh in a worker. Rejects if the worker fails. */
export function loadFoxMesh(cell: number, onProgress: (fraction: number, stage: string) => void): Promise<FoxMeshData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./foxWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<FoxWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.fraction, msg.stage);
      else {
        worker.terminate();
        if (msg.type === 'done') resolve(msg.mesh);
        else reject(new Error(msg.message));
      }
    });
    worker.addEventListener('error', (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Fox worker failed'));
    });
    worker.postMessage({ cell } satisfies FoxWorkerRequest);
  });
}
