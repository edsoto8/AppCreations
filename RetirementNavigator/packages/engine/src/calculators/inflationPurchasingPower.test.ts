/**
 * Inflation purchasing power (docs/financial-model.md §12.7). Closed forms computed in the test only:
 * future cost = A(1+i)^n; today's value = F/(1+i)^n. Engine parity with `priceIndex`.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { priceIndex } from '../time';
import { inflationPurchasingPower } from './inflationPurchasingPower';

const ctx = { currentYear: 2026, rules: RULES };
const cents = (d: number) => Math.round(d * 100);

describe('inflationPurchasingPower', () => {
  it('matches the closed forms and the engine price index', () => {
    const i = 0.03;
    const n = 25;
    const result = inflationPurchasingPower(
      { amount: dollars(50_000), futureAmount: dollars(100_000), years: n, inflation: i },
      ctx,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const v = result.value;
    expect(Math.abs(v.futureCost - cents(50_000 * (1 + i) ** n))).toBeLessThanOrEqual(1);
    expect(Math.abs(v.todaysValue - cents(100_000 / (1 + i) ** n))).toBeLessThanOrEqual(1);
    expect(v.priceLevel).toBeCloseTo(priceIndex(i, n + 1), 12);
    expect(v.rows).toHaveLength(n + 1);
    expect(v.rows[0]).toMatchObject({ yearsFromNow: 0, priceLevel: 1, costOfTodaysAmount: dollars(50_000) });
    expect(v.rows[0]?.todaysValueOfFutureAmount).toBe(dollars(100_000));
    expect(v.excludedFeatures).toEqual([]);
    expect(v.basis.dollars).toBe('nominalAndTodaysDollars');
  });

  it('uses the same amount when no future amount is given, and handles deflation and fixture rules', () => {
    const result = inflationPurchasingPower(
      { amount: dollars(1_000), years: 10, inflation: -0.02 },
      {
        currentYear: 2026,
        rules: fixtureRules(),
      },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(Math.abs(result.value.futureCost - cents(1_000 * 0.98 ** 10))).toBeLessThanOrEqual(1);
    expect(Math.abs(result.value.todaysValue - cents(1_000 / 0.98 ** 10))).toBeLessThanOrEqual(1);
  });

  it('is exact at zero inflation and rejects bad inflation', () => {
    const zero = inflationPurchasingPower({ amount: dollars(10), years: 5, inflation: 0 }, ctx);
    expect(zero.status === 'ok' && [zero.value.futureCost, zero.value.todaysValue]).toEqual([dollars(10), dollars(10)]);
    const bad = inflationPurchasingPower({ amount: dollars(10), years: 5, inflation: 0.9 }, ctx);
    expect(bad.status === 'invalid' && bad.issues[0]?.path).toEqual(['inflation']);
  });
});
