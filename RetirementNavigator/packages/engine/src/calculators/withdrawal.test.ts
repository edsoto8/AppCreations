/**
 * Withdrawal calculator (docs/financial-model.md §12.8). Closed forms computed in the test only, with
 * mid-year withdrawals E_t = E_{t−1}(1+r) − W_t(1+r)^½ (§1.5):
 * - ending balance after n years of a level withdrawal W: S(1+r)^n − W(1+r)^½((1+r)^n − 1)/r;
 * - payment that exhausts S in n years with W_t = W(1+i)^{t−1}: W = S(1+r)^½(1 − q)/(1 − q^n), q = (1+i)/(1+r)
 *   (with i = 0 this is the payment formula PV·r/(1 − (1+r)^−n), divided by (1+r)^½ for mid-year timing);
 * - start-of-year timing (annuity due): W = S·r/((1+r)(1 − (1+r)^−n)).
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { withdrawal, type WithdrawalResult } from './withdrawal';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const fixtureCtx = { currentYear: YEAR, rules: fixtureRules() };
const cents = (d: number) => Math.round(d * 100);

function ok(r: ReturnType<typeof withdrawal>): WithdrawalResult {
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') throw new Error('not ok');
  return r.value;
}

describe('withdrawal: fixed percentage', () => {
  it('matches the closed-form ending balance of a level withdrawal (zero inflation)', () => {
    const v = ok(
      withdrawal(
        {
          mode: 'fixedPercentage',
          startingBalance: dollars(1_000_000),
          withdrawalRate: 0.04,
          years: 30,
          annualReturn: 0.05,
          inflation: 0,
        },
        ctx,
      ),
    );
    if (v.mode !== 'fixedPercentage') throw new Error('mode');
    const r = 0.05;
    const n = 30;
    const end = 1_000_000 * (1 + r) ** n - 40_000 * Math.sqrt(1 + r) * (((1 + r) ** n - 1) / r);
    expect(Math.abs(v.endingBalance - cents(end))).toBeLessThanOrEqual(1);
    expect(v.annualSpending).toBe(dollars(40_000));
    expect(v.rows).toHaveLength(n);
    expect(v.rows[0]?.withdrawals).toBe(dollars(40_000));
    expect(v.longevity).toEqual({
      lastsThroughHorizon: true,
      depletionYear: null,
      depletionAge: null,
      yearsFullyFunded: 30,
    });
    expect(v.basis).toEqual({ dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' });
  });

  it('reports longevity: 10% a year at a zero return lasts exactly 10 years', () => {
    const v = ok(
      withdrawal(
        {
          mode: 'fixedPercentage',
          startingBalance: dollars(100_000),
          withdrawalRate: 0.1,
          years: 15,
          annualReturn: 0,
          inflation: 0,
        },
        ctx,
      ),
    );
    if (v.mode !== 'fixedPercentage') throw new Error('mode');
    expect(v.longevity).toEqual({
      lastsThroughHorizon: false,
      depletionYear: YEAR + 10,
      depletionAge: 75,
      yearsFullyFunded: 10,
    });
    expect(v.success).toBe(false);
    expect(v.rows[10]?.shortfall).toBe(dollars(10_000));
  });

  it('labels before taxes for a tax-deferred account while tax rules are unverified', () => {
    const v = ok(
      withdrawal(
        {
          mode: 'fixedPercentage',
          startingBalance: dollars(500_000),
          withdrawalRate: 0.05,
          years: 25,
          annualReturn: 0.05,
          inflation: 0.02,
          taxTreatment: 'taxDeferred',
        },
        ctx,
      ),
    );
    expect(v.basis.tax).toBe('beforeTaxes');
    expect(v.excludedFeatures).toContain('federalIncomeTax');
    expect(v.unverified.length).toBeGreaterThan(0);
  });
});

describe('withdrawal: sustainable rate', () => {
  const base = {
    mode: 'sustainableRate' as const,
    startingBalance: dollars(1_000_000),
    years: 30,
    annualReturn: 0.05,
    inflation: 0,
  };

  it('matches the payment closed form with mid-year withdrawals', () => {
    const v = ok(withdrawal(base, ctx));
    if (v.mode !== 'sustainableRate') throw new Error('mode');
    const r = 0.05;
    const n = 30;
    const w = (r / (Math.sqrt(1 + r) * (1 - (1 + r) ** -n))) * 1;
    expect(v.search).toBe('found');
    expect(Math.abs((v.sustainableRate ?? 0) - w)).toBeLessThan(2e-6);
    expect(v.plan?.longevity.lastsThroughHorizon).toBe(true);
  });

  it('matches the growing-payment closed form with inflation', () => {
    const r = 0.06;
    const i = 0.03;
    const n = 25;
    const v = ok(withdrawal({ ...base, years: n, annualReturn: r, inflation: i }, ctx));
    if (v.mode !== 'sustainableRate') throw new Error('mode');
    const q = (1 + i) / (1 + r);
    const w = (Math.sqrt(1 + r) * (1 - q)) / (1 - q ** n);
    expect(Math.abs((v.sustainableRate ?? 0) - w)).toBeLessThan(2e-6);
  });

  it('matches the annuity-due closed form with start-of-year withdrawals', () => {
    const r = 0.04;
    const n = 20;
    const v = ok(withdrawal({ ...base, years: n, annualReturn: r, withdrawalTiming: 'startOfYear' }, ctx));
    if (v.mode !== 'sustainableRate') throw new Error('mode');
    const w = r / ((1 + r) * (1 - (1 + r) ** -n));
    expect(Math.abs((v.sustainableRate ?? 0) - w)).toBeLessThan(2e-6);
  });

  it('is lower after taxes than before for a tax-deferred account (fixture rules)', () => {
    const deferred = { ...base, taxTreatment: 'taxDeferred' as const, age: 60 };
    const before = ok(withdrawal({ ...deferred, taxTreatment: 'taxFree' }, fixtureCtx));
    const after = ok(withdrawal(deferred, fixtureCtx));
    if (before.mode !== 'sustainableRate' || after.mode !== 'sustainableRate') throw new Error('mode');
    expect(after.basis.tax).toBe('afterTaxes');
    expect(after.sustainableRate ?? 1).toBeLessThan(before.sustainableRate ?? 0);
  });

  it('reports the bound when even 100% lasts, and nothing when even 0% fails', () => {
    const atBound = ok(withdrawal({ ...base, years: 1 }, ctx));
    if (atBound.mode !== 'sustainableRate') throw new Error('mode');
    expect(atBound.search).toBe('atBound');
    expect(atBound.sustainableRate).toBe(1);
    const none = ok(withdrawal({ ...base, minimumEndingBalance: dollars(100_000_000) }, ctx));
    if (none.mode !== 'sustainableRate') throw new Error('mode');
    expect(none.search).toBe('notWithinBound');
    expect(none.sustainableRate).toBeNull();
    expect(none.plan).toBeNull();
  });
});

describe('withdrawal: invalid input', () => {
  it('rejects a plan past age 120 and a bad rate with field paths', () => {
    const r = withdrawal(
      {
        mode: 'fixedPercentage',
        startingBalance: 1,
        withdrawalRate: 2,
        years: 60,
        age: 70,
        annualReturn: 0,
        inflation: 0,
      },
      ctx,
    );
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') return;
    expect(r.issues.map((i) => i.path.join('.'))).toContain('withdrawalRate');
    const late = withdrawal(
      { mode: 'sustainableRate', startingBalance: 1, years: 60, age: 70, annualReturn: 0, inflation: 0 },
      ctx,
    );
    expect(late.status === 'invalid' && late.issues[0]?.path).toEqual(['years']);
    expect(withdrawal({ mode: 'other' } as never, ctx).status).toBe('invalid');
  });
});
