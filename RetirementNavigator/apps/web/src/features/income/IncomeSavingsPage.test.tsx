import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_PROFILES } from '@rn/engine';
import { renderWithProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { IncomeSavingsPage } from './IncomeSavingsPage';

const active = () => {
  const s = useProfileStore.getState();
  return s.profiles[s.activeId!]!.household;
};
const sample = (id: string) => SAMPLE_PROFILES.find((p) => p.id === id)!.build(TEST_YEAR);

describe('IncomeSavingsPage', () => {
  it('shows the 10-year preview and the match readout, with limits labeled unverified', async () => {
    await renderWithProfile(<IncomeSavingsPage />, { household: sample('nearRetirement') });
    const table = screen.getByRole('region', { name: /10-year income and savings preview for Pat/ });
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    // $96,000 salary in year 1.
    expect(within(table).getAllByText('$96,000').length).toBeGreaterThan(0);
    expect(screen.getByText(/to capture\s+the full match/)).toBeInTheDocument();
    expect(screen.getByText(/Not available yet: contribution limits/)).toBeInTheDocument();
    expect(screen.getByText(/Not available yet: the take-home pay check/)).toBeInTheDocument();
  });

  it('updates the store and the preview when the salary changes', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<IncomeSavingsPage />, { household: sample('nearRetirement') });
    const salary = screen.getByLabelText('Annual base salary');
    await user.clear(salary);
    await user.type(salary, '100000');
    await waitFor(() => expect(active().people[0]!.employment!.baseSalary).toBe(10_000_000));
    const table = screen.getByRole('region', { name: /10-year income and savings preview/ });
    expect(within(table).getAllByText('$100,000').length).toBeGreaterThan(0);
  });

  it('reports the full-match capture and unclaimed match from the tier builder', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<IncomeSavingsPage />, { household: sample('nearRetirement') });
    // Pat contributes 15% with 100% of 3% + 50% of 2%: full match captured.
    expect(screen.getByText(/, the full match\.$/)).toBeInTheDocument();
    const trad = screen.getByLabelText('Traditional (pre-tax) % of salary', { selector: 'input' });
    await user.clear(trad);
    await user.type(trad, '2');
    // 2% of $96,000: match $1,920 of a possible $3,840.
    expect(
      await screen.findByText(/capture \$1,920 of a possible \$3,840, leaving \$1,920 per year unclaimed/),
    ).toBeInTheDocument();
  });

  it('adds a match tier and a workplace plan with its account', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<IncomeSavingsPage />, { household: sample('nearRetirement') });
    await user.click(screen.getByRole('button', { name: 'Add a tier' }));
    await waitFor(() => expect(active().people[0]!.workplacePlans[0]!.match.tiers).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Add a workplace plan' }));
    await waitFor(() => expect(active().people[0]!.workplacePlans).toHaveLength(2));
    const plan2 = active().people[0]!.workplacePlans[1]!;
    expect(plan2.planType).toBe('457b');
    expect(
      active().accounts.some((a) => a.id === plan2.traditionalAccountId && a.type === 'workplaceTraditional'),
    ).toBe(true);
  });

  it('turning on Roth creates a linked Roth account', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<IncomeSavingsPage />, { household: sample('nearRetirement') });
    await user.click(screen.getByRole('switch', { name: 'Plan offers Roth contributions' }));
    await waitFor(() => expect(active().people[0]!.workplacePlans[0]!.planOffersRoth).toBe(true));
    const rothId = active().people[0]!.workplacePlans[0]!.rothAccountId;
    expect(active().accounts.find((a) => a.id === rothId)?.type).toBe('workplaceRoth');
  });

  it('shows the implied real raise and supports year-specific overrides', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<IncomeSavingsPage />, { household: sample('nearRetirement') });
    // 2.5% raise with 2.5% inflation → 0% real.
    expect(screen.getByText('Implied: 2.5% nominal, 0% after inflation.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a year-specific raise' }));
    await waitFor(() =>
      expect(active().people[0]!.employment!.raiseOverrides).toEqual([{ year: TEST_YEAR + 1, rate: 0.1 }]),
    );
  });

  it('switches between people in a couple and between dollar bases', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<IncomeSavingsPage />);
    await user.click(screen.getByRole('tab', { name: 'Jordan' }));
    expect(screen.getByRole('region', { name: /preview for Jordan/ })).toBeInTheDocument();
    await user.click(screen.getAllByRole('radio', { name: 'Future dollars' })[0]!);
    expect(useProfileStore.getState().dollarBasis).toBe('nominal');
  });
});
