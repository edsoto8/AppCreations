/**
 * TEST-3: strict invariants and a resource ledger over real play.
 * A sensible scripted player runs 30 in-game days; every few ticks the strict checks run, and
 * every tick the resource total is compared with what the tick's events can explain.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DIFFICULTIES,
  MAP_PRESETS,
  RESOURCE_TYPES,
  createGame,
  stepGame,
  type BuildingType,
  type GameState,
  type MapPreset,
  type ResourceType,
  type SimEvent,
} from '../../src/sim';
import { placeNearTown } from '../sim/support/player';
import { strictViolations, totalHeld } from './invariants';

vi.setConfig({ testTimeout: 300_000 });

const TICKS_PER_DAY = 1800;
const SCRIPT: { day: number; type: BuildingType }[] = [
  { day: 1, type: 'farm' },
  { day: 1, type: 'well' },
  { day: 1, type: 'house' },
  { day: 1, type: 'lumberCamp' },
  { day: 3, type: 'mine' },
  { day: 4, type: 'storage' },
  { day: 4, type: 'workshop' },
  { day: 5, type: 'house' },
  { day: 7, type: 'farm' },
  { day: 8, type: 'house' },
  { day: 10, type: 'house' },
  { day: 11, type: 'storage' },
  { day: 12, type: 'house' },
  { day: 14, type: 'house' },
  { day: 18, type: 'farm' },
];

function producedTotal(state: GameState): number {
  let n = 0;
  for (const r of RESOURCE_TYPES) n += state.stats.totalProduced[r];
  return n;
}

interface LedgerReport {
  violations: string[];
  checkedTicks: number;
  skippedTicks: number;
  gathered: Record<ResourceType, number>;
  produced: Record<ResourceType, number>;
  consumed: Record<ResourceType, number>;
  final: GameState;
}

/** Run a scripted game, checking the strict invariants and the per-tick resource bound. */
function runWithLedger(preset: MapPreset, seed: string, days: number): LedgerReport {
  const state = createGame({ seed, preset, mapSize: 'small', colonyName: 'Ledger', difficulty: 'normal' });
  const pending = [...SCRIPT];
  const zero = (): Record<ResourceType, number> => ({ wood: 0, stone: 0, food: 0, water: 0, tools: 0 });
  const report: LedgerReport = { violations: [], checkedTicks: 0, skippedTicks: 0, gathered: zero(), produced: zero(), consumed: zero(), final: state };

  for (let tick = 0; tick < days * TICKS_PER_DAY; tick++) {
    if (tick % 100 === 0) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const item = pending[i]!;
        if (state.time.day < item.day) continue;
        if (placeNearTown(state, item.type) !== null) pending.splice(i, 1);
      }
    }

    const before = totalHeld(state);
    const producedBefore = producedTotal(state);
    const events: SimEvent[] = stepGame(state);
    const after = totalHeld(state);
    // Inflow = the sim's own production statistic: gathering, recipes and rain barrels all record
    // into it. (Rain has no resourceProduced event; that gap is reported separately.)
    const inflow = producedTotal(state) - producedBefore;

    let external = false;
    for (const e of events) {
      if (e.type === 'resourceGathered') report.gathered[e.resource] += e.amount;
      else if (e.type === 'resourceProduced') report.produced[e.resource] += e.amount;
      else if (e.type === 'resourceConsumed') report.consumed[e.resource] += e.amount;
      else if (e.type === 'randomEvent' || e.type === 'decisionPending' || e.type === 'gameOver') {
        // Supply caches, wagons and trades add goods without a production statistic. Those ticks are not bounded.
        external = true;
      }
    }

    // Goods can only appear through production (or an external event). Losses at the storage cap
    // are allowed, so only the upper bound is checked.
    if (external) report.skippedTicks++;
    else {
      report.checkedTicks++;
      if (after - before > inflow + 1e-6) report.violations.push(`tick ${tick}: held rose by ${(after - before).toFixed(3)} but production recorded ${inflow} (events: ${events.map((e) => e.type).join(',')})`);
    }

    if (tick % 300 === 0) for (const v of strictViolations(state)) report.violations.push(`tick ${tick}: ${v}`);
    if (report.violations.length > 20) break;
  }
  for (const v of strictViolations(state)) report.violations.push(`end: ${v}`);
  report.final = state;
  return report;
}

describe('strict invariants over a scripted 30-day game', () => {
  for (const preset of MAP_PRESETS) {
    it(`${preset}: no violations, and goods only appear through gathering or production`, () => {
      const r = runWithLedger(preset, `qa-strict-${preset}`, 30);
      expect(r.violations).toEqual([]);
      expect(r.checkedTicks).toBeGreaterThan(20_000);
      // The ledger check is meaningful only if production and gathering really happened.
      expect(RESOURCE_TYPES.reduce((n, res) => n + r.produced[res] + r.gathered[res], 0)).toBeGreaterThan(100);
    });
  }

  it('the consumed and produced totals match the sim statistics', () => {
    const r = runWithLedger('continent', 'qa-strict-stats', 10);
    expect(r.violations).toEqual([]);
    for (const res of RESOURCE_TYPES) {
      // Event amounts are the same numbers the sim adds to its lifetime totals.
      expect(r.final.stats.totalProduced[res]).toBeGreaterThanOrEqual(r.produced[res] - 1e-6);
      expect(r.final.stats.totalConsumed[res]).toBeGreaterThanOrEqual(r.consumed[res] - 1e-6);
    }
  });
});

describe('strict invariants on the other difficulties', () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty}: clean for 10 days`, () => {
      const state = createGame({ seed: `qa-strict-${difficulty}`, preset: 'riverValley', mapSize: 'small', colonyName: 'D', difficulty });
      const pending = [...SCRIPT];
      for (let tick = 0; tick < 10 * TICKS_PER_DAY; tick++) {
        if (tick % 100 === 0) {
          for (let i = pending.length - 1; i >= 0; i--) {
            const item = pending[i]!;
            if (state.time.day >= item.day && placeNearTown(state, item.type) !== null) pending.splice(i, 1);
          }
        }
        stepGame(state);
        if (tick % 300 === 0) expect(strictViolations(state)).toEqual([]);
      }
      expect(strictViolations(state)).toEqual([]);
    });
  }
});
