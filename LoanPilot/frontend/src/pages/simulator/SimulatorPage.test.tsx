import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ScenarioInput } from '@/api/types';
import { todayIso } from '@/lib/format';
import { makeDashboard, makeLoanListItem, makeStatus } from '@/test/fixtures';
import { json, mockApi, problem, type MockHandler, type MockRequest } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { SimulatorPage } from './SimulatorPage';
import { makeComparison, makeScenario, makeSimulation, makeTargetResult } from './testFixtures';

const PROJECTION_START = '2026-10-01';
const defaultLumpDate = () => (todayIso() > PROJECTION_START ? todayIso() : PROJECTION_START);

function setup(routes: Record<string, MockHandler> = {}, route = '/simulator') {
  const api = mockApi({
    'GET /api/loans': json([makeLoanListItem()]),
    'GET /api/loans/:id/dashboard': json(makeDashboard()),
    'GET /api/loans/:id/scenarios': json([]),
    'GET /api/loans/:id/comparison': json(makeComparison({}, [])),
    'POST /api/loans/:id/simulate': json(makeSimulation()),
    ...routes,
  });
  const result = renderWithProviders(null, { route, routes: <Route path="/simulator" element={<SimulatorPage />} /> });
  return { api, ...result };
}

const simulateBodies = (api: ReturnType<typeof mockApi>) => api.callsTo('POST /api/loans/1/simulate').map((c) => c.body as ScenarioInput);
const lastSimulateBody = (api: ReturnType<typeof mockApi>) => simulateBodies(api).at(-1);

describe('SimulatorPage — extra payment', () => {
  it('simulates the default $100/month and renders the headline results', async () => {
    const { api } = setup();
    expect(await screen.findByTestId('new-payoff-date')).toHaveTextContent('September 2028');
    expect(lastSimulateBody(api)).toEqual({
      name: 'Simulation',
      description: null,
      budgetPayment: null,
      recurringExtras: [{ amount: 100, startDate: null, endDate: null }],
      lumpSums: [],
    });
    expect(screen.getByTestId('interest-saved')).toHaveTextContent('$154.96');
    expect(screen.getByTestId('months-saved')).toHaveTextContent('4 mo sooner');
    expect(screen.getByText('17.8%')).toBeInTheDocument();
    expect(screen.getByText('Loan balance over time')).toBeInTheDocument();
    expect(screen.getByText('Interest savings')).toBeInTheDocument();
    expect(screen.getByText('Payoff timeline')).toBeInTheDocument();
    expect(screen.getByText('Principal vs interest per payment')).toBeInTheDocument();
    expect(screen.getByText(/never reduce or skip your next scheduled payment/)).toBeInTheDocument();
    // Monthly loan → "per month" wording.
    expect(screen.getByLabelText('Extra amount per month')).toHaveValue('100.00');
  });

  it('posts the chosen quick chip amount', async () => {
    const { api, user } = setup();
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('radio', { name: '$50 per month' }));
    await waitFor(() => expect(lastSimulateBody(api)?.recurringExtras).toEqual([{ amount: 50, startDate: null, endDate: null }]));
    expect(screen.getByLabelText('Extra amount per month')).toHaveValue('50.00');
  });

  it('debounces a typed custom amount and posts only the settled value', async () => {
    const { api, user } = setup();
    await screen.findByTestId('new-payoff-date');
    const input = screen.getByLabelText('Extra amount per month');
    await user.clear(input);
    await user.type(input, '175');
    await waitFor(() => expect(lastSimulateBody(api)?.recurringExtras).toEqual([{ amount: 175, startDate: null, endDate: null }]));
    const amounts = simulateBodies(api).map((b) => b.recurringExtras[0]?.amount);
    expect(amounts).not.toContain(1);
    expect(amounts).not.toContain(17);
  });

  it('includes the optional start date and labels biweekly loans "per payment"', async () => {
    const loan = makeDashboard().loan;
    const biweekly = { ...loan, paymentFrequency: 'biweekly' as const };
    const { api } = setup({
      'GET /api/loans': json([makeLoanListItem({ loan: biweekly })]),
      'GET /api/loans/:id/dashboard': json(makeDashboard({ loan: biweekly })),
    });
    const input = await screen.findByLabelText('Extra amount per payment');
    expect(input).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: '2027-01-01' } });
    await waitFor(() => expect(lastSimulateBody(api)?.recurringExtras).toEqual([{ amount: 100, startDate: '2027-01-01', endDate: null }]));
  });
});

describe('SimulatorPage — lump sum and combined', () => {
  it('builds a lump-sum payload from amount, date and note', async () => {
    const { api, user } = setup();
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('tab', { name: 'One-time lump sum' }));
    await waitFor(() =>
      expect(lastSimulateBody(api)).toMatchObject({ recurringExtras: [], lumpSums: [{ amount: 1000, date: defaultLumpDate(), note: null }] }),
    );
    const amount = screen.getByLabelText('Lump-sum amount');
    await user.clear(amount);
    await user.type(amount, '2500');
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2027-03-15' } });
    await user.type(screen.getByLabelText(/Note/), 'Tax refund');
    await waitFor(() =>
      expect(lastSimulateBody(api)).toEqual({
        name: 'Simulation',
        description: null,
        budgetPayment: null,
        recurringExtras: [],
        lumpSums: [{ amount: 2500, date: '2027-03-15', note: 'Tax refund' }],
      }),
    );
  });

  it('builds a combined payload with several recurring extras (start/end dates) and lump sums', async () => {
    const { api, user } = setup();
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('tab', { name: 'Combined strategy' }));

    const recurring = within(screen.getByRole('region', { name: 'Recurring extras' }));
    fireEvent.change(recurring.getAllByLabelText(/Until/)[0], { target: { value: '2027-12-01' } });
    await user.click(screen.getByRole('button', { name: /Add recurring extra/ }));
    await user.type(recurring.getAllByLabelText('Amount per month')[1], '250');
    fireEvent.change(recurring.getAllByLabelText(/From/)[1], { target: { value: '2028-01-01' } });

    const lumps = within(screen.getByRole('region', { name: 'Lump sums' }));
    await user.click(screen.getByRole('button', { name: /Add lump sum/ }));
    await user.type(lumps.getAllByLabelText('Amount')[1], '3000');
    fireEvent.change(lumps.getAllByLabelText('Date')[1], { target: { value: '2028-04-15' } });

    await waitFor(() =>
      expect(lastSimulateBody(api)).toEqual({
        name: 'Simulation',
        description: null,
        budgetPayment: null,
        recurringExtras: [
          { amount: 100, startDate: null, endDate: '2027-12-01' },
          { amount: 250, startDate: '2028-01-01', endDate: null },
        ],
        lumpSums: [
          { amount: 1000, date: defaultLumpDate(), note: null },
          { amount: 3000, date: '2028-04-15', note: null },
        ],
      }),
    );

    // Removing a row drops it from the payload.
    await user.click(screen.getByRole('button', { name: 'Remove recurring extra 1' }));
    await waitFor(() => expect(lastSimulateBody(api)?.recurringExtras).toEqual([{ amount: 250, startDate: '2028-01-01', endDate: null }]));
  });
});

describe('SimulatorPage — server validation', () => {
  it('shows a lump-sum date error next to the date input and keeps the last result', async () => {
    const simulate = (req: MockRequest) => {
      const body = req.body as ScenarioInput;
      return body.lumpSums.length > 0
        ? problem({ 'lumpSums[0].date': ['Enter a valid date for this lump sum.'] })
        : json(makeSimulation());
    };
    const { user } = setup({ 'POST /api/loans/:id/simulate': simulate });
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('tab', { name: 'One-time lump sum' }));

    const message = await screen.findByText('Enter a valid date for this lump sum.');
    const date = screen.getByLabelText('Payment date');
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(date.getAttribute('aria-describedby')).toContain(message.id);
    // Previous result stays visible, flagged as stale.
    expect(screen.getByTestId('new-payoff-date')).toHaveTextContent('September 2028');
    expect(screen.getByText(/Showing the last valid result/)).toBeInTheDocument();
  });

  it('maps indexed errors to the right combined row even when an empty row is skipped', async () => {
    const simulate = (req: MockRequest) => {
      const body = req.body as ScenarioInput;
      return body.recurringExtras.length === 1 && body.recurringExtras[0].amount === 40
        ? problem({ 'recurringExtras[0].endDate': ['The end date must be on or after the start date.'], budgetPayment: ['Budget too low.'] })
        : json(makeSimulation());
    };
    const { user } = setup({ 'POST /api/loans/:id/simulate': simulate });
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('tab', { name: 'Combined strategy' }));
    const recurring = within(screen.getByRole('region', { name: 'Recurring extras' }));
    await user.clear(recurring.getAllByLabelText('Amount per month')[0]);
    await user.click(screen.getByRole('button', { name: /Add recurring extra/ }));
    await user.type(recurring.getAllByLabelText('Amount per month')[1], '40');
    await user.type(screen.getByLabelText(/Fixed budget per month/), '100');

    const message = await screen.findByText('The end date must be on or after the start date.');
    const secondUntil = recurring.getAllByLabelText(/Until/)[1];
    expect(secondUntil.getAttribute('aria-describedby')).toContain(message.id);
    expect(recurring.getAllByLabelText(/Until/)[0]).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/Fixed budget per month/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Budget too low.')).toBeInTheDocument();
  });

  it('shows the budget-below-payment error inline in budget mode', async () => {
    const { api, user } = setup({
      'POST /api/loans/:id/budget': (req) =>
        (req.body as { budget: number }).budget < 483.32
          ? problem({ budget: ['Your budget must be at least your scheduled payment of $483.32.'] })
          : json({ budget: 600, extraAmount: 116.68, simulation: makeSimulation() }),
    });
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    const input = screen.getByLabelText('I can afford per month');
    await user.type(input, '400');
    expect(await screen.findByText('Your budget must be at least your scheduled payment of $483.32.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.clear(input);
    await user.type(input, '600');
    expect(await screen.findByTestId('budget-result')).toHaveTextContent('+$116.68');
    expect(api.callsTo('POST /api/loans/1/budget').at(-1)?.body).toEqual({ budget: 600 });
  });
});

describe('SimulatorPage — target payoff date', () => {
  it('shows the required payment and turns it into an extra-payment scenario', async () => {
    const { api, user } = setup({ 'POST /api/loans/:id/target-payoff': json(makeTargetResult()) });
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('tab', { name: 'Target payoff date' }));

    // Default target: one year before the baseline payoff (2029-01-01).
    await waitFor(() => expect(api.callsTo('POST /api/loans/1/target-payoff').at(-1)?.body).toEqual({ targetDate: '2028-01-01' }));
    const result = await screen.findByTestId('target-result');
    expect(within(result).getByText('$758.27')).toBeInTheDocument();
    expect(within(result).getByText('+$274.95')).toBeInTheDocument();
    expect(within(result).getByText(/to be paid off by January 1, 2028/)).toBeInTheDocument();
    expect(screen.getByTestId('new-payoff-date')).toHaveTextContent('January 2028');

    await user.click(screen.getByRole('radio', { name: '2 years sooner' }));
    await waitFor(() => expect(api.callsTo('POST /api/loans/1/target-payoff').at(-1)?.body).toEqual({ targetDate: '2027-01-01' }));

    await user.click(within(screen.getByTestId('target-result')).getByRole('button', { name: /Use this as a scenario/ }));
    expect(screen.getByRole('tab', { name: 'Extra payment' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByLabelText('Extra amount per month')).toHaveValue('274.95');
    await waitFor(() => expect(lastSimulateBody(api)?.recurringExtras).toEqual([{ amount: 274.95, startDate: null, endDate: null }]));
  });

  it('explains when the target date cannot be reached', async () => {
    const { user } = setup({
      'POST /api/loans/:id/target-payoff': json(
        makeTargetResult({
          achievable: false,
          requiredPayment: null,
          additionalAmount: null,
          simulation: null,
          message: 'Your next payment is due November 1, 2026. To be debt-free before then you would need to pay the loan off in one payment.',
        }),
      ),
    });
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('tab', { name: 'Target payoff date' }));
    expect(await screen.findByTestId('target-unachievable')).toHaveTextContent(/Your next payment is due November 1, 2026/);
    expect(await screen.findByText('No regular payment reaches that date')).toBeInTheDocument();
    expect(screen.queryByTestId('new-payoff-date')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save scenario' })).toBeDisabled();
  });
});

describe('SimulatorPage — saved scenarios', () => {
  it('saves the current plan from the dialog and refreshes everything under the loan', async () => {
    let saved = false;
    const { api, user } = setup({
      'GET /api/loans/:id/scenarios': () => json(saved ? [makeScenario({ id: 31, name: 'Extra hundred', description: null, recurringExtras: [{ amount: 100, startDate: null, endDate: null }], lumpSums: [] })] : []),
      'POST /api/loans/:id/scenarios': (req) => {
        saved = true;
        return json({ ...makeScenario(), ...(req.body as ScenarioInput), id: 31 }, 201);
      },
    });
    await screen.findByTestId('new-payoff-date');
    const scenarioLists = api.callsTo('GET /api/loans/1/scenarios').length;
    const dashboards = api.callsTo('GET /api/loans/1/dashboard').length;

    await user.click(screen.getByRole('button', { name: 'Save scenario' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('+$100/mo')).toBeInTheDocument();
    // Name is required (client side).
    await user.click(within(dialog).getByRole('button', { name: 'Save scenario' }));
    expect(within(dialog).getByText(/Give the scenario a name/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Name'), 'Extra hundred');
    await user.type(within(dialog).getByLabelText(/Description/), 'Round number');
    await user.click(within(dialog).getByRole('button', { name: 'Save scenario' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.callsTo('POST /api/loans/1/scenarios')[0].body).toEqual({
      name: 'Extra hundred',
      description: 'Round number',
      budgetPayment: null,
      recurringExtras: [{ amount: 100, startDate: null, endDate: null }],
      lumpSums: [],
    });
    // Invalidation of the ['loans'] root refetches the scenario list and the dashboard.
    await waitFor(() => expect(api.callsTo('GET /api/loans/1/scenarios').length).toBeGreaterThan(scenarioLists));
    await waitFor(() => expect(api.callsTo('GET /api/loans/1/dashboard').length).toBeGreaterThan(dashboards));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('shows server field errors in the save dialog', async () => {
    const { user } = setup({ 'POST /api/loans/:id/scenarios': problem({ name: ['That name is already used.'] }) });
    await screen.findByTestId('new-payoff-date');
    await user.click(screen.getByRole('button', { name: 'Save scenario' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Dup');
    await user.click(within(dialog).getByRole('button', { name: 'Save scenario' }));
    expect(await within(dialog).findByText('That name is already used.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('marks a saved lump sum dated before the balance date as already paid', async () => {
    const scenario = makeScenario({
      lumpSums: [
        { amount: 2000, date: '2026-09-15', note: 'Paid in September' },
        { amount: 1500, date: '2027-03-15', note: 'Bonus' },
      ],
    });
    setup({ 'GET /api/loans/:id/scenarios': json([scenario]) }, '/simulator?scenario=7');

    const lumps = within(await screen.findByRole('region', { name: 'Lump sums' }));
    // Only the September lump sum (before the Oct 1, 2026 balance date) is marked; the plan stays editable.
    const notes = await lumps.findAllByTestId('already-paid');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('Already paid');
    expect(notes[0]).toHaveTextContent('Oct 1, 2026');
  });

  it('loads ?scenario=<id> into the editor and can update it', async () => {
    const scenario = makeScenario();
    const { api, user } = setup({
      'GET /api/loans/:id/scenarios': json([scenario]),
      'PUT /api/loans/:id/scenarios/:sid': (req) => json({ ...scenario, ...(req.body as ScenarioInput) }),
    }, '/simulator?scenario=7');

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Combined strategy' })).toHaveAttribute('data-state', 'active'));
    const recurring = within(screen.getByRole('region', { name: 'Recurring extras' }));
    expect(recurring.getByLabelText('Amount per month')).toHaveValue('60.00');
    expect(recurring.getByLabelText(/Until/)).toHaveValue('2027-12-01');
    const lumps = within(screen.getByRole('region', { name: 'Lump sums' }));
    expect(lumps.getByLabelText('Amount')).toHaveValue('1,500.00');
    expect(lumps.getByLabelText('Date')).toHaveValue('2027-03-15');
    expect(lumps.getByLabelText(/Note/)).toHaveValue('Bonus');
    await waitFor(() =>
      expect(lastSimulateBody(api)).toMatchObject({
        recurringExtras: [{ amount: 60, startDate: null, endDate: '2027-12-01' }],
        lumpSums: [{ amount: 1500, date: '2027-03-15', note: 'Bonus' }],
      }),
    );
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save changes/ })).toBeDisabled();

    // Edit → unsaved changes → PUT with the new plan and the stored name.
    const amount = recurring.getByLabelText('Amount per month');
    await user.clear(amount);
    await user.type(amount, '80');
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(api.callsTo('PUT /api/loans/1/scenarios/7')).toHaveLength(1));
    expect(api.callsTo('PUT /api/loans/1/scenarios/7')[0].body).toEqual({
      name: 'Bonus plan',
      description: 'Extra $60 plus the yearly bonus',
      budgetPayment: null,
      recurringExtras: [{ amount: 80, startDate: null, endDate: '2027-12-01' }],
      lumpSums: [{ amount: 1500, date: '2027-03-15', note: 'Bonus' }],
    });
  });

  it('loads a budget-only scenario into budget mode', async () => {
    const { api } = setup(
      {
        'GET /api/loans/:id/scenarios': json([makeScenario({ id: 9, name: 'Budget 650', budgetPayment: 650, recurringExtras: [], lumpSums: [] })]),
        'POST /api/loans/:id/budget': json({ budget: 650, extraAmount: 166.68, simulation: makeSimulation() }),
      },
      '/simulator?scenario=9',
    );
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('data-state', 'active'));
    expect(screen.getByLabelText('I can afford per month')).toHaveValue('650.00');
    await waitFor(() => expect(api.callsTo('POST /api/loans/1/budget').at(-1)?.body).toEqual({ budget: 650 }));
  });
});

describe('SimulatorPage — empty states', () => {
  it('asks for a loan when there are none', async () => {
    mockApi({ 'GET /api/loans': json([]) });
    renderWithProviders(<SimulatorPage />);
    expect(await screen.findByRole('heading', { name: 'Select a loan to simulate payoff strategies' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add a loan/ })).toHaveAttribute('href', '/loans/new');
  });

  it('explains that a paid-off loan has nothing to simulate', async () => {
    mockApi({
      'GET /api/loans': json([makeLoanListItem({ isPaidOff: true })]),
      'GET /api/loans/:id/dashboard': json(makeDashboard({ status: makeStatus({ isPaidOff: true, currentBalance: 0 }) })),
    });
    renderWithProviders(<SimulatorPage />);
    expect(await screen.findByRole('heading', { name: 'This loan is paid off' })).toBeInTheDocument();
  });
});
