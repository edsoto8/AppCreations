import { describe, expect, it } from 'vitest';
import {
  arrangeRoster,
  formatHoursLeft,
  formatSigned,
  lowestNeed,
  moodBand,
  moodletLabel,
  needLevel,
  needWarning,
  trendOf,
  xpToNext,
  type RosterRow,
} from '../../src/ui/lib/settlerInfo';

const needs = (o: Partial<Record<'hunger' | 'energy' | 'happiness' | 'health', number>> = {}) => ({ hunger: 80, energy: 80, happiness: 60, health: 100, ...o });
const row = (id: number, name: string, n = needs(), kind = 'walking', sick = false): RosterRow => ({ id, name, needs: n, activity: { kind }, sick });

describe('mood and needs', () => {
  it('maps happiness to the design-doc bands', () => {
    expect(moodBand(100)).toBe('inspired');
    expect(moodBand(80)).toBe('inspired');
    expect(moodBand(79.9)).toBe('content');
    expect(moodBand(50)).toBe('content');
    expect(moodBand(49)).toBe('unhappy');
    expect(moodBand(30)).toBe('unhappy');
    expect(moodBand(29)).toBe('miserable');
    expect(moodBand(15)).toBe('miserable');
    expect(moodBand(14)).toBe('breaking');
  });

  it('classifies need levels', () => {
    expect(needLevel(50)).toBe('ok');
    expect(needLevel(29)).toBe('low');
    expect(needLevel(14)).toBe('critical');
  });

  it('picks the most urgent warning: critical first, then the lowest value', () => {
    expect(needWarning(needs())).toBeNull();
    expect(needWarning(needs({ hunger: 25 }))).toEqual({ need: 'hunger', level: 'low', text: 'Hungry' });
    expect(needWarning(needs({ hunger: 10 }))).toMatchObject({ level: 'critical', text: 'Starving' });
    expect(needWarning(needs({ hunger: 20, energy: 5 }))).toMatchObject({ need: 'energy', level: 'critical', text: 'Exhausted' });
    expect(needWarning(needs({ hunger: 20, health: 10, energy: 12 }))).toMatchObject({ need: 'health' });
  });

  it('finds the lowest need', () => {
    expect(lowestNeed(needs({ energy: 12 }))).toEqual({ need: 'energy', value: 12 });
  });
});

describe('roster arrangement', () => {
  const rows = [
    row(1, 'Cora', needs({ happiness: 70 })),
    row(2, 'Abel', needs({ hunger: 10 }), 'idle'),
    row(3, 'Bram', needs({ happiness: 40 }), 'wandering'),
    row(4, 'Dina', needs(), 'chopping', true),
  ];

  it('sorts by name, mood and lowest need', () => {
    expect(arrangeRoster(rows, 'all', 'name').map((r) => r.name)).toEqual(['Abel', 'Bram', 'Cora', 'Dina']);
    // Happiness: Bram 40, Abel/Dina 60 (name tie-break), Cora 70.
    expect(arrangeRoster(rows, 'all', 'mood').map((r) => r.name)).toEqual(['Bram', 'Abel', 'Dina', 'Cora']);
    expect(arrangeRoster(rows, 'all', 'needs')[0]!.name).toBe('Abel');
  });

  it('filters to settlers needing attention (low needs or sick) and to idle ones', () => {
    expect(arrangeRoster(rows, 'attention', 'name').map((r) => r.name)).toEqual(['Abel', 'Dina']);
    expect(arrangeRoster(rows, 'idle', 'name').map((r) => r.name)).toEqual(['Abel', 'Bram']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    arrangeRoster(rows, 'all', 'needs');
    expect(rows).toEqual(copy);
  });
});

describe('labels and formatting', () => {
  it('names moodlets, prettifying unknown ids', () => {
    expect(moodletLabel('sleptInHouse')).toBe('Slept in a bed');
    expect(moodletLabel('brandNewThing')).toBe('Brand new thing');
  });

  it('formats signed values and time left', () => {
    expect(formatSigned(6)).toBe('+6');
    expect(formatSigned(-10)).toBe('−10');
    expect(formatSigned(0)).toBe('0');
    expect(formatHoursLeft(null)).toBeNull();
    expect(formatHoursLeft(0.4)).toBe('<1 h left');
    expect(formatHoursLeft(18)).toBe('18 h left');
    expect(formatHoursLeft(30)).toBe('1 d 6 h left');
  });

  it('computes trends with a dead band', () => {
    expect(trendOf(null, 50)).toBe('flat');
    expect(trendOf(50, 50.2)).toBe('flat');
    expect(trendOf(50, 52)).toBe('up');
    expect(trendOf(50, 47)).toBe('down');
  });

  it('xp to the next level follows the design formula', () => {
    expect(xpToNext(0)).toBe(10);
    expect(xpToNext(4)).toBe(50);
  });
});
