/**
 * Barista FIRE calculator (docs/financial-model.md §12.14).
 *
 * Engine calls: `projectHousehold` on the one-person plan household (`retirementPlanHousehold`) with
 * a part-time phase (§3.1: today's dollars, rising with inflation, between the start and end ages).
 * In the retirement phase the part-time pay is cash income that funds spending before any withdrawal
 * (§4.1, §7.1). A bisection (`searchMinimum`, integer cents, tolerance $1) over the part-time income
 * finds the smallest amount that lets the plan meet the deterministic success criterion. No formula
 * is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents } from '../domain/primitives';
import { AgeSchema, NonNegativeCentsSchema } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import {
  PLAN_NOISE,
  RetirementPlanFields,
  all,
  checkPlan,
  dropWarnings,
  itemAt,
  mapStep,
  mergeLabels,
  outcomeOf,
  parseInput,
  projectInput,
  retirementPlanHousehold,
  searchMinimum,
  successStep,
  sumOf,
  taxBasisOf,
  toResult,
  type CalculatorLabels,
  type PlanOutcome,
  type Projected,
  type SearchOutcome,
} from './common';

/** Default search bound for the part-time income: $500,000 a year. */
export const DEFAULT_MAX_PART_TIME = 50_000_000;
export const INCOME_TOLERANCE = 100;

export const BaristaFireInputSchema = z
  .object({
    ...RetirementPlanFields,
    partTime: z.object({
      startAge: AgeSchema,
      /** Part-time pay stops at the start of the year this age is reached. */
      endAge: AgeSchema,
      /** Annual part-time pay in today's dollars. */
      annualIncome: NonNegativeCentsSchema,
    }),
    maxPartTimeIncome: NonNegativeCentsSchema.default(DEFAULT_MAX_PART_TIME as Cents),
  })
  .superRefine((x, ctx) => {
    checkPlan(x, ctx);
    if (x.partTime.endAge <= x.partTime.startAge) {
      ctx.addIssue({
        code: 'custom',
        path: ['partTime', 'endAge'],
        message: 'Part-time end age must be after its start age',
      });
    }
  });
export type BaristaFireInput = z.input<typeof BaristaFireInputSchema>;

export interface BaristaFireResult extends CalculatorLabels {
  /** With the entered part-time income, does the plan meet the criterion? */
  success: boolean;
  outcome: PlanOutcome;
  /** `atBound`: no part-time income is needed; `found`; `notWithinBound`: not even the bound is enough. */
  search: SearchOutcome<null>['status'];
  /** Smallest annual part-time income (today's dollars) that meets the criterion; null when above the bound. */
  minimumPartTimeIncome: Cents | null;
  /** The plan at that income (or at the bound when it is not enough). */
  atMinimum: PlanOutcome;
  /** Part-time pay over the phase at the entered income (nominal, gross). */
  totalPartTimeIncome: Cents;
  tolerance: number;
  evaluations: number;
}

export function baristaFire(input: BaristaFireInput, ctx: EngineContext): EngineResult<BaristaFireResult> {
  const parsed = parseInput(BaristaFireInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const household = (annualIncome: number) =>
    retirementPlanHousehold(x, ctx.currentYear, { partTime: { ...x.partTime, annualIncome } });
  const steps = all(
    projectInput(household(x.partTime.annualIncome), ctx),
    searchMinimum<Projected>(0, x.maxPartTimeIncome, INCOME_TOLERANCE, true, (income) =>
      successStep(household(income), ctx),
    ),
  );
  return toResult(
    mapStep(steps, ([entered, s]) => {
      const p = entered.projection;
      return {
        value: {
          success: p.summary.deterministicSuccess,
          outcome: outcomeOf(p),
          search: s.status,
          minimumPartTimeIncome: s.value as Cents | null,
          atMinimum: outcomeOf(s.detail.projection),
          // One person (the plan household): the person row exists every year.
          totalPartTimeIncome: sumOf(p.rows.map((row) => itemAt(row.people, 0).partTimeIncome)),
          tolerance: INCOME_TOLERANCE,
          evaluations: s.evaluations,
          basis: { dollars: 'todaysDollars' as const, tax: taxBasisOf(p), limits: 'notApplicable' as const },
          ...mergeLabels([p, s.detail.projection]),
          assumptions: [
            'Part-time pay is in today’s dollars and rises with inflation; it is paid from the start age up to (not including) the end age.',
            'In retirement, part-time pay covers spending first; withdrawals fund the rest. No plan deferrals are made from part-time pay.',
            'The minimum part-time income is found by bisection to within $1 between $0 and the search bound.',
          ],
        },
        warnings: dropWarnings(entered.warnings, PLAN_NOISE),
      };
    }),
  );
}
