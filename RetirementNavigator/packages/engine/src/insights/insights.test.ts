/**
 * Insights (M7b gate: every insight re-runs the engine). A spy counts projection runs, and each
 * insight's own what-if ops, re-applied and re-projected here, reproduce its figure exactly.
 */
import { describe, expect, it, vi } from 'vitest';
import { InsightSchema, type Insight } from '../domain/insight';
import { HouseholdSchema, type Household } from '../domain/household';
import { ScenarioSchema } from '../domain/scenario';
import { SAMPLE_PROFILES } from '../samples/profiles';
import { RULES } from '../rules/index';
import { dollars } from '../money';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import * as api from '../api';
import type * as ProjectModule from '../projection/project';

vi.mock('../projection/project', async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectModule>();
  return { ...actual, projectHousehold: vi.fn(actual.projectHousehold) };
});
const project = await import('../projection/project');
const { applyScenario } = await import('../scenario/scenario');
const { computeInsights } = await import('./insights');
const { previewAccumulation } = await import('../income/preview');

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const sample = (id: string) => SAMPLE_PROFILES.find((s) => s.id === id)!.build(YEAR);

/** Re-apply an insight's ops and project, independently of computeInsights. */
function rerun(base: Household, insight: Insight, context = ctx) {
  const scenario = ScenarioSchema.parse({ id: 'x', name: 'x', baseProfileId: base.id, ops: insight.whatIfOps });
  const applied = applyScenario(base, scenario);
  expect(applied.orphaned).toEqual([]);
  const r = project.projectHousehold(applied.household!, context);
  if (r.status !== 'ok') throw new Error('rerun');
  return r.value;
}

describe('computeInsights', () => {
  it('is wired into the frozen API', () => {
    expect(api.computeInsights).toBe(computeInsights);
  });

  it('re-runs the engine for every insight and reports the re-run’s own figures', () => {
    for (const id of ['earlyCareer', 'midCareerCouple', 'nearRetirement', 'highEarner']) {
      const base = sample(id);
      const spy = vi.mocked(project.projectHousehold);
      spy.mockClear();
      const r = computeInsights(base, ctx);
      if (r.status !== 'ok') throw new Error(JSON.stringify(r));
      const insights = r.value;
      expect(insights.length).toBeGreaterThan(2);
      // One baseline plus at least one run per insight.
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1 + insights.length);
      const baseline = spy.mock.results[0]!.value as {
        status: 'ok';
        value: { summary: { endingBalanceReal: number } };
      };
      for (const insight of insights) {
        expect(InsightSchema.safeParse(insight).success).toBe(true);
        expect(insight.body.startsWith('In this model')).toBe(true);
        expect(insight.assumptions.length).toBeGreaterThan(1);
        expect(insight.whatIfOps.length).toBeGreaterThan(0);
        if (insight.metric.label === 'Ending balance') {
          expect(insight.metric.baseline).toBe(baseline.value.summary.endingBalanceReal);
          expect(insight.metric.whatIf).toBe(rerun(base, insight).summary.endingBalanceReal);
          expect(insight.metric.delta).toBe(insight.metric.whatIf! - insight.metric.baseline!);
        }
      }
    }
  });

  it('never uses directive wording', () => {
    const r = computeInsights(sample('midCareerCouple'), ctx);
    if (r.status !== 'ok') throw new Error('insights');
    for (const i of r.value) expect(i.body).not.toMatch(/\b(you should|we recommend|must|consider)\b/i);
  });

  it('includes fees only when there are fees, and the match only when some is left on the table', () => {
    const base = sample('midCareerCouple');
    const noFees = HouseholdSchema.parse({ ...base, accounts: base.accounts.map((a) => ({ ...a, expenseRatio: 0 })) });
    const kinds = (h: Household) => {
      const r = computeInsights(h, ctx);
      if (r.status !== 'ok') throw new Error('insights');
      return r.value.map((i) => i.kind);
    };
    expect(kinds(noFees)).not.toContain('lifetimeFeeCost');
    const withFees = HouseholdSchema.parse({
      ...base,
      accounts: base.accounts.map((a) => ({ ...a, expenseRatio: 0.005 })),
    });
    expect(kinds(withFees)).toContain('lifetimeFeeCost');
    const fullMatch = HouseholdSchema.parse({
      ...base,
      people: base.people.map((p) => ({
        ...p,
        workplacePlans: p.workplacePlans.map((plan) => ({ ...plan, traditionalPctOfSalary: 0.2 })),
      })),
    });
    expect(kinds(fullMatch)).not.toContain('fullMatchValue');
  });

  it('finds the extra savings that meets the goal when the plan falls short, verified by re-running', () => {
    const base = sample('midCareerCouple');
    const r = computeInsights(base, ctx);
    if (r.status !== 'ok') throw new Error('insights');
    const goal = r.value.find((i) => i.kind === 'savingsIncreaseForGoal');
    const baseline = project.projectHousehold(base, ctx);
    if (baseline.status !== 'ok') throw new Error('baseline');
    if (baseline.value.summary.deterministicSuccess) {
      expect(goal).toBeUndefined();
      return;
    }
    expect(goal).toBeDefined();
    const amount = goal!.metric.whatIf!;
    expect(amount % 10_000).toBe(0);
    expect(rerun(base, goal!).summary.deterministicSuccess).toBe(true);
    // $100 less does not meet it (the search's resolution).
    const less = {
      ...goal!,
      whatIfOps: goal!.whatIfOps.map((op) =>
        op.op === 'add'
          ? {
              ...op,
              entity: {
                ...(op.entity as object),
                contribution: { amount: { kind: 'dollars', amount: amount - 10_000, frequency: 'annual' } },
              },
            }
          : op,
      ),
    };
    expect(rerun(base, less).summary.deterministicSuccess).toBe(false);
  });

  it('computes the Social Security claiming insight from the plan’s own benefits (synthetic fixture rules)', () => {
    const base = sample('nearRetirement');
    const fx = { currentYear: FIXTURE_YEAR, rules: fixtureRules() };
    const r = computeInsights(base, fx);
    if (r.status !== 'ok') throw new Error('insights');
    const ss = r.value.find((i) => i.kind === 'ssClaimingAge');
    expect(ss).toBeDefined();
    const after = rerun(base, ss!, fx);
    const total = after.rows.reduce((sum, row) => sum + row.flows.socialSecurity / row.deflator, 0);
    expect(ss!.metric.whatIf).toBe(Math.round(total));
  });

  it('returns invalid for an invalid household', () => {
    expect(computeInsights({ ...sample('earlyCareer'), people: [] } as never, ctx).status).toBe('invalid');
  });
});

describe('M7 review: claiming and match insights say what they do', () => {
  const fx = { currentYear: FIXTURE_YEAR, rules: fixtureRules() };
  const kinds = (h: Household, context = fx) => {
    const r = computeInsights(h, context);
    if (r.status !== 'ok') throw new Error('insights');
    return r.value;
  };

  it('moves an unclaimed PIA-based claim 12 months later (months kept); skips entered amounts and people already claiming', () => {
    const base = sample('nearRetirement');
    const p = base.people[0]!;
    const months = HouseholdSchema.parse({
      ...base,
      people: [
        { ...p, socialSecurity: { ...p.socialSecurity, claimAge: { years: 66, months: 8 } } },
        ...base.people.slice(1),
      ],
    });
    const ss = kinds(months).find((i) => i.kind === 'ssClaimingAge');
    expect(ss?.whatIfOps[0]).toMatchObject({ path: ['socialSecurity', 'claimAge'], value: { years: 67, months: 8 } });
    const entered = HouseholdSchema.parse({
      ...base,
      people: [
        {
          ...p,
          socialSecurity: {
            source: { kind: 'atClaimAge', monthlyAtClaim: dollars(3_000) },
            claimAge: { years: 67, months: 0 },
          },
        },
        ...base.people.slice(1),
      ],
    });
    expect(kinds(entered).map((i) => i.kind)).not.toContain('ssClaimingAge');
    const claiming = HouseholdSchema.parse({
      ...base,
      people: [
        {
          ...p,
          birthYear: FIXTURE_YEAR - 68,
          socialSecurity: { ...p.socialSecurity, claimAge: { years: 62, months: 0 } },
        },
        ...base.people.slice(1),
      ],
    });
    expect(kinds(claiming).map((i) => i.kind)).not.toContain('ssClaimingAge');
  });

  it('raises deferrals only as far as the engine readout needs to leave no match unclaimed', () => {
    for (const id of ['earlyCareer', 'highEarner', 'midCareerCouple']) {
      const base = sample(id);
      const insight = kinds(base, fx).find((i) => i.kind === 'fullMatchValue');
      const before = previewAccumulation(base, fx, 1);
      if (before.status !== 'ok') throw new Error('preview');
      const leftBefore = before.value.people.flatMap((p) => p.rows[0]!.plans.map((x) => x.matchBeforeLimits.unclaimed));
      if (!insight) {
        expect(leftBefore.every((u) => u <= 0)).toBe(true);
        continue;
      }
      const applied = applyScenario(
        base,
        ScenarioSchema.parse({ id: 'x', name: 'x', baseProfileId: base.id, ops: insight.whatIfOps }),
      );
      const after = previewAccumulation(applied.household!, fx, 1);
      if (after.status !== 'ok') throw new Error('preview');
      for (const p of after.value.people)
        for (const plan of p.rows[0]!.plans) expect(plan.matchBeforeLimits.unclaimed).toBeLessThanOrEqual(0);
      // Minimal: 0.01 point less leaves some match unclaimed for each changed plan.
      for (const op of insight.whatIfOps) {
        if (op.op !== 'set') continue;
        const less = applyScenario(
          base,
          ScenarioSchema.parse({
            id: 'y',
            name: 'y',
            baseProfileId: base.id,
            ops: [{ ...op, value: (op.value as number) - 0.0001 }],
          }),
        );
        const r = previewAccumulation(less.household!, fx, 1);
        if (r.status !== 'ok') throw new Error('preview');
        const left = r.value.people.flatMap((p) =>
          p.rows[0]!.plans.filter((x) => x.planId === op.id).map((x) => x.matchBeforeLimits.unclaimed),
        );
        expect(left.some((u) => u > 0)).toBe(true);
      }
    }
  });
});
