/**
 * Monte Carlo paths (docs/financial-model.md §11). Each path draws correlated lognormal account
 * returns (and, optionally, inflation) and runs the same projection as the deterministic forecast
 * (withdrawals, gross-up and taxes) through `returnOverride` / `inflationOverride`.
 *
 * - The median of each account's return in a year is the return the deterministic baseline applies
 *   to it that year (expected return, phase, market shock), so with zero volatility every path equals
 *   the baseline.
 * - Asset-class shocks are standard normals correlated through the Cholesky factor of the
 *   correlation matrix; an account's log-return shock is Σ_k w_k·σ_k·e_k, whose variance is wᵀΣw.
 *   An account without an allocation moves with the stock shock at the blended volatility
 *   (simplification, documented).
 * - Every year draws the same number of normals (3, or 4 with stochastic inflation), so a path's
 *   numbers depend only on (seed, path index).
 */
import type { Household } from '../domain/household';
import { HouseholdSchema } from '../domain/household';
import type { EngineResult, ValidationIssue } from '../domain/results';
import type { CalendarYear } from '../domain/primitives';
import {
  MonteCarloConfigSchema,
  type MonteCarloChunk,
  type MonteCarloConfig,
  type MonteCarloResult,
} from '../domain/montecarlo';
import type { EngineContext } from '../api';
import { zodIssues } from '../validation';
import { createProjectionCache, projectWithCache } from '../projection/project';
import { Stream, cholesky } from './random';
import { summarize } from './summary';

const ASSETS = ['stocks', 'bonds', 'cash'] as const;
const ASSET_LABEL = { stocks: 'Stocks', bonds: 'Bonds', cash: 'Cash' } as const;

interface Prepared {
  household: Household;
  ctx: EngineContext;
  cache: ReturnType<typeof createProjectionCache>;
  years: number;
  accountIds: string[];
  /** Median log return per [year][account]: ln(1 + baseline applied return). */
  medianLog: Float64Array;
  /** Loading of each account on each asset-class shock: [account][asset] = w·σ. */
  loadings: Float64Array;
  /** Cholesky factor (d × d, row-major) of the correlation matrix; d = 3 or 4. */
  chol: Float64Array;
  dims: number;
  inflation: { medianLog: number; volatility: number } | null;
}

function invalid(issues: ValidationIssue[]): EngineResult<never> {
  return { status: 'invalid', issues };
}

function prepare(input: Household, ctx: EngineContext, configInput: MonteCarloConfig): EngineResult<Prepared> {
  const config = MonteCarloConfigSchema.safeParse(configInput);
  if (!config.success) return invalid(zodIssues(config.error).map((i) => ({ ...i, path: ['config', ...i.path] })));
  const parsed = HouseholdSchema.safeParse(input);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  // Monte Carlo is annual (monthly mode is deterministic only).
  const household: Household = { ...parsed.data, assumptions: { ...parsed.data.assumptions, granularity: 'annual' } };
  const cma = household.assumptions.capitalMarket;

  // Correlation matrix [stocks, bonds, cash(, inflation)] and its PSD check.
  const stochastic = config.data.inflation.mode === 'stochastic' ? config.data.inflation : null;
  const matrix = cma.correlation.map((row, i) =>
    stochastic ? [...row, stochastic.correlationWithAssets[i] ?? 0] : [...row],
  );
  if (stochastic) matrix.push([...stochastic.correlationWithAssets, 1]);
  const L = cholesky(matrix);
  if (L === null) {
    return invalid([
      {
        path: stochastic
          ? ['config', 'inflation', 'correlationWithAssets']
          : ['assumptions', 'capitalMarket', 'correlation'],
        message:
          'The correlation matrix is not positive semi-definite, so no set of returns can have these correlations',
      },
    ]);
  }
  const dims = matrix.length;
  const chol = new Float64Array(dims * dims);
  L.forEach((row, i) => row.forEach((v, j) => (chol[i * dims + j] = v)));

  // The deterministic baseline gives each account's median return per year.
  const cache = createProjectionCache();
  const baseline = projectWithCache(household, ctx, {}, cache);
  if (baseline.status !== 'ok') return baseline;
  const rows = baseline.value.rows;
  const years = rows.length;
  const accountIds = household.accounts.map((a) => a.id);
  const medianLog = new Float64Array(years * accountIds.length);
  rows.forEach((row, t) => {
    const byId = new Map(row.accounts.map((a) => [a.accountId as string, a.appliedReturn]));
    accountIds.forEach((id, k) => (medianLog[t * accountIds.length + k] = Math.log(1 + (byId.get(id) ?? 0))));
  });
  const loadings = new Float64Array(accountIds.length * 3);
  household.accounts.forEach((account, k) => {
    if (account.allocation) {
      ASSETS.forEach((asset, j) => (loadings[k * 3 + j] = (account.allocation?.[asset] ?? 0) * cma[asset].volatility));
    } else {
      loadings[k * 3] = cma.blendedVolatility; // moves with the stock shock (documented)
    }
  });
  return {
    status: 'ok',
    value: {
      household,
      ctx,
      cache,
      years,
      accountIds,
      medianLog,
      loadings,
      chol,
      dims,
      inflation: stochastic ? { medianLog: Math.log(1 + stochastic.median), volatility: stochastic.volatility } : null,
    },
    warnings: [],
  };
}

/** One path's account returns [year][account] and inflation per year (NaN = the assumption). */
function drawPath(p: Prepared, seed: number, path: number, returns: Float64Array, inflation: Float64Array) {
  const stream = new Stream(seed, path);
  const { dims, chol, loadings, medianLog, years } = p;
  const nA = p.accountIds.length;
  const z = new Float64Array(dims);
  const e = new Float64Array(dims);
  for (let t = 0; t < years; t++) {
    for (let i = 0; i < dims; i++) z[i] = stream.normal();
    for (let i = 0; i < dims; i++) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += (chol[i * dims + j] ?? 0) * (z[j] ?? 0);
      e[i] = sum;
    }
    for (let k = 0; k < nA; k++) {
      const shock =
        (loadings[k * 3] ?? 0) * (e[0] ?? 0) +
        (loadings[k * 3 + 1] ?? 0) * (e[1] ?? 0) +
        (loadings[k * 3 + 2] ?? 0) * (e[2] ?? 0);
      returns[t * nA + k] = Math.exp((medianLog[t * nA + k] ?? 0) + shock) - 1;
    }
    inflation[t] = p.inflation ? Math.exp(p.inflation.medianLog + p.inflation.volatility * (e[3] ?? 0)) - 1 : NaN;
  }
}

/** Run paths [pathStart, pathEnd). Pure; chunks from different workers merge identically. */
export function runMonteCarloChunk(
  household: Household,
  ctx: EngineContext,
  config: MonteCarloConfig,
  range: { pathStart: number; pathEnd: number },
): EngineResult<MonteCarloChunk> {
  const { pathStart, pathEnd } = range;
  if (!Number.isInteger(pathStart) || !Number.isInteger(pathEnd) || pathStart < 0 || pathEnd <= pathStart) {
    return invalid([{ path: ['range'], message: 'The path range must be whole numbers with start < end' }]);
  }
  if (pathEnd > 10_000) return invalid([{ path: ['range', 'pathEnd'], message: 'At most 10,000 paths' }]);
  const prepared = prepare(household, ctx, config);
  if (prepared.status !== 'ok') return prepared;
  const p = prepared.value;
  const n = pathEnd - pathStart;
  const years = p.years;
  const nA = p.accountIds.length;
  const index = new Map(p.accountIds.map((id, k) => [id, k]));
  const balances = new Float64Array(n * years);
  const balancesReal = new Float64Array(n * years);
  const success = new Uint8Array(n);
  const depletionAge = new Int16Array(n);
  const returns = new Float64Array(years * nA);
  const inflation = new Float64Array(years);
  const options = {
    returnOverride: (t: number, accountId: string) => returns[(t - 1) * nA + (index.get(accountId) ?? 0)],
    inflationOverride: p.inflation ? (t: number) => inflation[t - 1] : undefined,
  };
  for (let i = 0; i < n; i++) {
    drawPath(p, config.seed, pathStart + i, returns, inflation);
    const r = projectWithCache(p.household, p.ctx, options, p.cache);
    if (r.status !== 'ok') return r;
    const rows = r.value.rows;
    for (let y = 0; y < years; y++) {
      const row = rows[y];
      balances[i * years + y] = (row?.totals.portfolioEnd ?? 0) / 100;
      balancesReal[i * years + y] = (row?.real.portfolioEnd ?? 0) / 100;
    }
    success[i] = r.value.summary.deterministicSuccess ? 1 : 0;
    depletionAge[i] = r.value.summary.depletionAge ?? -1;
  }
  return {
    status: 'ok',
    value: { pathStart, pathEnd, years, balances, balancesReal, success, depletionAge },
    warnings: [],
  };
}

/** Arithmetic mean implied by each asset class's geometric (median) return: (1 + g)·e^{σ²/2} − 1 (§11). */
export function impliedArithmeticMeans(
  cma: Household['assumptions']['capitalMarket'],
): MonteCarloResult['impliedArithmeticMeans'] {
  const mean = (asset: (typeof ASSETS)[number]) =>
    (1 + cma[asset].geometricReturn) * Math.exp((cma[asset].volatility * cma[asset].volatility) / 2) - 1;
  return { stocks: mean('stocks'), bonds: mean('bonds'), cash: mean('cash') };
}

/**
 * Readiness band for a Monte Carlo success rate (§8, a labeled heuristic shown beside the
 * deterministic readiness): ≥ 85% on track, 70–85% borderline, below 70% at risk.
 */
export function monteCarloReadiness(successRate: number): 'onTrack' | 'borderline' | 'atRisk' {
  if (successRate >= 0.85) return 'onTrack';
  if (successRate >= 0.7) return 'borderline';
  return 'atRisk';
}

/** Merge chunks into the result, with the assumptions shown beside every success rate. */
export function summarizeMonteCarlo(
  chunks: MonteCarloChunk[],
  config: MonteCarloConfig,
  household: Household,
  firstYear: CalendarYear,
): MonteCarloResult {
  const a = household.assumptions;
  const cma = a.capitalMarket;
  const means = impliedArithmeticMeans(cma);
  const arithmetic = (asset: (typeof ASSETS)[number]) => means[asset];
  // Display only: one decimal of a percentage.
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const assumptions = [
    `${config.paths.toLocaleString('en-US')} paths, seed ${config.seed}; lognormal annual returns, independent across years.`,
    ...ASSETS.map(
      (asset) =>
        `${ASSET_LABEL[asset]}: median ${pct(cma[asset].geometricReturn)} a year, volatility ${pct(cma[asset].volatility)} (arithmetic mean ${pct(arithmetic(asset))}).`,
    ),
    `Accounts without an allocation: their expected return with ${pct(cma.blendedVolatility)} volatility, moving with stocks.`,
    config.inflation.mode === 'stochastic'
      ? `Inflation: stochastic, median ${pct(config.inflation.median)}, volatility ${pct(config.inflation.volatility)}.`
      : `Inflation: fixed at ${pct(a.inflation)} a year.`,
    'Rebalanced every year to each account’s target allocation. Withdrawals and taxes in every path use the same rules as the deterministic forecast.',
    `Success: no depletion before the planning age and an ending balance of at least ${(a.minimumEndingBalance / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} in today’s dollars.`,
    `Capital-market assumptions: ${cma.note}`,
    'Not modeled: fat tails, mean reversion, regime changes.',
  ];
  return summarize(chunks, config, firstYear, {
    impliedArithmeticMeans: means,
    assumptions,
    minimumEndingReal: a.minimumEndingBalance / 100,
  });
}
