import { describe, expect, it } from 'vitest';
import { makeRows } from '@/test/fixtures';
import { historyRows, lumpSumRow, scenarioRows } from './fixtures';
import {
  buildIcs,
  buildRows,
  compareAnnual,
  compareRows,
  EMPTY_FILTERS,
  filterItems,
  nextRowIndex,
  normalizeSearch,
  rowSearchText,
  rowTotals,
  upcomingRows,
} from './scheduleModel';

const access = (currency = 'USD') => ({
  date: (r: { date: string }) => r.date,
  text: (r: Parameters<typeof rowSearchText>[0]) => rowSearchText(r, currency),
  hasExtra: (r: { extraPayment: number }) => r.extraPayment > 0,
});

describe('scheduleModel', () => {
  it('tags history and projection rows with stable keys', () => {
    const rows = buildRows(historyRows(), makeRows());
    expect(rows).toHaveLength(30);
    expect(rows[0]).toMatchObject({ phase: 'history', key: 'h-0', isEstimated: true });
    expect(rows[3]).toMatchObject({ phase: 'projection', key: 'p-0', number: 34 });
  });

  it('searches numbers, dates in several formats and amounts with or without $ and commas', () => {
    const rows = makeRows();
    const by = (search: string) => filterItems(rows, { ...EMPTY_FILTERS, search }, access()).map((r) => r.number);
    expect(by('#48')).toEqual([48]);
    expect(by('48')).toEqual([40, 48]); // payment #48, and #40's $48.06 interest
    expect(by('2029')).toEqual([60]);
    expect(by('483.35')).toEqual([60]);
    expect(by('01/01/2028')).toEqual([48]);
    expect(by('January 1, 2028')).toEqual([48]);
    expect(by('2028-01-01')).toEqual([48]);
    expect(by('$5,615.69')).toEqual([48, 49]);
    expect(by('5615.69')).toEqual([48, 49]);
    expect(normalizeSearch('  $1,234.50  ')).toBe('1234.50');
  });

  it('combines year, date range and extra-payment filters', () => {
    const rows = [...scenarioRows(), lumpSumRow];
    const f = (patch: Partial<typeof EMPTY_FILTERS>) => filterItems(rows, { ...EMPTY_FILTERS, ...patch }, access());
    expect(f({ year: 2027 })).toHaveLength(12);
    expect(f({ extraOnly: true }).map((r) => r.number)).toEqual([34, 35, 36, null]);
    expect(f({ from: '2026-12-01', to: '2026-12-31' }).map((r) => r.kind)).toEqual(['payment', 'lumpSum']);
  });

  it('adds totals in whole cents', () => {
    const t = rowTotals(makeRows());
    expect(t.interest).toBe(870.94);
    expect(t.principal).toBe(12178.73);
  });

  it('lines up baseline and scenario by payment number and places lump sums by date', () => {
    const rows = compareRows(makeRows(), [...scenarioRows(), lumpSumRow]);
    expect(rows[0]).toMatchObject({ number: 34, interestDiff: 0, balanceDiff: -100 });
    const lumpIndex = rows.findIndex((r) => r.kind === 'lumpSum');
    expect(rows[lumpIndex - 1].number).toBe(35);
    expect(rows[lumpIndex + 1].number).toBe(36);
    // After the scenario pays off (#53), the scenario side is empty and counts as zero.
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ number: 60, scenario: null, interestDiff: -2.4, balanceDiff: 0 });
  });

  it('compares annual rows, including years only one plan has', () => {
    const rows = compareAnnual(
      [{ year: 2028, payments: 12, totalPaid: 100, principal: 90, interest: 10, extra: 0, endingBalance: 50 }],
      [{ year: 2027, payments: 12, totalPaid: 100, principal: 95, interest: 5, extra: 0, endingBalance: 0 }],
    );
    expect(rows.map((r) => r.year)).toEqual([2027, 2028]);
    expect(rows[1]).toMatchObject({ scenario: null, interestDiff: -10, balanceDiff: -50 });
  });

  it('finds the next payment and the next 12 upcoming rows', () => {
    const rows = buildRows(historyRows(), makeRows());
    expect(rows[nextRowIndex(rows, '2026-10-14')].number).toBe(34);
    expect(rows[nextRowIndex(rows, '2026-11-01')].number).toBe(34);
    const upcoming = upcomingRows(makeRows(), '2028-06-15');
    expect(upcoming.map((r) => r.number)).toEqual([54, 55, 56, 57, 58, 59, 60]);
  });

  it('builds an all-day iCalendar event per payment', () => {
    const ics = buildIcs(makeRows().slice(0, 2), 'My car', 'USD');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261101');
    expect(ics).toContain('DTEND;VALUE=DATE:20261102');
    expect(ics).toContain('SUMMARY:Car payment #34: $483.32 (My car)');
  });
});
