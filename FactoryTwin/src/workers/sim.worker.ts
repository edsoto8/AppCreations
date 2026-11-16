/// <reference lib="webworker" />
import { LocalSimHost } from '../simulation/host';
import type { WorkerRequest, WorkerResponse } from './protocol';

const host = new LocalSimHost();
const post = (m: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  switch (m.type) {
    case 'load':
      await host.load(m.scenario);
      post({ type: 'state', snapshot: host.snapshot!, metrics: host.metrics!, complete: true, now: host.now });
      break;
    case 'advance':
      host.advanceTo(m.target, m.maxEvents);
      post({ type: 'state', snapshot: host.snapshot!, metrics: m.withMetrics ? host.metrics! : null, complete: host.lastComplete, now: host.now });
      break;
    case 'inject':
      host.inject(m.ev);
      break;
    case 'scenario':
      post({ type: 'reply', id: m.id, value: await host.getScenario() });
      break;
    case 'detail':
      post({ type: 'reply', id: m.id, value: await host.getDetail(m.ref) });
      break;
    case 'hash':
      post({ type: 'reply', id: m.id, value: await host.getLogHash() });
      break;
  }
};
