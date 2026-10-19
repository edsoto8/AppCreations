/**
 * Sample profiles (brief §5.10): early-career, mid-career couple, near-retirement and high-earner.
 * Illustrative inputs only (no regulatory values). Built relative to the injected current year.
 */
import { HouseholdSchema, type Household, type HouseholdInput } from '../domain/household';
import { dollars } from '../money';
import { minimalHouseholdInput } from './minimal';

export type SampleProfileId = 'earlyCareer' | 'midCareerCouple' | 'nearRetirement' | 'highEarner';

export interface SampleProfile {
  id: SampleProfileId;
  title: string;
  summary: string;
  build: (currentYear: number) => Household;
}

const STANDARD_MATCH = {
  tiers: [
    { matchRate: 1, bandPctOfPay: 0.03 },
    { matchRate: 0.5, bandPctOfPay: 0.02 },
  ],
};

function base(currentYear: number, id: string, name: string): HouseholdInput {
  return { ...minimalHouseholdInput(currentYear, id), name, accounts: [] };
}

function earlyCareer(year: number): HouseholdInput {
  const h = base(year, 'sample-early-career', 'Early career (sample)');
  return {
    ...h,
    people: [
      {
        id: 'alex',
        name: 'Alex',
        birthYear: year - 26,
        retirementAge: 65,
        planningAge: 95,
        employment: {
          baseSalary: dollars(62_000),
          raise: { mode: 'inflationPlus', realRate: 0.015 },
          bonus: { kind: 'percentOfSalary', pct: 0.05 },
        },
        workplacePlans: [
          {
            id: 'alex-401k',
            planType: '401k',
            traditionalAccountId: 'alex-401k-trad',
            rothAccountId: 'alex-401k-roth',
            planOffersRoth: true,
            rothPctOfSalary: 0.05,
            autoEscalation: { stepPct: 0.01, capPct: 0.1, appliesTo: 'roth' },
            match: { ...STANDARD_MATCH, vesting: { kind: 'graded', vestedByYear: [0.25, 0.5, 0.75, 1] } },
          },
        ],
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      {
        type: 'workplaceTraditional',
        planType: '401k',
        id: 'alex-401k-trad',
        name: '401(k)',
        ownerId: 'alex',
        balance: dollars(4_000),
      },
      {
        type: 'workplaceRoth',
        planType: '401k',
        id: 'alex-401k-roth',
        name: 'Roth 401(k)',
        ownerId: 'alex',
        balance: dollars(6_500),
      },
      { type: 'cash', id: 'alex-cash', name: 'Emergency fund', ownerId: 'alex', balance: dollars(8_000) },
    ],
    spending: { currentAnnualSpending: dollars(42_000), retirementAnnualSpending: dollars(40_000) },
  };
}

function midCareerCouple(year: number): HouseholdInput {
  const h = base(year, 'sample-mid-career-couple', 'Mid-career couple (sample)');
  return {
    ...h,
    filingStatus: 'marriedFilingJointly',
    people: [
      {
        id: 'sam',
        name: 'Sam',
        birthYear: year - 42,
        retirementAge: 65,
        planningAge: 92,
        employment: {
          baseSalary: dollars(118_000),
          raise: { mode: 'nominal', rate: 0.03 },
          bonus: { kind: 'percentOfSalary', pct: 0.08 },
        },
        workplacePlans: [
          {
            id: 'sam-plan',
            planType: '401k',
            traditionalAccountId: 'sam-401k',
            traditionalPctOfSalary: 0.08,
            traditionalPctOfBonus: 0.08,
            match: STANDARD_MATCH,
          },
        ],
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
      {
        id: 'jordan',
        name: 'Jordan',
        birthYear: year - 40,
        retirementAge: 63,
        planningAge: 96,
        employment: { baseSalary: dollars(84_000), raise: { mode: 'nominal', rate: 0.03 } },
        workplacePlans: [
          {
            id: 'jordan-plan',
            planType: '403b',
            traditionalAccountId: 'jordan-403b',
            traditionalPctOfSalary: 0.06,
            match: { tiers: [{ matchRate: 0.5, bandPctOfPay: 0.06 }] },
          },
        ],
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      {
        type: 'workplaceTraditional',
        planType: '401k',
        id: 'sam-401k',
        name: 'Sam 401(k)',
        ownerId: 'sam',
        balance: dollars(185_000),
      },
      {
        type: 'workplaceTraditional',
        planType: '403b',
        id: 'jordan-403b',
        name: 'Jordan 403(b)',
        ownerId: 'jordan',
        balance: dollars(96_000),
      },
      {
        type: 'rothIra',
        id: 'jordan-roth',
        name: 'Jordan Roth IRA',
        ownerId: 'jordan',
        balance: dollars(41_000),
        contributionBasis: dollars(30_000),
        contribution: { amount: { kind: 'dollars', amount: dollars(250), frequency: 'monthly' } },
      },
      {
        type: 'taxableBrokerage',
        id: 'joint-brokerage',
        name: 'Joint brokerage',
        ownerId: 'sam',
        balance: dollars(52_000),
        costBasis: dollars(38_000),
      },
      {
        type: 'hsa',
        id: 'sam-hsa',
        name: 'Family HSA',
        ownerId: 'sam',
        balance: dollars(14_000),
        coverage: 'family',
        hdhpAttested: true,
        contribution: { amount: { kind: 'dollars', amount: dollars(5_000), frequency: 'annual' } },
      },
    ],
    spending: { currentAnnualSpending: dollars(110_000), retirementAnnualSpending: dollars(95_000) },
    assumptions: { ...h.assumptions, stateTaxRate: 0.045 },
  };
}

function nearRetirement(year: number): HouseholdInput {
  const h = base(year, 'sample-near-retirement', 'Near retirement (sample)');
  return {
    ...h,
    people: [
      {
        id: 'pat',
        name: 'Pat',
        birthYear: year - 61,
        retirementAge: 65,
        planningAge: 95,
        employment: { baseSalary: dollars(96_000), raise: { mode: 'nominal', rate: 0.025 } },
        workplacePlans: [
          {
            id: 'pat-plan',
            planType: '401k',
            traditionalAccountId: 'pat-401k',
            traditionalPctOfSalary: 0.15,
            match: STANDARD_MATCH,
          },
        ],
        socialSecurity: {
          source: { kind: 'statement', piaMonthly: dollars(2_650) },
          claimAge: { years: 67, months: 0 },
        },
      },
    ],
    accounts: [
      {
        type: 'workplaceTraditional',
        planType: '401k',
        id: 'pat-401k',
        name: '401(k)',
        ownerId: 'pat',
        balance: dollars(612_000),
      },
      { type: 'traditionalIra', id: 'pat-ira', name: 'Rollover IRA', ownerId: 'pat', balance: dollars(148_000) },
      {
        type: 'taxableBrokerage',
        id: 'pat-brokerage',
        name: 'Brokerage',
        ownerId: 'pat',
        balance: dollars(85_000),
        costBasis: dollars(60_000),
      },
    ],
    spending: { currentAnnualSpending: dollars(68_000), retirementAnnualSpending: dollars(62_000) },
  };
}

function highEarner(year: number): HouseholdInput {
  const h = base(year, 'sample-high-earner', 'High earner (sample)');
  return {
    ...h,
    people: [
      {
        id: 'morgan',
        name: 'Morgan',
        birthYear: year - 47,
        retirementAge: 58,
        planningAge: 97,
        employment: {
          baseSalary: dollars(325_000),
          raise: { mode: 'nominal', rate: 0.035 },
          bonus: { kind: 'percentOfSalary', pct: 0.3 },
          priorYearFicaWages: dollars(390_000),
        },
        workplacePlans: [
          {
            id: 'morgan-plan',
            planType: '401k',
            traditionalAccountId: 'morgan-401k',
            rothAccountId: 'morgan-401k-roth',
            planOffersRoth: true,
            traditionalPctOfSalary: 0.1,
            match: { tiers: [{ matchRate: 1, bandPctOfPay: 0.04 }], flatPctOfPay: 0.02 },
          },
        ],
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 70, months: 0 } },
      },
    ],
    accounts: [
      {
        type: 'workplaceTraditional',
        planType: '401k',
        id: 'morgan-401k',
        name: '401(k)',
        ownerId: 'morgan',
        balance: dollars(910_000),
      },
      {
        type: 'workplaceRoth',
        planType: '401k',
        id: 'morgan-401k-roth',
        name: 'Roth 401(k)',
        ownerId: 'morgan',
        balance: dollars(120_000),
      },
      {
        type: 'taxableBrokerage',
        id: 'morgan-brokerage',
        name: 'Brokerage',
        ownerId: 'morgan',
        balance: dollars(740_000),
        costBasis: dollars(420_000),
        contribution: { amount: { kind: 'dollars', amount: dollars(60_000), frequency: 'annual' } },
      },
    ],
    spending: { currentAnnualSpending: dollars(180_000), retirementAnnualSpending: dollars(150_000) },
    assumptions: { ...h.assumptions, stateTaxRate: 0.06, surplus: { mode: 'account', accountId: 'morgan-brokerage' } },
  };
}

const parse = (input: HouseholdInput) => HouseholdSchema.parse(input);

export const SAMPLE_PROFILES: readonly SampleProfile[] = [
  {
    id: 'earlyCareer',
    title: 'Early career',
    summary: 'Age 26, $62k salary, Roth 401(k) with auto-escalation.',
    build: (y) => parse(earlyCareer(y)),
  },
  {
    id: 'midCareerCouple',
    title: 'Mid-career couple',
    summary: 'Ages 42 and 40, two workplace plans, Roth IRA, HSA, brokerage.',
    build: (y) => parse(midCareerCouple(y)),
  },
  {
    id: 'nearRetirement',
    title: 'Near retirement',
    summary: 'Age 61, $760k saved, Social Security statement entered.',
    build: (y) => parse(nearRetirement(y)),
  },
  {
    id: 'highEarner',
    title: 'High earner',
    summary: 'Age 47, $325k salary plus bonus, early retirement target at 58.',
    build: (y) => parse(highEarner(y)),
  },
];
