import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLoan, makeLoanListItem, makePreferences } from '@/test/fixtures';
import { json, mockApi } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { App } from './App';

const NAV_ORDER = [
  'Dashboard',
  'Loan Details',
  'Payoff Simulator',
  'Scenario Comparison',
  'Amortization Schedule',
  'Insights',
  'Refinance',
  'Payments',
  'Settings',
];

describe('App shell', () => {
  it('lists the navigation in the specified order', async () => {
    mockApi({ 'GET /api/loans': json([]) });
    renderWithProviders(<App />, { route: '/simulator' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(NAV_ORDER);
    expect(within(nav).getByRole('link', { name: 'Loan Details' })).toHaveAttribute('href', '/loans/new');
    expect(within(nav).getByRole('link', { name: 'Payoff Simulator' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Select a loan to simulate payoff strategies')).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it('restores the selected loan from preferences and lets the user switch loans', async () => {
    const a = makeLoanListItem({ loan: makeLoan({ id: 1, name: 'Sedan' }) });
    const b = makeLoanListItem({ loan: makeLoan({ id: 2, name: 'Pickup' }), currentBalance: 8000 });
    const api = mockApi({
      'GET /api/loans': json([a, b]),
      'GET /api/preferences': json(makePreferences({ selectedLoanId: 2 })),
    });
    const { user } = renderWithProviders(<App />, { route: '/schedule' });

    const selector = await screen.findByRole('button', { name: 'Select loan' });
    await waitFor(() => expect(selector).toHaveTextContent('Pickup'));
    expect(screen.getByRole('link', { name: 'Loan Details' })).toHaveAttribute('href', '/loans/2/edit');
    // The schedule page renders for the restored loan (its name appears in the selector and the page eyebrow).
    expect(await screen.findByRole('heading', { name: 'Amortization schedule' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Pickup').length).toBeGreaterThanOrEqual(2));

    await user.click(selector);
    await user.click(await screen.findByRole('menuitemradio', { name: /Sedan/ }));
    await waitFor(() => expect(selector).toHaveTextContent('Sedan'));
    expect(window.localStorage.getItem('loanpilot.selectedLoanId')).toBe('1');
    await waitFor(() =>
      expect(api.callsTo('PUT /api/preferences').at(-1)?.body).toMatchObject({ selectedLoanId: 1 }),
    );
  });

  it('falls back to the first loan when the remembered one no longer exists', async () => {
    window.localStorage.setItem('loanpilot.selectedLoanId', '42');
    mockApi({ 'GET /api/loans': json([makeLoanListItem({ loan: makeLoan({ id: 5, name: 'Coupe' }) })]) });
    renderWithProviders(<App />, { route: '/insights' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select loan' })).toHaveTextContent('Coupe'));
    await waitFor(() => expect(window.localStorage.getItem('loanpilot.selectedLoanId')).toBe('5'));
  });
});
