/**
 * The Roth IRA page with the engine's pinned SYNTHETIC fixture rules (not real IRS values), to check
 * that verified figures are the engine's own: MFJ phase-out $200,000–$216,000, IRA limit $8,500.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtureRules, FIXTURE_YEAR } from '@rn/engine/testing';
import { renderWithProfile } from '@/test/renderWithProfile';
import { RothIraPage } from './RothIraPage';

vi.mock('@/hooks/useEngine', () => ({
  useEngineContext: () => ({ currentYear: FIXTURE_YEAR, rules: fixtureRules() }),
}));

function readout() {
  const el = screen.getByText(/^Roth IRA this year:/).closest('p');
  if (!el) throw new Error('readout missing');
  return el;
}

describe('RothIraPage with verified (synthetic fixture) rules', () => {
  it('shows the engine’s MAGI estimate and allowed contribution', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RothIraPage />);
    await user.click(screen.getByRole('tab', { name: 'Jordan' }));
    // 211,440 − deferrals (8% of 127,440 + 6% of 84,000 = 15,235.20) − HSA 5,000 = 191,204.80.
    expect(screen.getByText(/^Traditional workplace deferrals/).closest('div')).toHaveTextContent('$15,235');
    expect(screen.getByText(/^HSA contributions/).closest('div')).toHaveTextContent('$5,000');
    expect(screen.getByText('Estimated MAGI', { selector: 'dt' }).closest('div')).toHaveTextContent('$191,205');
    // Below the $200,000 start: the full $8,500; the $250 a month schedule is $3,000.
    expect(readout()).toHaveTextContent('Roth IRA this year: $3,000 of $8,500 allowed');
    expect(screen.getByText('Full contribution allowed')).toBeInTheDocument();
    expect(screen.queryByText(/Not available yet/)).not.toBeInTheDocument();
  });

  it('applies the phase-out to a MAGI override', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<RothIraPage />);
    await user.click(screen.getByRole('tab', { name: 'Jordan' }));
    await user.click(screen.getByRole('switch', { name: 'Enter MAGI yourself' }));
    const input = screen.getByLabelText('MAGI override');
    await user.clear(input);
    await user.type(input, '208000');
    // 8,500 × (216,000 − 208,000) / 16,000 = 4,250.
    expect(readout()).toHaveTextContent('Roth IRA this year: $3,000 of $4,250 allowed');
    expect(screen.getByText('Reduced by the income phase-out')).toBeInTheDocument();
    expect(screen.getByText('Based on your MAGI override.')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '215000');
    // 8,500 × 1,000 / 16,000 = 531.25 → rounded up to $540; the $3,000 schedule is capped by the engine.
    expect(readout()).toHaveTextContent('Roth IRA this year: $540 of $540 allowed');
    expect(screen.getByText(/contribution capped at the allowed \$540/)).toBeInTheDocument();
  });
});
