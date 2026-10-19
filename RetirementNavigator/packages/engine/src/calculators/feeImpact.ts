/**
 * Fee impact calculator (docs/financial-model.md §12.10).
 *
 * Engine calls: `projectHousehold` twice (via `runGrowth`): the same one-account growth household with
 * the expense ratio f and with 0. The lifetime cost of fees is the difference of the two engine ending
 * balances; the fee drag column is the projection's own `feeDrag` (§4). No formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents, NominalRate } from '../domain/primitives';
import { InflationRateSchema, NominalRateSchema, NonNegativeCentsSchema, ZERO_CENTS } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import { GROWTH_ASSUMPTIONS, runGrowth, type GrowthTotals } from './compoundInterest';
import {
  ExpenseRatioSchema,
  YearsSchema,
  all,
  itemAt,
  mapStep,
  parseInput,
  sumOf,
  toResult,
  type CalculatorLabels,
} from './common';

export const FeeImpactInputSchema = z.object({
  principal: NonNegativeCentsSchema,
  annualContribution: NonNegativeCentsSchema.default(ZERO_CENTS),
  contributionGrowth: NominalRateSchema.default(0 as NominalRate),
  /** Nominal annual return before fees. */
  annualReturn: NominalRateSchema,
  /** Annual expense ratio (decimal), modeled as return drag. */
  expenseRatio: ExpenseRatioSchema,
  years: YearsSchema,
  inflation: InflationRateSchema.default(0 as NominalRate),
});
export type FeeImpactInput = z.input<typeof FeeImpactInputSchema>;

export interface FeeImpactRow {
  year: number;
  balanceWithFees: Cents;
  balanceWithoutFees: Cents;
  /** balanceWithoutFees − balanceWithFees at year end (nominal). */
  cumulativeCost: Cents;
  /** Fee drag charged this year (the projection's fee shadow figure). */
  feeDrag: Cents;
}

export interface FeeImpactResult extends CalculatorLabels {
  withFees: GrowthTotals;
  withoutFees: GrowthTotals;
  /** Ending balance without fees minus with fees: fees plus the growth they would have earned. */
  lifetimeCost: Cents;
  lifetimeCostReal: Cents;
  /** Σ yearly fee drag (fees charged, excluding the growth they would have earned). */
  feesCharged: Cents;
  rows: FeeImpactRow[];
}

export function feeImpact(input: FeeImpactInput, ctx: EngineContext): EngineResult<FeeImpactResult> {
  const parsed = parseInput(FeeImpactInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const runs = all(runGrowth(parsed.value, ctx), runGrowth({ ...parsed.value, expenseRatio: 0 }, ctx));
  return toResult(
    mapStep(runs, ([a, b]) => {
      const rows = a.rows.map((row, k) => {
        const free = itemAt(b.rows, k).endBalance; // same horizon: rows align
        return {
          year: row.year,
          balanceWithFees: row.endBalance,
          balanceWithoutFees: free,
          cumulativeCost: (free - row.endBalance) as Cents,
          feeDrag: row.feeDrag,
        };
      });
      return {
        value: {
          withFees: a.totals,
          withoutFees: b.totals,
          lifetimeCost: (b.totals.endingBalance - a.totals.endingBalance) as Cents,
          lifetimeCostReal: (b.totals.endingBalanceReal - a.totals.endingBalanceReal) as Cents,
          feesCharged: sumOf(a.rows.map((r) => r.feeDrag)),
          rows,
          basis: { dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' },
          ...a.labels,
          assumptions: [
            ...GROWTH_ASSUMPTIONS,
            'The comparison runs the same plan twice, with the expense ratio and with none; everything else is identical.',
          ],
        },
        warnings: a.warnings,
      };
    }),
  );
}
