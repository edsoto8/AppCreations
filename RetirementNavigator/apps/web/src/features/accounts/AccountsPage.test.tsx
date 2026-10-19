import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Household } from '@rn/engine';
import { renderWithProfile } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { AccountsPage } from './AccountsPage';

function activeHousehold(): Household {
  const s = useProfileStore.getState();
  const doc = s.activeId ? s.profiles[s.activeId] : undefined;
  if (!doc) throw new Error('no active profile');
  return doc.household;
}

const account = (id: string) => activeHousehold().accounts.find((a) => a.id === id);

describe('AccountsPage', () => {
  it('lists accounts by owner with type, tax treatment, fees and the total', async () => {
    await renderWithProfile(<AccountsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument();
    // 185k + 96k + 41k + 52k + 14k
    expect(screen.getByText('$388,000')).toBeInTheDocument();
    const sam = screen.getByRole('region', { name: 'Sam’s accounts' });
    expect(within(sam).getByText('Sam 401(k)')).toBeInTheDocument();
    expect(within(sam).getByText('Traditional 401(k)')).toBeInTheDocument();
    expect(within(sam).getAllByText('Tax-deferred').length).toBeGreaterThan(0);
    expect(within(sam).getByText('HSA')).toBeInTheDocument();
    const jordan = screen.getByRole('region', { name: 'Jordan’s accounts' });
    expect(within(jordan).getByText('Jordan Roth IRA')).toBeInTheDocument();
    expect(within(jordan).getByText('$250 per month, flat')).toBeInTheDocument();
    expect(screen.getByText(/Fees are modeled as return drag/)).toBeInTheDocument();
  });

  it('adds an account and saves it to the profile', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    const before = activeHousehold().accounts.length;
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Account type'), 'cash');
    await user.selectOptions(within(dialog).getByLabelText('Owner'), 'jordan');
    const name = within(dialog).getByLabelText('Account name');
    await user.clear(name);
    await user.type(name, 'Rainy day fund');
    await user.type(within(dialog).getByLabelText('Current balance'), '5000');
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const accounts = activeHousehold().accounts;
    expect(accounts).toHaveLength(before + 1);
    const added = accounts.find((a) => a.name === 'Rainy day fund');
    expect(added).toMatchObject({ type: 'cash', ownerId: 'jordan', balance: 500_000, contribution: null });
    expect(added?.id).toMatch(/^account-/);
  });

  it('adds a contribution schedule with a custom return and expense ratio', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Edit Joint brokerage' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('switch', { name: 'Use the household return assumption' }));
    const ret = within(dialog).getByLabelText('Expected annual return');
    await user.clear(ret);
    await user.type(ret, '6.5');
    const er = within(dialog).getByLabelText('Expense ratio');
    await user.clear(er);
    await user.type(er, '0.04');
    await user.click(within(dialog).getByRole('switch', { name: 'Contributes each year' }));
    await user.type(within(dialog).getByLabelText('Contribution amount'), '300');
    await user.selectOptions(within(dialog).getByLabelText('Frequency'), 'monthly');
    await user.selectOptions(within(dialog).getByLabelText('Contribution growth'), 'inflation');
    await user.type(within(dialog).getByLabelText('Stop year'), '2040');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const saved = account('joint-brokerage');
    expect(saved?.expectedReturn).toBeCloseTo(0.065, 10);
    expect(saved?.expenseRatio).toBeCloseTo(0.0004, 10);
    expect(saved && 'contribution' in saved ? saved.contribution : undefined).toEqual({
      amount: { kind: 'dollars', amount: 30_000, frequency: 'monthly' },
      growth: { mode: 'inflation' },
      startYear: null,
      stopYear: 2040,
    });
  });

  it('edits a balance', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Edit Joint brokerage' }));
    const dialog = screen.getByRole('dialog');
    const balance = within(dialog).getByLabelText('Current balance');
    await user.clear(balance);
    await user.type(balance, '60,000');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(account('joint-brokerage')?.balance).toBe(6_000_000);
  });

  it('deletes an account after confirmation', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Delete Joint brokerage' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Delete Joint brokerage?' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    expect(account('joint-brokerage')).toBeUndefined();
    expect(screen.queryByText('Joint brokerage')).not.toBeInTheDocument();
  });

  it('keeps an account on cancel', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Delete Joint brokerage' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(account('joint-brokerage')).toBeDefined();
  });

  it('blocks deleting an account a workplace plan uses', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Delete Sam 401(k)' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /can’t be deleted yet/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/Sam’s 401\(k\) plan on Income & Savings/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
    expect(account('sam-401k')).toBeDefined();
  });

  it('shows a validation error for a Roth basis above the balance and does not save', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Edit Jordan Roth IRA' }));
    const dialog = screen.getByRole('dialog');
    const basis = within(dialog).getByLabelText('Contribution basis');
    await user.clear(basis);
    await user.type(basis, '50000');
    expect(await within(dialog).findByText('Basis cannot exceed balance')).toBeInTheDocument();
    expect(basis).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const roth = account('jordan-roth');
    expect(roth?.type === 'rothIra' ? roth.contributionBasis : null).toBe(3_000_000);
  });

  it('shows field messages for an empty name and an allocation that does not total 100%', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Edit Joint brokerage' }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Account name'));
    expect(await within(dialog).findByText('Enter a name')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('switch', { name: 'Set an asset allocation' }));
    const cash = within(dialog).getByLabelText('Cash');
    await user.clear(cash);
    await user.type(cash, '10');
    expect(await within(dialog).findByText('Allocation must total 100%')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(account('joint-brokerage')?.name).toBe('Joint brokerage');
  });

  it('explains that workplace contributions come from Income & Savings', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Edit Sam 401(k)' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Income & Savings' })).toHaveAttribute('href', '/income');
    expect(within(dialog).getByText(/linked to Sam’s 401\(k\) plan/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('switch', { name: 'Contributes each year' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Owner')).toBeDisabled();
  });
});
