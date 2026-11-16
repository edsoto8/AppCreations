import { defaultScenario } from '../scenarios/default';
import { Factory, clone } from '../production/factory';
import type { FactoryConfig, InjectedEvent, LogRecord, Scenario } from '../simulation/types';

export const H = 3600;
export const DAY = 86400;

export function scenario(seed = 1, mutate?: (c: FactoryConfig) => void, injected: InjectedEvent[] = []): Scenario {
  const s = defaultScenario(seed);
  if (mutate) mutate(s.config);
  s.injectedEvents = injected;
  return clone(s);
}

export function run(s: Scenario, seconds: number, keepLog = true): Factory {
  const f = new Factory(s, { keepLog });
  f.engine.advanceTo(seconds);
  return f;
}

export function byProduct(records: LogRecord[]): Map<string, LogRecord[]> {
  const m = new Map<string, LogRecord[]>();
  for (const r of records) {
    if (!r.type.startsWith('unit.')) continue;
    const l = m.get(r.id) ?? [];
    l.push(r);
    m.set(r.id, l);
  }
  return m;
}
