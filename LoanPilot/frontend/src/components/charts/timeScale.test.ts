import { describe, expect, it } from 'vitest';
import { mergeBalanceSeries } from './BalanceComparisonChart';
import { dayToIso, isoToDay, monthTicks } from './timeScale';

describe('timeScale', () => {
  it('round-trips ISO dates without timezone shifts', () => {
    for (const d of ['2026-10-01', '2028-02-29', '2030-12-31']) expect(dayToIso(isoToDay(d))).toBe(d);
    expect(isoToDay('2026-10-02') - isoToDay('2026-10-01')).toBe(1);
  });

  it('picks month-start ticks with a readable step', () => {
    const ticks = monthTicks(isoToDay('2026-10-01'), isoToDay('2030-07-10'), 6).map(dayToIso);
    expect(ticks).toEqual(['2027-01-01', '2028-01-01', '2029-01-01', '2030-01-01']);
    const short = monthTicks(isoToDay('2026-10-14'), isoToDay('2027-06-01'), 6).map(dayToIso);
    expect(short).toEqual(['2026-11-01', '2027-01-01', '2027-03-01', '2027-05-01']);
  });
});

describe('mergeBalanceSeries', () => {
  it('carries balances forward between postings and stops each series after payoff', () => {
    const merged = mergeBalanceSeries([
      { key: 'a', name: 'A', color: 'x', payoffDate: '2027-03-01', points: [{ date: '2027-01-01', balance: 300 }, { date: '2027-02-01', balance: 150 }, { date: '2027-03-01', balance: 0 }] },
      { key: 'b', name: 'B', color: 'y', payoffDate: '2027-02-01', points: [{ date: '2027-01-01', balance: 300 }, { date: '2027-01-15', balance: 100 }, { date: '2027-02-01', balance: 0 }] },
    ]);
    expect(merged.map((d) => [d.date, d.a, d.b])).toEqual([
      ['2027-01-01', 300, 300],
      ['2027-01-15', 300, 100],
      ['2027-02-01', 150, 0],
      ['2027-03-01', 0, null],
    ]);
  });
});
