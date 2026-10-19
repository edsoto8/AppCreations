import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { projectHousehold, RULES, SAMPLE_PROFILES, toCsv, type ExportBundle } from '@rn/engine';
import { setupProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { useScenarioStore } from '@/state/scenarioStore';
import { THEME_STORAGE_KEY } from '@/state/settingsStore';
import { CURRENT_YEAR } from '@/app/env';
import { DataPage } from './DataPage';

/** Every download: the Blob handed to URL.createObjectURL and the file name on the clicked link. */
let downloads: { blob: Blob; name: string }[] = [];
let pendingBlob: Blob | null = null;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    pendingBlob = blob;
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (pendingBlob) downloads.push({ blob: pendingBlob, name: this.download });
    pendingBlob = null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/data']}>
      <Routes>
        <Route path="/data" element={<DataPage />} />
        <Route path="/welcome" element={<h1>Welcome stub</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function setup() {
  const ctx = await setupProfile();
  const profileId = useProfileStore.getState().activeId!;
  await useScenarioStore.getState().createScenario({
    id: 'scenario-seed' as never,
    name: 'Higher inflation',
    baseProfileId: profileId as never,
    preset: null,
    presetParams: {},
    ops: [
      { op: 'set', collection: 'household', id: profileId as never, path: ['assumptions', 'inflation'], value: 0.04 },
    ],
  });
  useProfileStore.getState().completeOnboarding();
  const user = userEvent.setup();
  renderPage();
  return { ...ctx, profileId, user };
}

const okValues = async <T,>(list: Promise<({ status: 'ok'; value: T } | { status: string })[]>) =>
  (await list).map((r) => ('value' in r ? r.value : r));

async function exportFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Export JSON' }));
  const last = downloads.at(-1)!;
  return { text: await last.blob.text(), name: last.name };
}

const fileInput = () => screen.getByLabelText('Export file (.json)');
const jsonFile = (text: string, name = 'backup.json') => new File([text], name, { type: 'application/json' });

describe('DataPage', () => {
  it('keeps the privacy statements', async () => {
    await setup();
    expect(screen.getByText(/Stored on this device, unencrypted/)).toBeInTheDocument();
    expect(screen.getByText(/makes no network requests with your data/)).toBeInTheDocument();
  });

  it('round-trips export → import (replace) through the UI with identical documents', async () => {
    const { user, repo, profileId } = await setup();
    const { text, name } = await exportFile(user);
    expect(name).toMatch(/^retirement-navigator-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(screen.getByText(/Exported 1 profile and 1 scenario/)).toBeInTheDocument();
    const exported = JSON.parse(text) as ExportBundle;

    // Change the data, then restore the file.
    await useProfileStore.getState().createProfile(SAMPLE_PROFILES[0]!.build(TEST_YEAR), { activate: false });
    useProfileStore.getState().renameProfile(profileId, 'Changed');
    await useScenarioStore.getState().deleteScenario('scenario-seed');

    await user.upload(fileInput(), jsonFile(text));
    const preview = await screen.findByRole('region', { name: 'Ready to import backup.json' });
    expect(within(preview).getByText('Mid-career couple (sample)')).toBeInTheDocument();
    expect(within(preview).getByText(/^1 scenario/)).toBeInTheDocument();
    expect(within(preview).getByText('Schema version').nextSibling).toHaveTextContent('1');
    await user.click(within(preview).getByRole('button', { name: 'Replace all data' }));
    await screen.findByText(/Imported 1 profile and 1 scenario from backup.json, replacing the previous data/);
    await useProfileStore.getState().flush();

    expect(await okValues(repo.list('profile'))).toEqual(exported.profiles);
    expect(await okValues(repo.list('scenario'))).toEqual(exported.scenarios);
    expect(Object.values(useProfileStore.getState().profiles)).toEqual(exported.profiles);
    expect(Object.values(useScenarioStore.getState().scenarios)).toEqual(exported.scenarios);
  });

  it('shows every problem in a malformed file and changes nothing', async () => {
    const { user, repo } = await setup();
    const { text } = await exportFile(user);
    const profilesBefore = await okValues(repo.list('profile'));
    const scenariosBefore = await okValues(repo.list('scenario'));
    const stateBefore = useProfileStore.getState().profiles;

    await user.upload(fileInput(), jsonFile('{ not json', 'broken.json'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('broken.json was not imported. Nothing was changed.');
    expect(alert).toHaveTextContent(/The file: The file is not valid JSON/);

    const bad = JSON.parse(text) as { profiles: { household: { people: { birthYear: unknown }[] } }[] };
    bad.profiles[0]!.household.people[1]!.birthYear = 'nineteen-eighty';
    await user.upload(fileInput(), jsonFile(JSON.stringify(bad), 'edited.json'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('edited.json was not imported'));
    expect(screen.getByRole('alert')).toHaveTextContent('Profile 1 › person 2 › birth year:');
    expect(screen.getByRole('alert')).toHaveTextContent('profiles[0].household.people[1].birthYear');

    const orphan = JSON.parse(text) as { scenarios: { scenario: { baseProfileId: string } }[] };
    orphan.scenarios[0]!.scenario.baseProfileId = 'someone-else';
    await user.upload(fileInput(), jsonFile(JSON.stringify(orphan), 'orphan.json'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('orphan.json was not imported'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Scenario 1 › base profile id: Scenario “Higher inflation” refers to a profile that is not in the file',
    );

    expect(screen.queryByRole('button', { name: 'Replace all data' })).not.toBeInTheDocument();
    expect(await okValues(repo.list('profile'))).toEqual(profilesBefore);
    expect(await okValues(repo.list('scenario'))).toEqual(scenariosBefore);
    expect(useProfileStore.getState().profiles).toBe(stateBefore);
  });

  it('adds alongside: colliding ids get fresh ones and scenarios follow their profile', async () => {
    const { user, repo, profileId } = await setup();
    const { text } = await exportFile(user);
    await user.upload(fileInput(), jsonFile(text));
    const preview = await screen.findByRole('region', { name: 'Ready to import backup.json' });
    expect(within(preview).getByText(/1 scenario · already on this device/)).toBeInTheDocument();
    await user.click(within(preview).getByRole('button', { name: 'Add alongside' }));
    await screen.findByText(/alongside your existing data\. 2 ids already in use were given a new one\./);

    const profiles = Object.values(useProfileStore.getState().profiles);
    expect(profiles).toHaveLength(2);
    const added = profiles.find((p) => p.id !== profileId)!;
    expect(added.household).toMatchObject({ id: added.id, name: 'Mid-career couple (sample)' });
    const scenarios = Object.values(useScenarioStore.getState().scenarios);
    expect(scenarios).toHaveLength(2);
    const original = scenarios.find((s) => s.id === 'scenario-seed')!;
    const copy = scenarios.find((s) => s.id !== 'scenario-seed')!;
    expect(original.scenario.baseProfileId).toBe(profileId);
    expect(copy.scenario.baseProfileId).toBe(added.id);
    expect(copy.scenario.ops[0]).toMatchObject({ collection: 'household', id: added.id });
    expect(useProfileStore.getState().activeId).toBe(profileId);
    expect(await repo.list('profile')).toHaveLength(2);
    expect(await repo.list('scenario')).toHaveLength(2);
  });

  it('downloads the active profile’s forecast CSV, equal to toCsv, in either dollar basis', async () => {
    const { user, profileId } = await setup();
    const household = useProfileStore.getState().profiles[profileId]!.household;
    const result = projectHousehold(household, { currentYear: CURRENT_YEAR, rules: RULES });
    if (result.status !== 'ok') throw new Error('projection failed');
    const names = {
      accountNames: Object.fromEntries(household.accounts.map((a) => [a.id, a.name])),
      personNames: Object.fromEntries(household.people.map((p) => [p.id, p.name])),
    };

    // Defaults to the app's dollar-basis setting (today's dollars).
    expect(screen.getByRole('radio', { name: /Today’s dollars/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    const todays = downloads.at(-1)!;
    expect(todays.name).toMatch(/^retirement-navigator-forecast-mid-career-couple-sample-todays-dollars-.*\.csv$/);
    expect(await todays.blob.text()).toBe(toCsv(result.value, { dollarBasis: 'todays', ...names }));

    await user.click(screen.getByRole('radio', { name: /Future \(nominal\) dollars/ }));
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    const nominal = downloads.at(-1)!;
    expect(nominal.name).toContain('future-dollars');
    expect(await nominal.blob.text()).toBe(toCsv(result.value, { dollarBasis: 'nominal', ...names }));
    expect(screen.getByText(/Downloaded \d+ forecast rows/)).toBeInTheDocument();
  });

  it('deletes all data only after typing DELETE, empties storage and returns to onboarding', async () => {
    const { user, repo } = await setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await user.click(screen.getByRole('button', { name: 'Delete all my data' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete all your data?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'delete');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Type DELETE to confirm'));
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await screen.findByRole('heading', { name: 'Welcome stub' })).toBeInTheDocument();
    await useProfileStore.getState().flush();
    expect(await repo.list('profile')).toEqual([]);
    expect(await repo.list('scenario')).toEqual([]);
    expect(await repo.get('settings', 'settings')).toBeNull();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(useProfileStore.getState()).toMatchObject({ profiles: {}, activeId: null, onboardingComplete: false });
    expect(useScenarioStore.getState().scenarios).toEqual({});
  });
});
