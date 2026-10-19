import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import {
  applyScenario,
  HouseholdSchema,
  optimizeRetirementAge,
  presetScenario,
  RULES,
  runMonteCarloChunk,
  summarizeMonteCarlo,
  type Household,
  type MonteCarloConfig,
  type Scenario,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';
import { formatCents, formatPercent } from '@/lib/format';
import { setupProfile } from '@/test/renderWithProfile';
import { nearRetirementHousehold } from '@/test/monteCarloFixtures';
import { useProfileStore } from '@/state/profileStore';
import { scenariosOf, useScenarioStore } from '@/state/scenarioStore';
import { createInProcessExecutor, type ChunkExecutor } from '@/features/monte-carlo/runner';
import { setExecutorPoolFactory, useMonteCarloStore } from '@/features/monte-carlo/runStore';
import {
  createInProcessOptimizer,
  setOptimizerExecutorFactory,
  type OptimizerExecutor,
} from '@/features/monte-carlo/optimizerRunner';
import { DEFAULT_SEED, formatCount } from '@/features/monte-carlo/viewModel';
import { ScenariosPage } from './ScenariosPage';

const ctx = { currentYear: CURRENT_YEAR, rules: RULES };

function configOf(paths: number, seed = DEFAULT_SEED, inflation: MonteCarloConfig['inflation'] = { mode: 'fixed' }) {
  return { paths, quickRunPaths: Math.min(1000, paths), seed, inflation, rebalancing: 'annual' } as MonteCarloConfig;
}

function directSummary(household: Household, config: MonteCarloConfig) {
  const r = runMonteCarloChunk(household, ctx, config, { pathStart: 0, pathEnd: config.paths });
  if (r.status !== 'ok') throw new Error(r.status);
  return summarizeMonteCarlo([r.value], config, household, ctx.currentYear);
}

async function renderPage(seed: (base: Household, profileId: string) => Scenario[] = () => []) {
  await setupProfile(nearRetirementHousehold());
  const profileId = useProfileStore.getState().activeId!;
  const base = useProfileStore.getState().profiles[profileId]!.household;
  for (const s of seed(base, profileId)) await useScenarioStore.getState().createScenario(s);
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/scenarios']}>
      <ScenariosPage />
    </MemoryRouter>,
  );
  return { user, profileId, base };
}

const twoScenarios = (base: Household, profileId: string) => [
  presetScenario(
    'F_reducedSpending',
    base,
    { cut: 0.2, currentYear: CURRENT_YEAR },
    { scenarioId: 'scenario-f', name: 'Spend less', baseProfileId: profileId },
  ),
  presetScenario(
    'E_delayedRetirement',
    base,
    { years: 3, currentYear: CURRENT_YEAR },
    { scenarioId: 'scenario-e', name: 'Retire later', baseProfileId: profileId },
  ),
];

const compareTable = () => screen.getByRole('region', { name: 'Scenario comparison' });
function mcCells(): string[] {
  const header = within(compareTable()).getByRole('rowheader', { name: /^Monte Carlo success rate/ });
  return within(header.closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '');
}
const rateText = (r: { successRate: number; paths: number }) =>
  `${formatPercent(r.successRate, 0)}${formatCount(Math.round(r.successRate * r.paths))} of ${formatCount(r.paths)} paths`;

beforeEach(() => {
  setExecutorPoolFactory(() => [createInProcessExecutor(), createInProcessExecutor()]);
  setOptimizerExecutorFactory(createInProcessOptimizer);
  useMonteCarloStore.getState().reset();
});
afterEach(() => useMonteCarloStore.getState().reset());

describe('Compare view: Monte Carlo success rates', () => {
  it('is opt-in, and each plan’s rate equals the engine summary of the applied scenario with the same seed and paths', async () => {
    const { user, base, profileId } = await renderPage(twoScenarios);
    expect(within(compareTable()).queryByRole('rowheader', { name: /^Monte Carlo success rate/ })).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Add Monte Carlo success rates' }));
    expect(screen.getByLabelText('Paths per plan')).toHaveValue('1000');
    expect(mcCells()).toEqual(['Not computed', 'Not computed', 'Not computed']);
    expect(screen.getByText(/Default seed 42 and fixed inflation/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run Monte Carlo for these plans' }));
    await waitFor(() => expect(mcCells()[2]).toMatch(/paths$/), { timeout: 30_000 });

    const config = configOf(1000);
    const scenarios = scenariosOf(useScenarioStore.getState().scenarios, profileId);
    // Columns follow the page's default comparison order (the first two scenarios).
    const households = [base, ...scenarios.slice(0, 2).map((s) => applyScenario(base, s).household!)];
    const expected = households.map((h) => directSummary(h, config));
    expect(mcCells()).toEqual(expected.map(rateText));

    // The assumptions sit beside the rates: paths, seed, inflation and the required wording.
    const header = within(compareTable()).getByRole('rowheader', { name: /^Monte Carlo success rate/ });
    expect(header).toHaveTextContent('1,000 paths, seed 42, inflation fixed');
    expect(header).toHaveTextContent('the same paths for every plan');
    expect(header).toHaveTextContent('Model-dependent estimate, not a guarantee.');
    const assumptions = screen.getByRole('region', { name: 'Assumptions behind these success rates' });
    expect(within(assumptions).getByText(/1,000 paths and seed 42 for every plan/)).toBeInTheDocument();
    expect(within(assumptions).getByText('Model-dependent estimate, not a guarantee.')).toBeInTheDocument();
    expect(screen.queryByText(/confidence interval/i)).toBeNull();
    // Each plan's full engine assumptions are listed too.
    await user.click(within(assumptions).getByText('Full assumptions by plan'));
    expect(
      within(within(assumptions).getByRole('list', { name: 'Monte Carlo assumptions for Spend less' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(expected[1]!.assumptions);

    // Editing the base plan marks the rates stale.
    act(() => {
      useProfileStore.getState().updateActiveHousehold(
        HouseholdSchema.parse({
          ...base,
          spending: { ...base.spending, retirementAnnualSpending: base.spending.retirementAnnualSpending + 500_000 },
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByText(/The plans or settings changed since these success rates/)).toBeInTheDocument(),
    );
    expect(mcCells()[0]).toMatch(/Out of date$/);
  }, 60_000);

  it('uses the Monte Carlo page’s seed and inflation, honors the paths setting, and validates it', async () => {
    const { user, base, profileId } = await renderPage((b, id) => twoScenarios(b, id).slice(0, 1));
    // A previous run on the Monte Carlo page set seed 99 with stochastic inflation.
    const inflation: MonteCarloConfig['inflation'] = {
      mode: 'stochastic',
      median: 0.025,
      volatility: 0.01,
      correlationWithAssets: [0, 0, 0],
    };
    act(() => {
      useMonteCarloStore.setState({ profileId: base.id, config: configOf(1000, 99, inflation) });
    });
    expect(profileId).toBe(base.id);
    await user.click(screen.getByRole('switch', { name: 'Add Monte Carlo success rates' }));
    expect(screen.getByText(/Seed and inflation model from your last run on the Monte Carlo page/)).toBeInTheDocument();
    const paths = screen.getByLabelText('Paths per plan');
    await user.clear(paths);
    await user.type(paths, '500');
    expect(screen.getByText('Use 1,000 to 10,000 paths')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Monte Carlo for these plans' })).toBeDisabled();
    await user.clear(paths);
    await user.type(paths, '1200');
    await user.click(screen.getByRole('button', { name: 'Run Monte Carlo for these plans' }));
    await waitFor(() => expect(mcCells()[1]).toMatch(/paths$/), { timeout: 30_000 });
    const config = configOf(1200, 99, inflation);
    const scenario = scenariosOf(useScenarioStore.getState().scenarios, profileId).find((s) => s.id === 'scenario-f')!;
    const expected = [base, applyScenario(base, scenario).household!].map((h) => directSummary(h, config));
    expect(mcCells()).toEqual(expected.map(rateText));
    const header = within(compareTable()).getByRole('rowheader', { name: /^Monte Carlo success rate/ });
    expect(header).toHaveTextContent('1,200 paths, seed 99, inflation stochastic (median 2.5%, volatility 1%)');
  }, 60_000);

  it('shows progress while running and cancel stops it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const inner = createInProcessExecutor();
    const gated: ChunkExecutor = {
      kind: 'inProcess',
      run: async (req, onProgress) => {
        await gate;
        return inner.run(req, onProgress);
      },
      cancel: () => inner.cancel(),
      dispose: () => inner.dispose(),
    };
    setExecutorPoolFactory(() => [gated]);
    const { user } = await renderPage(twoScenarios);
    await user.click(screen.getByRole('switch', { name: 'Add Monte Carlo success rates' }));
    await user.click(screen.getByRole('button', { name: 'Run Monte Carlo for these plans' }));
    expect(await screen.findByRole('progressbar', { name: 'Comparison Monte Carlo progress' })).toBeInTheDocument();
    expect(screen.getByText(/Plan 1 of 3 \(Base plan\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    release();
    expect(await screen.findByText('Monte Carlo cancelled.')).toBeInTheDocument();
    expect(mcCells()).toEqual(['Not computed', 'Not computed', 'Not computed']);
  }, 30_000);
});

describe('Retirement-age optimizer: Monte Carlo criterion', () => {
  it('runs the scan in the optimizer executor and shows exactly optimizeRetirementAge’s Monte Carlo result', async () => {
    const calls: unknown[] = [];
    setOptimizerExecutorFactory((): OptimizerExecutor => {
      const inner = createInProcessOptimizer();
      return { ...inner, run: (req, onProgress) => (calls.push(req), inner.run(req, onProgress)) };
    });
    const { user, base } = await renderPage();
    const optimizer = screen.getByRole('region', { name: 'Earliest retirement age' });
    await user.click(within(optimizer).getByRole('radio', { name: 'Monte Carlo success rate' }));
    expect(within(optimizer).getByLabelText('Target success rate')).toHaveValue('85');
    const from = within(optimizer).getByLabelText('From age');
    await user.clear(from);
    await user.type(from, '59');
    const to = within(optimizer).getByLabelText('To age');
    await user.clear(to);
    await user.type(to, '64');
    expect(
      within(optimizer).getAllByText(/^Criterion: a Monte Carlo success rate of at least 85%/).length,
    ).toBeGreaterThan(0);

    await user.click(within(optimizer).getByRole('button', { name: 'Find earliest age' }));
    const criterion = { kind: 'monteCarlo', config: configOf(1000), minSuccessRate: 0.85 } as const;
    const range = { fromAge: 59, toAge: 64 };
    const expected = optimizeRetirementAge(base, ctx, criterion, range);
    if (expected.status !== 'ok') throw new Error(expected.status);
    const { earliestAge, evaluated } = expected.value;
    await within(optimizer).findByText(
      earliestAge !== null
        ? `Earliest age that meets the criterion: ${earliestAge}`
        : `No age from 59 to 64 meets the criterion.`,
      {},
      { timeout: 30_000 },
    );
    expect(calls).toEqual([{ household: base, ctx, criterion, range }]);
    expect(within(optimizer).getByText('Scored on the first 1,000 paths for every age.')).toBeInTheDocument();
    const assumptions = within(optimizer).getByRole('region', { name: 'Assumptions behind these success rates' });
    expect(assumptions).toHaveTextContent('1,000 paths, seed 42, inflation fixed');
    expect(assumptions).toHaveTextContent('Model-dependent estimate, not a guarantee.');

    await user.click(within(optimizer).getByRole('button', { name: /Show retirement age data table/ }));
    const table = screen.getByRole('region', { name: /^Retirement ages evaluated/ });
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) =>
          within(r)
            .getAllByRole('cell')
            .map((c) => c.textContent),
        ),
    ).toEqual(
      evaluated.map((e) => [
        String(e.age),
        e.success ? 'Yes' : 'No',
        formatPercent(e.successRate!, 1),
        formatCents(e.endingBalanceReal),
      ]),
    );

    // Changing the target marks the result stale.
    const target = within(optimizer).getByLabelText('Target success rate');
    await user.clear(target);
    await user.type(target, '90');
    expect(within(optimizer).getByText(/The plan or criterion changed since this scan/)).toBeInTheDocument();
  }, 60_000);

  it('shows progress per age and cancel stops the scan', async () => {
    const { user } = await renderPage();
    const optimizer = screen.getByRole('region', { name: 'Earliest retirement age' });
    await user.click(within(optimizer).getByRole('radio', { name: 'Monte Carlo success rate' }));
    await user.click(within(optimizer).getByRole('button', { name: 'Find earliest age' }));
    expect(await within(optimizer).findByRole('progressbar', { name: 'Optimizer progress' })).toBeInTheDocument();
    await user.click(within(optimizer).getByRole('button', { name: 'Cancel scan' }));
    expect(await within(optimizer).findByText('Scan cancelled.')).toBeInTheDocument();
    expect(within(optimizer).queryByText(/Earliest age that meets the criterion/)).toBeNull();
  }, 30_000);

  it('validates the target success rate', async () => {
    const { user } = await renderPage();
    const optimizer = screen.getByRole('region', { name: 'Earliest retirement age' });
    await user.click(within(optimizer).getByRole('radio', { name: 'Monte Carlo success rate' }));
    const target = within(optimizer).getByLabelText('Target success rate');
    await user.clear(target);
    await user.type(target, '0');
    expect(within(optimizer).getByText('Use a target above 0% and at most 100%')).toBeInTheDocument();
    expect(within(optimizer).getByRole('button', { name: 'Find earliest age' })).toBeDisabled();
  });
});
