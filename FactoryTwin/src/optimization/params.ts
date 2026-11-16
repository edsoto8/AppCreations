import type { DispatchRule, FactoryConfig, ParamDef } from '../simulation/types';
import { defaultConfig } from '../scenarios/default';

const RULES: DispatchRule[] = ['priority-edd', 'edd', 'fifo'];
const BASE = defaultConfig();

/**
 * Bounded parameter space for experiments and the optimizer.
 * Speed factors are not free: running a station faster raises its hourly cost
 * (+150% of the base rate per +100% speed: faster tooling, more energy and wear).
 */
export const PARAMS: ParamDef[] = [
  { key: 'assembly.cells', label: 'Assembly cells', min: 2, max: 5, step: 1, get: (c) => c.assembly.cells, set: (c, v) => (c.assembly.cells = v) },
  { key: 'inspection.stations', label: 'Inspection stations', min: 1, max: 3, step: 1, get: (c) => c.inspection.stations, set: (c, v) => (c.inspection.stations = v) },
  { key: 'vehicles.agvCount', label: 'AGVs', min: 1, max: 4, step: 1, get: (c) => c.vehicles.agvCount, set: (c, v) => (c.vehicles.agvCount = v) },
  { key: 'assembly.wipPerCell', label: 'WIP limit per cell', min: 2, max: 5, step: 1, get: (c) => c.assembly.wipPerCell, set: (c, v) => (c.assembly.wipPerCell = v) },
  {
    key: 'assembly.speedFactor',
    label: 'Assembly speed factor',
    min: 0.9,
    max: 1.3,
    step: 0.1,
    get: (c) => c.assembly.speedFactor,
    set: (c, v) => {
      c.assembly.speedFactor = round(v);
      c.costs.machineCostPerHour.assembly = round(BASE.costs.machineCostPerHour.assembly * (1 + 1.5 * (v - 1)));
    },
  },
  {
    key: 'packaging.speedFactor',
    label: 'Packaging speed factor',
    min: 0.9,
    max: 1.3,
    step: 0.1,
    get: (c) => c.packaging.speedFactor,
    set: (c, v) => {
      c.packaging.speedFactor = round(v);
      c.costs.machineCostPerHour.packaging = round(BASE.costs.machineCostPerHour.packaging * (1 + 1.5 * (v - 1)));
    },
  },
  { key: 'staffing.floaters', label: 'Floaters per shift', min: 0, max: 2, step: 1, get: (c) => c.staffing.floaters, set: (c, v) => (c.staffing.floaters = v) },
  { key: 'assembly.pmIntervalHours', label: 'PM interval (busy h, 0 = off)', min: 0, max: 40, step: 10, get: (c) => c.assembly.pmIntervalHours, set: (c, v) => (c.assembly.pmIntervalHours = v) },
  {
    key: 'orders.dispatchRule',
    label: 'Dispatch rule (0 priority+EDD, 1 EDD, 2 FIFO)',
    min: 0,
    max: 2,
    step: 1,
    get: (c) => RULES.indexOf(c.orders.dispatchRule),
    set: (c, v) => (c.orders.dispatchRule = RULES[Math.round(v)] ?? 'priority-edd'),
  },
  {
    key: 'materials.reorderScale',
    label: 'Reorder point & qty scale',
    min: 0.6,
    max: 1.6,
    step: 0.2,
    get: (c) => round(c.materials.PCB.reorderPoint / BASE.materials.PCB.reorderPoint),
    set: (c, v) => {
      for (const [m, spec] of Object.entries(c.materials)) {
        const b = BASE.materials[m as keyof typeof BASE.materials];
        spec.reorderPoint = Math.round(b.reorderPoint * v);
        spec.orderQty = Math.round(b.orderQty * v);
      }
    },
  },
  {
    key: 'inspection.rejectRate',
    label: 'Inspection reject rate (quality threshold)',
    min: 0.01,
    max: 0.1,
    step: 0.01,
    get: (c) => c.inspection.rejectRate,
    set: (c, v) => (c.inspection.rejectRate = round(v)),
  },
];

/** Parameters the optimizer searches (quality threshold is an input, not a lever). */
export const SEARCH_KEYS = PARAMS.filter((p) => p.key !== 'inspection.rejectRate').map((p) => p.key);

export function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function param(key: string): ParamDef {
  const p = PARAMS.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown parameter ${key}`);
  return p;
}

export function readParams(c: FactoryConfig, keys = SEARCH_KEYS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = round(param(k).get(c));
  return out;
}

export function applyParams(c: FactoryConfig, values: Record<string, number>): FactoryConfig {
  const next = JSON.parse(JSON.stringify(c)) as FactoryConfig;
  for (const [k, v] of Object.entries(values)) {
    const p = param(k);
    p.set(next, Math.min(p.max, Math.max(p.min, v)));
  }
  return next;
}

export function describeChanges(base: Record<string, number>, next: Record<string, number>): string[] {
  return Object.keys(next)
    .filter((k) => Math.abs((base[k] ?? 0) - next[k]) > 1e-9)
    .map((k) => `${param(k).label}: ${base[k]} → ${next[k]}`);
}
