import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Insight } from '@/api/types';
import { insightsFixture, makeLoanListItem } from '@/test/fixtures';
import { json, mockApi } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { groupInsights, InsightsPage } from './InsightsPage';

const extraInsights: Insight[] = [
  {
    id: 'rate-sensitivity',
    category: 'refinance',
    tone: 'neutral',
    title: 'Rate sensitivity',
    message: 'A rate one percentage point lower would save about $120.',
    explanation: 'Same projection at 5% APR instead of 6%.',
    metric: { label: 'Savings per 1% APR', value: 120.5, format: 'currency' },
  },
  {
    id: 'warning:beyond-maturity',
    category: 'warning',
    tone: 'warning',
    title: 'Payoff later than scheduled',
    message: 'At $400.00 per payment the loan is not repaid by its scheduled final payment.',
    explanation: 'Raised by the payment engine while projecting your loan.',
    metric: null,
  },
  {
    id: 'best-scenario',
    category: 'scenario',
    tone: 'positive',
    title: 'Your best scenario',
    message: '"Extra $100" pays off 6 months sooner.',
    explanation: 'Compared with the baseline.',
    metric: { label: 'Months sooner', value: 6, format: 'months' },
  },
];

function setup(insights: Insight[] = [...insightsFixture, ...extraInsights]) {
  const api = mockApi({ 'GET /api/loans': json([makeLoanListItem()]), 'GET /api/loans/:id/insights': json(insights) });
  return { api, ...renderWithProviders(<InsightsPage />) };
}

describe('InsightsPage', () => {
  it('groups insights by category with warnings first', async () => {
    const { api } = setup();
    await screen.findByText('Repayment progress');
    expect(api.callsTo('GET /api/loans/1/insights')).toHaveLength(1);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.replace(/\d+$/, ''));
    expect(headings).toEqual([
      "Computed from your loan's own numbers",
      'Needs attention',
      'Your progress',
      'Where you are headed',
      'Ways to save',
      'Rate and refinancing',
      'Your scenarios',
    ]);
    const savings = within(screen.getByRole('region', { name: /Ways to save/ }));
    expect(savings.getByText('Pay a little extra')).toBeInTheDocument();
    expect(savings.getByText('Cut your remaining interest')).toBeInTheDocument();
    expect(savings.getByRole('link', { name: /Try it in the simulator/ })).toHaveAttribute('href', '/simulator');
    expect(screen.getByText(/no AI service involved/)).toBeInTheDocument();
    expect(screen.getByText(/LoanPilot figures are estimates/)).toBeInTheDocument();
  });

  it('formats each metric per its format and labels the tone in words', async () => {
    setup();
    const card = (id: string) => within(screen.getByTestId(`insight-${id}`));
    expect((await screen.findByTestId('insight-progress')).getAttribute('data-tone')).toBe('positive');
    expect(card('progress').getByTestId('insight-metric')).toHaveTextContent('51.3%');
    expect(card('progress').getByText('Good news')).toBeInTheDocument();
    expect(card('projection').getByTestId('insight-metric')).toHaveTextContent('27');
    expect(card('projection').getByText('For your information')).toBeInTheDocument();
    expect(card('extra-50').getByTestId('insight-metric')).toHaveTextContent('$85.17');
    expect(card('best-scenario').getByTestId('insight-metric')).toHaveTextContent('6 mo');
    expect(card('warning:beyond-maturity').getByText('Watch out')).toBeInTheDocument();
    expect(card('warning:beyond-maturity').queryByTestId('insight-metric')).not.toBeInTheDocument();
    expect(screen.getByText('1 watch out')).toBeInTheDocument();
  });

  it('expands "How this was calculated" per card and all at once', async () => {
    const { user } = setup();
    const card = within(await screen.findByTestId('insight-extra-50'));
    const explanation = /remaining interest falls from \$870.94 to \$785.77/;
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();

    const trigger = card.getByRole('button', { name: /How this was calculated/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(card.getByText(explanation)).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all calculations' }));
    expect(screen.getAllByRole('button', { name: /How this was calculated/ }).every((b) => b.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(screen.getByText('Same projection at 5% APR instead of 6%.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide all calculations' }));
    expect(screen.queryByText('Same projection at 5% APR instead of 6%.')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no insights', async () => {
    setup([]);
    expect(await screen.findByRole('heading', { name: 'No insights for this loan yet' })).toBeInTheDocument();
  });

  it('orders groups and drops empty categories', () => {
    expect(groupInsights([...insightsFixture, ...extraInsights]).map((g) => g.category)).toEqual([
      'warning',
      'progress',
      'projection',
      'savings',
      'refinance',
      'scenario',
    ]);
    expect(groupInsights(insightsFixture).map((g) => g.category)).toEqual(['progress', 'projection', 'savings']);
  });
});
