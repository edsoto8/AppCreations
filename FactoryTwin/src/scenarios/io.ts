import type { Scenario } from '../simulation/types';
import { defaultConfig } from './default';

/** Serialize a scenario to pretty JSON. */
export function exportScenario(s: Scenario): string {
  return JSON.stringify({ format: 'factory-twin-scenario', version: 1, scenario: s }, null, 2);
}

/** Parse and validate a scenario JSON; missing config fields are filled from the defaults. */
export function importScenario(json: string): Scenario {
  const raw = JSON.parse(json) as { scenario?: Scenario } & Partial<Scenario>;
  const s = (raw.scenario ?? raw) as Partial<Scenario>;
  if (typeof s.seed !== 'number' || !Number.isFinite(s.seed)) throw new Error('Scenario needs a numeric seed');
  if (!s.config || typeof s.config !== 'object') throw new Error('Scenario needs a config');
  const events = Array.isArray(s.injectedEvents) ? s.injectedEvents : [];
  for (const ev of events) {
    if (typeof ev.at !== 'number' || typeof ev.kind !== 'string') throw new Error('Injected events need { at, kind }');
  }
  return {
    id: s.id ?? 'imported',
    name: s.name ?? 'Imported scenario',
    description: s.description ?? '',
    seed: s.seed,
    config: deepMerge(defaultConfig(), s.config) as Scenario['config'],
    injectedEvents: events,
  };
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object' && base && typeof base === 'object' && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = deepMerge((base as Record<string, unknown>)[k], v);
    return out;
  }
  return over === undefined ? base : over;
}
