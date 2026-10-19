/**
 * Inflation purchasing power calculator (docs/financial-model.md §12.7).
 *
 * Engine calls: `projectHousehold` on a household built only to convert dollars with the engine's
 * own price index (§1.1, P_t; the row `deflator`):
 * - a retirement spending need of `amount` (today's dollars) gives, per year, the nominal cost of
 *   today's amount (`flows.spendingNeed` = amount · P_t, computed by the projection);
 * - a flat nominal pension of `futureAmount` (no COLA, in payment from year 1) gives, per year, what
 *   that fixed nominal amount is worth in today's dollars (`real.grossIncome` = futureAmount / P_t).
 * The household has no accounts; its funding (shortfalls, excess income) is irrelevant and its
 * warnings are not reported. No formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents } from '../domain/primitives';
import { InflationRateSchema, NonNegativeCentsSchema } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import type { HouseholdInput } from '../domain/household';
import {
  CALC_IDS,
  YearsSchema,
  assumptionsTemplate,
  lastOf,
  mapStep,
  parseInput,
  projectInput,
  toResult,
  type CalculatorLabels,
} from './common';

export const InflationPurchasingPowerInputSchema = z.object({
  /** An amount in today's dollars. */
  amount: NonNegativeCentsSchema,
  /** A fixed nominal amount received in the future; null = the same number as `amount`. */
  futureAmount: NonNegativeCentsSchema.nullable().default(null),
  years: YearsSchema,
  /** Constant annual inflation (decimal). */
  inflation: InflationRateSchema,
});
export type InflationPurchasingPowerInput = z.input<typeof InflationPurchasingPowerInputSchema>;

export interface PurchasingPowerRow {
  /** Years from now (0 = today, year 1). */
  yearsFromNow: number;
  year: number;
  /** Price level relative to today (P_t). */
  priceLevel: number;
  /** Nominal dollars needed that year to buy what `amount` buys today. */
  costOfTodaysAmount: Cents;
  /** Today's-dollar value of `futureAmount` received that year. */
  todaysValueOfFutureAmount: Cents;
}

export interface InflationPurchasingPowerResult extends CalculatorLabels {
  /** Nominal cost, `years` from now, of what `amount` buys today. */
  futureCost: Cents;
  /** Today's-dollar value of `futureAmount` received `years` from now. */
  todaysValue: Cents;
  /** Price level `years` from now relative to today. */
  priceLevel: number;
  rows: PurchasingPowerRow[];
}

export function inflationPurchasingPower(
  input: InflationPurchasingPowerInput,
  ctx: EngineContext,
): EngineResult<InflationPurchasingPowerResult> {
  const parsed = parseInput(InflationPurchasingPowerInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const future = x.futureAmount ?? x.amount;
  // A retired person (age 20) whose plan spans years 0..n from now; the age only sets the horizon.
  const age = 20;
  const household: HouseholdInput = {
    id: 'calc-household',
    name: 'Calculator',
    filingStatus: 'single',
    people: [
      {
        id: CALC_IDS.person,
        name: 'You',
        birthYear: ctx.currentYear - age,
        retirementAge: age,
        planningAge: age + x.years,
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    pensions: [
      {
        id: 'calc-fixed-amount',
        name: 'Fixed nominal amount',
        ownerId: CALC_IDS.person,
        startAge: age,
        annualAmount: future,
        amountBasis: 'nominalAtStart',
        cola: { mode: 'flat' },
        taxableFraction: 0,
        payout: { kind: 'annuity' },
      },
    ],
    spending: { currentAnnualSpending: 0, retirementAnnualSpending: x.amount },
    assumptions: assumptionsTemplate(ctx.currentYear, {
      inflation: x.inflation,
      returnPreRetirement: 0,
      returnPostRetirement: 0,
    }),
  };
  return toResult(
    mapStep(projectInput(household, ctx), (projected) => {
      const rows = projected.projection.rows.map((r, k) => ({
        yearsFromNow: k,
        year: r.year,
        priceLevel: r.deflator,
        costOfTodaysAmount: r.flows.spendingNeed,
        todaysValueOfFutureAmount: r.real.grossIncome,
      }));
      // years ≥ 1 (schema): rows 0..years.
      const last = lastOf(rows);
      return {
        value: {
          futureCost: last.costOfTodaysAmount,
          todaysValue: last.todaysValueOfFutureAmount,
          priceLevel: last.priceLevel,
          rows,
          basis: { dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' },
          // The conversion needs no rule value; the projection's tax labels do not apply to these figures.
          excludedFeatures: [],
          unverified: [],
          assumptions: [
            'Constant inflation; the price level n years from now is the engine’s price index for that year (today = 1).',
            'Today’s dollars are this year’s dollars.',
          ],
        },
        warnings: [],
      };
    }),
  );
}
