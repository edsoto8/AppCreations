/**
 * The dashboard with the engine's pinned SYNTHETIC fixture rules (not real IRS values), where every
 * limit and tax value is verified: no step is excluded, so the before-limits labels disappear.
 * Retirement-phase taxes are still modeled later (M4), so "Before taxes" stays.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_PROFILES, computeDashboard } from '@rn/engine';
import { FIXTURE_YEAR, fixtureRules } from '@rn/engine/testing';
import { formatCents } from '@/lib/format';
import { renderWithProfile } from '@/test/renderWithProfile';
import { DashboardPage } from './DashboardPage';

vi.mock('@/hooks/useEngine', async () => {
  const { fixtureRules, FIXTURE_YEAR: year } = await import('@rn/engine/testing');
  return { useEngineContext: () => ({ currentYear: year, rules: fixtureRules() }) };
});

const couple = () => SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(FIXTURE_YEAR);

describe('DashboardPage with verified (synthetic fixture) rules', () => {
  it('drops the before-limits badges and banner items when limits are verified', async () => {
    const user = userEvent.setup();
    const household = couple();
    const result = computeDashboard(household, { currentYear: FIXTURE_YEAR, rules: fixtureRules() });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.value.baseline.excludedFeatures).toEqual([]);

    await renderWithProfile(<DashboardPage />, { household });
    expect(screen.queryByText('Before plan limits (unverified)')).not.toBeInTheDocument();
    expect(screen.queryByText(/leaves out steps whose rule values are not verified/)).not.toBeInTheDocument();
    // Not-yet-modeled items remain listed, and retirement income is still before taxes.
    expect(screen.getByRole('note', { name: 'What this forecast does not include yet' })).toBeInTheDocument();
    const income = screen.getByRole('region', { name: 'Projected monthly retirement income' });
    expect(within(income).getAllByText('Before taxes').length).toBeGreaterThan(0);

    const savings = screen.getByRole('region', { name: 'Projected savings at retirement' });
    expect(within(savings).getByText(formatCents(result.value.cards.savingsAtRetirement.real))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show year-by-year table/ }));
    const table = screen.getByRole('region', { name: /Forecast details by year/ });
    expect(within(table).queryByText('(as elected, before plan limits, unverified)')).not.toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Contributions' })).toBeInTheDocument();
  });
});
