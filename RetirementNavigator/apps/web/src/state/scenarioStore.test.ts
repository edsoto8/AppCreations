import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  presetDrift,
  presetScenario,
  SAMPLE_PROFILES,
  type Household,
  type Scenario,
} from '@rn/engine';
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
    expect(stored.value).toMatchObject({ kind: 'scenario', schemaVersion: CURRENT_SCHEMA_VERSION, id });
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
    // presetScenario records the current year it was built for (contract 1.9.0).
    expect(reloaded.presetParams).toEqual({ currentYear: TEST_YEAR, years: 5 });
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

  it('init writes pending edits to the previous repository instead of dropping them', async () => {
    const { repo } = await setupProfile();
    const profileId = useProfileStore.getState().activeId!;
    await useScenarioStore.getState().createScenario(custom('s-pending', profileId, 'Before'));
    useScenarioStore.getState().renameScenario('s-pending', 'After');
    // Re-initialize before the debounced save fires: the rename still reaches the database.
    await useScenarioStore.getState().init(repo);
    const stored = await repo.get('scenario', 's-pending');
    expect(stored?.status === 'ok' ? stored.value.scenario.name : null).toBe('After');
    expect(useScenarioStore.getState().scenarios['s-pending']!.scenario.name).toBe('After');
  });

  it('setOps with asCustom turns a preset into a custom scenario; rebuildPreset follows the current base', async () => {
    await setupProfile();
    const profileId = useProfileStore.getState().activeId!;
    const base = useProfileStore.getState().profiles[profileId]!.household;
    const ids = { scenarioId: 'scenario-f', name: 'Spend less', baseProfileId: profileId };
    const f = presetScenario('F_reducedSpending', base, { cut: 0.2, currentYear: TEST_YEAR }, ids);
    await useScenarioStore.getState().createScenario(f);

    // The base plan's retirement spending changes: F stored the reduced amount, so it drifts.
    const edited = {
      ...base,
      spending: { ...base.spending, retirementAnnualSpending: base.spending.retirementAnnualSpending + 1_000_000 },
    } as Household;
    expect(presetDrift(useScenarioStore.getState().scenarios['scenario-f']!.scenario, edited)).toBe(true);
    useScenarioStore.getState().rebuildPreset('scenario-f', edited, TEST_YEAR + 1);
    const rebuilt = useScenarioStore.getState().scenarios['scenario-f']!.scenario;
    const expected = presetScenario('F_reducedSpending', edited, { cut: 0.2, currentYear: TEST_YEAR + 1 }, ids);
    expect(rebuilt.ops).toEqual(expected.ops);
    expect(rebuilt.presetParams).toEqual({ cut: 0.2, currentYear: TEST_YEAR + 1 });
    expect(rebuilt.preset).toBe('F_reducedSpending');
    expect(presetDrift(rebuilt, edited)).toBe(false);

    useScenarioStore.getState().setOps('scenario-f', rebuilt.ops.slice(0, 1), { asCustom: true });
    const custom = useScenarioStore.getState().scenarios['scenario-f']!.scenario;
    expect(custom.preset).toBeNull();
    expect(custom.presetParams).toEqual({});
    expect(custom.ops).toEqual(rebuilt.ops.slice(0, 1));

    // Rebuilding a custom scenario does nothing.
    useScenarioStore.getState().rebuildPreset('scenario-f', base, TEST_YEAR);
    expect(useScenarioStore.getState().scenarios['scenario-f']!.scenario).toEqual(custom);
  });

  it('deletes a profile’s scenarios before the profile itself', async () => {
    const { repo } = await setupProfile();
    const doomedId = await useProfileStore.getState().createProfile(SAMPLE_PROFILES[0]!.build(TEST_YEAR));
    await useScenarioStore.getState().createScenario(custom('gone-1', doomedId));
    const order: string[] = [];
    const original = repo.delete.bind(repo);
    repo.delete = (async (...args: Parameters<typeof repo.delete>) => {
      order.push(args[0]);
      return original(...args);
    }) as typeof repo.delete;
    await useProfileStore.getState().deleteProfile(doomedId);
    expect(order).toEqual(['scenario', 'profile']);
  });
});
