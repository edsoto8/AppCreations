/**
 * In-memory Monte Carlo run state (not persisted): the latest run's quick and full results, its
 * progress and timing, and the inputs it ran with (to flag a stale result). Lives outside the page
 * so a run keeps going, and its result stays, while the person visits other pages.
 */
import { create } from 'zustand';
import type { EngineContext, Household, MonteCarloConfig } from '@rn/engine';
import {
  createDefaultPool,
  runMonteCarlo,
  type ChunkExecutor,
  type ChunkFailure,
  type MonteCarloProgress,
  type MonteCarloRun,
  type TimedResult,
} from './runner';
import { defaultConfig } from './viewModel';

export type RunStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'failed';

export interface MonteCarloRunState {
  status: RunStatus;
  profileId: string | null;
  config: MonteCarloConfig | null;
  /** The household the result was computed from (stale check). */
  household: Household | null;
  progress: MonteCarloProgress | null;
  quick: TimedResult | null;
  full: TimedResult | null;
  executors: number;
  failure: ChunkFailure | null;
  start: (args: { profileId: string; household: Household; ctx: EngineContext; config: MonteCarloConfig }) => void;
  cancel: () => void;
  reset: () => void;
}

let poolFactory: () => ChunkExecutor[] = createDefaultPool;
let pool: ChunkExecutor[] | null = null;
let current: MonteCarloRun | null = null;
let activeToken: symbol | null = null;

function getPool(): ChunkExecutor[] {
  return (pool ??= poolFactory());
}

/**
 * Paths each worker runs (and discards) to warm up: measured in Chromium, a worker's first ~2,000
 * paths run two to three times slower than later ones. A run pre-empts the warm-up.
 */
const WARM_UP_PATHS = 1000;
let warmed = false;

/**
 * Start the pool's workers ahead of the first run, once per pool: they load the worker module and
 * run a short discarded range of this plan, so the first real run is not slowed by cold code.
 */
export function prewarmMonteCarlo(household: Household, ctx: EngineContext): void {
  if (warmed) return;
  warmed = true;
  for (const e of getPool()) {
    e.warm?.({ household, ctx, config: defaultConfig(), pathStart: 0, pathEnd: WARM_UP_PATHS });
  }
}

/** Progress updates reach the store at most this often (the final update always does). */
const PROGRESS_INTERVAL_MS = 100;

/** Tests: replace the executor pool (e.g. in-process executors, or a fake pool). */
export function setExecutorPoolFactory(factory: () => ChunkExecutor[]): void {
  current?.cancel();
  current = null;
  activeToken = null;
  pool?.forEach((e) => e.dispose());
  pool = null;
  warmed = false;
  poolFactory = factory;
}

const IDLE = {
  status: 'idle' as RunStatus,
  profileId: null,
  config: null,
  household: null,
  progress: null,
  quick: null,
  full: null,
  executors: 0,
  failure: null,
};

export const useMonteCarloStore = create<MonteCarloRunState>((set, get) => ({
  ...IDLE,
  start: ({ profileId, household, ctx, config }) => {
    current?.cancel();
    const executors = getPool();
    set({
      ...IDLE,
      status: 'running',
      profileId,
      config,
      household,
      executors: executors.length,
      progress: { phase: 'quick', done: 0, total: config.paths },
    });
    // Callbacks can fire before runMonteCarlo returns, so a token (not the run) identifies this run.
    const token = Symbol('run');
    let lastProgress = -Infinity;
    let lastPhase: MonteCarloProgress['phase'] | null = null;
    activeToken = token;
    const run = runMonteCarlo({
      household,
      ctx,
      config,
      pool: executors,
      onProgress: (progress) => {
        if (activeToken !== token) return;
        const now = performance.now();
        const boundary = progress.phase !== lastPhase || progress.done >= progress.total;
        if (!boundary && now - lastProgress < PROGRESS_INTERVAL_MS) return;
        lastProgress = now;
        lastPhase = progress.phase;
        set({ progress });
      },
      onQuick: (quick) => {
        if (activeToken === token) set({ quick });
      },
    });
    current = run;
    void run.promise.then((outcome) => {
      if (activeToken !== token) return;
      activeToken = null;
      current = null;
      if (outcome.status === 'ok') set({ status: 'done', quick: outcome.quick, full: outcome.full, progress: null });
      else if (outcome.status === 'cancelled') set({ status: 'cancelled', progress: null });
      else set({ status: 'failed', failure: outcome.failure, progress: null });
    });
  },
  cancel: () => {
    if (get().status !== 'running') return;
    current?.cancel();
  },
  reset: () => {
    current?.cancel();
    current = null;
    activeToken = null;
    set({ ...IDLE });
  },
}));
