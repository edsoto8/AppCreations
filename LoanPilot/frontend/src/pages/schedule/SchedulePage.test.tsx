import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDashboard, makeLoanListItem } from '@/test/fixtures';
import { json, mockApi, type MockHandler, type MockRequest } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { makeScenario, makeScenarioSchedule, makeSchedule } from './fixtures';
import { SchedulePage } from './SchedulePage';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

function scheduleApi(extra: Record<string, MockHandler> = {}) {
  return mockApi({
    'GET /api/loans': json([makeLoanListItem()]),
    'GET /api/loans/:id/dashboard': json(makeDashboard()),
    'GET /api/loans/:id/scenarios': json([makeScenario()]),
    'GET /api/loans/:id/schedule': (req: MockRequest) => json(req.url.searchParams.get('scenarioId') ? makeScenarioSchedule() : makeSchedule()),
    ...extra,
  });
}

const table = () => screen.getByRole('region', { name: 'Amortization schedule' });
const bodyRows = () =>
  within(table())
    .getAllByRole('row')
    .filter((r) => r.closest('tbody'));

async function renderSchedule(route = '/schedule', api: ReturnType<typeof mockApi> = scheduleApi()) {
  const result = { ...renderWithProviders(<SchedulePage />, { route }), api };
  await screen.findByRole('region', { name: 'Amortization schedule' });
  return result;
}

describe('SchedulePage', () => {
  it('lists estimated history rows first, marked Estimated, with an explanation and a projection divider', async () => {
    await renderSchedule();

    expect(screen.getByTestId('history-banner')).toHaveTextContent('first 3 payments (through Oct 1, 2026) are reconstructed');
    const estimated = within(table())
      .getAllByRole('row')
      .filter((r) => r.getAttribute('data-row-kind') === 'estimated');
    expect(estimated).toHaveLength(3);
    expect(within(estimated[0]).getByText('Estimated')).toBeInTheDocument();
    expect(within(estimated[0]).getByText('Aug 1, 2026')).toBeInTheDocument();
    expect(screen.getByTestId('projection-divider')).toHaveTextContent('Projection from Oct 1, 2026');
    // Payment #34 (Nov 1, 2026) is the next one due after Oct 14, 2026.
    const next = within(table())
      .getAllByRole('row')
      .find((r) => r.getAttribute('aria-current') === 'date')!;
    expect(within(next).getByText('34')).toBeInTheDocument();
    expect(within(next).getByText('Next')).toBeInTheDocument();
    // All 30 rows fit on the first page; the footer totals them.
    expect(bodyRows()).toHaveLength(30 + 1);
    expect(screen.getByText(/Cumulative interest counts from the first payment of the loan/)).toBeInTheDocument();
    // No row has unpaid interest, so that column is hidden.
    expect(within(table()).queryByRole('columnheader', { name: 'Unpaid interest' })).not.toBeInTheDocument();
  });

  it('narrows rows with text search, the extra-payments switch and the date range', async () => {
    const { user } = await renderSchedule();

    await user.type(screen.getByLabelText('Search'), 'Jan 1, 2028');
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]).getByText('48')).toBeInTheDocument();
    expect(screen.getByText(/1 row of 30 match/)).toBeInTheDocument();

    // Amounts match with or without the currency symbol and grouping.
    await user.clear(screen.getByLabelText('Search'));
    await user.type(screen.getByLabelText('Search'), '$11,756.30');
    await waitFor(() => expect(bodyRows()).toHaveLength(2)); // ending balance of #34, starting balance of #35

    await user.click(screen.getByRole('button', { name: /Clear filters/ }));
    await waitFor(() => expect(bodyRows()).toHaveLength(31));

    // Baseline has no extra payments at all.
    await user.click(screen.getByRole('switch', { name: 'Only extra payments' }));
    await waitFor(() => expect(within(table()).getByText('No payments match these filters.')).toBeInTheDocument());
    await user.click(screen.getByRole('switch', { name: 'Only extra payments' }));

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    await user.type(from, '2027-03-01');
    await user.type(to, '2027-05-31');
    await waitFor(() => expect(bodyRows()).toHaveLength(3)); // #38–#40
    expect(screen.getByText(/Total of 3 shown rows/)).toBeInTheDocument();
  });

  it('filters by year', async () => {
    const { user } = await renderSchedule();
    await user.click(screen.getByRole('combobox', { name: 'Year' }));
    await user.click(await screen.findByRole('option', { name: '2029' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]).getByText('60')).toBeInTheDocument();
  });

  it('shows the annual summary with totals', async () => {
    const { user } = await renderSchedule();
    await user.click(screen.getByRole('tab', { name: /Annual/ }));
    const annual = await screen.findByRole('region', { name: 'Annual summary' });
    const rows = within(annual).getAllByRole('row');
    expect(within(annual).getByText('2027')).toBeInTheDocument();
    expect(within(annual).getByText('$536.75')).toBeInTheDocument();
    // 2026 contains estimated history.
    expect(within(rows.find((r) => r.textContent?.includes('2026'))!).getByText('Includes estimated')).toBeInTheDocument();
    expect(within(annual).getByText('Total')).toBeInTheDocument();
    expect(within(annual).getByText('$1,076.80')).toBeInTheDocument(); // interest total
  });

  it('refetches with the scenario id when a saved scenario is selected and compares it with the baseline', async () => {
    const api = scheduleApi();
    const { user } = renderWithProviders(<SchedulePage />, { route: '/schedule' });
    await screen.findByRole('region', { name: 'Amortization schedule' });
    expect(api.callsTo('GET /api/loans/1/schedule')[0].url.searchParams.has('scenarioId')).toBe(false);

    await user.click(screen.getByRole('combobox', { name: 'Plan' }));
    await user.click(await screen.findByRole('option', { name: 'Extra $100 + bonus' }));

    await waitFor(() => expect(api.callsTo('GET /api/loans/1/schedule').some((c) => c.url.searchParams.get('scenarioId') === '5')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Payment schedule: Extra $100 + bonus' })).toBeInTheDocument();
    // The lump-sum row is styled as its own kind.
    await waitFor(() =>
      expect(
        within(table())
          .getAllByRole('row')
          .filter((r) => r.getAttribute('data-row-kind') === 'lumpSum'),
      ).toHaveLength(1),
    );
    expect(screen.getByText('$110.82 less than baseline')).toBeInTheDocument();

    // Only extra payments: #34–#36 (recurring extra) and the lump sum.
    await user.click(screen.getByRole('switch', { name: 'Only extra payments' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(4));

    await user.click(screen.getByRole('switch', { name: 'Compare with baseline' }));
    const compare = await screen.findByRole('region', { name: 'Baseline compared with Extra $100 + bonus' });
    expect(within(compare).getAllByRole('columnheader', { name: 'Difference' })).toHaveLength(2);
    const row34 = within(compare)
      .getAllByRole('row')
      .find((r) => within(r).queryByText('34'))!;
    expect(within(row34).getByText('$11,756.30')).toBeInTheDocument(); // baseline ending balance
    expect(within(row34).getByText('$11,656.30')).toBeInTheDocument(); // scenario ending balance
    expect(within(row34).getByText('-$100.00')).toBeInTheDocument(); // difference
  });

  it('exports the current view as CSV or Excel with the selected scenario', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = scheduleApi({
      'POST /api/loans/:id/export': (req: MockRequest) => ({
        blob: new Blob(['a,b'], { type: 'text/csv' }),
        headers: { 'Content-Disposition': `attachment; filename=schedule-${req.url.searchParams.get('view')}.${req.url.searchParams.get('format')}` },
      }),
    });
    const { user } = renderWithProviders(<SchedulePage />, { route: '/schedule?scenario=5' });
    await screen.findByRole('heading', { name: 'Payment schedule: Extra $100 + bonus' });

    await user.click(screen.getByRole('button', { name: 'Export monthly schedule as CSV' }));
    await waitFor(() => expect(api.callsTo('POST /api/loans/1/export')).toHaveLength(1));
    const first = api.callsTo('POST /api/loans/1/export')[0];
    expect(first.url.searchParams.get('format')).toBe('csv');
    expect(first.url.searchParams.get('view')).toBe('monthly');
    expect(first.body).toEqual({ scenarioId: 5 });
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Downloaded schedule-monthly.csv')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Annual/ }));
    await user.click(screen.getByRole('button', { name: 'Export annual schedule as Excel' }));
    await waitFor(() => expect(api.callsTo('POST /api/loans/1/export')).toHaveLength(2));
    const second = api.callsTo('POST /api/loans/1/export')[1];
    expect(second.url.searchParams.get('format')).toBe('xlsx');
    expect(second.url.searchParams.get('view')).toBe('annual');
  });

  it('shows a toast when an export fails', async () => {
    const { user } = await renderSchedule(
      '/schedule',
      scheduleApi({ 'POST /api/loans/:id/export': { status: 500, json: { title: 'Export broke' } } }),
    );
    await user.click(screen.getByRole('button', { name: 'Export monthly schedule as CSV' }));
    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export monthly schedule as CSV' })).toBeEnabled();
  });

  it('prints a summary with the key figures and the annual table', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { user } = await renderSchedule();
    expect(screen.queryByTestId('print-summary')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Print summary' }));
    expect(print).toHaveBeenCalledTimes(1);
    const summary = screen.getByTestId('print-summary');
    expect(within(summary).getByRole('heading', { name: '2024 Toyota RAV4' })).toBeInTheDocument();
    expect(within(summary).getByText('$12,178.73')).toBeInTheDocument();
    expect(within(summary).getByText('6.00%')).toBeInTheDocument();
    expect(within(summary).getByText('January 2029')).toBeInTheDocument();
    expect(within(summary).getByText('$870.94')).toBeInTheDocument();
    expect(within(summary).getByText(/not a lender payoff quote/)).toBeInTheDocument();
    expect(within(summary).getByText('2028')).toBeInTheDocument();
  });

  it('lists the next 12 payments in the calendar view', async () => {
    const { user } = await renderSchedule();
    await user.click(screen.getByRole('tab', { name: /Calendar/ }));
    const list = await screen.findByRole('list', { name: 'Upcoming payment dates' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    expect(items[0]).toHaveTextContent('Nov 2026');
    expect(items[0]).toHaveTextContent('#34');
    expect(items[0]).toHaveTextContent('Next');
    expect(items[11]).toHaveTextContent('#45');
    expect(screen.getByText(/12 payments from Nov 1, 2026 · \$5,799.84 in total/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no loans', async () => {
    mockApi({ 'GET /api/loans': json([]) });
    renderWithProviders(<SchedulePage />);
    expect(await screen.findByRole('heading', { name: 'Add a loan to see its schedule' })).toBeInTheDocument();
  });
});
