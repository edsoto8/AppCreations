/**
 * Employer match optimizer (docs/financial-model.md §12.3).
 *
 * Engine calls: `computeMatch` (the single `EmployerMatchRule` readout, §3.5) at the current deferral
 * rate and at each rate of a scan grid. The full-capture rate and dollars, the possible match and the
 * unclaimed match are the engine's readout; the scan reports the lowest grid rate whose match equals
 * the possible match (a cross-check of the readout). Deferral dollars for a rate are input
 * construction (rate × eligible pay, whole cents). The readout is before plan limits (402(g),
 * 401(a)(17), 415(c)); the 401(k) contribution calculator shows the after-limit match.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents, Fraction } from '../domain/primitives';
import { FractionSchema, NonNegativeCentsSchema } from '../domain/primitives';
import { EmployerMatchRuleSchema } from '../domain/household';
import type { EngineResult } from '../domain/results';
import type { MatchBreakdown } from '../api';
import { computeMatch } from '../match/match';
import { asCents, roundHalfEven } from '../money';
import { parseInput, type CalculatorLabels } from './common';

export const MatchOptimizerInputSchema = z
  .object({
    /** Eligible pay for the match this year (nominal). */
    eligiblePay: NonNegativeCentsSchema,
    match: EmployerMatchRuleSchema,
    /** Current employee deferral as a share of eligible pay. */
    currentDeferralRate: FractionSchema,
    /** Scan grid step and end (shares of pay). */
    scanStep: z
      .number()
      .gt(0, { message: 'Step must be above 0%' })
      .max(0.1, { message: 'Step must be at most 10%' })
      .default(0.005),
    scanTo: FractionSchema.default(0.2),
  })
  .refine((x) => x.scanTo >= x.scanStep, { path: ['scanTo'], message: 'The scan must cover at least one step' });
export type MatchOptimizerInput = z.input<typeof MatchOptimizerInputSchema>;

export interface MatchScanRow {
  deferralRate: number;
  deferral: Cents;
  match: Cents;
  flat: Cents;
  total: Cents;
}

export interface MatchOptimizerResult extends CalculatorLabels {
  current: { deferralRate: number; deferral: Cents; readout: MatchBreakdown };
  /** Engine readout: lowest deferral rate (and dollars) capturing the full match. */
  pctToCaptureFullMatch: Fraction;
  dollarsToCaptureFullMatch: Cents;
  maxPossibleMatch: Cents;
  /** Match left on the table per year at the current rate. */
  unclaimedAtCurrentRate: Cents;
  /** Extra deferral dollars per year to reach the full-capture point (0 when already there). */
  additionalDeferralNeeded: Cents;
  scan: MatchScanRow[];
  /** Lowest scanned rate whose match equals the possible match; null if none in the scan. */
  lowestScannedFullCaptureRate: number | null;
}

const deferralAt = (rate: number, pay: number) => asCents(roundHalfEven(rate * pay));

export function matchOptimizer(input: MatchOptimizerInput, _ctx: EngineContext): EngineResult<MatchOptimizerResult> {
  const parsed = parseInput(MatchOptimizerInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const currentDeferral = deferralAt(x.currentDeferralRate, x.eligiblePay);
  const readout = computeMatch(x.match, x.eligiblePay, currentDeferral);
  const scan: MatchScanRow[] = [];
  for (let k = 0; k * x.scanStep <= x.scanTo + 1e-12; k++) {
    // Grid rates as k·step, snapped to 1e-9 against float noise (scan control logic).
    const rate = roundHalfEven(k * x.scanStep * 1e9) / 1e9;
    const deferral = deferralAt(rate, x.eligiblePay);
    const m = computeMatch(x.match, x.eligiblePay, deferral);
    scan.push({ deferralRate: rate, deferral, match: m.match, flat: m.flat, total: m.total });
  }
  const full = scan.find((r) => readout.maxPossibleMatch > 0 && r.match >= readout.maxPossibleMatch);
  return {
    status: 'ok',
    value: {
      current: { deferralRate: x.currentDeferralRate, deferral: currentDeferral, readout },
      pctToCaptureFullMatch: readout.pctToCaptureFullMatch,
      dollarsToCaptureFullMatch: readout.dollarsToCaptureFullMatch,
      maxPossibleMatch: readout.maxPossibleMatch,
      unclaimedAtCurrentRate: readout.unclaimed,
      additionalDeferralNeeded: asCents(Math.max(0, readout.dollarsToCaptureFullMatch - currentDeferral)),
      scan,
      lowestScannedFullCaptureRate: full?.deferralRate ?? null,
      basis: { dollars: 'nominal', tax: 'beforeTaxes', limits: 'beforeLimits' },
      excludedFeatures: [],
      unverified: [],
      assumptions: [
        'Before plan limits: the deferral limit, the compensation limit and the annual additions limit are not applied here.',
        'The match is computed on the year’s eligible pay with an annual true-up (plan-specific true-up rules are not modeled).',
      ],
    },
    warnings: [],
  };
}
