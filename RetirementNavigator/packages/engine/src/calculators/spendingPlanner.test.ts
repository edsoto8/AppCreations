/**
 * Spending planner (docs/financial-model.md §12.12). Closed forms computed in the test only (§5):
 * need_t = S_step(age) · (1 + glide)^(t − 1) · (1 + i)^(t − 1), plus healthcare · (1 + i)^(t − 1)
 * while retired and under 65, times (1 − survivor reduction) from the first death year.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { spendingPlanner, type SpendingPlannerResult } from './spendingPlanner';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const cents = (d: number) => Math.round(d * 100);

function ok(r: ReturnType<typeof spendingPlanner>): SpendingPlannerResult {
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') throw new Error('not ok');
  return r.value;
}

describe('spendingPlanner', () => {
  it('applies steps, the real glide and inflation each year (closed form)', () => {
    const i = 0.02;
    const g = -0.01;
    const v = ok(
      spendingPlanner(
        {
          people: [{ age: 65, planningAge: 72 }],
          startingBalance: dollars(1_000_000),
          annualReturn: 0.04,
          inflation: i,
          retirementSpending: dollars(40_000),
          steps: [{ fromAge: 68, annualSpending: dollars(30_000) }],
          realGlide: g,
        },
        ctx,
      ),
    );
    expect(v.rows).toHaveLength(8);
    v.rows.forEach((row, k) => {
      const age = 65 + k;
      const base = age >= 68 ? 30_000 : 40_000;
      expect(Math.abs(row.spendingNeed - cents(base * (1 + g) ** k * (1 + i) ** k))).toBeLessThanOrEqual(1);
      expect(Math.abs(row.spendingNeedReal - cents(base * (1 + g) ** k))).toBeLessThanOrEqual(1);
      expect(row.ages).toEqual([age]);
    });
    expect(v.longevity.lastsThroughPlanningAge).toBe(true);
    expect(v.totalSpendingNeed).toBe(v.rows.reduce((s, r) => s + r.spendingNeed, 0));
    expect(v.basis).toEqual({ dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' });
  });

  it('adds the healthcare line while under 65 and reports depletion', () => {
    const v = ok(
      spendingPlanner(
        {
          people: [{ age: 62, planningAge: 70 }],
          startingBalance: dollars(200_000),
          taxTreatment: 'taxFree',
          annualReturn: 0,
          inflation: 0,
          retirementSpending: dollars(30_000),
          healthcareBeforeMedicare: dollars(10_000),
        },
        ctx,
      ),
    );
    expect(v.rows.map((r) => r.spendingNeed)).toEqual([
      dollars(40_000),
      dollars(40_000),
      dollars(40_000),
      ...Array(6).fill(dollars(30_000)),
    ]);
    // 200k covers 3·40k + 2·30k = 180k, then 20k of the sixth year: depletion at 67.
    expect(v.longevity).toEqual({ lastsThroughPlanningAge: false, depletionYear: YEAR + 5, depletionAge: 67 });
    expect(v.rows[5]?.shortfall).toBe(dollars(10_000));
    expect(v.rows[5]?.markers).toContain('depletion');
  });

  it('reduces a couple’s spending from the first death year, with Social Security entered at claim age', () => {
    const v = ok(
      spendingPlanner(
        {
          people: [
            {
              name: 'Sam',
              age: 70,
              planningAge: 80,
              socialSecurity: { monthlyAtClaim: dollars(2_000), claimAge: { years: 70, months: 0 } },
            },
            { name: 'Alex', age: 70, planningAge: 75 },
          ],
          startingBalance: dollars(1_000_000),
          taxTreatment: 'taxable',
          annualReturn: 0,
          inflation: 0,
          retirementSpending: dollars(50_000),
          survivorSpendingReduction: 0.3,
        },
        { currentYear: YEAR, rules: fixtureRules() },
      ),
    );
    expect(v.firstDeathYear).toBe(YEAR + 6);
    expect(v.rows[5]?.spendingNeed).toBe(dollars(50_000));
    expect(v.rows[6]?.spendingNeed).toBe(dollars(35_000));
    expect(v.rows[6]?.markers).toContain('firstDeath');
    expect(v.rows[0]?.socialSecurity).toBe(dollars(24_000));
    expect(v.basis.tax).toBe('afterTaxes');
  });

  it('rejects invalid input', () => {
    const r = spendingPlanner(
      {
        people: [
          { age: 70, planningAge: 60 },
          { age: 70, planningAge: 90 },
          { age: 70, planningAge: 90 },
        ],
        startingBalance: 0,
        annualReturn: 0,
        inflation: 0,
        retirementSpending: 0,
      },
      ctx,
    );
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') return;
    expect(r.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['people']));
    const one = spendingPlanner(
      {
        people: [{ age: 70, planningAge: 60 }],
        startingBalance: 0,
        annualReturn: 0,
        inflation: 0,
        retirementSpending: 0,
      },
      ctx,
    );
    expect(one.status === 'invalid' && one.issues[0]?.path).toEqual(['people', 0, 'planningAge']);
  });
});
