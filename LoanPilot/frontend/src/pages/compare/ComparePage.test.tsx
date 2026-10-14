import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeDashboard, makeLoanListItem, makePreferences } from '@/test/fixtures';
import { json, mockApi, type MockHandler } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { makeComparison } from '../simulator/testFixtures';
import { ComparePage } from './ComparePage';
import { sortRows } from './comparisonModel';

function setup(routes: Record<string, MockHandler> = {}) {
  const api = mockApi({
    'GET /api/loans': json([makeLoanListItem()]),
    'GET /api/loans/:id/dashboard': json(makeDashboard()),
    'GET /api/loans/:id/comparison': json(makeComparison()),
    ...routes,
  });
  return { api, ...renderWithProviders(<ComparePage />) };
}

const rowOf = (key: string) => document.querySelector(`tr[data-row-key="${key}"]`) as HTMLElement;

describe('ComparePage', () => {
  it('renders every strategy with the baseline highlighted, best badges, cards and notes', async () => {
    setup();
    const baseline = await waitFor(() => {
      const r = rowOf('baseline');
      expect(r).toBeTruthy();
      return r;
    });
    expect(baseline).toHaveAttribute('data-baseline', 'true');
    expect(within(baseline).getByText('Standard payments')).toBeInTheDocument();
    expect(within(baseline).getByText('Baseline')).toBeInTheDocument();
    expect(within(baseline).getByText('2 yr 3 mo')).toBeInTheDocument();

    const saved = within(rowOf('scenario:12'));
    expect(saved.getByText('Aggressive $300')).toBeInTheDocument();
    expect(saved.getByText('Fastest')).toBeInTheDocument();
    expect(saved.getByText('Lowest interest')).toBeInTheDocument();
    expect(saved.getByText('$310.74')).toBeInTheDocument();
    expect(saved.getByText('35.7%')).toBeInTheDocument();
    expect(saved.getByText('1 yr 5 mo')).toBeInTheDocument();
    expect(within(rowOf('preset:lump-2000')).getByText('Lowest payment')).toBeInTheDocument();
    expect(within(rowOf('preset:lump-2000')).getByText('$2,000.00')).toBeInTheDocument();

    const fastest = document.querySelector('[data-best-card="fastestPayoff"]') as HTMLElement;
    expect(within(fastest).getByText('Aggressive $300')).toBeInTheDocument();
    expect(within(fastest).getByText('March 2028')).toBeInTheDocument();
    const budgetCard = document.querySelector('[data-best-card="bestWithinBudget"]') as HTMLElement;
    expect(within(budgetCard).getByText(/Enter a monthly budget above/)).toBeInTheDocument();

    expect(screen.getByText(/"Lowest recurring payment" is the strategy/)).toBeInTheDocument();
    expect(screen.getByText('Balance over time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Standard payments/, pressed: true })).toBeInTheDocument();
  });

  it('refetches with the budget and shows the best-within-budget pick', async () => {
    const { api, user } = setup({
      'GET /api/loans/:id/comparison': (req) => {
        const budget = req.url.searchParams.get('budget');
        return json(
          budget
            ? makeComparison({ budget: Number(budget), best: { fastestPayoff: 'scenario:12', lowestInterest: 'scenario:12', lowestRecurringPayment: 'preset:lump-2000', bestWithinBudget: 'preset:lump-2000' } })
            : makeComparison(),
        );
      },
    });
    await waitFor(() => expect(rowOf('scenario:12')).toBeTruthy());
    await user.type(screen.getByLabelText(/Monthly budget/), '550');
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/loans/1/comparison' && c.url.searchParams.get('budget') === '550')).toBe(true));
    const card = document.querySelector('[data-best-card="bestWithinBudget"]') as HTMLElement;
    await waitFor(() => expect(within(card).getByText('$2,000 lump sum today')).toBeInTheDocument());
    expect(within(rowOf('preset:lump-2000')).getByText('Within budget')).toBeInTheDocument();

    // Save the budget as the default (PUT /preferences).
    await user.click(screen.getByRole('button', { name: /Save as default/ }));
    await waitFor(() => expect(api.callsTo('PUT /api/preferences').at(-1)?.body).toMatchObject({ comparisonBudget: 550 }));
  });

  it('starts from the saved default budget', async () => {
    const { api } = setup({ 'GET /api/preferences': json(makePreferences({ comparisonBudget: 700 })) });
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/loans/1/comparison' && c.url.searchParams.get('budget') === '700')).toBe(true));
    expect(screen.getByLabelText(/Monthly budget/)).toHaveValue('700.00');
  });

  it('links saved scenarios to the simulator and deletes them after confirmation', async () => {
    const { api, user } = setup({ 'DELETE /api/loans/:id/scenarios/:sid': { status: 204 } });
    await waitFor(() => expect(rowOf('scenario:12')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Open Aggressive $300 in simulator' })).toHaveAttribute('href', '/simulator?scenario=12');
    const comparisons = api.callsTo('GET /api/loans/1/comparison').length;

    await user.click(screen.getByRole('button', { name: 'Delete Aggressive $300' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /Delete scenario/ }));
    await waitFor(() => expect(api.callsTo('DELETE /api/loans/1/scenarios/12')).toHaveLength(1));
    await waitFor(() => expect(api.callsTo('GET /api/loans/1/comparison').length).toBeGreaterThan(comparisons));
  });

  it('shows an empty state with a call to action when nothing is saved, keeping baseline and presets', async () => {
    setup({ 'GET /api/loans/:id/comparison': json(makeComparison({ best: { fastestPayoff: 'preset:lump-2000', lowestInterest: 'preset:lump-2000', lowestRecurringPayment: 'preset:lump-2000', bestWithinBudget: null } }, [])) });
    expect(await screen.findByRole('heading', { name: 'No saved scenarios yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the simulator/ })).toHaveAttribute('href', '/simulator');
    expect(rowOf('baseline')).toBeTruthy();
    expect(rowOf('preset:extra-50')).toBeTruthy();
  });

  it('sorts by a column and keeps the baseline pinned first', async () => {
    const { user } = setup();
    await waitFor(() => expect(rowOf('scenario:12')).toBeTruthy());
    const keys = () => [...document.querySelectorAll('tbody tr[data-row-key]')].map((r) => r.getAttribute('data-row-key'));
    expect(keys()).toEqual(['baseline', 'preset:extra-50', 'preset:lump-2000', 'scenario:12']);
    await user.click(screen.getByRole('button', { name: /^Interest saved/ }));
    expect(keys()).toEqual(['baseline', 'scenario:12', 'preset:lump-2000', 'preset:extra-50']);
    expect(screen.getByRole('columnheader', { name: /Interest saved/ })).toHaveAttribute('aria-sort', 'descending');
    await user.click(screen.getByRole('button', { name: /^Interest saved/ }));
    expect(keys()).toEqual(['baseline', 'preset:extra-50', 'preset:lump-2000', 'scenario:12']);
  });
});

describe('sortRows', () => {
  it('puts strategies that never pay off last when sorting by date', () => {
    const data = makeComparison();
    const never = { ...data.rows[1], key: 'x', payoffDate: null, paysOff: false };
    const sorted = sortRows([...data.rows, never], { key: 'payoffDate', dir: 'asc' }).map((r) => r.key);
    expect(sorted[0]).toBe('baseline');
    expect(sorted.at(-1)).toBe('x');
  });
});
