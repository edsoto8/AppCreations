/**
 * Compound interest calculator (docs/financial-model.md §12.1). Closed forms are computed in the test
 * only: FV = PV(1+r)^n + PMT·(1+r)^½·((1+r)^n − 1)/r (contributions mid-year, §1.5), and the growing
 * annuity PMT·(1+r)^½·((1+r)^n − (1+g)^n)/(r − g).
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { compoundInterest } from './compoundInterest';

const ctx = { currentYear: 2026, rules: RULES };
const fixtureCtx = { currentYear: 2026, rules: fixtureRules() };
const cents = (d: number) => Math.round(d * 100);

describe('compoundInterest', () => {
  it('matches the future-value closed form with mid-year contributions', () => {
    const r = 0.07;
    const n = 30;
    const pv = 10_000;
    const pmt = 6_000;
    const result = compoundInterest(
      { principal: dollars(pv), annualContribution: dollars(pmt), annualReturn: r, years: n },
      ctx,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const fv = pv * (1 + r) ** n + pmt * Math.sqrt(1 + r) * (((1 + r) ** n - 1) / r);
    expect(Math.abs(result.value.totals.endingBalance - cents(fv))).toBeLessThanOrEqual(1);
    expect(result.value.rows).toHaveLength(n);
    expect(result.value.totals.totalContributions).toBe(dollars(pmt * n));
    // Reconciliation: principal + contributions + growth = ending balance (cents, exact).
    expect(dollars(pv) + result.value.totals.totalContributions + result.value.totals.totalGrowth).toBe(
      result.value.totals.endingBalance,
    );
    expect(result.value.basis).toEqual({ dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' });
  });

  it('matches the growing-annuity closed form, net of the expense ratio, in today’s dollars too', () => {
    const r = 0.06;
    const f = 0.01;
    const g = 0.03;
    const i = 0.025;
    const n = 20;
    const rho = (1 + r) * (1 - f) - 1;
    const result = compoundInterest(
      {
        principal: 0,
        annualContribution: dollars(1_000),
        contributionGrowth: g,
        annualReturn: r,
        years: n,
        inflation: i,
        expenseRatio: f,
      },
      fixtureCtx,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const fv = 1_000 * Math.sqrt(1 + rho) * (((1 + rho) ** n - (1 + g) ** n) / (rho - g));
    expect(Math.abs(result.value.totals.endingBalance - cents(fv))).toBeLessThanOrEqual(1);
    expect(Math.abs(result.value.totals.endingBalanceReal - cents(fv / (1 + i) ** (n - 1)))).toBeLessThanOrEqual(1);
    expect(result.value.totals.totalFeeDrag).toBeGreaterThan(0);
    // The synthetic household has no pay: the infeasible-plan warning it raises by construction is dropped.
    expect(result.warnings.some((w) => w.code === 'savingsPlanInfeasible')).toBe(false);
  });

  it('is exact with a zero return', () => {
    const result = compoundInterest(
      { principal: dollars(500), annualContribution: dollars(100), annualReturn: 0, years: 5 },
      ctx,
    );
    expect(result.status === 'ok' && result.value.totals.endingBalance).toBe(dollars(1_000));
  });

  it('rejects invalid inputs with field messages', () => {
    const result = compoundInterest({ principal: -1, annualReturn: 2, years: 0 } as never, ctx);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    const paths = result.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['principal', 'annualReturn', 'years']));
  });
});
