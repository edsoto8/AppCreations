/// <reference lib="webworker" />
import { optimize } from '../optimization/optimizer';
import { compare } from '../optimization/evaluate';
import type { OptimizerOptions, Scenario } from '../simulation/types';

export type OptRequest =
  | { type: 'optimize'; scenario: Scenario; opts: OptimizerOptions }
  | { type: 'compare'; baseline: Scenario; variant: Scenario; seeds: number[]; days: number };

const post = (m: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (e: MessageEvent<OptRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'optimize') {
      const result = optimize(m.scenario, m.opts, (p) => post({ type: 'progress', progress: p }));
      post({ type: 'done', result });
    } else {
      post({ type: 'compared', result: compare(m.baseline, m.variant, m.seeds, m.days) });
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
