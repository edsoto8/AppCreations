import { describe, expect, it } from 'vitest';
import { HouseholdSchema, canReceiveLumpSum, canReceiveTaxableMoney, type HouseholdInput } from './household';
import { minimalHouseholdInput } from '../samples/minimal';
import { formatIssues, zodIssues } from '../validation';

const YEAR = 2026;

function parse(input: unknown) {
  return HouseholdSchema.safeParse(input);
}

function messages(input: unknown): string[] {
  const r = parse(input);
  return r.success ? [] : formatIssues(zodIssues(r.error));
}

function couple(): HouseholdInput {
  const base = minimalHouseholdInput(YEAR);
  const person = base.people[0]!;
  return {
    ...base,
    filingStatus: 'marriedFilingJointly',
    people: [person, { ...person, id: 'person-2', name: 'Partner', birthYear: YEAR - 33 }],
  };
}

/** A person with a 401(k) plan and both workplace accounts. */
function withPlan(
  overrides: Record<string, unknown> = {},
  accountOverrides: Record<string, unknown> = {},
): HouseholdInput {
  const base = minimalHouseholdInput(YEAR);
  return {
    ...base,
    people: [
      {
        ...base.people[0]!,
        employment: { baseSalary: 10_000_000, raise: { mode: 'nominal', rate: 0.03 } },
        workplacePlans: [
          {
            id: 'plan-1',
            planType: '401k',
            traditionalAccountId: 'k-trad',
            rothAccountId: 'k-roth',
            planOffersRoth: true,
            traditionalPctOfSalary: 0.06,
            match: {
              tiers: [
                { matchRate: 1, bandPctOfPay: 0.03 },
                { matchRate: 0.5, bandPctOfPay: 0.02 },
              ],
            },
            ...overrides,
          },
        ],
      },
    ],
    accounts: [
      ...(base.accounts ?? []),
      {
        type: 'workplaceTraditional',
        planType: '401k',
        id: 'k-trad',
        name: '401(k)',
        ownerId: 'person-1',
        balance: 0,
        ...accountOverrides,
      },
      { type: 'workplaceRoth', planType: '401k', id: 'k-roth', name: 'Roth 401(k)', ownerId: 'person-1', balance: 0 },
    ],
  } as HouseholdInput;
}

describe('HouseholdSchema', () => {
  it('accepts the minimal household and fills defaults', () => {
    const r = parse(minimalHouseholdInput(YEAR));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.people[0]!.planningAge).toBe(95);
    expect(r.data.people[0]!.workplacePlans).toEqual([]);
    expect(r.data.assumptions.withdrawalTiming).toBe('midYear');
    expect(r.data.assumptions.deterministicOffsets).toEqual({ optimistic: 0.02, pessimistic: -0.02 });
    expect(r.data.spending.survivorSpendingReduction).toBe(0.2);
    expect(r.data.assumptions.grossUp).toEqual({ maxIterations: 50, toleranceCents: 100 });
  });

  it('accepts a married couple', () => {
    expect(parse(couple()).success).toBe(true);
  });

  it('accepts a workplace plan with tiered match', () => {
    const r = parse(withPlan());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.people[0]!.workplacePlans[0]!.match.vesting).toEqual({ kind: 'immediate' });
  });

  it('requires two people for married filing jointly and one for single', () => {
    expect(messages({ ...minimalHouseholdInput(YEAR), filingStatus: 'marriedFilingJointly' })).toContain(
      'people: Married filing jointly needs two people',
    );
    expect(messages({ ...couple(), filingStatus: 'single' }).join()).toMatch(
      /Single filing status supports one person/,
    );
  });

  it('rejects unsupported filing statuses', () => {
    expect(parse({ ...minimalHouseholdInput(YEAR), filingStatus: 'headOfHousehold' }).success).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const h = minimalHouseholdInput(YEAR);
    const dup = { ...h, accounts: [...(h.accounts ?? []), { ...h.accounts![0]!, name: 'Copy' }] };
    expect(messages(dup)).toContain('Duplicate id "account-1"');
  });

  it('rejects accounts with an unknown owner', () => {
    const h = minimalHouseholdInput(YEAR);
    expect(messages({ ...h, accounts: [{ ...h.accounts![0]!, ownerId: 'nobody' }] })).toContain(
      'accounts.0.ownerId: Unknown owner',
    );
  });

  it('rejects a Roth IRA basis above its balance', () => {
    const h = minimalHouseholdInput(YEAR);
    const roth = {
      type: 'rothIra',
      id: 'r',
      name: 'Roth IRA',
      ownerId: 'person-1',
      balance: 100,
      contributionBasis: 200,
    };
    expect(messages({ ...h, accounts: [roth] })).toContain('accounts.0.contributionBasis: Basis cannot exceed balance');
  });

  it('rejects a retirement age after the planning age', () => {
    const h = minimalHouseholdInput(YEAR);
    expect(messages({ ...h, people: [{ ...h.people[0]!, retirementAge: 99 }] })).toContain(
      'people.0.retirementAge: Retirement age is after planning age',
    );
  });

  it('requires workplace plans to reference the owner’s matching accounts', () => {
    expect(messages(withPlan({ traditionalAccountId: 'account-1' })).join()).toMatch(/traditional workplace account/);
    expect(messages(withPlan({ rothAccountId: 'account-1' })).join()).toMatch(/Roth workplace account/);
    expect(messages(withPlan({ rothAccountId: null }))).toEqual([]);
  });

  it('rejects Roth elections when the plan does not offer Roth', () => {
    expect(messages(withPlan({ planOffersRoth: false, rothPctOfSalary: 0.05 })).join()).toMatch(
      /plan that offers Roth/,
    );
    expect(messages(withPlan({ planOffersRoth: false, matchDestination: 'roth' })).join()).toMatch(
      /plan that offers Roth/,
    );
  });

  it('rejects an unknown surplus account', () => {
    const h = minimalHouseholdInput(YEAR);
    const bad = { ...h, assumptions: { ...h.assumptions, surplus: { mode: 'account', accountId: 'missing' } } };
    expect(messages(bad)).toContain('assumptions.surplus.accountId: Unknown surplus account');
    const good = { ...h, assumptions: { ...h.assumptions, surplus: { mode: 'account', accountId: 'account-1' } } };
    expect(parse(good).success).toBe(true);
  });

  it('validates allocations total 100%', () => {
    const h = minimalHouseholdInput(YEAR);
    const withAlloc = (allocation: unknown) => ({ ...h, accounts: [{ ...h.accounts![0]!, allocation }] });
    expect(parse(withAlloc({ stocks: 0.6, bonds: 0.3, cash: 0.1 })).success).toBe(true);
    expect(messages(withAlloc({ stocks: 0.6, bonds: 0.3, cash: 0.2 })).join()).toMatch(/Allocation must total 100%/);
  });

  it('bounds the Social Security claiming age to 62–70', () => {
    const h = minimalHouseholdInput(YEAR);
    const claim = (years: number, months: number) => ({
      ...h,
      people: [{ ...h.people[0]!, socialSecurity: { source: { kind: 'none' }, claimAge: { years, months } } }],
    });
    expect(parse(claim(62, 0)).success).toBe(true);
    expect(parse(claim(70, 0)).success).toBe(true);
    expect(messages(claim(61, 11)).join()).toMatch(/between 62 and 70/);
    expect(messages(claim(70, 1)).join()).toMatch(/between 62 and 70/);
  });

  it('rejects negative money and out-of-range rates with readable messages', () => {
    const h = minimalHouseholdInput(YEAR);
    expect(messages({ ...h, accounts: [{ ...h.accounts![0]!, balance: -1 }] }).join()).toMatch(/cannot be negative/);
    expect(messages({ ...h, assumptions: { ...h.assumptions, returnPreRetirement: 1.5 } }).join()).toMatch(
      /at most 100%/,
    );
    expect(messages({ ...h, assumptions: { ...h.assumptions, returnPreRetirement: -2 } }).join()).toMatch(
      /at least -100%/,
    );
  });

  it('round-trips through JSON', () => {
    const r = parse(couple());
    expect(r.success).toBe(true);
    if (!r.success) return;
    const again = parse(JSON.parse(JSON.stringify(r.data)));
    expect(again.success && again.data).toEqual(r.data);
  });

  it('validates cross-references for pensions, other income, one-time events and surplus', () => {
    const h = minimalHouseholdInput(YEAR);
    const pension = {
      id: 'pension-1',
      name: 'Pension',
      ownerId: 'person-1',
      startAge: 65,
      annualAmount: 1_000_000,
      amountBasis: 'todaysDollars',
      payout: { kind: 'lumpSum', amount: 5_000_000, destinationAccountId: 'account-1' },
    };
    expect(messages({ ...h, pensions: [pension] })).toEqual([]);
    expect(messages({ ...h, pensions: [{ ...pension, ownerId: 'ghost' }] })).toContain(
      'pensions.0.ownerId: Unknown owner',
    );
    expect(
      messages({ ...h, pensions: [{ ...pension, payout: { ...pension.payout, destinationAccountId: 'nope' } }] }),
    ).toContain('pensions.0.payout.destinationAccountId: Unknown destination account');
    const income = { id: 'inc-1', name: 'Rent', ownerId: 'ghost', startYear: YEAR, annualAmount: 100 };
    expect(messages({ ...h, otherIncome: [income] })).toContain('otherIncome.0.ownerId: Unknown owner');
    expect(messages({ ...h, otherIncome: [{ ...income, ownerId: null }] })).toEqual([]);
    expect(messages({ ...h, otherIncome: [{ ...income, ownerId: null, endYear: YEAR - 1 }] })).toContain(
      'otherIncome.0.endYear: End year is before start year',
    );
    const event = {
      id: 'e-1',
      name: 'Home sale',
      year: YEAR + 5,
      direction: 'inflow',
      amount: 100,
      amountBasis: 'nominal',
    };
    expect(messages({ ...h, oneTimeEvents: [{ ...event, destinationAccountId: 'nope' }] })).toContain(
      'oneTimeEvents.0.destinationAccountId: Unknown destination account',
    );
    expect(messages({ ...h, oneTimeEvents: [event] })).toEqual([]);
  });

  it('allows surplus only into taxable, cash or other accounts', () => {
    const h = withPlan();
    const toPlan = { ...h, assumptions: { ...h.assumptions, surplus: { mode: 'account', accountId: 'k-trad' } } };
    expect(messages(toPlan)).toContain(
      'assumptions.surplus.accountId: Surplus can go only to a taxable brokerage, cash or taxable other account',
    );
  });

  it('checks workplace plan consistency', () => {
    expect(messages(withPlan({ rothAccountId: null, rothPctOfSalary: 0.02 }))).toContain(
      'people.0.workplacePlans.0.rothAccountId: Roth elections need a Roth workplace account',
    );
    expect(messages(withPlan({ planType: '403b' }))).toContain(
      'people.0.workplacePlans.0.planType: Plan type must match its accounts',
    );
    expect(
      messages(
        withPlan({
          planOffersRoth: false,
          rothAccountId: null,
          autoEscalation: { stepPct: 0.01, capPct: 0.1, appliesTo: 'roth' },
        }),
      ).join(),
    ).toMatch(/plan that offers Roth/);
    const h = withPlan();
    const person = h.people[0]!;
    const second = { ...person.workplacePlans![0]!, id: 'plan-2', rothAccountId: null };
    expect(messages({ ...h, people: [{ ...person, workplacePlans: [...person.workplacePlans!, second] }] })).toContain(
      'people.0.workplacePlans.1: Account "k-trad" is already used by another plan',
    );
  });

  it('enforces documented invariants on match, vesting, part-time, raises, schedules, steps and correlations', () => {
    const plan = (match: Record<string, unknown>) => withPlan({ match: { tiers: [], ...match } });
    expect(
      messages(
        plan({
          tiers: [
            { matchRate: 1, bandPctOfPay: 0.6 },
            { matchRate: 1, bandPctOfPay: 0.6 },
          ],
        }),
      ).join(),
    ).toMatch(/more than 100% of pay/);
    expect(messages(plan({ vesting: { kind: 'graded', vestedByYear: [0.2, 0.4, 1] } }))).toEqual([]);
    expect(messages(plan({ vesting: { kind: 'graded', vestedByYear: [0.5, 0.4, 1] } })).join()).toMatch(
      /must not decrease/,
    );
    expect(messages(plan({ vesting: { kind: 'graded', vestedByYear: [0.2, 0.8] } })).join()).toMatch(/end at 100%/);

    const h = minimalHouseholdInput(YEAR);
    const person = h.people[0]!;
    const employment = { baseSalary: 100, raise: { mode: 'nominal', rate: 0.03 } };
    const withEmployment = (e: Record<string, unknown>) => ({
      ...h,
      people: [{ ...person, employment: { ...employment, ...e } }],
    });
    expect(messages(withEmployment({ partTime: { startAge: 60, endAge: 60, annualIncome: 100 } })).join()).toMatch(
      /end age must be after/,
    );
    expect(
      messages(
        withEmployment({
          raiseOverrides: [
            { year: YEAR + 1, rate: 0.1 },
            { year: YEAR + 1, rate: 0 },
          ],
        }),
      ).join(),
    ).toMatch(/one raise override per year/);

    const schedule = { amount: { kind: 'maxAllowed' }, startYear: YEAR + 2, stopYear: YEAR + 1 };
    const ira = {
      type: 'traditionalIra',
      id: 'ira',
      name: 'IRA',
      ownerId: 'person-1',
      balance: 0,
      contribution: schedule,
    };
    expect(messages({ ...h, accounts: [ira] })).toContain(
      'accounts.0.contribution.stopYear: Contribution stop year is before its start year',
    );

    const steps = [
      { fromAge: 70, annualSpending: 100 },
      { fromAge: 70, annualSpending: 200 },
    ];
    expect(messages({ ...h, spending: { ...h.spending, steps } }).join()).toMatch(/one spending step per age/);

    const cm = h.assumptions.capitalMarket as { correlation: number[][] };
    const asym = {
      ...h,
      assumptions: {
        ...h.assumptions,
        capitalMarket: {
          ...cm,
          correlation: [
            [1, 0.5, 0],
            [0.1, 1, 0.2],
            [0, 0.2, 1],
          ],
        },
      },
    };
    expect(messages(asym).join()).toMatch(/symmetric with 1s on the diagonal/);
    const diag = {
      ...h,
      assumptions: {
        ...h.assumptions,
        capitalMarket: {
          ...cm,
          correlation: [
            [0.9, 0.1, 0],
            [0.1, 1, 0.2],
            [0, 0.2, 1],
          ],
        },
      },
    };
    expect(messages(diag).join()).toMatch(/symmetric with 1s on the diagonal/);
  });

  it('bounds inflation so the price level stays positive', () => {
    const h = minimalHouseholdInput(YEAR);
    const at = (inflation: number) => messages({ ...h, assumptions: { ...h.assumptions, inflation } });
    expect(at(-0.5).join()).toMatch(/above -50%/);
    expect(at(0.51).join()).toMatch(/at most 50%/);
    expect(at(-0.1)).toEqual([]);
    expect(at(0.25)).toEqual([]);
  });

  it('does not share default objects between parses', () => {
    const a = parse(minimalHouseholdInput(YEAR));
    const b = parse(minimalHouseholdInput(YEAR));
    expect(a.success && b.success).toBe(true);
    if (!a.success || !b.success) return;
    expect(a.data.assumptions.socialSecurity.cola).toEqual(b.data.assumptions.socialSecurity.cola);
    expect(a.data.assumptions.socialSecurity.cola).not.toBe(b.data.assumptions.socialSecurity.cola);
  });
});

describe('M4 destination and earnings validation', () => {
  it('rejects a lump sum into a Roth or another person’s IRA, an inflow into an IRA, and duplicate earnings years', async () => {
    const { minimalHouseholdInput } = await import('../samples/minimal');
    const base = minimalHouseholdInput(2026);
    const accounts = [
      ...(base.accounts ?? []),
      { type: 'rothIra', id: 'roth', name: 'Roth', ownerId: 'person-1', balance: 0, contributionBasis: 0 },
      { type: 'traditionalIra', id: 'ira', name: 'IRA', ownerId: 'person-1', balance: 0 },
    ];
    const pension = (dest: string) => ({
      id: 'p',
      name: 'P',
      ownerId: 'person-1',
      startAge: 65,
      annualAmount: 0,
      amountBasis: 'nominalAtStart',
      payout: { kind: 'lumpSum', amount: 100, destinationAccountId: dest },
    });
    const parse = (extra: Record<string, unknown>) => HouseholdSchema.safeParse({ ...base, accounts, ...extra });
    expect(parse({ pensions: [pension('ira')] }).success).toBe(true);
    expect(parse({ pensions: [pension('account-1')] }).success).toBe(true);
    expect(parse({ pensions: [pension('roth')] }).success).toBe(false);
    const event = (dest: string) => ({
      id: 'e',
      name: 'E',
      year: 2030,
      direction: 'inflow',
      amount: 100,
      amountBasis: 'nominal',
      destinationAccountId: dest,
    });
    expect(parse({ oneTimeEvents: [event('account-1')] }).success).toBe(true);
    expect(parse({ oneTimeEvents: [event('ira')] }).success).toBe(false);
    const ss = {
      source: {
        kind: 'estimateHistory',
        earnings: [
          { year: 2020, earnings: 100 },
          { year: 2020, earnings: 200 },
        ],
      },
      claimAge: { years: 67, months: 0 },
    };
    const people = [{ ...base.people[0]!, socialSecurity: ss }];
    expect(HouseholdSchema.safeParse({ ...base, people }).success).toBe(false);
  });

  it('shares one destination rule: tax-advantaged "other" accounts take rollovers only from their owner', () => {
    const other = (taxTreatment: string, ownerId = 'p1') => ({ type: 'other', ownerId, taxTreatment }) as never;
    expect(canReceiveTaxableMoney(other('taxable'))).toBe(true);
    expect(canReceiveTaxableMoney(other('taxDeferred'))).toBe(false);
    expect(canReceiveTaxableMoney(other('taxFree'))).toBe(false);
    expect(canReceiveTaxableMoney({ type: 'hsa' })).toBe(false);
    expect(canReceiveLumpSum(other('taxDeferred'), 'p1')).toBe(true);
    expect(canReceiveLumpSum(other('taxDeferred', 'p2'), 'p1')).toBe(false);
    expect(canReceiveLumpSum(other('taxFree'), 'p1')).toBe(false);
    expect(canReceiveLumpSum({ type: 'workplaceRoth', ownerId: 'p1' } as never, 'p1')).toBe(false);
    expect(canReceiveLumpSum({ type: 'cash', ownerId: 'p2' } as never, 'p1')).toBe(true);
  });
});
