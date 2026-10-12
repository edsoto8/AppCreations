import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_GAME_OPTIONS, GAME_HOURS_PER_TICK, createGame, type GameState, type TraitId } from '../../src/sim';
import { HUNGER_DECAY, TRAIT_EFFECTS, XP_PER_WORK_HOUR, XP_TO_NEXT_LEVEL_PER_LEVEL, PERSONAL_NIGHT_WINDOW } from '../../src/sim/balance';
import { SKILL_MAX } from '../../src/sim/constants';
import { inNightWindow, makeContext, skillMult, updateNeeds, walkSpeedPerTick, workSpeedMult } from '../../src/sim/needs';
import { grantXp } from '../../src/sim/settlerSim';

function fresh(): GameState {
  const s = createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed: 'traits' });
  s.time.timeOfDay = 12; // full daylight
  s.weather.current = 'clear';
  for (const x of s.settlers) {
    x.traits = [];
    x.toolDurability = null;
    x.needs.happiness = 60;
    x.needs.health = 100;
    x.status.sickHoursLeft = 0;
  }
  return s;
}
const ctxOf = (s: GameState) => makeContext(s, [], GAME_HOURS_PER_TICK, false);
const withTrait = (s: GameState, t: TraitId) => {
  const x = s.settlers[0]!;
  x.traits = [t];
  return x;
};

describe('skill XP', () => {
  it('practice accrues XP and levels up at xpToNext(level) = 10 * (level + 1)', () => {
    const s = fresh();
    const x = s.settlers[0]!;
    x.skills.woodcutting = 0;
    x.xp.woodcutting = 0;
    grantXp(x, 'woodcutting', 9.5);
    expect(x.skills.woodcutting).toBe(0);
    expect(x.xp.woodcutting).toBeCloseTo(9.5 * XP_PER_WORK_HOUR);
    grantXp(x, 'woodcutting', 0.5);
    expect(x.skills.woodcutting).toBe(1);
    expect(x.xp.woodcutting).toBeCloseTo(0);
    // Level 1 needs 20 XP.
    grantXp(x, 'woodcutting', XP_TO_NEXT_LEVEL_PER_LEVEL * 2 - 0.5);
    expect(x.skills.woodcutting).toBe(1);
    grantXp(x, 'woodcutting', 0.5);
    expect(x.skills.woodcutting).toBe(2);
  });

  it('stops at the skill cap and other skills are unaffected', () => {
    const x = fresh().settlers[0]!;
    x.skills.crafting = SKILL_MAX;
    const other = x.skills.hauling;
    for (let i = 0; i < 50; i++) grantXp(x, 'crafting', 20);
    expect(x.skills.crafting).toBe(SKILL_MAX);
    expect(x.skills.hauling).toBe(other);
  });

  it('a higher skill works faster, by the documented step per level', () => {
    const s = fresh();
    const x = s.settlers[0]!;
    x.skills.woodcutting = 0;
    const slow = workSpeedMult(ctxOf(s), x, 'woodcutting', 'woodcutting');
    x.skills.woodcutting = 4;
    const fast = workSpeedMult(ctxOf(s), x, 'woodcutting', 'woodcutting');
    expect(fast / slow).toBeCloseTo(skillMult(4) / skillMult(0));
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('trait effects', () => {
  it('glutton and frugal change how fast hunger falls', () => {
    const rate = (t: TraitId | null) => {
      const s = fresh();
      const x = s.settlers[0]!;
      x.traits = t ? [t] : [];
      x.needs.hunger = 100;
      updateNeeds(ctxOf(s), x, false, false);
      return (100 - x.needs.hunger) / GAME_HOURS_PER_TICK;
    };
    expect(rate(null)).toBeCloseTo(HUNGER_DECAY);
    expect(rate('glutton')).toBeCloseTo(HUNGER_DECAY * TRAIT_EFFECTS.glutton.hungerDecay);
    expect(rate('frugal')).toBeCloseTo(HUNGER_DECAY * TRAIT_EFFECTS.frugal.hungerDecay);
  });

  it('hardworking and lazy change work speed; nimble and clumsy change walking speed', () => {
    const s = fresh();
    const x = s.settlers[0]!;
    const base = workSpeedMult(ctxOf(s), x, 'woodcutting', 'woodcutting');
    const baseWalk = walkSpeedPerTick(ctxOf(s), x);
    withTrait(s, 'hardworking');
    expect(workSpeedMult(ctxOf(s), x, 'woodcutting', 'woodcutting') / base).toBeCloseTo(TRAIT_EFFECTS.hardworking.workSpeed);
    withTrait(s, 'lazy');
    expect(workSpeedMult(ctxOf(s), x, 'woodcutting', 'woodcutting') / base).toBeCloseTo(TRAIT_EFFECTS.lazy.workSpeed);
    withTrait(s, 'nimble');
    expect(walkSpeedPerTick(ctxOf(s), x) / baseWalk).toBeCloseTo(TRAIT_EFFECTS.nimble.walkSpeed);
    withTrait(s, 'clumsy');
    expect(walkSpeedPerTick(ctxOf(s), x) / baseWalk).toBeCloseTo(TRAIT_EFFECTS.clumsy.walkSpeed);
  });

  it('nightOwl and earlyBird shift the personal sleep window', () => {
    const s = fresh();
    const x = s.settlers[0]!;
    expect(inNightWindow(x, 22)).toBe(true);
    expect(inNightWindow(x, 6)).toBe(false);
    withTrait(s, 'nightOwl');
    const [start, end] = PERSONAL_NIGHT_WINDOW.nightOwl;
    expect(inNightWindow(x, start + 1)).toBe(true);
    expect(inNightWindow(x, end + 1)).toBe(false);
    expect(inNightWindow(x, 22)).toBe(false); // an owl is still up in the evening
    withTrait(s, 'earlyBird');
    expect(inNightWindow(x, 19.5)).toBe(true);
    expect(inNightWindow(x, 4.5)).toBe(false);
  });

  it('nightOwl works outdoors at night without the light penalty', () => {
    const s = fresh();
    s.time.timeOfDay = 23;
    const x = s.settlers[0]!;
    const normal = workSpeedMult(ctxOf(s), x, 'woodcutting', 'woodcutting');
    withTrait(s, 'nightOwl');
    expect(workSpeedMult(ctxOf(s), x, 'woodcutting', 'woodcutting')).toBeGreaterThan(normal);
  });
});
