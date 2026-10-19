import { describe, expect, it } from 'vitest';
import { presetScenario, SAMPLE_PROFILES, type Scenario } from '@rn/engine';
import { setupProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from './profileStore';
import { scenariosOf, useScenarioStore } from './scenarioStore';

const custom = (id: string, baseProfileId: string, name = 'Custom'): Scenario =>
  ({ id, name, baseProfileId, preset: null, presetParams: {}, ops: [] }) as unknown as Scenario;

describe('scenario store', () => {
  it('persists a preset scenario as a ScenarioDoc and reloads it (store + repository round-trip)', async () => {
    const { repo } = await setupProfile();
    const profileId = useProfileStore.getState().activeId!;
    const base = useProfileStore.getState().profiles[profileId]!.household;
    const scenario = presetScenario(
      'B_earlyRetirement',
      base,
      { years: 5, currentYear: TEST_YEAR },
      { scenarioId: 'scenario-b', name: 'Retire early', baseProfileId: profileId },
    );
    const id = await useScenarioStore.getState().createScenario(scenario);
    expect(id).toBe('scenario-b');

    const stored = await repo.get('scenario', id);
    expect(stored?.status).toBe('ok');
    if (stored?.status !== 'ok') throw new Error('not stored');
    expect(stored.value).toMatchObject({ kind: 'scenario', schemaVersion: 1, id });
    expect(stored.value.scenario).toEqual(scenario);

    // Debounced edits are written on flush and survive a reload.
    useScenarioStore.getState().renameScenario(id, '  Early  ');
    useScenarioStore.getState().setOps(id, scenario.ops.slice(0, 1));
    await useProfileStore.getState().flush();
    await useProfileStore.getState().init(repo);
    const reloaded = useScenarioStore.getState().scenarios[id]!.scenario;
    expect(reloaded.name).toBe('Early');
    expect(reloaded.ops).toEqual(scenario.ops.slice(0, 1));
    expect(reloaded.preset).toBe('B_earlyRetirement');
    expect(reloaded.presetParams).toEqual({ years: 5 });
  });

  it('duplicates, deletes and never overwrites an existing id', async () => {
    const { repo } = await setupProfile();
    const profileId = useProfileStore.getState().activeId!;
    const store = useScenarioStore.getState();
    const first = await store.createScenario(custom('s-1', profileId, 'Zeta'));
    const second = await store.createScenario(custom('s-1', profileId, 'Alpha'));
    expect(second).not.toBe(first);
    const copy = (await useScenarioStore.getState().duplicateScenario(first))!;
    expect(useScenarioStore.getState().scenarios[copy]!.scenario.name).toBe('Zeta (copy)');
    expect(scenariosOf(useScenarioStore.getState().scenarios, profileId).map((s) => s.name)).toEqual([
      'Alpha',
      'Zeta',
      'Zeta (copy)',
    ]);
    await useScenarioStore.getState().deleteScenario(first);
    expect((await repo.list('scenario')).map((r) => (r.status === 'ok' ? r.value.id : null)).sort()).toEqual(
      [copy, second].sort(),
    );
  });

  it('deleting a profile deletes its scenarios (memory and IndexedDB) and keeps other profiles’ scenarios', async () => {
    const { repo } = await setupProfile();
    const keepId = useProfileStore.getState().activeId!;
    const doomedId = await useProfileStore.getState().createProfile(SAMPLE_PROFILES[0]!.build(TEST_YEAR));
    const store = useScenarioStore.getState();
    await store.createScenario(custom('keep-1', keepId));
    await store.createScenario(custom('gone-1', doomedId));
    await store.createScenario(custom('gone-2', doomedId));
    useScenarioStore.getState().renameScenario('gone-2', 'Pending save');

    await useProfileStore.getState().deleteProfile(doomedId);
    await useProfileStore.getState().flush();
    expect(Object.keys(useScenarioStore.getState().scenarios)).toEqual(['keep-1']);
    const stored = await repo.list('scenario');
    expect(stored.map((r) => (r.status === 'ok' ? r.value.id : null))).toEqual(['keep-1']);
  });
});
