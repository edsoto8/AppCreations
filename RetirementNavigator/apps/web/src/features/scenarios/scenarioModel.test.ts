import { describe, expect, it } from 'vitest';
import { applyScenario, SAMPLE_PROFILES, type Scenario, type ScenarioOp } from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import {
  buildPreset,
  describeOp,
  issueLabel,
  issueText,
  lastPlanYear,
  overrideError,
  paramLimits,
  marketShockValue,
  orphanMessage,
  overrideTargets,
  paramError,
  PRESET_BY_ID,
  PRESETS,
  presetSummary,
  shockParams,
  withOverride,
  withoutOp,
} from './scenarioModel';

const couple = () => SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(TEST_YEAR);
const ids = { scenarioId: 'scn', name: 'Scenario', baseProfileId: 'profile' };

describe('scenario view model', () => {
  it('builds every preset through the engine and summarizes its parameters', () => {
    const base = couple();
    const summaries = PRESETS.map((p) => presetSummary(buildPreset(p.id, base, p.defaults, ids, TEST_YEAR)));
    expect(summaries[0]).toBe('Preset A: no changes');
    expect(summaries[1]).toBe('Preset B: 5 years earlier');
    expect(summaries[2]).toBe('Preset C: deferrals +5% of pay');
    expect(summaries[3]).toMatch(/^Preset D: -30% over 1 year from \d{4}$/);
    expect(summaries[4]).toBe('Preset E: 3 years later');
    expect(summaries[5]).toBe('Preset F: retirement spending −10%');
    expect(summaries[6]).toBe('Preset G: workplace deferrals to Roth');
    expect(PRESET_BY_ID.F_reducedSpending.defaultName({ cut: 0.15 })).toBe('Spend 15% less in retirement');
  });

  it('validates preset parameters against their ranges', () => {
    const [years] = PRESET_BY_ID.E_delayedRetirement.fields;
    expect(paramError(years!, 4)).toBeNull();
    expect(paramError(years!, 2)).toBe('Must be at least 3');
    expect(paramError(years!, 3.5)).toBe('Enter a whole number');
    expect(paramError(years!, undefined)).toBe('Enter a value');
    const [cut] = PRESET_BY_ID.F_reducedSpending.fields;
    expect(paramError(cut!, 0.95)).toBe('Must be at most 90%');
  });

  it('round-trips a market shock through the engine sequence', () => {
    const base = couple();
    const value = marketShockValue(base, { severity: -0.4, durationYears: 2, startYear: TEST_YEAR + 3 }, TEST_YEAR);
    expect(shockParams(value)).toEqual({ severity: -0.4, durationYears: 2, startYear: TEST_YEAR + 3 });
    expect(shockParams(null)).toBeNull();
  });

  it('lists override targets per entity and replaces, rather than duplicates, an override', () => {
    const base = couple();
    const targets = overrideTargets(base);
    const keys = targets.map((t) => t.key);
    expect(keys).toContain('people:sam:retirementAge');
    expect(keys).toContain('people:jordan:socialSecurity.claimAge');
    expect(keys).toContain('workplacePlans:sam-plan:traditionalPctOfSalary');
    expect(keys).not.toContain('workplacePlans:sam-plan:rothPctOfSalary'); // the plan has no Roth account
    expect(keys).toContain(`household:${base.id}:assumptions.marketShock`);
    const target = targets.find((t) => t.key === 'people:sam:retirementAge')!;
    const once = withOverride([], target, 60);
    const twice = withOverride(once, target, 61);
    expect(twice).toEqual([{ op: 'set', collection: 'people', id: 'sam', path: ['retirementAge'], value: 61 }]);
    expect(withoutOp(twice, 0)).toEqual([]);
  });

  it('describes ops and orphaned ops in plain language', () => {
    const base = couple();
    const ops = [
      { op: 'set', collection: 'people', id: 'sam', path: ['retirementAge'], value: 60 },
      { op: 'set', collection: 'workplacePlans', id: 'sam-plan', path: ['traditionalPctOfSalary'], value: 0.13 },
      {
        op: 'set',
        collection: 'household',
        id: base.id,
        path: ['spending', 'retirementAnnualSpending'],
        value: 7_200_000,
      },
      {
        op: 'set',
        collection: 'household',
        id: base.id,
        path: ['assumptions', 'withdrawalStrategy'],
        value: 'rothLast',
      },
      {
        op: 'set',
        collection: 'people',
        id: 'jordan',
        path: ['socialSecurity', 'claimAge'],
        value: { years: 68, months: 6 },
      },
      { op: 'unset', collection: 'accounts', id: 'gone', path: null },
    ] as unknown as ScenarioOp[];
    expect(ops.map((op) => describeOp(op, base))).toEqual([
      'Sam: retirement age → 60',
      'Sam’s 401(k) plan: traditional % of salary → 13%',
      'Household: retirement spending → $72,000',
      'Household: withdrawal strategy → Roth last',
      'Jordan: Social Security claiming age → 68 years 6 months',
      'an account (“gone”): removed in this scenario',
    ]);
    const scenario = { ...ids, preset: null, presetParams: {}, ops } as unknown as Scenario;
    const applied = applyScenario(base, scenario);
    expect(applied.orphaned.map((o) => orphanMessage(o, base))).toEqual([
      'This scenario changes something that no longer exists in the base plan: an account (“gone”): removed in this scenario. It is not applied.',
    ]);
  });

  it('bounds preset D: severity above −100%, start year from this year to the last plan year', () => {
    const base = couple();
    const fields = PRESET_BY_ID.D_marketDownturn.fields;
    const severity = fields.find((f) => f.key === 'severity')!;
    const start = fields.find((f) => f.key === 'startYear')!;
    const limits = paramLimits(base, TEST_YEAR);
    expect(paramError(severity, -1)).toBe('Must be above -100%');
    expect(paramError(severity, -0.99)).toBeNull();
    expect(paramError(severity, 0.01)).toBe('Must be at most 0%');
    expect(lastPlanYear(base)).toBe(TEST_YEAR - 40 + 96); // Jordan: born 40 years ago, planning age 96
    expect(paramError(start, TEST_YEAR - 1, limits)).toBe(`Must be at least ${TEST_YEAR}`);
    expect(paramError(start, TEST_YEAR, limits)).toBeNull();
    expect(paramError(start, lastPlanYear(base) + 1, limits)).toBe(`Must be at most ${lastPlanYear(base)}`);
  });

  it('reads a shock’s total drop with the engine’s marketShockTotal', () => {
    expect(shockParams({ startYear: 2030, returns: [-0.5, -0.5] })).toEqual({
      severity: -0.75,
      durationYears: 2,
      startYear: 2030,
    });
  });

  it('names invalid-scenario issue paths in words', () => {
    const base = couple();
    expect(issueLabel(['people', 0, 'retirementAge'], base)).toBe('Sam › Retirement age');
    expect(issueLabel(['people', 1, 'socialSecurity', 'claimAge'], base)).toBe('Jordan › Social Security claiming age');
    expect(issueLabel(['people', 0, 'workplacePlans', 0, 'traditionalPctOfSalary'], base)).toBe(
      'Sam’s 401(k) plan › Traditional % of salary',
    );
    expect(issueLabel(['spending', 'retirementAnnualSpending'], base)).toBe('Household › Retirement spending');
    expect(issueLabel(['accounts', 0, 'balance'], base)).toBe(`${base.accounts[0]!.name} › Balance`);
    // A person removed by the scenario shifts the indexes.
    const removeSam = {
      ...ids,
      preset: null,
      presetParams: {},
      ops: [{ op: 'unset', collection: 'people', id: 'sam', path: null }],
    } as unknown as Scenario;
    expect(issueLabel(['people', 0, 'planningAge'], base, removeSam)).toBe('Jordan › Planning age');
    expect(issueText({ path: ['people', 0, 'planningAge'], message: 'Too big' }, base)).toBe(
      'Sam › Planning age: Too big',
    );
    expect(issueText({ path: [], message: 'Whole plan' }, base)).toBe('Whole plan');
  });

  it('range-checks override values', () => {
    const targets = overrideTargets(couple());
    const t = (key: string) => targets.find((x) => x.key === key)!;
    expect(overrideError(t('people:sam:retirementAge'), 121)).toBe('Must be between 0 and 120');
    expect(overrideError(t('people:sam:retirementAge'), 60)).toBeNull();
    expect(overrideError(t('people:sam:socialSecurity.claimAge'), { years: 61, months: 11 })).toBe(
      'Claiming age must be between 62 and 70',
    );
    expect(overrideError(t('people:sam:socialSecurity.claimAge'), { years: 67, months: 12 })).toBe(
      'Months must be from 0 to 11',
    );
    expect(overrideError(t('workplacePlans:sam-plan:traditionalPctOfSalary'), 1.2)).toBe('Must be between 0% and 100%');
    const spending = targets.find((x) => x.label === 'Retirement spending (per year)')!;
    expect(overrideError(spending, -1)).toBe('Amount cannot be negative');
    const inflation = targets.find((x) => x.label === 'Inflation')!;
    expect(overrideError(inflation, -0.5)).toBe('Must be above −50% and at most 50%');
  });
});
