/**
 * Monte Carlo configuration and output. Lognormal annual returns; user-entered expected returns are
 * GEOMETRIC (median). Path i draws from a PRNG stream derived from hash(seed, i), so results do not
 * depend on chunking or worker count, and the 1,000-path quick run equals paths 0..999 of a full run.
 *
 * Outputs are model-dependent estimates, not guarantees. Percentile bands are NOT confidence intervals.
 */
import { z } from 'zod';
import { CalendarYearSchema, CentsSchema } from './primitives';

export const AssetClassSchema = z.enum(['stocks', 'bonds', 'cash']);
export type AssetClass = z.infer<typeof AssetClassSchema>;

/**
 * Per-path model (docs/financial-model.md §11): each account's annual log return is
 * N(ln(1 + g_a), σ_a²) where g_a is the SAME expected return the deterministic projection uses and
 * σ_a² = wᵀ Σ w from the account allocation and the capital-market assumptions (blended fallback
 * volatility for accounts without an allocation). Hence at σ = 0 every path equals the baseline.
 */
export const MonteCarloConfigSchema = z.object({
  paths: z.number().int().min(1000).max(10_000),
  /** Quick run size; returned first, then refined to `paths`. */
  quickRunPaths: z.number().int().min(100).max(1000).default(1000),
  seed: z.number().int().min(0).max(0xffff_ffff),
  inflation: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed') }),
    z.object({
      mode: z.literal('stochastic'),
      /** Mean (median) annual inflation and volatility; correlation with [stocks, bonds, cash]. */
      median: z.number().min(-0.05).max(0.2),
      volatility: z.number().min(0).max(0.2),
      correlationWithAssets: z.array(z.number().min(-1).max(1)).length(3),
    }),
  ]),
  rebalancing: z.enum(['annual']).default('annual'),
});
export type MonteCarloConfig = z.infer<typeof MonteCarloConfigSchema>;

export const PercentileBandSchema = z.object({
  year: CalendarYearSchema,
  p10: CentsSchema,
  p25: CentsSchema,
  p50: CentsSchema,
  p75: CentsSchema,
  p90: CentsSchema,
});
export type PercentileBand = z.infer<typeof PercentileBandSchema>;

export const MonteCarloResultSchema = z.object({
  contractVersion: z.string(),
  paths: z.number().int(),
  seed: z.number().int(),
  algorithm: z.literal('xoshiro128**/splitmix32(hash32(seed,path))/box-muller'),
  /** Share of paths funding modeled spending through planning age with ending balance ≥ minimum. */
  successRate: z.number().min(0).max(1),
  ending: z.object({ p10: CentsSchema, p50: CentsSchema, p90: CentsSchema, mean: CentsSchema }),
  endingReal: z.object({ p10: CentsSchema, p50: CentsSchema, p90: CentsSchema }),
  /** Year-by-year bands, nominal; real bands use each path's own deflator (stochastic inflation). */
  bands: z.array(PercentileBandSchema),
  bandsReal: z.array(PercentileBandSchema),
  /** Ending-balance histogram (real dollars). */
  histogram: z.array(z.object({ from: CentsSchema, to: CentsSchema, count: z.number().int() })),
  depletionAgeCounts: z.array(z.object({ age: z.number().int(), count: z.number().int() })),
  /** Arithmetic means implied by the geometric inputs, shown in the UI. */
  impliedArithmeticMeans: z.object({ stocks: z.number(), bonds: z.number(), cash: z.number() }),
  label: z.literal('Model-dependent estimate, not a guarantee.'),
  assumptions: z.array(z.string()),
});
export type MonteCarloResult = z.infer<typeof MonteCarloResultSchema>;

/** Raw per-path output for a contiguous path range (merged by `summarizeMonteCarlo`). Not persisted. */
export interface MonteCarloChunk {
  pathStart: number;
  pathEnd: number; // exclusive
  years: number;
  /** [path][year] row-major, nominal dollars (float64). */
  balances: Float64Array;
  /** [path][year] row-major, real dollars using that path's deflator. */
  balancesReal: Float64Array;
  success: Uint8Array;
  /** Primary person's age at depletion, or -1. */
  depletionAge: Int16Array;
}
