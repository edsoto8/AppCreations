import { describe, expect, it } from 'vitest';
import { SAMPLE_PROFILES, type ExportBundle, type ProfileDoc, type ScenarioDoc } from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import { planImport, previewBundle } from './importPlan';

const AT = '2026-10-19T12:00:00.000Z';

function profileDoc(id: string, name: string): ProfileDoc {
  const household = SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(TEST_YEAR);
  return {
    kind: 'profile',
    schemaVersion: 1,
    id: id as ProfileDoc['id'],
    updatedAt: AT,
    household: { ...household, id: id as ProfileDoc['household']['id'], name },
  };
}

function scenarioDoc(id: string, base: string): ScenarioDoc {
  return {
    kind: 'scenario',
    schemaVersion: 1,
    id: id as ScenarioDoc['id'],
    updatedAt: AT,
    scenario: {
      id: id as ScenarioDoc['scenario']['id'],
      name: `Scenario ${id}`,
      baseProfileId: base as ScenarioDoc['scenario']['baseProfileId'],
      preset: null,
      presetParams: {},
      ops: [
        { op: 'set', collection: 'household', id: base as never, path: ['assumptions', 'inflation'], value: 0.04 },
        { op: 'set', collection: 'people', id: 'person-x' as never, path: ['retirementAge'], value: 66 },
      ],
    },
  };
}

function bundle(): ExportBundle {
  return {
    format: 'retirement-navigator-export',
    schemaVersion: 1,
    exportedAt: AT,
    profiles: [profileDoc('p-a', 'A'), profileDoc('p-b', 'B')],
    scenarios: [scenarioDoc('s-1', 'p-a'), scenarioDoc('s-2', 'p-b'), scenarioDoc('s-3', 'p-a')],
    settings: {
      kind: 'settings',
      schemaVersion: 1,
      id: 'settings',
      updatedAt: AT,
      activeProfileId: 'p-b' as never,
      onboardingComplete: false,
      dollarBasis: 'nominal',
    },
  };
}

let counter = 0;
const makeId = (prefix: string) => `${prefix}-new${++counter}`;
const none = { profiles: new Set<string>(), scenarios: new Set<string>() };

describe('planImport', () => {
  it('previews profile names, scenario counts and the schema version', () => {
    expect(previewBundle(bundle())).toEqual({
      schemaVersion: 1,
      exportedAt: AT,
      profiles: [
        { id: 'p-a', name: 'A', scenarios: 2 },
        { id: 'p-b', name: 'B', scenarios: 1 },
      ],
      scenarioCount: 3,
    });
  });

  it('replace keeps every document as it is and marks onboarding done when there are profiles', () => {
    const b = bundle();
    const plan = planImport(b, 'replace', { profiles: new Set(['p-a']), scenarios: new Set(['s-1']) }, makeId);
    expect(plan.profiles).toEqual(b.profiles);
    expect(plan.scenarios).toEqual(b.scenarios);
    expect(plan.settings).toEqual({ ...b.settings, onboardingComplete: true });
    expect(plan.remappedProfiles).toEqual({});
  });

  it('add leaves documents with free ids unchanged', () => {
    const b = bundle();
    const plan = planImport(b, 'add', none, makeId);
    expect(plan.profiles).toEqual(b.profiles);
    expect(plan.scenarios).toEqual(b.scenarios);
    expect(plan.settings).toBeNull();
  });

  it('add gives colliding ids fresh ones and remaps base profiles and household ops', () => {
    const b = bundle();
    const plan = planImport(b, 'add', { profiles: new Set(['p-a']), scenarios: new Set(['s-2']) }, makeId);
    const newA = plan.remappedProfiles['p-a']!;
    expect(newA).toMatch(/^household-new/);
    expect(plan.profiles[0]).toMatchObject({ id: newA, household: { id: newA, name: 'A' } });
    expect(plan.profiles[1]).toEqual(b.profiles[1]);
    // s-1 keeps its id but follows its profile's new id, including the op on the household itself.
    const s1 = plan.scenarios.find((s) => s.id === 's-1')!;
    expect(s1.scenario.baseProfileId).toBe(newA);
    expect(s1.scenario.ops[0]).toMatchObject({ collection: 'household', id: newA });
    expect(s1.scenario.ops[1]).toEqual(b.scenarios[0]!.scenario.ops[1]);
    // s-2 collides: fresh id, base unchanged.
    const newS2 = plan.remappedScenarios['s-2']!;
    const s2 = plan.scenarios.find((s) => s.id === newS2)!;
    expect(s2.scenario).toMatchObject({ id: newS2, baseProfileId: 'p-b' });
    expect(plan.scenarios.find((s) => s.id === 's-3')!.scenario.baseProfileId).toBe(newA);
  });
});
