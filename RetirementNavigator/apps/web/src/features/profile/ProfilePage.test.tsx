import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_PROFILES } from '@rn/engine';
import { renderWithProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { ProfilePage } from './ProfilePage';

const active = () => {
  const s = useProfileStore.getState();
  return s.profiles[s.activeId!]!.household;
};
const early = () => SAMPLE_PROFILES.find((p) => p.id === 'earlyCareer')!.build(TEST_YEAR);

describe('ProfilePage', () => {
  it('edits a person and saves valid changes to the active profile', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilePage />, { household: early() });
    const retirement = screen.getByLabelText('Retirement age');
    await user.clear(retirement);
    await user.type(retirement, '60');
    await waitFor(() => expect(active().people[0]!.retirementAge).toBe(60));
  });

  it('shows a schema error and does not save an invalid value', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilePage />, { household: early() });
    const planning = screen.getByLabelText('Planning age');
    await user.clear(planning);
    await user.type(planning, '50');
    expect(await screen.findByText('Retirement age is after planning age')).toBeInTheDocument();
    expect(active().people[0]!.planningAge).toBe(95);
  });

  it('adds and removes a spouse, switching the filing status', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilePage />, { household: early() });
    await user.click(screen.getByRole('button', { name: /Add a spouse/ }));
    await waitFor(() => expect(active().filingStatus).toBe('marriedFilingJointly'));
    expect(active().people).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /Remove spouse/ }));
    await waitFor(() => expect(active().filingStatus).toBe('single'));
  });

  it('blocks removing a spouse who still owns accounts', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilePage />);
    await user.click(screen.getByRole('button', { name: /Remove spouse/ }));
    expect(await screen.findByText(/still owns accounts or income/)).toBeInTheDocument();
    expect(active().people).toHaveLength(2);
  });

  it('edits money and percent fields', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilePage />, { household: early() });
    const spending = screen.getByLabelText('Retirement annual spending');
    await user.clear(spending);
    await user.type(spending, '55,500');
    const inflation = screen.getByLabelText('Inflation');
    await user.clear(inflation);
    await user.type(inflation, '3');
    await waitFor(() => {
      expect(active().spending.retirementAnnualSpending).toBe(5_550_000);
      expect(active().assumptions.inflation).toBe(0.03);
    });
  });

  it('changes the rules anchor year as a number', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilePage />, { household: early() });
    await user.selectOptions(screen.getByLabelText('Rules anchor year'), '2027');
    await waitFor(() => expect(active().assumptions.rules.anchorYear).toBe(2027));
  });

  describe('forecast settings', () => {
    it('saves withdrawal timing, granularity, strategy and the minimum ending balance', async () => {
      const user = userEvent.setup();
      await renderWithProfile(<ProfilePage />, { household: early() });
      await user.selectOptions(screen.getByLabelText('Withdrawal timing'), 'startOfYear');
      await user.selectOptions(screen.getByLabelText('Forecast granularity'), 'monthly');
      const strategy = screen.getByLabelText('Withdrawal order');
      expect(
        within(strategy).getByRole('option', { name: /needs the tax model, uses taxable-first for now/ }),
      ).toBeInTheDocument();
      await user.selectOptions(strategy, 'proportional');
      const minimum = screen.getByLabelText('Minimum ending balance');
      await user.clear(minimum);
      await user.type(minimum, '50000');
      await waitFor(() => {
        const a = active().assumptions;
        expect(a.withdrawalTiming).toBe('startOfYear');
        expect(a.granularity).toBe('monthly');
        expect(a.withdrawalStrategy).toBe('proportional');
        expect(a.minimumEndingBalance).toBe(5_000_000);
      });
    });

    it('routes the surplus to a taxable or cash account only, and back to spent', async () => {
      const user = userEvent.setup();
      await renderWithProfile(<ProfilePage />);
      const surplus = screen.getByLabelText('Surplus while working');
      const options = within(surplus)
        .getAllByRole('option')
        .map((o) => o.textContent);
      // The couple's brokerage is eligible; workplace, IRA and HSA accounts are not offered.
      expect(options).toEqual(['Spent (not saved)', 'Saved to Joint brokerage (Taxable brokerage)']);
      await user.selectOptions(surplus, 'account:joint-brokerage');
      await waitFor(() =>
        expect(active().assumptions.surplus).toEqual({ mode: 'account', accountId: 'joint-brokerage' }),
      );
      await user.selectOptions(surplus, 'spent');
      await waitFor(() => expect(active().assumptions.surplus).toEqual({ mode: 'spent' }));
    });

    it('saves return offsets and rejects ones outside the schema range', async () => {
      const user = userEvent.setup();
      await renderWithProfile(<ProfilePage />, { household: early() });
      const optimistic = screen.getByLabelText('Optimistic return offset');
      await user.clear(optimistic);
      await user.type(optimistic, '3');
      const pessimistic = screen.getByLabelText('Pessimistic return offset');
      await user.clear(pessimistic);
      await user.type(pessimistic, '-1.5');
      await waitFor(() =>
        expect(active().assumptions.deterministicOffsets).toEqual({ optimistic: 0.03, pessimistic: -0.015 }),
      );

      await user.clear(optimistic);
      await user.type(optimistic, '20');
      expect(await screen.findByText('Must be between 0 and +10 points')).toBeInTheDocument();
      // The last valid value typed ("2" on the way to "20") is kept; 20 points is never saved.
      expect(active().assumptions.deterministicOffsets.optimistic).toBe(0.02);
      await user.clear(pessimistic);
      await user.type(pessimistic, '2');
      expect(await screen.findByText('Must be between −10 and 0 points')).toBeInTheDocument();
      expect(active().assumptions.deterministicOffsets.pessimistic).toBe(-0.015);
    });
  });
});
