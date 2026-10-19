import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
});
