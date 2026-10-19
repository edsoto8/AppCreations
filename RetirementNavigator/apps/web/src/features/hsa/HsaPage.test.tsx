import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_PROFILES, type Household } from '@rn/engine';
import { TEST_YEAR, renderWithProfile } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { HsaPage } from './HsaPage';

function activeHousehold(): Household {
  const s = useProfileStore.getState();
  const doc = s.activeId ? s.profiles[s.activeId] : undefined;
  if (!doc) throw new Error('no active profile');
  return doc.household;
}

function hsa(id = 'sam-hsa') {
  const a = activeHousehold().accounts.find((x) => x.id === id);
  return a?.type === 'hsa' ? a : undefined;
}

function readout() {
  const el = screen.getByText('HSA this year:', { exact: false }).closest('p');
  if (!el) throw new Error('readout missing');
  return el;
}

describe('HsaPage', () => {
  it('shows the HSA with an unverified limit and no dollar limit', async () => {
    await renderWithProfile(<HsaPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'HSA' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Family HSA' })).toBeInTheDocument();
    expect(screen.getByText('Sam · balance $14,000')).toBeInTheDocument();
    expect(screen.getByLabelText('HDHP coverage type')).toHaveValue('family');
    expect(screen.getByText('$5,000 per year, flat')).toBeInTheDocument();
    expect(
      screen.getByText('The HSA contribution limit is unavailable: rule values are unverified'),
    ).toBeInTheDocument();
    expect(readout()).toHaveTextContent('HSA this year:$5,000ofUnverified ruleallowed');
    expect(readout().textContent?.match(/\$/g)).toHaveLength(1);
  });

  it('turning off HDHP coverage updates the account and stops contributions', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<HsaPage />);
    const hdhp = screen.getByRole('switch', { name: 'Covered by a high-deductible health plan (HDHP)' });
    expect(hdhp).toBeChecked();
    await user.click(hdhp);
    expect(hsa()?.hdhpAttested).toBe(false);
    expect(hdhp).not.toBeChecked();
    // Without HDHP coverage the engine allows nothing; no unverified rule is needed for that.
    expect(readout()).toHaveTextContent('HSA this year: $0 of $0 allowed');
    expect(screen.getByText(/HSA contributions need high-deductible health plan coverage/)).toBeInTheDocument();
    await user.click(hdhp);
    expect(hsa()?.hdhpAttested).toBe(true);
  });

  it('saves the coverage type', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<HsaPage />);
    await user.selectOptions(screen.getByLabelText('HDHP coverage type'), 'selfOnly');
    expect(hsa()?.coverage).toBe('selfOnly');
  });

  it('saves qualified medical expenses and rejects negative amounts', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<HsaPage />);
    const input = screen.getByLabelText('Qualified medical expenses per year');
    await user.clear(input);
    await user.type(input, '3000');
    expect(activeHousehold().spending.hsaQualifiedMedicalExpenses).toBe(300_000);
    await user.clear(input);
    await user.type(input, '-5');
    expect(await screen.findByText('Amount cannot be negative')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(activeHousehold().spending.hsaQualifiedMedicalExpenses).toBe(300_000);
    expect(screen.getByText(/HSA withdrawals are modeled in a later milestone \(M4\)/)).toBeInTheDocument();
  });

  it('offers to add an HSA when there is none', async () => {
    const user = userEvent.setup();
    const household = SAMPLE_PROFILES.find((p) => p.id === 'nearRetirement')?.build(TEST_YEAR);
    await renderWithProfile(<HsaPage />, { household });
    expect(screen.getByRole('heading', { name: 'No HSA yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add an HSA' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Account type')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Current balance'), '2500');
    await user.click(within(dialog).getByRole('switch', { name: 'Covered by a high-deductible health plan (HDHP)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    const added = activeHousehold().accounts.find((a) => a.type === 'hsa');
    expect(added).toMatchObject({ balance: 250_000, hdhpAttested: true, coverage: 'selfOnly', ownerId: 'pat' });
    expect(
      screen.getByText('The HSA contribution limit is unavailable: rule values are unverified'),
    ).toBeInTheDocument();
  });
});
