import type { EntityRef, InjectedEvent, MetricsSnapshot, Scenario, SimSnapshot } from '../simulation/types';

export type WorkerRequest =
  | { type: 'load'; scenario: Scenario }
  | { type: 'advance'; target: number; maxEvents: number; withMetrics: boolean }
  | { type: 'inject'; ev: InjectedEvent }
  | { type: 'scenario'; id: number }
  | { type: 'detail'; id: number; ref: EntityRef }
  | { type: 'hash'; id: number };

export type WorkerResponse =
  | { type: 'state'; snapshot: SimSnapshot; metrics: MetricsSnapshot | null }
  | { type: 'reply'; id: number; value: unknown };
