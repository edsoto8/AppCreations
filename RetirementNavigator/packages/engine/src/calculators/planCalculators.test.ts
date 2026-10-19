/**
 * Retirement-plan calculators (docs/financial-model.md §12.5, §12.6, §12.13, §12.14): retirement age,
 * savings gap, Coast FIRE and Barista FIRE. Closed forms computed in the test only:
 * - zero return and inflation: savings at retirement B + C·(R − age) must cover S·(planning − R + 1);
 * - present value at retirement of S a year for N years, mid-year withdrawals:
 *   PV_R = S(1+r)^{−½}(1 − (1+r)^{−N})/(1 − (1+r)^{−1}); a contribution X a year for n years grows to
 *   X(1+r)^½((1+r)^n − 1)/r (§1.5).
 * Brute-force parity: every age the optimizer reports is re-projected directly.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { HouseholdSchema } from '../domain/household';
import { projectHousehold } from '../projection/project';
import { RetirementAgeInputSchema, retirementAge } from './retirementAge';
import { savingsGap } from './savingsGap';
import { coastFire } from './coastFire';
import { baristaFire } from './baristaFire';
import { retirementPlanHousehold } from './common';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const fixtureCtx = { currentYear: YEAR, rules: fixtureRules() };

/** PV at retirement of S a year for N years (mid-year withdrawals), and FV of X a year for n years. */
const pvAtRetirement = (s: number, r: number, n: number) =>
  (s * (1 - (1 + r) ** -n)) / (1 - 1 / (1 + r)) / Math.sqrt(1 + r);
const fvFactor = (r: number, n: number) => Math.sqrt(1 + r) * (((1 + r) ** n - 1) / r);

const zeroPlan = {
  age: 40,
  planningAge: 90,
  currentBalance: dollars(100_000),
  annualContribution: dollars(20_000),
  returnBeforeRetirement: 0,
  returnInRetirement: 0,
  inflation: 0,
  retirementSpending: dollars(50_000),
  taxTreatment: 'taxFree' as const,
};

describe('retirementAge', () => {
  it('finds the closed-form earliest age at zero return (100k + 20k·(R − 40) ≥ 50k·(91 − R) ⇒ R = 75)', () => {
    const r = retirementAge({ ...zeroPlan, fromAge: 50, toAge: 80 }, ctx);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    let closed = 50;
    while (100_000 + 20_000 * (closed - 40) < 50_000 * (91 - closed)) closed++;
    expect(r.value.earliestAge).toBe(closed);
    expect(r.value.shown.retirementAge).toBe(closed);
    expect(r.value.shown.outcome.success).toBe(true);
    expect(r.value.evaluated).toHaveLength(31);
  });

  it('agrees with a brute-force projection of every age', () => {
    const input = {
      ...zeroPlan,
      returnBeforeRetirement: 0.06,
      returnInRetirement: 0.04,
      inflation: 0.025,
      taxTreatment: 'taxDeferred' as const,
      fromAge: 55,
      toAge: 70,
    };
    const r = retirementAge(input, ctx);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const plan = RetirementAgeInputSchema.parse(input);
    for (const e of r.value.evaluated) {
      const h = HouseholdSchema.parse(retirementPlanHousehold({ ...plan, retirementAge: e.age }, YEAR));
      const p = projectHousehold(h, ctx);
      expect(p.status === 'ok' && p.value.summary.deterministicSuccess).toBe(e.success);
      expect(p.status === 'ok' && p.value.summary.endingBalanceReal).toBe(e.endingBalanceReal);
    }
    expect(r.value.earliestAge).toBe(r.value.evaluated.find((e) => e.success)?.age ?? null);
    expect(r.value.basis.tax).toBe('beforeTaxes');
  });

  it('reports no age when none succeeds, and passes the optimizer’s range check through', () => {
    const none = retirementAge({ ...zeroPlan, retirementSpending: dollars(500_000), fromAge: 50, toAge: 60 }, ctx);
    expect(none.status === 'ok' && [none.value.earliestAge, none.value.shown.retirementAge]).toEqual([null, 60]);
    const early = retirementAge({ ...zeroPlan, fromAge: 30, toAge: 60 }, ctx);
    expect(early.status === 'invalid' && early.issues[0]?.path).toEqual(['range', 'fromAge']);
    const bad = retirementAge({ ...zeroPlan, fromAge: 30, toAge: 95 }, ctx);
    expect(bad.status === 'invalid' && bad.issues[0]?.path).toEqual(['toAge']);
    const past = retirementAge({ ...zeroPlan, fromAge: 30, toAge: 40 }, ctx);
    expect(past.status === 'invalid' && past.issues[0]?.path).toEqual(['toAge']);
    const household = retirementAge(
      { ...zeroPlan, age: 100, planningAge: 110, fromAge: 100, toAge: 105 },
      {
        currentYear: 1950,
        rules: RULES,
      },
    );
    expect(household.status === 'invalid' && household.issues[0]?.path[0]).toBe('household');
  });
});

describe('savingsGap', () => {
  const plan = {
    ...zeroPlan,
    currentBalance: 0,
    annualContribution: 0,
    retirementAge: 65,
    retirementSpending: dollars(40_000),
  };

  it('matches the zero-return closed form: 40k × 26 years over 25 working years', () => {
    const r = savingsGap(plan, ctx);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const closed = dollars((40_000 * 26) / 25);
    expect(r.value.search).toBe('found');
    expect(r.value.extraAnnualContribution! - closed).toBeGreaterThanOrEqual(0);
    expect(r.value.extraAnnualContribution! - closed).toBeLessThanOrEqual(100);
    expect(r.value.totalAnnualContribution).toBe(r.value.extraAnnualContribution);
    expect(r.value.current.success).toBe(false);
    expect(r.value.withExtra.success).toBe(true);
    expect(r.value.basis.dollars).toBe('todaysDollars');
  });

  it('matches the annuity closed form with a return', () => {
    const r = 0.05;
    const result = savingsGap(
      { ...plan, currentBalance: dollars(50_000), returnBeforeRetirement: r, returnInRetirement: r },
      ctx,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const need = pvAtRetirement(40_000, r, 26) - 50_000 * (1 + r) ** 25;
    const closed = Math.round((need / fvFactor(r, 25)) * 100);
    const found = result.value.extraAnnualContribution ?? 0;
    expect(found).toBeGreaterThanOrEqual(closed - 1);
    expect(found).toBeLessThanOrEqual(closed + 101);
  });

  it('reports an already-met plan and an unreachable one', () => {
    const met = savingsGap({ ...plan, currentBalance: dollars(2_000_000) }, ctx);
    expect(met.status === 'ok' && [met.value.search, met.value.extraAnnualContribution]).toEqual(['atBound', 0]);
    const unreachable = savingsGap({ ...plan, maxExtraContribution: dollars(1_000) }, fixtureCtx);
    expect(unreachable.status === 'ok' && unreachable.value.search).toBe('notWithinBound');
    expect(unreachable.status === 'ok' && unreachable.value.totalAnnualContribution).toBeNull();
    // The synthetic plan has no pay; its infeasible-plan warning (fixture taxes) is dropped.
    expect(unreachable.status === 'ok' && unreachable.warnings.some((w) => w.code === 'savingsPlanInfeasible')).toBe(
      false,
    );
  });

  it('rejects a plan with no working years or bad ages', () => {
    const r = savingsGap({ ...plan, retirementAge: 40 }, ctx);
    expect(r.status === 'invalid' && r.issues[0]?.path).toEqual(['retirementAge']);
    const ages = savingsGap({ ...plan, retirementAge: 95, age: 96 }, ctx);
    expect(ages.status === 'invalid' && ages.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['retirementAge', 'planningAge']),
    );
  });
});

describe('coastFire', () => {
  const r = 0.05;
  const plan = {
    ...zeroPlan,
    retirementAge: 50,
    planningAge: 59,
    currentBalance: dollars(300_000),
    returnBeforeRetirement: r,
    returnInRetirement: r,
    retirementSpending: dollars(50_000),
  };

  it('matches the closed-form coast number: PV at retirement discounted to today', () => {
    const result = coastFire(plan, ctx);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const closed = Math.round((pvAtRetirement(50_000, r, 10) / (1 + r) ** 10) * 100);
    const v = result.value;
    expect(v.search).toBe('found');
    expect(v.coastNumber!).toBeGreaterThanOrEqual(closed - 1);
    expect(v.coastNumber!).toBeLessThanOrEqual(closed + 101);
    expect(v.coasts).toBe(dollars(300_000) >= v.coastNumber!);
    expect(v.gap).toBe(Math.max(0, v.coastNumber! - dollars(300_000)));
    expect(v.withContributions.endingBalanceReal).toBeGreaterThan(v.coasting.endingBalanceReal);
  });

  it('needs a smaller coast number when Social Security (entered at the claiming age) covers part of spending', () => {
    const withSs = coastFire(
      {
        ...plan,
        planningAge: 75,
        socialSecurity: { monthlyAtClaim: dollars(2_000), claimAge: { years: 62, months: 0 } },
      },
      ctx,
    );
    const without = coastFire({ ...plan, planningAge: 75 }, ctx);
    if (withSs.status !== 'ok' || without.status !== 'ok') throw new Error('not ok');
    expect(withSs.value.coastNumber!).toBeLessThan(without.value.coastNumber!);
  });

  it('coasts at $0 with nothing to fund, and reports an unreachable bound', () => {
    const zero = coastFire({ ...plan, retirementSpending: 0 }, ctx);
    expect(zero.status === 'ok' && [zero.value.search, zero.value.coastNumber, zero.value.coasts]).toEqual([
      'atBound',
      0,
      true,
    ]);
    const capped = coastFire({ ...plan, maxBalance: dollars(1_000) }, ctx);
    expect(capped.status === 'ok' && [capped.value.coastNumber, capped.value.gap]).toEqual([null, null]);
    const bad = coastFire({ ...plan, retirementAge: 70 }, ctx);
    expect(bad.status === 'invalid' && bad.issues[0]?.path).toEqual(['retirementAge']);
  });
});

describe('baristaFire', () => {
  const plan = {
    ...zeroPlan,
    retirementAge: 40,
    planningAge: 69,
    currentBalance: dollars(800_000),
    annualContribution: 0,
    retirementSpending: dollars(40_000),
    partTime: { startAge: 40, endAge: 50, annualIncome: dollars(50_000) },
  };

  it('finds the closed-form minimum part-time income at zero return: (30·40k − 800k)/10', () => {
    const result = baristaFire(plan, ctx);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const v = result.value;
    const closed = dollars((30 * 40_000 - 800_000) / 10);
    expect(v.success).toBe(true);
    expect(v.totalPartTimeIncome).toBe(dollars(500_000));
    expect(v.search).toBe('found');
    expect(v.minimumPartTimeIncome! - closed).toBeGreaterThanOrEqual(0);
    expect(v.minimumPartTimeIncome! - closed).toBeLessThanOrEqual(100);
    expect(v.atMinimum.success).toBe(true);
    expect(v.basis.tax).toBe('beforeTaxes');
  });

  it('needs more part-time pay once payroll and income taxes apply (fixture rules)', () => {
    const before = baristaFire(plan, ctx);
    const after = baristaFire(plan, fixtureCtx);
    if (before.status !== 'ok' || after.status !== 'ok') throw new Error('not ok');
    expect(after.value.basis.tax).toBe('afterTaxes');
    expect(after.value.minimumPartTimeIncome!).toBeGreaterThan(before.value.minimumPartTimeIncome!);
  });

  it('reports when no part-time pay is needed, when the bound is too low, and invalid phases', () => {
    const rich = baristaFire({ ...plan, currentBalance: dollars(5_000_000) }, ctx);
    expect(rich.status === 'ok' && [rich.value.search, rich.value.minimumPartTimeIncome]).toEqual(['atBound', 0]);
    const low = baristaFire(
      { ...plan, maxPartTimeIncome: dollars(1_000), partTime: { ...plan.partTime, annualIncome: 0 } },
      ctx,
    );
    expect(low.status === 'ok' && [low.value.search, low.value.minimumPartTimeIncome, low.value.success]).toEqual([
      'notWithinBound',
      null,
      false,
    ]);
    const bad = baristaFire({ ...plan, partTime: { startAge: 50, endAge: 45, annualIncome: 1 } }, ctx);
    expect(bad.status === 'invalid' && bad.issues[0]?.path).toEqual(['partTime', 'endAge']);
  });
});
