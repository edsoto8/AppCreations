/** Calculator registry: every `CalculatorId` is wired, and untyped input never throws (docs/financial-model.md §12). */
import { describe, expect, it } from 'vitest';
import type { CalculatorId } from '../api';
import { RULES } from '../rules/index';
import { dollars } from '../money';
import { CALCULATORS, runCalculator } from './index';

const ctx = { currentYear: 2026, rules: RULES };
const IDS: CalculatorId[] = [
  'compoundInterest',
  'contribution401k',
  'matchOptimizer',
  'rothVsTraditional',
  'retirementAge',
  'savingsGap',
  'inflationPurchasingPower',
  'withdrawal',
  'ssClaimingComparison',
  'feeImpact',
  'lumpSumVsRecurring',
  'spendingPlanner',
  'coastFire',
  'baristaFire',
  'fiNumber',
];

describe('calculator registry', () => {
  it('has exactly the 15 calculator ids', () => {
    expect(Object.keys(CALCULATORS).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)('%s returns invalid (never throws) for malformed input', (id) => {
    for (const input of [undefined, null, {}, 'text', { age: -1 }]) {
      const r = runCalculator(id, input, ctx);
      expect(r.status).toBe('invalid');
      if (r.status === 'invalid') expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it('dispatches to the calculator', () => {
    const r = runCalculator('compoundInterest', { principal: dollars(100), annualReturn: 0, years: 1 }, ctx);
    expect(r.status).toBe('ok');
  });

  // A valid input for each calculator (amounts in cents, rates as decimals).
  const plan = {
    age: 40,
    retirementAge: 60,
    planningAge: 90,
    currentBalance: dollars(100_000),
    returnBeforeRetirement: 0.05,
    returnInRetirement: 0.04,
    inflation: 0.02,
    retirementSpending: dollars(40_000),
  };
  const VALID: Record<CalculatorId, unknown> = {
    compoundInterest: { principal: dollars(1_000), annualReturn: 0.05, years: 10 },
    contribution401k: {
      age: 40,
      retirementAge: 60,
      salary: dollars(80_000),
      traditionalPctOfSalary: 0.1,
      annualReturn: 0.05,
    },
    matchOptimizer: { eligiblePay: dollars(80_000), match: { tiers: [] }, currentDeferralRate: 0.05 },
    rothVsTraditional: { ...plan, salary: dollars(80_000), deferralPct: 0.1, currentSpending: dollars(40_000) },
    retirementAge: { ...plan, fromAge: 55, toAge: 65 },
    savingsGap: plan,
    inflationPurchasingPower: { amount: dollars(1_000), years: 10, inflation: 0.02 },
    withdrawal: {
      mode: 'fixedPercentage',
      startingBalance: dollars(100_000),
      withdrawalRate: 0.04,
      years: 30,
      annualReturn: 0.05,
      inflation: 0.02,
    },
    ssClaimingComparison: {
      mode: 'amountsAtClaimAge',
      birthYear: 1964,
      throughAge: 90,
      options: [{ claimAge: { years: 67, months: 0 }, monthlyAtClaim: dollars(2_000) }],
    },
    feeImpact: { principal: dollars(1_000), annualReturn: 0.05, expenseRatio: 0.01, years: 10 },
    lumpSumVsRecurring: { total: dollars(1_000), spreadYears: 2, horizonYears: 10, annualReturn: 0.05 },
    spendingPlanner: {
      people: [{ age: 65, planningAge: 90 }],
      startingBalance: dollars(500_000),
      annualReturn: 0.04,
      inflation: 0.02,
      retirementSpending: dollars(30_000),
    },
    coastFire: plan,
    baristaFire: { ...plan, partTime: { startAge: 60, endAge: 65, annualIncome: dollars(20_000) } },
    fiNumber: { annualSpending: dollars(40_000), years: 30, annualReturn: 0.05, inflation: 0.02, withdrawalRate: 0.04 },
  };

  it.each(IDS)('%s runs on a valid input with the bundled rules', (id) => {
    expect(runCalculator(id, VALID[id], ctx).status).toBe('ok');
  });

  it.each(IDS.filter((id) => id !== 'matchOptimizer' && id !== 'ssClaimingComparison'))(
    '%s reports an engine-invalid synthetic household as invalid, not a throw',
    (id) => {
      // In 1905 a 40-year-old (or the synthetic person) would be born before 1900, outside the schema.
      const r = runCalculator(id, VALID[id], { currentYear: 1905, rules: RULES });
      expect(r.status).toBe('invalid');
    },
  );
});
