import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import {
  compareScenarios,
  optimizeRetirementAge,
  presetDrift,
  presetScenario,
  projectHousehold,
  RULES,
  SAMPLE_PROFILES,
  type Household,
  type Scenario,
  type ScenarioOutcome,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';
import { formatCents } from '@/lib/format';
import { setupProfile } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { scenariosOf, useScenarioStore } from '@/state/scenarioStore';
import { ScenariosPage } from './ScenariosPage';
import { beforeLimits, forecastNotes } from '@/features/dashboard/viewModel';
import { defaultOptimizerRange, longevityText, OPTIMIZER_HEALTHCARE_NOTE, READINESS_LABELS } from './compareModel';
import { shockParams } from './scenarioModel';

const ctx = { currentYear: CURRENT_YEAR, rules: RULES };
const couple = () => SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(CURRENT_YEAR);

/** Set up a profile, seed scenarios built from its household, then render the page. */
async function renderPage(seed: (base: Household, profileId: string) => Scenario[] = () => []) {
  const ctxSetup = await setupProfile(couple());
  const profileId = useProfileStore.getState().activeId!;
  const base = useProfileStore.getState().profiles[profileId]!.household;
  for (const s of seed(base, profileId)) await useScenarioStore.getState().createScenario(s);
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/scenarios']}>
      <ScenariosPage />
    </MemoryRouter>,
  );
  return { ...ctxSetup, user, profileId, base };
}

const activeHousehold = () => {
  const s = useProfileStore.getState();
  return s.profiles[s.activeId!]!.household;
};
const storedScenarios = (profileId: string) => scenariosOf(useScenarioStore.getState().scenarios, profileId);

const compareTable = () => screen.getByRole('region', { name: 'Scenario comparison' });
function rowCells(label: RegExp): string[] {
  const header = within(compareTable()).getByRole('rowheader', { name: label });
  return within(header.closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '');
}

/** The table's expected text for each outcome, straight from `compareScenarios` (today's dollars). */
function expectedRows(outcomes: ScenarioOutcome[], households: (Household | null)[]) {
  return {
    savings: outcomes.map((o) => formatCents(o.dashboard!.cards.savingsAtRetirement.real)),
    income: outcomes.map((o) => {
      const m = o.dashboard!.cards.monthlyRetirementIncome;
      return `${formatCents(m.real)}${m.taxBasis === 'beforeTaxes' ? 'Before taxes' : 'After estimated taxes'}`;
    }),
    ending: outcomes.map((o) => formatCents(o.dashboard!.baseline.summary.endingBalanceReal)),
    longevity: outcomes.map((o, i) => longevityText(o, households[i] ?? null)),
    success: outcomes.map((o) =>
      o.dashboard!.baseline.summary.deterministicSuccess ? 'Yes: lasts' : 'No: falls short',
    ),
    readiness: outcomes.map((o) => READINESS_LABELS[o.dashboard!.cards.readiness.status]),
    afterTax: outcomes.map((o) =>
      o.afterTaxEndingBalanceReal === null ? 'Unverified rule' : formatCents(o.afterTaxEndingBalanceReal),
    ),
    firstYear: outcomes.map((o) => String(o.dashboard!.cards.firstRetirementYear)),
  };
}

async function expectTableToMatch(outcomes: ScenarioOutcome[], households: (Household | null)[]) {
  const e = expectedRows(outcomes, households);
  await waitFor(() => expect(rowCells(/^Savings at retirement/)).toEqual(e.savings));
  expect(rowCells(/^First retirement year/)).toEqual(e.firstYear);
  expect(rowCells(/^Monthly retirement income/)).toEqual(e.income);
  expect(rowCells(/^Ending balance/)).toEqual(e.ending);
  expect(rowCells(/^Portfolio longevity/)).toEqual(e.longevity);
  expect(rowCells(/^Funding success/)).toEqual(e.success);
  expect(rowCells(/^Readiness/)).toEqual(e.readiness);
  expect(rowCells(/^After-tax ending balance/)).toEqual(e.afterTax);
}

describe('ScenariosPage', () => {
  it('creates a scenario from a preset with its parameters and persists it', async () => {
    const { user, profileId, repo, base } = await renderPage();
    expect(screen.getByText(/No scenarios yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New scenario' }));
    const dialog = screen.getByRole('dialog', { name: 'New scenario' });
    await user.selectOptions(within(dialog).getByLabelText('Start from'), 'E_delayedRetirement');
    const years = within(dialog).getByLabelText('Years later');
    await user.clear(years);
    await user.type(years, '4');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Retire 4 years later');
    await user.click(within(dialog).getByRole('button', { name: 'Create scenario' }));

    await waitFor(() => expect(storedScenarios(profileId)).toHaveLength(1));
    const created = storedScenarios(profileId)[0]!;
    const expected = presetScenario(
      'E_delayedRetirement',
      base,
      { years: 4, currentYear: CURRENT_YEAR },
      { scenarioId: created.id, name: 'Retire 4 years later', baseProfileId: profileId },
    );
    expect(created).toEqual(expected);
    expect(created.ops).toContainEqual({
      op: 'set',
      collection: 'people',
      id: 'sam',
      path: ['retirementAge'],
      value: 69,
    });
    const stored = await repo.get('scenario', created.id);
    expect(stored?.status === 'ok' ? stored.value.scenario : null).toEqual(expected);

    // It is listed with its changes and added to the comparison.
    const list = screen.getByRole('list', { name: 'Scenarios' });
    expect(within(list).getByText('Retire 4 years later')).toBeInTheDocument();
    expect(within(list).getByText('Sam: retirement age → 69')).toBeInTheDocument();
    expect(within(list).getByRole('checkbox', { name: 'Include in comparison' })).toBeChecked();
  });

  it('validates preset parameters', async () => {
    const { user, profileId } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'New scenario' }));
    const dialog = screen.getByRole('dialog', { name: 'New scenario' });
    await user.selectOptions(within(dialog).getByLabelText('Start from'), 'E_delayedRetirement');
    const years = within(dialog).getByLabelText('Years later');
    await user.clear(years);
    await user.type(years, '9');
    expect(within(dialog).getByText('Must be at most 5')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create scenario' }));
    expect(storedScenarios(profileId)).toHaveLength(0);
  });

  it('turns a custom override into a set op on the entity id, and the comparison reflects it', async () => {
    const { user, profileId, base } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'New scenario' }));
    const dialog = screen.getByRole('dialog', { name: 'New scenario' });
    await user.selectOptions(within(dialog).getByLabelText('Start from'), 'custom');
    await user.click(within(dialog).getByRole('button', { name: 'Create scenario' }));

    const editor = await screen.findByRole('region', { name: 'Changes in “Custom scenario”' });
    await user.selectOptions(within(editor).getByLabelText('Add a change'), 'people:sam:retirementAge');
    await user.click(within(editor).getByRole('button', { name: 'Add change' }));
    const input = within(editor).getByLabelText('Sam: Retirement age');
    expect(input).toHaveValue('65');
    await user.clear(input);
    await user.type(input, '60');

    await user.selectOptions(
      within(editor).getByLabelText('Add a change'),
      'household:sample-mid-career-couple:spending.retirementAnnualSpending',
    );
    await user.click(within(editor).getByRole('button', { name: 'Add change' }));
    const spending = within(editor).getByLabelText('Retirement spending (per year)');
    await user.clear(spending);
    await user.type(spending, '80000');

    const scenario = storedScenarios(profileId)[0]!;
    expect(scenario.preset).toBeNull();
    expect(scenario.ops).toEqual([
      { op: 'set', collection: 'people', id: 'sam', path: ['retirementAge'], value: 60 },
      {
        op: 'set',
        collection: 'household',
        id: base.id,
        path: ['spending', 'retirementAnnualSpending'],
        value: 8_000_000,
      },
    ]);

    const outcomes = compareScenarios(base, [scenario], ctx);
    expect(outcomes[1]!.dashboard!.cards.savingsAtRetirement.real).not.toBe(
      outcomes[0]!.dashboard!.cards.savingsAtRetirement.real,
    );
    const columns = within(compareTable())
      .getAllByRole('columnheader')
      .map((c) => c.textContent);
    expect(columns).toEqual(['Outcome', 'Base plan', 'Custom scenario']);
    await expectTableToMatch(outcomes, [base, { ...base }]);

    // Removing an override drops its op.
    await user.click(within(editor).getByRole('button', { name: 'Remove change: Sam: Retirement age' }));
    expect(storedScenarios(profileId)[0]!.ops).toHaveLength(1);
  });

  it('shows compare values computed by compareScenarios, and base edits flow through to scenario outcomes', async () => {
    const { profileId } = await renderPage((base, profileId) => [
      presetScenario(
        'F_reducedSpending',
        base,
        { cut: 0.2, currentYear: CURRENT_YEAR },
        { scenarioId: 'scenario-f', name: 'Spend less', baseProfileId: profileId },
      ),
      presetScenario(
        'G_rothStrategy',
        base,
        { currentYear: CURRENT_YEAR },
        { scenarioId: 'scenario-g', name: 'Roth', baseProfileId: profileId },
      ),
    ]);
    const scenarios = storedScenarios(profileId);
    const base = activeHousehold();
    const before = compareScenarios(base, scenarios, ctx);
    expect(before.map((o) => o.name)).toEqual(['Base plan', 'Roth', 'Spend less']);
    await expectTableToMatch(before, [base, base, base]);
    // Tax rules are unverified in the bundled rules, so the after-tax figure is never a number.
    if (before.every((o) => o.afterTaxEndingBalanceReal === null)) {
      expect(rowCells(/^After-tax ending balance/)).toEqual(['Unverified rule', 'Unverified rule', 'Unverified rule']);
    }
    expect(screen.getByText(/Funding success uses the deterministic criterion/)).toBeInTheDocument();
    expect(screen.getAllByText('Before plan limits (unverified)').length).toBeGreaterThan(0);

    // Edit the base plan (a larger brokerage balance). Neither scenario touches it, so both follow.
    const edited: Household = {
      ...base,
      accounts: base.accounts.map((a) => (a.id === 'joint-brokerage' ? { ...a, balance: a.balance + 10_000_000 } : a)),
    } as Household;
    act(() => useProfileStore.getState().updateActiveHousehold(edited));
    const after = compareScenarios(activeHousehold(), scenarios, ctx);
    for (const i of [1, 2]) {
      expect(after[i]!.dashboard!.cards.savingsAtRetirement.real).toBeGreaterThan(
        before[i]!.dashboard!.cards.savingsAtRetirement.real,
      );
    }
    await expectTableToMatch(after, [edited, edited, edited]);

    // The dollar-basis toggle switches the table to future dollars.
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Future dollars' }));
    await waitFor(() =>
      expect(rowCells(/^Savings at retirement/)).toEqual(
        after.map((o) => formatCents(o.dashboard!.cards.savingsAtRetirement.nominal)),
      ),
    );
    expect(rowCells(/^Ending balance/)).toEqual(
      after.map((o) => formatCents(o.dashboard!.baseline.summary.endingBalance)),
    );
  });

  it('warns about an orphaned op after a base account is deleted, and does not apply it', async () => {
    const { profileId } = await renderPage((base, profileId) => [
      presetScenario(
        'C_aggressiveSavings',
        base,
        { deferralIncrease: 0.05, irasToMax: true, currentYear: CURRENT_YEAR },
        { scenarioId: 'scenario-c', name: 'Save more', baseProfileId: profileId },
      ),
    ]);
    expect(screen.queryByRole('note', { name: 'Changes not applied' })).not.toBeInTheDocument();
    const base = activeHousehold();
    act(() =>
      useProfileStore
        .getState()
        .updateActiveHousehold({ ...base, accounts: base.accounts.filter((a) => a.id !== 'jordan-roth') }),
    );
    const warning = await screen.findByRole('note', { name: 'Changes not applied' });
    expect(warning).toHaveTextContent(
      'This scenario changes something that no longer exists in the base plan: an account (“jordan-roth”): contribution schedule → maximum allowed. It is not applied.',
    );
    expect(screen.getByText('Some changes not applied')).toBeInTheDocument();
    const outcome = compareScenarios(activeHousehold(), storedScenarios(profileId), ctx)[1]!;
    expect(outcome.orphaned).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/“Save more”: 1 change not applied/)).toBeInTheDocument());
  });

  it('flags a scenario whose overrides make the plan invalid', async () => {
    await renderPage((_base, profileId) => [
      {
        id: 'scenario-bad',
        name: 'Too old',
        baseProfileId: profileId,
        preset: null,
        presetParams: {},
        ops: [{ op: 'set', collection: 'people', id: 'sam', path: ['planningAge'], value: 130 }],
      } as unknown as Scenario,
    ]);
    const note = screen.getByRole('note', { name: 'Scenario cannot run' });
    // The issue path is named in words (person and field), not as "people › 0 › planningAge".
    expect(within(note).getByText(/^Sam › Planning age: /)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/“Too old” cannot run: its changes make the plan invalid/)).toBeInTheDocument(),
    );
  });

  it('runs the retirement-age optimizer and shows exactly the engine’s result', async () => {
    const { user } = await renderPage();
    const base = activeHousehold();
    const range = defaultOptimizerRange(base, CURRENT_YEAR);
    expect(range).toEqual({ fromAge: CURRENT_YEAR - base.people[0]!.birthYear + 1, toAge: 75 });
    expect(screen.getByLabelText('From age')).toHaveValue(String(range.fromAge));
    expect(screen.getByLabelText('To age')).toHaveValue('75');
    expect(
      screen.getByText(/^Criterion: no depletion before the planning age and at least the minimum ending balance/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Find earliest age' }));
    const expected = optimizeRetirementAge(base, ctx, { kind: 'deterministic' }, range);
    if (expected.status !== 'ok') throw new Error(expected.status);
    const { earliestAge, evaluated } = expected.value;
    await screen.findByText(
      earliestAge !== null
        ? `Earliest age that meets the criterion: ${earliestAge}`
        : `No age from ${range.fromAge} to ${range.toAge} meets the criterion.`,
      {},
      { timeout: 10_000 },
    );
    await user.click(screen.getByRole('button', { name: /Show retirement age data table/ }));
    const table = screen.getByRole('region', { name: /^Retirement ages evaluated/ });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual(evaluated.map((e) => [String(e.age), e.success ? 'Yes' : 'No', formatCents(e.endingBalanceReal)]));

    // Ages before 65 were scanned, so the pre-Medicare healthcare note is shown with the result.
    expect(evaluated.some((e) => e.age < 65)).toBe(true);
    expect(screen.getByRole('note', { name: 'Healthcare before Medicare' })).toHaveTextContent(
      OPTIMIZER_HEALTHCARE_NOTE,
    );
    // While limits are unverified, the chart and table are labeled before plan limits.
    const projection = projectHousehold(base, ctx);
    if (projection.status !== 'ok') throw new Error(projection.status);
    expect(beforeLimits(projection.value)).toBe(true);
    expect(table).toHaveAccessibleName('Retirement ages evaluated, before plan limits (unverified)');
    expect(
      within(table).getByRole('columnheader', { name: /^Ending balance.*\(before plan limits, unverified\)$/ }),
    ).toBeVisible();
    const optimizer = screen.getByRole('region', { name: 'Earliest retirement age' });
    expect(within(optimizer).getAllByText('Before plan limits (unverified)').length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it('rejects an optimizer range outside valid ages', async () => {
    const { user } = await renderPage();
    const to = screen.getByLabelText('To age');
    await user.clear(to);
    await user.type(to, '130');
    expect(screen.getByText(/Ages must be between/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find earliest age' })).toBeDisabled();
  });

  it('renames, duplicates and deletes scenarios, and limits the comparison to four', async () => {
    const { user, profileId } = await renderPage((_base, profileId) =>
      ['One', 'Two', 'Three', 'Four', 'Five'].map(
        (name) =>
          ({
            id: `s-${name}`,
            name,
            baseProfileId: profileId,
            preset: null,
            presetParams: {},
            ops: [],
          }) as unknown as Scenario,
      ),
    );
    const boxes = () => screen.getAllByRole('checkbox', { name: 'Include in comparison' });
    // Two are compared by default (sorted by name: Five, Four).
    expect(boxes().filter((b) => (b as HTMLInputElement).checked)).toHaveLength(2);
    await user.click(boxes()[2]!);
    await user.click(boxes()[3]!);
    expect(screen.getByText(/Up to 4 scenarios can be compared/)).toBeInTheDocument();
    expect(boxes()[4]).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Rename One' }));
    const rename = screen.getByRole('dialog', { name: 'Rename scenario' });
    await user.clear(within(rename).getByLabelText('Name'));
    await user.type(within(rename).getByLabelText('Name'), 'Uno');
    await user.click(within(rename).getByRole('button', { name: 'Save' }));
    expect(storedScenarios(profileId).map((s) => s.name)).toContain('Uno');

    await user.click(screen.getByRole('button', { name: 'Duplicate Two' }));
    await waitFor(() => expect(storedScenarios(profileId).map((s) => s.name)).toContain('Two (copy)'));

    await user.click(screen.getByRole('button', { name: 'Delete Three' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete this scenario?' })).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(storedScenarios(profileId).map((s) => s.name)).not.toContain('Three'));
  });
});

const editBase = (change: (h: Household) => Household) =>
  act(() => useProfileStore.getState().updateActiveHousehold(change(activeHousehold())));

describe('ScenariosPage review fixes', () => {
  it('shows each outcome’s forecast notes, including the pre-Medicare healthcare note, labeled by plan', async () => {
    const { profileId } = await renderPage((base, profileId) => [
      presetScenario(
        'B_earlyRetirement',
        base,
        { years: 5, currentYear: CURRENT_YEAR },
        { scenarioId: 'scenario-b', name: 'Retire early', baseProfileId: profileId },
      ),
    ]);
    const outcomes = compareScenarios(activeHousehold(), storedScenarios(profileId), ctx);
    const early = outcomes[1]!;
    const expected = forecastNotes(early.dashboard!.baseline);
    expect(early.dashboard!.baseline.warnings.map((w) => w.code)).toContain('healthcarePreMedicareUserEntered');
    const notes = await screen.findByRole('list', { name: 'Forecast notes for Retire early' });
    expect(
      within(notes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(expected);
    expect(within(notes).getByText(/retire before 65\. Healthcare before Medicare/)).toBeVisible();
    // The base plan's own notes are listed under its name.
    const baseNotes = forecastNotes(outcomes[0]!.dashboard!.baseline);
    if (baseNotes.length > 0) {
      expect(
        within(screen.getByRole('list', { name: 'Forecast notes for Base plan' }))
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(baseNotes);
    }
  });

  it('labels every balance-derived comparison row, the chart and its data table as before plan limits', async () => {
    const { user, profileId } = await renderPage((base, profileId) => [
      presetScenario(
        'F_reducedSpending',
        base,
        { cut: 0.1, currentYear: CURRENT_YEAR },
        { scenarioId: 'scenario-f', name: 'Spend less', baseProfileId: profileId },
      ),
    ]);
    const outcomes = compareScenarios(activeHousehold(), storedScenarios(profileId), ctx);
    expect(outcomes.some((o) => beforeLimits(o.dashboard!.baseline))).toBe(true);
    await waitFor(() => expect(rowCells(/^Ending balance/)).toHaveLength(2));
    for (const label of [
      /^Savings at retirement/,
      /^Monthly retirement income/,
      /^Ending balance/,
      /^Portfolio longevity/,
      /^Funding success/,
      /^Readiness/,
      /^After-tax ending balance/,
    ]) {
      const header = within(compareTable()).getByRole('rowheader', { name: label });
      expect(header).toHaveAccessibleName(/\(before plan limits, unverified\)$/);
    }
    expect(within(compareTable()).getByRole('rowheader', { name: /^First retirement year/ })).not.toHaveAccessibleName(
      /before plan limits/,
    );
    const caption = screen.getByText(/^Portfolio value at year end \(today’s dollars\) by year/);
    expect(within(caption).getByText('Before plan limits (unverified)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show comparison data table/ }));
    const table = screen.getByRole('region', {
      name: 'Portfolio value at year end by scenario, today’s dollars, before plan limits (unverified)',
    });
    // (jsdom's name computation drops the space before the screen-reader text.)
    expect(
      within(table).getByRole('columnheader', { name: /^Spend less\s?\(before plan limits, unverified\)$/ }),
    ).toBeVisible();
  });

  it('flags a preset that drifted from the base plan and rebuilds it from the base plan', async () => {
    const { user, profileId } = await renderPage((base, profileId) => [
      presetScenario(
        'F_reducedSpending',
        base,
        { cut: 0.2, currentYear: CURRENT_YEAR },
        { scenarioId: 'scenario-f', name: 'Spend less', baseProfileId: profileId },
      ),
    ]);
    expect(screen.queryByRole('note', { name: 'Preset out of date' })).not.toBeInTheDocument();
    editBase(
      (h) =>
        ({
          ...h,
          spending: { ...h.spending, retirementAnnualSpending: h.spending.retirementAnnualSpending + 1_000_000 },
        }) as Household,
    );
    const note = await screen.findByRole('note', { name: 'Preset out of date' });
    expect(note).toHaveTextContent(
      /The base plan changed since this preset was built; its stored values no longer match/,
    );
    await user.click(within(note).getByRole('button', { name: 'Rebuild from base plan: Spend less' }));

    const rebuilt = storedScenarios(profileId)[0]!;
    const expected = presetScenario(
      'F_reducedSpending',
      activeHousehold(),
      { cut: 0.2, currentYear: CURRENT_YEAR },
      { scenarioId: 'scenario-f', name: 'Spend less', baseProfileId: profileId },
    );
    expect(rebuilt.ops).toEqual(expected.ops);
    expect(rebuilt.preset).toBe('F_reducedSpending');
    expect(presetDrift(rebuilt, activeHousehold())).toBe(false);
    await waitFor(() => expect(screen.queryByRole('note', { name: 'Preset out of date' })).not.toBeInTheDocument());
  });

  it('turns an edited preset into a custom scenario so its preset summary no longer applies', async () => {
    const { user, profileId } = await renderPage((base, profileId) => [
      presetScenario(
        'F_reducedSpending',
        base,
        { cut: 0.1, currentYear: CURRENT_YEAR },
        { scenarioId: 'scenario-f', name: 'Spend less', baseProfileId: profileId },
      ),
    ]);
    const list = screen.getByRole('list', { name: 'Scenarios' });
    expect(within(list).getByText(/Preset F: retirement spending −10%/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit changes in Spend less' }));
    const editor = screen.getByRole('region', { name: 'Changes in “Spend less”' });
    expect(editor).toHaveTextContent(/Editing a preset’s changes turns it into a custom scenario/);
    const spending = within(editor).getByLabelText('Retirement spending (per year)');
    await user.clear(spending);
    await user.type(spending, '50000');

    const scenario = storedScenarios(profileId)[0]!;
    expect(scenario.preset).toBeNull();
    expect(scenario.presetParams).toEqual({});
    expect(within(list).queryByText(/Preset F/)).not.toBeInTheDocument();
    expect(within(list).getByText(/^Custom scenario · 2 changes$/)).toBeInTheDocument();
  });

  it('rejects a preset D start year before the current year', async () => {
    const { user, profileId } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'New scenario' }));
    const dialog = screen.getByRole('dialog', { name: 'New scenario' });
    await user.selectOptions(within(dialog).getByLabelText('Start from'), 'D_marketDownturn');
    const start = within(dialog).getByLabelText('Start year');
    await user.clear(start);
    await user.type(start, String(CURRENT_YEAR - 1));
    expect(within(dialog).getByText(`Must be at least ${CURRENT_YEAR}`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create scenario' }));
    expect(storedScenarios(profileId)).toHaveLength(0);

    await user.clear(start);
    await user.type(start, String(CURRENT_YEAR));
    expect(within(dialog).queryByText(/Must be at least/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create scenario' }));
    await waitFor(() => expect(storedScenarios(profileId)).toHaveLength(1));
    expect(storedScenarios(profileId)[0]!.presetParams.startYear).toBe(CURRENT_YEAR);
  });

  it('range-checks the market shock override and does not save out-of-range values', async () => {
    const { user, profileId, base } = await renderPage((_base, profileId) => [
      {
        id: 'scenario-c',
        name: 'Shock',
        baseProfileId: profileId,
        preset: null,
        presetParams: {},
        ops: [],
      } as unknown as Scenario,
    ]);
    await user.click(screen.getByRole('button', { name: 'Edit changes in Shock' }));
    const editor = screen.getByRole('region', { name: 'Changes in “Shock”' });
    await user.selectOptions(
      within(editor).getByLabelText('Add a change'),
      `household:${base.id}:assumptions.marketShock`,
    );
    await user.click(within(editor).getByRole('button', { name: 'Add change' }));
    const saved = () => shockParams((storedScenarios(profileId)[0]!.ops[0] as { value: unknown }).value);
    const startYear = saved()!.startYear;

    const severity = within(editor).getByLabelText('Total market drop');
    await user.clear(severity);
    await user.type(severity, '-100');
    expect(within(editor).getByText('Must be above -100%')).toBeInTheDocument();
    expect(severity).toHaveAttribute('aria-invalid', 'true');
    expect(saved()!.severity).toBe(-0.1); // the last valid entry ("-10")

    await user.clear(severity);
    await user.type(severity, '-25');
    const duration = within(editor).getByLabelText('Duration (years)');
    await user.clear(duration);
    await user.type(duration, '11');
    expect(within(editor).getByText('Must be at most 10')).toBeInTheDocument();
    expect(saved()).toEqual({ severity: -0.25, durationYears: 1, startYear });

    await user.clear(duration);
    await user.type(duration, '2');
    const start = within(editor).getByLabelText('Start year');
    await user.clear(start);
    await user.type(start, String(CURRENT_YEAR - 1));
    expect(within(editor).getByText(`Must be at least ${CURRENT_YEAR}`)).toBeInTheDocument();
    expect(saved()).toEqual({ severity: -0.25, durationYears: 2, startYear });
    await user.clear(start);
    await user.type(start, '2999');
    expect(within(editor).getByText(/^Must be at most \d{4}$/)).toBeInTheDocument();
    await user.clear(start);
    await user.type(start, String(CURRENT_YEAR + 2));
    expect(saved()).toEqual({ severity: -0.25, durationYears: 2, startYear: CURRENT_YEAR + 2 });
  });

  it('shows per-field range errors in overrides and names invalid fields in words', async () => {
    const { user } = await renderPage((_base, profileId) => [
      {
        id: 'scenario-x',
        name: 'Edit me',
        baseProfileId: profileId,
        preset: null,
        presetParams: {},
        ops: [],
      } as unknown as Scenario,
    ]);
    await user.click(screen.getByRole('button', { name: 'Edit changes in Edit me' }));
    const editor = screen.getByRole('region', { name: 'Changes in “Edit me”' });
    await user.selectOptions(within(editor).getByLabelText('Add a change'), 'people:sam:planningAge');
    await user.click(within(editor).getByRole('button', { name: 'Add change' }));
    const planning = within(editor).getByLabelText('Sam: Planning age');
    await user.clear(planning);
    await user.type(planning, '130');
    expect(within(editor).getByText('Must be between 0 and 120')).toBeInTheDocument();
    const invalid = within(editor).getByRole('note', { name: 'Scenario cannot run' });
    expect(within(invalid).getByText(/^Sam › Planning age: /)).toBeInTheDocument();
    expect(invalid).not.toHaveTextContent('people › 0');

    await user.selectOptions(within(editor).getByLabelText('Add a change'), 'people:jordan:socialSecurity.claimAge');
    await user.click(within(editor).getByRole('button', { name: 'Add change' }));
    const claim = within(
      within(editor).getByRole('group', { name: 'Jordan: Social Security claiming age' }),
    ).getByLabelText('Years');
    await user.clear(claim);
    await user.type(claim, '75');
    expect(
      within(editor).getByText('Claiming age must be between 62 and 70', { selector: 'p[role="alert"]' }),
    ).toBeVisible();
  });

  it('disables the optimizer when the first person is already retired and explains why', async () => {
    const retired = couple();
    const [sam, jordan] = retired.people;
    await setupProfile({ ...retired, people: [{ ...sam!, retirementAge: 40 }, jordan!] } as Household);
    render(
      <MemoryRouter initialEntries={['/scenarios']}>
        <ScenariosPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Find earliest age' })).toBeDisabled();
    expect(screen.getByRole('note', { name: 'Optimizer unavailable' })).toHaveTextContent(
      `Sam is already retired (retirement age 40, age 42 this year), so there is no retirement age left to scan`,
    );
    // The engine agrees: it refuses the scan with an issue.
    const h = activeHousehold();
    expect(optimizeRetirementAge(h, ctx, { kind: 'deterministic' }, { fromAge: 42, toAge: 70 }).status).toBe('invalid');
  });

  it('starts the optimizer range at the first person’s current age', async () => {
    const { user } = await renderPage();
    const from = screen.getByLabelText('From age');
    await user.clear(from);
    await user.type(from, '41');
    expect(screen.getByText(/Ages must be between 42 \(today\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find earliest age' })).toBeDisabled();
  });
});
