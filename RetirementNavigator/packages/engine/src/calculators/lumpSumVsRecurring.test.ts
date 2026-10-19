/**
 * Lump sum vs recurring (docs/financial-model.md §12.11). Closed forms computed in the test only:
 * lump T(1+r)^H; recurring P(1+r)^½((1+r)^n − 1)/r · (1+r)^(H−n) with P = T/n (mid-year deposits).
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { dollars } from '../money';
import { lumpSumVsRecurring } from './lumpSumVsRecurring';

const ctx = { currentYear: 2026, rules: RULES };
const cents = (d: number) => Math.round(d * 100);

describe('lumpSumVsRecurring', () => {
  it('matches the closed forms for both alternatives', () => {
    const r = 0.06;
    const n = 5;
    const h = 20;
    const result = lumpSumVsRecurring(
      { total: dollars(60_000), spreadYears: n, horizonYears: h, annualReturn: r, inflation: 0.02 },
      ctx,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const v = result.value;
    expect(v.recurringAnnualAmount).toBe(dollars(12_000));
    expect(v.recurring.totalContributions).toBe(dollars(60_000));
    expect(Math.abs(v.lumpSum.endingBalance - cents(60_000 * (1 + r) ** h))).toBeLessThanOrEqual(1);
    const recurring = 12_000 * Math.sqrt(1 + r) * (((1 + r) ** n - 1) / r) * (1 + r) ** (h - n);
    expect(Math.abs(v.recurring.endingBalance - cents(recurring))).toBeLessThanOrEqual(1);
    expect(v.difference).toBe(v.lumpSum.endingBalance - v.recurring.endingBalance);
    expect(v.differenceReal).toBe(v.lumpSum.endingBalanceReal - v.recurring.endingBalanceReal);
    expect(v.rows).toHaveLength(h);
    expect(v.rows[h - 1]?.recurringBalance).toBe(v.recurring.endingBalance);
  });

  it('reports the whole-cent recurring amount and the total actually invested', () => {
    const result = lumpSumVsRecurring({ total: 100, spreadYears: 3, horizonYears: 3, annualReturn: 0 }, ctx);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.recurringAnnualAmount).toBe(33);
    expect(result.value.recurring.totalContributions).toBe(99);
    expect(result.value.difference).toBe(1);
  });

  it('rejects a horizon shorter than the spread period', () => {
    const result = lumpSumVsRecurring({ total: 100, spreadYears: 5, horizonYears: 3, annualReturn: 0 }, ctx);
    expect(result.status === 'invalid' && result.issues[0]?.path).toEqual(['horizonYears']);
  });
});
