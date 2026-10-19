import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import {
  SAMPLE_PROFILES,
  compoundInterest,
  matchOptimizer,
  projectHousehold,
  rothVsTraditional,
  spendingPlanner,
  ssClaimingComparison,
  withdrawal,
  type Household,
  type WithdrawalInput,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';
import { renderWithProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { figure, okValue as ok, uiCtx as ctx } from '@/test/calculatorHelpers';
import { formatCents, formatDollarsInput, formatPercent } from '@/lib/format';
import { useProfileStore } from '@/state/profileStore';
import { RothIraPage } from '@/features/roth-ira/RothIraPage';
import { CalculatorsPage } from './CalculatorsPage';
import { CALCULATOR_META } from './registry';
import {
  compoundInterestDefaults,
  matchOptimizerDefaults,
  spendingPlannerDefaults,
  ssClaimingDefaults,
  withdrawalDefaults,
} from './defaults';
import { prefillRothVsTraditional } from './prefill';

function activeHousehold(): Household {
  const s = useProfileStore.getState();
  const doc = s.activeId ? s.profiles[s.activeId] : undefined;
  if (!doc) throw new Error('no active profile');
  return doc.household;
}

function sample(id: string): Household {
  const s = SAMPLE_PROFILES.find((p) => p.id === id);
  if (!s) throw new Error(id);
  return s.build(TEST_YEAR);
}

describe('CalculatorsPage', () => {
  it('lists every calculator with a deep link', async () => {
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators' });
    expect(screen.getByRole('heading', { level: 1, name: 'Calculators' })).toBeInTheDocument();
    for (const m of CALCULATOR_META) {
      expect(screen.getByRole('link', { name: new RegExp(m.title.replace(/[()]/g, '\\$&')) })).toHaveAttribute(
        'href',
        `/calculators?c=${m.id}`,
      );
    }
  });

  it('opens a calculator from the link and switches with the selector', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators' });
    await user.click(screen.getByRole('link', { name: /Fee impact/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Fee impact' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Calculator'), 'compoundInterest');
    expect(screen.getByRole('heading', { level: 2, name: 'Compound interest' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'All calculators' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Workplace plans' })).toBeInTheDocument();
  });

  it('says so for an unknown calculator id', async () => {
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=nope' });
    expect(screen.getByRole('status')).toHaveTextContent('There is no calculator called “nope”');
  });

  it('shows the engine’s compound interest figures with labels and assumptions', async () => {
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=compoundInterest' });
    const r = ok(compoundInterest(compoundInterestDefaults(), ctx));
    expect(await figure('Ending balance')).toBe(formatCents(r.totals.endingBalance));
    expect(await figure('Ending balance in today’s dollars')).toBe(formatCents(r.totals.endingBalanceReal));
    expect(screen.getAllByText('Before taxes')).toHaveLength(2); // the basis line and the badge
    expect(screen.getByText('Assumptions')).toBeInTheDocument();
    for (const a of r.assumptions) expect(screen.getByText(a)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show compound interest data table/ })).toBeInTheDocument();
  });

  it('shows field errors and no figures for invalid input', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=compoundInterest' });
    await figure('Ending balance');
    const years = screen.getByLabelText('Years');
    await user.clear(years);
    await user.type(years, '0');
    expect(await screen.findByText('Years must be at least 1')).toBeInTheDocument();
    expect(years).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Ending balance', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.getByText(/Some inputs need attention/)).toBeInTheDocument();
    await user.clear(years);
    await user.type(years, '10');
    const r = ok(compoundInterest({ ...compoundInterestDefaults(), years: 10 }, ctx));
    expect(await figure('Ending balance')).toBe(formatCents(r.totals.endingBalance));
  });

  it('keeps the slider and its numeric input in sync', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=compoundInterest' });
    const slider = screen.getByRole('slider', { name: 'Annual return (slider)' });
    const input = screen.getByLabelText('Annual return');
    expect(slider).toHaveAttribute('aria-valuenow', '6');
    expect(input).toHaveValue('6');
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '6.1');
    expect(input).toHaveValue('6.1');
    await user.clear(input);
    await user.type(input, '8');
    expect(slider).toHaveAttribute('aria-valuenow', '8');
    const r = ok(compoundInterest({ ...compoundInterestDefaults(), annualReturn: 0.08 }, ctx));
    await user.tab();
    expect(await screen.findByText(formatCents(r.totals.endingBalance), { selector: 'dd' })).toBeInTheDocument();
  });

  it('fills in the plan’s values on request', async () => {
    const user = userEvent.setup();
    const household = sample('earlyCareer');
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=compoundInterest', household });
    await user.click(screen.getByRole('button', { name: 'Use my plan’s values' }));
    const person = household.people[0];
    if (!person) throw new Error('no person');
    const first = ok(projectHousehold(household, ctx)).rows[0];
    expect(screen.getByLabelText('Years')).toHaveValue(
      String(person.retirementAge - (CURRENT_YEAR - person.birthYear)),
    );
    expect(screen.getByLabelText('Starting balance')).toHaveValue(
      formatDollarsInput(first?.totals.portfolioStart ?? -1),
    );
    expect(screen.getByText(/Filled from the plan’s savings/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset Compound interest to example values' }));
    expect(screen.getByLabelText('Years')).toHaveValue('30');
  });

  it('shows "Not available yet" with the missing rules for Social Security in PIA mode (bundled rules)', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=ssClaimingComparison' });
    await figure('Its total');
    await user.selectOptions(screen.getByLabelText('Compare using'), 'pia');
    const engine = ssClaimingComparison({ ...ssClaimingDefaults(), mode: 'pia' }, ctx);
    expect(engine.status).toBe('unverified');
    expect(await screen.findByText('Not available yet: needs verified rules')).toBeInTheDocument();
    expect(screen.getByText('Full retirement age by birth year')).toBeInTheDocument();
    expect(screen.queryByText('Its total', { selector: 'dt' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('note')).queryByText(/\$\d/)).not.toBeInTheDocument();
  });
});

describe('Roth vs traditional link (M7a)', () => {
  it('opens the calculator from the Roth IRA page, filled from that person’s plan', async () => {
    const user = userEvent.setup();
    await renderWithProfile(
      <Routes>
        <Route path="/roth-ira" element={<RothIraPage />} />
        <Route path="/calculators" element={<CalculatorsPage />} />
      </Routes>,
      { path: '/roth-ira' },
    );
    const household = activeHousehold();
    const person = household.people[1];
    if (!person?.employment) throw new Error('expected an employed second person');
    await user.click(screen.getByRole('link', { name: `Compare Roth vs traditional for ${person.name}` }));
    expect(screen.getByRole('heading', { level: 2, name: 'Roth vs traditional' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Filled from ${person.name}’s ages, salary and deferral`))).toBeInTheDocument();
    expect(screen.getByLabelText('Base salary')).toHaveValue(formatDollarsInput(person.employment.baseSalary));
    expect(screen.getByLabelText('Current age')).toHaveValue(String(CURRENT_YEAR - person.birthYear));
    expect(screen.getByLabelText('Retirement age')).toHaveValue(String(person.retirementAge));
    const values = prefillRothVsTraditional(household, ctx, person.id)?.values;
    if (!values) throw new Error('no prefill');
    const r = ok(rothVsTraditional(values, ctx));
    expect(await figure('Roth minus traditional, before tax')).toBe(formatCents(r.beforeTaxDifferenceReal));
  });
});

describe('validation and engine checks', () => {
  it('shows a cross-field error from the engine schema on the right field', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=savingsGap' });
    await figure('Extra yearly contribution');
    const planning = screen.getByLabelText('Planning age');
    await user.clear(planning);
    await user.type(planning, '60');
    expect(await screen.findByText('Retirement age is after planning age')).toBeInTheDocument();
    expect(screen.getByLabelText('Retirement age')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Extra yearly contribution', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('shows checks the engine makes after its schema on the field', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=ssClaimingComparison' });
    await figure('Its total');
    const through = screen.getByLabelText('Add up benefits through age');
    await user.clear(through);
    await user.type(through, '62');
    // Born 60 years ago: age 62 is not yet passed, so this is valid.
    await figure('Its total');
    const birth = screen.getByLabelText('Birth year');
    await user.clear(birth);
    await user.type(birth, String(CURRENT_YEAR - 70));
    expect(
      await screen.findAllByText('Totals must run from this year to an age not yet passed', {}, { timeout: 3000 }),
    ).not.toHaveLength(0);
    expect(screen.getByText('These inputs cannot be calculated')).toBeInTheDocument();
    expect(screen.queryByText('Its total', { selector: 'dt' })).not.toBeInTheDocument();
  });
});

describe('calculator modes and lists', () => {
  it('finds the sustainable withdrawal rate', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=withdrawal' });
    await figure('First-year spending');
    await user.selectOptions(screen.getByLabelText('Calculate'), 'sustainableRate');
    const r = ok(withdrawal({ ...withdrawalDefaults(), mode: 'sustainableRate' } as WithdrawalInput, ctx));
    if (r.mode !== 'sustainableRate') throw new Error('mode');
    expect(await figure('Sustainable starting rate')).toBe(formatPercent(r.sustainableRate ?? -1, 2));
    expect(await figure('First-year spending at that rate')).toBe(formatCents(r.plan?.annualSpending ?? -1));
  });

  it('adds a partner to the spending plan', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=spendingPlanner' });
    await figure('Total spending need');
    await user.click(screen.getByRole('switch', { name: 'Include a partner' }));
    expect(screen.getByRole('group', { name: 'Partner' })).toBeInTheDocument();
    const input = { ...spendingPlannerDefaults() };
    const r = ok(
      spendingPlanner(
        { ...input, people: [...input.people, { name: 'Partner', age: 63, planningAge: 95, socialSecurity: null }] },
        ctx,
      ),
    );
    await waitFor(async () => expect(await figure('Total spending need')).toBe(formatCents(r.totalSpendingNeed)));
    expect(await figure('First death year (planning age)')).toBe(String(r.firstDeathYear));
  });

  it('edits the employer match tiers', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<CalculatorsPage />, { path: '/calculators?c=matchOptimizer' });
    await figure('Full match per year');
    await user.click(screen.getByRole('button', { name: 'Remove match tier 2' }));
    const input = matchOptimizerDefaults();
    const r = ok(matchOptimizer({ ...input, match: { ...input.match, tiers: input.match.tiers.slice(0, 1) } }, ctx));
    await waitFor(async () => expect(await figure('Full match per year')).toBe(formatCents(r.maxPossibleMatch)));
    await user.click(screen.getByRole('button', { name: 'Add a match tier' }));
    expect(screen.getByLabelText('Tier 2 match rate')).toHaveValue('50');
  });
});
