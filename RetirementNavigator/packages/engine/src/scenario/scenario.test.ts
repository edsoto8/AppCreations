/** Scenario diffs, presets A–G, the optimizer and comparison (docs/financial-model.md §10). */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type Household } from '../domain/household';
import { ScenarioSchema, type Scenario, type ScenarioOp } from '../domain/scenario';
import { SAMPLE_PROFILES } from '../samples/profiles';
import { minimalHouseholdInput } from '../samples/minimal';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { projectHousehold } from '../projection/project';
import { applyScenario, compareScenarios, optimizeRetirementAge, presetScenario, withRetirementAge } from './scenario';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const couple = () => SAMPLE_PROFILES.find((s) => s.id === 'midCareerCouple')!.build(YEAR);
const scenario = (ops: unknown[]): Scenario =>
  ScenarioSchema.parse({ id: 'sc', name: 'Test', baseProfileId: 'base', ops });

describe('diff semantics', () => {
  it('sets, unsets (to the default) and adds by entity id on a copy of the base', () => {
    const base = couple();
    const sam = base.people[0]!;
    const result = applyScenario(
      base,
      scenario([
        { op: 'set', collection: 'people', id: sam.id, path: ['retirementAge'], value: 60 },
        { op: 'set', collection: 'household', id: base.id, path: ['assumptions', 'inflation'], value: 0.03 },
        { op: 'unset', collection: 'household', id: base.id, path: ['assumptions', 'withdrawalTiming'] },
        {
          op: 'add',
          collection: 'accounts',
          entity: { type: 'cash', id: 'new-cash', name: 'New', ownerId: sam.id, balance: 100 },
        },
      ]),
    );
    expect(result.issues).toEqual([]);
    expect(result.appliedOps).toBe(4);
    expect(result.household?.people[0]?.retirementAge).toBe(60);
    expect(result.household?.assumptions.inflation).toBe(0.03);
    expect(result.household?.assumptions.withdrawalTiming).toBe('midYear');
    expect(result.household?.accounts.some((a) => a.id === 'new-cash')).toBe(true);
    // The base is untouched.
    expect(base.people[0]?.retirementAge).toBe(sam.retirementAge);
    expect(base.accounts.some((a) => a.id === 'new-cash')).toBe(false);
  });

  it('removes an entity with unset and no path, and adds a plan under its person', () => {
    const base = couple();
    const brokerage = base.accounts.find((a) => a.type === 'taxableBrokerage')!;
    const jordan = base.people[1]!;
    const r = applyScenario(
      base,
      scenario([
        { op: 'unset', collection: 'accounts', id: brokerage.id },
        {
          op: 'add',
          collection: 'accounts',
          entity: {
            type: 'workplaceTraditional',
            id: 'k2',
            name: 'New 401k',
            ownerId: jordan.id,
            planType: '401k',
            balance: 0,
          },
        },
        {
          op: 'add',
          collection: 'workplacePlans',
          parentId: jordan.id,
          entity: {
            id: 'plan-2',
            planType: '401k',
            traditionalAccountId: 'k2',
            traditionalPctOfSalary: 0.03,
            match: { tiers: [] },
          },
        },
      ]),
    );
    expect(r.issues).toEqual([]);
    expect(r.household?.accounts.some((a) => a.id === brokerage.id)).toBe(false);
    expect(r.household?.people[1]?.workplacePlans.map((p) => p.id)).toContain('plan-2');
  });

  it('flags ops on deleted base entities as orphaned and does not apply them', () => {
    const base = couple();
    const ops: ScenarioOp[] = [
      { op: 'set', collection: 'accounts', id: 'deleted-account' as never, path: ['balance'], value: 1 },
      { op: 'set', collection: 'people', id: base.people[0]!.id, path: ['nope', 'deeper'], value: 1 },
      { op: 'add', collection: 'workplacePlans', parentId: 'ghost' as never, entity: {} },
      { op: 'set', collection: 'people', id: base.people[0]!.id, path: ['retirementAge'], value: 62 },
    ];
    const r = applyScenario(base, scenario(ops));
    expect(r.orphaned.map((o) => [o.opIndex, o.reason])).toEqual([
      [0, 'missingEntity'],
      [1, 'invalidPath'],
      [2, 'missingParent'],
    ]);
    expect(r.appliedOps).toBe(1);
    expect(r.household?.people[0]?.retirementAge).toBe(62);
  });

  it('lets base edits flow through: the scenario stores only ops', () => {
    const base = couple();
    const s = scenario([
      { op: 'set', collection: 'people', id: base.people[0]!.id, path: ['retirementAge'], value: 60 },
    ]);
    const edited: Household = HouseholdSchema.parse({
      ...base,
      spending: { ...base.spending, retirementAnnualSpending: dollars(123_456) },
    });
    const r = applyScenario(edited, s);
    expect(r.household?.spending.retirementAnnualSpending).toBe(dollars(123_456));
    expect(r.household?.people[0]?.retirementAge).toBe(60);
  });

  it('reports schema issues instead of returning an invalid household', () => {
    const base = couple();
    const r = applyScenario(
      base,
      scenario([{ op: 'set', collection: 'people', id: base.people[0]!.id, path: ['retirementAge'], value: 120 }]),
    );
    expect(r.household).toBeNull();
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('presets A–G', () => {
  const ids = { scenarioId: 's', name: 'Preset', baseProfileId: 'base' };
  const apply = (
    preset: Parameters<typeof presetScenario>[0],
    params: Record<string, number | string | boolean> = {},
  ) => {
    const base = couple();
    const s = presetScenario(preset, base, { currentYear: YEAR, ...params }, ids);
    const r = applyScenario(base, s);
    expect(r.issues).toEqual([]);
    expect(r.orphaned).toEqual([]);
    return { base, s, h: r.household! };
  };

  it('A changes nothing', () => {
    const { base, s, h } = apply('A_baseline');
    expect(s.ops).toEqual([]);
    expect(h).toEqual(base);
  });

  it('B retires everyone five years earlier (not before today’s age); E later by 3–5 years', () => {
    const b = apply('B_earlyRetirement');
    expect(b.h.people.map((p) => p.retirementAge)).toEqual(b.base.people.map((p) => p.retirementAge - 5));
    const e = apply('E_delayedRetirement', { years: 9 });
    expect(e.s.presetParams.years).toBe(5);
    expect(e.h.people.map((p) => p.retirementAge)).toEqual(
      e.base.people.map((p) => Math.min(p.planningAge, p.retirementAge + 5)),
    );
  });

  it('C raises deferrals by 5 points; F cuts retirement spending by 10%', () => {
    const c = apply('C_aggressiveSavings');
    const plan = (h: Household) => h.people[0]!.workplacePlans[0]!;
    expect(plan(c.h).traditionalPctOfSalary).toBeCloseTo(plan(c.base).traditionalPctOfSalary + 0.05, 12);
    const f = apply('F_reducedSpending');
    expect(f.h.spending.retirementAnnualSpending).toBe(Math.round(f.base.spending.retirementAnnualSpending * 0.9));
  });

  it('D is a deterministic, reproducible return shock spread over its duration', () => {
    const d1 = apply('D_marketDownturn', { severity: -0.3, durationYears: 2, startYear: 2050 });
    const shock = d1.h.assumptions.marketShock!;
    expect(shock.startYear).toBe(2050);
    expect(shock.returns).toHaveLength(2);
    expect((1 + shock.returns[0]!) * (1 + shock.returns[1]!) - 1).toBeCloseTo(-0.3, 12);
    const d2 = apply('D_marketDownturn', { severity: -0.3, durationYears: 2, startYear: 2050 });
    const p1 = projectHousehold(d1.h, ctx);
    const p2 = projectHousehold(d2.h, ctx);
    expect(p1).toEqual(p2);
    if (p1.status !== 'ok') throw new Error('projection');
    // The shock replaces the return in its years.
    expect(p1.value.rows.find((r) => r.year === 2050)!.accounts[0]!.appliedReturn).toBeCloseTo(shock.returns[0]!, 12);
    // Default timing: the first year everyone is retired.
    const dflt = apply('D_marketDownturn');
    expect(dflt.h.assumptions.marketShock?.startYear).toBe(
      Math.max(...dflt.base.people.map((p) => p.birthYear + p.retirementAge)),
    );
  });

  it('G moves deferrals to Roth where the plan offers it', () => {
    const g = apply('G_rothStrategy');
    for (const [i, person] of g.base.people.entries()) {
      for (const [j, plan] of person.workplacePlans.entries()) {
        const after = g.h.people[i]!.workplacePlans[j]!;
        if (plan.planOffersRoth && plan.rothAccountId) {
          expect(after.traditionalPctOfSalary).toBe(0);
          expect(after.rothPctOfSalary).toBeCloseTo(plan.rothPctOfSalary + plan.traditionalPctOfSalary, 12);
        } else {
          expect(after).toEqual(plan);
        }
      }
    }
  });
});

describe('retirement-age optimizer (deterministic criterion)', () => {
  const retireeLike = () =>
    HouseholdSchema.parse({
      ...minimalHouseholdInput(YEAR),
      people: [
        {
          ...minimalHouseholdInput(YEAR).people[0]!,
          birthYear: YEAR - 55,
          retirementAge: 60,
          planningAge: 90,
          employment: { baseSalary: dollars(90_000), raise: { mode: 'nominal', rate: 0 } },
        },
      ],
      accounts: [
        {
          type: 'cash',
          id: 'cash',
          name: 'Cash',
          ownerId: 'person-1',
          balance: dollars(300_000),
          expectedReturn: 0.03,
          contribution: { amount: { kind: 'dollars', amount: dollars(20_000), frequency: 'annual' } },
        },
      ],
      spending: { currentAnnualSpending: dollars(50_000), retirementAnnualSpending: dollars(40_000) },
    });

  it('matches an independent brute-force scan', () => {
    const h = retireeLike();
    const r = optimizeRetirementAge(h, ctx, { kind: 'deterministic' }, { fromAge: 56, toAge: 75 });
    if (r.status !== 'ok') throw new Error('optimizer');
    // Brute force written separately: set the age directly and project.
    let brute: number | null = null;
    for (let age = 56; age <= 75; age++) {
      const candidate = HouseholdSchema.parse({ ...h, people: [{ ...h.people[0]!, retirementAge: age }] });
      const p = projectHousehold(candidate, ctx);
      if (p.status === 'ok' && p.value.summary.deterministicSuccess) {
        brute = age;
        break;
      }
    }
    expect(r.value.earliestAge).toBe(brute);
    expect(brute).not.toBeNull();
    expect(r.value.evaluated).toHaveLength(20);
    expect(r.value.criterion).toBe('deterministic');
  });

  it('shifts a couple together and returns null when no age works', () => {
    const base = couple();
    const shifted = withRetirementAge(base, base.people[0]!.retirementAge - 2)!;
    expect(shifted.people.map((p) => p.retirementAge)).toEqual(base.people.map((p) => p.retirementAge - 2));
    const poor = HouseholdSchema.parse({ ...retireeLike(), accounts: [] });
    const r = optimizeRetirementAge(poor, ctx, { kind: 'deterministic' }, { fromAge: 60, toAge: 62 });
    expect(r.status === 'ok' && r.value.earliestAge).toBeNull();
  });

  it('rejects a bad range and the Monte Carlo criterion until M6', () => {
    expect(
      optimizeRetirementAge(retireeLike(), ctx, { kind: 'deterministic' }, { fromAge: 70, toAge: 60 }).status,
    ).toBe('invalid');
    expect(
      optimizeRetirementAge(
        retireeLike(),
        ctx,
        { kind: 'monteCarlo', config: {} as never, minSuccessRate: 0.8 },
        { fromAge: 60, toAge: 61 },
      ).status,
    ).toBe('invalid');
  });
});

describe('compareScenarios', () => {
  it('returns the base and each scenario with dashboards, orphans and invalid scenarios marked', () => {
    const base = couple();
    const early = presetScenario(
      'B_earlyRetirement',
      base,
      { currentYear: YEAR },
      { scenarioId: 'b', name: 'Early', baseProfileId: base.id },
    );
    const broken = scenario([
      { op: 'set', collection: 'people', id: base.people[0]!.id, path: ['retirementAge'], value: 150 },
    ]);
    const orphan = scenario([{ op: 'set', collection: 'accounts', id: 'gone', path: ['balance'], value: 1 }]);
    const out = compareScenarios(base, [early, broken, orphan], ctx);
    expect(out.map((o) => [o.name, o.status])).toEqual([
      ['Base plan', 'ok'],
      ['Early', 'ok'],
      ['Test', 'invalid'],
      ['Test', 'ok'],
    ]);
    expect(out[3]!.orphaned).toHaveLength(1);
    expect(out[1]!.dashboard!.cards.firstRetirementYear).toBeLessThan(out[0]!.dashboard!.cards.firstRetirementYear);
    // Taxes are unverified with the bundled rules: no after-tax figure is invented.
    expect(out[0]!.afterTaxEndingBalanceReal).toBeNull();
  });
});
