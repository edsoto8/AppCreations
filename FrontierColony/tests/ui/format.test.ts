import { describe, expect, it } from 'vitest';
import {
  dayPhase,
  daysOfSupply,
  formatClock,
  formatDays,
  formatRate,
  formatRelativeTime,
  quantizeRate,
  seasonInfo,
  skyPosition,
  stockLevel,
} from '../../src/ui/lib/format';

describe('clock helpers', () => {
  it('formats HH:MM', () => {
    expect(formatClock(6)).toBe('06:00');
    expect(formatClock(13.5)).toBe('13:30');
    expect(formatClock(23.999)).toBe('23:59');
  });

  it('names the day phases from the design doc', () => {
    expect(dayPhase(4.9)).toBe('night');
    expect(dayPhase(5)).toBe('dawn');
    expect(dayPhase(7)).toBe('day');
    expect(dayPhase(18)).toBe('dusk');
    expect(dayPhase(20)).toBe('night');
    expect(dayPhase(0)).toBe('night');
  });

  it('moves the sun from 05:00 to 20:00 and the moon through the night', () => {
    expect(skyPosition(5)).toEqual({ body: 'sun', t: 0 });
    expect(skyPosition(12.5).t).toBeCloseTo(0.5);
    expect(skyPosition(20).body).toBe('moon');
    expect(skyPosition(20).t).toBe(0);
    expect(skyPosition(0).t).toBeCloseTo(4 / 9);
    expect(skyPosition(4.99).body).toBe('moon');
  });

  it('derives season and year from the day', () => {
    expect(seasonInfo(1)).toMatchObject({ season: 'spring', dayInSeason: 1, year: 1, daysUntilNextSeason: 4 });
    expect(seasonInfo(5)).toMatchObject({ season: 'spring', dayInSeason: 5, daysUntilNextSeason: 0 });
    expect(seasonInfo(6).season).toBe('summer');
    expect(seasonInfo(16).season).toBe('winter');
    expect(seasonInfo(21)).toMatchObject({ season: 'spring', year: 2 });
  });
});

describe('rates and supply', () => {
  it('formats rates with a real minus sign and a flat band', () => {
    expect(formatRate(4.23)).toEqual({ text: '+4.2', trend: 'up' });
    expect(formatRate(-12.4)).toEqual({ text: '−12', trend: 'down' });
    expect(formatRate(-0.8).text).toBe('−0.8');
    expect(formatRate(0.01)).toEqual({ text: '±0', trend: 'flat' });
    expect(formatRate(Number.NaN).trend).toBe('flat');
  });

  it('quantizes to the displayed precision so invisible changes do not re-render', () => {
    expect(quantizeRate(4.231)).toBe(4.2);
    expect(quantizeRate(4.249)).toBe(4.2);
    expect(quantizeRate(12.4)).toBe(12);
    expect(quantizeRate(0.02)).toBe(0);
  });

  it('computes days of supply at 2 per settler per day', () => {
    expect(daysOfSupply(60, 5)).toBe(6);
    expect(daysOfSupply(10, 0)).toBeNull();
    expect(stockLevel(0, 5)).toBe('out');
    expect(stockLevel(9, 5)).toBe('low');
    expect(stockLevel(10, 5)).toBe('ok');
    expect(stockLevel(5, 0)).toBe('ok');
    expect(formatDays(1)).toBe('1.0 day');
    expect(formatDays(2.46)).toBe('2.4 days');
    expect(formatDays(12.9)).toBe('12 days');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('describes recent and older saves', () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe('just now');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe('2 days ago');
    expect(formatRelativeTime(null, now)).toBe('unknown time');
    expect(formatRelativeTime('garbage', now)).toBe('unknown time');
  });
});
