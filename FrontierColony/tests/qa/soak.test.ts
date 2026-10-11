/**
 * QA soak: every map preset x difficulty runs three in-game days with no player input.
 * Checks, at intervals and at the end: validateGameState passes, no NaN/Infinity/undefined anywhere,
 * population is never negative, and resources stay within 0..storage capacity.
 */
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, GAME_HOURS_PER_TICK, MAP_PRESETS, createGame, stepGame, validateGameState, type GameState } from '../../src/sim';
import { findNonFinite, populationViolations, resourceViolations } from './invariants';

const DAYS = 3;
const CHECK_EVERY = 300; // ticks (30 sim seconds)

describe('soak: 3 in-game days, no input, every preset x difficulty', () => {
  for (const preset of MAP_PRESETS) {
    for (const difficulty of DIFFICULTIES) {
      it(`${preset} / ${difficulty}`, () => {
        const state: GameState = createGame({
          seed: `qa-soak-${preset}-${difficulty}`,
          preset,
          mapSize: 'small',
          colonyName: 'Soak Colony',
          difficulty,
        });
        const totalTicks = Math.round((24 * DAYS) / GAME_HOURS_PER_TICK);
        const problems: string[] = [];

        const check = (at: number) => {
          for (const p of findNonFinite(state, 5)) problems.push(`tick ${at}: non-finite ${p}`);
          for (const p of resourceViolations(state)) problems.push(`tick ${at}: ${p}`);
          for (const p of populationViolations(state)) problems.push(`tick ${at}: ${p}`);
        };

        check(0);
        for (let t = 1; t <= totalTicks; t++) {
          stepGame(state);
          if (t % CHECK_EVERY === 0) check(t);
          if (problems.length > 0) break; // fail fast with the first problems
        }
        check(totalTicks);

        expect(problems).toEqual([]);
        expect(state.time.day).toBeGreaterThanOrEqual(DAYS + 1);
        const v = validateGameState(state);
        expect(v.ok, v.ok ? '' : v.error).toBe(true);
        // Plain JSON: a round trip must not change anything (no undefined, NaN or class instances).
        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      }, 120_000);
    }
  }
});
