import type { EntityDetail, EntityRef, InjectedEvent, MetricsSnapshot, Scenario, SimHost, SimSnapshot } from './types';
import { Factory } from '../production/factory';

/** Main-thread host: the engine runs synchronously inside advanceTo(). */
export class LocalSimHost implements SimHost {
  private f: Factory | null = null;
  private snap: SimSnapshot | null = null;
  private snapVersion = -1;
  private metricsCache: MetricsSnapshot | null = null;
  private metricsVersion = -1;

  get factory(): Factory | null {
    return this.f;
  }

  get snapshot(): SimSnapshot | null {
    const f = this.f;
    if (!f) return null;
    if (this.snapVersion !== f.engine.version) {
      this.snap = f.snapshot();
      this.snapVersion = f.engine.version;
    }
    return this.snap;
  }

  get metrics(): MetricsSnapshot | null {
    const f = this.f;
    if (!f) return null;
    if (this.metricsVersion !== f.engine.version) {
      this.metricsCache = f.metrics.snapshot(f.engine.now);
      this.metricsVersion = f.engine.version;
    }
    return this.metricsCache;
  }

  async load(scenario: Scenario): Promise<void> {
    this.f = new Factory(scenario);
    this.snapVersion = -1;
    this.metricsVersion = -1;
  }

  /** False when the last advanceTo() hit the event cap before reaching its target. */
  lastComplete = true;

  advanceTo(target: number, maxEvents = Infinity): void {
    if (!this.f) return;
    this.lastComplete = this.f.engine.advanceTo(target, maxEvents).complete;
  }

  /** Time of the next pending event (lets the playback clock avoid running ahead of a capped engine). */
  get now(): number {
    return this.f?.engine.now ?? 0;
  }

  inject(ev: InjectedEvent): void {
    this.f?.inject(ev);
  }

  async getScenario(): Promise<Scenario> {
    if (!this.f) throw new Error('No scenario loaded');
    return JSON.parse(JSON.stringify(this.f.scenario)) as Scenario;
  }

  async getDetail(ref: EntityRef): Promise<EntityDetail | null> {
    return this.f?.detail(ref) ?? null;
  }

  async getLogHash(): Promise<string> {
    return this.f?.log.digest() ?? '';
  }

  dispose(): void {
    this.f = null;
  }
}
