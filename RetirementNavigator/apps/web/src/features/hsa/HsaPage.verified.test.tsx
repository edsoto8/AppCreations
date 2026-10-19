/**
 * The HSA page with the engine's pinned SYNTHETIC fixture rules (not real IRS values):
 * family limit $8,000. The allowed amount is the engine's, shared by the owner's HSAs.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { FIXTURE_YEAR } from '@rn/engine/testing';
import { SAMPLE_PROFILES, type Household } from '@rn/engine';
import { renderWithProfile } from '@/test/renderWithProfile';
import { HsaPage } from './HsaPage';

vi.mock('@/hooks/useEngine', async () => {
  const { resolveRules } = await import('@rn/engine');
  const { fixtureRules: rules, FIXTURE_YEAR: year } = await import('@rn/engine/testing');
  return {
    useEngineContext: () => ({ currentYear: year, rules: rules() }),
    useResolvedRules: () => resolveRules(rules(), { anchorYear: year, targetYear: year, indexRate: 0 as never }),
  };
});

describe('HsaPage with verified (synthetic fixture) rules', () => {
  it('shows the engine’s allowed amount against the limit', async () => {
    await renderWithProfile(<HsaPage />);
    expect(screen.getByText(/^HSA this year:/).closest('p')).toHaveTextContent(
      'HSA this year: $5,000 of $8,000 allowed',
    );
  });

  it('caps two HSAs of one owner at that person’s single limit', async () => {
    const base = SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')?.build(FIXTURE_YEAR);
    if (!base) throw new Error('sample');
    const first = base.accounts.find((a) => a.type === 'hsa');
    if (!first || first.type !== 'hsa') throw new Error('hsa');
    const household: Household = {
      ...base,
      accounts: [...base.accounts, { ...first, id: 'sam-hsa-2' as typeof first.id, name: 'Second HSA' }],
    };
    await renderWithProfile(<HsaPage />, { household });
    const readouts = screen.getAllByText(/^HSA this year:/).map((el) => el.closest('p')?.textContent);
    // $5,000 + $5,000 requested against one $8,000 limit: the second HSA gets the remaining $3,000.
    expect(readouts).toEqual(['HSA this year: $5,000 of $8,000 allowed', 'HSA this year: $3,000 of $8,000 allowed']);
    expect(screen.getByText(/The schedule asks for \$5,000; the forecast contributes \$3,000/)).toBeInTheDocument();
  });
});
