/**
 * Monte Carlo success rates in the scenario comparison (docs/financial-model.md §10, M6): the base
 * plan and each compared scenario (applied with `applyScenario`) run the same configuration (same
 * seed, same paths) one after another through the Monte Carlo runner's executor pool. Common random
 * numbers: plan differences are not sampling noise between seeds.
 *
 * No financial logic here: each rate is the engine's `summarizeMonteCarlo` result via `runMonteCarlo`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineContext, Household, MonteCarloConfig, MonteCarloResult } from '@rn/engine';
import {
  runMonteCarlo,
  type ChunkExecutor,
  type ChunkFailure,
  type MonteCarloRun,
} from '@/features/monte-carlo/runner';
import { createExecutorPool } from '@/features/monte-carlo/runStore';
import { sameConfig, sameHousehold } from '@/features/monte-carlo/viewModel';

export const MC_MIN_PATHS = 1000;
export const MC_MAX_PATHS = 10_000;
export const MC_DEFAULT_PATHS = 1000;

/** The paths setting's error message, or null when it is a whole number from 1,000 to 10,000. */
export function pathsError(paths: number | null): string | null {
  if (paths === null || !Number.isInteger(paths) || paths < MC_MIN_PATHS || paths > MC_MAX_PATHS) {
    return 'Use 1,000 to 10,000 paths';
  }
  return null;
}

/** One plan in the comparison: `key` is 'base' or the scenario id; household null when it cannot run. */
export interface McPlan {
  key: string;
  name: string;
  household: Household | null;
}

export type PlanRate =
  | { status: 'ok'; result: MonteCarloResult }
  /** The plan is invalid (its scenario cannot be applied), so it was not simulated. */
  | { status: 'skipped' }
  | { status: 'failed'; failure: ChunkFailure };

export interface PlansProgress {
  /** Index among the plans being simulated (invalid plans are skipped). */
  planIndex: number;
  plans: number;
  name: string;
  /** Paths finished across all plans. */
  done: number;
  total: number;
}

export type PlansOutcome = { status: 'ok'; rates: Record<string, PlanRate> } | { status: 'cancelled' };

/** Run `config` on every plan in turn; cancel stops the plan in progress and the rest. */
export function runPlansMonteCarlo(args: {
  plans: readonly McPlan[];
  ctx: EngineContext;
  config: MonteCarloConfig;
  pool: readonly ChunkExecutor[];
  onProgress?: (p: PlansProgress) => void;
}): { promise: Promise<PlansOutcome>; cancel: () => void } {
  const { plans, ctx, config, pool } = args;
  let cancelled = false;
  let current: MonteCarloRun | null = null;
  const runnable = plans.filter((p) => p.household !== null);
  const total = runnable.length * config.paths;
  const promise = (async (): Promise<PlansOutcome> => {
    const rates: Record<string, PlanRate> = {};
    let k = 0;
    for (const plan of plans) {
      if (cancelled) return { status: 'cancelled' };
      if (!plan.household) {
        rates[plan.key] = { status: 'skipped' };
        continue;
      }
      const before = k * config.paths;
      const planIndex = k;
      args.onProgress?.({ planIndex, plans: runnable.length, name: plan.name, done: before, total });
      current = runMonteCarlo({
        household: plan.household,
        ctx,
        config,
        pool,
        onProgress: (p) =>
          args.onProgress?.({ planIndex, plans: runnable.length, name: plan.name, done: before + p.done, total }),
      });
      const outcome = await current.promise;
      current = null;
      if (cancelled || outcome.status === 'cancelled') return { status: 'cancelled' };
      rates[plan.key] =
        outcome.status === 'ok'
          ? { status: 'ok', result: outcome.full.result }
          : { status: 'failed', failure: outcome.failure };
      k++;
    }
    return { status: 'ok', rates };
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      current?.cancel();
    },
  };
}

export interface CompareMcRun {
  config: MonteCarloConfig;
  /** The households each plan ran with (stale check), by plan key. */
  households: Record<string, Household | null>;
  rates: Record<string, PlanRate>;
}

/** Progress updates reach React at most this often (plan boundaries always do). */
const PROGRESS_INTERVAL_MS = 100;

/**
 * Comparison Monte Carlo state for the Compare view. Uses its own executor pool (same factory as the
 * Monte Carlo page), so it never interrupts a run on that page; the pool is disposed on unmount.
 */
export function useCompareMonteCarlo(plans: readonly McPlan[], ctx: EngineContext, config: MonteCarloConfig) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PlansProgress | null>(null);
  const [run, setRun] = useState<CompareMcRun | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const handle = useRef<{ cancel: () => void } | null>(null);
  const activeToken = useRef<symbol | null>(null);
  const pool = useRef<ChunkExecutor[] | null>(null);

  useEffect(() => {
    const live = { handle, pool, activeToken };
    return () => {
      live.activeToken.current = null;
      live.handle.current?.cancel();
      live.handle.current = null;
      live.pool.current?.forEach((e) => e.dispose());
      live.pool.current = null;
    };
  }, []);

  const start = () => {
    handle.current?.cancel();
    const executors = (pool.current ??= createExecutorPool());
    const ranPlans = [...plans];
    const ranConfig = config;
    // Callbacks fire before runPlansMonteCarlo returns, so a token (not the handle) identifies this run.
    const token = Symbol('compare-run');
    activeToken.current = token;
    let last = -Infinity;
    let lastPlan = -1;
    setRunning(true);
    setCancelled(false);
    setProgress(null);
    const h = runPlansMonteCarlo({
      plans: ranPlans,
      ctx,
      config: ranConfig,
      pool: executors,
      onProgress: (p) => {
        if (activeToken.current !== token) return;
        const now = performance.now();
        if (p.planIndex === lastPlan && p.done < p.total && now - last < PROGRESS_INTERVAL_MS) return;
        last = now;
        lastPlan = p.planIndex;
        setProgress(p);
      },
    });
    handle.current = h;
    void h.promise.then((outcome) => {
      if (activeToken.current !== token) return;
      activeToken.current = null;
      handle.current = null;
      setRunning(false);
      setProgress(null);
      if (outcome.status === 'cancelled') {
        setCancelled(true);
        return;
      }
      setRun({
        config: ranConfig,
        households: Object.fromEntries(ranPlans.map((p) => [p.key, p.household])),
        rates: outcome.rates,
      });
    });
  };

  const cancel = () => {
    handle.current?.cancel();
  };

  // Stale when any compared plan (or the configuration) differs from what was simulated.
  const stale = useMemo(() => {
    if (!run) return false;
    if (!sameConfig(run.config, config)) return true;
    return plans.some((p) => {
      if (!(p.key in run.households)) return true;
      const ran = run.households[p.key] ?? null;
      if (ran === null || p.household === null) return ran !== p.household;
      return !sameHousehold(ran, p.household);
    });
  }, [run, config, plans]);

  return { running, progress, run, cancelled, stale, start, cancel };
}

export type CompareMonteCarloState = ReturnType<typeof useCompareMonteCarlo>;
