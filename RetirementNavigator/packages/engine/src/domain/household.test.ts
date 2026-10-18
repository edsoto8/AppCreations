import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type HouseholdInput } from './household';
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
    expect(messages({ ...h, assumptions: { ...h.assumptions, inflation: 1.5 } }).join()).toMatch(/at most 100%/);
    expect(messages({ ...h, assumptions: { ...h.assumptions, inflation: -2 } }).join()).toMatch(/at least -100%/);
  });

  it('round-trips through JSON', () => {
    const r = parse(couple());
    expect(r.success).toBe(true);
    if (!r.success) return;
    const again = parse(JSON.parse(JSON.stringify(r.data)));
    expect(again.success && again.data).toEqual(r.data);
  });
});
