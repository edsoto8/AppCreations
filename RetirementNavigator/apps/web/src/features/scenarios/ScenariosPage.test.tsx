import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import {
  compareScenarios,
  optimizeRetirementAge,
  presetScenario,
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
import { defaultOptimizerRange, longevityText, READINESS_LABELS } from './compareModel';

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
    expect(screen.getByRole('note', { name: 'Scenario cannot run' })).toBeInTheDocument();
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
    const table = screen.getByRole('region', { name: 'Retirement ages evaluated' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual(evaluated.map((e) => [String(e.age), e.success ? 'Yes' : 'No', formatCents(e.endingBalanceReal)]));
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
