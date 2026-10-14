import { describe, expect, it } from 'vitest';
import {
  addMonthsIso,
  currencySymbol,
  daysInMonth,
  formatAxisMonth,
  formatCount,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDuration,
  formatMetric,
  formatMonths,
  formatMonthYear,
  formatNumber,
  formatPercent,
  isValidIsoDate,
  parseIsoDate,
  todayIso,
  toIsoDate,
} from './format';

describe('environment', () => {
  it('runs these tests in a negative UTC offset so date shifts would show up', () => {
    // vite.config.ts sets TZ=America/Los_Angeles for the test run.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBeGreaterThan(0);
    // The trap the formatters avoid: parsing an ISO date string lands on the previous local day.
    expect(new Date('2026-01-15').getDate()).toBe(14);
  });
});

describe('formatCurrency', () => {
  it('shows cents and grouping', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(1_000_000)).toBe('$1,000,000.00');
  });

  it('rounds to cents half away from zero like the engine', () => {
    expect(formatCurrency(10.005)).toBe('$10.01');
    expect(formatCurrency(2.675)).toBe('$2.68');
  });

  it('formats negatives and never shows negative zero', () => {
    expect(formatCurrency(-42.1)).toBe('-$42.10');
    expect(formatCurrency(-0)).toBe('$0.00');
    expect(formatCurrency(-0.004)).toBe('$0.00');
  });

  it('uses the preference currency', () => {
    expect(formatCurrency(99.9, 'EUR')).toBe('€99.90');
    expect(formatCurrency(99.9, 'GBP')).toBe('£99.90');
    expect(formatCurrency(99.9, 'CAD')).toBe('CA$99.90');
    expect(formatCurrency(99.9, 'AUD')).toBe('A$99.90');
    expect(formatCurrency(99.9, 'MXN')).toBe('MX$99.90');
  });

  it('falls back to USD for an invalid code', () => {
    expect(formatCurrency(5, 'nope')).toBe('$5.00');
    expect(formatCurrency(5, '')).toBe('$5.00');
  });

  it('supports whole-dollar and signed output', () => {
    expect(formatCurrency(1234.56, 'USD', { cents: false })).toBe('$1,235');
    expect(formatCurrency(50, 'USD', { signDisplay: 'always' })).toBe('+$50.00');
  });

  it('renders an em dash for missing values', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
    expect(formatCurrency(Number.NaN)).toBe('—');
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatCurrencyCompact', () => {
  it('compacts axis values', () => {
    expect(formatCurrencyCompact(0)).toBe('$0');
    expect(formatCurrencyCompact(950)).toBe('$950');
    expect(formatCurrencyCompact(25_000)).toBe('$25K');
    expect(formatCurrencyCompact(12_500)).toBe('$12.5K');
    expect(formatCurrencyCompact(1_250_000)).toBe('$1.3M');
    expect(formatCurrencyCompact(25_000, 'EUR')).toBe('€25K');
    expect(formatCurrencyCompact(null)).toBe('—');
  });
});

describe('currencySymbol', () => {
  it('returns the symbol for inputs', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('CAD')).toBe('CA$');
  });
});

describe('formatPercent / formatNumber / formatCount', () => {
  it('formats percent units (6.49 means 6.49%)', () => {
    expect(formatPercent(6.49)).toBe('6.49%');
    expect(formatPercent(6.5)).toBe('6.50%');
    expect(formatPercent(51.29, 1)).toBe('51.3%');
    expect(formatPercent(100, 0)).toBe('100%');
    expect(formatPercent(-0.001)).toBe('0.00%');
    expect(formatPercent(null)).toBe('—');
  });

  it('formats plain numbers and counts', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(3.14159, 2)).toBe('3.14');
    expect(formatCount(1, 'payment')).toBe('1 payment');
    expect(formatCount(27, 'payment')).toBe('27 payments');
    expect(formatCount(0, 'month')).toBe('0 months');
    expect(formatCount(2, 'entry', 'entries')).toBe('2 entries');
  });
});

describe('durations', () => {
  it('formats months', () => {
    expect(formatMonths(1)).toBe('1 month');
    expect(formatMonths(18)).toBe('18 months');
    expect(formatMonths(null)).toBe('—');
  });

  it('formats "X yr Y mo"', () => {
    expect(formatDuration(0)).toBe('0 mo');
    expect(formatDuration(8)).toBe('8 mo');
    expect(formatDuration(12)).toBe('1 yr');
    expect(formatDuration(27)).toBe('2 yr 3 mo');
    expect(formatDuration(72)).toBe('6 yr');
    expect(formatDuration(-14)).toBe('-1 yr 2 mo');
    expect(formatDuration(2.6)).toBe('3 mo');
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('ISO dates (no timezone shift)', () => {
  it('parses yyyy-MM-dd into calendar parts', () => {
    expect(parseIsoDate('2026-01-15')).toEqual({ year: 2026, month: 1, day: 15 });
    expect(parseIsoDate('2026-01-15T00:00:00Z')).toEqual({ year: 2026, month: 1, day: 15 });
  });

  it('rejects malformed and impossible dates', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('2026-1-5')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2025-02-29')).toBe(false);
  });

  it('formats the same calendar day in a negative-offset zone', () => {
    expect(formatDate('2026-01-15')).toBe('Jan 15, 2026');
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31', 'long')).toBe('December 31, 2026');
    expect(formatDate('2026-03-08', 'short')).toBe('03/08/2026');
    expect(formatDate('not a date')).toBe('—');
  });

  it('formats month-year and axis labels', () => {
    expect(formatMonthYear('2029-01-01')).toBe('Jan 2029');
    expect(formatMonthYear('2029-01-01', 'long')).toBe('January 2029');
    expect(formatAxisMonth('2027-03-01')).toBe("Mar '27");
    expect(formatAxisMonth('2005-11-30')).toBe("Nov '05");
    expect(formatAxisMonth(null)).toBe('');
  });

  it('converts local Dates and parts to ISO', () => {
    expect(toIsoDate(new Date(2026, 9, 14, 23, 30))).toBe('2026-10-14');
    expect(toIsoDate({ year: 2026, month: 2, day: 3 })).toBe('2026-02-03');
    expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });

  it('adds calendar months with end-of-month clamping', () => {
    expect(addMonthsIso('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsIso('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsIso('2026-01-10', -13)).toBe('2024-12-10');
    expect(daysInMonth(2024, 2)).toBe(29);
  });
});

describe('formatMetric', () => {
  it('formats insight metrics by their declared format', () => {
    expect(formatMetric({ label: 'Interest saved', value: 85.17, format: 'currency' })).toBe('$85.17');
    expect(formatMetric({ label: 'Repaid', value: 51.29, format: 'percent' })).toBe('51.3%');
    expect(formatMetric({ label: 'Sooner', value: 27, format: 'months' })).toBe('2 yr 3 mo');
    expect(formatMetric({ label: 'Payments left', value: 1027, format: 'count' })).toBe('1,027');
    expect(formatMetric({ label: 'Saved', value: 10, format: 'currency' }, 'EUR')).toBe('€10.00');
  });
});
