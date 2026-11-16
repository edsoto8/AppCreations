import type { Scenario } from '../simulation/types';
import { clone } from '../production/factory';
import { DEFAULT_SEED, defaultConfig, defaultScenario } from './default';
import { applyParams } from '../optimization/params';

const H = 3600;

export interface Preset {
  id: string;
  name: string;
  summary: string;
  scenario: Scenario;
  /** The scenario this one is compared against in the report. */
  baseline: Scenario;
}

/** (2) Major equipment breakdown: cell 2 down for a full shift, packaging feed conveyor C2 down 90 min. */
export function breakdownScenario(seed = DEFAULT_SEED): Scenario {
  const s = defaultScenario(seed);
  s.id = 'breakdown';
  s.name = 'Major equipment breakdown';
  s.description = 'Assembly Cell 2 breaks down at 07:30 (main drive replaced: 10 h repair) and conveyor C2 into packaging fails at 09:00 (90 min).';
  s.injectedEvents = [
    { at: 1.5 * H, kind: 'machine-failure', target: 'cell-1', params: { repairMin: 600 } },
    { at: 3 * H, kind: 'conveyor-breakdown', target: 'C2', params: { repairMin: 90 } },
  ];
  return s;
}

/** Growth demand used as the baseline for the optimisation scenario (+25% orders). */
export function growthScenario(seed = DEFAULT_SEED): Scenario {
  const s = defaultScenario(seed);
  s.id = 'growth';
  s.name = 'Growth demand (baseline)';
  s.description = 'Default plant facing 25% more orders per day.';
  s.config.orders.arrivalsPerDay = Math.round(defaultConfig().orders.arrivalsPerDay * 1.25);
  return s;
}

/**
 * (3) Improved throughput after optimisation: growth demand with the optimizer's top
 * recommendation applied. These values are the #1 result of `npm run report` (hill climbing,
 * budget 60, 3 seeds x 4 days); the report fails loudly if they drift from what it finds.
 */
export const OPTIMIZED_PARAMS: Record<string, number> = {
  'assembly.speedFactor': 1.3,
  'packaging.speedFactor': 0.9,
  'staffing.floaters': 2,
  'assembly.pmIntervalHours': 20,
  'orders.dispatchRule': 1,
};

export function optimizedScenario(seed = DEFAULT_SEED, params: Record<string, number> = OPTIMIZED_PARAMS): Scenario {
  const s = growthScenario(seed);
  s.id = 'optimized';
  s.name = 'Improved throughput (optimized)';
  s.description = 'Growth demand with the optimizer recommendation applied: ' + Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ');
  s.config = applyParams(s.config, params);
  return s;
}

export function presets(seed = DEFAULT_SEED): Preset[] {
  return [
    { id: 'normal', name: '1 · Normal operation', summary: 'Calibrated default plant.', scenario: defaultScenario(seed), baseline: defaultScenario(seed) },
    { id: 'breakdown', name: '2 · Major equipment breakdown', summary: 'Cell 2 and conveyor C2 fail on day 1.', scenario: breakdownScenario(seed), baseline: defaultScenario(seed) },
    { id: 'optimized', name: '3 · Improved throughput (optimized)', summary: 'Growth demand, optimizer settings applied.', scenario: optimizedScenario(seed), baseline: growthScenario(seed) },
  ].map((p) => ({ ...p, scenario: clone(p.scenario), baseline: clone(p.baseline) }));
}
