/**
 * FI number calculator (docs/financial-model.md §12.15).
 *
 * Engine calls: `projectHousehold` through the withdrawal calculator's drawdown plan (`runDrawdown`),
 * inside bisections over the starting balance (`searchMinimum`, integer cents, tolerance $1):
 * - `sustainable.fiNumber`: the smallest starting balance whose plan, spending `annualSpending`
 *   (today's dollars, rising with inflation), meets the deterministic success criterion through the
 *   horizon (§4.1). At that balance the withdrawal calculator's sustainable-rate search
 *   (`sustainableRateSearch`, as `withdrawal` mode `sustainableRate`) reports the initial withdrawal rate it supports.
 * - `ruleOfThumb.fiNumber` (when a withdrawal rate is given): the smallest starting balance at which
 *   the withdrawal calculator's fixed-percentage plan (`rate × balance`) has a first-year spending need
 *   (read from the projection row) of at least `annualSpending`, i.e. "spending ÷ rate" found by search
 *   through the engine, never hand-coded. The same run reports whether that plan lasts through the
 *   horizon under the return assumption.
 * No financial formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents } from '../domain/primitives';
import { NonNegativeCentsSchema } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import {
  DRAWDOWN_ASSUMPTIONS,
  DrawdownFields,
  runDrawdown,
  spendingFor,
  sustainableRateSearch,
  type DrawdownRun,
  type DrawdownStep,
} from './withdrawal';
import {
  all,
  andThen,
  itemAt,
  mapStep,
  mergeLabels,
  parseInput,
  searchMinimum,
  taxBasisOf,
  toResult,
  type CalculatorLabels,
  type SearchOutcome,
  type Step,
} from './common';

/** Default search bound for the starting balance: $100 million. */
export const DEFAULT_MAX_BALANCE = 10_000_000_000;
/** Balance search tolerance: $1. */
export const BALANCE_TOLERANCE = 100;

const { startingBalance: _omit, ...fields } = DrawdownFields;

export const FiNumberInputSchema = z
  .object({
    ...fields,
    /** Annual spending in today's dollars (a net need, rising with inflation). */
    annualSpending: NonNegativeCentsSchema,
    /** Rule-of-thumb initial withdrawal rate (decimal); null = only the sustainable figure. */
    withdrawalRate: z
      .number()
      .gt(0, { message: 'Withdrawal rate must be above 0%' })
      .max(1, { message: 'Withdrawal rate must be at most 100%' })
      .nullable()
      .default(null),
    maxBalance: NonNegativeCentsSchema.default(DEFAULT_MAX_BALANCE as Cents),
  })
  .refine((x) => x.age + x.years - 1 <= 120, { path: ['years'], message: 'The plan must end by age 120' });
export type FiNumberInput = z.input<typeof FiNumberInputSchema>;

export interface FiNumberResult extends CalculatorLabels {
  sustainable: {
    search: SearchOutcome<null>['status'];
    /** Smallest starting balance (today) whose plan lasts through the horizon; null if above the bound. */
    fiNumber: Cents | null;
    plan: DrawdownRun | null;
    /** Initial withdrawal rate the FI number supports (the withdrawal calculator's sustainable rate). */
    sustainableRateAtFiNumber: number | null;
  };
  ruleOfThumb: {
    withdrawalRate: number;
    search: SearchOutcome<null>['status'];
    /** Smallest starting balance whose fixed-percentage withdrawal covers the spending; null if above the bound. */
    fiNumber: Cents | null;
    /** The fixed-percentage plan at that balance (does it last under the return assumption?). */
    plan: DrawdownRun | null;
  } | null;
  tolerance: number;
}

const NO_SEARCH: Step<null> = { ok: true, value: null };

export function fiNumber(input: FiNumberInput, ctx: EngineContext): EngineResult<FiNumberResult> {
  const parsed = parseInput(FiNumberInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const plan = { ...x, startingBalance: 0 as Cents };

  // Smallest balance whose plan, spending `annualSpending`, lasts through the horizon; then the
  // sustainable initial rate at that balance (the withdrawal calculator's search).
  const sustainable = andThen(
    searchMinimum<DrawdownStep>(0, x.maxBalance, BALANCE_TOLERANCE, true, (balance) =>
      mapStep(runDrawdown(plan, balance, x.annualSpending, ctx), (r) => ({ pass: r.run.success, detail: r })),
    ),
    (s) =>
      mapStep(s.value !== null && s.value > 0 ? sustainableRateSearch(plan, s.value, 1, ctx) : NO_SEARCH, (rate) => ({
        s,
        rateAtFi: rate?.value ?? null,
      })),
  );
  // Smallest balance whose fixed-percentage withdrawal (rate × balance) covers the spending in year 1.
  const rate = x.withdrawalRate;
  const ruleOfThumb =
    rate === null
      ? NO_SEARCH
      : searchMinimum<DrawdownStep>(0, x.maxBalance, BALANCE_TOLERANCE, true, (balance) =>
          mapStep(runDrawdown(plan, balance, spendingFor(rate, balance), ctx), (r) => ({
            // years ≥ 1 (schema): the plan has a first year.
            pass: itemAt(r.run.rows, 0).spendingNeed >= x.annualSpending,
            detail: r,
          })),
        );

  return toResult(
    mapStep(all(sustainable, ruleOfThumb), ([{ s, rateAtFi }, rt]) => ({
      value: {
        sustainable: {
          search: s.status,
          fiNumber: s.value as Cents | null,
          plan: s.value === null ? null : s.detail.run,
          sustainableRateAtFiNumber: rateAtFi,
        },
        ruleOfThumb:
          rate === null || rt === null
            ? null
            : {
                withdrawalRate: rate,
                search: rt.status,
                fiNumber: rt.value as Cents | null,
                plan: rt.value === null ? null : rt.detail.run,
              },
        tolerance: BALANCE_TOLERANCE,
        basis: {
          dollars: 'nominalAndTodaysDollars' as const,
          tax: taxBasisOf(s.detail.projection),
          limits: 'notApplicable' as const,
        },
        ...mergeLabels(rt === null ? [s.detail.projection] : [s.detail.projection, rt.detail.projection]),
        assumptions: [
          ...DRAWDOWN_ASSUMPTIONS,
          'The FI number is the smallest balance today, found by bisection to within $1, whose plan lasts through the horizon.',
          'The rule-of-thumb figure is the balance whose fixed-percentage withdrawal equals the spending; it is shown with whether that plan lasts under the return assumption.',
        ],
      },
      warnings: s.value === null ? [] : s.detail.warnings,
    })),
  );
}
