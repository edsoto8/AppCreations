/**
 * Monte Carlo settings shared by the other pages that run or show Monte Carlo (scenario comparison,
 * retirement-age optimizer, dashboard readiness): the seed and inflation model of the person's last
 * run on the Monte Carlo page for this profile, else the documented defaults (seed 42, fixed
 * inflation at the plan's own assumption). Selection and labels only.
 */
import { useShallow } from 'zustand/react/shallow';
import type { MonteCarloConfig } from '@rn/engine';
import { formatPercent } from '@/lib/format';
import { useMonteCarloStore } from './runStore';
import { DEFAULT_SEED, formatCount, QUICK_RUN_PATHS } from './viewModel';

export interface SharedMonteCarloSettings {
  seed: number;
  inflation: MonteCarloConfig['inflation'];
  /** Where the seed and inflation model come from. */
  source: 'lastRun' | 'defaults';
}

export const DEFAULT_SHARED_SETTINGS: SharedMonteCarloSettings = {
  seed: DEFAULT_SEED,
  inflation: { mode: 'fixed' },
  source: 'defaults',
};

export function sharedMonteCarloSettings(
  run: { profileId: string | null; config: MonteCarloConfig | null },
  householdId: string,
): SharedMonteCarloSettings {
  if (run.profileId !== householdId || !run.config) return DEFAULT_SHARED_SETTINGS;
  return { seed: run.config.seed, inflation: run.config.inflation, source: 'lastRun' };
}

/** The shared settings for this household, following the Monte Carlo store. */
export function useSharedMonteCarloSettings(householdId: string): SharedMonteCarloSettings {
  const run = useMonteCarloStore(useShallow((s) => ({ profileId: s.profileId, config: s.config })));
  return sharedMonteCarloSettings(run, householdId);
}

/** A run configuration with these settings (the quick run is the first 1,000 paths, or all of them). */
export function configFor(settings: SharedMonteCarloSettings, paths: number): MonteCarloConfig {
  return {
    paths,
    quickRunPaths: Math.min(QUICK_RUN_PATHS, paths),
    seed: settings.seed,
    inflation: settings.inflation,
    rebalancing: 'annual',
  };
}

/** "fixed (each plan’s own inflation assumption)" or "stochastic (median 2.5%, volatility 1%)". */
export function inflationLabel(
  inflation: MonteCarloConfig['inflation'],
  fixedNote = 'the plan’s own assumption',
): string {
  if (inflation.mode === 'fixed') return `fixed (${fixedNote})`;
  return `stochastic (median ${formatPercent(inflation.median)}, volatility ${formatPercent(inflation.volatility)})`;
}

export function settingsSourceText(settings: SharedMonteCarloSettings): string {
  return settings.source === 'lastRun'
    ? 'Seed and inflation model from your last run on the Monte Carlo page.'
    : `Default seed ${DEFAULT_SEED} and fixed inflation; to change them, run on the Monte Carlo page with other settings.`;
}

/** "1,000 paths, seed 42, inflation fixed (…)". */
export function settingsSummary(paths: number, settings: SharedMonteCarloSettings, fixedNote?: string): string {
  return `${formatCount(paths)} paths, seed ${settings.seed}, inflation ${inflationLabel(settings.inflation, fixedNote)}`;
}
