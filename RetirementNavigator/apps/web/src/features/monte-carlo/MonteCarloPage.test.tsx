import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  HouseholdSchema,
  impliedArithmeticMeans,
  RULES,
  runMonteCarloChunk,
  sequenceRiskIllustration,
  summarizeMonteCarlo,
  type EngineContext,
  type Household,
  type MonteCarloConfig,
} from '@rn/engine';
import { formatCents, formatPercent } from '@/lib/format';
import { renderWithProfile } from '@/test/renderWithProfile';
import { shortHousehold } from '@/test/monteCarloFixtures';
import { useProfileStore } from '@/state/profileStore';
import { CURRENT_YEAR } from '@/app/env';
import { MonteCarloPage } from './MonteCarloPage';
import { createInProcessExecutor, type ChunkExecutor } from './runner';
import { setExecutorPoolFactory, useMonteCarloStore } from './runStore';
import { DEFAULT_SEED, formatDeviation } from './viewModel';

const ctx: EngineContext = { currentYear: CURRENT_YEAR as EngineContext['currentYear'], rules: RULES };

function directResult(household: Household, config: MonteCarloConfig) {
  const r = runMonteCarloChunk(household, ctx, config, { pathStart: 0, pathEnd: config.paths });
  if (r.status !== 'ok') throw new Error(r.status);
  return summarizeMonteCarlo([r.value], config, household, ctx.currentYear);
}

const config1000: MonteCarloConfig = {
  paths: 1000,
  quickRunPaths: 1000,
  seed: DEFAULT_SEED,
  inflation: { mode: 'fixed' },
  rebalancing: 'annual',
};

/** An in-process executor whose ranges past `holdFrom` wait until `release()` is called. */
function gated(holdFrom: number) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const inner = createInProcessExecutor();
  const executor: ChunkExecutor = {
    kind: 'inProcess',
    run: async (req, onProgress) => {
      if (req.pathStart >= holdFrom) await gate;
      return inner.run(req, onProgress);
    },
    cancel: () => inner.cancel(),
    dispose: () => inner.dispose(),
  };
  return { executor, release: () => release() };
}

async function setPaths(user: ReturnType<typeof userEvent.setup>, n: string) {
  const paths = screen.getByLabelText('Number of paths');
  await user.clear(paths);
  await user.type(paths, n);
}

const region = (name: string | RegExp) => screen.getByRole('region', { name });
const dataRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent);

beforeEach(() => {
  setExecutorPoolFactory(() => [createInProcessExecutor()]);
  useMonteCarloStore.getState().reset();
});

afterEach(() => {
  useMonteCarloStore.getState().reset();
});

describe('MonteCarloPage', () => {
  it('runs and shows the success rate with its assumptions beside it and the required wording', async () => {
    const user = userEvent.setup();
    const household = shortHousehold();
    await renderWithProfile(<MonteCarloPage />, { household });
    expect(screen.getByRole('heading', { level: 1, name: 'Monte Carlo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seed')).toHaveValue(String(DEFAULT_SEED));
    await setPaths(user, '1000');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    await waitFor(() => expect(useMonteCarloStore.getState().status).toBe('done'), { timeout: 10_000 });

    const expected = directResult(household, config1000);
    const results = region('Results');
    expect(within(results).getByText('1,000 paths')).toBeInTheDocument();
    expect(within(results).queryByText(/Preliminary/)).not.toBeInTheDocument();
    expect(within(results).getByText(/Quick run \(1,000 paths\) computed in \d+(\.\d)? s/)).toBeInTheDocument();

    const success = region('Probability of funding modeled spending');
    expect(within(success).getByText(formatPercent(expected.successRate, 0))).toBeInTheDocument();
    expect(within(success).getByText('Model-dependent estimate, not a guarantee.')).toBeInTheDocument();
    // Every assumption is listed in the same block as the number, not behind a click.
    const list = within(success).getByRole('list', { name: 'Assumptions behind this number' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(expected.assumptions);
    expect(expected.assumptions.some((a) => a.includes(household.assumptions.capitalMarket.note))).toBe(true);

    // Ending balances (today's dollars → endingReal) and the bands table (bandsReal).
    const ending = region('Ending balance at the planning age');
    for (const v of [expected.endingReal.p10, expected.endingReal.p50, expected.endingReal.p90]) {
      expect(within(ending).getAllByText(formatCents(v)).length).toBeGreaterThan(0);
    }
    await user.click(screen.getByRole('button', { name: /Show percentile bands data table/ }));
    const bands = region('Percentile bands by year, today’s dollars');
    const firstBand = expected.bandsReal[0]!;
    expect(cells(dataRows(bands)[0]!)).toEqual([
      String(firstBand.year),
      '85',
      formatCents(firstBand.p10),
      formatCents(firstBand.p25),
      formatCents(firstBand.p50),
      formatCents(firstBand.p75),
      formatCents(firstBand.p90),
    ]);
    expect(screen.getAllByText(/Percentile bands, not confidence intervals/).length).toBeGreaterThan(0);
    expect(screen.getByText(/10% of paths fall below the lower edge/)).toBeInTheDocument();

    // Future dollars switch to the nominal fields.
    await user.click(screen.getByRole('radio', { name: 'Future dollars' }));
    expect(
      within(region('Ending balance at the planning age')).getAllByText(formatCents(expected.ending.p50)).length,
    ).toBeGreaterThan(0);
    const nominalBands = region('Percentile bands by year, future dollars');
    expect(cells(dataRows(nominalBands).at(-1)!)[4]).toBe(formatCents(expected.bands.at(-1)!.p50));

    // Histogram and depletion tables come straight from the result.
    await user.click(screen.getByRole('button', { name: /Show ending balance distribution data table/ }));
    const hist = region('Ending balance distribution, today’s dollars');
    expect(dataRows(hist).map((r) => cells(r)[1])).toEqual(
      expected.histogram.map((h) => h.count.toLocaleString('en-US')),
    );

    // The methodology names the generator from the result.
    expect(screen.getByText(expected.algorithm)).toBeInTheDocument();
  });

  it('labels the quick run as preliminary until the full run completes, with a progress bar', async () => {
    const user = userEvent.setup();
    const household = shortHousehold();
    const { executor, release } = gated(1000);
    setExecutorPoolFactory(() => [executor]);
    await renderWithProfile(<MonteCarloPage />, { household });
    await setPaths(user, '2000');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));

    const results = region('Results');
    await within(results).findByText('Preliminary: first 1,000 paths', {}, { timeout: 10_000 });
    const quick = directResult(household, { ...config1000, paths: 1000 });
    expect(
      within(region('Probability of funding modeled spending')).getByText(formatPercent(quick.successRate, 0)),
    ).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Simulation progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '1000');
    expect(bar).toHaveAttribute('aria-valuemax', '2000');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

    release();
    await waitFor(() => expect(useMonteCarloStore.getState().status).toBe('done'), { timeout: 10_000 });
    expect(within(results).getByText('2,000 paths')).toBeInTheDocument();
    expect(within(results).queryByText(/Preliminary/)).not.toBeInTheDocument();
    const full = directResult(household, { ...config1000, paths: 2000 });
    expect(
      within(region('Probability of funding modeled spending')).getByText(formatPercent(full.successRate, 0)),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(results).getByText(/Full run \(2,000 paths\) computed in .* s, 1 worker/)).toBeInTheDocument();
  });

  it('cancel keeps the quick result labeled preliminary and stops the run', async () => {
    const user = userEvent.setup();
    const { executor } = gated(1000);
    setExecutorPoolFactory(() => [executor]);
    await renderWithProfile(<MonteCarloPage />, { household: shortHousehold() });
    await setPaths(user, '3000');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    await screen.findByText('Preliminary: first 1,000 paths', {}, { timeout: 10_000 });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(useMonteCarloStore.getState().status).toBe('cancelled'));
    expect(screen.getByText(/the run was cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeEnabled();
  });

  it('blocks the run with a clear message when the correlations are not positive semi-definite', async () => {
    const base = shortHousehold();
    const household = HouseholdSchema.parse({
      ...base,
      assumptions: {
        ...base.assumptions,
        capitalMarket: {
          ...base.assumptions.capitalMarket,
          correlation: [
            [1, 0.9, -0.9],
            [0.9, 1, 0.9],
            [-0.9, 0.9, 1],
          ],
        },
      },
    });
    await renderWithProfile(<MonteCarloPage />, { household });
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeDisabled();
    expect(
      within(screen.getByRole('note', { name: 'Cannot run yet' })).getByText(/not positive semi-definite/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('note', { name: 'Correlation problem' })).getByText(/not positive semi-definite/),
    ).toBeInTheDocument();
  });

  it('checks the 4×4 matrix when inflation is stochastic', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<MonteCarloPage />, { household: shortHousehold() });
    await user.selectOptions(screen.getByLabelText('Inflation model'), 'stochastic');
    expect(screen.getByLabelText('Median inflation')).toHaveValue(String(shortHousehold().assumptions.inflation * 100));
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeEnabled();
    for (const [label, v] of [
      ['Inflation and stocks', '0.9'],
      ['Inflation and bonds', '-0.9'],
    ] as const) {
      const input = screen.getByLabelText(label);
      await user.clear(input);
      await user.type(input, v);
    }
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeDisabled();
    expect(
      within(screen.getByRole('note', { name: 'Cannot run yet' })).getByText(/stocks, bonds, cash and inflation/),
    ).toBeInTheDocument();
  });

  it('validates settings with the engine schema', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<MonteCarloPage />, { household: shortHousehold() });
    await setPaths(user, '500');
    expect(await screen.findByText('Use 1,000 to 10,000 paths')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(useMonteCarloStore.getState().status).toBe('idle');
    await user.click(screen.getByRole('button', { name: 'New seed' }));
    expect(Number((screen.getByLabelText('Seed') as HTMLInputElement).value)).toBeGreaterThanOrEqual(0);
  });

  it('saves capital-market edits to the profile, keeping correlations symmetric, and flags stale results', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<MonteCarloPage />, { household: shortHousehold() });
    await setPaths(user, '1000');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    await waitFor(() => expect(useMonteCarloStore.getState().status).toBe('done'), { timeout: 10_000 });
    // The arithmetic mean beside each return equals the engine's, for the run and for the form values.
    const means = useMonteCarloStore.getState().full!.result.impliedArithmeticMeans;
    expect(screen.getByText(formatPercent(means.stocks, 2))).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'Results out of date' })).not.toBeInTheDocument();

    const stocks = screen.getByLabelText('Stocks median return');
    await user.clear(stocks);
    await user.type(stocks, '6');
    const pair = screen.getByLabelText('Stocks and bonds');
    await user.clear(pair);
    await user.type(pair, '0.3');
    await waitFor(() => {
      const cma =
        useProfileStore.getState().profiles[useProfileStore.getState().activeId!]!.household.assumptions.capitalMarket;
      expect(cma.stocks.geometricReturn).toBe(0.06);
      expect(cma.correlation[0]![1]).toBe(0.3);
      expect(cma.correlation[1]![0]).toBe(0.3);
    });
    expect(screen.getByRole('note', { name: 'Results out of date' })).toBeInTheDocument();
  });

  it('shows the implied arithmetic mean live beside each geometric return as it is edited, without a run', async () => {
    const user = userEvent.setup();
    const household = shortHousehold();
    await renderWithProfile(<MonteCarloPage />, { household });
    const meanOf = (asset: 'stocks' | 'bonds' | 'cash') =>
      screen
        .getByLabelText(`${{ stocks: 'Stocks', bonds: 'Bonds', cash: 'Cash' }[asset]} median return`)
        .closest('fieldset')!;
    const initial = impliedArithmeticMeans(household.assumptions.capitalMarket);
    for (const asset of ['stocks', 'bonds', 'cash'] as const) {
      expect(within(meanOf(asset)).getByText(formatPercent(initial[asset], 2))).toBeInTheDocument();
    }
    expect(useMonteCarloStore.getState().status).toBe('idle');

    const stocks = screen.getByLabelText('Stocks median return');
    await user.clear(stocks);
    await user.type(stocks, '6');
    const vol = screen.getByLabelText('Stocks volatility');
    await user.clear(vol);
    await user.type(vol, '20');
    const edited = impliedArithmeticMeans({
      ...household.assumptions.capitalMarket,
      stocks: { geometricReturn: 0.06, volatility: 0.2 },
    });
    expect(within(meanOf('stocks')).getByText(formatPercent(edited.stocks, 2))).toBeInTheDocument();
    // Bonds are unchanged.
    expect(within(meanOf('bonds')).getByText(formatPercent(initial.bonds, 2))).toBeInTheDocument();

    // An out-of-range value shows a dash instead of a number.
    await user.clear(stocks);
    await user.type(stocks, '80');
    expect(within(meanOf('stocks')).getByText('—')).toBeInTheDocument();
  });

  it('shows the sequence-of-returns illustration with the engine’s values', async () => {
    const user = userEvent.setup();
    const household = shortHousehold();
    const r = sequenceRiskIllustration(household, ctx);
    if (r.status !== 'ok') throw new Error(r.status);
    const ill = r.value;
    await renderWithProfile(<MonteCarloPage />, { household });
    expect(
      screen.getByRole('heading', { name: /Sequence of returns: same average, different order/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(ill.deviations.map(formatDeviation).join(', '))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show sequence of returns data table/ }));
    const table = region('Sequence-of-returns illustration by year, today’s dollars');
    const body = dataRows(table);
    expect(body).toHaveLength(ill.baseline.rows.length);
    ill.baseline.rows.forEach((row, i) => {
      const bad = ill.badYearsFirst.rows[i]!;
      const good = ill.goodYearsFirst.rows[i]!;
      const c = cells(body[i]!);
      expect(c[0]).toBe(String(row.year));
      expect(c[3]).toBe(formatCents(bad.totals.portfolioEnd / bad.deflator));
      expect(c[5]).toBe(formatCents(good.totals.portfolioEnd / good.deflator));
      expect(c[6]).toBe(formatCents(row.totals.portfolioEnd / row.deflator));
    });
    // The first shifted year carries the first deviation, in both orders.
    const k = ill.baseline.rows.findIndex((row) => row.year === ill.startYear);
    expect(cells(body[k]!)[2]).toBe(formatDeviation(ill.deviations[0]!));
    expect(cells(body[k]!)[4]).toBe(formatDeviation(ill.deviations.at(-1)!));
  });

  it('shows the pre-Medicare healthcare note and the methodology', async () => {
    const base = shortHousehold();
    const person = base.people[0]!;
    const household = HouseholdSchema.parse({ ...base, people: [{ ...person, retirementAge: 60 }] });
    await renderWithProfile(<MonteCarloPage />, { household });
    expect(
      within(screen.getByRole('note', { name: 'Healthcare before Medicare' })).getByText(/retires before 65/),
    ).toBeInTheDocument();
    const methodology = screen.getByText('Methodology').closest('details')!;
    expect(methodology).toHaveAttribute('open');
    expect(within(methodology).getByText(/\(1 \+ median\) × e\^\(σ²\/2\) − 1/)).toBeInTheDocument();
    expect(within(methodology).getByText(/move with the stock shock/)).toBeInTheDocument();
    expect(within(methodology).getByText(/No fat tails/)).toBeInTheDocument();
    expect(
      within(methodology).getByText(/monthly mode applies to the deterministic forecast only/),
    ).toBeInTheDocument();
  });

  it('shows the before-limits and before-taxes badges when the baseline has them (sample couple)', async () => {
    await renderWithProfile(<MonteCarloPage />);
    const sequence = screen.getByRole('heading', { name: /Sequence of returns/ }).closest('section')!;
    expect(within(sequence).getByText('Before plan limits (unverified)')).toBeInTheDocument();
    expect(within(sequence).getByText('Before taxes')).toBeInTheDocument();
  });
});
