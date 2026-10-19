/**
 * Lump sum vs recurring calculator (docs/financial-model.md §12.11).
 *
 * Engine calls: `projectHousehold` twice (via `runGrowth`) on the one-account growth household:
 * (a) the whole amount as the starting balance, (b) a zero starting balance and an equal annual
 * contribution for `spreadYears` years (mid-year, §1.5), both grown to the same horizon. The equal
 * annual amount is the total split into `spreadYears` whole-cent payments (input construction,
 * round half to even); the amount actually invested is read back as the sum of the projection's
 * contributions. Differences are of engine ending balances.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents, NominalRate } from '../domain/primitives';
import { InflationRateSchema, NominalRateSchema, NonNegativeCentsSchema } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import { asCents, roundHalfEven } from '../money';
import { GROWTH_ASSUMPTIONS, runGrowth, type GrowthTotals } from './compoundInterest';
import { ExpenseRatioSchema, YearsSchema, parseInput, type CalculatorLabels } from './common';

export const LumpSumVsRecurringInputSchema = z
  .object({
    /** Amount available to invest (nominal). */
    total: NonNegativeCentsSchema,
    /** Recurring alternative: the same total invested in equal amounts over this many years. */
    spreadYears: YearsSchema,
    /** Both alternatives are compared at the end of this many years (≥ spreadYears). */
    horizonYears: YearsSchema,
    annualReturn: NominalRateSchema,
    inflation: InflationRateSchema.default(0 as NominalRate),
    expenseRatio: ExpenseRatioSchema.default(0),
  })
  .refine((x) => x.horizonYears >= x.spreadYears, {
    path: ['horizonYears'],
    message: 'The horizon must be at least as long as the period the money is spread over',
  });
export type LumpSumVsRecurringInput = z.input<typeof LumpSumVsRecurringInputSchema>;

export interface LumpSumVsRecurringResult extends CalculatorLabels {
  /** Annual amount of the recurring alternative (whole cents). */
  recurringAnnualAmount: Cents;
  lumpSum: GrowthTotals;
  recurring: GrowthTotals;
  /** lumpSum − recurring ending balance (nominal and today's dollars). */
  difference: Cents;
  differenceReal: Cents;
  rows: { year: number; lumpSumBalance: Cents; recurringBalance: Cents }[];
}

export function lumpSumVsRecurring(
  input: LumpSumVsRecurringInput,
  ctx: EngineContext,
): EngineResult<LumpSumVsRecurringResult> {
  const parsed = parseInput(LumpSumVsRecurringInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const common = {
    years: x.horizonYears,
    annualReturn: x.annualReturn,
    inflation: x.inflation,
    expenseRatio: x.expenseRatio,
    contributionGrowth: 0 as NominalRate,
  };
  // Input construction: the total in `spreadYears` equal whole-cent payments.
  const annual = asCents(roundHalfEven(x.total / x.spreadYears));
  const lump = runGrowth({ ...common, principal: x.total, annualContribution: 0 as Cents }, ctx);
  if (!lump.ok) return lump.result;
  const recurring = runGrowth(
    { ...common, principal: 0 as Cents, annualContribution: annual, contributionYears: x.spreadYears },
    ctx,
  );
  if (!recurring.ok) return recurring.result;
  const a = lump.value;
  const b = recurring.value;
  return {
    status: 'ok',
    value: {
      recurringAnnualAmount: annual,
      lumpSum: a.totals,
      recurring: b.totals,
      difference: (a.totals.endingBalance - b.totals.endingBalance) as Cents,
      differenceReal: (a.totals.endingBalanceReal - b.totals.endingBalanceReal) as Cents,
      rows: a.rows.map((row, k) => ({
        year: row.year,
        lumpSumBalance: row.endBalance,
        recurringBalance: b.rows[k]?.endBalance ?? (0 as Cents),
      })),
      basis: { dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' },
      ...a.labels,
      assumptions: [
        ...GROWTH_ASSUMPTIONS,
        'The lump sum is invested at the start of year 1; the recurring amounts are invested evenly through each year of the spread period.',
        'Money waiting to be invested in the recurring case is not modeled (it earns nothing in this comparison).',
      ],
    },
    warnings: a.warnings,
  };
}
