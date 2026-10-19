import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_PROFILES, type Household } from '@rn/engine';
import { TEST_YEAR, renderWithProfile } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { RothIraPage } from './RothIraPage';

function activeHousehold(): Household {
  const s = useProfileStore.getState();
  const doc = s.activeId ? s.profiles[s.activeId] : undefined;
  if (!doc) throw new Error('no active profile');
  return doc.household;
}

function rothOf(id: string) {
  const a = activeHousehold().accounts.find((x) => x.id === id);
  return a?.type === 'rothIra' ? a : undefined;
}

function sample(id: string): Household {
  const s = SAMPLE_PROFILES.find((p) => p.id === id);
  if (!s) throw new Error(id);
  return s.build(TEST_YEAR);
}

describe('RothIraPage', () => {
  it('shows each person, the Roth IRA account and an unverified eligibility readout with no dollar limit', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RothIraPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Roth IRA' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sam' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Jordan' }));

    const table = screen.getByRole('region', { name: 'Jordan’s Roth IRA accounts' });
    expect(within(table).getByText('Jordan Roth IRA')).toBeInTheDocument();
    expect(within(table).getByText('$41,000')).toBeInTheDocument();
    expect(within(table).getByText('$30,000')).toBeInTheDocument();

    expect(
      screen.getByText('Not available yet: Roth IRA eligibility (rule values are unverified)'),
    ).toBeInTheDocument();
    const readout = screen.getByText('Roth IRA this year:').parentElement;
    if (!readout) throw new Error('readout missing');
    // $250 a month planned; the allowed amount is an "Unverified rule" badge, not a number.
    expect(readout).toHaveTextContent('Roth IRA this year:$3,000ofUnverified ruleallowed');
    expect(readout.textContent?.match(/\$/g)).toHaveLength(1);
  });

  it('shows the MAGI estimate inputs from the engine and never fills in figures that need unverified rules', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RothIraPage />);
    await user.click(screen.getByRole('tab', { name: 'Jordan' }));
    // Salaries 118,000 + 84,000 and bonus 8% of 118,000 = 9,440 need no rules.
    expect(screen.getByText('Base salaries (both people)').closest('div')).toHaveTextContent('$202,000');
    expect(screen.getByText('Bonus').closest('div')).toHaveTextContent('$9,440');
    // Deferrals and HSA contributions after limits need the (unverified) limits, so no number is shown.
    for (const label of [/^Traditional workplace deferrals/, /^HSA contributions/]) {
      const row = screen.getByText(label).closest('div');
      expect(row).toHaveTextContent('Unverified rule');
      expect(row?.textContent).not.toMatch(/\$/);
    }
    expect(screen.getByText('Estimated MAGI', { selector: 'dt' }).closest('div')).toHaveTextContent('Unverified rule');
    expect(screen.getByText(/^Simplification: MAGI is estimated as salary \+ bonus/)).toBeInTheDocument();
    expect(screen.getByText(/married filing jointly, both people combined/)).toBeInTheDocument();
  });

  it('writes a MAGI override to the person’s Roth IRA', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RothIraPage />);
    await user.click(screen.getByRole('tab', { name: 'Jordan' }));
    await user.click(screen.getByRole('switch', { name: 'Enter MAGI yourself' }));
    // The estimate is unavailable (unverified limits), so the override starts from gross pay: 202,000 + 9,440.
    expect(rothOf('jordan-roth')?.magiOverride).toBe(21_144_000);
    expect(screen.getByText('Estimated MAGI', { selector: 'dt' }).closest('div')).toHaveTextContent(
      'Not used (override on)',
    );
    const input = screen.getByLabelText('MAGI override');
    await user.clear(input);
    await user.type(input, '150000');
    expect(rothOf('jordan-roth')?.magiOverride).toBe(15_000_000);
    await user.click(screen.getByRole('switch', { name: 'Enter MAGI yourself' }));
    expect(rothOf('jordan-roth')?.magiOverride).toBeNull();
  });

  it('offers to add a Roth IRA for a person without one and validates the basis', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RothIraPage />);
    expect(screen.getByText('Sam has no Roth IRA in this plan.')).toBeInTheDocument();
    expect(screen.getByText(/Add a Roth IRA for Sam to see the MAGI estimate/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enter MAGI yourself' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add a Roth IRA' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Account type')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Owner')).toHaveValue('sam');
    await user.type(within(dialog).getByLabelText('Current balance'), '10000');
    await user.type(within(dialog).getByLabelText('Contribution basis'), '12000');
    expect(await within(dialog).findByText('Basis cannot exceed balance')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(activeHousehold().accounts.filter((a) => a.type === 'rothIra')).toHaveLength(1);

    const basis = within(dialog).getByLabelText('Contribution basis');
    await user.clear(basis);
    await user.type(basis, '8000');
    await user.click(within(dialog).getByRole('switch', { name: 'Contributes each year' }));
    await user.selectOptions(within(dialog).getByLabelText('Contribution amount type'), 'maxAllowed');
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));

    const added = activeHousehold().accounts.find((a) => a.type === 'rothIra' && a.ownerId === 'sam');
    expect(added).toMatchObject({ balance: 1_000_000, contributionBasis: 800_000, magiOverride: null });
    expect(added && 'contribution' in added ? added.contribution?.amount : null).toEqual({ kind: 'maxAllowed' });
    expect(screen.getByRole('region', { name: 'Sam’s Roth IRA accounts' })).toBeInTheDocument();
    expect(screen.getByText('Roth IRA this year:').parentElement).toHaveTextContent('the maximum');
  });

  it('lists what is not modeled and links to the Roth vs traditional calculator', async () => {
    await renderWithProfile(<RothIraPage />, { household: sample('earlyCareer') });
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Spousal IRA contributions for a non-working spouse are not supported/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Backdoor Roth contributions/)).toBeInTheDocument();
    expect(screen.getByText(/5-year rule/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compare Roth vs traditional' })).toHaveAttribute('href', '/calculators');
    expect(screen.getByText('Coming in a later milestone (M7a)')).toBeInTheDocument();
    expect(screen.queryByText(/married filing jointly/)).not.toBeInTheDocument();
  });
});
