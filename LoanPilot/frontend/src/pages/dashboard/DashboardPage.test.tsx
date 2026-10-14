import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeDashboard, makeLoan, makeLoanListItem, makeStatus } from '@/test/fixtures';
import { json, mockApi } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { DashboardPage } from './DashboardPage';

/** The card that contains a KPI label. */
function card(label: string | RegExp) {
  const el = screen.getByText(label);
  const c = el.closest('[data-slot="card"]');
  if (!c) throw new Error(`No card for ${String(label)}`);
  return within(c as HTMLElement);
}

describe('DashboardPage', () => {
  it('shows the empty state with a call to action when there are no loans', async () => {
    mockApi({ 'GET /api/loans': json([]) });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Add your first loan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add your first loan/ })).toHaveAttribute('href', '/loans/new');
  });

  it('renders KPIs, progress, next payment, savings and warnings from the dashboard', async () => {
    const api = mockApi({
      'GET /api/loans': json([makeLoanListItem()]),
      'GET /api/loans/:id/dashboard': json(makeDashboard()),
    });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByTestId('hero-balance')).toHaveTextContent('$12,178.73');
    expect(api.callsTo('GET /api/loans/1/dashboard')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '2024 Toyota RAV4' })).toBeInTheDocument();
    expect(screen.getByText('2024 Toyota RAV4 · Ally Financial')).toBeInTheDocument();

    // Hero: balance is estimated (no balance entered), progress and payoff date.
    expect(screen.getByText('51.3% of original principal repaid')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Original principal repaid' })).toHaveAttribute('aria-valuenow', '51.29');
    expect(screen.getByText('January 2029')).toBeInTheDocument();
    expect(screen.getByText(/Estimated from the original schedule/)).toBeInTheDocument();

    expect(card('Original loan amount').getByText('$25,000.00')).toBeInTheDocument();
    expect(card('Monthly payment').getByText('$483.32')).toBeInTheDocument();
    expect(card('Monthly payment').getByText('Standard computed payment')).toBeInTheDocument();
    expect(card('Remaining payments').getByText('27 payments')).toBeInTheDocument();
    expect(card('Remaining interest').getByText('$870.94')).toBeInTheDocument();

    const lifetime = card('Total projected loan cost');
    expect(lifetime.getByText('$28,999.23')).toBeInTheDocument();
    expect(lifetime.getByText('Estimated')).toBeInTheDocument();

    const payoff = card('Estimated payoff amount today');
    expect(payoff.getByText('$12,204.76')).toBeInTheDocument();
    expect(payoff.getByText(/not a lender payoff quote/)).toBeInTheDocument();
    expect(payoff.getByText('Estimate')).toBeInTheDocument();

    expect(card('Potential interest savings').getByText('$844.91')).toBeInTheDocument();
    expect(card('Equity').getByText(/Add the vehicle's value/)).toBeInTheDocument();

    const next = card('Next scheduled payment');
    expect(next.getByText('Payment #34 · due November 1, 2026')).toBeInTheDocument();
    expect(next.getByText('$422.43')).toBeInTheDocument();
    expect(next.getByText('$60.89')).toBeInTheDocument();

    // Savings options list (5 entries from the API).
    const savings = card('Ways to save');
    expect(savings.getByText('+$50/mo')).toBeInTheDocument();
    expect(savings.getByText('$85.17')).toBeInTheDocument();
    expect(savings.getByText('Pay off today')).toBeInTheDocument();

    // status.warnings shown as an alert.
    expect(screen.getByText(/No current balance was entered/)).toBeInTheDocument();

    // Charts render their cards; table twins are available.
    expect(screen.getByText('Remaining balance')).toBeInTheDocument();
    expect(screen.getByText('Principal vs interest per payment')).toBeInTheDocument();
    expect(screen.getByText('Where your remaining payments go')).toBeInTheDocument();
  });

  it('shows the top three insights with an expandable explanation', async () => {
    mockApi({ 'GET /api/loans': json([makeLoanListItem()]), 'GET /api/loans/:id/dashboard': json(makeDashboard()) });
    const { user } = renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Repayment progress')).toBeInTheDocument();
    expect(screen.getByText('Projected payoff')).toBeInTheDocument();
    expect(screen.getByText('Pay a little extra')).toBeInTheDocument();
    expect(screen.queryByText('Cut your remaining interest')).not.toBeInTheDocument();

    const toggles = screen.getAllByRole('button', { name: 'How this was calculated' });
    expect(toggles).toHaveLength(3);
    expect(screen.queryByText(/\(Original amount \$25,000.00/)).not.toBeInTheDocument();
    await user.click(toggles[0]);
    expect(screen.getByText(/\(Original amount \$25,000.00/)).toBeInTheDocument();
  });

  it('labels unknown lifetime cost, equity and a custom payment', async () => {
    const loan = makeLoan({ id: 2, name: 'Truck', vehicleValue: 9000, scheduledPayment: 500, paymentFrequency: 'biweekly' });
    mockApi({
      'GET /api/loans': json([makeLoanListItem({ loan })]),
      'GET /api/loans/:id/dashboard': json(
        makeDashboard({
          loan,
          status: makeStatus({
            projectedLifetimeCost: null,
            lifetimeCostIsEstimated: false,
            balanceIsEstimated: false,
            vehicleValue: 9000,
            equity: -3178.73,
            scheduledPayment: 500,
            paymentIsStandard: false,
            standardPayment: 483.32,
            warnings: [{ code: 'stale-balance', message: 'Your balance is more than 90 days old.', severity: 'warning' }],
          }),
        }),
      ),
    });
    renderWithProviders(<DashboardPage />);

    const lifetime = await screen.findByText('Total projected loan cost');
    const lifetimeCard = within(lifetime.closest('[data-slot="card"]') as HTMLElement);
    expect(lifetimeCard.getByText('$13,049.67')).toBeInTheDocument();
    expect(lifetimeCard.getByText('Remaining only')).toBeInTheDocument();
    expect(lifetimeCard.getByText(/is unknown/)).toBeInTheDocument();

    expect(card('Equity').getByText('-$3,178.73')).toBeInTheDocument();
    expect(card('Equity').getByText('Upside down')).toBeInTheDocument();
    expect(card('Biweekly payment').getByText('Standard payment would be $483.32')).toBeInTheDocument();
    expect(card('Biweekly payment').getByText('Custom')).toBeInTheDocument();

    const alert = screen.getByText('Your balance is more than 90 days old.').closest('[role="alert"]');
    expect(alert).toHaveAttribute('data-severity', 'warning');
  });

  it('shows an error with a retry when the dashboard fails to load', async () => {
    let calls = 0;
    mockApi({
      'GET /api/loans': json([makeLoanListItem()]),
      'GET /api/loans/:id/dashboard': () => (++calls === 1 ? { status: 500, json: { title: 'Engine failure' } } : json(makeDashboard())),
    });
    const { user } = renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('Engine failure')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByTestId('hero-balance')).toHaveTextContent('$12,178.73'));
  });
});
