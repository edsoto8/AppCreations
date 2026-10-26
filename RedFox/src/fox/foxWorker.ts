/// <reference lib="webworker" />
/** Builds the fox mesh off the main thread so the page stays responsive while it sculpts. */
import { buildFoxMesh, type FoxMeshData } from './FoxBuilder';

export type FoxWorkerRequest = { cell: number };
export type FoxWorkerMessage =
  | { type: 'progress'; fraction: number; stage: string }
  | { type: 'done'; mesh: FoxMeshData }
  | { type: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (e: MessageEvent<FoxWorkerRequest>) => {
  try {
    let last = -1;
    const mesh = buildFoxMesh({
      cell: e.data.cell,
      onProgress: (fraction, stage) => {
        const pct = Math.round(fraction * 100);
        if (pct === last) return;
        last = pct;
        scope.postMessage({ type: 'progress', fraction, stage } satisfies FoxWorkerMessage);
      },
    });
    const transfer = [
      mesh.positions.buffer,
      mesh.normals.buffer,
      mesh.indices.buffer,
      mesh.skinIndex.buffer,
      mesh.skinWeight.buffer,
      mesh.colors.buffer,
      mesh.furData.buffer,
      mesh.furDir.buffer,
    ];
    scope.postMessage({ type: 'done', mesh } satisfies FoxWorkerMessage, transfer);
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies FoxWorkerMessage);
  }
});
