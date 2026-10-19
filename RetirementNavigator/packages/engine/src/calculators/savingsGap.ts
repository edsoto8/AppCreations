/**
 * Savings gap calculator (docs/financial-model.md §12.6).
 *
 * Engine calls: `projectHousehold` on the one-person plan household (`retirementPlanHousehold`)
 * inside a bisection (`searchMinimum`, integer cents, tolerance $1) over an extra annual
 * contribution, added to the entered one (both in today's dollars, rising with inflation), until the
 * plan meets the deterministic success criterion (§4.1). Higher contributions never lower the
 * balance (a property the engine tests), so the success test is monotone in the extra amount.
 * No formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents } from '../domain/primitives';
import { NonNegativeCentsSchema } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
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
  sumOf,
  taxBasisOf,
  toResult,
  type CalculatorLabels,
  type PlanOutcome,
  type Projected,
  type SearchOutcome,
} from './common';

/** Default search bound for the extra contribution: $1,000,000 a year. */
export const DEFAULT_MAX_EXTRA = 100_000_000;
export const CONTRIBUTION_TOLERANCE = 100;

export const SavingsGapInputSchema = z
  .object({ ...RetirementPlanFields, maxExtraContribution: NonNegativeCentsSchema.default(DEFAULT_MAX_EXTRA as Cents) })
  .superRefine((x, ctx) => {
    checkPlan(x, ctx);
    if (x.retirementAge <= x.age) {
      ctx.addIssue({ code: 'custom', path: ['retirementAge'], message: 'There are no working years left to save in' });
    }
  });
export type SavingsGapInput = z.input<typeof SavingsGapInputSchema>;

export interface SavingsGapResult extends CalculatorLabels {
  /** `atBound`: the plan already meets the criterion; `found`; `notWithinBound`: not even the bound is enough. */
  search: SearchOutcome<null>['status'];
  /** Extra annual contribution needed (today's dollars); 0 when already met; null when above the bound. */
  extraAnnualContribution: Cents | null;
  /** Entered plus extra contribution (today's dollars); null when above the bound. */
  totalAnnualContribution: Cents | null;
  /** The plan as entered. */
  current: PlanOutcome;
  /** The plan with the extra contribution (or at the bound when it is not enough). */
  withExtra: PlanOutcome;
  tolerance: number;
  evaluations: number;
}

export function savingsGap(input: SavingsGapInput, ctx: EngineContext): EngineResult<SavingsGapResult> {
  const parsed = parseInput(SavingsGapInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const household = (extra: number) =>
    retirementPlanHousehold(x, ctx.currentYear, { annualContribution: x.annualContribution + extra });
  const steps = all(
    projectInput(household(0), ctx),
    searchMinimum<Projected>(0, x.maxExtraContribution, CONTRIBUTION_TOLERANCE, true, (extra) =>
      successStep(household(extra), ctx),
    ),
  );
  return toResult(
    mapStep(steps, ([current, s]) => {
      const extra = s.value as Cents | null;
      const p = s.detail.projection;
      return {
        value: {
          search: s.status,
          extraAnnualContribution: extra,
          totalAnnualContribution: extra === null ? null : sumOf([x.annualContribution, extra]),
          current: outcomeOf(current.projection),
          withExtra: outcomeOf(p),
          tolerance: CONTRIBUTION_TOLERANCE,
          evaluations: s.evaluations,
          basis: { dollars: 'todaysDollars' as const, tax: taxBasisOf(p), limits: 'notApplicable' as const },
          ...mergeLabels([current.projection, p]),
          assumptions: [
            'The extra contribution is in today’s dollars, rises with inflation and stops the year before retirement, like the entered contribution.',
            'It is found by bisection to within $1 between $0 and the search bound.',
            'Success means no shortfall through the planning age and at least the minimum ending balance (today’s dollars).',
          ],
        },
        warnings: dropWarnings(s.detail.warnings, PLAN_NOISE),
      };
    }),
  );
}
