import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NotImplementedError,
  RULES,
  SAMPLE_PROFILES,
  fullRetirementAge,
  projectHousehold,
  type Household,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';
import { formatCents } from '@/lib/format';
import { renderWithProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { excludedFeatureLabel } from '@/features/dashboard/viewModel';
import { RetirementIncomePage } from './RetirementIncomePage';
import { HEALTHCARE_NOTE } from './SpendingPlanSection';
import { retirementExclusions, taxesUnverified } from './model';

const active = () => {
  const s = useProfileStore.getState();
  return s.profiles[s.activeId!]!.household;
};
const sample = (id: string) => SAMPLE_PROFILES.find((p) => p.id === id)!.build(TEST_YEAR);

function project(household: Household) {
  const result = projectHousehold(household, { currentYear: CURRENT_YEAR, rules: RULES });
  if (result.status !== 'ok') throw new Error(result.status);
  return result.value;
}

/** What the engine says about SSA claiming rules in this build (real, unverified rules). */
function fraStatus(birthYear: number): string {
  try {
    return fullRetirementAge(birthYear, 1, RULES.standing).status;
  } catch (error) {
    if (error instanceof NotImplementedError) return 'notImplemented';
    throw error;
  }
}

describe('RetirementIncomePage', () => {
  it('renders every section with the persistent pre-Medicare healthcare note', async () => {
    await renderWithProfile(<RetirementIncomePage />, { household: sample('nearRetirement') });
    expect(screen.getByRole('heading', { level: 1, name: 'Retirement Income' })).toBeInTheDocument();
    for (const name of ['Social Security', 'Pensions', 'Other income', 'One-time events', 'Spending plan']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Retirement income, gross to net' })).toBeInTheDocument();
    expect(screen.getByText(HEALTHCARE_NOTE)).toBeInTheDocument();
  });

  it('switches the Social Security source and saves the benefit at the claiming age', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RetirementIncomePage />, { household: sample('nearRetirement') });
    // Pat starts from a full-retirement-age statement amount; with unverified rules the at-claim-age input is recommended.
    expect(screen.getByRole('radio', { name: /Benefit at full retirement age/ })).toBeChecked();
    expect(screen.getByText('Recommended while rules are unverified')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Benefit at your planned claiming age/ }));
    await waitFor(() =>
      expect(active().people[0]!.socialSecurity.source).toEqual({ kind: 'atClaimAge', monthlyAtClaim: 0 }),
    );
    const amount = screen.getByLabelText('Monthly benefit at your claiming age');
    await user.clear(amount);
    await user.type(amount, '2400');
    await waitFor(() =>
      expect(active().people[0]!.socialSecurity.source).toEqual({ kind: 'atClaimAge', monthlyAtClaim: 240_000 }),
    );
    // No full-retirement-age amount: the comparison points to the statement instead of showing numbers.
    expect(screen.getByText(/compare them there/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Claiming age (years)'), '70');
    await user.selectOptions(screen.getByLabelText('Plus months'), '3');
    expect(await screen.findByText('Claiming age must be between 62 and 70')).toBeInTheDocument();
    // The invalid 70 years and 3 months never reaches the store (it keeps the last valid age).
    expect(active().people[0]!.socialSecurity.claimAge).toEqual({ years: 70, months: 0 });
    await user.selectOptions(screen.getByLabelText('Plus months'), '0');
    expect(screen.queryByText('Claiming age must be between 62 and 70')).not.toBeInTheDocument();
    await waitFor(() => expect(active().people[0]!.socialSecurity.claimAge).toEqual({ years: 70, months: 0 }));

    await user.click(screen.getByRole('radio', { name: /No Social Security benefit/ }));
    await waitFor(() => expect(active().people[0]!.socialSecurity.source).toEqual({ kind: 'none' }));
    expect(screen.queryByLabelText('Claiming age (years)')).not.toBeInTheDocument();
  });

  it('shows the claiming comparison as unavailable (no numbers) with the unverified rules', async () => {
    await renderWithProfile(<RetirementIncomePage />, { household: sample('nearRetirement') });
    const ss = screen.getByRole('region', { name: 'Social Security' });
    const comparison = within(ss).getByRole('region', { name: 'Claiming-age comparison' });
    const status = fraStatus(TEST_YEAR - 61);
    if (status === 'notImplemented') {
      expect(within(comparison).getByText(/not available in this version yet/)).toBeInTheDocument();
    } else {
      expect(status).toBe('unverified');
      expect(
        within(comparison).getByText('Not available yet: the claiming-age comparison (rule values are unverified)'),
      ).toBeInTheDocument();
    }
    expect(within(comparison).queryByRole('region', { name: /Claiming-age comparison for/ })).not.toBeInTheDocument();
  });

  it('labels the estimator as illustrative and edits an earnings history', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RetirementIncomePage />, { household: sample('nearRetirement') });
    await user.click(screen.getByRole('radio', { name: /Illustrative estimate from an earnings history/ }));
    expect(
      screen.getByRole('region', { name: 'Illustrative estimate — not an official SSA calculation' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add an earlier year' }));
    await waitFor(() =>
      expect(active().people[0]!.socialSecurity.source).toEqual({
        kind: 'estimateHistory',
        earnings: [{ year: CURRENT_YEAR - 1, earnings: 9_600_000 }],
      }),
    );
    await user.click(screen.getByRole('button', { name: `Remove the ${CURRENT_YEAR - 1} earnings` }));
    await waitFor(() =>
      expect(active().people[0]!.socialSecurity.source).toEqual({ kind: 'estimateHistory', earnings: [] }),
    );
  });

  it('saves the COLA assumption and a labeled benefit-reduction scenario', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RetirementIncomePage />, { household: sample('nearRetirement') });
    expect(screen.getByText(/An assumption, not a prediction/)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Test a benefit reduction' }));
    await waitFor(() => expect(active().assumptions.socialSecurity.benefitReduction).not.toBeNull());
    const share = screen.getByLabelText('Benefit reduction');
    await user.clear(share);
    await user.type(share, '15');
    await waitFor(() => expect(active().assumptions.socialSecurity.benefitReduction?.reduction).toBe(0.15));
    await user.selectOptions(screen.getByLabelText('Cost-of-living adjustment'), 'rate');
    await waitFor(() => expect(active().assumptions.socialSecurity.cola).toEqual({ mode: 'rate', rate: 0.02 }));
  });

  it('adds, edits, validates and removes a pension, offering only valid rollover accounts', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RetirementIncomePage />);
    await user.click(screen.getByRole('button', { name: 'Add a pension' }));
    await waitFor(() => expect(active().pensions).toHaveLength(1));
    const card = screen.getByRole('region', { name: 'Pension: Pension 1' });

    const amount = within(card).getByLabelText('Annual amount');
    await user.clear(amount);
    await user.type(amount, '24000');
    await waitFor(() => expect(active().pensions[0]!.annualAmount).toBe(2_400_000));

    const taxable = within(card).getByLabelText('Taxable share');
    await user.clear(taxable);
    await user.type(taxable, '150');
    expect(await within(card).findByText('Must be at most 100%')).toBeInTheDocument();
    // Typing passes through 15% (valid); 150% is never stored.
    expect(active().pensions[0]!.taxableFraction).toBe(0.15);
    await user.clear(taxable);
    await user.type(taxable, '80');
    await waitFor(() => expect(active().pensions[0]!.taxableFraction).toBe(0.8));

    // Owned by Sam: only Sam's 401(k) and the brokerage; never Jordan's accounts, a Roth IRA or the HSA.
    await user.selectOptions(within(card).getByLabelText('Paid as'), 'lumpSum');
    await waitFor(() =>
      expect(active().pensions[0]!.payout).toEqual({ kind: 'lumpSum', amount: 0, destinationAccountId: 'sam-401k' }),
    );
    const destination = within(card).getByLabelText('Rolled into');
    const options = within(destination)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Sam 401(k) (Workplace plan, traditional)', 'Joint brokerage (Taxable brokerage)']);
    await user.selectOptions(destination, 'joint-brokerage');
    await waitFor(() =>
      expect(active().pensions[0]!.payout).toMatchObject({ destinationAccountId: 'joint-brokerage' }),
    );

    await user.click(within(card).getByRole('button', { name: 'Remove the pension Pension 1' }));
    await waitFor(() => expect(active().pensions).toHaveLength(0));
  });

  it('adds a one-time inflow with a capital gain into a taxable account only', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RetirementIncomePage />);
    await user.click(screen.getByRole('button', { name: 'Add a one-time event' }));
    await waitFor(() => expect(active().oneTimeEvents).toHaveLength(1));
    const card = screen.getByRole('region', { name: 'One-time event: Event 1' });
    expect(within(card).queryByLabelText('Deposited into')).not.toBeInTheDocument();

    await user.selectOptions(within(card).getByLabelText('Money in or out'), 'inflow');
    await user.selectOptions(within(card).getByLabelText('Tax treatment'), 'capitalGain');
    const gain = within(card).getByLabelText('Taxable gain share');
    await user.clear(gain);
    await user.type(gain, '30');
    const destination = within(card).getByLabelText('Deposited into');
    expect(
      within(destination)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Default account', 'Joint brokerage (Taxable brokerage)']);
    await user.selectOptions(destination, 'joint-brokerage');
    const amount = within(card).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '200000');
    await waitFor(() =>
      expect(active().oneTimeEvents[0]).toMatchObject({
        direction: 'inflow',
        taxTreatment: 'capitalGain',
        gainFraction: 0.3,
        destinationAccountId: 'joint-brokerage',
        amount: 20_000_000,
      }),
    );
  });

  it('validates other income years', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RetirementIncomePage />, { household: sample('nearRetirement') });
    await user.click(screen.getByRole('button', { name: 'Add other income' }));
    await waitFor(() => expect(active().otherIncome).toHaveLength(1));
    const card = screen.getByRole('region', { name: 'Other income: Income 1' });
    const end = within(card).getByLabelText('Last year (optional)');
    await user.type(end, String(CURRENT_YEAR - 1));
    expect(await within(card).findByText('End year is before start year')).toBeInTheDocument();
    expect(active().otherIncome[0]!.endYear).toBeNull();
    await user.clear(end);
    await user.type(end, String(CURRENT_YEAR + 4));
    await waitFor(() => expect(active().otherIncome[0]!.endYear).toBe(CURRENT_YEAR + 4));
  });

  it('adds spending steps and rejects two steps at the same age', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RetirementIncomePage />, { household: sample('nearRetirement') });
    const spending = screen.getByRole('region', { name: 'Spending plan' });
    await user.click(within(spending).getByRole('button', { name: 'Add a spending step' }));
    await waitFor(() => expect(active().spending.steps).toEqual([{ fromAge: 75, annualSpending: 6_200_000 }]));
    await user.click(within(spending).getByRole('button', { name: 'Add a spending step' }));
    await waitFor(() => expect(active().spending.steps).toHaveLength(2));
    const ages = within(spending).getAllByLabelText('From age');
    await user.clear(ages[1]!);
    await user.type(ages[1]!, '75');
    expect(await within(spending).findByText('Only one spending step per age')).toBeInTheDocument();
    // Typing passes through age 7 (valid); the duplicate 75 is never stored.
    expect(active().spending.steps.map((st) => st.fromAge)).toEqual([75, 7]);

    const glide = within(spending).getByLabelText('Yearly change after inflation');
    await user.clear(ages[1]!);
    await user.type(ages[1]!, '85');
    await user.clear(glide);
    await user.type(glide, '-1');
    await waitFor(() => expect(active().spending.retirementRealGlide).toBe(-0.01));
    expect(active().spending.steps[1]!.fromAge).toBe(85);
  });

  it('shows each retirement year from the engine, gross to net, in both dollar bases', async () => {
    const user = userEvent.setup();
    const household = sample('nearRetirement');
    await renderWithProfile(<RetirementIncomePage />, { household });
    const result = project(household);
    const retired = result.rows.filter((r) => r.phase === 'retirement');
    const table = screen.getByRole('region', { name: 'Gross to net by year, today’s dollars' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(retired.length + 1);

    const first = retired[0]!;
    const firstRow = rows[1]!;
    expect(within(firstRow).getByText(String(first.year))).toBeInTheDocument();
    expect(within(firstRow).getAllByText(formatCents(first.grossIncome / first.deflator)).length).toBeGreaterThan(0);
    expect(within(firstRow).getAllByText(formatCents(first.flows.withdrawals / first.deflator)).length).toBeGreaterThan(
      0,
    );
    expect(
      within(firstRow).getAllByText(formatCents(first.flows.socialSecurity / first.deflator)).length,
    ).toBeGreaterThan(0);
    // Taxes need unverified rules: never a number.
    if (first.tax === null) {
      const label = taxesUnverified(result) ? 'Unverified rule' : 'Before taxes';
      expect(within(firstRow).getAllByText(label).length).toBeGreaterThanOrEqual(2);
    }

    await user.click(screen.getAllByRole('radio', { name: 'Future dollars' })[0]!);
    const nominal = screen.getByRole('region', { name: 'Gross to net by year, future dollars' });
    const nominalRow = within(nominal).getAllByRole('row')[1]!;
    expect(within(nominalRow).getAllByText(formatCents(first.grossIncome)).length).toBeGreaterThan(0);
  });

  it('labels every retirement feature the engine leaves out, and opens the chart data table', async () => {
    const user = userEvent.setup();
    const household = sample('nearRetirement');
    await renderWithProfile(<RetirementIncomePage />, { household });
    const result = project(household);
    const card = screen.getByRole('region', { name: 'Retirement income, gross to net' });
    for (const feature of retirementExclusions(result)) {
      expect(within(card).getByText(excludedFeatureLabel(feature))).toBeInTheDocument();
    }
    if (result.rows.some((r) => r.phase === 'retirement' && r.tax === null)) {
      expect(within(card).getByText('Before taxes')).toBeInTheDocument();
    }
    await user.click(within(card).getByRole('button', { name: /Show income sources data table/ }));
    const data = within(card).getByRole('region', { name: 'Gross retirement income by source, today’s dollars' });
    expect(within(data).getByRole('columnheader', { name: 'Social Security' })).toBeInTheDocument();
    expect(within(data).getByRole('columnheader', { name: 'Spending need' })).toBeInTheDocument();
  });
});
