/** Scenario diffs, presets A–G, the optimizer and comparison (docs/financial-model.md §10). */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, type Household } from '../domain/household';
import { ScenarioSchema, type Scenario, type ScenarioOp } from '../domain/scenario';
import { SAMPLE_PROFILES } from '../samples/profiles';
import { minimalHouseholdInput } from '../samples/minimal';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { projectHousehold } from '../projection/project';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import { runMonteCarloChunk } from '../montecarlo/run';
import {
  applyScenario,
  compareScenarios,
  marketShockTotal,
  optimizeRetirementAge,
  presetDrift,
  presetScenario,
  withRetirementAge,
} from './scenario';

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

  it('rejects a bad range and an invalid Monte Carlo criterion', () => {
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

  it('Monte Carlo criterion: each age scored on the quick-run paths, earliest meeting the target rate', () => {
    const h = retireeLike();
    const config = {
      paths: 1000,
      quickRunPaths: 100,
      seed: 5,
      inflation: { mode: 'fixed' as const },
      rebalancing: 'annual' as const,
    };
    const r = optimizeRetirementAge(
      h,
      ctx,
      { kind: 'monteCarlo', config, minSuccessRate: 0.8 },
      { fromAge: 58, toAge: 64 },
    );
    if (r.status !== 'ok') throw new Error(JSON.stringify(r));
    expect(r.value.criterion).toBe('monteCarlo');
    // Brute force: the same paths through runMonteCarloChunk for each candidate.
    for (const e of r.value.evaluated) {
      const candidate = withRetirementAge(h, e.age, YEAR)!;
      const chunk = runMonteCarloChunk(candidate, ctx, config, { pathStart: 0, pathEnd: 100 });
      if (chunk.status !== 'ok') throw new Error('chunk');
      const rate = chunk.value.success.reduce((n, v) => n + v, 0) / 100;
      expect(e.successRate).toBe(rate);
      expect(e.success).toBe(rate >= 0.8);
    }
    expect(r.value.earliestAge).toBe(r.value.evaluated.find((e) => e.success)?.age ?? null);
    const rates = r.value.evaluated.map((e) => e.successRate!);
    expect(rates[rates.length - 1]!).toBeGreaterThanOrEqual(rates[0]!); // working longer helps here
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

describe('M5 review: path safety, retirees, drift and the after-tax figure', () => {
  const ids = { scenarioId: 's', name: 'Preset', baseProfileId: 'base' };

  it('rejects prototype keys and reports unknown fields as invalid paths instead of applying them', () => {
    const base = couple();
    const sam = base.people[0]!.id;
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const parsed = ScenarioSchema.safeParse({
        id: 'sc',
        name: 'X',
        baseProfileId: 'base',
        ops: [{ op: 'set', collection: 'people', id: sam, path: [key, 'polluted'], value: 1 }],
      });
      expect(parsed.success).toBe(false);
    }
    const r = applyScenario(
      base,
      scenario([
        { op: 'set', collection: 'people', id: sam, path: ['retirementAgee'], value: 60 },
        { op: 'set', collection: 'people', id: sam, path: ['employment', 'nope', 'deeper'], value: 1 },
        { op: 'unset', collection: 'people', id: sam, path: ['toString'] },
      ]),
    );
    expect(r.appliedOps).toBe(0);
    expect(r.orphaned.map((o) => o.reason)).toEqual(['invalidPath', 'invalidPath', 'invalidPath']);
    expect(r.household).toEqual(base);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('unsetting a required field makes the scenario invalid (issues, no household)', () => {
    const base = couple();
    const r = applyScenario(
      base,
      scenario([{ op: 'unset', collection: 'people', id: base.people[0]!.id, path: ['birthYear'] }]),
    );
    expect(r.household).toBeNull();
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('orphans plan ops and plan additions after their person is deleted from the base', () => {
    const full = couple();
    const jordan = full.people[1]!;
    const plan = jordan.workplacePlans[0];
    const base = HouseholdSchema.parse({
      ...full,
      filingStatus: 'single',
      people: [full.people[0]!],
      accounts: full.accounts.filter((a) => a.ownerId !== jordan.id),
      otherIncome: full.otherIncome.filter((i) => i.ownerId !== jordan.id),
      pensions: full.pensions.filter((p) => p.ownerId !== jordan.id),
    });
    const r = applyScenario(
      base,
      scenario([
        ...(plan
          ? [{ op: 'set', collection: 'workplacePlans', id: plan.id, path: ['traditionalPctOfSalary'], value: 0.1 }]
          : []),
        { op: 'add', collection: 'workplacePlans', parentId: jordan.id, entity: {} },
      ]),
    );
    expect(r.orphaned.map((o) => o.reason)).toEqual([...(plan ? ['missingEntity'] : []), 'missingParent']);
  });

  const retiredCouple = () =>
    HouseholdSchema.parse({
      ...couple(),
      people: couple().people.map((p, i) => ({
        ...p,
        birthYear: YEAR - (i === 0 ? 66 : 63),
        retirementAge: i === 0 ? 65 : 70,
        employment: i === 0 ? null : p.employment,
        workplacePlans: i === 0 ? [] : p.workplacePlans,
      })),
    });

  it('B and E leave someone already retired alone; D never starts before the current year', () => {
    const base = retiredCouple();
    const [retired, working] = base.people;
    const b = presetScenario('B_earlyRetirement', base, { currentYear: YEAR, years: 5 }, ids);
    const e = presetScenario('E_delayedRetirement', base, { currentYear: YEAR, years: 3 }, ids);
    const targets = (s: Scenario) =>
      s.ops.flatMap((o) => (o.op === 'set' && o.path[0] === 'retirementAge' ? [o.id] : []));
    expect(targets(b)).toEqual([working!.id]);
    expect(targets(e)).toEqual([working!.id]);
    expect(applyScenario(base, e).household!.people[0]!.retirementAge).toBe(retired!.retirementAge);
    // A fully retired household: the first retirement year (2023 here) is in the past, so the
    // shock starts in the current year; an entered past year moves up too.
    const allRetired = HouseholdSchema.parse({
      ...base,
      people: base.people.map((p) => ({ ...p, retirementAge: 60, employment: null, workplacePlans: [] })),
    });
    const dflt = presetScenario('D_marketDownturn', allRetired, { currentYear: YEAR }, ids);
    expect(applyScenario(allRetired, dflt).household!.assumptions.marketShock!.startYear).toBe(2026);
    const past = presetScenario('D_marketDownturn', allRetired, { currentYear: YEAR, startYear: 2010 }, ids);
    expect(past.presetParams.startYear).toBe(2026);
    expect(past.presetParams.currentYear).toBe(2026);
  });

  it('detects a preset whose stored values no longer match the base, and reports the shock total', () => {
    const base = couple();
    const f = presetScenario('F_reducedSpending', base, { currentYear: YEAR, cut: 0.2 }, ids);
    expect(presetDrift(f, base)).toBe(false);
    const changed = HouseholdSchema.parse({
      ...base,
      spending: {
        ...base.spending,
        retirementAnnualSpending: base.spending.retirementAnnualSpending + dollars(10_000),
      },
    });
    expect(presetDrift(f, changed)).toBe(true);
    expect(presetDrift(scenario([]), changed)).toBe(false);
    // F rounds half to even (§1.3): 0.9 × 12,345 cents = 11,110.5 → 11,110.
    const odd = HouseholdSchema.parse({
      ...base,
      spending: { ...base.spending, retirementAnnualSpending: 12_345, steps: [] },
    });
    const f10 = presetScenario('F_reducedSpending', odd, { currentYear: YEAR, cut: 0.1 }, ids);
    expect(applyScenario(odd, f10).household!.spending.retirementAnnualSpending).toBe(11_110);
    expect(marketShockTotal([-0.2, -0.125])).toBeCloseTo(-0.3, 12);
    expect(marketShockTotal([])).toBe(0);
  });

  it('optimizer: brute force with a working partner and salary stop ages; refuses a retired first person', () => {
    const base = couple();
    const h = HouseholdSchema.parse({
      ...base,
      people: base.people.map((p) => ({
        ...p,
        employment: p.employment ? { ...p.employment, stopAge: p.retirementAge - 1 } : null,
      })),
    });
    const [p1, p2] = h.people;
    const from = YEAR - p1!.birthYear + 1;
    const r = optimizeRetirementAge(h, ctx, { kind: 'deterministic' }, { fromAge: from, toAge: 75 });
    if (r.status !== 'ok') throw new Error(JSON.stringify(r));
    // Brute force written separately: both ages set directly, stop ages cleared.
    const results: { age: number; success: boolean }[] = [];
    for (let age = from; age <= 75; age++) {
      const delta = age - p1!.retirementAge;
      const parsed = HouseholdSchema.safeParse({
        ...h,
        people: [
          { ...p1!, retirementAge: age, employment: p1!.employment && { ...p1!.employment, stopAge: null } },
          {
            ...p2!,
            retirementAge: p2!.retirementAge + delta,
            employment: p2!.employment && { ...p2!.employment, stopAge: null },
          },
        ],
      });
      if (!parsed.success) continue;
      const p = projectHousehold(parsed.data, ctx);
      if (p.status === 'ok') results.push({ age, success: p.value.summary.deterministicSuccess });
    }
    expect(r.value.evaluated.map((e) => ({ age: e.age, success: e.success }))).toEqual(results);
    expect(r.value.earliestAge).toBe(results.find((x) => x.success)?.age ?? null);

    const retired = retiredCouple();
    expect(optimizeRetirementAge(retired, ctx, { kind: 'deterministic' }, { fromAge: 66, toAge: 70 }).status).toBe(
      'invalid',
    );
    expect(optimizeRetirementAge(h, ctx, { kind: 'deterministic' }, { fromAge: from - 5, toAge: 75 }).status).toBe(
      'invalid',
    );
    // A retired partner stays put when the first person's age moves.
    const mixed = HouseholdSchema.parse({ ...retired, people: [retired.people[1]!, retired.people[0]!] });
    const moved = withRetirementAge(mixed, 68, YEAR)!;
    expect(moved.people[1]!.retirementAge).toBe(mixed.people[1]!.retirementAge);
  });

  it('after-tax ending balance: real end minus the final marginal rate on tax-deferred money (fixture)', () => {
    // Single, 69 and 70 (planning age 70), no inflation or returns; cash pays $20,000 a year
    // (taxable first), so taxable income is 0 and the marginal rate is the first bracket's 10%.
    // End: cash 100,000 − 40,000 = 60,000; IRA 200,000 untouched (RMDs start at 71).
    // After-tax = 260,000 − 10% × 200,000 = 240,000.
    const h = HouseholdSchema.parse({
      ...minimalHouseholdInput(YEAR),
      people: [
        {
          ...minimalHouseholdInput(YEAR).people[0]!,
          birthYear: YEAR - 69,
          retirementAge: 65,
          planningAge: 70,
          employment: null,
          workplacePlans: [],
        },
      ],
      accounts: [
        { type: 'cash', id: 'cash', name: 'Cash', ownerId: 'person-1', balance: dollars(100_000), expectedReturn: 0 },
        {
          type: 'traditionalIra',
          id: 'ira',
          name: 'IRA',
          ownerId: 'person-1',
          balance: dollars(200_000),
          expectedReturn: 0,
        },
      ],
      spending: { currentAnnualSpending: dollars(20_000), retirementAnnualSpending: dollars(20_000) },
      assumptions: { ...minimalHouseholdInput(YEAR).assumptions, inflation: 0 },
    });
    const [baseOutcome] = compareScenarios(h, [], { currentYear: FIXTURE_YEAR, rules: fixtureRules() });
    expect(baseOutcome!.afterTaxEndingBalanceReal).toBe(dollars(240_000));
  });
});

describe('diff and preset edge cases', () => {
  const ids = { scenarioId: 's', name: 'Preset', baseProfileId: 'base' };

  it('handles household ops, array paths and paths through non-objects', () => {
    const base = couple();
    const sam = base.people[0]!;
    const r = applyScenario(
      base,
      scenario([
        { op: 'set', collection: 'household', id: 'someone-else', path: ['name'], value: 'X' },
        { op: 'unset', collection: 'household', id: base.id },
        { op: 'set', collection: 'people', id: sam.id, path: ['name', 'first'], value: 'X' },
        { op: 'set', collection: 'household', id: base.id, path: ['spending', 'steps', 5], value: {} },
        { op: 'set', collection: 'household', id: base.id, path: ['spending', 'steps', 'x'], value: {} },
        { op: 'unset', collection: 'household', id: base.id, path: ['spending', 'steps', 0] },
        {
          op: 'set',
          collection: 'household',
          id: base.id,
          path: ['spending', 'steps', base.spending.steps.length],
          value: { fromAge: 80, annualSpending: dollars(30_000) },
        },
      ]),
    );
    expect(r.orphaned.map((o) => o.reason)).toEqual([
      'missingEntity',
      'invalidPath',
      'invalidPath',
      'invalidPath',
      'invalidPath',
      'invalidPath',
    ]);
    expect(r.appliedOps).toBe(1);
    expect(r.household!.spending.steps.at(-1)).toEqual({ fromAge: 80, annualSpending: dollars(30_000) });
  });

  it('presets without a current year, C with IRAs to max and a Roth-only plan, G without a Roth account', () => {
    const base = couple();
    const b = presetScenario('B_earlyRetirement', base, { years: 2 }, ids);
    expect(b.presetParams.currentYear).toBeUndefined();
    expect(applyScenario(base, b).household!.people[0]!.retirementAge).toBe(base.people[0]!.retirementAge - 2);
    const early = SAMPLE_PROFILES.find((x) => x.id === 'earlyCareer')!.build(YEAR);
    const rothOnly = HouseholdSchema.parse({
      ...early,
      people: early.people.map((p) => ({
        ...p,
        workplacePlans: p.workplacePlans.map((plan) => ({
          ...plan,
          traditionalPctOfSalary: 0,
          rothPctOfSalary: 0.04,
        })),
      })),
    });
    const c = presetScenario('C_aggressiveSavings', rothOnly, { currentYear: YEAR, irasToMax: true }, ids);
    const applied = applyScenario(rothOnly, c).household!;
    const plans = applied.people.flatMap((p) => p.workplacePlans);
    for (const plan of plans) expect(plan.rothPctOfSalary).toBeCloseTo(0.09, 12);
    const iras = applied.accounts.filter((a) => a.type === 'traditionalIra' || a.type === 'rothIra');
    for (const a of iras) expect(a.contribution?.amount).toEqual({ kind: 'maxAllowed' });
    expect(c.presetParams.irasToMax).toBe(true);
    const noRoth = HouseholdSchema.parse({
      ...base,
      people: base.people.map((p) => ({
        ...p,
        workplacePlans: p.workplacePlans.map((plan) => ({
          ...plan,
          planOffersRoth: false,
          rothAccountId: null,
          rothPctOfSalary: 0,
          rothPctOfBonus: 0,
        })),
      })),
    });
    expect(presetScenario('G_rothStrategy', noRoth, { currentYear: YEAR }, ids).ops).toEqual([]);
  });

  it('optimizer rejects a target rate outside (0, 1]; comparison marks a plan that cannot project', () => {
    const base = couple();
    const config = {
      paths: 1000,
      quickRunPaths: 100,
      seed: 1,
      inflation: { mode: 'fixed' as const },
      rebalancing: 'annual' as const,
    };
    for (const minSuccessRate of [0, 1.5]) {
      expect(
        optimizeRetirementAge(base, ctx, { kind: 'monteCarlo', config, minSuccessRate }, { fromAge: 50, toAge: 51 })
          .status,
      ).toBe('invalid');
    }
    // A scenario whose planning ages end before the current year: valid household, no projection.
    const past = scenario(
      base.people
        .map((p) => ({
          op: 'set',
          collection: 'people',
          id: p.id,
          path: ['planningAge'],
          value: YEAR - p.birthYear - 1,
        }))
        .concat(
          base.people.map((p) => ({ op: 'set', collection: 'people', id: p.id, path: ['retirementAge'], value: 30 })),
        ),
    );
    const [, outcome] = compareScenarios(base, [past], ctx);
    expect(outcome!.status).toBe('invalid');
    expect(outcome!.dashboard).toBeNull();
  });
});
