/**
 * Projection mechanics (docs/financial-model.md §1.5–1.6, §4, §7 M3 subset). Closed-form cases use
 * households that need no rule values; limit and tax paths use the PINNED SYNTHETIC FIXTURE.
 */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type Household, type HouseholdInput } from '../domain/household';
import type { ProjectionResult, YearRow } from '../domain/projection';
import { minimalHouseholdInput } from '../samples/minimal';
import { SAMPLE_PROFILES } from '../samples/profiles';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import { ProjectionResultSchema } from '../domain/projection';
import { projectHousehold } from './project';
import { computeDashboard } from './dashboard';
import { growthFactors, withdrawalCap } from './accounts';

const YEAR = FIXTURE_YEAR;
const ctx = { currentYear: YEAR, rules: RULES };
const fixtureCtx = { currentYear: YEAR, rules: fixtureRules() };

type Over = {
  person?: Record<string, unknown>;
  people?: Record<string, unknown>[];
  accounts?: Record<string, unknown>[];
  spending?: { currentAnnualSpending?: number; retirementAnnualSpending?: number };
  assumptions?: Record<string, unknown>;
  filingStatus?: 'single' | 'marriedFilingJointly';
};

function household(over: Over = {}): Household {
  const base = minimalHouseholdInput(YEAR);
  const input: HouseholdInput = {
    ...base,
    filingStatus: over.filingStatus ?? base.filingStatus,
    people: over.people ?? [{ ...base.people[0]!, ...over.person }],
    accounts: over.accounts ?? base.accounts,
    spending: { ...base.spending, ...over.spending },
    assumptions: { ...base.assumptions, inflation: 0, ...over.assumptions },
  } as HouseholdInput;
  return HouseholdSchema.parse(input);
}

function project(h: Household, c = ctx, options = {}): ProjectionResult {
  const r = projectHousehold(h, c, options);
  if (r.status !== 'ok') throw new Error(JSON.stringify(r));
  return r.value;
}

const cash = (balance: number, extra: Record<string, unknown> = {}) => ({
  type: 'cash',
  id: 'cash',
  name: 'Cash',
  ownerId: 'person-1',
  balance: dollars(balance),
  ...extra,
});

/** Already retired at year 1 (age 70), planning age 95: 26 rows. */
const retiree = { birthYear: YEAR - 70, retirementAge: 65, planningAge: 95 };

function account(row: YearRow, id: string) {
  const a = row.accounts.find((x) => x.accountId === id);
  if (!a) throw new Error(id);
  return a;
}

function expectReconciled(result: ProjectionResult) {
  result.rows.forEach((row, i) => {
    for (const a of row.accounts) {
      expect(a.start + a.contributions + a.growthNet - a.withdrawals).toBe(a.end);
      expect(a.growthGross).toBe(a.growthNet + a.feeDrag);
      expect(a.end).toBeGreaterThanOrEqual(0);
      const prior = result.rows[i - 1]?.accounts.find((x) => x.accountId === a.accountId);
      if (prior) expect(a.start).toBe(prior.end);
    }
    expect(row.totals.portfolioEnd).toBe(row.accounts.reduce((s, a) => s + a.end, 0));
  });
}

describe('time axis and phases', () => {
  it('runs from the current year through the longer-lived person’s planning age', () => {
    const h = household({
      filingStatus: 'marriedFilingJointly',
      people: [
        {
          id: 'person-1',
          name: 'A',
          birthYear: YEAR - 60,
          retirementAge: 65,
          planningAge: 90,
          socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
        },
        {
          id: 'person-2',
          name: 'B',
          birthYear: YEAR - 55,
          retirementAge: 62,
          planningAge: 95,
          socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
        },
      ],
      accounts: [cash(1_000_000)],
    });
    const r = project(h);
    expect(r.summary.firstYear).toBe(YEAR);
    expect(r.summary.lastYear).toBe(YEAR - 55 + 95);
    expect(r.rows).toHaveLength(41);
    // Retirement phase once both are retired: A at 65 (YEAR+5), B at 62 (YEAR+7).
    expect(r.rows[6]!.phase).toBe('accumulation');
    expect(r.rows[7]!.phase).toBe('retirement');
    expect(r.summary.retirementYear).toBe(YEAR + 7);
    expect(r.rows[7]!.markers).toContain('retirement');
    // A lives through age 90 (YEAR+30); first death year YEAR+31.
    expect(r.summary.firstDeathYear).toBe(YEAR + 31);
    expect(r.rows[31]!.markers).toContain('firstDeath');
    expect(r.rows[31]!.people[0]!.alive).toBe(false);
    expect(r.rows[30]!.people[0]!.alive).toBe(true);
  });

  it('treats an already-retired person as retired from year 1', () => {
    const r = project(household({ person: retiree, accounts: [cash(1_000_000)] }));
    expect(r.rows[0]!.phase).toBe('retirement');
    expect(r.summary.retirementYear).toBe(YEAR);
    expect(r.rows).toHaveLength(26);
  });

  it('handles retiring at the planning age (one retirement year)', () => {
    const r = project(
      household({ person: { birthYear: YEAR - 60, retirementAge: 70, planningAge: 70 }, accounts: [cash(10_000)] }),
    );
    expect(r.rows).toHaveLength(11);
    expect(r.rows[10]!.phase).toBe('retirement');
    expect(r.rows[9]!.phase).toBe('accumulation');
  });

  it('rejects an invalid household and a household past its planning age', () => {
    const bad = projectHousehold({ ...household(), people: [] } as unknown as Household, ctx);
    expect(bad.status).toBe('invalid');
    const past = projectHousehold(
      household({ person: { birthYear: YEAR - 100, retirementAge: 65, planningAge: 95 } }),
      ctx,
    );
    expect(past.status).toBe('invalid');
  });
});

describe('closed forms (exact up to cent rounding)', () => {
  it('zero return, zero inflation: level withdrawals deplete exactly on schedule', () => {
    const r = project(
      household({
        person: retiree,
        accounts: [cash(100_000, { expectedReturn: 0 })],
        spending: { retirementAnnualSpending: dollars(10_000) },
      }),
    );
    for (let k = 0; k < 10; k++) {
      expect(account(r.rows[k]!, 'cash').end).toBe(dollars(100_000 - 10_000 * (k + 1)));
      expect(r.rows[k]!.flows.withdrawals).toBe(dollars(10_000));
      expect(r.rows[k]!.depleted).toBe(false);
    }
    expect(r.rows[10]!.depleted).toBe(true);
    expect(r.rows[10]!.flows.shortfall).toBe(dollars(10_000));
    expect(r.summary.depletionYear).toBe(YEAR + 10);
    expect(r.summary.depletionAge).toBe(80);
    expect(r.rows[10]!.markers).toContain('depletion');
    expect(r.summary.deterministicSuccess).toBe(false);
  });

  it('future value of level mid-year contributions: c·(1+r)^½·((1+r)^n − 1)/r', () => {
    const rate = 0.05;
    const c = 10_000;
    const r = project(
      household({
        person: { birthYear: YEAR - 40, retirementAge: 65 },
        accounts: [
          cash(0, {
            expectedReturn: rate,
            contribution: { amount: { kind: 'dollars', amount: dollars(c), frequency: 'annual' } },
          }),
        ],
      }),
    );
    for (const n of [1, 5, 25]) {
      const fv = (c * Math.sqrt(1 + rate) * (Math.pow(1 + rate, n) - 1)) / rate;
      expect(account(r.rows[n - 1]!, 'cash').end).toBe(dollars(fv));
    }
    // Contributions stop after the last working year (age 64).
    expect(account(r.rows[24]!, 'cash').contributions).toBe(dollars(c));
    expect(account(r.rows[25]!, 'cash').contributions).toBe(0);
  });

  it('level-payment annuity: B = W·(1+r)^½·(1 − (1+r)^−N)/r lasts exactly N years', () => {
    const rate = 0.04;
    const w = 40_000;
    const n = 20;
    const b = ((w * (1 - Math.pow(1 + rate, -n))) / rate) * Math.sqrt(1 + rate);
    const r = project(
      household({
        person: retiree,
        accounts: [cash(Math.ceil(b * 100) / 100, { expectedReturn: rate })],
        spending: { retirementAnnualSpending: dollars(w) },
      }),
    );
    expect(Math.abs(account(r.rows[n - 1]!, 'cash').end)).toBeLessThanOrEqual(2);
    expect(r.rows[n - 1]!.depleted).toBe(false);
    expect(r.rows[n]!.depleted).toBe(true);
  });

  it('growing annuity: inflation-indexed spending, B = W·(1+r)^½·(1 − ((1+i)/(1+r))^N)/(r − i)', () => {
    const rate = 0.05;
    const inflation = 0.02;
    const w = 30_000;
    const n = 25;
    const b = ((w * (1 - Math.pow((1 + inflation) / (1 + rate), n))) / (rate - inflation)) * Math.sqrt(1 + rate);
    const r = project(
      household({
        person: retiree,
        accounts: [cash(Math.ceil(b * 100) / 100, { expectedReturn: rate })],
        spending: { retirementAnnualSpending: dollars(w) },
        assumptions: { inflation },
      }),
    );
    expect(r.rows[n - 1]!.flows.spendingNeed).toBe(dollars(w * Math.pow(1 + inflation, n - 1)));
    expect(Math.abs(account(r.rows[n - 1]!, 'cash').end)).toBeLessThanOrEqual(2);
    expect(r.rows[n - 1]!.depleted).toBe(false);
    expect(r.rows[n]!.depleted).toBe(true);
    expect(r.rows[n - 1]!.deflator).toBeCloseTo(Math.pow(1 + inflation, n - 1), 12);
    expect(r.rows[1]!.real.spendingNeed).toBe(dollars(w));
  });
});

describe('timing, fees and granularity', () => {
  const base = (assumptions: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    household({
      person: retiree,
      accounts: [cash(100_000, { expectedReturn: 0.06, ...extra })],
      spending: { retirementAnnualSpending: dollars(10_000) },
      assumptions,
    });

  it('mid-year withdrawals: E = S(1+r) + (C − W)(1+r)^½', () => {
    const r = project(base());
    expect(account(r.rows[0]!, 'cash').end).toBe(dollars(100_000 * 1.06 - 10_000 * Math.sqrt(1.06)));
  });

  it('conservative (start-of-year) withdrawals: E = (S − W)(1+r) and end lower when returns ≥ 0', () => {
    const r = project(base({ withdrawalTiming: 'startOfYear' }));
    expect(account(r.rows[0]!, 'cash').end).toBe(dollars(90_000 * 1.06));
    expect(r.rows[0]!.totals.portfolioEnd).toBeLessThan(project(base()).rows[0]!.totals.portfolioEnd);
  });

  it('fees: ρ = (1+r)(1−f) − 1 and feeDrag = growthGross − growthNet', () => {
    const r = project(base({}, { expenseRatio: 0.01 }));
    const rho = 1.06 * 0.99 - 1;
    const row = account(r.rows[0]!, 'cash');
    expect(row.end).toBe(dollars(100_000 * (1 + rho) - 10_000 * Math.sqrt(1 + rho)));
    const gross = 100_000 * 0.06 - 10_000 * (Math.sqrt(1.06) - 1);
    const net = 100_000 * rho - 10_000 * (Math.sqrt(1 + rho) - 1);
    expect(row.feeDrag).toBe(dollars(gross - net));
    expect(row.growthGross - row.feeDrag).toBe(row.growthNet);
    expect(row.appliedReturn).toBe(0.06);
  });

  it('taxable tax drag reduces only taxable-account growth', () => {
    const h = household({
      person: retiree,
      accounts: [
        {
          type: 'taxableBrokerage',
          id: 't',
          name: 'T',
          ownerId: 'person-1',
          balance: dollars(100_000),
          costBasis: dollars(100_000),
          expectedReturn: 0.06,
        },
        cash(100_000, { expectedReturn: 0.06 }),
      ],
      spending: { retirementAnnualSpending: 0 },
      assumptions: { taxableAccountTaxDrag: 0.01 },
    });
    const row = project(h).rows[0]!;
    expect(account(row, 't').end).toBe(dollars(105_000));
    expect(account(row, 'cash').end).toBe(dollars(106_000));
  });

  it('monthly mode equals annual with no flows, and stays within the documented bound with flows', () => {
    const noFlows = (granularity: 'annual' | 'monthly') =>
      project(
        household({
          person: retiree,
          accounts: [cash(100_000, { expectedReturn: 0.07 })],
          spending: { retirementAnnualSpending: 0 },
          assumptions: { granularity },
        }),
      );
    const a = noFlows('annual');
    const m = noFlows('monthly');
    expect(m.granularity).toBe('monthly');
    a.rows.forEach((row, i) => {
      expect(Math.abs(row.totals.portfolioEnd - m.rows[i]!.totals.portfolioEnd)).toBeLessThanOrEqual(1 * (i + 1));
    });

    // One year with net flow W: |E_annual − E_monthly| = W·|(1+ρ)^½ − ρ/(12ρ_m)| (< 0.75% of W for |ρ| ≤ 15%).
    const withFlows = (granularity: 'annual' | 'monthly') =>
      project(base({ granularity }, { expectedReturn: 0.07 })).rows[0]!.totals.portfolioEnd;
    const rm = Math.pow(1.07, 1 / 12) - 1;
    const expected = 10_000 * Math.abs(Math.sqrt(1.07) - 0.07 / (12 * rm));
    expect(Math.abs(withFlows('annual') - withFlows('monthly')) / 100).toBeCloseTo(expected, 1);
    for (const rho of [-0.15, -0.05, 0.03, 0.07, 0.15]) {
      const rmx = Math.pow(1 + rho, 1 / 12) - 1;
      expect(Math.abs(Math.sqrt(1 + rho) - rho / (12 * rmx))).toBeLessThan(0.0075);
    }
  });

  it('monthly conservative timing withdraws at the start of each month', () => {
    const f = growthFactors(0.12, 'startOfYear', 'monthly');
    const rm = Math.pow(1.12, 1 / 12) - 1;
    expect(f.gW).toBeCloseTo((0.12 / (12 * rm)) * (1 + rm), 12);
    expect(withdrawalCap(1000, 0, f)).toBeCloseTo((1000 * 1.12) / f.gW, 9);
    expect(withdrawalCap(0, 0, f)).toBe(0);
  });

  it('applies the return offset and a market shock to every account', () => {
    const shock = household({
      person: retiree,
      accounts: [cash(100_000, { expectedReturn: 0.06 })],
      spending: { retirementAnnualSpending: 0 },
      assumptions: { marketShock: { startYear: YEAR + 1, returns: [-0.3, 0.1] } },
    });
    const r = project(shock, ctx, { returnOffset: 0.01 });
    const applied = r.rows.slice(0, 4).map((x) => account(x, 'cash').appliedReturn);
    [0.07, -0.29, 0.11, 0.07].forEach((v, i) => expect(applied[i]).toBeCloseTo(v, 12));
  });

  it('return precedence: account return, then allocation × CMA, then the phase assumption', () => {
    const h = household({
      person: { birthYear: YEAR - 64, retirementAge: 65 },
      accounts: [
        cash(1000, { id: 'a', expectedReturn: 0.01 }),
        cash(1000, { id: 'b', allocation: { stocks: 0.6, bonds: 0.4, cash: 0 } }),
        cash(1000, { id: 'c' }),
      ],
    });
    const r = project(h);
    expect(account(r.rows[0]!, 'a').appliedReturn).toBe(0.01);
    expect(account(r.rows[0]!, 'b').appliedReturn).toBeCloseTo(0.6 * 0.07 + 0.4 * 0.045, 12);
    expect(account(r.rows[0]!, 'c').appliedReturn).toBe(0.06);
    expect(account(r.rows[1]!, 'c').appliedReturn).toBe(0.05);
  });
});

describe('withdrawals (simple, before taxes)', () => {
  const accounts = [
    cash(10_000, { expectedReturn: 0 }),
    {
      type: 'taxableBrokerage',
      id: 'tax',
      name: 'T',
      ownerId: 'person-1',
      balance: dollars(20_000),
      costBasis: dollars(10_000),
      expectedReturn: 0,
    },
    {
      type: 'traditionalIra',
      id: 'ira',
      name: 'IRA',
      ownerId: 'person-1',
      balance: dollars(30_000),
      expectedReturn: 0,
    },
    {
      type: 'rothIra',
      id: 'roth',
      name: 'Roth',
      ownerId: 'person-1',
      balance: dollars(40_000),
      contributionBasis: dollars(15_000),
      expectedReturn: 0,
    },
    {
      type: 'hsa',
      id: 'hsa',
      name: 'HSA',
      ownerId: 'person-1',
      balance: dollars(5_000),
      coverage: 'selfOnly',
      hdhpAttested: false,
      expectedReturn: 0,
    },
  ];
  const first = (strategy: string, need = 25_000) =>
    project(
      household({
        person: retiree,
        accounts,
        spending: { retirementAnnualSpending: dollars(need) },
        assumptions: { withdrawalStrategy: strategy },
      }),
    );
  const w = (r: ProjectionResult, id: string) => account(r.rows[0]!, id).withdrawals / 100;

  it('taxable first: cash, then taxable (basis reduced pro rata)', () => {
    const r = first('taxableFirst');
    expect([w(r, 'cash'), w(r, 'tax'), w(r, 'ira'), w(r, 'roth'), w(r, 'hsa')]).toEqual([10_000, 15_000, 0, 0, 0]);
    // 15,000 of 20,000 withdrawn: basis 10,000 → 2,500.
    expect(account(r.rows[0]!, 'tax').basisEnd).toBe(dollars(2_500));
  });

  it('traditional first', () => {
    const r = first('traditionalFirst', 35_000);
    expect([w(r, 'ira'), w(r, 'cash'), w(r, 'tax')]).toEqual([30_000, 5_000, 0]);
  });

  it('Roth last: cash, taxable and traditional pro rata, then HSA, then Roth (basis first)', () => {
    const r = first('rothLast', 66_000);
    expect([w(r, 'cash'), w(r, 'tax'), w(r, 'ira'), w(r, 'hsa'), w(r, 'roth')]).toEqual([
      10_000, 20_000, 30_000, 5_000, 1_000,
    ]);
    expect(account(r.rows[0]!, 'roth').basisEnd).toBe(dollars(14_000));
    const partial = first('rothLast', 30_000);
    expect([w(partial, 'cash'), w(partial, 'tax'), w(partial, 'ira')]).toEqual([5_000, 10_000, 15_000]);
  });

  it('proportional draws every account pro rata by balance', () => {
    const r = first('proportional', 21_000);
    expect([w(r, 'cash'), w(r, 'tax'), w(r, 'ira'), w(r, 'roth'), w(r, 'hsa')]).toEqual([
      2_000, 4_000, 6_000, 8_000, 1_000,
    ]);
  });

  it('bracket fill falls back to taxable first with a warning (needs the M4 tax model)', () => {
    const r = first('bracketFill');
    expect([w(r, 'cash'), w(r, 'tax')]).toEqual([10_000, 15_000]);
    expect(r.warnings.map((x) => x.code)).toContain('withdrawalStrategyFallback');
  });

  it('never draws an account below zero; the shortfall is reported', () => {
    const r = first('taxableFirst', 200_000);
    expect(r.rows[0]!.flows.withdrawals).toBe(dollars(105_000));
    expect(r.rows[0]!.flows.shortfall).toBe(dollars(95_000));
    expect(r.rows[0]!.flows.spendingFunded).toBe(dollars(105_000));
    expect(r.rows[0]!.totals.portfolioEnd).toBe(0);
    expect(r.rows[1]!.flows.withdrawals).toBe(0);
    expectReconciled(r);
  });

  it('a zero-balance household depletes in its first retirement year', () => {
    const r = project(household({ person: retiree, accounts: [cash(0)] }));
    expect(r.summary.depletionYear).toBe(YEAR);
    expect(r.summary.endingBalance).toBe(0);
  });

  it('retirement income (part-time and other income) reduces withdrawals; extra income is spent', () => {
    const r = project(
      household({
        person: {
          ...retiree,
          employment: {
            baseSalary: 0,
            raise: { mode: 'nominal', rate: 0 },
            partTime: { startAge: 70, endAge: 72, annualIncome: dollars(4_000) },
          },
        },
        accounts: [cash(100_000, { expectedReturn: 0 })],
        spending: { retirementAnnualSpending: dollars(10_000) },
      }),
    );
    expect(r.rows[0]!.flows.withdrawals).toBe(dollars(6_000));
    expect(r.rows[0]!.grossIncome).toBe(dollars(10_000));
    expect(r.rows[2]!.flows.withdrawals).toBe(dollars(10_000));
    expect(r.rows[0]!.netIncome).toBeNull();
    expect(r.rows[0]!.tax).toBeNull();
  });

  it('retirement-phase contributions come only from income left after spending', () => {
    const r = project(
      household({
        person: {
          ...retiree,
          employment: {
            baseSalary: 0,
            raise: { mode: 'nominal', rate: 0 },
            partTime: { startAge: 70, endAge: 80, annualIncome: dollars(12_000) },
          },
        },
        accounts: [
          cash(100_000, { expectedReturn: 0 }),
          {
            type: 'taxableBrokerage',
            id: 't',
            name: 'T',
            ownerId: 'person-1',
            balance: 0,
            costBasis: 0,
            expectedReturn: 0,
            contribution: {
              amount: { kind: 'dollars', amount: dollars(5_000), frequency: 'annual' },
              stopYear: YEAR + 5,
            },
          },
        ],
        spending: { retirementAnnualSpending: dollars(10_000) },
      }),
    );
    expect(account(r.rows[0]!, 't').contributions).toBe(dollars(2_000));
    expect(r.rows[0]!.flows.withdrawals).toBe(0);
    expect(r.warnings.map((x) => x.code)).toContain('retirementContributionsReduced');
  });
});

describe('workplace plans: before limits (unverified) and after limits (fixture)', () => {
  const plan = (extra: Record<string, unknown> = {}) => ({
    id: 'plan',
    planType: '401k',
    traditionalAccountId: 'k',
    traditionalPctOfSalary: 0.1,
    match: {
      tiers: [{ matchRate: 1, bandPctOfPay: 0.04 }],
      vesting: { kind: 'cliff', years: 3 },
      yearsOfServiceAtStart: 0,
    },
    ...extra,
  });
  const worker = (over: Record<string, unknown> = {}, accounts?: Record<string, unknown>[]) =>
    household({
      person: {
        birthYear: YEAR - 63,
        retirementAge: 65,
        employment: { baseSalary: dollars(100_000), raise: { mode: 'nominal', rate: 0 } },
        workplacePlans: [plan()],
        ...over,
      },
      accounts: accounts ?? [
        {
          type: 'workplaceTraditional',
          id: 'k',
          name: '401k',
          ownerId: 'person-1',
          planType: '401k',
          balance: dollars(50_000),
          unvestedEmployerBalance: dollars(1_000),
          expectedReturn: 0,
        },
      ],
      spending: { currentAnnualSpending: dollars(40_000), retirementAnnualSpending: dollars(10_000) },
    });

  it('uses the elections as entered when limits are unverified, and says so', () => {
    const r = project(worker());
    expect(r.excludedFeatures).toContain('workplaceLimits');
    const p = r.rows[0]!.people[0]!;
    expect(p.employeeTraditional).toBe(dollars(10_000));
    expect(p.employerMatch).toBe(dollars(4_000));
    expect(account(r.rows[0]!, 'k').contributions).toBe(dollars(14_000));
    expect(account(r.rows[0]!, 'k').employerContributions).toBe(dollars(4_000));
    // Taxes need unverified rules: net pay and surplus stay null, never estimated.
    expect(r.rows[0]!.cashFlow.netPay).toBeNull();
    expect(r.rows[0]!.cashFlow.surplus).toBeNull();
    expect(r.rows[0]!.netIncome).toBeNull();
    expect(r.unverified.length).toBeGreaterThan(0);
  });

  it('caps contributions with verified limits (synthetic fixture: $20,000 + $10,000 at 60–63)', () => {
    const r = project(worker({ workplacePlans: [plan({ traditionalPctOfSalary: 0.4 })] }), fixtureCtx);
    expect(r.excludedFeatures).not.toContain('workplaceLimits');
    expect(r.rows[0]!.people[0]!.employeeTraditional).toBe(dollars(30_000));
    expect(r.rows[0]!.people[0]!.catchUp).toBe(dollars(10_000));
    expect(r.rows[0]!.cashFlow.netPay).not.toBeNull();
    expect(r.rows[0]!.tax).not.toBeNull();
  });

  it('forfeits unvested employer money at separation (cliff 3 years, 2 years worked)', () => {
    const r = project(worker());
    // Unvested: 1,000 at start + 4,000 match in each of 2 years (0% return) = 9,000; all forfeited in year 3.
    const sep = account(r.rows[2]!, 'k');
    expect(sep.forfeited).toBe(dollars(9_000));
    expect(sep.withdrawals).toBe(dollars(9_000) + dollars(10_000));
    expect(r.rows[2]!.flows.forfeited).toBe(dollars(9_000));
    expect(r.rows[2]!.flows.withdrawals).toBe(dollars(10_000));
    expect(account(r.rows[3]!, 'k').forfeited).toBe(0);
    expectReconciled(r);
  });

  it('keeps vested money: graded vesting after 2 years of service at start + 2 worked', () => {
    const r = project(
      worker({
        workplacePlans: [
          plan({
            match: {
              tiers: [{ matchRate: 1, bandPctOfPay: 0.04 }],
              vesting: { kind: 'graded', vestedByYear: [0.2, 0.4, 0.6, 0.8, 1] },
              yearsOfServiceAtStart: 2,
            },
          }),
        ],
      }),
    );
    // The entered $1,000 is the part not vested today (2 years: 40% vested), so $1,666.67 of employer
    // money is subject to vesting; plus $8,000 of match = $9,666.67. At separation after 4 years of
    // service 80% is vested: 20% × 9,666.67 = $1,933.33 forfeited.
    expect(account(r.rows[2]!, 'k').forfeited).toBe(dollars(1_933.33));
  });

  it('routes a verified surplus to the surplus account', () => {
    const accounts = [
      {
        type: 'workplaceTraditional',
        id: 'k',
        name: '401k',
        ownerId: 'person-1',
        planType: '401k',
        balance: 0,
        expectedReturn: 0,
      },
      {
        type: 'taxableBrokerage',
        id: 't',
        name: 'T',
        ownerId: 'person-1',
        balance: 0,
        costBasis: 0,
        expectedReturn: 0,
      },
    ];
    const h = HouseholdSchema.parse({
      ...worker({}, accounts),
      assumptions: { ...worker({}, accounts).assumptions, surplus: { mode: 'account', accountId: 't' } },
    });
    const r = project(h, fixtureCtx);
    const row = r.rows[0]!;
    expect(row.cashFlow.surplus).not.toBeNull();
    expect(row.cashFlow.surplus!).toBeGreaterThan(0);
    expect(account(row, 't').contributions).toBe(row.cashFlow.surplus);
    expect(row.flows.surplusRouted).toBe(row.cashFlow.surplus);
    expect(account(row, 't').basisEnd).toBe(row.cashFlow.surplus);
    // Without verified taxes nothing is routed.
    expect(account(project(h).rows[0]!, 't').contributions).toBe(0);
  });

  it('flags infeasible years with verified taxes', () => {
    const h = HouseholdSchema.parse({
      ...worker(),
      spending: { ...worker().spending, currentAnnualSpending: dollars(95_000) },
    });
    const r = project(h, fixtureCtx);
    expect(r.summary.infeasibleYears).toEqual([YEAR, YEAR + 1]);
    expect(r.rows[0]!.cashFlow.infeasible).toBe(true);
    expect(r.rows[2]!.cashFlow.infeasible).toBeNull();
  });
});

describe('review fixes (M3)', () => {
  const ss = { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } };

  it('stops part-time pay and owned other income after the person’s planning age', () => {
    const base = household({
      filingStatus: 'marriedFilingJointly',
      people: [
        { id: 'person-1', name: 'A', birthYear: YEAR - 70, retirementAge: 65, planningAge: 90, socialSecurity: ss },
        {
          id: 'person-2',
          name: 'B',
          birthYear: YEAR - 70,
          retirementAge: 65,
          planningAge: 75,
          socialSecurity: ss,
          employment: {
            baseSalary: 0,
            raise: { mode: 'nominal', rate: 0 },
            partTime: { startAge: 70, endAge: 95, annualIncome: dollars(50_000) },
          },
        },
      ],
      accounts: [cash(500_000, { expectedReturn: 0 })],
      spending: { retirementAnnualSpending: dollars(60_000) },
    });
    const h = HouseholdSchema.parse({
      ...base,
      otherIncome: [
        {
          id: 'rent',
          name: 'Rent',
          ownerId: 'person-2',
          startYear: YEAR,
          annualAmount: dollars(5_000),
          growth: { mode: 'flat' },
        },
      ],
    });
    const r = project(h);
    // B lives through age 75 (YEAR+5): $50k part-time + $5k rent, so $5k is withdrawn.
    expect(r.rows[5]!.people[1]!.partTimeIncome).toBe(dollars(50_000));
    expect(r.rows[5]!.flows.withdrawals).toBe(dollars(5_000));
    expect(r.rows[5]!.flows.otherIncome).toBe(dollars(5_000));
    // From YEAR+6 B has died: no part-time pay, no rent; the whole $60k is withdrawn.
    expect(r.rows[6]!.people[1]!.alive).toBe(false);
    expect(r.rows[6]!.people[1]!.partTimeIncome).toBe(0);
    expect(r.rows[6]!.flows.otherIncome).toBe(0);
    expect(r.rows[6]!.flows.withdrawals).toBe(dollars(60_000));
  });

  it('keeps a person who still draws salary past the retirement age in the accumulation phase', () => {
    const r = project(
      household({
        person: {
          birthYear: YEAR - 60,
          retirementAge: 62,
          employment: { baseSalary: dollars(100_000), raise: { mode: 'nominal', rate: 0 }, stopAge: 65 },
        },
        accounts: [cash(100_000, { expectedReturn: 0 })],
        spending: { currentAnnualSpending: dollars(50_000), retirementAnnualSpending: dollars(40_000) },
      }),
    );
    expect(r.rows[3]!.phase).toBe('accumulation');
    expect(r.rows[4]!.people[0]!.baseSalary).toBe(dollars(100_000));
    expect(r.rows[5]!.phase).toBe('retirement');
    expect(r.summary.retirementYear).toBe(YEAR + 5);
  });

  it('flags a working year as infeasible without taxes when pay alone cannot cover spending', () => {
    const r = project(
      household({
        filingStatus: 'marriedFilingJointly',
        people: [
          { id: 'person-1', name: 'A', birthYear: YEAR - 56, retirementAge: 55, socialSecurity: ss },
          {
            id: 'person-2',
            name: 'B',
            birthYear: YEAR - 50,
            retirementAge: 65,
            socialSecurity: ss,
            employment: { baseSalary: dollars(30_000), raise: { mode: 'nominal', rate: 0 } },
          },
        ],
        accounts: [cash(1_000_000, { expectedReturn: 0 })],
        spending: { currentAnnualSpending: dollars(100_000), retirementAnnualSpending: dollars(40_000) },
      }),
    );
    expect(r.rows[0]!.cashFlow.netPay).toBeNull();
    expect(r.rows[0]!.cashFlow.infeasible).toBe(true);
    expect(r.summary.infeasibleYears).toHaveLength(15);
    expect(r.warnings.some((w) => w.code === 'savingsPlanInfeasible' && w.message.includes('even before taxes'))).toBe(
      true,
    );
  });

  it('reports the depletion age of a person still alive', () => {
    const d = computeDashboard(
      household({
        filingStatus: 'marriedFilingJointly',
        people: [
          { id: 'person-1', name: 'A', birthYear: YEAR - 70, retirementAge: 65, planningAge: 75, socialSecurity: ss },
          { id: 'person-2', name: 'B', birthYear: YEAR - 60, retirementAge: 60, planningAge: 95, socialSecurity: ss },
        ],
        accounts: [cash(200_000, { expectedReturn: 0 })],
        spending: { retirementAnnualSpending: dollars(20_000) },
      }),
      ctx,
    );
    if (d.status !== 'ok') throw new Error('dashboard');
    // Depletes in YEAR+10, after A's last year (YEAR+5): B's age, 70.
    expect(d.value.baseline.summary.depletionYear).toBe(YEAR + 10);
    expect(d.value.baseline.summary.depletionAge).toBe(70);
    expect(d.value.cards.longevity).toEqual({ kind: 'depletes', year: YEAR + 10, age: 70, personId: 'person-2' });
  });

  it('rejects an inflation override of −100% or less instead of throwing', () => {
    const r = projectHousehold(household({ accounts: [cash(1_000)] }), ctx, { inflationOverride: () => -1 });
    expect(r.status).toBe('invalid');
  });

  it('never lets rounded retirement contributions exceed the income left over', () => {
    const sched = (id: string) => ({
      type: 'taxableBrokerage',
      id,
      name: id,
      ownerId: 'person-1',
      balance: 0,
      costBasis: 0,
      expectedReturn: 0,
      contribution: { amount: { kind: 'dollars', amount: dollars(5_000), frequency: 'annual' }, stopYear: YEAR },
    });
    const r = project(
      household({
        person: {
          ...retiree,
          employment: {
            baseSalary: 0,
            raise: { mode: 'nominal', rate: 0 },
            partTime: { startAge: 70, endAge: 71, annualIncome: 1_000_003 },
          },
        },
        accounts: [sched('t1'), sched('t2'), sched('t3')],
        spending: { retirementAnnualSpending: dollars(10_000) },
        assumptions: { withdrawalTiming: 'startOfYear' },
      }),
    );
    // $0.03 left over for three schedules: one cent each, no shortfall, no false depletion.
    expect(r.rows[0]!.flows.contributions).toBe(3);
    expect(r.rows[0]!.flows.shortfall).toBe(0);
    expect(r.rows[0]!.depleted).toBe(false);
  });
});

describe('samples, dashboard and warnings', () => {
  it('reconciles every account row of every sample profile, annual and monthly', () => {
    for (const s of SAMPLE_PROFILES) {
      const h = s.build(YEAR);
      expectReconciled(project(h));
      expectReconciled(project(h, fixtureCtx));
      expectReconciled(
        project(
          HouseholdSchema.parse({
            ...h,
            assumptions: { ...h.assumptions, granularity: 'monthly', withdrawalTiming: 'startOfYear' },
          }),
        ),
      );
    }
  });

  it('produces results that satisfy the frozen ProjectionResult schema', () => {
    for (const s of SAMPLE_PROFILES) {
      for (const c of [ctx, fixtureCtx]) {
        const parsed = ProjectionResultSchema.safeParse(project(s.build(YEAR), c));
        expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
      }
    }
  });

  it('lists inputs that are modeled in M4', () => {
    const notes = (id: string) =>
      project(SAMPLE_PROFILES.find((s) => s.id === id)!.build(YEAR))
        .warnings.filter((w) => w.code === 'featureNotModeled')
        .map((w) => w.message);
    expect(notes('nearRetirement').some((m) => m.includes('Social Security'))).toBe(true);
    expect(notes('midCareerCouple').some((m) => m.includes('Social Security'))).toBe(false);
    expect(notes('midCareerCouple').some((m) => m.includes('survivor spending reduction'))).toBe(true);
    expect(notes('earlyCareer').some((m) => m.includes('before taxes'))).toBe(true);
  });

  it('dashboard cards follow their documented definitions', () => {
    const h = household({
      person: { birthYear: YEAR - 60, retirementAge: 62, planningAge: 90 },
      accounts: [cash(1_200_000, { expectedReturn: null })],
      spending: { currentAnnualSpending: dollars(50_000), retirementAnnualSpending: dollars(36_000) },
      assumptions: { inflation: 0.02, returnPreRetirement: 0.04, returnPostRetirement: 0.04 },
    });
    const d = computeDashboard(h, ctx);
    if (d.status !== 'ok') throw new Error('dashboard');
    const { cards, baseline } = d.value;
    const row = baseline.rows[2]!;
    expect(cards.people[0]).toMatchObject({ currentAge: 60, retirementAge: 62, yearsToRetirement: 2 });
    expect(cards.currentSavings).toBe(dollars(1_200_000));
    expect(cards.firstRetirementYear).toBe(YEAR + 2);
    // Two accumulation years at 4% with no contributions: $1,200,000 × 1.04².
    expect(cards.savingsAtRetirement.nominal).toBe(dollars(1_200_000 * 1.04 ** 2));
    expect(row.totals.portfolioStart).toBe(cards.savingsAtRetirement.nominal);
    // A start-of-year balance is the prior year-end money: deflated by P_{t−1} = 1.02.
    expect(cards.savingsAtRetirement.real).toBe(dollars((1_200_000 * 1.04 ** 2) / 1.02));
    expect(cards.savingsAtRetirement.real).toBe(baseline.rows[1]!.real.portfolioEnd);
    expect(cards.monthlyRetirementSpending.nominal).toBe(dollars((36_000 * 1.02 ** 2) / 12));
    expect(cards.monthlyRetirementSpending.real).toBe(dollars(3_000));
    expect(cards.monthlyRetirementIncome.taxBasis).toBe('beforeTaxes');
    expect(cards.monthlyRetirementIncome.nominal).toBe(cards.monthlyRetirementSpending.nominal);
    expect(cards.monthlySurplus.nominal).toBe(0);
    expect(cards.longevity).toEqual({ kind: 'lastsThroughPlanningAge', planningAge: 90 });
    expect(cards.readiness.status).toBe('onTrack');
    // Offsets are fixed return shifts: optimistic ≥ baseline ≥ pessimistic here.
    expect(d.value.optimistic.summary.endingBalance).toBeGreaterThan(baseline.summary.endingBalance);
    expect(d.value.pessimistic.summary.endingBalance).toBeLessThan(baseline.summary.endingBalance);
  });

  it('readiness is borderline when only the pessimistic run fails, at risk when the baseline fails', () => {
    const at = (balance: number) => {
      const d = computeDashboard(
        household({
          person: { ...retiree, planningAge: 90 },
          accounts: [cash(balance, { expectedReturn: null })],
          spending: { retirementAnnualSpending: dollars(40_000) },
          assumptions: { returnPostRetirement: 0.05 },
        }),
        ctx,
      );
      if (d.status !== 'ok') throw new Error('dashboard');
      return d.value.cards;
    };
    // 21 years of $40,000 (mid-year): about $526k is needed at 5% and about $626k at 3% (pessimistic).
    expect(at(560_000).readiness.status).toBe('borderline');
    expect(at(700_000).readiness.status).toBe('onTrack');
    const risk = at(300_000);
    expect(risk.readiness.status).toBe('atRisk');
    expect(risk.longevity.kind).toBe('depletes');
  });

  it('a minimum ending balance (today’s dollars) is part of deterministic success', () => {
    const h = household({
      person: retiree,
      accounts: [cash(100_000, { expectedReturn: 0 })],
      spending: { retirementAnnualSpending: dollars(1_000) },
    });
    expect(project(h).summary.deterministicSuccess).toBe(true);
    const strict = HouseholdSchema.parse({
      ...h,
      assumptions: { ...h.assumptions, minimumEndingBalance: dollars(80_000) },
    });
    expect(project(strict).summary.endingBalanceReal).toBe(dollars(74_000));
    expect(project(strict).summary.deterministicSuccess).toBe(false);
  });
});
