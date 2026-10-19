/**
 * Fee impact calculator (docs/financial-model.md §12.10). Closed form computed in the test only:
 * FV at the net rate ρ = (1+r)(1−f) − 1 (§4) versus at r, with mid-year contributions.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { dollars } from '../money';
import { feeImpact } from './feeImpact';
import { compoundInterest } from './compoundInterest';

const ctx = { currentYear: 2026, rules: RULES };
const cents = (d: number) => Math.round(d * 100);
const fv = (pv: number, pmt: number, rate: number, n: number) =>
  pv * (1 + rate) ** n + pmt * Math.sqrt(1 + rate) * (((1 + rate) ** n - 1) / rate);

describe('feeImpact', () => {
  it('matches the closed forms with and without the expense ratio', () => {
    const r = 0.07;
    const f = 0.01;
    const n = 30;
    const result = feeImpact(
      { principal: dollars(50_000), annualContribution: dollars(5_000), annualReturn: r, expenseRatio: f, years: n },
      ctx,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const v = result.value;
    const withFees = fv(50_000, 5_000, (1 + r) * (1 - f) - 1, n);
    const without = fv(50_000, 5_000, r, n);
    expect(Math.abs(v.withFees.endingBalance - cents(withFees))).toBeLessThanOrEqual(1);
    expect(Math.abs(v.withoutFees.endingBalance - cents(without))).toBeLessThanOrEqual(1);
    expect(v.lifetimeCost).toBe(v.withoutFees.endingBalance - v.withFees.endingBalance);
    // Fees charged are less than the lifetime cost (which adds the growth the fees would have earned).
    expect(v.feesCharged).toBeGreaterThan(0);
    expect(v.feesCharged).toBeLessThan(v.lifetimeCost);
    expect(v.rows[n - 1]?.cumulativeCost).toBe(v.lifetimeCost);
    expect(v.withoutFees.totalFeeDrag).toBe(0);
  });

  it('is engine-parity with two compound-interest runs, in today’s dollars too', () => {
    const input = { principal: dollars(10_000), annualReturn: 0.05, expenseRatio: 0.005, years: 10, inflation: 0.03 };
    const fee = feeImpact(input, ctx);
    const a = compoundInterest(input, ctx);
    const b = compoundInterest({ ...input, expenseRatio: 0 }, ctx);
    if (fee.status !== 'ok' || a.status !== 'ok' || b.status !== 'ok') throw new Error('not ok');
    expect(fee.value.withFees).toEqual(a.value.totals);
    expect(fee.value.lifetimeCostReal).toBe(b.value.totals.endingBalanceReal - a.value.totals.endingBalanceReal);
  });

  it('costs nothing at a zero expense ratio and rejects an out-of-range one', () => {
    const zero = feeImpact({ principal: dollars(1_000), annualReturn: 0.05, expenseRatio: 0, years: 5 }, ctx);
    expect(zero.status === 'ok' && zero.value.lifetimeCost).toBe(0);
    const bad = feeImpact({ principal: dollars(1_000), annualReturn: 0.05, expenseRatio: 0.2, years: 5 }, ctx);
    expect(bad.status === 'invalid' && bad.issues[0]?.path).toEqual(['expenseRatio']);
  });
});
