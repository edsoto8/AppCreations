/**
 * Compound interest calculator (docs/financial-model.md §12.1).
 *
 * Engine calls: `projectHousehold` (via `projectInput`) on a one-account growth household built by
 * `growthHousehold`. Every figure is read from the projection rows: start and end balances,
 * contributions, growth after fees, fee drag and the real (today's dollars) year-end balance.
 * No formula is computed here; totals are sums of the rows' cents.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents, NominalRate } from '../domain/primitives';
import { InflationRateSchema, NominalRateSchema, NonNegativeCentsSchema, ZERO_CENTS } from '../domain/primitives';
import type { EngineResult, EngineWarning } from '../domain/results';
import {
  ExpenseRatioSchema,
  GROWTH_NOISE,
  YearsSchema,
  dropWarnings,
  growthHousehold,
  growthRows,
  lastOf,
  mapStep,
  mergeLabels,
  parseInput,
  projectInput,
  sumOf,
  toResult,
  type CalculatorLabels,
  type GrowthRow,
  type Step,
} from './common';

export const CompoundInterestInputSchema = z.object({
  /** Starting balance (today = year 1, nominal = today's dollars). */
  principal: NonNegativeCentsSchema,
  /** Contribution per year, made evenly through the year (mid-year growth, §1.5). Nominal. */
  annualContribution: NonNegativeCentsSchema.default(ZERO_CENTS),
  /** Annual growth of the contribution (decimal; 0 = flat). */
  contributionGrowth: NominalRateSchema.default(0 as NominalRate),
  /** Nominal annual return (decimal, geometric). */
  annualReturn: NominalRateSchema,
  years: YearsSchema,
  /** Used only for the today's-dollar columns. */
  inflation: InflationRateSchema.default(0 as NominalRate),
  expenseRatio: ExpenseRatioSchema.default(0),
});
export type CompoundInterestInput = z.input<typeof CompoundInterestInputSchema>;

export interface GrowthTotals {
  endingBalance: Cents;
  endingBalanceReal: Cents;
  totalContributions: Cents;
  /** Growth after fees over the horizon: endingBalance = principal + totalContributions + totalGrowth. */
  totalGrowth: Cents;
  totalFeeDrag: Cents;
}

export interface CompoundInterestResult extends CalculatorLabels {
  rows: GrowthRow[];
  totals: GrowthTotals;
}

export interface GrowthRun {
  rows: GrowthRow[];
  totals: GrowthTotals;
  labels: ReturnType<typeof mergeLabels>;
  warnings: EngineWarning[];
}

/** Shared by the fee-impact and lump-sum calculators: one growth projection, rows and totals. */
export function runGrowth(
  input: z.output<typeof CompoundInterestInputSchema> & { contributionYears?: number },
  ctx: EngineContext,
): Step<GrowthRun> {
  const projected = projectInput(
    growthHousehold(ctx.currentYear, {
      years: input.years,
      balance: input.principal,
      annualContribution: input.annualContribution,
      contributionGrowth: input.contributionGrowth,
      contributionYears: input.contributionYears,
      annualReturn: input.annualReturn,
      inflation: input.inflation,
      expenseRatio: input.expenseRatio,
    }),
    ctx,
  );
  return mapStep(projected, (p) => {
    const rows = growthRows(p.projection.rows, input.years);
    // years ≥ 1 (schema), so the projection has at least one growth row.
    const last = lastOf(rows);
    return {
      rows,
      totals: {
        endingBalance: last.endBalance,
        endingBalanceReal: last.endBalanceReal,
        totalContributions: sumOf(rows.map((r) => r.contributions)),
        totalGrowth: sumOf(rows.map((r) => r.growth)),
        totalFeeDrag: sumOf(rows.map((r) => r.feeDrag)),
      },
      labels: mergeLabels([p.projection]),
      warnings: dropWarnings(p.warnings, GROWTH_NOISE),
    };
  });
}

export const GROWTH_ASSUMPTIONS = [
  'One account; the return is applied every year, net of the expense ratio: (1 + r)(1 − f) − 1.',
  'Contributions are made evenly through the year, so each year’s contribution earns half a year of growth.',
  'No taxes on growth, no withdrawals.',
  'Today’s-dollar figures divide by the price level of each year (year 1 = 1).',
];

export function compoundInterest(
  input: CompoundInterestInput,
  ctx: EngineContext,
): EngineResult<CompoundInterestResult> {
  const parsed = parseInput(CompoundInterestInputSchema, input);
  if (!parsed.ok) return parsed.result;
  return toResult(
    mapStep(runGrowth(parsed.value, ctx), (run) => ({
      value: {
        rows: run.rows,
        totals: run.totals,
        basis: { dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' },
        ...run.labels,
        assumptions: GROWTH_ASSUMPTIONS,
      },
      warnings: run.warnings,
    })),
  );
}
