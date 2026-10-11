/**
 * TEST-4: pace bounds for the soak (docs/reviews/M5-review.md, MAJ-3). The soak used to assert only
 * survival. A 30-day game with a sensible build order must also keep to the design's pace: the
 * colony is alive through the first winter (day 20), and victory does not arrive before day 21.
 */
import { describe, expect, it, vi } from 'vitest';
import { GAME_HOURS_PER_TICK, validateGameState, type MapPreset } from '../../src/sim';
import { START_HOUR } from '../../src/sim/balance';
import { assertInvariants } from '../../src/sim/testSupport';
import { playScript, type ScriptItem } from '../sim/support/player';

vi.setConfig({ testTimeout: 300_000 });

/** A sensible player over a month: the essentials, then houses, farms and storage as the colony grows. */
const MONTH: ScriptItem[] = [
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
  { day: 11, type: 'farm' },
  { day: 12, type: 'house' },
  { day: 13, type: 'well' },
  { day: 14, type: 'house' },
  { day: 16, type: 'house' },
  { day: 18, type: 'farm' },
  { day: 20, type: 'house' },
  { day: 22, type: 'house' },
];

const PRESETS: MapPreset[] = ['continent', 'archipelago', 'highlands', 'riverValley'];
const WINTER_END_DAY = 20;
const EARLIEST_VICTORY_DAY = 21;
/**
 * MAJ-3: on seed soak-b, victory currently lands on day 14-17 for these presets (measured with this
 * build order). They are it.fails until the growth retune lands; flip them to plain `it` then.
 * riverValley already meets the window and stays a plain test.
 */
const KNOWN_EARLY_VICTORY: MapPreset[] = ['continent', 'archipelago', 'highlands'];

/** In-game day (1-based) for a tick, using the same clock as the HUD. */
function dayOf(tick: number): number {
  return 1 + Math.floor((START_HOUR + tick * GAME_HOURS_PER_TICK) / 24);
}

function play(preset: MapPreset) {
  return playScript({ seed: 'soak-b', preset, difficulty: 'normal' }, MONTH, 30, [WINTER_END_DAY, 30], {
    onTick: (s, t) => {
      if (t % 300 === 0) assertInvariants(s);
    },
  });
}

describe('pace of a sensible 30-day normal game', () => {
  for (const preset of PRESETS) {
    it(`${preset}: the colony is alive through the first winter and the save is valid`, () => {
      const report = play(preset);
      const s = report.state;
      const day20 = report.checkpoints.find((c) => c.day === WINTER_END_DAY)!;
      expect(s.outcome.status).not.toBe('lost');
      expect(day20.pop).toBeGreaterThanOrEqual(8);
      expect(validateGameState(JSON.parse(JSON.stringify(s))).ok).toBe(true);
    });
  }

  for (const preset of PRESETS) {
    const known = KNOWN_EARLY_VICTORY.includes(preset);
    const check = known ? it.fails : it;
    check(`${preset}: victory does not come before day ${EARLIEST_VICTORY_DAY}${known ? ' (MAJ-3: fails until the growth retune lands)' : ''}`, () => {
      const s = play(preset).state;
      if (s.outcome.status === 'won') {
        const day = dayOf(s.outcome.endedTick ?? 0);
        expect(day, `victory on day ${day}`).toBeGreaterThanOrEqual(EARLIEST_VICTORY_DAY);
      } else {
        // Still playing on day 30 is within the pace bound.
        expect(s.outcome.status).toBe('playing');
      }
    });
  }
});
