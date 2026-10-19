import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import {
  HouseholdSchema,
  monteCarloReadiness,
  RULES,
  runMonteCarloChunk,
  summarizeMonteCarlo,
  type EngineContext,
  type Household,
  type MonteCarloConfig,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';
import { formatPercent } from '@/lib/format';
import { renderWithProfile } from '@/test/renderWithProfile';
import { shortHousehold } from '@/test/monteCarloFixtures';
import { useProfileStore } from '@/state/profileStore';
import { createInProcessExecutor } from '@/features/monte-carlo/runner';
import { setExecutorPoolFactory, useMonteCarloStore } from '@/features/monte-carlo/runStore';
import { DashboardPage } from './DashboardPage';

const ctx: EngineContext = { currentYear: CURRENT_YEAR as EngineContext['currentYear'], rules: RULES };
const LABELS = { onTrack: 'On track', borderline: 'Borderline', atRisk: 'At risk' } as const;

const config: MonteCarloConfig = {
  paths: 1000,
  quickRunPaths: 1000,
  seed: 11,
  inflation: { mode: 'fixed' },
  rebalancing: 'annual',
};

const active = () => {
  const s = useProfileStore.getState();
  return s.profiles[s.activeId!]!.household;
};

function direct(household: Household) {
  const r = runMonteCarloChunk(household, ctx, config, { pathStart: 0, pathEnd: config.paths });
  if (r.status !== 'ok') throw new Error(r.status);
  return summarizeMonteCarlo([r.value], config, household, ctx.currentYear);
}

async function runFor(household: Household) {
  act(() => useMonteCarloStore.getState().start({ profileId: household.id, household, ctx, config }));
  await waitFor(() => expect(useMonteCarloStore.getState().status).toBe('done'), { timeout: 10_000 });
}

beforeEach(() => {
  setExecutorPoolFactory(() => [createInProcessExecutor()]);
  useMonteCarloStore.getState().reset();
});
afterEach(() => useMonteCarloStore.getState().reset());

describe('Dashboard readiness with Monte Carlo', () => {
  it('shows the success rate and its monteCarloReadiness band with assumptions, then a stale notice after an edit', async () => {
    await renderWithProfile(<DashboardPage />, { household: shortHousehold() });
    const household = active();
    await runFor(household);
    const expected = direct(household);
    const readiness = screen.getByRole('region', { name: 'Readiness' });
    const mc = within(readiness).getByRole('region', { name: 'Monte Carlo success rate' });
    expect(within(mc).getByText(formatPercent(expected.successRate, 0))).toBeInTheDocument();
    expect(within(mc).getByText(LABELS[monteCarloReadiness(expected.successRate)])).toBeInTheDocument();
    // Assumptions beside the rate, with the required wording and a link to the full list.
    expect(within(mc).getByText(/1,000 paths, seed 11, inflation fixed/)).toHaveTextContent(
      'Model-dependent estimate, not a guarantee.',
    );
    expect(within(mc).getByRole('link', { name: /See every assumption/ })).toHaveAttribute('href', '/monte-carlo');
    // The deterministic readiness is still there.
    expect(within(readiness).getByText(/Baseline run (lasts|falls short)/)).toBeInTheDocument();

    // A plan edit makes the run stale: the rate is withdrawn and a link offers a new run.
    act(() =>
      useProfileStore.getState().updateActiveHousehold(
        HouseholdSchema.parse({
          ...household,
          spending: {
            ...household.spending,
            retirementAnnualSpending: household.spending.retirementAnnualSpending + 100_000,
          },
        }),
      ),
    );
    await waitFor(() =>
      expect(within(readiness).getByText(/The plan changed since the last Monte Carlo run/)).toBeInTheDocument(),
    );
    expect(within(readiness).queryByText(formatPercent(expected.successRate, 0))).not.toBeInTheDocument();
    expect(within(readiness).getByRole('link', { name: 'Run Monte Carlo' })).toHaveAttribute('href', '/monte-carlo');
  }, 30_000);

  it('band matches monteCarloReadiness for a plan that falls short often', async () => {
    const base = shortHousehold();
    const poor = HouseholdSchema.parse({
      ...base,
      spending: { currentAnnualSpending: 9_000_000, retirementAnnualSpending: 9_000_000 },
    });
    await renderWithProfile(<DashboardPage />, { household: poor });
    const household = active();
    await runFor(household);
    const expected = direct(household);
    const mc = within(screen.getByRole('region', { name: 'Readiness' })).getByRole('region', {
      name: 'Monte Carlo success rate',
    });
    expect(within(mc).getByText(LABELS[monteCarloReadiness(expected.successRate)])).toBeInTheDocument();
    expect(within(mc).getByText(formatPercent(expected.successRate, 0))).toBeInTheDocument();
  }, 30_000);

  it('ignores a run for another profile', async () => {
    await renderWithProfile(<DashboardPage />, { household: shortHousehold() });
    const household = active();
    act(() => useMonteCarloStore.getState().start({ profileId: 'someone-else', household, ctx, config }));
    await waitFor(() => expect(useMonteCarloStore.getState().status).toBe('done'), { timeout: 10_000 });
    const readiness = screen.getByRole('region', { name: 'Readiness' });
    expect(within(readiness).getByText(/No Monte Carlo result for this plan yet/)).toBeInTheDocument();
  }, 30_000);
});
