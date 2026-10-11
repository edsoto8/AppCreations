/**
 * Regression tests for the two big findings in docs/reviews/M5-review.md (TEST-1):
 *  - CRIT-1: a starving settler at low health must not rest until death while food sits in farm buffers.
 *  - MAJ-1: a wolves victim who dies must not leave a dangling reference that blocks every save.
 * Each test sets up the state directly (test setup only) and then plays the real sim.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryStorage, saveToSlot } from '../../src/game/save';
import { createGame, stepGame, type GameState } from '../../src/sim';
import { removeSettler } from '../../src/sim/stateOps';
import { placeNearTown } from '../sim/support/player';

const TICKS_PER_DAY = 1800;

/**
 * A colony with no food in stock, water 40, the five founders at the given hunger and health, and
 * one complete farm holding 24 food in its output buffer.
 */
function famine(seed: string, hunger: number, health: number): GameState {
  const state = createGame({ seed, preset: 'continent', mapSize: 'small', colonyName: 'Famine', difficulty: 'normal' });
  const id = placeNearTown(state, 'farm');
  if (id === null) throw new Error('could not place a farm for the setup');
  const farm = state.buildings.find((b) => b.id === id)!;
  farm.status = 'complete';
  farm.construction = null;
  farm.output.food = 24;
  state.colony.stock.food = 0;
  state.colony.stock.water = 40;
  for (const s of state.settlers) {
    s.needs.hunger = hunger;
    s.needs.health = health;
  }
  return state;
}

describe('CRIT-1: starvation with food in farm buffers', () => {
  const cases: { hunger: number; health: number }[] = [
    { hunger: 5, health: 20 },
    { hunger: 10, health: 26 },
  ];
  for (const c of cases) {
    it(`hunger ${c.hunger}, health ${c.health}: at least four of five settlers survive a day`, () => {
      const state = famine(`qa-crit1-${c.hunger}-${c.health}`, c.hunger, c.health);
      for (let t = 0; t < TICKS_PER_DAY; t++) stepGame(state);
      expect(state.settlers.length).toBeGreaterThanOrEqual(4);
    });
  }
});

describe('MAJ-1: a wolves victim who dies does not block saving', () => {
  /**
   * Test setup: a settler is the wolves' victim. Health cannot be driven to zero through the sim in one
   * tick (regeneration runs first), so the death is applied with `removeSettler`, which is the same
   * removal the death and desertion paths use.
   */
  function victimOfWolves(seed: string) {
    const state = createGame({ seed, preset: 'continent', mapSize: 'small', colonyName: 'Wolves', difficulty: 'normal' });
    const victim = state.settlers[0]!;
    state.activeEvents.push({
      id: state.nextLogId++,
      kind: 'wolves',
      startedTick: state.time.tick,
      hoursRemaining: 24,
      magnitude: 1,
      targetId: victim.id,
      tile: null,
    });
    return { state, victim };
  }

  it('the colony still saves after the victim dies', () => {
    const { state, victim } = victimOfWolves('qa-maj1');
    removeSettler(state, victim.id);
    expect(state.settlers.some((s) => s.id === victim.id)).toBe(false);
    const result = saveToSlot(createMemoryStorage(), 'slot1', state);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
  });

  it('the wolves event keeps running after its victim is gone, with no target', () => {
    const { state, victim } = victimOfWolves('qa-maj1-b');
    removeSettler(state, victim.id);
    const wolves = state.activeEvents.find((e) => e.kind === 'wolves');
    expect(wolves).toBeDefined();
    expect(wolves?.targetId).toBeNull();
    for (let t = 0; t < 200; t++) stepGame(state);
    expect(saveToSlot(createMemoryStorage(), 'slot1', state).ok).toBe(true);
  });
});
