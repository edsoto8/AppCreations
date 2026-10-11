import { describe, expect, it, vi } from 'vitest';
import { MAP_PRESETS, validateGameState, type Difficulty, type MapPreset } from '../../src/sim';
import { assertInvariants } from '../../src/sim/testSupport';
import { playScript, type ScriptItem } from './support/player';

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

function month(preset: MapPreset, difficulty: Difficulty, seed: string) {
  return playScript({ seed, preset, difficulty }, MONTH, 30, [10, 20, 30], {
    onTick: (s, t) => {
      if (t % 150 === 0) assertInvariants(s);
    },
  });
}

describe('30-day soak, normal difficulty, sensible player', () => {
  it.each(MAP_PRESETS)('%s: the colony survives its first winter and keeps growing', (preset) => {
    const report = month(preset, 'normal', 'soak-b');
    const s = report.state;
    const at = (day: number) => report.checkpoints.find((c) => c.day === day)!;
    expect(s.outcome.status).not.toBe('lost');
    expect(at(20).pop).toBeGreaterThanOrEqual(8); // day 20 is the last day of winter: nobody has been lost
    expect(at(30).pop).toBeGreaterThanOrEqual(at(10).pop);
    expect(at(30).pop).toBeLessThanOrEqual(30);
    expect(at(30).stock.food).toBeGreaterThan(50);
    expect(at(30).stock.water).toBeGreaterThan(50);
    expect(s.stats.deaths).toBeLessThanOrEqual(2);
    expect(s.progress.objectivesDone).toEqual(expect.arrayContaining(['roof', 'bread', 'water', 'foundations', 'timber', 'toolmaker', 'winter']));
    expect(validateGameState(JSON.parse(JSON.stringify(s))).ok).toBe(true);
  });
});

describe('30-day soak, harsh difficulty, sensible player', () => {
  it.each(MAP_PRESETS)('%s: runs cleanly (survival is reported, not guaranteed)', (preset) => {
    const report = month(preset, 'harsh', 'soak-b');
    const s = report.state;
    // Harsh is allowed to kill the colony, but the state must stay valid either way.
    expect(validateGameState(JSON.parse(JSON.stringify(s))).ok).toBe(true);
    if (s.outcome.status === 'lost') expect(s.settlers).toHaveLength(0);
    else expect(s.settlers.length).toBeGreaterThan(0);
  });
});
