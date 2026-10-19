import { describe, expect, it } from 'vitest';
import { SAMPLE_PROFILES } from '@rn/engine';
import { setupProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from './profileStore';

describe('profile store', () => {
  it('creates, persists and reloads profiles and settings', async () => {
    const { repo } = await setupProfile(SAMPLE_PROFILES[0]!.build(TEST_YEAR));
    const store = useProfileStore.getState();
    const id = store.activeId!;
    expect(store.profiles[id]!.household.name).toBe('Early career (sample)');
    store.renameProfile(id, '  My plan  ');
    store.completeOnboarding();
    store.setDollarBasis('nominal');
    await store.flush();
    // Reload from IndexedDB.
    await useProfileStore.getState().init(repo);
    const reloaded = useProfileStore.getState();
    expect(reloaded.profiles[id]!.household.name).toBe('My plan');
    expect(reloaded).toMatchObject({ activeId: id, onboardingComplete: true, dollarBasis: 'nominal', status: 'ready' });
  });

  it('updates the active household, duplicates and deletes profiles', async () => {
    const { repo } = await setupProfile();
    const store = useProfileStore.getState();
    const id = store.activeId!;
    const household = store.profiles[id]!.household;
    store.updateActiveHousehold({ ...household, name: 'Changed' });
    expect(useProfileStore.getState().profiles[id]!.household.name).toBe('Changed');
    const copyId = (await useProfileStore.getState().duplicateProfile(id))!;
    expect(copyId).not.toBe(id);
    expect(useProfileStore.getState().profiles[copyId]!.household.name).toBe('Changed (copy)');
    expect(useProfileStore.getState().activeId).toBe(copyId);
    await useProfileStore.getState().deleteProfile(copyId);
    expect(useProfileStore.getState().activeId).toBe(id);
    await useProfileStore.getState().flush();
    expect((await repo.list('profile')).length).toBe(1);
  });

  it('never overwrites an existing profile with the same household id', async () => {
    await setupProfile();
    const store = useProfileStore.getState();
    const first = store.activeId!;
    const household = store.profiles[first]!.household;
    const second = await store.createProfile({ ...household, name: 'Second' });
    const third = await useProfileStore.getState().createProfile({ ...household, name: 'Third' });
    expect([first, second, third]).toEqual([household.id, `${household.id}-2`, `${household.id}-3`]);
    const profiles = useProfileStore.getState().profiles;
    expect(profiles[first]!.household.name).toBe('Mid-career couple (sample)');
    expect(profiles[second]!.household).toMatchObject({ id: second, name: 'Second' });
    expect(profiles[third]!.household).toMatchObject({ id: third, name: 'Third' });
  });

  it('ignores renames to blank names and unknown ids', async () => {
    await setupProfile();
    const store = useProfileStore.getState();
    const id = store.activeId!;
    store.renameProfile(id, '   ');
    store.setActive('missing');
    expect(await store.duplicateProfile('missing')).toBeNull();
    expect(useProfileStore.getState().activeId).toBe(id);
    expect(useProfileStore.getState().profiles[id]!.household.name).toBe('Mid-career couple (sample)');
  });
});
