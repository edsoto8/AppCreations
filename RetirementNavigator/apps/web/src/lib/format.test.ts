import { describe, expect, it } from 'vitest';
import {
  formatCents,
  formatDollarsInput,
  formatPercent,
  parseDollarsToCents,
  parsePercent,
  percentInputValue,
} from './format';

describe('format helpers', () => {
  it('formats money and percents', () => {
    expect(formatCents(1_234_567)).toBe('$12,346');
    expect(formatCents(1_234_567, { exact: true })).toBe('$12,345.67');
    expect(formatPercent(0.025)).toBe('2.5%');
    expect(formatPercent(0.03)).toBe('3%');
    expect(formatPercent(0.12345, 2)).toBe('12.35%');
    expect(formatPercent(-0.0000001, 2)).toBe('0%');
    expect(formatDollarsInput(6_200_050)).toBe('62,000.5');
  });

  it('parses user-entered dollars and percents', () => {
    expect(parseDollarsToCents('$62,000.50')).toBe(6_200_050);
    expect(parseDollarsToCents('62000')).toBe(6_200_000);
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('.')).toBeNull();
    expect(parsePercent('6.5%')).toBe(0.065);
    expect(parsePercent('7')).toBe(0.07);
    expect(parsePercent('x')).toBeNull();
    expect(percentInputValue(0.065)).toBe('6.5');
  });
});

describe('toBasis', () => {
  it('deflates year-t values to year-1 dollars', async () => {
    const { toBasis } = await import('./dollarBasis');
    expect(toBasis(10_000, 1, 0.03, 'todays')).toBe(10_000);
    expect(toBasis(10_300, 2, 0.03, 'todays')).toBeCloseTo(10_000, 9);
    expect(toBasis(10_300, 2, 0.03, 'nominal')).toBe(10_300);
  });
});
