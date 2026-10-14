import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Loan, LoanInput, LoanListItem } from '@/api/types';
import { makeLoan, makeLoanListItem, makePreview, makeStatus } from '@/test/fixtures';
import { json, mockApi, problem, type MockRequest } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { LoanDetailsPage } from './LoanDetailsPage';

const routes = (
  <>
    <Route path="/" element={<h1>Dashboard stub</h1>} />
    <Route path="/loans/new" element={<LoanDetailsPage />} />
    <Route path="/loans/:id/edit" element={<LoanDetailsPage />} />
  </>
);

beforeEach(() => {
  // Fake only the clock (not timers) so "today" is stable and user-event still works.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

/** A loans list the POST handler appends to, as the real API would. */
function loanStore(initial: LoanListItem[] = []) {
  const items = [...initial];
  return {
    items,
    list: () => json(items),
    create: (req: MockRequest) => {
      const loan = makeLoan({ ...(req.body as LoanInput), id: 7 });
      items.push(makeLoanListItem({ loan }));
      return json(loan, 201);
    },
  };
}

const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Loan Details — create', () => {
  it('shows client-side errors for required fields and does not submit', async () => {
    const store = loanStore();
    const api = mockApi({ 'GET /api/loans': store.list, 'POST /api/loans': store.create });
    const { user } = renderWithProviders(null, { route: '/loans/new', routes });

    await user.click(await screen.findByRole('button', { name: 'Save loan' }));

    expect(await screen.findByText('Give this loan a name, e.g. "2024 RAV4".')).toBeInTheDocument();
    expect(screen.getByText('Enter the amount you financed.')).toBeInTheDocument();
    expect(screen.getByText('Enter the APR from your contract (0 is allowed).')).toBeInTheDocument();
    expect(screen.getByText('3 fields need attention.')).toBeInTheDocument();
    expect(screen.getByLabelText('Loan name')).toHaveFocus();
    expect(screen.getByLabelText('Loan name')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST /api/loans')).toHaveLength(0);
  });

  it('checks obvious ranges and date order', async () => {
    mockApi({ 'GET /api/loans': json([]) });
    const { user } = renderWithProviders(null, { route: '/loans/new', routes });

    await user.type(await screen.findByLabelText('Loan name'), 'Car');
    await user.type(screen.getByLabelText('Original loan amount'), '0');
    await user.type(screen.getByLabelText('APR'), '150');
    const term = screen.getByLabelText('Term');
    await user.clear(term);
    await user.type(term, '400');
    setDate('Start date', '2024-03-10');
    setDate('First payment date', '2024-03-01');
    await user.click(screen.getByRole('button', { name: 'Save loan' }));

    expect(await screen.findByText('The loan amount must be more than zero.')).toBeInTheDocument();
    expect(screen.getByText('Enter an APR between 0% and 100%.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number of months between 1 and 240.')).toBeInTheDocument();
    expect(screen.getByText('The first payment must be after the start date.')).toBeInTheDocument();
  });

  it('shows a field error once the field is left, before submitting', async () => {
    mockApi({ 'GET /api/loans': json([]) });
    const { user } = renderWithProviders(null, { route: '/loans/new', routes });
    await user.click(await screen.findByLabelText('Loan name'));
    await user.tab();
    expect(await screen.findByText('Give this loan a name, e.g. "2024 RAV4".')).toBeInTheDocument();
    expect(screen.queryByText('Enter the amount you financed.')).not.toBeInTheDocument();
  });

  it('submits the LoanInput payload, selects the new loan and goes to the dashboard', async () => {
    const store = loanStore();
    const api = mockApi({
      'GET /api/loans': store.list,
      'POST /api/loans': store.create,
      'POST /api/calculate/preview': json(makePreview()),
    });
    const { user } = renderWithProviders(null, { route: '/loans/new', routes });

    await user.type(await screen.findByLabelText('Loan name'), '  2023 Honda CR-V ');
    await user.type(screen.getByLabelText(/^Make/), 'Honda');
    await user.type(screen.getByLabelText(/^Model/), 'CR-V');
    await user.type(screen.getByLabelText(/^Year/), '2023');
    await user.type(screen.getByLabelText('Original loan amount'), '32000');
    await user.type(screen.getByLabelText('APR'), '6.49');
    await user.click(screen.getByRole('radio', { name: '72 months' }));
    setDate('Start date', '2024-03-10');
    setDate('First payment date', '2024-04-10');

    // Daily simple interest reveals the day-count basis.
    expect(screen.queryByText('Day-count basis')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Daily simple interest/ }));
    expect(screen.getByText('Day-count basis')).toBeInTheDocument();

    // Existing loan.
    await user.click(screen.getByRole('switch', { name: 'This loan is already in progress' }));
    await user.type(screen.getByLabelText('Current principal balance'), '21480.55');
    setDate('Balance as of', '2026-10-01');
    expect(screen.getByText('Projections start from the as-of date')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Vehicle value/), '26000');
    await user.click(screen.getByRole('button', { name: 'Save loan' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(screen.getByRole('heading', { name: 'Dashboard stub' })).toBeInTheDocument();

    const [post] = api.callsTo('POST /api/loans');
    const expected: LoanInput = {
      name: '2023 Honda CR-V',
      vehicleMake: 'Honda',
      vehicleModel: 'CR-V',
      vehicleYear: 2023,
      lender: null,
      originalAmount: 32000,
      downPayment: null,
      aprPercent: 6.49,
      termMonths: 72,
      startDate: '2024-03-10',
      firstPaymentDate: '2024-04-10',
      scheduledPayment: null,
      paymentFrequency: 'monthly',
      accrualMethod: 'dailySimple',
      dayCountBasis: 'actual365',
      currentBalance: 21480.55,
      balanceAsOf: '2026-10-01',
      paymentsMade: null,
      interestPaidToDate: null,
      vehicleValue: 26000,
      notes: null,
    };
    expect(post.body).toEqual(expected);

    // The new loan is selected (preferences + localStorage).
    await waitFor(() => expect(api.callsTo('PUT /api/preferences').some((c) => (c.body as { selectedLoanId: number }).selectedLoanId === 7)).toBe(true));
    expect(window.localStorage.getItem('loanpilot.selectedLoanId')).toBe('7');
  });

  it('requires a custom payment when "use standard payment" is off and sends it', async () => {
    const store = loanStore();
    const api = mockApi({ 'GET /api/loans': store.list, 'POST /api/loans': store.create });
    const { user } = renderWithProviders(null, { route: '/loans/new', routes });

    await user.type(await screen.findByLabelText('Loan name'), 'Car');
    await user.type(screen.getByLabelText('Original loan amount'), '20000');
    await user.type(screen.getByLabelText('APR'), '0');
    await user.click(screen.getByRole('switch', { name: 'Use standard payment' }));
    await user.click(screen.getByRole('button', { name: 'Save loan' }));
    expect(await screen.findByText('Enter your payment, or switch on "Use standard payment".')).toBeInTheDocument();
    expect(api.callsTo('POST /api/loans')).toHaveLength(0);

    await user.type(screen.getByLabelText('Scheduled payment'), '400');
    await user.click(screen.getByRole('button', { name: 'Save loan' }));
    await waitFor(() => expect(api.callsTo('POST /api/loans')).toHaveLength(1));
    expect(api.callsTo('POST /api/loans')[0].body).toMatchObject({ scheduledPayment: 400, aprPercent: 0, termMonths: 60, currentBalance: null });
  });

  it('maps server 400 errors onto the matching fields and shows the rest in a banner', async () => {
    mockApi({
      'GET /api/loans': json([]),
      'POST /api/loans': problem(
        {
          aprPercent: ['APR must be 50% or less.'],
          FirstPaymentDate: ['The first payment date must be within a year of the start date.'],
          body: ['Something about the whole request.'],
        },
        'Please check the highlighted fields.',
      ),
    });
    const { user } = renderWithProviders(null, { route: '/loans/new', routes });

    await user.type(await screen.findByLabelText('Loan name'), 'Car');
    await user.type(screen.getByLabelText('Original loan amount'), '20000');
    await user.type(screen.getByLabelText('APR'), '60');
    await user.click(screen.getByRole('button', { name: 'Save loan' }));

    const aprError = await screen.findByText('APR must be 50% or less.');
    const apr = screen.getByLabelText('APR');
    expect(apr).toHaveAttribute('aria-invalid', 'true');
    expect(apr.getAttribute('aria-describedby')).toContain(aprError.id);
    expect(screen.getByText('The first payment date must be within a year of the start date.')).toBeInTheDocument();
    expect(screen.getByText('Something about the whole request.')).toBeInTheDocument();
    expect(apr).toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('/loans/new');

    // Editing the field clears its server error.
    await user.clear(apr);
    await user.type(apr, '9');
    expect(screen.queryByText('APR must be 50% or less.')).not.toBeInTheDocument();
  });

  it('calls the preview endpoint with the debounced form and shows the estimate', async () => {
    const api = mockApi({
      'GET /api/loans': json([]),
      'POST /api/calculate/preview': json(
        makePreview({
          status: makeStatus({ standardPayment: 537.77, warnings: [] }),
          baseline: { ...makePreview().baseline, totalInterest: 6719.44, payoffDate: '2030-03-10', paysOff: true },
        }),
      ),
    });
    const { user } = renderWithProviders(null, { route: '/loans/new', routes });

    expect(await screen.findByText(/Enter the loan amount, APR, term and dates/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Original loan amount'), '32000');
    await user.type(screen.getByLabelText('APR'), '6.49');

    expect(await screen.findByText('$537.77', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('$6,719.44')).toBeInTheDocument();
    expect(screen.getByText('Mar 10, 2030')).toBeInTheDocument();
    // Debounced: one request for the final value, not one per keystroke.
    const previews = api.callsTo('POST /api/calculate/preview');
    expect(previews.length).toBeLessThanOrEqual(2);
    expect(previews.at(-1)?.body).toMatchObject({ originalAmount: 32000, aprPercent: 6.49, name: 'Preview' });
  });
});

describe('Loan Details — update balance link', () => {
  it('opens the current-status fields and focuses the balance for ?focus=currentBalance', async () => {
    const noBalance: Loan = makeLoan({ id: 4, name: 'Commuter', currentBalance: null, balanceAsOf: null });
    mockApi({
      'GET /api/loans': json([makeLoanListItem({ loan: noBalance })]),
      'GET /api/loans/:id': json(noBalance),
      'POST /api/calculate/preview': json(makePreview()),
    });
    renderWithProviders(null, { route: '/loans/4/edit?focus=currentBalance', routes });

    const balance = await screen.findByLabelText('Current principal balance');
    expect(screen.getByRole('switch', { name: 'This loan is already in progress' })).toBeChecked();
    await waitFor(() => expect(balance).toHaveFocus());
    expect(screen.getByTestId('update-balance-hint')).toHaveTextContent('Update from your latest statement');
  });
});

describe('Loan Details — edit', () => {
  const existing: Loan = makeLoan({ id: 3, name: 'Family SUV', currentBalance: 15000, balanceAsOf: '2026-09-01', vehicleValue: 21000 });

  it('pre-fills the form and saves with PUT', async () => {
    const api = mockApi({
      'GET /api/loans': json([makeLoanListItem({ loan: existing })]),
      'GET /api/loans/:id': json(existing),
      'PUT /api/loans/:id': (req) => json({ ...existing, ...(req.body as LoanInput), updatedAt: '2026-10-14T13:00:00Z' }),
      'POST /api/calculate/preview': json(makePreview()),
    });
    const { user } = renderWithProviders(null, { route: '/loans/3/edit', routes });

    const name = await screen.findByLabelText('Loan name');
    expect(name).toHaveValue('Family SUV');
    expect(screen.getByLabelText('Original loan amount')).toHaveValue('25,000.00');
    expect(screen.getByRole('switch', { name: 'This loan is already in progress' })).toBeChecked();
    expect(screen.getByLabelText('Current principal balance')).toHaveValue('15,000.00');

    await user.clear(name);
    await user.type(name, 'Family SUV (2024)');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.callsTo('PUT /api/loans/3')).toHaveLength(1));
    expect(api.callsTo('PUT /api/loans/3')[0].body).toMatchObject({
      name: 'Family SUV (2024)',
      currentBalance: 15000,
      balanceAsOf: '2026-09-01',
      vehicleValue: 21000,
    });
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
  });

  it('deletes after confirming in the dialog', async () => {
    const api = mockApi({
      'GET /api/loans': json([makeLoanListItem({ loan: existing })]),
      'GET /api/loans/:id': json(existing),
      'DELETE /api/loans/:id': { status: 204 },
    });
    const { user } = renderWithProviders(null, { route: '/loans/3/edit', routes });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete Family SUV?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep loan' }));
    expect(api.callsTo('DELETE /api/loans/3')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete loan' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/loans/3')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('archives and shows a not-found state for a missing loan', async () => {
    const api = mockApi({
      'GET /api/loans': json([]),
      'GET /api/loans/:id': (req) => (req.params.id === '3' ? json(existing) : { status: 404, json: { title: 'Not Found', status: 404 } }),
      'POST /api/loans/:id/archive': json({ ...existing, isArchived: true }),
    });
    const { user, unmount } = renderWithProviders(null, { route: '/loans/3/edit', routes });
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.callsTo('POST /api/loans/3/archive')).toHaveLength(1));
    unmount();

    renderWithProviders(null, { route: '/loans/99/edit', routes });
    expect(await screen.findByText('This loan could not be found')).toBeInTheDocument();
  });
});
