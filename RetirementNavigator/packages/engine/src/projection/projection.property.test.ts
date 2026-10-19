/**
 * Projection invariants as fast-check properties (gate M3, docs/financial-model.md §1.3, §1.5, §9).
 * Generated households are small (1–2 people, ≤ 4 accounts, ≤ 40 years) and need no verified rules
 * (bundled rules: workplace contributions run before limits, §1.7). Seeds are fixed so CI is
 * deterministic.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { HouseholdSchema, RULES, projectHousehold, type Household, type HouseholdInput } from '../index';
import type { ProjectionResult } from '../index';

const YEAR = 2026;
const CTX = { currentYear: YEAR, rules: RULES };

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
      if (a.type === 'rothIra') return { ...base, contributionBasis: basis };
      if (a.type === 'hsa') return { ...base, coverage: 'selfOnly', hdhpAttested: a.hdhpAttested };
      return base;
    });

const personArb = (id: string, r: ReturnRange) =>
  fc
    .record({
      age: fc.integer({ min: 25, max: 80 }),
      yearsToRetire: fc.integer({ min: -10, max: 25 }),
      yearsAfter: fc.integer({ min: 0, max: 30 }),
      employment: fc.option(
        fc.record({
          baseSalary: money(300_000),
          raise: fc.oneof(
            rate(-0.05, 0.1).map((x) => ({ mode: 'nominal', rate: x })),
            rate(-0.03, 0.05).map((x) => ({ mode: 'inflationPlus', realRate: x })),
          ),
          bonus: fc.oneof(
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
      if (p.plan !== null && employment !== null) {
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
          retirementAge,
          planningAge,
          employment,
          workplacePlans: plans,
          socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
        },
        planAccounts,
      };
    });

function householdArb(r: ReturnRange = { min: -0.3, max: 0.3 }, spendingMax = 150_000) {
  return fc
    .record({
      couple: fc.boolean(),
      p1: personArb('p1', r),
      p2: personArb('p2', r),
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
      drag: rate(0, 0.02),
      shock: fc.option(
        fc.record({
          startYear: fc.integer({ min: YEAR, max: YEAR + 30 }),
          returns: fc.array(rate(r.min < 0 ? -0.5 : 0, r.max), { minLength: 1, maxLength: 3 }),
        }),
        { nil: null, freq: 4 },
      ),
    })
    .map((g): HouseholdInput => {
      const people = g.couple ? [g.p1, g.p2] : [g.p1];
      // Keep the horizon ≤ 40 rows: clamp each planning age to the horizon of the first person.
      const lastYear = YEAR + 39;
      for (const p of people) {
        p.person.planningAge = Math.min(p.person.planningAge, lastYear - p.person.birthYear);
        p.person.retirementAge = Math.min(p.person.retirementAge, p.person.planningAge);
        if (p.person.employment?.partTime && p.person.employment.partTime.endAge > p.person.planningAge + 1) {
          p.person.employment.partTime = null;
        }
      }
      const owners = people.map((p) => p.person.id);
      const accounts = [
        ...g.accountArbs
          .slice(0, g.accounts.length)
          .map((a) => ({ ...a, ownerId: owners.includes(a.ownerId) ? a.ownerId : 'p1' })),
        ...people.flatMap((p) => p.planAccounts),
      ];
      return {
        id: 'h',
        name: 'Generated',
        filingStatus: g.couple ? 'marriedFilingJointly' : 'single',
        people: people.map((p) => p.person),
        accounts,
        spending: { currentAnnualSpending: g.current, retirementAnnualSpending: g.retirement },
        assumptions: {
          inflation: g.inflation,
          returnPreRetirement: g.pre,
          returnPostRetirement: g.post,
          capitalMarket: CMA,
          rules: { anchorYear: YEAR },
          withdrawalTiming: g.timing,
          granularity: g.granularity,
          withdrawalStrategy: g.strategy,
          taxableAccountTaxDrag: g.drag,
          marketShock: g.shock,
        },
      } as unknown as HouseholdInput;
    });
}

function project(h: Household, returnOffset = 0): ProjectionResult {
  const r = projectHousehold(h, CTX, { returnOffset });
  if (r.status !== 'ok') throw new Error(`projection ${r.status}: ${JSON.stringify(r)}`);
  return r.value;
}

const parse = (input: HouseholdInput): Household => HouseholdSchema.parse(input);

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

  it('reconciles every account row within ±1 cent and carries end → next start (10,000 runs)', () => {
    fc.assert(
      fc.property(householdArb(), (input) => {
        const r = project(parse(input));
        r.rows.forEach((row, i) => {
          for (const a of row.accounts) {
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

  it('never produces a negative balance or basis, including after depletion', () => {
    // Spending up to $400k biases the generator towards depletion.
    fc.assert(
      fc.property(householdArb({ min: -0.3, max: 0.3 }, 400_000), (input) => {
        const r = project(parse(input));
        for (const row of r.rows) {
          for (const a of row.accounts) {
            if (a.start < 0 || a.end < 0 || a.basisEnd < 0 || a.withdrawals < 0 || a.contributions < 0) {
              throw new Error(`${row.year} ${a.accountId}: negative figure ${JSON.stringify(a)}`);
            }
          }
          if (row.flows.shortfall < 0 || row.flows.spendingFunded > row.flows.spendingNeed + 1) {
            throw new Error(`${row.year}: shortfall/funded ${JSON.stringify(row.flows)}`);
          }
        }
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
        const fees = new Map(h.accounts.map((a) => [a.id as string, a]));
        const allNonNegative = def.rows.every((row) =>
          row.accounts.every((a) => {
            const acc = fees.get(a.accountId)!;
            const drag = acc.type === 'taxableBrokerage' ? h.assumptions.taxableAccountTaxDrag : 0;
            return (1 + a.appliedReturn) * (1 - acc.expenseRatio) - 1 - drag >= 0;
          }),
        );
        if (!allNonNegative) return;
        asserted++;
        const cons = withTiming('startOfYear');
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
