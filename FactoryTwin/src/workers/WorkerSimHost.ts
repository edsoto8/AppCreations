import type { EntityDetail, EntityRef, InjectedEvent, MetricsSnapshot, Scenario, SimHost, SimSnapshot } from '../simulation/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Same interface as LocalSimHost, but the engine runs in a Web Worker. advanceTo() is
 * fire-and-forget; the latest snapshot arrives asynchronously (one frame of latency, hidden by
 * the analytic motion segments).
 */
export class WorkerSimHost implements SimHost {
  snapshot: SimSnapshot | null = null;
  /** Engine time and cap status reported by the worker (the playback clock never runs ahead of a capped engine). */
  now = 0;
  lastComplete = true;
  metrics: MetricsSnapshot | null = null;
  private readonly worker: Worker;
  private inFlight = false;
  private pendingTarget: number | null = null;
  private nextId = 1;
  private readonly waiters = new Map<number, (v: unknown) => void>();
  private loadResolve: (() => void) | null = null;
  private frames = 0;

  constructor() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'state') {
        this.snapshot = m.snapshot;
        if (m.metrics) this.metrics = m.metrics;
        this.now = m.now;
        this.lastComplete = m.complete;
        this.inFlight = false;
        this.loadResolve?.();
        this.loadResolve = null;
        if (this.pendingTarget !== null) {
          const t = this.pendingTarget;
          this.pendingTarget = null;
          this.advanceTo(t);
        }
      } else {
        this.waiters.get(m.id)?.(m.value);
        this.waiters.delete(m.id);
      }
    };
  }

  private send(m: WorkerRequest): void {
    this.worker.postMessage(m);
  }

  load(scenario: Scenario): Promise<void> {
    return new Promise((resolve) => {
      this.loadResolve = resolve;
      this.inFlight = true;
      this.send({ type: 'load', scenario });
    });
  }

  advanceTo(target: number, maxEvents = 20000): void {
    if (this.inFlight) {
      this.pendingTarget = target;
      return;
    }
    this.inFlight = true;
    this.frames++;
    this.send({ type: 'advance', target, maxEvents, withMetrics: this.frames % 15 === 0 });
  }

  inject(ev: InjectedEvent): void {
    this.send({ type: 'inject', ev });
  }

  private ask<T>(m: WorkerRequest & { id: number }): Promise<T> {
    return new Promise((resolve) => {
      this.waiters.set(m.id, resolve as (v: unknown) => void);
      this.send(m);
    });
  }

  getScenario(): Promise<Scenario> {
    return this.ask<Scenario>({ type: 'scenario', id: this.nextId++ });
  }

  getDetail(ref: EntityRef): Promise<EntityDetail | null> {
    return this.ask<EntityDetail | null>({ type: 'detail', id: this.nextId++, ref });
  }

  getLogHash(): Promise<string> {
    return this.ask<string>({ type: 'hash', id: this.nextId++ });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
