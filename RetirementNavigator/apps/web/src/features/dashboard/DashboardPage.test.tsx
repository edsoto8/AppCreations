import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  HouseholdSchema,
  RULES,
  allocationByAssetClass,
  SAMPLE_PROFILES,
  computeDashboard,
  minimalHouseholdInput,
  type DashboardResult,
  type Household,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';
import { formatCents } from '@/lib/format';
import { renderWithProfile } from '@/test/renderWithProfile';
import { shortHousehold } from '@/test/monteCarloFixtures';
import { useProfileStore } from '@/state/profileStore';
import { DashboardPage } from './DashboardPage';
import { excludedFeatureLabel, notModeledMessages } from './viewModel';

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

const sample = (id: string) => SAMPLE_PROFILES.find((p) => p.id === id)!.build(CURRENT_YEAR);

function dashboardOf(household: Household): DashboardResult {
  const result = computeDashboard(household, { currentYear: CURRENT_YEAR, rules: RULES });
  if (result.status !== 'ok') throw new Error(`dashboard ${result.status}`);
  return result.value;
}

/** Hand-checkable retiree: cash only, 0% return and inflation, already retired. */
function retiree(annualSpendingCents: number, opts: { age?: number } = {}): Household {
  const input = minimalHouseholdInput(CURRENT_YEAR);
  const person = input.people[0]!;
  input.people = [{ ...person, birthYear: CURRENT_YEAR - (opts.age ?? 70), retirementAge: 65, planningAge: 95 }];
  input.accounts = [
    { type: 'cash', id: 'cash-1', name: 'Savings', ownerId: person.id, balance: 10_000_000, expectedReturn: 0 },
  ];
  input.spending = { currentAnnualSpending: annualSpendingCents, retirementAnnualSpending: annualSpendingCents };
  input.assumptions = { ...input.assumptions, inflation: 0, returnPreRetirement: 0, returnPostRetirement: 0 };
  return HouseholdSchema.parse(input);
}

const card = (name: string) => screen.getByRole('region', { name });
const dataRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('DashboardPage', () => {
  it('renders all ten cards with their basis, the scope banner and the before-limits / before-taxes badges', async () => {
    const household = sample('midCareerCouple');
    const d = dashboardOf(household);
    await renderWithProfile(<DashboardPage />, { household });

    for (const title of CARD_TITLES) expect(card(title)).toBeInTheDocument();
    // Each card states its dollar basis, tax basis and year.
    for (const title of CARD_TITLES) {
      const terms = within(card(title))
        .getAllByRole('term')
        .map((t) => t.textContent);
      expect(terms).toEqual(['Dollars', 'Taxes', 'Year']);
      expect(within(card(title)).getByRole('button', { name: `About ${title}` })).toBeInTheDocument();
    }
    const income = card('Projected monthly retirement income');
    expect(within(income).getByText(`First retirement year (${d.cards.firstRetirementYear})`)).toBeInTheDocument();
    expect(within(income).getAllByText('Before taxes').length).toBeGreaterThanOrEqual(2); // badge + tax basis

    // Ages and the current savings come straight from the engine cards.
    const ages = card('Current age');
    for (const p of d.cards.people) expect(within(ages).getByText(String(p.currentAge))).toBeInTheDocument();
    expect(within(card('Current savings')).getByText(formatCents(d.cards.currentSavings))).toBeInTheDocument();

    // Banner: excluded steps and not-yet-modeled items, with a link to the sources.
    const banner = screen.getByRole('note', { name: /leaves out steps whose rule values are not verified yet/ });
    expect(within(banner).getByText(/before plan limits\.$/)).toBeInTheDocument();
    // Every item comes from the engine result: excluded (unverified) steps and anything not modeled yet.
    for (const f of d.baseline.excludedFeatures) {
      expect(within(banner).getByText(excludedFeatureLabel(f))).toBeInTheDocument();
    }
    for (const m of notModeledMessages(d.baseline)) expect(within(banner).getByText(m)).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'See Rules & Sources' })).toHaveAttribute('href', '/rules');
    expect(d.baseline.excludedFeatures).toContain('workplaceLimits');
    expect(within(card('Projected savings at retirement')).getByText('Before plan limits (unverified)')).toBeVisible();
    expect(within(card('Readiness')).getByText('Heuristic')).toBeInTheDocument();
  });

  it('shows readiness and longevity from the engine for the sample couple', async () => {
    const household = sample('midCareerCouple');
    const d = dashboardOf(household);
    await renderWithProfile(<DashboardPage />, { household });
    const label = { onTrack: 'On track', borderline: 'Borderline', atRisk: 'At risk' }[d.cards.readiness.status];
    const readiness = card('Readiness');
    expect(within(readiness).getByText(label)).toBeInTheDocument();
    // No Monte Carlo run yet: a link to run it instead of a rate.
    expect(within(readiness).getByText(/No Monte Carlo result for this plan yet/)).toBeInTheDocument();
    expect(within(readiness).getByRole('link', { name: 'Run Monte Carlo' })).toHaveAttribute('href', '/monte-carlo');
    expect(
      within(readiness).getByText(
        /On track: baseline and pessimistic runs both last; Borderline: only the baseline lasts; At risk: the baseline runs out/,
      ),
    ).toBeInTheDocument();
    const longevity = card('Portfolio longevity');
    if (d.cards.longevity.kind === 'depletes') {
      expect(within(longevity).getByText(`Runs out at age ${d.cards.longevity.age}`)).toBeInTheDocument();
    } else {
      expect(within(longevity).getByText(/^Lasts through planning age/)).toBeInTheDocument();
    }
  });

  it('switches cards and tables between today’s and future dollars', async () => {
    const user = userEvent.setup();
    const household = sample('midCareerCouple');
    const d = dashboardOf(household);
    await renderWithProfile(<DashboardPage />, { household });
    const savings = card('Projected savings at retirement');
    expect(within(savings).getByText(formatCents(d.cards.savingsAtRetirement.real))).toBeInTheDocument();
    expect(within(savings).getByText('Today’s dollars')).toBeInTheDocument();
    const spending = card('Estimated monthly retirement spending');
    expect(within(spending).getByText(formatCents(d.cards.monthlyRetirementSpending.real))).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Future dollars' }));
    expect(useProfileStore.getState().dollarBasis).toBe('nominal');
    expect(within(savings).getByText(formatCents(d.cards.savingsAtRetirement.nominal))).toBeInTheDocument();
    expect(within(savings).getByText(`Future dollars (${d.cards.firstRetirementYear})`)).toBeInTheDocument();
    expect(within(spending).getByText(formatCents(d.cards.monthlyRetirementSpending.nominal))).toBeInTheDocument();
    expect(d.cards.savingsAtRetirement.nominal).not.toBe(d.cards.savingsAtRetirement.real);

    // The forecast details table follows the toggle too (last row, nominal end balance).
    await user.click(screen.getByRole('button', { name: /Show year-by-year table/ }));
    const table = screen.getByRole('region', { name: 'Forecast details by year, future dollars' });
    expect(within(table).getAllByText('(as elected, before plan limits, unverified)').length).toBeGreaterThan(0);
    const retireRow = d.baseline.rows.find((r) => r.year === d.cards.firstRetirementYear)!;
    const row = dataRows(table).find((r) => cells(r)[0] === String(retireRow.year))!;
    expect(cells(row)[3]).toBe(formatCents(retireRow.totals.portfolioStart));
  });

  it('reveals the chart data tables with the engine rows', async () => {
    const user = userEvent.setup();
    const household = sample('midCareerCouple');
    const d = dashboardOf(household);
    await renderWithProfile(<DashboardPage />, { household });

    const show = screen.getByRole('button', { name: /Show portfolio value data table/ });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    show.focus();
    await user.keyboard('{Enter}');
    expect(show).toHaveAttribute('aria-expanded', 'true');
    const table = screen.getByRole('region', { name: 'Portfolio value by year, today’s dollars' });
    const rows = dataRows(table);
    expect(rows).toHaveLength(d.baseline.rows.length);
    const first = d.baseline.rows[0]!;
    const c0 = cells(rows[0]!);
    expect(c0[0]).toBe(String(first.year));
    expect(c0[1]).toBe(first.people.map((p, i) => `${household.people[i]!.name} ${p.age}`).join(', '));
    expect(c0[2]).toBe(formatCents(first.totals.portfolioStart));
    expect(c0[3]).toBe(formatCents(first.flows.contributions));
    expect(c0[6]).toBe(formatCents(first.totals.portfolioEnd));
    expect(c0[7]).toBe(formatCents(d.optimistic.rows[0]!.totals.portfolioEnd));
    expect(c0[8]).toBe(formatCents(d.pessimistic.rows[0]!.totals.portfolioEnd));
    // A later row is deflated by its own price index.
    const later = d.baseline.rows[20]!;
    expect(cells(rows[20]!)[6]).toBe(formatCents(later.totals.portfolioEnd / later.deflator));
    expect(
      screen.getAllByText(/fixed return offsets \(\+2\/−2 points\), not confidence intervals/, { selector: 'p' })[0],
    ).toBeInTheDocument();

    // Annual flows tab and its table.
    await user.click(screen.getByRole('tab', { name: 'Annual flows' }));
    await user.click(screen.getByRole('button', { name: /Show annual flows data table/ }));
    const flows = screen.getByRole('region', { name: 'Annual flows by year, today’s dollars' });
    const retireIndex = d.baseline.rows.findIndex((r) => r.year === d.cards.firstRetirementYear);
    const retireRow = d.baseline.rows[retireIndex]!;
    expect(cells(dataRows(flows)[retireIndex]!)[4]).toBe(formatCents(retireRow.flows.withdrawals / retireRow.deflator));

    // Allocation by tax treatment.
    await user.click(screen.getByRole('button', { name: /Show by tax treatment data table/ }));
    const tax = screen.getByRole('region', { name: 'By tax treatment by year, today’s dollars' });
    const t = first.totals.byTaxTreatment;
    expect(cells(dataRows(tax)[0]!).slice(2)).toEqual([
      formatCents(t.taxDeferred),
      formatCents(t.taxFree),
      formatCents(t.taxable),
      formatCents(first.totals.portfolioEnd),
    ]);

    // Allocation by account type: only the types the household holds.
    await user.click(screen.getByRole('button', { name: /Show by account type data table/ }));
    const byType = screen.getByRole('region', { name: 'By account type by year, today’s dollars' });
    const headers = within(byType)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Year',
      'Age',
      'Workplace plan, traditional',
      'Roth IRA',
      'Health savings account (HSA)',
      'Taxable brokerage',
      'Total',
    ]);
    // By asset class: the sample sets no allocations, so every balance is "No allocation set".
    await user.click(screen.getByRole('button', { name: /Show by asset class data table/ }));
    const byAsset = screen.getByRole('region', { name: 'By asset class by year, today’s dollars' });
    expect(
      within(byAsset)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Year', 'Age', 'No allocation set', 'Total']);
    expect(cells(dataRows(byAsset)[0]!).slice(2)).toEqual([
      formatCents(first.totals.portfolioEnd),
      formatCents(first.totals.portfolioEnd),
    ]);
    expect(screen.getByText(/No account has an allocation set yet/)).toBeInTheDocument();
  });

  it('allocation view (c) by asset class equals the engine’s allocationByAssetClass in both dollar bases', async () => {
    const user = userEvent.setup();
    const household = shortHousehold();
    const d = dashboardOf(household);
    const rows = allocationByAssetClass(household, d.baseline);
    await renderWithProfile(<DashboardPage />, { household });
    const section = screen.getByRole('heading', { name: 'By asset class' }).closest('section')!;
    expect(within(section).getByText(/1 of 2 accounts have no allocation set/)).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: /Show by asset class data table/ }));
    const table = screen.getByRole('region', { name: 'By asset class by year, today’s dollars' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Year', 'Age', 'Stocks', 'Bonds', 'Cash', 'No allocation set', 'Total']);
    const body = dataRows(table);
    expect(body).toHaveLength(rows.length);
    rows.forEach((r, i) => {
      const real = (c: number) => formatCents(c / r.deflator);
      expect(cells(body[i]!).slice(0, 6)).toEqual([
        String(r.year),
        expect.any(String),
        real(r.stocks),
        real(r.bonds),
        real(r.cash),
        real(r.unallocated),
      ]);
    });

    await user.click(screen.getByRole('radio', { name: 'Future dollars' }));
    const nominal = screen.getByRole('region', { name: 'By asset class by year, future dollars' });
    const last = rows.at(-1)!;
    expect(cells(dataRows(nominal).at(-1)!).slice(2, 6)).toEqual([
      formatCents(last.stocks),
      formatCents(last.bonds),
      formatCents(last.cash),
      formatCents(last.unallocated),
    ]);
  });

  it('hand-checked retiree: $100,000 cash at 0% return and inflation, $10,000 a year, runs out in year 11', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<DashboardPage />, { household: retiree(1_000_000) });
    const longevity = card('Portfolio longevity');
    expect(within(longevity).getByText('Runs out at age 80')).toBeInTheDocument();
    expect(within(longevity).getByText(`In ${CURRENT_YEAR + 10}. Baseline forecast.`)).toBeInTheDocument();
    expect(within(card('Readiness')).getByText('At risk')).toBeInTheDocument();
    expect(within(card('Current savings')).getByText('$100,000')).toBeInTheDocument();
    expect(within(card('Estimated monthly retirement spending')).getByText('$833')).toBeInTheDocument();
    expect(within(card('Years to retirement')).getByText('Retired')).toBeInTheDocument();
    expect(
      within(card('Projected monthly retirement income')).getByText(`This year (${CURRENT_YEAR}), already retired`),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show year-by-year table/ }));
    const table = screen.getByRole('region', { name: 'Forecast details by year, today’s dollars' });
    const rows = dataRows(table);
    // Year 1: $100,000 start, $10,000 withdrawn, $90,000 end.
    expect(cells(rows[0]!)).toEqual([
      String(CURRENT_YEAR),
      '70',
      'Retirement',
      '$100,000',
      '$0',
      '$0',
      '$0',
      '$10,000',
      '$10,000',
      '$0',
      '$90,000',
    ]);
    // Year 10 empties the account; year 11 is the first unfunded year.
    expect(cells(rows[9]!)[10]).toBe('$0');
    expect(cells(rows[10]!)[0]).toBe(String(CURRENT_YEAR + 10));
    expect(cells(rows[10]!)[9]).toBe('$10,000 (not funded)');
    expect(cells(rows[9]!)[9]).toBe('$0');
  });

  it('a household whose money lasts says so', async () => {
    const household = retiree(100_000);
    const d = dashboardOf(household);
    await renderWithProfile(<DashboardPage />, { household });
    expect(within(card('Portfolio longevity')).getByText('Lasts through planning age 95')).toBeInTheDocument();
    expect(d.cards.readiness.status).toBe('onTrack');
    expect(within(card('Readiness')).getByText('On track')).toBeInTheDocument();
  });

  it('explains why the forecast cannot run instead of showing figures', async () => {
    await renderWithProfile(<DashboardPage />, { household: retiree(100_000, { age: 100 }) });
    expect(screen.getByText('The forecast cannot run with this profile yet')).toBeInTheDocument();
    expect(screen.getByText(/Everyone is past their planning age/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Readiness' })).not.toBeInTheDocument();
  });

  it('in today’s dollars, each year’s start equals the prior year’s end (start is deflated by the prior year)', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<DashboardPage />, { household: sample('earlyCareer') });
    await user.click(screen.getByRole('button', { name: /Show year-by-year table/ }));
    const table = screen.getByRole('region', { name: 'Forecast details by year, today’s dollars' });
    const header = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    const start = header.indexOf('Portfolio start');
    const end = header.length - 1;
    const rows = dataRows(table).map(cells);
    for (let i = 1; i < 12; i++) expect(rows[i]![start]).toBe(rows[i - 1]![end]);
  });
});
