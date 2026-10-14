import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RefinanceInput } from '@/api/types';
import { makeLoanListItem } from '@/test/fixtures';
import { json, mockApi, problem, type MockRequest } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { breakEvenPoint } from './CostChart';
import { makeRefinanceResult } from './fixtures';
import { niceRangeTicks } from './niceRange';
import { RefinancePage } from './RefinancePage';

function setup(handler: (req: MockRequest) => ReturnType<typeof json> = () => json(makeRefinanceResult())) {
  const api = mockApi({ 'GET /api/loans': json([makeLoanListItem()]), 'POST /api/loans/:id/refinance': handler });
  const posts = () => api.callsTo('POST /api/loans/1/refinance').map((c) => c.body as RefinanceInput);
  return { api, posts, ...renderWithProviders(<RefinancePage />) };
}

describe('RefinancePage', () => {
  it('posts the default offer and renders the verdict, savings, break-even and both loans', async () => {
    const { posts } = setup();
    await waitFor(() => expect(posts()).toHaveLength(1));
    // Fixture loan is 6% APR: the starting offer is one point lower, 48 months, no fees.
    expect(posts()[0]).toEqual({ newAprPercent: 5, newTermMonths: 48, fees: 0, feesFinanced: false });

    expect(await screen.findByTestId('refinance-verdict')).toHaveTextContent('Refinancing would save about $221.40 overall');
    expect(screen.getByTestId('refinance-verdict')).toHaveTextContent('Refinancing saves money');
    expect(screen.getByTestId('lifetime-savings')).toHaveTextContent('Saves $221.40');
    expect(screen.getByTestId('break-even')).toHaveTextContent('30 months');
    expect(screen.getByText('From April 2029, refinancing is never more expensive.')).toBeInTheDocument();
    expect(screen.getByText('$43.09 lower')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is Refinance break-even?' })).toBeInTheDocument();

    const keep = within(screen.getByText('Keep current loan', { selector: '[data-slot=card-title]' }).closest('[data-slot=card]') as HTMLElement);
    expect(keep.getByText('$24,266.72')).toBeInTheDocument();
    expect(keep.getByText('Jul 10, 2030')).toBeInTheDocument();
    const refi = within(screen.getByText('Refinance', { selector: '[data-slot=card-title]' }).closest('[data-slot=card]') as HTMLElement);
    expect(refi.getByText('$24,045.32')).toBeInTheDocument();
    expect(refi.getByText('Lower cost')).toBeInTheDocument();
    expect(screen.getByText('Cost over time')).toBeInTheDocument();
  });

  it('highlights the chosen rate in the rate comparison and lets you try another', async () => {
    const { posts, user } = setup();
    const table = await screen.findByRole('table', { name: 'Interest rate comparison' });
    const chosen = within(table)
      .getAllByRole('row')
      .find((r) => r.getAttribute('aria-current') === 'true')!;
    expect(within(chosen).getByText('5.00%')).toBeInTheDocument();
    expect(within(chosen).getByText('Your rate')).toBeInTheDocument();
    expect(within(table).getByText('Costs $12.89 more')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Use 4.50% APR' }));
    await waitFor(() => expect(posts().at(-1)).toMatchObject({ newAprPercent: 4.5 }));
  });

  it('re-posts (debounced) when the term, fees or financing change', async () => {
    const { posts, user } = setup();
    await waitFor(() => expect(posts()).toHaveLength(1));
    await user.click(screen.getByRole('radio', { name: '60 months' }));
    const fees = screen.getByLabelText('Refinance fees');
    await user.clear(fees);
    await user.type(fees, '350');
    await user.click(screen.getByRole('switch', { name: 'Roll fees into the loan' }));
    await waitFor(() => expect(posts().at(-1)).toEqual({ newAprPercent: 5, newTermMonths: 60, fees: 350, feesFinanced: true }));
    // Typing was debounced: far fewer posts than keystrokes.
    expect(posts().length).toBeLessThan(5);
    expect(screen.getByText('Fees are added to the new principal and accrue interest.')).toBeInTheDocument();
  });

  it('shows 400 field errors next to the fields', async () => {
    const { posts, user } = setup((req) =>
      (req.body as RefinanceInput).newTermMonths > 240
        ? problem({ newTermMonths: ['The new term must be between 1 and 240 months.'] })
        : json(makeRefinanceResult()),
    );
    await screen.findByTestId('refinance-verdict');
    const term = screen.getByLabelText('New term');
    await user.clear(term);
    await user.type(term, '300');
    expect(await screen.findByText('The new term must be between 1 and 240 months.')).toBeInTheDocument();
    expect(term).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Check the highlighted fields')).toBeInTheDocument();
    expect(posts().at(-1)).toMatchObject({ newTermMonths: 300 });
  });

  it('does not post until the offer is complete', async () => {
    const { posts, user } = setup();
    await waitFor(() => expect(posts()).toHaveLength(1));
    await user.clear(screen.getByLabelText('New APR'));
    expect(await screen.findByText('Enter the APR the new lender offers.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 500));
    expect(posts()).toHaveLength(1);
  });

  it('says "Never" when refinancing never breaks even', async () => {
    setup(() =>
      json(
        makeRefinanceResult({
          breakEvenMonth: null,
          breakEvenDate: null,
          lifetimeSavings: -150,
          verdict: 'Refinancing would cost about $150.00 more overall.',
        }),
      ),
    );
    expect(await screen.findByTestId('break-even')).toHaveTextContent('Never');
    expect(screen.getByTestId('lifetime-savings')).toHaveTextContent('Costs $150.00 more');
    expect(screen.getByTestId('refinance-verdict')).toHaveTextContent('Refinancing costs more');
  });

  it('finds the break-even point and builds round axis ticks', () => {
    const series = makeRefinanceResult().costSeries;
    expect(breakEvenPoint(series, '2029-04-10')?.month).toBe(30);
    expect(breakEvenPoint(series, null)).toBeNull();
    expect(niceRangeTicks(21480.55, 24266.72)).toEqual([21000, 22000, 23000, 24000, 25000]);
  });
});
