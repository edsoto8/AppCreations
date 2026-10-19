import { describe, expect, it } from 'vitest';
import { applyScenario, SAMPLE_PROFILES, type Scenario, type ScenarioOp } from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import {
  buildPreset,
  describeOp,
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
});
