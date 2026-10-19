/**
 * Retirement Income with the engine's pinned SYNTHETIC fixture rules (not real IRS/SSA values),
 * including its synthetic SSA claiming values.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import {
  NotImplementedError,
  SAMPLE_PROFILES,
  fullRetirementAge,
  projectHousehold,
  ssBenefitAtClaim,
  type AgeYearsMonths,
} from '@rn/engine';
import { FIXTURE_YEAR, fixtureRules } from '@rn/engine/testing';
import { formatCents } from '@/lib/format';
import { renderWithProfile } from '@/test/renderWithProfile';
import { RetirementIncomePage } from './RetirementIncomePage';

vi.mock('@/hooks/useEngine', async () => {
  const { FIXTURE_YEAR: year } = await import('@rn/engine/testing');
  const { fixtureRules: rules } = await import('@rn/engine/testing');
  const ctx = { currentYear: year, rules: rules() };
  return { useEngineContext: () => ctx };
});

const rules = fixtureRules();
const nearRetirement = () => SAMPLE_PROFILES.find((p) => p.id === 'nearRetirement')!.build(FIXTURE_YEAR);

/** False until the engine's Social Security functions land (they throw NotImplementedError before). */
const ssImplemented = (() => {
  try {
    fullRetirementAge(1965, 1, rules.standing);
    ssBenefitAtClaim(
      { piaMonthly: 0 as never, birthYear: 1965, birthMonth: 1, claimAge: { years: 67, months: 0 } },
      rules.standing,
    );
    return true;
  } catch (error) {
    if (error instanceof NotImplementedError) return false;
    throw error;
  }
})();

describe('RetirementIncomePage with verified (synthetic fixture) rules', () => {
  it.skipIf(!ssImplemented)('shows the claiming-age comparison as numbers from the engine', async () => {
    const household = nearRetirement();
    const pat = household.people[0]!;
    const source = pat.socialSecurity.source;
    if (source.kind !== 'statement') throw new Error('sample changed');
    const fra = fullRetirementAge(pat.birthYear, pat.birthMonth, rules.standing);
    if (fra.status !== 'ok') throw new Error(fra.status);
    const at = (claimAge: AgeYearsMonths) => {
      const r = ssBenefitAtClaim(
        { piaMonthly: source.piaMonthly, birthYear: pat.birthYear, birthMonth: pat.birthMonth, claimAge },
        rules.standing,
      );
      if (r.status !== 'ok') throw new Error(r.status);
      return r.value.monthly;
    };

    await renderWithProfile(<RetirementIncomePage />, { household });
    expect(screen.queryByText('Recommended while rules are unverified')).not.toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Claiming-age comparison for Pat, monthly, today’s dollars' });
    const rows = within(table).getAllByRole('row').slice(1);
    const early = rows.find((r) => within(r).queryByText('Earliest (62)'))!;
    const full = rows.find((r) => within(r).queryByText(/^Full retirement age/))!;
    const late = rows.find((r) => within(r).queryByText('Latest with credits (70)'))!;
    expect(within(early).getByText(formatCents(at({ years: 62, months: 0 })))).toBeInTheDocument();
    expect(within(full).getByText(formatCents(at(fra.value)))).toBeInTheDocument();
    expect(within(full).getByText('Full amount')).toBeInTheDocument();
    expect(within(late).getByText(formatCents(at({ years: 70, months: 0 })))).toBeInTheDocument();
    expect(screen.queryByText(/Not available yet: the claiming-age comparison/)).not.toBeInTheDocument();
  });

  it('shows engine taxes, or "Before taxes" (never "Unverified rule"), when tax rules are verified', async () => {
    const household = nearRetirement();
    await renderWithProfile(<RetirementIncomePage />, { household });
    const result = projectHousehold(household, { currentYear: FIXTURE_YEAR, rules });
    if (result.status !== 'ok') throw new Error(result.status);
    const first = result.value.rows.find((r) => r.phase === 'retirement')!;
    const table = screen.getByRole('region', { name: 'Gross to net by year, today’s dollars' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).queryByText('Unverified rule')).not.toBeInTheDocument();
    if (first.tax) {
      expect(within(row).getAllByText(formatCents(first.tax.totalTax / first.deflator)).length).toBeGreaterThan(0);
      expect(within(row).getAllByText(formatCents(first.netIncome! / first.deflator)).length).toBeGreaterThan(0);
    } else {
      expect(within(row).getAllByText('Before taxes').length).toBeGreaterThan(0);
    }
  });
});
