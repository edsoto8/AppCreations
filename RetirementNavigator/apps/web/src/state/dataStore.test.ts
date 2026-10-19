/** Import, export and delete-all through the profile and scenario stores (BRIEF §5.11). */
import { describe, expect, it } from 'vitest';
import { exportJson, importJson, SAMPLE_PROFILES, type ExportBundle } from '@rn/engine';
import { setupProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from './profileStore';
import { useScenarioStore } from './scenarioStore';
import { clearStoredTheme, THEME_STORAGE_KEY, useSettingsStore } from './settingsStore';

async function seedScenario(profileId: string) {
  return useScenarioStore.getState().createScenario({
    id: 'scenario-seed' as never,
    name: 'Later retirement',
    baseProfileId: profileId as never,
    preset: null,
    presetParams: {},
    ops: [
      { op: 'set', collection: 'household', id: profileId as never, path: ['assumptions', 'inflation'], value: 0.04 },
    ],
  });
}

const okBundle = (text: string): ExportBundle => {
  const r = importJson(text);
  if (r.status !== 'ok') throw new Error('expected a valid bundle');
  return r.value;
};

describe('data stores', () => {
  it('exports a bundle that imports cleanly and replaces everything with identical documents', async () => {
    const { repo } = await setupProfile();
    const id = useProfileStore.getState().activeId!;
    await seedScenario(id);
    useProfileStore.getState().completeOnboarding();
    const text = exportJson(useProfileStore.getState().exportBundle('2026-10-19T12:00:00.000Z'));
    const bundle = okBundle(text);

    // Change the current data, then replace it with the file.
    await useProfileStore.getState().createProfile(SAMPLE_PROFILES[0]!.build(TEST_YEAR));
    useProfileStore.getState().renameProfile(id, 'Renamed');
    const result = await useProfileStore.getState().importBundle(bundle, 'replace');
    expect(result).toMatchObject({ status: 'ok', value: { profiles: 1, scenarios: 1, renamedIds: 0 } });
    await useProfileStore.getState().flush();

    const stored = (await repo.list('profile')).map((r) => (r.status === 'ok' ? r.value : null));
    expect(stored).toEqual(bundle.profiles);
    const scenarios = (await repo.list('scenario')).map((r) => (r.status === 'ok' ? r.value : null));
    expect(scenarios).toEqual(bundle.scenarios);
    expect(Object.values(useProfileStore.getState().profiles)).toEqual(bundle.profiles);
    expect(Object.values(useScenarioStore.getState().scenarios)).toEqual(bundle.scenarios);
    expect(useProfileStore.getState()).toMatchObject({ activeId: id, onboardingComplete: true });
  });

  it('adds alongside with fresh ids for colliding profiles and scenarios', async () => {
    const { repo } = await setupProfile();
    const id = useProfileStore.getState().activeId!;
    await seedScenario(id);
    const bundle = okBundle(exportJson(useProfileStore.getState().exportBundle('2026-10-19T12:00:00.000Z')));
    const result = await useProfileStore.getState().importBundle(bundle, 'add');
    expect(result).toMatchObject({ status: 'ok', value: { profiles: 1, scenarios: 1, renamedIds: 2 } });
    const profiles = useProfileStore.getState().profiles;
    expect(Object.keys(profiles)).toHaveLength(2);
    const added = Object.values(profiles).find((p) => p.id !== id)!;
    expect(added.household.id).toBe(added.id);
    const scenarios = Object.values(useScenarioStore.getState().scenarios);
    expect(scenarios.map((s) => s.scenario.baseProfileId).sort()).toEqual([id, added.id].sort());
    expect(useProfileStore.getState().activeId).toBe(id);
    expect(await repo.list('profile')).toHaveLength(2);
    expect(await repo.list('scenario')).toHaveLength(2);
  });

  it('deletes everything and returns to the first-run state', async () => {
    const { repo } = await setupProfile();
    await seedScenario(useProfileStore.getState().activeId!);
    useProfileStore.getState().completeOnboarding();
    useSettingsStore.getState().setTheme('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await useProfileStore.getState().deleteAllData();
    clearStoredTheme();
    await useProfileStore.getState().flush();
    expect(await repo.list('profile')).toEqual([]);
    expect(await repo.list('scenario')).toEqual([]);
    expect(await repo.get('settings', 'settings')).toBeNull();
    expect(useProfileStore.getState()).toMatchObject({ profiles: {}, activeId: null, onboardingComplete: false });
    expect(useScenarioStore.getState().scenarios).toEqual({});
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(useSettingsStore.getState().theme).toBe('system');
  });
});
