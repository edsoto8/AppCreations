import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, MAP_PRESETS, MAP_SIZES } from '../../src/sim';
import {
  DIFFICULTY_INFO,
  MAX_COLONY_NAME,
  MAX_SEED_LENGTH,
  PRESET_INFO,
  SIZE_INFO,
  draftToOptions,
} from '../../src/ui/lib/newGameOptions';
import { randomSeed } from '../../src/ui/lib/seed';

describe('new game options', () => {
  it('describes every preset, size and difficulty, and shows Easy/Normal/Hard', () => {
    for (const p of MAP_PRESETS) expect(PRESET_INFO[p].blurb.length).toBeGreaterThan(10);
    for (const s of MAP_SIZES) expect(SIZE_INFO[s].name).toBeTruthy();
    expect(DIFFICULTIES.map((d) => DIFFICULTY_INFO[d].name)).toEqual(['Easy', 'Normal', 'Hard']);
  });

  it('trims and clamps the form values and fills in blanks', () => {
    const base = { preset: 'highlands', mapSize: 'large', difficulty: 'harsh' } as const;
    const options = draftToOptions({ ...base, colonyName: '  Fort  ', seed: ' abc ' }, () => 'fallback');
    expect(options).toEqual({ ...base, colonyName: 'Fort', seed: 'abc' });

    const blank = draftToOptions({ ...base, colonyName: '   ', seed: '' }, () => 'fallback');
    expect(blank.colonyName).toBe('New Hope');
    expect(blank.seed).toBe('fallback');

    const long = draftToOptions({ ...base, colonyName: 'x'.repeat(100), seed: 'y'.repeat(100) }, () => 's');
    expect(long.colonyName).toHaveLength(MAX_COLONY_NAME);
    expect(long.seed).toHaveLength(MAX_SEED_LENGTH);
  });
});

describe('randomSeed', () => {
  it('is deterministic for a given random source and well formed', () => {
    let i = 0;
    const seq = [0.1, 0.5, 0.99];
    const rng = () => seq[i++ % seq.length]!;
    expect(randomSeed(rng)).toMatch(/^[a-z]+-[a-z]+-\d{1,2}$/);
    i = 0;
    const a = randomSeed(rng);
    i = 0;
    expect(randomSeed(rng)).toBe(a);
  });

  it('survives a random source that returns 1 - epsilon or 0', () => {
    expect(randomSeed(() => 0)).toMatch(/^[a-z]+-[a-z]+-0$/);
    expect(randomSeed(() => 0.999999)).toMatch(/^[a-z]+-[a-z]+-99$/);
  });
});
