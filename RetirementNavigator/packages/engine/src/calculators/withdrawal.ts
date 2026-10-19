/**
 * Withdrawal calculator (docs/financial-model.md §12.8), two modes.
 *
 * - `fixedPercentage`: `projectHousehold` on a retired one-account household whose retirement
 *   spending is `rate × startingBalance` (today's dollars, so it rises with inflation, §5). Longevity
 *   is the projection's depletion year and age.
 * - `sustainableRate`: bisection (`searchMaximum`) over the initial withdrawal rate, each step a
 *   `projectHousehold` run of the fixed-percentage plan; the result is the highest rate whose plan
 *   meets the deterministic success criterion (§4.1: no depletion through the horizon and the
 *   minimum ending balance).
 *
 * The spending amount `rate × balance` is input construction (rounded half to even to whole cents);
 * every reported figure comes from the projection rows. No financial formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents, NominalRate } from '../domain/primitives';
import {
  AgeSchema,
  InflationRateSchema,
  NominalRateSchema,
  NonNegativeCentsSchema,
  ZERO_CENTS,
} from '../domain/primitives';
import type { EngineResult, EngineWarning } from '../domain/results';
import type { ProjectionResult } from '../domain/projection';
import { asCents, roundHalfEven } from '../money';
import {
  ExpenseRatioSchema,
  PLAN_NOISE,
  SocialSecurityAtClaimSchema,
  TaxTreatmentSchema,
  YearsSchema,
  dropWarnings,
  mapStep,
  mergeLabels,
  parseInput,
  projectInput,
  retirementPlanHousehold,
  searchMaximum,
  taxBasisOf,
  toResult,
  type CalculatorLabels,
  type SearchOutcome,
  type Step,
} from './common';

/** Fields of a retirement drawdown plan (retired from year 1, one savings account). */
export const DrawdownFields = {
  startingBalance: NonNegativeCentsSchema,
  /** Age this year; the plan runs `years` years, through age + years − 1. */
  age: AgeSchema.default(65),
  years: YearsSchema,
  annualReturn: NominalRateSchema,
  inflation: InflationRateSchema,
  taxTreatment: TaxTreatmentSchema.default('taxFree'),
  costBasis: NonNegativeCentsSchema.nullable().default(null),
  expenseRatio: ExpenseRatioSchema.default(0),
  withdrawalTiming: z.enum(['midYear', 'startOfYear']).default('midYear'),
  socialSecurity: SocialSecurityAtClaimSchema,
  minimumEndingBalance: NonNegativeCentsSchema.default(ZERO_CENTS),
};
const DrawdownObject = z.object(DrawdownFields);
export type Drawdown = z.output<typeof DrawdownObject>;

const horizonCheck = (x: { age: number; years: number }) => x.age + x.years - 1 <= 120;
const horizonIssue = { path: ['years'], message: 'The plan must end by age 120' };

export const WithdrawalInputSchema = z.discriminatedUnion('mode', [
  DrawdownObject.extend({
    mode: z.literal('fixedPercentage'),
    /** Initial withdrawal as a share of the starting balance (decimal). */
    withdrawalRate: z
      .number()
      .min(0, { message: 'Withdrawal rate cannot be negative' })
      .max(1, { message: 'Withdrawal rate must be at most 100%' }),
  }).refine(horizonCheck, horizonIssue),
  DrawdownObject.extend({
    mode: z.literal('sustainableRate'),
    /** Upper end of the rate search (decimal). */
    maxRate: z
      .number()
      .gt(0, { message: 'The search bound must be above 0%' })
      .max(1, { message: 'The search bound must be at most 100%' })
      .default(1),
  }).refine(horizonCheck, horizonIssue),
]);
export type WithdrawalInput = z.input<typeof WithdrawalInputSchema>;

/** Search tolerance on the withdrawal rate: 0.0001 percentage points. */
export const RATE_TOLERANCE = 1e-6;

export interface WithdrawalRow {
  year: number;
  age: number;
  /** Spending need that year (net need; nominal and today's dollars). */
  spendingNeed: Cents;
  spendingNeedReal: Cents;
  withdrawals: Cents;
  shortfall: Cents;
  endBalance: Cents;
  endBalanceReal: Cents;
}

export interface Longevity {
  lastsThroughHorizon: boolean;
  depletionYear: number | null;
  depletionAge: number | null;
  /** Years whose spending is fully funded before the first shortfall. */
  yearsFullyFunded: number;
}

export interface DrawdownRun {
  /** Initial annual spending (today's dollars) = rate × starting balance, whole cents. */
  annualSpending: Cents;
  success: boolean;
  longevity: Longevity;
  endingBalance: Cents;
  endingBalanceReal: Cents;
  rows: WithdrawalRow[];
}

export type WithdrawalResult = CalculatorLabels &
  (
    | ({ mode: 'fixedPercentage'; withdrawalRate: number } & DrawdownRun)
    | {
        mode: 'sustainableRate';
        /** `found`; `atBound` (even the search bound lasts); `notWithinBound` (not even 0% meets the criterion). */
        search: SearchOutcome<null>['status'];
        sustainableRate: number | null;
        /** The plan at the sustainable rate (null when no rate passes). */
        plan: DrawdownRun | null;
        tolerance: number;
        evaluations: number;
      }
  );

/** Spending for a rate on a balance: input construction (whole cents, round half to even). */
export function spendingFor(rate: number, balance: number): Cents {
  return asCents(roundHalfEven(rate * balance));
}

function drawdownRun(p: ProjectionResult, annualSpending: Cents, age: number): DrawdownRun {
  const firstYear = p.summary.firstYear;
  const rows = p.rows.map((r) => ({
    year: r.year,
    age: age + r.index - 1,
    spendingNeed: r.flows.spendingNeed,
    spendingNeedReal: r.real.spendingNeed,
    withdrawals: r.flows.withdrawals,
    shortfall: r.flows.shortfall,
    endBalance: r.totals.portfolioEnd,
    endBalanceReal: r.real.portfolioEnd,
  }));
  const depletionYear = p.summary.depletionYear;
  return {
    annualSpending,
    success: p.summary.deterministicSuccess,
    longevity: {
      lastsThroughHorizon: depletionYear === null,
      depletionYear,
      depletionAge: p.summary.depletionAge,
      yearsFullyFunded: depletionYear === null ? rows.length : depletionYear - firstYear,
    },
    endingBalance: p.summary.endingBalance,
    endingBalanceReal: p.summary.endingBalanceReal,
    rows,
  };
}

/** One projection of a drawdown plan at a given starting balance and initial spending. */
export function runDrawdown(
  x: Drawdown,
  balance: number,
  annualSpending: Cents,
  ctx: EngineContext,
): Step<{ run: DrawdownRun; projection: ProjectionResult; warnings: EngineWarning[] }> {
  const household = retirementPlanHousehold(
    {
      age: x.age,
      retirementAge: x.age,
      planningAge: x.age + x.years - 1,
      currentBalance: balance as Cents,
      annualContribution: ZERO_CENTS,
      returnBeforeRetirement: x.annualReturn,
      returnInRetirement: x.annualReturn,
      inflation: x.inflation as NominalRate,
      retirementSpending: annualSpending,
      socialSecurity: x.socialSecurity,
      taxTreatment: x.taxTreatment,
      costBasis: x.costBasis,
      expenseRatio: x.expenseRatio,
      withdrawalTiming: x.withdrawalTiming,
      minimumEndingBalance: x.minimumEndingBalance,
    },
    ctx.currentYear,
  );
  return mapStep(projectInput(household, ctx), (projected) => ({
    run: drawdownRun(projected.projection, annualSpending, x.age),
    projection: projected.projection,
    warnings: dropWarnings(projected.warnings, PLAN_NOISE),
  }));
}

export type DrawdownStep = { run: DrawdownRun; projection: ProjectionResult; warnings: EngineWarning[] };

/**
 * Highest initial withdrawal rate in [0, maxRate] whose plan meets the success criterion (bisection,
 * tolerance `RATE_TOLERANCE`). Shared with the FI number calculator.
 */
export function sustainableRateSearch(
  x: Drawdown,
  balance: number,
  maxRate: number,
  ctx: EngineContext,
): Step<SearchOutcome<DrawdownStep>> {
  return searchMaximum(0, maxRate, RATE_TOLERANCE, false, (rate) =>
    mapStep(runDrawdown(x, balance, spendingFor(rate, balance), ctx), (r) => ({ pass: r.run.success, detail: r })),
  );
}

export const DRAWDOWN_ASSUMPTIONS = [
  'Retired from this year; the initial spending rises with inflation each year (a net, after-tax need).',
  'One savings account; withdrawals mid-year by default, or at the start of the year (conservative).',
  'Success means no shortfall through the horizon and at least the minimum ending balance (today’s dollars).',
];

export function withdrawal(input: WithdrawalInput, ctx: EngineContext): EngineResult<WithdrawalResult> {
  const parsed = parseInput(WithdrawalInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  if (x.mode === 'fixedPercentage') {
    return toResult(
      mapStep(runDrawdown(x, x.startingBalance, spendingFor(x.withdrawalRate, x.startingBalance), ctx), (r) => ({
        value: {
          mode: 'fixedPercentage' as const,
          withdrawalRate: x.withdrawalRate,
          ...r.run,
          basis: { dollars: 'nominalAndTodaysDollars', tax: taxBasisOf(r.projection), limits: 'notApplicable' },
          ...mergeLabels([r.projection]),
          assumptions: DRAWDOWN_ASSUMPTIONS,
        },
        warnings: r.warnings,
      })),
    );
  }
  return toResult(
    mapStep(sustainableRateSearch(x, x.startingBalance, x.maxRate, ctx), (s) => {
      const at = s.value === null ? null : s.detail;
      // Labels come from the plan at the result, or from the 0% plan when no rate passes.
      const labelSource = s.detail.projection;
      return {
        value: {
          mode: 'sustainableRate' as const,
          search: s.status,
          sustainableRate: s.value,
          plan: at?.run ?? null,
          tolerance: RATE_TOLERANCE,
          evaluations: s.evaluations,
          basis: { dollars: 'nominalAndTodaysDollars', tax: taxBasisOf(labelSource), limits: 'notApplicable' },
          ...mergeLabels([labelSource]),
          assumptions: [
            ...DRAWDOWN_ASSUMPTIONS,
            `The sustainable rate is found by bisection between 0 and ${x.maxRate} (decimal share of the starting balance), to within 0.0001 percentage points.`,
          ],
        },
        warnings: at?.warnings ?? [],
      };
    }),
  );
}
