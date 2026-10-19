/**
 * M4 retirement income in the projection (docs/financial-model.md §5, §7). Rule-free features use the
 * bundled (unverified) rules; tax, RMD and SSA-rule paths use the PINNED SYNTHETIC FIXTURE.
 */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type Household, type HouseholdInput } from '../domain/household';
import type { ProjectionResult, YearRow } from '../domain/projection';
import { minimalHouseholdInput } from '../samples/minimal';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import { projectHousehold } from './project';

const YEAR = FIXTURE_YEAR;
const real = { currentYear: YEAR, rules: RULES };
const fixture = { currentYear: YEAR, rules: fixtureRules() };
const NO_SS = { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } };

type Over = Record<string, unknown> & { spending?: Record<string, unknown>; assumptions?: Record<string, unknown> };

function build(over: Over): Household {
  const base = minimalHouseholdInput(YEAR);
  return HouseholdSchema.parse({
    ...base,
    ...over,
    spending: { ...base.spending, ...over.spending },
    assumptions: { ...base.assumptions, inflation: 0, ...over.assumptions },
  } as HouseholdInput);
}

function project(h: Household, c = real): ProjectionResult {
  const r = projectHousehold(h, c);
  if (r.status !== 'ok') throw new Error(JSON.stringify(r));
  return r.value;
}

const person = (id: string, age: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  birthYear: YEAR - age,
  retirementAge: 65,
  planningAge: 95,
  socialSecurity: NO_SS,
  ...extra,
});
const cash = (balance: number, extra: Record<string, unknown> = {}) => ({
  type: 'cash',
  id: 'cash',
  name: 'Cash',
  ownerId: 'p1',
  balance: dollars(balance),
  expectedReturn: 0,
  ...extra,
});
const acct = (row: YearRow, id: string) => row.accounts.find((a) => a.accountId === id)!;

describe('spending plan (§5, rule-free)', () => {
  it('applies steps by the first person’s age, the real glide, pre-Medicare healthcare and the survivor reduction', () => {
    const h = build({
      filingStatus: 'marriedFilingJointly',
      people: [person('p1', 62, { planningAge: 70 }), person('p2', 62, { retirementAge: 62 })] as never,
      accounts: [cash(5_000_000)] as never,
      spending: {
        retirementAnnualSpending: dollars(50_000),
        steps: [{ fromAge: 66, annualSpending: dollars(40_000) }],
        retirementRealGlide: -0.01,
        healthcareBeforeMedicare: dollars(10_000),
        survivorSpendingReduction: 0.25,
      },
    });
    const r = project(h);
    // p1 retires at 65 (YEAR+3); p2 is already retired (62). First retirement-phase year YEAR+3.
    const need = (i: number) => r.rows[i]!.flows.spendingNeed;
    // YEAR+3: p1 65, p2 65 → no pre-Medicare (both 65); step not yet (66); glide 0 years.
    expect(need(3)).toBe(dollars(50_000));
    // YEAR+4: age 66 → step $40,000; one glide year.
    expect(need(4)).toBe(dollars(40_000 * 0.99));
    // p1 lives through 70 (YEAR+8); from YEAR+9 the survivor reduction applies.
    expect(need(8)).toBe(dollars(40_000 * 0.99 ** 5));
    expect(need(9)).toBe(dollars(40_000 * 0.99 ** 6 * 0.75));
    // Accumulation years (p1 still working) use current spending.
    expect(need(0)).toBe(h.spending.currentAnnualSpending);
  });

  it('adds healthcare while a living retired person is under 65', () => {
    const h = build({
      people: [person('p1', 60, { retirementAge: 60 })] as never,
      accounts: [cash(2_000_000)] as never,
      spending: { retirementAnnualSpending: dollars(30_000), healthcareBeforeMedicare: dollars(12_000) },
    });
    const r = project(h);
    expect(r.rows[4]!.flows.spendingNeed).toBe(dollars(42_000));
    expect(r.rows[5]!.flows.spendingNeed).toBe(dollars(30_000));
  });
});

describe('pensions and one-time events (§7.6, rule-free)', () => {
  const retiree = (pensions: unknown[], extra: Record<string, unknown> = {}) =>
    build({
      people: [person('p1', 70)] as never,
      accounts: [
        cash(1_000_000),
        { type: 'traditionalIra', id: 'ira', name: 'IRA', ownerId: 'p1', balance: 0, expectedReturn: 0 },
      ] as never,
      pensions: pensions as never,
      spending: { retirementAnnualSpending: dollars(30_000) },
      assumptions: { inflation: 0.02 },
      ...extra,
    });

  it('pays an annuity from its start age with inflation COLA, in today’s or nominal dollars', () => {
    const r = project(
      retiree([
        {
          id: 'a',
          name: 'A',
          ownerId: 'p1',
          startAge: 72,
          annualAmount: dollars(12_000),
          amountBasis: 'todaysDollars',
          cola: { mode: 'inflation' },
          payout: { kind: 'annuity' },
        },
        {
          id: 'b',
          name: 'B',
          ownerId: 'p1',
          startAge: 70,
          annualAmount: dollars(6_000),
          amountBasis: 'nominalAtStart',
          cola: { mode: 'flat' },
          payout: { kind: 'annuity' },
        },
      ]),
    );
    expect(r.rows[0]!.flows.pensions).toBe(dollars(6_000));
    expect(r.rows[2]!.flows.pensions).toBe(dollars(12_000 * 1.02 ** 2 + 6_000));
    expect(r.rows[3]!.flows.pensions).toBe(dollars(12_000 * 1.02 ** 3 + 6_000));
    // Pensions reduce withdrawals one for one (before taxes).
    expect(r.rows[0]!.flows.withdrawals).toBe(dollars(30_000 - 6_000));
    expect(r.rows[0]!.people[0]!.pension).toBe(dollars(6_000));
  });

  it('continues the survivor fraction after the owner’s death; a single owner’s pension stops', () => {
    const couple = build({
      filingStatus: 'marriedFilingJointly',
      people: [person('p1', 70, { planningAge: 72 }), person('p2', 70)] as never,
      accounts: [cash(1_000_000)] as never,
      pensions: [
        {
          id: 'a',
          name: 'A',
          ownerId: 'p1',
          startAge: 65,
          annualAmount: dollars(20_000),
          amountBasis: 'nominalAtStart',
          cola: { mode: 'flat' },
          survivorFraction: 0.5,
          payout: { kind: 'annuity' },
        },
      ] as never,
    });
    const r = project(couple);
    expect(r.rows[2]!.flows.pensions).toBe(dollars(20_000));
    expect(r.rows[3]!.flows.pensions).toBe(dollars(10_000));
    const single = build({
      people: [person('p1', 70, { planningAge: 72 })] as never,
      accounts: [cash(1_000_000)] as never,
      pensions: couple.pensions as never,
    });
    expect(project(single).rows.at(-1)!.year).toBe(YEAR + 2);
  });

  it('deposits a lump sum into its destination in the start year', () => {
    const r = project(
      retiree([
        {
          id: 'l',
          name: 'L',
          ownerId: 'p1',
          startAge: 71,
          annualAmount: 0,
          amountBasis: 'nominalAtStart',
          payout: { kind: 'lumpSum', amount: dollars(50_000), destinationAccountId: 'ira' },
        },
      ]),
    );
    expect(acct(r.rows[1]!, 'ira').contributions).toBe(dollars(50_000));
    expect(r.rows[1]!.flows.oneTimeInflows).toBe(dollars(50_000));
    expect(r.rows[1]!.flows.pensions).toBe(0);
  });

  it('withdraws one-time outflows (also while working) and deposits inflows (destination, fallback, or spent)', () => {
    const h = build({
      people: [person('p1', 50)] as never,
      accounts: [
        cash(100_000),
        { type: 'taxableBrokerage', id: 'tax', name: 'T', ownerId: 'p1', balance: 0, costBasis: 0, expectedReturn: 0 },
      ] as never,
      oneTimeEvents: [
        {
          id: 'roof',
          name: 'Roof',
          year: YEAR + 1,
          direction: 'outflow',
          amount: dollars(20_000),
          amountBasis: 'nominal',
        },
        {
          id: 'inh',
          name: 'Inheritance',
          year: YEAR + 2,
          direction: 'inflow',
          amount: dollars(30_000),
          amountBasis: 'nominal',
        },
      ] as never,
    });
    const r = project(h);
    expect(r.rows[1]!.flows.oneTimeOutflows).toBe(dollars(20_000));
    expect(r.rows[1]!.flows.withdrawals).toBe(dollars(20_000));
    expect(acct(r.rows[1]!, 'cash').end).toBe(dollars(80_000));
    // No destination and surplus "spent": the first taxable brokerage account receives it, with basis.
    expect(acct(r.rows[2]!, 'tax').contributions).toBe(dollars(30_000));
    expect(acct(r.rows[2]!, 'tax').basisEnd).toBe(dollars(30_000));
    const nowhere = project(build({ ...h, accounts: [] as never, oneTimeEvents: h.oneTimeEvents as never }));
    expect(nowhere.warnings.map((w) => w.code)).toContain('oneTimeInflowSpent');
  });
});

describe('Social Security (§7.5)', () => {
  const claimer = (extra: Record<string, unknown> = {}, assumptions: Record<string, unknown> = {}) =>
    build({
      people: [
        person('p1', 66, {
          birthMonth: 4,
          socialSecurity: {
            source: { kind: 'atClaimAge', monthlyAtClaim: dollars(2_000) },
            claimAge: { years: 67, months: 6 },
          },
          ...extra,
        }),
      ] as never,
      accounts: [cash(1_000_000)] as never,
      spending: { retirementAnnualSpending: dollars(40_000) },
      assumptions: { inflation: 0.03, ...assumptions },
    });

  it('pays an entered benefit at the claiming age without any rule values, prorated in the claim year', () => {
    const r = project(claimer());
    expect(r.excludedFeatures).not.toContain('socialSecurityClaiming');
    // Claim year YEAR+1 (age 67), birth month April + 6 months: entitlement from October: 3 months.
    expect(r.rows[0]!.flows.socialSecurity).toBe(0);
    expect(r.rows[1]!.flows.socialSecurity).toBe(dollars(2_000 * 3 * 1.03));
    expect(r.rows[2]!.flows.socialSecurity).toBe(dollars(2_000 * 12 * 1.03 ** 2));
    expect(r.rows[2]!.people[0]!.socialSecurity).toBe(r.rows[2]!.flows.socialSecurity);
    // Benefits stop after the planning age (95).
    expect(r.rows.at(-1)!.flows.socialSecurity).toBeGreaterThan(0);
  });

  it('uses a set COLA rate and the benefit-reduction assumption from its year', () => {
    const r = project(
      claimer(
        {},
        {
          socialSecurity: {
            cola: { mode: 'rate', rate: 0.01 },
            benefitReduction: { fromYear: YEAR + 3, reduction: 0.2 },
          },
        },
      ),
    );
    expect(r.rows[2]!.flows.socialSecurity).toBe(dollars(24_000 * 1.01 ** 2));
    expect(r.rows[3]!.flows.socialSecurity).toBe(dollars(24_000 * 1.01 ** 3 * 0.8));
  });

  it('leaves out spousal and survivor amounts while their rules are unverified (each keeps their own)', () => {
    const ss = (m: number) => ({
      source: { kind: 'atClaimAge', monthlyAtClaim: dollars(m) },
      claimAge: { years: 67, months: 0 },
    });
    const h = build({
      filingStatus: 'marriedFilingJointly',
      people: [
        person('p1', 70, { planningAge: 72, socialSecurity: ss(3_000) }),
        person('p2', 70, { socialSecurity: ss(1_000) }),
      ] as never,
      accounts: [cash(2_000_000)] as never,
      spending: { retirementAnnualSpending: dollars(50_000) },
    });
    const r = project(h);
    expect(r.rows[0]!.flows.socialSecurity).toBe(dollars(48_000));
    // After p1's death only p2's own benefit remains: the survivor step is excluded and labeled.
    expect(r.rows[3]!.flows.socialSecurity).toBe(dollars(12_000));
    expect(r.excludedFeatures).toContain('spousalSurvivorBenefits');
  });

  it('warns about the earnings test when claiming early while working', () => {
    const h = build({
      people: [
        person('p1', 60, {
          employment: { baseSalary: dollars(80_000), raise: { mode: 'nominal', rate: 0 }, stopAge: 66 },
          socialSecurity: {
            source: { kind: 'atClaimAge', monthlyAtClaim: dollars(1_500) },
            claimAge: { years: 62, months: 0 },
          },
        }),
      ] as never,
      accounts: [cash(100_000)] as never,
    });
    expect(project(h).warnings.map((w) => w.code)).toContain('ssClaimBeforeFraWhileWorking');
  });
});

describe('excess income and HSA medical withdrawals (§7.1)', () => {
  it('reinvests income beyond the need in the first taxable account', () => {
    const h = build({
      people: [person('p1', 70)] as never,
      accounts: [
        cash(10_000),
        { type: 'taxableBrokerage', id: 'tax', name: 'T', ownerId: 'p1', balance: 0, costBasis: 0, expectedReturn: 0 },
      ] as never,
      pensions: [
        {
          id: 'a',
          name: 'A',
          ownerId: 'p1',
          startAge: 65,
          annualAmount: dollars(50_000),
          amountBasis: 'nominalAtStart',
          cola: { mode: 'flat' },
          payout: { kind: 'annuity' },
        },
      ] as never,
      spending: { retirementAnnualSpending: dollars(40_000) },
    });
    const r = project(h);
    expect(r.rows[0]!.flows.reinvested).toBe(dollars(10_000));
    expect(acct(r.rows[0]!, 'tax').contributions).toBe(dollars(10_000));
    expect(r.rows[0]!.flows.withdrawals).toBe(0);
  });

  it('pays qualified medical expenses from the HSA first, tax-free', () => {
    const h = build({
      people: [person('p1', 70)] as never,
      accounts: [
        cash(100_000),
        {
          type: 'hsa',
          id: 'hsa',
          name: 'HSA',
          ownerId: 'p1',
          balance: dollars(5_000),
          coverage: 'selfOnly',
          hdhpAttested: false,
          expectedReturn: 0,
        },
      ] as never,
      spending: { retirementAnnualSpending: dollars(20_000), hsaQualifiedMedicalExpenses: dollars(3_000) },
    });
    const r = project(h);
    expect(r.rows[0]!.flows.hsaMedical).toBe(dollars(3_000));
    expect(acct(r.rows[0]!, 'hsa').withdrawals).toBe(dollars(3_000));
    expect(acct(r.rows[0]!, 'cash').withdrawals).toBe(dollars(17_000));
    // Year 2: only $2,000 left in the HSA; the rest comes from cash.
    expect(r.rows[1]!.flows.hsaMedical).toBe(dollars(2_000));
  });
});

describe('taxes in retirement and the gross-up solver (§7.2, synthetic fixture)', () => {
  // Fixture (single, 2026): 10% to $10,000, 20% to $50,000, 30% above; standard deduction $15,000;
  // additional 65+ $2,000; senior deduction $5,000 (phase-out from $70,000 at 6%, sunset 2028).
  const ira = (balance: number, extra: Record<string, unknown> = {}) => ({
    type: 'traditionalIra',
    id: 'ira',
    name: 'IRA',
    ownerId: 'p1',
    balance: dollars(balance),
    expectedReturn: 0,
    ...extra,
  });
  const retiree70 = (accounts: unknown[], need: number, assumptions: Record<string, unknown> = {}) =>
    build({
      people: [person('p1', 70)] as never,
      accounts: accounts as never,
      spending: { retirementAnnualSpending: dollars(need) },
      assumptions,
    });

  it('grosses up a traditional withdrawal so net income equals the need (hand-checked)', () => {
    // W − tax(W) = 40,000 with taxable = W − 22,000 and tax = 1,000 + 20%·(taxable − 10,000):
    // 0.8·W + 5,400 = 40,000 → W = 43,250; tax 3,250.
    // Default tolerance ($1): within a dollar of the exact answer.
    const loose = project(retiree70([ira(1_000_000)], 40_000), fixture).rows[0]!;
    expect(Math.abs(loose.flows.withdrawals - dollars(43_250))).toBeLessThanOrEqual(100);
    // A 1-cent tolerance reaches the exact figures.
    const r = project(
      retiree70([ira(1_000_000)], 40_000, { grossUp: { maxIterations: 50, toleranceCents: 1 } }),
      fixture,
    );
    const row = r.rows[0]!;
    expect(row.flows.withdrawals).toBe(dollars(43_250));
    expect(row.tax?.totalTax).toBe(dollars(3_250));
    expect(row.tax?.taxableIncome).toBe(dollars(21_250));
    expect(row.netIncome).toBe(dollars(40_000));
    expect(row.grossIncome).toBe(dollars(43_250));
    expect(row.tax?.solver.converged).toBe(true);
    expect(row.tax?.solver.iterations).toBeGreaterThan(0);
    expect(r.excludedFeatures).not.toContain('federalIncomeTax');
  });

  it('reports non-convergence when the iteration budget is too small, with the last estimate', () => {
    const r = project(
      retiree70([ira(1_000_000)], 40_000, { grossUp: { maxIterations: 1, toleranceCents: 1 } }),
      fixture,
    );
    expect(r.rows[0]!.tax?.solver.converged).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain('grossUpNotConverged');
  });

  it('caps withdrawals at what is available and reports the unfunded need', () => {
    const r = project(retiree70([ira(10_000)], 40_000), fixture);
    expect(r.rows[0]!.flows.withdrawals).toBe(dollars(10_000));
    expect(r.rows[0]!.depleted).toBe(true);
    expect(r.rows[0]!.flows.shortfall).toBe(dollars(30_000));
  });

  it('takes RMDs from the start age and reinvests what is not needed, after tax', () => {
    // Born 1950 (fixture start age 73), age 76: period (60 − 6)/2 = 27; RMD = 100,000 / 27.
    const h = build({
      people: [person('p1', 76)] as never,
      accounts: [
        ira(100_000),
        { type: 'taxableBrokerage', id: 'tax', name: 'T', ownerId: 'p1', balance: 0, costBasis: 0, expectedReturn: 0 },
      ] as never,
      spending: { retirementAnnualSpending: 0 },
    });
    const r = project(h, fixture);
    const row = r.rows[0]!;
    expect(row.flows.rmd).toBe(dollars(100_000 / 27));
    expect(acct(row, 'ira').rmd).toBe(dollars(100_000 / 27));
    // Taxable income is below the deductions: no tax, so all of it is reinvested.
    expect(row.flows.reinvested).toBe(dollars(100_000 / 27));
    expect(acct(row, 'tax').contributions).toBe(dollars(100_000 / 27));
    expect(r.excludedFeatures).not.toContain('rmd');
    // With the bundled rules RMDs are left out and labeled.
    expect(project(h).excludedFeatures).toContain('rmd');
  });

  it('bracket fill draws traditional money up to the bracket top (deductions included), then the order', () => {
    const accounts = [ira(1_000_000), cash(1_000_000)];
    const fill = { withdrawalStrategy: 'bracketFill', bracketFillTopRate: 0.1 };
    // Room = $10,000 top + $22,000 deductions = $32,000 of traditional money.
    const small = project(retiree70(accounts, 20_000, fill), fixture).rows[0]!;
    expect(acct(small, 'ira').withdrawals).toBe(dollars(20_000));
    expect(acct(small, 'cash').withdrawals).toBe(0);
    // Need 40,000: 32,000 traditional (tax 1,000) + 9,000 cash.
    const big = project(retiree70(accounts, 40_000, fill), fixture).rows[0]!;
    expect(acct(big, 'ira').withdrawals).toBe(dollars(32_000));
    expect(acct(big, 'cash').withdrawals).toBe(dollars(9_000));
    expect(big.tax?.totalTax).toBe(dollars(1_000));
    // Taxable first instead: cash covers it with no tax.
    expect(acct(project(retiree70(accounts, 40_000), fixture).rows[0]!, 'ira').withdrawals).toBe(0);
    // Bundled (unverified) brackets: falls back to taxable first with a warning.
    expect(project(retiree70(accounts, 40_000, fill)).warnings.map((w) => w.code)).toContain(
      'withdrawalStrategyFallback',
    );
  });

  it('files single from the year after the first death, with the survivor’s age', () => {
    const h = build({
      filingStatus: 'marriedFilingJointly',
      people: [person('p1', 70, { planningAge: 71 }), person('p2', 68)] as never,
      accounts: [ira(1_000_000)] as never,
      spending: { retirementAnnualSpending: dollars(40_000) },
    });
    const r = project(h, fixture);
    expect(r.rows[1]!.tax?.filingStatus).toBe('marriedFilingJointly');
    expect(r.rows[2]!.tax?.filingStatus).toBe('marriedFilingJointly');
    expect(r.rows[3]!.tax?.filingStatus).toBe('single');
  });

  it('flags Roth IRA earnings withdrawn before qualification and HSA non-medical use before 65', () => {
    const h = build({
      people: [person('p1', 50, { retirementAge: 50 })] as never,
      accounts: [
        {
          type: 'rothIra',
          id: 'roth',
          name: 'Roth',
          ownerId: 'p1',
          balance: dollars(100_000),
          contributionBasis: dollars(10_000),
          expectedReturn: 0,
        },
        {
          type: 'hsa',
          id: 'hsa',
          name: 'HSA',
          ownerId: 'p1',
          balance: dollars(50_000),
          coverage: 'selfOnly',
          hdhpAttested: false,
          expectedReturn: 0,
        },
      ] as never,
      spending: { retirementAnnualSpending: dollars(30_000) },
      assumptions: { withdrawalStrategy: 'proportional' },
    });
    const codes = project(h, fixture).warnings.map((w) => w.code);
    expect(codes).toContain('rothEarningsWithdrawnEarly');
    expect(codes).toContain('hsaNonMedicalPre65');
  });
});

describe('Social Security with verified (synthetic) SSA rules', () => {
  const statement = (pia: number, claim = { years: 67, months: 0 }) => ({
    source: { kind: 'statement', piaMonthly: dollars(pia) },
    claimAge: claim,
  });

  it('reduces a PIA for claiming at 62 (36 months at 0.5% + 24 at 0.4% = 27.6%)', () => {
    const h = build({
      people: [
        person('p1', 62, { retirementAge: 62, socialSecurity: statement(2_000, { years: 62, months: 0 }) }),
      ] as never,
      accounts: [cash(1_000_000)] as never,
    });
    const r = project(h, fixture);
    expect(r.rows[0]!.flows.socialSecurity).toBe(dollars(2_000 * 0.724 * 12));
    expect(project(h).excludedFeatures).toContain('socialSecurityClaiming');
  });

  it('adds the spousal excess while both are alive and claimed', () => {
    const h = build({
      filingStatus: 'marriedFilingJointly',
      people: [
        person('p1', 67, { socialSecurity: statement(3_000) }),
        person('p2', 67, { socialSecurity: statement(1_000) }),
      ] as never,
      accounts: [cash(2_000_000)] as never,
    });
    const row = project(h, fixture).rows[0]!;
    // p2: own 1,000 + excess max(0, 50% × 3,000 − 1,000) = 500, claimed at FRA.
    expect(row.people[1]!.socialSecurity).toBe(dollars(1_500 * 12));
    expect(row.people[0]!.socialSecurity).toBe(dollars(3_000 * 12));
  });

  it('survivor orderings: the survivor receives the higher benefit whichever spouse dies first', () => {
    const couple = (p1Planning: number, p2Planning: number) =>
      build({
        filingStatus: 'marriedFilingJointly',
        people: [
          person('p1', 67, { planningAge: p1Planning, socialSecurity: statement(3_000) }),
          person('p2', 67, { planningAge: p2Planning, socialSecurity: statement(1_000) }),
        ] as never,
        accounts: [cash(3_000_000)] as never,
      });
    // Higher earner (p1) dies first: p2 steps up to 3,000 a month.
    const a = project(couple(70, 90), fixture);
    expect(a.rows[4]!.people[1]!.socialSecurity).toBe(dollars(3_000 * 12));
    expect(a.rows[4]!.people[0]!.socialSecurity).toBe(0);
    // Lower earner (p2) dies first: p1 keeps 3,000 (higher of own and the deceased's).
    const b = project(couple(90, 70), fixture);
    expect(b.rows[4]!.people[0]!.socialSecurity).toBe(dollars(3_000 * 12));
    expect(b.rows[4]!.people[1]!.socialSecurity).toBe(0);
    // Equal planning ages: both die after the horizon; spousal continues to the end.
    const c = project(couple(90, 90), fixture);
    expect(c.rows.at(-1)!.people[1]!.socialSecurity).toBe(dollars(1_500 * 12));
  });
});
