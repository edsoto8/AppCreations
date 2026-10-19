/**
 * Coast FIRE calculator (docs/financial-model.md §12.13).
 *
 * Engine calls: `projectHousehold` on the one-person plan household (`retirementPlanHousehold`) with
 * contributions stopped from today: does the plan still meet the deterministic success criterion
 * (§4.1)? Then a bisection (`searchMinimum`, integer cents, tolerance $1) over today's balance finds
 * the smallest balance that coasts. A third run with the entered contributions is shown for
 * comparison. The gap is the difference of the found balance and today's. No formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents } from '../domain/primitives';
import { NonNegativeCentsSchema, ZERO_CENTS } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import { asCents } from '../money';
import {
  PLAN_NOISE,
  RetirementPlanFields,
  all,
  checkPlan,
  dropWarnings,
  mapStep,
  mergeLabels,
  outcomeOf,
  parseInput,
  projectInput,
  retirementPlanHousehold,
  searchMinimum,
  successStep,
  taxBasisOf,
  toResult,
  type CalculatorLabels,
  type PlanOutcome,
  type Projected,
  type SearchOutcome,
} from './common';

/** Default search bound for today's balance: $100 million. */
export const DEFAULT_MAX_BALANCE = 10_000_000_000;
export const BALANCE_TOLERANCE = 100;

export const CoastFireInputSchema = z
  .object({ ...RetirementPlanFields, maxBalance: NonNegativeCentsSchema.default(DEFAULT_MAX_BALANCE as Cents) })
  .superRefine(checkPlan);
export type CoastFireInput = z.input<typeof CoastFireInputSchema>;

export interface CoastFireResult extends CalculatorLabels {
  /** With no further contributions, does today's balance meet the criterion? */
  coasts: boolean;
  coasting: PlanOutcome;
  /** The plan with the entered contributions, for comparison. */
  withContributions: PlanOutcome;
  /** `atBound`: $0 already coasts (other income covers spending); `found`; `notWithinBound`. */
  search: SearchOutcome<null>['status'];
  /** Smallest balance today that coasts; null when above the bound. */
  coastNumber: Cents | null;
  /** coastNumber − today's balance, or 0 when already coasting; null when above the bound. */
  gap: Cents | null;
  tolerance: number;
  evaluations: number;
}

export function coastFire(input: CoastFireInput, ctx: EngineContext): EngineResult<CoastFireResult> {
  const parsed = parseInput(CoastFireInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const steps = all(
    projectInput(retirementPlanHousehold(x, ctx.currentYear, { annualContribution: 0 }), ctx),
    projectInput(retirementPlanHousehold(x, ctx.currentYear), ctx),
    searchMinimum<Projected>(0, x.maxBalance, BALANCE_TOLERANCE, true, (balance) =>
      successStep(retirementPlanHousehold(x, ctx.currentYear, { annualContribution: 0, currentBalance: balance }), ctx),
    ),
  );
  return toResult(
    mapStep(steps, ([coasting, contributing, s]) => {
      const coastNumber = s.value as Cents | null;
      const p = coasting.projection;
      return {
        value: {
          coasts: p.summary.deterministicSuccess,
          coasting: outcomeOf(p),
          withContributions: outcomeOf(contributing.projection),
          search: s.status,
          coastNumber,
          gap: coastNumber === null ? null : asCents(Math.max(ZERO_CENTS, coastNumber - x.currentBalance)),
          tolerance: BALANCE_TOLERANCE,
          evaluations: s.evaluations,
          basis: { dollars: 'todaysDollars' as const, tax: taxBasisOf(p), limits: 'notApplicable' as const },
          ...mergeLabels([p, contributing.projection]),
          assumptions: [
            'Coasting means no further contributions from today; the balance grows at the before-retirement return until retirement.',
            'The coast number is the smallest balance today, found by bisection to within $1, that lasts through the planning age.',
            'Working-years pay and spending are outside this calculator.',
          ],
        },
        warnings: dropWarnings(coasting.warnings, PLAN_NOISE),
      };
    }),
  );
}
