/**
 * Projection invariants as fast-check properties (gates M3 and M4, docs/financial-model.md §1.3,
 * §1.5, §5–§7, §9). Generated households are small (1–2 people, ≤ 4 accounts, ≤ 40 years) and include
 * the M4 inputs: entered (atClaimAge) and statement Social Security, pensions (annuities and lump
 * sums), one-time inflows and outflows, other income, spending steps, glide, healthcare, survivor
 * reduction and HSA medical expenses. Most properties run with the bundled rules (every value
 * unverified: workplace contributions before limits, no taxes, §1.7); the tax and gross-up
 * properties run with the PINNED SYNTHETIC fixture rules (`testing/fixtureRules.ts`). Seeds are fixed
 * so CI is deterministic.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { HouseholdSchema, RULES, projectHousehold, type Household, type HouseholdInput } from '../index';
import type { ProjectionResult } from '../index';
import { fixtureRules } from '../testing/fixtureRules';

const YEAR = 2026;
const CTX = { currentYear: YEAR, rules: RULES };
const FIXTURE_CTX = { currentYear: YEAR, rules: fixtureRules() };

const CMA = {
  stocks: { geometricReturn: 0.07, volatility: 0.16 },
  bonds: { geometricReturn: 0.045, volatility: 0.06 },
  cash: { geometricReturn: 0.03, volatility: 0.01 },
  correlation: [
    [1, 0.1, 0],
    [0.1, 1, 0.2],
    [0, 0.2, 1],
  ],
  blendedVolatility: 0.12,
  note: 'Property-test assumptions.',
};

/** Rounded to 4 decimals so shrunk counterexamples are readable. */
const rate = (min: number, max: number) =>
  fc.integer({ min: Math.round(min * 10_000), max: Math.round(max * 10_000) }).map((x) => x / 10_000);
const money = (maxDollars: number) => fc.integer({ min: 0, max: maxDollars }).map((x) => x * 100);

interface ReturnRange {
  min: number;
  max: number;
}

interface ArbOptions {
  /** Spending upper bound in dollars (higher values bias towards depletion). */
  spendingMax?: number;
  /** Everyone already retired (no salary, no workplace plans; part-time pay allowed). */
  retired?: boolean;
}

const growthMode = (r: ReturnRange) =>
  fc.oneof(
    fc.constant({ mode: 'flat' }),
    fc.constant({ mode: 'inflation' }),
    rate(Math.max(-0.05, r.min), 0.08).map((x) => ({ mode: 'rate', rate: x })),
  );

const schedule = (r: ReturnRange) =>
  fc.record({
    amount: fc.oneof(
      fc.record({
        kind: fc.constant('dollars'),
        amount: money(20_000),
        frequency: fc.constantFrom('annual', 'monthly'),
      }),
      fc.record({ kind: fc.constant('percentOfSalary'), pct: rate(0, 0.2) }),
    ),
    growth: growthMode(r),
    startYear: fc.option(fc.integer({ min: YEAR, max: YEAR + 10 }), { nil: null }),
    stopYear: fc.option(fc.integer({ min: YEAR + 10, max: YEAR + 45 }), { nil: null }),
  });

const accountReturn = (r: ReturnRange) => fc.option(rate(r.min, r.max), { nil: null, freq: 3 });

/** One non-workplace account owned by `owner`. */
const account = (id: string, owner: string, r: ReturnRange) =>
  fc
    .record({
      type: fc.constantFrom('cash', 'taxableBrokerage', 'traditionalIra', 'rothIra', 'hsa'),
      balance: money(800_000),
      basisShare: rate(0, 1),
      expectedReturn: accountReturn(r),
      expenseRatio: rate(0, 0.02),
      contribution: fc.option(schedule(r), { nil: null }),
      hdhpAttested: fc.boolean(),
      firstContributionYear: fc.option(fc.integer({ min: 1990, max: YEAR }), { nil: null }),
    })
    .map((a) => {
      const base = {
        id,
        name: id,
        ownerId: owner,
        type: a.type,
        balance: a.balance,
        expectedReturn: a.expectedReturn,
        expenseRatio: a.expenseRatio,
        contribution: a.contribution,
      };
      const basis = Math.floor(a.balance * a.basisShare);
      if (a.type === 'taxableBrokerage') return { ...base, costBasis: basis };
      if (a.type === 'rothIra')
        return { ...base, contributionBasis: basis, firstContributionYear: a.firstContributionYear };
      if (a.type === 'hsa') return { ...base, coverage: 'selfOnly', hdhpAttested: a.hdhpAttested };
      return base;
    });

/** Social Security: none, an entered benefit at the claiming age (rule-free), or a statement PIA. */
const socialSecurityArb = fc
  .record({
    kind: fc.constantFrom('none', 'atClaimAge', 'atClaimAge', 'statement'),
    monthly: money(4_000),
    years: fc.integer({ min: 62, max: 70 }),
    months: fc.integer({ min: 0, max: 11 }),
  })
  .map((s) => {
    const claimAge = { years: s.years, months: s.years === 70 ? 0 : s.months };
    if (s.kind === 'none') return { source: { kind: 'none' }, claimAge };
    if (s.kind === 'atClaimAge') return { source: { kind: 'atClaimAge', monthlyAtClaim: s.monthly }, claimAge };
    return { source: { kind: 'statement', piaMonthly: s.monthly }, claimAge };
  });

const personArb = (id: string, r: ReturnRange, opts: ArbOptions) =>
  fc
    .record({
      age: opts.retired ? fc.integer({ min: 55, max: 85 }) : fc.integer({ min: 25, max: 80 }),
      yearsToRetire: opts.retired ? fc.integer({ min: -10, max: 0 }) : fc.integer({ min: -10, max: 25 }),
      yearsAfter: fc.integer({ min: 0, max: 30 }),
      birthMonth: fc.integer({ min: 1, max: 12 }),
      socialSecurity: socialSecurityArb,
      employment: fc.option(
        fc.record({
          baseSalary: opts.retired ? fc.constant(0) : money(300_000),
          raise: fc.oneof(
            rate(-0.05, 0.1).map((x) => ({ mode: 'nominal', rate: x })),
            rate(-0.03, 0.05).map((x) => ({ mode: 'inflationPlus', realRate: x })),
          ),
          bonus: opts.retired
            ? fc.constant({ kind: 'none' })
            : fc.oneof(
                fc.constant({ kind: 'none' }),
                rate(0, 1.5).map((x) => ({ kind: 'percentOfSalary', pct: x })),
                money(50_000).map((x) => ({ kind: 'fixed', amount: x })),
              ),
          bonusCountsForDeferrals: fc.boolean(),
          bonusCountsForMatch: fc.boolean(),
          partTime: fc.option(
            fc.record({
              startOffset: fc.integer({ min: 0, max: 5 }),
              length: fc.integer({ min: 1, max: 5 }),
              annualIncome: money(40_000),
            }),
            { nil: null },
          ),
        }),
        { nil: null, freq: 4 },
      ),
      plan: fc.option(
        fc.record({
          traditionalPctOfSalary: rate(0, 0.2),
          traditionalPctOfBonus: rate(0, 0.2),
          tiers: fc.array(fc.record({ matchRate: rate(0, 1.5), bandPctOfPay: rate(0, 0.06) }), { maxLength: 2 }),
          flatPctOfPay: rate(0, 0.05),
          annualMatchCap: fc.option(money(10_000), { nil: null }),
          vesting: fc.oneof(
            fc.constant({ kind: 'immediate' }),
            fc.integer({ min: 1, max: 6 }).map((years) => ({ kind: 'cliff', years })),
            fc.constant({ kind: 'graded', vestedByYear: [0, 0.2, 0.4, 0.6, 0.8, 1] }),
          ),
          yearsOfServiceAtStart: fc.integer({ min: 0, max: 6 }),
          autoEscalation: fc.option(
            fc.record({ stepPct: rate(0, 0.02), capPct: rate(0, 0.15), appliesTo: fc.constant('traditional') }),
            { nil: null },
          ),
          balance: money(500_000),
          unvestedShare: rate(0, 0.3),
          expectedReturn: accountReturn(r),
          expenseRatio: rate(0, 0.01),
        }),
        { nil: null },
      ),
    })
    .map((p) => {
      const birthYear = YEAR - p.age;
      const retirementAge = Math.max(0, p.age + p.yearsToRetire);
      const planningAge = Math.max(retirementAge, p.age) + p.yearsAfter;
      const employment =
        p.employment === null
          ? null
          : {
              baseSalary: p.employment.baseSalary,
              raise: p.employment.raise,
              bonus: p.employment.bonus,
              bonusCountsForDeferrals: p.employment.bonusCountsForDeferrals,
              bonusCountsForMatch: p.employment.bonusCountsForMatch,
              partTime:
                p.employment.partTime === null
                  ? null
                  : {
                      startAge: retirementAge + p.employment.partTime.startOffset,
                      endAge: retirementAge + p.employment.partTime.startOffset + p.employment.partTime.length,
                      annualIncome: p.employment.partTime.annualIncome,
                    },
            };
      const planAccounts = [];
      const plans = [];
      if (p.plan !== null && employment !== null && !opts.retired) {
        const kId = `${id}-k`;
        planAccounts.push({
          type: 'workplaceTraditional',
          planType: '401k',
          id: kId,
          name: kId,
          ownerId: id,
          balance: p.plan.balance,
          unvestedEmployerBalance: Math.floor(p.plan.balance * p.plan.unvestedShare),
          expectedReturn: p.plan.expectedReturn,
          expenseRatio: p.plan.expenseRatio,
        });
        let used = 0;
        const tiers = p.plan.tiers.filter((t) => (used += t.bandPctOfPay) <= 1);
        plans.push({
          id: `${id}-plan`,
          planType: '401k',
          traditionalAccountId: kId,
          traditionalPctOfSalary: p.plan.traditionalPctOfSalary,
          traditionalPctOfBonus: p.plan.traditionalPctOfBonus,
          autoEscalation: p.plan.autoEscalation,
          match: {
            tiers,
            flatPctOfPay: p.plan.flatPctOfPay,
            annualMatchCap: p.plan.annualMatchCap,
            vesting: p.plan.vesting,
            yearsOfServiceAtStart: p.plan.yearsOfServiceAtStart,
          },
        });
      }
      return {
        person: {
          id,
          name: id,
          birthYear,
          birthMonth: p.birthMonth,
          retirementAge,
          planningAge,
          employment,
          workplacePlans: plans,
          socialSecurity: p.socialSecurity,
        },
        planAccounts,
      };
    });

const pensionArb = fc.record({
  owner: fc.constantFrom(0, 1),
  startOffset: fc.integer({ min: -5, max: 15 }),
  amount: money(40_000),
  basis: fc.constantFrom('todaysDollars', 'nominalAtStart'),
  cola: fc.oneof(
    fc.constant({ mode: 'flat' }),
    fc.constant({ mode: 'inflation' }),
    rate(0, 0.03).map((x) => ({ mode: 'rate', rate: x })),
  ),
  taxableFraction: rate(0, 1),
  survivorFraction: rate(0, 1),
  lumpSum: fc.boolean(),
  lumpAmount: money(200_000),
  destination: fc.nat(),
});

const eventArb = fc.record({
  yearOffset: fc.integer({ min: 0, max: 39 }),
  direction: fc.constantFrom('inflow', 'outflow'),
  amount: money(100_000),
  basis: fc.constantFrom('todaysDollars', 'nominal'),
  taxTreatment: fc.constantFrom('none', 'ordinaryIncome', 'capitalGain'),
  gainFraction: rate(0, 1),
  destination: fc.option(fc.nat(), { nil: null }),
});

const otherIncomeArb = fc.record({
  owner: fc.option(fc.constantFrom(0, 1), { nil: null }),
  startOffset: fc.integer({ min: 0, max: 20 }),
  length: fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
  amount: money(30_000),
  growth: fc.oneof(
    fc.constant({ mode: 'flat' }),
    fc.constant({ mode: 'inflation' }),
    rate(0, 0.04).map((x) => ({ mode: 'rate', rate: x })),
  ),
  taxableFraction: rate(0, 1),
});

const INFLOW_TYPES = new Set(['taxableBrokerage', 'cash']);

function householdArb(r: ReturnRange = { min: -0.3, max: 0.3 }, opts: ArbOptions = {}) {
  const spendingMax = opts.spendingMax ?? 150_000;
  return fc
    .record({
      couple: fc.boolean(),
      p1: personArb('p1', r, opts),
      p2: personArb('p2', r, opts),
      accounts: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
      accountArbs: fc.tuple(account('a0', 'p1', r), account('a1', 'p2', r), account('a2', 'p1', r)),
      current: money(spendingMax),
      retirement: money(spendingMax),
      inflation: rate(-0.02, 0.08),
      pre: rate(Math.max(r.min, -0.05), Math.min(r.max, 0.12)),
      post: rate(Math.max(r.min, -0.05), Math.min(r.max, 0.12)),
      timing: fc.constantFrom('midYear', 'startOfYear'),
      granularity: fc.constantFrom('annual', 'monthly'),
      strategy: fc.constantFrom('taxableFirst', 'traditionalFirst', 'rothLast', 'proportional', 'bracketFill'),
      bracketFillTopRate: fc.constantFrom(0.1, 0.2),
      drag: rate(0, 0.02),
      stateTaxRate: rate(0, 0.08),
      shock: fc.option(
        fc.record({
          startYear: fc.integer({ min: YEAR, max: YEAR + 30 }),
          returns: fc.array(rate(r.min < 0 ? -0.5 : 0, r.max), { minLength: 1, maxLength: 3 }),
        }),
        { nil: null, freq: 4 },
      ),
      pensions: fc.array(pensionArb, { maxLength: 2 }),
      events: fc.array(eventArb, { maxLength: 3 }),
      otherIncome: fc.array(otherIncomeArb, { maxLength: 1 }),
      steps: fc.array(fc.record({ fromAge: fc.integer({ min: 50, max: 95 }), annualSpending: money(spendingMax) }), {
        maxLength: 2,
      }),
      glide: rate(-0.03, 0.02),
      healthcare: money(15_000),
      survivorReduction: rate(0, 0.5),
      hsaMedical: money(5_000),
      ssCola: fc.oneof(
        fc.constant({ mode: 'inflation' }),
        rate(0, 0.03).map((x) => ({ mode: 'rate', rate: x })),
      ),
      ssReduction: fc.option(
        fc.record({ fromYear: fc.integer({ min: YEAR, max: YEAR + 30 }), reduction: rate(0, 0.3) }),
        { nil: null, freq: 3 },
      ),
    })
    .map((g): HouseholdInput => {
      const people = g.couple ? [g.p1, g.p2] : [g.p1];
      // Keep the horizon ≤ 40 rows: clamp each planning age to the horizon of the first person.
      const lastYear = YEAR + 39;
      for (const p of people) {
        p.person.planningAge = Math.min(p.person.planningAge, lastYear - p.person.birthYear);
        p.person.retirementAge = Math.min(p.person.retirementAge, p.person.planningAge);
      }
      const owners = people.map((p) => p.person.id);
      const accounts = [
        ...g.accountArbs
          .slice(0, g.accounts.length)
          .map((a) => ({ ...a, ownerId: owners.includes(a.ownerId) ? a.ownerId : 'p1' })),
        ...people.flatMap((p) => p.planAccounts),
      ] as { id: string; type: string; ownerId: string }[];
      const pensions = g.pensions.map((pn, i) => {
        const owner = people[pn.owner % people.length]!.person;
        const startAge = Math.min(120, Math.max(0, YEAR - owner.birthYear + pn.startOffset));
        const base = {
          id: `pension-${i}`,
          name: `Pension ${i}`,
          ownerId: owner.id,
          startAge,
          amountBasis: pn.basis,
          cola: pn.cola,
          taxableFraction: pn.taxableFraction,
          survivorFraction: pn.survivorFraction,
        };
        // A lump sum goes to the owner's own traditional account, or to a taxable or cash account.
        const destinations = accounts.filter(
          (a) =>
            INFLOW_TYPES.has(a.type) ||
            ((a.type === 'traditionalIra' || a.type === 'workplaceTraditional') && a.ownerId === owner.id),
        );
        if (pn.lumpSum && destinations.length > 0) {
          const dest = destinations[pn.destination % destinations.length]!;
          return {
            ...base,
            annualAmount: 0,
            payout: { kind: 'lumpSum', amount: pn.lumpAmount, destinationAccountId: dest.id },
          };
        }
        return { ...base, annualAmount: pn.amount, payout: { kind: 'annuity' } };
      });
      const inflowDestinations = accounts.filter((a) => INFLOW_TYPES.has(a.type));
      const oneTimeEvents = g.events.map((e, i) => ({
        id: `event-${i}`,
        name: `Event ${i}`,
        year: YEAR + e.yearOffset,
        direction: e.direction,
        amount: e.amount,
        amountBasis: e.basis,
        taxTreatment: e.taxTreatment,
        gainFraction: e.gainFraction,
        destinationAccountId:
          e.direction === 'inflow' && e.destination !== null && inflowDestinations.length > 0
            ? inflowDestinations[e.destination % inflowDestinations.length]!.id
            : null,
      }));
      const otherIncome = g.otherIncome.map((o, i) => ({
        id: `income-${i}`,
        name: `Income ${i}`,
        ownerId: o.owner === null ? null : people[o.owner % people.length]!.person.id,
        startYear: YEAR + o.startOffset,
        endYear: o.length === null ? null : YEAR + o.startOffset + o.length,
        annualAmount: o.amount,
        growth: o.growth,
        taxableFraction: o.taxableFraction,
      }));
      const steps = g.steps.filter((s, i) => g.steps.findIndex((x) => x.fromAge === s.fromAge) === i);
      return {
        id: 'h',
        name: 'Generated',
        filingStatus: g.couple ? 'marriedFilingJointly' : 'single',
        people: people.map((p) => p.person),
        accounts,
        pensions,
        oneTimeEvents,
        otherIncome,
        spending: {
          currentAnnualSpending: g.current,
          retirementAnnualSpending: g.retirement,
          steps,
          retirementRealGlide: g.glide,
          healthcareBeforeMedicare: g.healthcare,
          survivorSpendingReduction: g.survivorReduction,
          hsaQualifiedMedicalExpenses: g.hsaMedical,
        },
        assumptions: {
          inflation: g.inflation,
          returnPreRetirement: g.pre,
          returnPostRetirement: g.post,
          capitalMarket: CMA,
          rules: { anchorYear: YEAR },
          withdrawalTiming: g.timing,
          granularity: g.granularity,
          withdrawalStrategy: g.strategy,
          bracketFillTopRate: g.bracketFillTopRate,
          taxableAccountTaxDrag: g.drag,
          stateTaxRate: g.stateTaxRate,
          marketShock: g.shock,
          socialSecurity: { cola: g.ssCola, benefitReduction: g.ssReduction },
        },
      } as unknown as HouseholdInput;
    });
}

function project(h: Household, returnOffset = 0, ctx: typeof CTX = CTX): ProjectionResult {
  const r = projectHousehold(h, ctx, { returnOffset });
  if (r.status !== 'ok') throw new Error(`projection ${r.status}: ${JSON.stringify(r)}`);
  return r.value;
}

const parse = (input: HouseholdInput): Household => HouseholdSchema.parse(input);

/**
 * Independent recomputation of the rule-free M4 income flows from the inputs and the docs
 * (bundled rules: no spousal or survivor benefits, §7.5; §7.6 pensions and one-time events). Each
 * person's entered benefit, the household pension total and the one-time flows must match within a
 * cent per item. Returns a description of the first mismatch, or null.
 */
function m4FlowMismatch(h: Household, r: ProjectionResult): string | null {
  const deflators = new Map(r.rows.map((row) => [row.year as number, row.deflator]));
  const near = (expected: number, actual: number, items = 1) => Math.abs(Math.round(expected) - actual) <= items;
  const { cola, benefitReduction } = h.assumptions.socialSecurity;
  for (const [t, row] of r.rows.entries()) {
    const P = row.deflator;
    // §7.5: entered benefit × months of entitlement × COLA index × the reduction assumption.
    for (const [k, p] of h.people.entries()) {
      const ss = p.socialSecurity;
      if (ss.source.kind !== 'atClaimAge') continue;
      const alive = row.people[k]!.alive;
      const claimYear = p.birthYear + ss.claimAge.years;
      const months =
        !alive || row.year < claimYear
          ? 0
          : row.year === claimYear
            ? Math.max(0, 12 - (p.birthMonth - 1 + ss.claimAge.months))
            : 12;
      const index = cola.mode === 'inflation' ? P : Math.pow(1 + cola.rate, t);
      const cut =
        benefitReduction !== null && row.year >= benefitReduction.fromYear ? 1 - benefitReduction.reduction : 1;
      const expected = months * ss.source.monthlyAtClaim * index * cut;
      if (!near(expected, row.people[k]!.socialSecurity))
        return `${row.year} ${p.id}: social security ${row.people[k]!.socialSecurity} vs ${expected.toFixed(1)}`;
    }
    // §7.6: annuities from the start age (today's dollars × P_s or nominal), grown by their COLA;
    // the survivor fraction continues to a living spouse. Lump sums and inflows are deposits.
    let pensions = 0;
    let checkable = true;
    let inflows = 0;
    let items = 0;
    for (const pn of h.pensions) {
      const k = h.people.findIndex((p) => p.id === pn.ownerId);
      const owner = h.people[k]!;
      const start = owner.birthYear + pn.startAge;
      const ownerAlive = row.people[k]!.alive;
      if (row.year < start) continue;
      items++;
      if (pn.payout.kind === 'lumpSum') {
        if (row.year === start) {
          if (!ownerAlive) checkable = false;
          inflows += pn.payout.amount;
        }
        continue;
      }
      const ownerDeath = owner.birthYear + owner.planningAge + 1;
      const Ps = deflators.get(start);
      if (Ps === undefined || ownerDeath <= start) {
        // Started before year 1 or owner died first: the docs leave the base unclear; skip.
        checkable = false;
        continue;
      }
      const amount0 = pn.annualAmount * (pn.amountBasis === 'todaysDollars' ? Ps : 1);
      const amount =
        pn.cola.mode === 'flat'
          ? amount0
          : pn.cola.mode === 'inflation'
            ? (amount0 * P) / Ps
            : amount0 * Math.pow(1 + pn.cola.rate, row.year - start);
      if (ownerAlive) pensions += amount;
      else if (h.people.length === 2 && row.people[1 - k]!.alive) pensions += amount * pn.survivorFraction;
    }
    if (checkable && !near(pensions, row.flows.pensions, items))
      return `${row.year}: pensions ${row.flows.pensions} vs ${pensions.toFixed(1)}`;
    let outflows = 0;
    for (const e of h.oneTimeEvents) {
      if (e.year !== row.year) continue;
      items++;
      const amount = e.amount * (e.amountBasis === 'todaysDollars' ? P : 1);
      if (e.direction === 'outflow') outflows += amount;
      else inflows += amount;
    }
    if (!near(outflows, row.flows.oneTimeOutflows, items))
      return `${row.year}: one-time outflows ${row.flows.oneTimeOutflows} vs ${outflows.toFixed(1)}`;
    if (checkable && !near(inflows, row.flows.oneTimeInflows, items))
      return `${row.year}: one-time inflows ${row.flows.oneTimeInflows} vs ${inflows.toFixed(1)}`;
    // Household totals are sums of the per-person and per-account figures (§1.3).
    const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
    if (Math.abs(sum(row.people.map((p) => p.socialSecurity)) - row.flows.socialSecurity) > row.people.length)
      return `${row.year}: SS total`;
    if (sum(row.accounts.map((a) => a.withdrawals - a.forfeited)) !== row.flows.withdrawals)
      return `${row.year}: withdrawals total`;
    if (sum(row.accounts.map((a) => a.rmd)) !== row.flows.rmd) return `${row.year}: rmd total`;
    if (sum(row.accounts.map((a) => a.contributions)) !== row.flows.contributions)
      return `${row.year}: contributions total`;
  }
  return null;
}

/** No negative balance, basis or flow; shortfall ≥ 0 and funded ≤ need (§1.5 caps, §4.1). */
function assertNonNegative(r: ProjectionResult): void {
  for (const row of r.rows) {
    for (const a of row.accounts) {
      if (a.start < 0 || a.end < 0 || a.basisEnd < 0 || a.withdrawals < 0 || a.contributions < 0 || a.rmd < 0) {
        throw new Error(`${row.year} ${a.accountId}: negative figure ${JSON.stringify(a)}`);
      }
    }
    const f = row.flows;
    const flows = [f.hsaMedical, f.reinvested, f.socialSecurity, f.pensions, f.oneTimeInflows, f.oneTimeOutflows];
    if (flows.some((x) => x < 0)) throw new Error(`${row.year}: negative M4 flow ${JSON.stringify(f)}`);
    if (f.shortfall < 0 || f.spendingFunded > f.spendingNeed + 1) {
      throw new Error(`${row.year}: shortfall/funded ${JSON.stringify(f)}`);
    }
  }
}

describe('projection properties (fast-check, fixed seeds)', () => {
  it('generated households are valid and short', () => {
    fc.assert(
      fc.property(householdArb(), (input) => {
        const h = parse(input);
        const r = project(h);
        expect(r.rows.length).toBeGreaterThanOrEqual(1);
        expect(r.rows.length).toBeLessThanOrEqual(40);
      }),
      { numRuns: 200, seed: 7 },
    );
  });

  it('reconciles every account row within ±1 cent, carries end → next start, and every end balance matches an independent recomputation within 3 cents, with M4 pensions, events and SS in the generator (10,000 runs)', () => {
    fc.assert(
      fc.property(householdArb(), (input) => {
        const h = parse(input);
        const r = project(h);
        const accounts = new Map(h.accounts.map((acc) => [acc.id, acc]));
        const { withdrawalTiming: timing, granularity, taxableAccountTaxDrag: drag } = h.assumptions;
        r.rows.forEach((row, i) => {
          for (const a of row.accounts) {
            // Independent of the engine's reconciling item: recompute the year-end balance and the fee
            // drag from the applied return with the §1.5 factors written out here (docs, not engine code).
            const acc = accounts.get(a.accountId)!;
            const taxable = acc.type === 'taxableBrokerage' || (acc.type === 'other' && acc.taxTreatment === 'taxable');
            const rho = Math.max((1 + a.appliedReturn) * (1 - acc.expenseRatio) - 1 - (taxable ? drag : 0), -0.99);
            const S = (a.start - a.forfeited) / 100;
            const C = a.contributions / 100;
            const W = (a.withdrawals - a.forfeited) / 100;
            const endFor = (rate: number) => {
              const gS = 1 + rate;
              let gC: number;
              let gW: number;
              if (granularity === 'annual') {
                gC = Math.sqrt(1 + rate);
                gW = timing === 'midYear' ? gC : gS;
              } else {
                const rm = Math.pow(1 + rate, 1 / 12) - 1;
                gC = Math.abs(rm) < 1e-15 ? 1 : rate / (12 * rm);
                gW = timing === 'midYear' ? gC : gC * (1 + rm);
              }
              return gS * S + gC * C - gW * W;
            };
            const expectedEnd = Math.max(0, endFor(rho));
            if (Math.abs(expectedEnd * 100 - a.end) > 3) {
              throw new Error(
                `${row.year} ${a.accountId}: end ${a.end} vs recomputed ${(expectedEnd * 100).toFixed(1)}`,
              );
            }
            if (expectedEnd > 0) {
              const expectedFee = endFor(a.appliedReturn) - endFor(rho);
              if (Math.abs(expectedFee * 100 - a.feeDrag) > 3) {
                throw new Error(
                  `${row.year} ${a.accountId}: fee drag ${a.feeDrag} vs recomputed ${(expectedFee * 100).toFixed(1)}`,
                );
              }
            }
            const gap = a.start + a.contributions + a.growthNet - a.withdrawals - a.end;
            if (Math.abs(gap) > 1) throw new Error(`${row.year} ${a.accountId}: off by ${gap} cents`);
            if (a.growthGross !== a.growthNet + a.feeDrag) throw new Error(`${row.year} ${a.accountId}: fee split`);
            const prior = r.rows[i - 1]?.accounts.find((x) => x.accountId === a.accountId);
            if (prior && prior.end !== a.start) throw new Error(`${row.year} ${a.accountId}: start ≠ prior end`);
          }
          const sum = row.accounts.reduce((s, a) => s + a.end, 0);
          if (Math.abs(sum - row.totals.portfolioEnd) > 1) throw new Error(`${row.year}: totals`);
        });
      }),
      { numRuns: 10_000, seed: 20_261_019 },
    );
  }, 120_000);

  it('entered Social Security, pensions, lump sums and one-time flows match the §7.5/§7.6 formulas recomputed here (2,000 runs)', () => {
    fc.assert(
      fc.property(householdArb(), (input) => {
        const h = parse(input);
        const m4 = m4FlowMismatch(h, project(h));
        if (m4 !== null) throw new Error(m4);
      }),
      { numRuns: 2_000, seed: 5_005 },
    );
  }, 60_000);

  it('never produces a negative balance or basis, including after depletion, with M4 inflows, outflows and pensions', () => {
    // Spending up to $400k biases the generator towards depletion.
    fc.assert(
      fc.property(householdArb({ min: -0.3, max: 0.3 }, { spendingMax: 400_000 }), (input) => {
        assertNonNegative(project(parse(input)));
      }),
      { numRuns: 1_000, seed: 424_242 },
    );
  }, 60_000);

  it('conservative (start-of-year) ending balances ≤ default (mid-year) when every net annual return is ≥ 0', () => {
    // §1.5: the ordering holds only when every annual return is ≥ 0. The condition is on the NET rate
    // ρ = (1+r)(1−f) − 1 (− tax drag): an expense ratio on a 0% return makes ρ < 0, so such paths are
    // skipped rather than asserted.
    let asserted = 0;
    fc.assert(
      fc.property(householdArb({ min: 0, max: 0.15 }), (input) => {
        const h = parse(input);
        const withTiming = (withdrawalTiming: 'midYear' | 'startOfYear') =>
          project(parse({ ...input, assumptions: { ...input.assumptions, withdrawalTiming } }));
        const def = withTiming('midYear');
        // With M4 deposits (lump sums, inflows) a start-of-year withdrawal cannot reach money that
        // arrives mid-year (§1.5 cap = S), so a depleting conservative run can end with that deposit
        // untouched. The §1.5 ordering compares equal withdrawals: depleting paths are skipped.
        const fees = new Map(h.accounts.map((a) => [a.id as string, a]));
        const allNonNegative = def.rows.every((row) =>
          row.accounts.every((a) => {
            const acc = fees.get(a.accountId)!;
            const drag = acc.type === 'taxableBrokerage' ? h.assumptions.taxableAccountTaxDrag : 0;
            return (1 + a.appliedReturn) * (1 - acc.expenseRatio) - 1 - drag >= 0;
          }),
        );
        if (!allNonNegative) return;
        const cons = withTiming('startOfYear');
        if (def.summary.depletionYear !== null || cons.summary.depletionYear !== null) return;
        asserted++;
        def.rows.forEach((row, i) => {
          if (cons.rows[i]!.totals.portfolioEnd > row.totals.portfolioEnd) {
            throw new Error(
              `${row.year}: conservative ${cons.rows[i]!.totals.portfolioEnd} > ${row.totals.portfolioEnd}`,
            );
          }
        });
      }),
      { numRuns: 1_000, seed: 1_717 },
    );
    expect(asserted).toBeGreaterThan(100);
  }, 60_000);

  it('higher contributions never reduce the balance at retirement (accumulation only)', () => {
    fc.assert(
      fc.property(householdArb(), money(10_000), rate(0, 0.05), (input, extraDollars, extraPct) => {
        const base = parse(input);
        const more = parse({
          ...input,
          accounts: (input.accounts ?? []).map((a) => {
            const c = (a as { contribution?: { amount: Record<string, unknown> } | null }).contribution;
            if (!c) return a;
            const amount =
              c.amount.kind === 'dollars'
                ? { ...c.amount, amount: (c.amount.amount as number) + extraDollars }
                : { ...c.amount, pct: Math.min(1, (c.amount.pct as number) + extraPct) };
            return { ...a, contribution: { ...c, amount } };
          }),
          people: input.people.map((p) => ({
            ...p,
            workplacePlans: (p.workplacePlans ?? []).map((w) => ({
              ...w,
              traditionalPctOfSalary: Math.min(1, (w.traditionalPctOfSalary ?? 0) + extraPct),
            })),
          })),
        } as unknown as HouseholdInput);
        const a = project(base);
        const b = project(more);
        const at = (r: ProjectionResult) => r.rows.find((row) => row.year === r.summary.retirementYear)!;
        expect(at(b).totals.portfolioStart).toBeGreaterThanOrEqual(at(a).totals.portfolioStart);
      }),
      { numRuns: 500, seed: 99 },
    );
  }, 60_000);

  it('optimistic ≥ baseline ≥ pessimistic in every year when nothing depletes (fixed return offsets, §9)', () => {
    // §9 offsets shift every account's nominal return by the same amount. Every growth factor and
    // withdrawal cap rises with the return, and withdrawals are fixed by the spending need, so each
    // account's balance is monotone in the offset (the tests do not rely on depletion paths).
    let asserted = 0;
    fc.assert(
      fc.property(householdArb(), (input) => {
        const h = parse(input);
        const { optimistic, pessimistic } = h.assumptions.deterministicOffsets;
        const [hi, mid, lo] = [project(h, optimistic), project(h), project(h, pessimistic)];
        if ([hi, mid, lo].some((r) => r.summary.depletionYear !== null)) return;
        asserted++;
        mid.rows.forEach((row, i) => {
          const [a, b, c] = [hi.rows[i]!, row, lo.rows[i]!].map((x) => x.totals.portfolioEnd);
          if (!(a! >= b! && b! >= c!)) throw new Error(`${row.year}: ${a} / ${b} / ${c}`);
        });
      }),
      { numRuns: 500, seed: 31_337 },
    );
    expect(asserted).toBeGreaterThan(50);
  }, 60_000);
});

describe('M4 tax and gross-up properties with the synthetic fixture rules (fast-check, fixed seeds)', () => {
  const projectFixture = (input: HouseholdInput) => project(parse(input), 0, FIXTURE_CTX);
  /** A retirement row whose withdrawals could not have hit every cap: nothing contributed, money left. */
  const notExhausted = (row: ProjectionResult['rows'][number]) =>
    row.flows.contributions === 0 && row.totals.portfolioEnd > 100;

  it('taxes are never negative (generated retirees with SS, pensions, one-time events and withdrawals)', () => {
    let rows = 0;
    fc.assert(
      fc.property(householdArb({ min: -0.2, max: 0.2 }, { retired: true, spendingMax: 200_000 }), (input) => {
        const r = projectFixture(input);
        for (const row of r.rows) {
          if (row.tax === null) throw new Error(`${row.year}: taxes missing with verified rules`);
          rows++;
          for (const [key, value] of Object.entries(row.tax)) {
            if (typeof value === 'number' && value < 0) throw new Error(`${row.year}: tax.${key} = ${value}`);
          }
          const t = row.tax;
          const parts = t.federalOrdinaryTax + t.capitalGainsTax + t.ficaSocialSecurity + t.ficaMedicare + t.stateTax;
          if (Math.abs(parts - t.totalTax) > 5)
            throw new Error(`${row.year}: total tax ${t.totalTax} vs parts ${parts}`);
        }
      }),
      { numRuns: 300, seed: 6_006 },
    );
    expect(rows).toBeGreaterThan(1_000);
  }, 60_000);

  it('taxes are never negative for working households either (wages, FICA, net pay)', () => {
    fc.assert(
      fc.property(householdArb({ min: -0.2, max: 0.2 }), (input) => {
        const r = projectFixture(input);
        for (const row of r.rows) {
          if (row.tax === null) throw new Error(`${row.year}: taxes missing with verified rules`);
          for (const [key, value] of Object.entries(row.tax)) {
            if (typeof value === 'number' && value < 0) throw new Error(`${row.year}: tax.${key} = ${value}`);
          }
        }
      }),
      { numRuns: 200, seed: 6_007 },
    );
  }, 60_000);

  it('the gross-up converges with the default settings, and net income ≥ need − tolerance whenever the portfolio is not exhausted (§7.2)', () => {
    let asserted = 0;
    fc.assert(
      fc.property(householdArb({ min: -0.2, max: 0.2 }, { retired: true, spendingMax: 200_000 }), (input) => {
        const h = parse(input);
        const r = project(h, 0, FIXTURE_CTX);
        const tolerance = h.assumptions.grossUp.toleranceCents;
        for (const row of r.rows) {
          if (row.phase !== 'retirement' || row.tax === null) continue;
          if (!row.tax.solver.converged) throw new Error(`${row.year}: gross-up did not converge`);
          if (!notExhausted(row)) continue;
          asserted++;
          if (row.netIncome === null || row.netIncome < row.flows.spendingNeed - tolerance) {
            throw new Error(`${row.year}: net income ${row.netIncome} < need ${row.flows.spendingNeed} − ${tolerance}`);
          }
        }
      }),
      { numRuns: 300, seed: 7_007 },
    );
    expect(asserted).toBeGreaterThan(500);
  }, 60_000);

  it('a year whose need is met within the solver tolerance is not a depletion year (§7.2: unfunded only beyond the total cap)', () => {
    fc.assert(
      fc.property(householdArb({ min: -0.2, max: 0.2 }, { retired: true, spendingMax: 200_000 }), (input) => {
        const r = projectFixture(input);
        for (const row of r.rows) {
          if (row.phase !== 'retirement' || row.tax === null || !notExhausted(row)) continue;
          if (row.depleted || row.flows.shortfall > 0) {
            throw new Error(
              `${row.year}: flagged depleted (shortfall ${row.flows.shortfall} cents, need ${row.flows.spendingNeed}, net ${row.netIncome}) with ${row.totals.portfolioEnd} cents left`,
            );
          }
        }
      }),
      { numRuns: 300, seed: 7_008 },
    );
  }, 60_000);

  it('never produces a negative balance or basis with verified taxes, RMDs and M4 flows', () => {
    fc.assert(
      fc.property(householdArb({ min: -0.3, max: 0.3 }, { spendingMax: 400_000 }), (input) => {
        assertNonNegative(projectFixture(input));
      }),
      { numRuns: 300, seed: 8_008 },
    );
  }, 60_000);
});
