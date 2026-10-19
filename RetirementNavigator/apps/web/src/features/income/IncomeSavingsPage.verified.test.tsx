/**
 * The match readout with the engine's pinned SYNTHETIC fixture rules (not real IRS values):
 * deferral limit $20,000 (+$10,000 at 60–63), compensation limit $300,000, additions $60,000.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { SAMPLE_PROFILES, type Household } from '@rn/engine';
import { FIXTURE_YEAR } from '@rn/engine/testing';
import { renderWithProfile } from '@/test/renderWithProfile';
import { IncomeSavingsPage } from './IncomeSavingsPage';

vi.mock('@/hooks/useEngine', async () => {
  const { fixtureRules, FIXTURE_YEAR: year } = await import('@rn/engine/testing');
  return { useEngineContext: () => ({ currentYear: year, rules: fixtureRules() }) };
});

function nearRetirement(baseSalary: number): Household {
  const h = SAMPLE_PROFILES.find((p) => p.id === 'nearRetirement')?.build(FIXTURE_YEAR);
  const pat = h?.people[0];
  if (!h || !pat?.employment) throw new Error('sample');
  return { ...h, people: [{ ...pat, employment: { ...pat.employment, baseSalary: baseSalary as never } }] };
}

describe('IncomeSavingsPage with verified (synthetic fixture) rules', () => {
  it('says when plan limits do not reduce the match', async () => {
    await renderWithProfile(<IncomeSavingsPage />, { household: nearRetirement(9_600_000) });
    expect(screen.getByText('Plan limits do not reduce this match.')).toBeInTheDocument();
    expect(screen.queryByText(/Before plan limits/)).not.toBeInTheDocument();
  });

  it('shows the after-limit match when the compensation limit reduces it', async () => {
    await renderWithProfile(<IncomeSavingsPage />, { household: nearRetirement(40_000_000) });
    // Before limits: 3% + 1% of $400,000 = $16,000. After: the match counts pay up to the
    // $300,000 compensation limit, 4% of $300,000 = $12,000.
    expect(screen.getByText(/capture \$16,000 of a possible \$16,000/)).toBeInTheDocument();
    expect(
      screen.getByText(/^After plan limits, the forecast counts \$12,000 of employer match this year: \$4,000 less/),
    ).toBeInTheDocument();
  });
});
