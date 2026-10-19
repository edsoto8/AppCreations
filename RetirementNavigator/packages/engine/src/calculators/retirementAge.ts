/**
 * Retirement age calculator (docs/financial-model.md §12.5).
 *
 * Engine calls: `optimizeRetirementAge` (deterministic criterion, §10) on the one-person plan
 * household (`retirementPlanHousehold`), which scans every age in the range with `projectHousehold`;
 * then `projectHousehold` once at the earliest successful age (or the last age of the range) for the
 * labels and the outcome shown. No formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext, OptimizerResult } from '../api';
import { AgeSchema } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import { optimizeRetirementAge, withRetirementAge } from '../scenario/scenario';
import {
  PLAN_NOISE,
  RetirementPlanFields,
  andThen,
  buildHousehold,
  dropWarnings,
  mapStep,
  mergeLabels,
  notNull,
  outcomeOf,
  parseInput,
  project,
  retirementPlanHousehold,
  taxBasisOf,
  toResult,
  toStep,
  type CalculatorLabels,
  type PlanOutcome,
} from './common';

const { retirementAge: _omit, ...fields } = RetirementPlanFields;

export const RetirementAgeInputSchema = z
  .object({
    ...fields,
    /** Range of retirement ages to evaluate (whole ages, inclusive). */
    fromAge: AgeSchema,
    toAge: AgeSchema,
  })
  .superRefine((x, ctx) => {
    if (x.toAge > x.planningAge) {
      ctx.addIssue({ code: 'custom', path: ['toAge'], message: 'The range must end by the planning age' });
    }
    if (x.toAge <= x.age) {
      ctx.addIssue({ code: 'custom', path: ['toAge'], message: 'The range must end after the current age' });
    }
  });
export type RetirementAgeInput = z.input<typeof RetirementAgeInputSchema>;

export interface RetirementAgeResult extends CalculatorLabels {
  /** Earliest age in the range whose plan meets the deterministic success criterion; null if none. */
  earliestAge: number | null;
  evaluated: OptimizerResult['evaluated'];
  /** The plan at the earliest successful age (or at the end of the range when none succeeds). */
  shown: { retirementAge: number; outcome: PlanOutcome };
}

export function retirementAge(input: RetirementAgeInput, ctx: EngineContext): EngineResult<RetirementAgeResult> {
  const parsed = parseInput(RetirementAgeInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  // The base plan retires at the end of the range (still working today, as the optimizer requires).
  const steps = andThen(
    buildHousehold(retirementPlanHousehold({ ...x, retirementAge: x.toAge }, ctx.currentYear)),
    (h) =>
      andThen(
        toStep(optimizeRetirementAge(h, ctx, { kind: 'deterministic' }, { fromAge: x.fromAge, toAge: x.toAge })),
        (opt) => {
          const shownAge = opt.earliestAge ?? x.toAge;
          // The optimizer projected this age (or the base age), so the household is valid.
          return mapStep(
            project(notNull(withRetirementAge(h, shownAge, ctx.currentYear), 'the plan at the shown age'), ctx),
            (projected) => ({
              opt,
              shownAge,
              projected,
            }),
          );
        },
      ),
  );
  return toResult(
    mapStep(steps, ({ opt, shownAge, projected }) => {
      const p = projected.projection;
      return {
        value: {
          earliestAge: opt.earliestAge,
          evaluated: opt.evaluated,
          shown: { retirementAge: shownAge, outcome: outcomeOf(p) },
          basis: { dollars: 'todaysDollars' as const, tax: taxBasisOf(p), limits: 'notApplicable' as const },
          ...mergeLabels([p]),
          assumptions: [
            'Every whole retirement age in the range is projected; the earliest one with no shortfall through the planning age (and at least the minimum ending balance) is reported.',
            'Contributions continue until the year before retirement; spending in retirement is a net need in today’s dollars.',
            'Working-years pay and spending are outside this calculator.',
          ],
        },
        warnings: dropWarnings(projected.warnings, PLAN_NOISE),
      };
    }),
  );
}
