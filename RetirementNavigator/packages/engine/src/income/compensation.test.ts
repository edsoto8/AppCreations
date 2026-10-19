import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type Household } from '../domain/household';
import { minimalHouseholdInput } from '../samples/minimal';
import { dollars } from '../money';
import { computeCompensationPath } from './compensation';
import { RULES } from '../rules/index';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };

function household(employment: Record<string, unknown>, person: Record<string, unknown> = {}): Household {
  const base = minimalHouseholdInput(YEAR);
  return HouseholdSchema.parse({
    ...base,
    people: [
      {
        ...base.people[0]!,
        ...person,
        employment: { baseSalary: dollars(100_000), raise: { mode: 'nominal', rate: 0.03 }, ...employment },
      },
    ],
  });
}

const path = (h: Household, years = 5) => {
  const r = computeCompensationPath(h, 'person-1', ctx, years);
  if (r.status !== 'ok') throw new Error('expected ok');
  return r.value;
};

describe('computeCompensationPath', () => {
  it('applies no raise in year 1 and compounds the raise afterwards', () => {
    const rows = path(household({}));
    expect(rows.map((r) => r.baseSalary)).toEqual([
      dollars(100_000),
      dollars(103_000),
      dollars(106_090),
      dollars(109_272.7),
      dollars(112_550.88),
    ]);
    expect(rows[0]!.nominalRaise).toBe(0);
    expect(rows[1]!.nominalRaise).toBe(0.03);
    // Inflation 2.5%: real raise = 1.03 / 1.025 − 1.
    expect(rows[1]!.realRaise).toBeCloseTo(1.03 / 1.025 - 1, 12);
  });

  it('supports inflation-plus-real raises and year-specific overrides (promotion, zero, negative)', () => {
    const rows = path(
      household({
        raise: { mode: 'inflationPlus', realRate: 0.01 },
        raiseOverrides: [
          { year: YEAR + 1, rate: 0.1 },
          { year: YEAR + 2, rate: 0 },
          { year: YEAR + 3, rate: -0.05 },
        ],
      }),
    );
    expect(rows[1]!.baseSalary).toBe(dollars(110_000));
    expect(rows[2]!.baseSalary).toBe(dollars(110_000));
    expect(rows[3]!.baseSalary).toBe(dollars(104_500));
    // Default raise = (1.025)(1.01) − 1 in year 5.
    expect(rows[4]!.nominalRaise).toBeCloseTo(1.025 * 1.01 - 1, 12);
    expect(rows[4]!.realRaise).toBeCloseTo(0.01, 12);
    // A raise below inflation shows a negative real raise.
    expect(rows[2]!.realRaise).toBeLessThan(0);
  });

  it('computes percent-of-salary and fixed bonuses with each growth mode', () => {
    const pct = path(household({ bonus: { kind: 'percentOfSalary', pct: 0.1 } }), 2);
    expect(pct.map((r) => r.bonus)).toEqual([dollars(10_000), dollars(10_300)]);
    const big = path(household({ bonus: { kind: 'percentOfSalary', pct: 1.5 } }), 1);
    expect(big[0]!.bonus).toBe(dollars(150_000)); // bonus larger than salary
    const withSalary = path(household({ bonus: { kind: 'fixed', amount: dollars(5_000) } }), 2);
    expect(withSalary[1]!.bonus).toBe(dollars(5_150));
    const own = path(
      household({ bonus: { kind: 'fixed', amount: dollars(5_000) }, bonusGrowth: { mode: 'ownRate', rate: 0.1 } }),
      2,
    );
    expect(own[1]!.bonus).toBe(dollars(5_500));
    const flat = path(
      household({ bonus: { kind: 'fixed', amount: dollars(5_000) }, bonusGrowth: { mode: 'flat' } }),
      2,
    );
    expect(flat[1]!.bonus).toBe(dollars(5_000));
    expect(path(household({}), 1)[0]!.bonus).toBe(0); // zero bonus
  });

  it('applies the bonus eligibility toggles to eligible compensation', () => {
    const rows = path(
      household({
        bonus: { kind: 'fixed', amount: dollars(20_000) },
        bonusCountsForDeferrals: false,
        bonusCountsForMatch: true,
      }),
      1,
    );
    expect(rows[0]!.eligibleCompForDeferrals).toBe(dollars(100_000));
    expect(rows[0]!.eligibleCompForMatch).toBe(dollars(120_000));
    expect(rows[0]!.totalCompensation).toBe(dollars(120_000));
  });

  it('stops salary at the retirement (or stop) age and adds a part-time phase in today’s dollars', () => {
    // Born 1991, retirement age 37 → retires January 1, 2028 (no salary that year).
    const h = household(
      { partTime: { startAge: 37, endAge: 39, annualIncome: dollars(20_000) } },
      { birthYear: YEAR - 35, retirementAge: 37 },
    );
    const rows = path(h, 5);
    expect(rows.map((r) => r.working)).toEqual([true, true, false, false, false]);
    expect(rows[2]!.baseSalary).toBe(0);
    expect(rows[2]!.partTimeIncome).toBe(dollars(20_000 * 1.025 ** 2));
    expect(rows[4]!.partTimeIncome).toBe(0);
    const stopped = path(household({ stopAge: 36 }, { birthYear: YEAR - 35 }), 2);
    expect(stopped.map((r) => r.working)).toEqual([true, false]);
  });

  it('returns zeros for a person without employment', () => {
    const base = minimalHouseholdInput(YEAR);
    const rows = path(HouseholdSchema.parse(base), 2);
    expect(rows.every((r) => r.totalCompensation === 0 && !r.working)).toBe(true);
  });

  it('rejects unknown people and bad year counts', () => {
    const h = household({});
    expect(computeCompensationPath(h, 'nobody', ctx, 1).status).toBe('invalid');
    expect(computeCompensationPath(h, 'person-1', ctx, 0).status).toBe('invalid');
  });
});
