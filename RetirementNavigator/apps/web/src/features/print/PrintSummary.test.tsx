import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeDashboard, RULES, SAMPLE_PROFILES } from '@rn/engine';
import { renderWithProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { DISCLAIMER_TEXT } from '@/components/Disclaimer';
import { CURRENT_YEAR } from '@/app/env';
import { HEALTHCARE_NOTE } from '@/features/retirement-income/SpendingPlanSection';
import { excludedFeatureLabel } from '@/features/dashboard/viewModel';
import { PrintSummaryPage, SUMMARY_ROW_STEP } from './PrintSummary';

const CARD_TITLES = [
  'Current age',
  'Retirement age',
  'Years to retirement',
  'Current savings',
  'Projected savings at retirement',
  'Projected monthly retirement income',
  'Estimated monthly retirement spending',
  'Surplus / shortfall',
  'Portfolio longevity',
  'Readiness',
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrintSummaryPage', () => {
  it('renders the ten cards with their basis labels, the forecast table, assumptions and disclaimers', async () => {
    const household = SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(TEST_YEAR);
    await renderWithProfile(<PrintSummaryPage />, { path: '/print' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Retirement summary: Mid-career couple (sample)' }),
    ).toBeInTheDocument();

    const cards = screen.getByRole('region', { name: 'At a glance' });
    for (const title of CARD_TITLES) {
      const card = within(cards).getByRole('region', { name: title });
      // Every card states its dollar, tax and year basis.
      expect(within(card).getByText('Dollars')).toBeInTheDocument();
      expect(within(card).getByText('Taxes')).toBeInTheDocument();
      expect(within(card).getByText('Year')).toBeInTheDocument();
    }

    const dashboard = computeDashboard(household, { currentYear: CURRENT_YEAR, rules: RULES });
    if (dashboard.status !== 'ok') throw new Error('dashboard failed');
    const rows = dashboard.value.baseline.rows;
    const expectedYears = rows
      .filter((_, i) => i % SUMMARY_ROW_STEP === 0 || i === rows.length - 1)
      .map((r) => String(r.year));
    const table = screen.getByRole('table');
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual(expectedYears);

    const assumptions = screen.getByRole('region', { name: 'Key assumptions' });
    for (const term of ['Inflation', 'Return before retirement', 'Withdrawal timing', 'Withdrawal strategy'])
      expect(within(assumptions).getByText(term)).toBeInTheDocument();
    expect(within(assumptions).getByText('Retirement spending')).toBeInTheDocument();

    const leftOut = screen.getByRole('region', { name: 'What this forecast leaves out' });
    for (const f of dashboard.value.baseline.excludedFeatures)
      expect(within(leftOut).getByText(excludedFeatureLabel(f))).toBeInTheDocument();

    const disclaimers = screen.getByRole('region', { name: 'Disclaimers' });
    expect(within(disclaimers).getByText(DISCLAIMER_TEXT)).toBeInTheDocument();
    expect(within(disclaimers).getByText(HEALTHCARE_NOTE)).toBeInTheDocument();
    expect(within(disclaimers).getByText(/stored unencrypted/)).toBeInTheDocument();
    // Link-free text: the summary itself has no links.
    expect(within(screen.getByRole('article')).queryAllByRole('link')).toHaveLength(0);
  });

  it('opens the print dialog from the Print button', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await renderWithProfile(<PrintSummaryPage />, { path: '/print' });
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});
