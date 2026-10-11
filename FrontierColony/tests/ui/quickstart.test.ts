import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_GAME_OPTIONS } from '../../src/sim';
import { parseQuickstart } from '../../src/ui/lib/quickstart';

describe('parseQuickstart', () => {
  it('returns null without the flag', () => {
    expect(parseQuickstart('')).toBeNull();
    expect(parseQuickstart('?seed=abc')).toBeNull();
  });

  it('uses the default options for a bare flag', () => {
    expect(parseQuickstart('?quickstart')).toEqual(DEFAULT_NEW_GAME_OPTIONS);
  });

  it('applies valid overrides and ignores invalid ones', () => {
    expect(parseQuickstart('?quickstart&seed=abc&preset=archipelago&size=medium&difficulty=harsh&name=Fort')).toEqual({
      seed: 'abc',
      colonyName: 'Fort',
      preset: 'archipelago',
      mapSize: 'medium',
      difficulty: 'harsh',
    });
    expect(parseQuickstart('?quickstart&preset=moon&size=huge&difficulty=easy')).toEqual(DEFAULT_NEW_GAME_OPTIONS);
  });
});
