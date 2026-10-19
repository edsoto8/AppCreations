/**
 * Income & Savings preview against the PINNED SYNTHETIC FIXTURE (src/testing/fixtureRules.ts).
 */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type Household } from '../domain/household';
import { minimalHouseholdInput } from '../samples/minimal';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import { previewAccumulation } from './preview';

const YEAR = FIXTURE_YEAR;
const fixtureCtx = { currentYear: YEAR, rules: fixtureRules() };
const realCtx = { currentYear: YEAR, rules: RULES };

const MATCH = {
  tiers: [
    { matchRate: 1, bandPctOfPay: 0.03 },
    { matchRate: 0.5, bandPctOfPay: 0.02 },
  ],
};

function build(over: {
  plans?: Record<string, unknown>[];
  accounts?: Record<string, unknown>[];
  employment?: Record<string, unknown>;
  person?: Record<string, unknown>;
  spending?: number;
}): Household {
  const base = minimalHouseholdInput(YEAR);
  return HouseholdSchema.parse({
    ...base,
    people: [
      {
        ...base.people[0]!,
        ...over.person,
        employment: { baseSalary: dollars(100_000), raise: { mode: 'nominal', rate: 0.03 }, ...over.employment },
        workplacePlans: over.plans ?? [
          { id: 'plan-1', planType: '401k', traditionalAccountId: 'k', traditionalPctOfSalary: 0.06, match: MATCH },
        ],
      },
    ],
    accounts: [
      ...(base.accounts ?? []),
      { type: 'workplaceTraditional', planType: '401k', id: 'k', name: '401(k)', ownerId: 'person-1', balance: 0 },
      ...(over.accounts ?? []),
    ],
    spending: { currentAnnualSpending: dollars(over.spending ?? 50_000), retirementAnnualSpending: dollars(40_000) },
  });
}

const preview = (h: Household, years = 1, ctx = fixtureCtx) => {
  const r = previewAccumulation(h, ctx, years);
  if (r.status !== 'ok') throw new Error('expected ok');
  return r.value;
};

const ROTH_IRA = {
  type: 'rothIra',
  id: 'roth',
  name: 'Roth IRA',
  ownerId: 'person-1',
  balance: 0,
  contributionBasis: 0,
  contribution: { amount: { kind: 'maxAllowed' } },
};
const HSA = {
  type: 'hsa',
  id: 'hsa',
  name: 'HSA',
  ownerId: 'person-1',
  balance: 0,
  coverage: 'selfOnly',
  hdhpAttested: true,
  contribution: { amount: { kind: 'dollars', amount: dollars(5_000), frequency: 'annual' } },
};

describe('previewAccumulation', () => {
  it('reproduces a hand-computed year (contributions, match, limits, taxes, surplus)', () => {
    const p = preview(build({ accounts: [ROTH_IRA, HSA] }));
    const row = p.people[0]!.rows[0]!;
    expect(row.requestedTraditional).toBe(dollars(6_000));
    expect(row.contributions).toMatchObject({ traditional: dollars(6_000), employerMatch: dollars(4_000) });
    expect(row.totalSaved).toBe(dollars(10_000));
    expect(row.savingsRate).toBeCloseTo(0.1, 12);
    expect(row.matchBeforeLimits.unclaimed).toBe(0);

    const cf = p.cashFlow[0]!;
    // Pre-tax: 6,000 + HSA capped at 4,000 → taxable 100,000 − 10,000 − 15,000 = 75,000 → 16,500 tax.
    expect(cf.taxes).toMatchObject({
      federalOrdinaryTax: dollars(16_500),
      ficaSocialSecurity: dollars(6_200),
      ficaMedicare: dollars(1_450),
    });
    expect(cf.netPay).toBe(dollars(75_850));
    // Contributions: 401(k) 6,000 + Roth IRA max 7,000 (MAGI 94,000 < 100,000) + HSA 4,000.
    expect(cf.employeeContributions).toBe(dollars(17_000));
    expect(cf.spending).toBe(dollars(50_000));
    expect(cf.surplus).toBe(dollars(8_850));
    expect(cf.infeasible).toBe(false);
    expect(p.unverified).toEqual([]);
    expect(cf.warnings.map((w) => w.code)).toContain('hsaCapped');
  });

  it('flags an infeasible savings plan without hiding it', () => {
    const p = preview(build({ accounts: [ROTH_IRA, HSA], spending: 80_000 }));
    expect(p.cashFlow[0]).toMatchObject({ infeasible: true, surplus: dollars(-21_150) });
    expect(p.cashFlow[0]!.warnings.map((w) => w.code)).toContain('savingsPlanInfeasible');
  });

  it('shows salaries and pre-limit match but no limited figures when rules are unverified', () => {
    const p = preview(build({ accounts: [HSA] }), 3, realCtx);
    const row = p.people[0]!.rows[0]!;
    expect(row.compensation.baseSalary).toBe(dollars(100_000));
    expect(row.matchBeforeLimits.match).toBe(dollars(4_000));
    expect(row.contributions).toBeNull();
    expect(row.totalSaved).toBeNull();
    expect(row.savingsRate).toBeNull();
    expect(p.cashFlow[0]).toMatchObject({ taxes: null, netPay: null, surplus: null, infeasible: null });
    const keys = p.unverified.map((u) => u.key);
    expect(keys).toEqual(expect.arrayContaining(['2026:workplace.electiveDeferral']));
  });

  it('applies auto-escalation up to its cap', () => {
    const p = preview(
      build({
        plans: [
          {
            id: 'plan-1',
            planType: '401k',
            traditionalAccountId: 'k',
            traditionalPctOfSalary: 0.03,
            autoEscalation: { stepPct: 0.01, capPct: 0.05, appliesTo: 'traditional' },
            match: MATCH,
          },
        ],
        employment: { raise: { mode: 'nominal', rate: 0 } },
      }),
      4,
    );
    expect(p.people[0]!.rows.map((r) => r.requestedTraditional)).toEqual([
      dollars(3_000),
      dollars(4_000),
      dollars(5_000),
      dollars(5_000),
    ]);
  });

  it('aggregates 401(k) and 403(b) deferrals but keeps the 457(b) limit separate', () => {
    const plans = (second: '403b' | '457b') => [
      { id: 'plan-1', planType: '401k', traditionalAccountId: 'k', traditionalPctOfSalary: 0.1, match: { tiers: [] } },
      {
        id: 'plan-2',
        planType: second,
        traditionalAccountId: 'k2',
        traditionalPctOfSalary: 0.05,
        match: { tiers: [] },
      },
    ];
    const account2 = (planType: string) => ({
      type: 'workplaceTraditional',
      planType,
      id: 'k2',
      name: 'Second plan',
      ownerId: 'person-1',
      balance: 0,
    });
    const agg = preview(
      build({ plans: plans('403b'), accounts: [account2('403b')], employment: { baseSalary: dollars(200_000) } }),
    );
    expect(agg.people[0]!.rows[0]!.contributions?.traditional).toBe(dollars(20_000));
    const sep = preview(
      build({ plans: plans('457b'), accounts: [account2('457b')], employment: { baseSalary: dollars(200_000) } }),
    );
    expect(sep.people[0]!.rows[0]!.contributions?.traditional).toBe(dollars(30_000));
  });

  it('stops contributions after retirement and uses retirement spending once everyone is retired', () => {
    // Born 1991, retirement age 36 → retired from 2027.
    const p = preview(build({ person: { birthYear: YEAR - 35, retirementAge: 36 } }), 2);
    const rows = p.people[0]!.rows;
    expect(rows[1]!.compensation.working).toBe(false);
    expect(rows[1]!.contributions).toMatchObject({ traditional: 0, employerMatch: 0 });
    expect(p.cashFlow[1]!.spending).toBe(dollars(40_000 * 1.025));
    expect(p.cashFlow[1]!.infeasible).toBeNull();
  });

  it('shares the IRA limit across traditional and Roth IRAs and reduces Roth in the phase-out', () => {
    const trad = {
      type: 'traditionalIra',
      id: 'ira',
      name: 'IRA',
      ownerId: 'person-1',
      balance: 0,
      contribution: { amount: { kind: 'dollars', amount: dollars(3_000), frequency: 'annual' } },
    };
    const p = preview(build({ accounts: [trad, ROTH_IRA] }));
    // 3,000 traditional + Roth max of the remaining 4,000; 401(k) 6,000 → total 13,000.
    expect(p.cashFlow[0]!.employeeContributions).toBe(dollars(13_000));
    const high = preview(build({ accounts: [ROTH_IRA], employment: { baseSalary: dollars(113_500) } }));
    // MAGI = 113,500 − 6,810 = 106,690 → 7,000 × 8,310 / 15,000 = 3,878 → 3,880.
    expect(high.cashFlow[0]!.employeeContributions).toBe(dollars(6_810 + 3_880));
  });

  it('caps over-limit IRA and HSA dollar contributions with warnings', () => {
    const bigIra = {
      ...ROTH_IRA,
      contribution: { amount: { kind: 'dollars', amount: dollars(10_000), frequency: 'annual' } },
    };
    const p = preview(build({ accounts: [bigIra, HSA] }));
    expect(p.cashFlow[0]!.employeeContributions).toBe(dollars(6_000 + 7_000 + 4_000));
    expect(p.cashFlow[0]!.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['iraCapped', 'hsaCapped']));
  });

  it('converts monthly schedules and grows them', () => {
    const cash = {
      type: 'cash',
      id: 'cash',
      name: 'Savings',
      ownerId: 'person-1',
      balance: 0,
      contribution: {
        amount: { kind: 'dollars', amount: dollars(100), frequency: 'monthly' },
        growth: { mode: 'rate', rate: 0.1 },
      },
    };
    const p = preview(build({ accounts: [cash] }), 2);
    expect(p.cashFlow[0]!.employeeContributions).toBe(dollars(6_000 + 1_200));
    expect(p.cashFlow[1]!.employeeContributions).toBe(dollars(6_180 + 1_320));
  });

  it('rejects bad year counts', () => {
    expect(previewAccumulation(build({}), fixtureCtx, 0).status).toBe('invalid');
  });
});

describe('previewAccumulation (more branches)', () => {
  it('handles percent-of-salary schedules, taxable "max", other income and HDHP-less HSAs', () => {
    const base = minimalHouseholdInput(YEAR);
    const h = HouseholdSchema.parse({
      ...base,
      people: [
        { ...base.people[0]!, employment: { baseSalary: dollars(100_000), raise: { mode: 'nominal', rate: 0 } } },
      ],
      accounts: [
        {
          type: 'taxableBrokerage',
          id: 'tb',
          name: 'Brokerage',
          ownerId: 'person-1',
          balance: 0,
          costBasis: 0,
          contribution: { amount: { kind: 'percentOfSalary', pct: 0.05 } },
        },
        {
          type: 'cash',
          id: 'c',
          name: 'Cash',
          ownerId: 'person-1',
          balance: 0,
          contribution: { amount: { kind: 'maxAllowed' } },
        },
        {
          type: 'hsa',
          id: 'h',
          name: 'HSA',
          ownerId: 'person-1',
          balance: 0,
          coverage: 'family',
          hdhpAttested: false,
          contribution: { amount: { kind: 'dollars', amount: dollars(1_000), frequency: 'annual' } },
        },
        {
          type: 'traditionalIra',
          id: 'late',
          name: 'Later IRA',
          ownerId: 'person-1',
          balance: 0,
          contribution: {
            amount: { kind: 'dollars', amount: dollars(1_000), frequency: 'annual' },
            startYear: YEAR + 1,
            growth: { mode: 'inflation' },
          },
        },
      ],
      otherIncome: [
        {
          id: 'rent',
          name: 'Rent',
          startYear: YEAR,
          annualAmount: dollars(10_000),
          growth: { mode: 'flat' },
          taxableFraction: 0.5,
        },
        {
          id: 'gig',
          name: 'Gig',
          startYear: YEAR,
          endYear: YEAR,
          annualAmount: dollars(1_000),
          growth: { mode: 'rate', rate: 0.1 },
        },
        { id: 'later', name: 'Later', startYear: YEAR + 5, annualAmount: dollars(1_000) },
      ],
      spending: { currentAnnualSpending: dollars(40_000), retirementAnnualSpending: dollars(40_000) },
    });
    const p = previewAccumulation(h, fixtureCtx, 2);
    if (p.status !== 'ok') throw new Error('expected ok');
    const [y1, y2] = p.value.cashFlow;
    // 5% of salary to brokerage; cash "max" contributes nothing; HSA blocked without HDHP.
    expect(y1!.employeeContributions).toBe(dollars(5_000));
    expect(y1!.warnings.map((w) => w.code)).toContain('hsaNoHdhp');
    expect(y1!.grossPay).toBe(dollars(111_000));
    // Year 2: the IRA starts (1,000 × 1.025 inflation growth); the gig income ended.
    expect(y2!.employeeContributions).toBe(dollars(5_000 + 1_025));
    expect(y2!.grossPay).toBe(dollars(110_000));
  });

  it('uses a MAGI override for Roth IRA eligibility', () => {
    const roth = { ...ROTH_IRA, magiOverride: dollars(150_000) };
    const p = preview(build({ accounts: [roth] }));
    expect(p.cashFlow[0]!.employeeContributions).toBe(dollars(6_000));
    expect(p.cashFlow[0]!.warnings.map((w) => w.code)).toContain('rothIraIneligible');
  });

  it('ignores bonus deferral percentages when the bonus is not eligible, with a warning', () => {
    const p = preview(
      build({
        employment: { bonus: { kind: 'fixed', amount: dollars(10_000) }, bonusCountsForDeferrals: false },
        plans: [
          {
            id: 'plan-1',
            planType: '401k',
            traditionalAccountId: 'k',
            traditionalPctOfSalary: 0.05,
            traditionalPctOfBonus: 0.5,
            match: MATCH,
          },
        ],
      }),
    );
    expect(p.people[0]!.rows[0]!.requestedTraditional).toBe(dollars(5_000));
    expect(p.people[0]!.rows[0]!.warnings.some((w) => /bonus is not eligible/.test(w.message))).toBe(true);
  });

  it('applies deferral percentages only to pay up to the compensation limit', () => {
    const p = preview(
      build({
        employment: { baseSalary: dollars(400_000) },
        plans: [
          { id: 'plan-1', planType: '401k', traditionalAccountId: 'k', traditionalPctOfSalary: 0.05, match: MATCH },
        ],
      }),
    );
    // 5% × 300,000 = 15,000 (not 20,000).
    expect(p.people[0]!.rows[0]!.requestedTraditional).toBe(dollars(15_000));
  });

  it('reports a person without a workplace plan as fully vested with zero contributions', () => {
    const p = preview(build({ plans: [] }));
    expect(p.people[0]!.rows[0]).toMatchObject({ vestedFractionEndOfYear: 1, requestedTraditional: 0, totalSaved: 0 });
  });

  it('marks IRA and HSA schedules unverified when their limits are null', () => {
    const p = preview(build({ plans: [], accounts: [ROTH_IRA, HSA] }), 1, realCtx);
    expect(p.cashFlow[0]!.employeeContributions).toBeNull();
    expect(p.unverified.map((u) => u.key)).toEqual(expect.arrayContaining(['2026:ira.limit', '2026:hsa.selfOnly']));
  });
});
