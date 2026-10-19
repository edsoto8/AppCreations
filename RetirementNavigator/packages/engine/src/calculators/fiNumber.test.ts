/**
 * FI number calculator (docs/financial-model.md §12.15). Closed form computed in the test only: the
 * balance that funds W_t = W(1+i)^{t−1} for n years with mid-year withdrawals is
 * S = W(1+r)^{−½}(1 − q^n)/(1 − q), q = (1+i)/(1+r) (the growing-annuity present value).
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { dollars } from '../money';
import { fiNumber, type FiNumberResult } from './fiNumber';

const ctx = { currentYear: 2026, rules: RULES };

function ok(r: ReturnType<typeof fiNumber>): FiNumberResult {
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') throw new Error('not ok');
  return r.value;
}

describe('fiNumber', () => {
  const base = { annualSpending: dollars(40_000), years: 30, annualReturn: 0.05, inflation: 0.02 };

  it('finds the sustainable FI number within $1 of the growing-annuity closed form', () => {
    const v = ok(fiNumber(base, ctx));
    const r = 0.05;
    const i = 0.02;
    const n = 30;
    const q = (1 + i) / (1 + r);
    const closed = Math.round(((40_000 * (1 - q ** n)) / (1 - q) / Math.sqrt(1 + r)) * 100);
    expect(v.sustainable.search).toBe('found');
    const fi = v.sustainable.fiNumber ?? 0;
    expect(fi).toBeGreaterThanOrEqual(closed - 1);
    expect(fi).toBeLessThanOrEqual(closed + 101);
    expect(v.sustainable.plan?.longevity.lastsThroughHorizon).toBe(true);
    // At the FI number the withdrawal calculator's sustainable rate is the spending share of it.
    expect(Math.abs((v.sustainable.sustainableRateAtFiNumber ?? 0) - 4_000_000 / fi)).toBeLessThan(1e-5);
    expect(v.ruleOfThumb).toBeNull();
    expect(v.basis).toEqual({ dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' });
  });

  it('finds the rule-of-thumb number (spending ÷ rate) through the withdrawal calculator', () => {
    const v = ok(fiNumber({ ...base, withdrawalRate: 0.04 }, ctx));
    const rt = v.ruleOfThumb;
    expect(rt?.search).toBe('found');
    expect(Math.abs((rt?.fiNumber ?? 0) - dollars(1_000_000))).toBeLessThanOrEqual(100);
    expect(rt?.plan?.annualSpending).toBeGreaterThanOrEqual(dollars(40_000));
    // 4% with 5% returns and 2% inflation lasts 30 years in this model.
    expect(rt?.plan?.longevity.lastsThroughHorizon).toBe(true);
  });

  it('reports $0 when nothing needs funding and the bound when it is too small', () => {
    const zero = ok(fiNumber({ ...base, annualSpending: 0, withdrawalRate: 0.04 }, ctx));
    expect(zero.sustainable).toMatchObject({ search: 'atBound', fiNumber: 0, sustainableRateAtFiNumber: null });
    expect(zero.ruleOfThumb?.fiNumber).toBe(0);
    const small = ok(fiNumber({ ...base, withdrawalRate: 0.04, maxBalance: dollars(1_000) }, ctx));
    expect(small.sustainable).toMatchObject({ search: 'notWithinBound', fiNumber: null, plan: null });
    expect(small.ruleOfThumb).toMatchObject({ search: 'notWithinBound', fiNumber: null, plan: null });
  });

  it('rejects invalid input', () => {
    const r = fiNumber({ ...base, withdrawalRate: 0, age: 100 }, ctx);
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') return;
    expect(r.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['withdrawalRate', 'years']));
  });
});
