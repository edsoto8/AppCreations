/**
 * Insights (BRIEF §5.9, docs/financial-model.md §13): deterministic what-ifs. Each insight states its
 * change as scenario ops, applies them to a copy of the plan (`applyScenario`) and re-runs the
 * projection; the figures are the difference between the two runs, never an approximation. Wording is
 * descriptive ("In this model, …"), never directive. Insights that do not apply to a plan (no fees,
 * no Social Security, no match left) are left out.
 */
import type { Household } from '../domain/household';
import { HouseholdSchema } from '../domain/household';
import type { EngineResult } from '../domain/results';
import type { Cents } from '../domain/primitives';
import type { Insight, InsightKind } from '../domain/insight';
import type { ProjectionResult } from '../domain/projection';
import { ScenarioSchema, type ScenarioOp } from '../domain/scenario';
import type { EngineContext } from '../api';
import { zodIssues } from '../validation';
import { projectHousehold } from '../projection/project';
import { applyScenario, presetScenario } from '../scenario/scenario';
import { previewAccumulation } from '../income/preview';
import { formatWholeDollars } from '../money';

const usd = (cents: number) => formatWholeDollars(cents / 100);
const set = (
  collection: Exclude<ScenarioOp, { op: 'add' }>['collection'],
  id: string,
  path: (string | number)[],
  value: unknown,
) => ({ op: 'set', collection, id, path, value }) as ScenarioOp;

/** Savings at the start of the first retirement year, in today's dollars (cents). */
function savingsAtRetirement(r: ProjectionResult): number {
  const i = r.rows.findIndex((row) => row.year === r.summary.retirementYear);
  if (i <= 0) return r.rows[0]?.totals.portfolioStart ?? 0;
  return r.rows[i - 1]?.real.portfolioEnd ?? 0;
}

function longevityText(r: ProjectionResult, h: Household): string {
  if (r.summary.depletionYear === null) return 'lasts through the planning age';
  const name = h.people.find(
    (p) => r.summary.depletionYear !== null && r.summary.depletionYear <= p.birthYear + p.planningAge,
  )?.name;
  return `runs out in ${r.summary.depletionYear}${name && r.summary.depletionAge !== null ? ` (${name} ${r.summary.depletionAge})` : ''}`;
}

const COMMON = [
  'Deterministic baseline run (fixed returns), not Monte Carlo.',
  'Figures in today’s dollars.',
  'Only the change listed is made; everything else in the plan stays the same.',
];

export function computeInsights(input: Household, ctx: EngineContext): EngineResult<Insight[]> {
  const parsed = HouseholdSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid', issues: zodIssues(parsed.error) };
  const base = parsed.data;
  const baseline = projectHousehold(base, ctx);
  if (baseline.status !== 'ok') return baseline;
  const b = baseline.value;
  const beforeLimits = b.excludedFeatures.some(
    (f) => f === 'workplaceLimits' || f === 'iraLimits' || f === 'hsaLimits',
  );
  const caveats = [
    ...COMMON,
    ...(beforeLimits ? ['Contributions are as elected, before plan limits (limits are unverified).'] : []),
    ...(b.excludedFeatures.includes('federalIncomeTax')
      ? ['Retirement figures are before taxes (tax rules are unverified).']
      : []),
  ];
  const currentYear = ctx.currentYear;

  const whatIf = (ops: ScenarioOp[]): ProjectionResult | null => {
    const scenario = ScenarioSchema.parse({ id: 'insight', name: 'Insight', baseProfileId: base.id, ops });
    const applied = applyScenario(base, scenario);
    if (!applied.household || applied.orphaned.length > 0) return null;
    const r = projectHousehold(applied.household, ctx);
    return r.status === 'ok' ? r.value : null;
  };
  const insights: Insight[] = [];
  const push = (
    kind: InsightKind,
    title: string,
    body: string,
    metric: { label: string; baseline: number | null; whatIf: number | null },
    ops: ScenarioOp[],
    assumptions: string[],
    tone: Insight['tone'],
  ) =>
    insights.push({
      kind,
      title,
      body,
      metric: {
        label: metric.label,
        basis: 'todays',
        baseline: metric.baseline as Cents | null,
        whatIf: metric.whatIf as Cents | null,
        delta: metric.baseline !== null && metric.whatIf !== null ? ((metric.whatIf - metric.baseline) as Cents) : null,
      },
      whatIfOps: ops,
      assumptions: [...assumptions, ...caveats],
      tone,
    });
  const notRetired = base.people.filter((p) => currentYear - p.birthYear < p.retirementAge);

  // Retiring two years later.
  const canRetireLater = notRetired.filter((p) => p.retirementAge < p.planningAge);
  if (canRetireLater.length > 0) {
    const ops = canRetireLater.map((p) =>
      set('people', p.id, ['retirementAge'], Math.min(p.planningAge, p.retirementAge + 2)),
    );
    const r = whatIf(ops);
    if (r) {
      push(
        'retireTwoYearsLater',
        'Retiring two years later',
        `In this model, retiring two years later changes the ending balance from ${usd(b.summary.endingBalanceReal)} to ${usd(r.summary.endingBalanceReal)}, and the portfolio ${longevityText(r, base)} (now it ${longevityText(b, base)}).`,
        { label: 'Ending balance', baseline: b.summary.endingBalanceReal, whatIf: r.summary.endingBalanceReal },
        ops,
        [
          'Every person not yet retired retires two years later (capped at the planning age); pay continues as the plan sets it (a salary stop age stays as entered).',
        ],
        'neutral',
      );
    }
  }

  // Capturing the full employer match: only for plans whose year-1 match readout (the engine's own
  // `unclaimed`) leaves money on the table; the salary deferral is raised to the smallest rate whose
  // readout leaves nothing unclaimed, found by re-running the readout (bisection to 0.01%).
  const preview = previewAccumulation(base, ctx, 1);
  const unclaimedFor = (h: Household, personId: string, planId: string): number | null => {
    const r = h === base ? preview : previewAccumulation(h, ctx, 1);
    if (r.status !== 'ok') return null;
    const row = r.value.people.find((x) => x.personId === personId)?.rows[0];
    return row?.plans.find((x) => x.planId === planId)?.matchBeforeLimits.unclaimed ?? null;
  };
  const matchOps: ScenarioOp[] = [];
  for (const p of notRetired) {
    for (const plan of p.workplacePlans) {
      const left = unclaimedFor(base, p.id, plan.id);
      if (left === null || left <= 0) continue;
      const key =
        plan.traditionalPctOfSalary === 0 && plan.rothPctOfSalary > 0 ? 'rothPctOfSalary' : 'traditionalPctOfSalary';
      const withRate = (rate: number) =>
        HouseholdSchema.safeParse({
          ...base,
          people: base.people.map((q) =>
            q.id !== p.id
              ? q
              : { ...q, workplacePlans: q.workplacePlans.map((w) => (w.id === plan.id ? { ...w, [key]: rate } : w)) },
          ),
        });
      const captures = (rate: number) => {
        const h = withRate(rate);
        return h.success && (unclaimedFor(h.data, p.id, plan.id) ?? 1) <= 0;
      };
      const other = key === 'traditionalPctOfSalary' ? plan.rothPctOfSalary : plan.traditionalPctOfSalary;
      const top = 1 - other;
      if (!captures(top)) continue; // salary deferrals alone cannot capture it (e.g. a bonus-only match)
      let lo = plan[key];
      let hi = top;
      while (hi - lo > 0.0001) {
        const mid = (lo + hi) / 2;
        if (captures(mid)) hi = mid;
        else lo = mid;
      }
      // The smallest whole 0.01% at or above the last rate that leaves match unclaimed.
      let rate = Math.floor(lo * 10_000) / 10_000;
      while (rate < hi && !captures(rate)) rate = Math.round((rate + 0.0001) * 10_000) / 10_000;
      matchOps.push(set('workplacePlans', plan.id, [key], Math.min(rate, top)));
    }
  }
  if (matchOps.length > 0) {
    const r = whatIf(matchOps);
    if (r) {
      push(
        'fullMatchValue',
        'Capturing the full employer match',
        `In this model, contributing enough to receive the full employer match changes savings at retirement from ${usd(savingsAtRetirement(b))} to ${usd(savingsAtRetirement(r))}.`,
        { label: 'Savings at retirement', baseline: savingsAtRetirement(b), whatIf: savingsAtRetirement(r) },
        matchOps,
        [
          'Each plan whose match is not fully captured gets the smallest salary deferral at which this year’s match readout leaves nothing unclaimed.',
          'The extra contribution comes out of pay.',
        ],
        'neutral',
      );
    }
  }

  // Lifetime cost of fees.
  const feeOps = base.accounts.filter((a) => a.expenseRatio > 0).map((a) => set('accounts', a.id, ['expenseRatio'], 0));
  if (feeOps.length > 0) {
    const r = whatIf(feeOps);
    if (r) {
      push(
        'lifetimeFeeCost',
        'Lifetime cost of fees',
        `In this model, the accounts’ expense ratios reduce the ending balance by ${usd(r.summary.endingBalanceReal - b.summary.endingBalanceReal)} (${usd(r.summary.endingBalanceReal)} without fees, ${usd(b.summary.endingBalanceReal)} with them).`,
        { label: 'Ending balance', baseline: b.summary.endingBalanceReal, whatIf: r.summary.endingBalanceReal },
        feeOps,
        ['Every expense ratio is set to 0%; returns are otherwise unchanged.'],
        'neutral',
      );
    }
  }

  // Inflation one point higher.
  {
    const ops = [set('household', base.id, ['assumptions', 'inflation'], base.assumptions.inflation + 0.01)];
    const r = whatIf(ops);
    if (r) {
      push(
        'inflationImpact',
        'Inflation one point higher',
        `In this model, inflation of ${pct(base.assumptions.inflation + 0.01)} instead of ${pct(base.assumptions.inflation)} changes the ending balance in today’s dollars from ${usd(b.summary.endingBalanceReal)} to ${usd(r.summary.endingBalanceReal)}.`,
        { label: 'Ending balance', baseline: b.summary.endingBalanceReal, whatIf: r.summary.endingBalanceReal },
        ops,
        ['Inflation raises spending, raises and indexed amounts; returns entered as nominal rates are unchanged.'],
        'neutral',
      );
    }
  }

  // Spending sensitivity: retirement spending 10% lower (preset F's ops).
  {
    const ops = presetScenario(
      'F_reducedSpending',
      base,
      { currentYear, cut: 0.1 },
      { scenarioId: 'insight', name: 'Insight', baseProfileId: base.id },
    ).ops;
    const r = whatIf(ops);
    if (r) {
      push(
        'spendingSensitivity',
        'Retirement spending 10% lower',
        `In this model, spending 10% less in retirement changes the ending balance from ${usd(b.summary.endingBalanceReal)} to ${usd(r.summary.endingBalanceReal)}, and the portfolio ${longevityText(r, base)}.`,
        { label: 'Ending balance', baseline: b.summary.endingBalanceReal, whatIf: r.summary.endingBalanceReal },
        ops,
        ['Retirement spending and every spending step are 10% lower; working-years spending is unchanged.'],
        'neutral',
      );
    }
  }

  // Depletion risk: returns one point lower in every year.
  {
    const ops: ScenarioOp[] = [
      set('household', base.id, ['assumptions', 'returnPreRetirement'], base.assumptions.returnPreRetirement - 0.01),
      set('household', base.id, ['assumptions', 'returnPostRetirement'], base.assumptions.returnPostRetirement - 0.01),
      ...(['stocks', 'bonds', 'cash'] as const).map((asset) =>
        set(
          'household',
          base.id,
          ['assumptions', 'capitalMarket', asset, 'geometricReturn'],
          base.assumptions.capitalMarket[asset].geometricReturn - 0.01,
        ),
      ),
      ...base.accounts
        .filter((a) => a.expectedReturn !== null)
        .map((a) => set('accounts', a.id, ['expectedReturn'], (a.expectedReturn ?? 0) - 0.01)),
      ...(base.assumptions.marketShock
        ? [
            set(
              'household',
              base.id,
              ['assumptions', 'marketShock', 'returns'],
              base.assumptions.marketShock.returns.map((x) => x - 0.01),
            ),
          ]
        : []),
    ];
    const r = whatIf(ops);
    if (r) {
      const depletes = b.summary.depletionYear !== null || r.summary.depletionYear !== null;
      push(
        'depletionRisk',
        'Returns one point lower',
        `In this model, the portfolio ${longevityText(b, base)}. With every return one percentage point lower, it ${longevityText(r, base)}, and the ending balance is ${usd(r.summary.endingBalanceReal)}.`,
        { label: 'Ending balance', baseline: b.summary.endingBalanceReal, whatIf: r.summary.endingBalanceReal },
        ops,
        [
          'Every expected return (account, phase and capital-market assumptions, and any market-shock years) is one percentage point lower in every year.',
        ],
        depletes ? 'attention' : 'neutral',
      );
    }
  }

  // Social Security claiming one year later: only for people who have not claimed yet, whose benefit
  // the plan computes from a PIA (an amount entered at the claiming age stays the same whatever the
  // age, so a later age would only delay it), and whose benefit is in the forecast (rules verified).
  const ssTotal = (r: ProjectionResult) =>
    r.rows.reduce((sum, row) => sum + row.flows.socialSecurity / row.deflator, 0);
  const ownSs = (r: ProjectionResult, personId: string) =>
    r.rows.reduce((sum, row) => sum + (row.people.find((x) => x.personId === personId)?.socialSecurity ?? 0), 0);
  const MAX_CLAIM_MONTHS = 70 * 12;
  const ssOps = base.people
    .filter((p) => {
      const { source, claimAge } = p.socialSecurity;
      if (source.kind === 'none' || source.kind === 'atClaimAge') return false;
      if (p.birthYear + claimAge.years <= currentYear) return false; // already claiming
      return claimAge.years * 12 + claimAge.months < MAX_CLAIM_MONTHS && ownSs(b, p.id) > 0;
    })
    .map((p) => {
      const months = Math.min(
        MAX_CLAIM_MONTHS,
        p.socialSecurity.claimAge.years * 12 + p.socialSecurity.claimAge.months + 12,
      );
      return set('people', p.id, ['socialSecurity', 'claimAge'], {
        years: Math.floor(months / 12),
        months: months % 12,
      });
    });
  if (ssOps.length > 0) {
    const r = whatIf(ssOps);
    if (r) {
      push(
        'ssClaimingAge',
        'Claiming Social Security one year later',
        `In this model, claiming one year later changes lifetime Social Security income from ${usd(ssTotal(b))} to ${usd(ssTotal(r))} (today’s dollars, through the planning age) and the ending balance from ${usd(b.summary.endingBalanceReal)} to ${usd(r.summary.endingBalanceReal)}.`,
        { label: 'Lifetime Social Security income', baseline: Math.round(ssTotal(b)), whatIf: Math.round(ssTotal(r)) },
        ssOps,
        [
          'Each claiming age not yet reached moves 12 months later (up to 70).',
          'Only benefits the plan computes from a full-retirement-age amount are moved; an amount entered at the claiming age is left as it is.',
          'Benefit amounts come from the plan’s own Social Security inputs and rules.',
        ],
        'neutral',
      );
    }
  }

  // Savings increase for the goal (only when the plan does not meet it).
  if (!b.summary.deterministicSuccess && notRetired.length > 0) {
    const owner = notRetired[0];
    const extraOps = (amount: number): ScenarioOp[] => [
      {
        op: 'add',
        collection: 'accounts',
        parentId: null,
        entity: {
          type: 'cash',
          id: 'insight-extra-savings',
          name: 'Extra savings (what-if)',
          ownerId: owner?.id,
          balance: 0,
          contribution: { amount: { kind: 'dollars', amount, frequency: 'annual' }, growth: { mode: 'inflation' } },
        },
      } as ScenarioOp,
    ];
    const meets = (amount: number) => whatIf(extraOps(amount))?.summary.deterministicSuccess ?? false;
    const shortYears = (amount: number) => whatIf(extraOps(amount))?.summary.infeasibleYears.length ?? 0;
    const ceiling = 50_000_000; // $500,000 a year
    let found: number | null = null;
    if (meets(ceiling)) {
      let lo = 0;
      let hi = ceiling;
      while (hi - lo > 10_000) {
        const mid = Math.round((lo + hi) / 2 / 10_000) * 10_000;
        if (mid === lo || mid === hi) break;
        if (meets(mid)) hi = mid;
        else lo = mid;
      }
      found = hi; // to the nearest $100 above the threshold
    }
    push(
      'savingsIncreaseForGoal',
      'Savings needed to meet the goal',
      found === null
        ? 'In this model, even $500,000 a year of extra savings would not meet the funding goal.'
        : `In this model, saving about ${usd(found)} more a year (in today’s dollars, rising with inflation, in a cash account earning the plan’s return) meets the funding goal: no depletion before the planning age and at least the minimum ending balance.${shortYears(found) > 0 ? ` In ${shortYears(found)} working year${shortYears(found) === 1 ? '' : 's'} that is more than take-home pay leaves after spending.` : ''}`,
      { label: 'Extra savings a year', baseline: 0, whatIf: found },
      extraOps(found ?? ceiling),
      [
        'The extra amount (today’s dollars, rising with inflation) goes into a new cash account each working year, at the household’s expected return.',
        'Searched to the nearest $100.',
      ],
      'attention',
    );
  }

  return { status: 'ok', value: insights, warnings: [] };
}

function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`;
}
