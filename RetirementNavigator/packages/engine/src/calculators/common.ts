/**
 * Shared plumbing for the standalone calculators (docs/financial-model.md §12).
 *
 * Every calculator is a thin wrapper: it validates its own small input with Zod, builds a synthetic
 * household (the same shape as `samples/minimal.ts`, validated by `HouseholdSchema`), calls existing
 * engine functions and reports figures read from the engine results. This module holds no financial
 * formula: only input validation, household assembly, result labeling and the search control logic
 * (bisection) the calculators share.
 *
 * Engine calls used here: `HouseholdSchema.safeParse`, `projectHousehold`, `minimalHouseholdInput`
 * (template for the capital-market block), `zodIssues`.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import { HouseholdSchema, SocialSecurityInputSchema, type Household, type HouseholdInput } from '../domain/household';
import {
  AgeSchema,
  InflationRateSchema,
  NominalRateSchema,
  NonNegativeCentsSchema,
  ZERO_CENTS,
  type Cents,
} from '../domain/primitives';
import type { EngineResult, EngineWarning, UnverifiedDetail, ValidationIssue, WarningCode } from '../domain/results';
import type { ProjectionResult, YearRow } from '../domain/projection';
import type { ProjectionOptions } from '../api';
import { projectHousehold } from '../projection/project';
import { minimalHouseholdInput } from '../samples/minimal';
import { zodIssues } from '../validation';

// ---- Result labeling --------------------------------------------------------------------------

/** Which dollars a calculator's money figures use. Fields named `…Real`/`todays…` are today's dollars. */
export type DollarBasisLabel = 'nominal' | 'todaysDollars' | 'nominalAndTodaysDollars';
/**
 * Whether estimated taxes are reflected. `beforeTaxes`: no tax is subtracted (growth-only figures, or
 * tax rules unverified so withdrawals equal the need before taxes, §1.7). `afterTaxes`: the projection
 * computed taxes (the spending need is a net need and withdrawals were grossed up).
 */
export type TaxBasisLabel = 'beforeTaxes' | 'afterTaxes';
/** Whether workplace contribution limits were applied (`beforeLimits` while they are unverified, §1.7). */
export type LimitsBasisLabel = 'afterLimits' | 'beforeLimits' | 'notApplicable';

export interface CalculatorBasis {
  dollars: DollarBasisLabel;
  tax: TaxBasisLabel;
  limits: LimitsBasisLabel;
}

/** A rule value that was null and the features it blocks (same shape as `ProjectionResult.unverified`). */
export type CalculatorUnverified = ProjectionResult['unverified'][number];

/** Labels every calculator result carries (docs/financial-model.md §1.7, §12). */
export interface CalculatorLabels {
  basis: CalculatorBasis;
  /** Rule-dependent steps the engine left out because a rule value is null (from the projections). */
  excludedFeatures: string[];
  /** The null rule values behind `excludedFeatures`. */
  unverified: CalculatorUnverified[];
  /** Descriptive assumptions shown beside the result. */
  assumptions: string[];
}

/** Features whose exclusion means taxes were not computed (the tax basis is then `beforeTaxes`). */
const TAX_FEATURES = new Set(['federalIncomeTax', 'payrollTax', 'capitalGainsTax', 'ssBenefitTaxation']);

/** `afterTaxes` when the projection computed taxes, `beforeTaxes` when a tax feature was excluded. */
export function taxBasisOf(projection: ProjectionResult): TaxBasisLabel {
  return projection.excludedFeatures.some((f) => TAX_FEATURES.has(f)) ? 'beforeTaxes' : 'afterTaxes';
}

/** `beforeLimits` when the projection left workplace limits out (§1.7), else `afterLimits`. */
export function limitsBasisOf(projection: ProjectionResult): LimitsBasisLabel {
  return projection.excludedFeatures.includes('workplaceLimits') ? 'beforeLimits' : 'afterLimits';
}

/** Union of the excluded features and null rule keys of several projections (first seen order). */
export function mergeLabels(
  projections: readonly ProjectionResult[],
  extra: readonly CalculatorUnverified[] = [],
): {
  excludedFeatures: string[];
  unverified: CalculatorUnverified[];
} {
  const features: string[] = [];
  const byKey = new Map<string, CalculatorUnverified>();
  const addKey = (u: CalculatorUnverified) => {
    const existing = byKey.get(u.key);
    if (!existing) byKey.set(u.key, { key: u.key, reason: u.reason, features: [...u.features] });
    else for (const f of u.features) if (!existing.features.includes(f)) existing.features.push(f);
  };
  for (const p of projections) {
    for (const f of p.excludedFeatures) if (!features.includes(f)) features.push(f);
    p.unverified.forEach(addKey);
  }
  // Null rule values a calculator's own engine calls needed (for example the year-1 limit step).
  for (const u of extra) {
    addKey(u);
    for (const f of u.features) if (!features.includes(f)) features.push(f);
  }
  return { excludedFeatures: features, unverified: [...byKey.values()] };
}

/** Engine warnings without the codes a synthetic household raises by construction (documented per calculator). */
export function dropWarnings(warnings: readonly EngineWarning[], codes: readonly WarningCode[]): EngineWarning[] {
  return warnings.filter((w) => !codes.includes(w.code));
}

// ---- Invariant reads ------------------------------------------------------------------------------

/**
 * `items[index]` where the calculator's own construction guarantees the item exists (for example a
 * projection row of a validated horizon). A missing item is a programming error, so this throws a
 * RangeError, the same guard as `asCents`; user data never reaches it.
 */
export function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`Expected an item at index ${index}`);
  return item;
}

export const lastOf = <T>(items: readonly T[]): T => itemAt(items, items.length - 1);

/** A value the construction guarantees is present (programming-error guard, as `itemAt`). */
export function notNull<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new RangeError(`Expected ${what}`);
  return value;
}

// ---- Steps (early-return plumbing) ------------------------------------------------------------

export type Step<T> = { ok: true; value: T } | { ok: false; result: EngineResult<never> };

export const invalid = (issues: ValidationIssue[]): { ok: false; result: EngineResult<never> } => ({
  ok: false,
  result: { status: 'invalid', issues },
});

/** Validate a calculator input; Zod issues become `invalid` with field paths and messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): Step<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  return { ok: true, value: parsed.data };
}

/** Validate a synthetic household; issues are reported under `household`. */
export function buildHousehold(input: HouseholdInput): Step<Household> {
  const parsed = HouseholdSchema.safeParse(input);
  if (!parsed.success) {
    return invalid(zodIssues(parsed.error).map((i) => ({ path: ['household', ...i.path], message: i.message })));
  }
  return { ok: true, value: parsed.data };
}

/**
 * Read an engine sub-result that may need rule values: `ok` gives the value; `unverified` records the
 * missing keys in `missing` and gives null. As in the projection (`Gaps`), an `invalid` sub-result
 * also reads as null: calculator inputs are validated with the same bounds first, so it is not
 * expected (no case is known).
 */
export function ruleValue<T>(r: EngineResult<T>, missing: UnverifiedDetail[]): T | null {
  if (r.status === 'ok') return r.value;
  if (r.status === 'unverified') missing.push(...r.missing);
  return null;
}

/** An engine result as a step (`unverified` and `invalid` both stop the calculator and are passed through). */
export function toStep<T>(r: EngineResult<T>): Step<T> {
  return r.status === 'ok' ? { ok: true, value: r.value } : { ok: false, result: r };
}

/** Continue with `f` after a successful step; a failure is passed through. */
export function andThen<T, U>(s: Step<T>, f: (value: T) => Step<U>): Step<U> {
  return s.ok ? f(s.value) : s;
}

/** The calculator's engine result: its value and warnings, or the failure the steps passed through. */
export function toResult<T>(s: Step<{ value: T; warnings: EngineWarning[] }>): EngineResult<T> {
  return s.ok ? { status: 'ok', value: s.value.value, warnings: s.value.warnings } : s.result;
}

/** Apply `f` to a successful step; a failure is passed through. */
export function mapStep<T, U>(s: Step<T>, f: (value: T) => U): Step<U> {
  return s.ok ? { ok: true, value: f(s.value) } : s;
}

/** Combine steps into one: the values in order, or the first failure. */
export function all<T extends unknown[]>(...steps: { [K in keyof T]: Step<T[K]> }): Step<T> {
  const values: unknown[] = [];
  for (const s of steps as Step<unknown>[]) {
    if (!s.ok) return s;
    values.push(s.value);
  }
  return { ok: true, value: values as T };
}

/** A search step: project a synthetic household and test the deterministic success criterion. */
export function successStep(input: HouseholdInput, ctx: EngineContext): Step<Evaluation<Projected>> {
  return mapStep(projectInput(input, ctx), (p) => ({ pass: p.projection.summary.deterministicSuccess, detail: p }));
}

export interface Projected {
  projection: ProjectionResult;
  warnings: EngineWarning[];
}

/** `projectHousehold`; a non-ok result is passed through unchanged. */
export function project(household: Household, ctx: EngineContext, options: ProjectionOptions = {}): Step<Projected> {
  const r = projectHousehold(household, ctx, options);
  if (r.status !== 'ok') return { ok: false, result: r };
  return { ok: true, value: { projection: r.value, warnings: r.warnings } };
}

/** Build, validate and project a synthetic household in one step. */
export function projectInput(input: HouseholdInput, ctx: EngineContext): Step<Projected> {
  const h = buildHousehold(input);
  if (!h.ok) return h;
  return project(h.value, ctx);
}

// ---- Search control logic (bisection) ---------------------------------------------------------

export interface SearchOutcome<T> {
  /**
   * `atBound`: the starting bound already passes (minimum search) or the far bound still passes
   * (maximum search). `found`: the boundary was located within the tolerance. `notWithinBound`: no
   * value in the range passes.
   */
  status: 'atBound' | 'found' | 'notWithinBound';
  /** The passing value closest to the boundary; null when nothing in the range passes. */
  value: number | null;
  /** The evaluation detail at `value` (or at the far bound when nothing passes). */
  detail: T;
  /** Engine evaluations made, bounds included. */
  evaluations: number;
}

export interface Evaluation<T> {
  pass: boolean;
  detail: T;
}

const MAX_SEARCH_STEPS = 200;

/**
 * Smallest x in [lo, hi] that passes, for a predicate that is monotone (fails below some point and
 * passes from it on). Bisection stops when the bracket is at most `tolerance` wide; the upper end
 * (a passing value) is returned. With `integer`, midpoints are whole numbers (cents).
 */
export function searchMinimum<T>(
  lo: number,
  hi: number,
  tolerance: number,
  integer: boolean,
  evaluate: (x: number) => Step<Evaluation<T>>,
): Step<SearchOutcome<T>> {
  const first = evaluate(lo);
  if (!first.ok) return first;
  if (first.value.pass)
    return { ok: true, value: { status: 'atBound', value: lo, detail: first.value.detail, evaluations: 1 } };
  const last = evaluate(hi);
  if (!last.ok) return last;
  if (!last.value.pass) {
    return { ok: true, value: { status: 'notWithinBound', value: null, detail: last.value.detail, evaluations: 2 } };
  }
  let low = lo;
  let high = hi;
  let best = last.value.detail;
  let evaluations = 2;
  while (high - low > tolerance && evaluations < MAX_SEARCH_STEPS) {
    const mid = integer ? Math.floor((low + high) / 2) : (low + high) / 2;
    if (mid <= low || mid >= high) break;
    const r = evaluate(mid);
    if (!r.ok) return r;
    evaluations++;
    if (r.value.pass) {
      high = mid;
      best = r.value.detail;
    } else {
      low = mid;
    }
  }
  return { ok: true, value: { status: 'found', value: high, detail: best, evaluations } };
}

/**
 * Largest x in [lo, hi] that passes, for a predicate that passes up to some point and fails beyond
 * it. Returns the lower end of the final bracket (a passing value).
 */
export function searchMaximum<T>(
  lo: number,
  hi: number,
  tolerance: number,
  integer: boolean,
  evaluate: (x: number) => Step<Evaluation<T>>,
): Step<SearchOutcome<T>> {
  const first = evaluate(lo);
  if (!first.ok) return first;
  if (!first.value.pass) {
    return { ok: true, value: { status: 'notWithinBound', value: null, detail: first.value.detail, evaluations: 1 } };
  }
  const last = evaluate(hi);
  if (!last.ok) return last;
  if (last.value.pass)
    return { ok: true, value: { status: 'atBound', value: hi, detail: last.value.detail, evaluations: 2 } };
  let low = lo;
  let high = hi;
  let best = first.value.detail;
  let evaluations = 2;
  while (high - low > tolerance && evaluations < MAX_SEARCH_STEPS) {
    const mid = integer ? Math.floor((low + high) / 2) : (low + high) / 2;
    if (mid <= low || mid >= high) break;
    const r = evaluate(mid);
    if (!r.ok) return r;
    evaluations++;
    if (r.value.pass) {
      low = mid;
      best = r.value.detail;
    } else {
      high = mid;
    }
  }
  return { ok: true, value: { status: 'found', value: low, detail: best, evaluations } };
}

// ---- Shared input pieces ----------------------------------------------------------------------

/** Horizon in whole years for the account-growth calculators. */
export const YearsSchema = z
  .number()
  .int({ message: 'Years must be a whole number' })
  .min(1, { message: 'Years must be at least 1' })
  .max(100, { message: 'Years must be at most 100' });

export const ExpenseRatioSchema = z
  .number()
  .min(0, { message: 'Expense ratio cannot be negative' })
  .max(0.05, { message: 'Expense ratio must be at most 5%' });

/** Monthly Social Security benefit at the planned claiming age (today's dollars), from the person's statement. */
export const SocialSecurityAtClaimSchema = z
  .object({ monthlyAtClaim: NonNegativeCentsSchema, claimAge: SocialSecurityInputSchema.shape.claimAge })
  .nullable()
  .default(null);

export const TaxTreatmentSchema = z.enum(['taxDeferred', 'taxFree', 'taxable']);
export type SavingsTaxTreatment = z.infer<typeof TaxTreatmentSchema>;

/** Fields shared by the retirement-plan calculators (one person, one savings account). */
export const RetirementPlanFields = {
  /** Current age (age in year 1 = current year − birth year). */
  age: AgeSchema,
  retirementAge: AgeSchema,
  planningAge: AgeSchema,
  /** Savings today (nominal = today's dollars). */
  currentBalance: NonNegativeCentsSchema,
  /** Annual contribution until the year before retirement, in today's dollars (grows with inflation). */
  annualContribution: NonNegativeCentsSchema.default(ZERO_CENTS),
  returnBeforeRetirement: NominalRateSchema,
  returnInRetirement: NominalRateSchema,
  inflation: InflationRateSchema,
  /** Annual retirement spending in today's dollars, a net (after-tax) need. */
  retirementSpending: NonNegativeCentsSchema,
  socialSecurity: SocialSecurityAtClaimSchema,
  taxTreatment: TaxTreatmentSchema.default('taxDeferred'),
  /** Taxable savings only: cost basis today; null = the balance (no unrealized gain). */
  costBasis: NonNegativeCentsSchema.nullable().default(null),
  expenseRatio: ExpenseRatioSchema.default(0),
  withdrawalTiming: z.enum(['midYear', 'startOfYear']).default('midYear'),
  /** Deterministic success also needs at least this real ending balance (today's dollars). */
  minimumEndingBalance: NonNegativeCentsSchema.default(ZERO_CENTS),
};

const _planObject = z.object(RetirementPlanFields);
export type RetirementPlan = z.output<typeof _planObject>;

/** Cross-field checks shared by the retirement-plan calculators. */
export function checkPlan(plan: RetirementPlan, ctx: z.RefinementCtx): void {
  if (plan.retirementAge > plan.planningAge) {
    ctx.addIssue({ code: 'custom', path: ['retirementAge'], message: 'Retirement age is after planning age' });
  }
  if (plan.age > plan.planningAge) {
    ctx.addIssue({ code: 'custom', path: ['planningAge'], message: 'Planning age is before the current age' });
  }
}

const PERSON_ID = 'calc-person';
const SAVINGS_ID = 'calc-savings';
export const CALC_IDS = { person: PERSON_ID, savings: SAVINGS_ID } as const;

/** The non-account part of every synthetic household: capital-market block and rules anchor from the template. */
export function assumptionsTemplate(
  currentYear: number,
  values: {
    inflation: number;
    returnPreRetirement: number;
    returnPostRetirement: number;
    withdrawalTiming?: 'midYear' | 'startOfYear';
    minimumEndingBalance?: number;
  },
): HouseholdInput['assumptions'] {
  const template = minimalHouseholdInput(currentYear).assumptions;
  return {
    ...template,
    inflation: values.inflation,
    returnPreRetirement: values.returnPreRetirement,
    returnPostRetirement: values.returnPostRetirement,
    withdrawalTiming: values.withdrawalTiming ?? 'midYear',
    minimumEndingBalance: values.minimumEndingBalance ?? 0,
    rules: { anchorYear: currentYear },
  };
}

/** One savings account for the retirement-plan calculators ('other' account, or a taxable brokerage). */
export function savingsAccount(
  treatment: SavingsTaxTreatment,
  balance: number,
  costBasis: number | null,
  expenseRatio: number,
  annualContribution: number,
): NonNullable<HouseholdInput['accounts']>[number] {
  const contribution =
    annualContribution > 0
      ? {
          amount: { kind: 'dollars' as const, amount: annualContribution, frequency: 'annual' as const },
          growth: { mode: 'inflation' as const },
        }
      : null;
  const base = { id: SAVINGS_ID, name: 'Savings', ownerId: PERSON_ID, balance, expenseRatio, contribution };
  return treatment === 'taxable'
    ? { ...base, type: 'taxableBrokerage', costBasis: costBasis ?? balance }
    : { ...base, type: 'other', taxTreatment: treatment };
}

/**
 * The single-person household of the retirement-plan calculators: no salary (working-years pay and
 * spending are outside the calculator), contributions to one savings account until the year before
 * retirement, retirement spending from the retirement age, optional Social Security entered at the
 * claiming age, and an optional part-time phase (Barista FIRE).
 */
export function retirementPlanHousehold(
  plan: RetirementPlan,
  currentYear: number,
  overrides: {
    currentBalance?: number;
    annualContribution?: number;
    partTime?: { startAge: number; endAge: number; annualIncome: number } | null;
  } = {},
): HouseholdInput {
  const partTime = overrides.partTime ?? null;
  return {
    id: 'calc-household',
    name: 'Calculator',
    filingStatus: 'single',
    people: [
      {
        id: PERSON_ID,
        name: 'You',
        birthYear: currentYear - plan.age,
        retirementAge: plan.retirementAge,
        planningAge: plan.planningAge,
        employment: partTime ? { baseSalary: 0, raise: { mode: 'nominal', rate: 0 }, partTime } : null,
        socialSecurity: plan.socialSecurity
          ? {
              source: { kind: 'atClaimAge', monthlyAtClaim: plan.socialSecurity.monthlyAtClaim },
              claimAge: plan.socialSecurity.claimAge,
            }
          : { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      savingsAccount(
        plan.taxTreatment,
        overrides.currentBalance ?? plan.currentBalance,
        plan.costBasis,
        plan.expenseRatio,
        overrides.annualContribution ?? plan.annualContribution,
      ),
    ],
    spending: { currentAnnualSpending: 0, retirementAnnualSpending: plan.retirementSpending },
    assumptions: assumptionsTemplate(currentYear, {
      inflation: plan.inflation,
      returnPreRetirement: plan.returnBeforeRetirement,
      returnPostRetirement: plan.returnInRetirement,
      withdrawalTiming: plan.withdrawalTiming,
      minimumEndingBalance: plan.minimumEndingBalance,
    }),
  };
}

/** Outcome of one projection of a plan, as the search calculators report it. */
export interface PlanOutcome {
  success: boolean;
  depletionYear: number | null;
  depletionAge: number | null;
  endingBalance: Cents;
  endingBalanceReal: Cents;
}

export function outcomeOf(p: ProjectionResult): PlanOutcome {
  return {
    success: p.summary.deterministicSuccess,
    depletionYear: p.summary.depletionYear,
    depletionAge: p.summary.depletionAge,
    endingBalance: p.summary.endingBalance,
    endingBalanceReal: p.summary.endingBalanceReal,
  };
}

// ---- Account-growth households (compound interest, fees, lump sum) ----------------------------

/**
 * A household whose only purpose is to grow one cash account for `years` years. The person is in the
 * accumulation phase for exactly `years` years (rows 1..years) and reaches the retirement age in year
 * `years + 1`, which ends the projection; that last row is not reported. The person's age is chosen
 * so the retirement age is at least 65 (no pre-Medicare note).
 */
export function growthHousehold(
  currentYear: number,
  values: {
    years: number;
    balance: number;
    annualContribution: number;
    contributionGrowth: number;
    contributionYears?: number;
    annualReturn: number;
    inflation: number;
    expenseRatio: number;
  },
): HouseholdInput {
  const age = Math.max(0, 65 - values.years);
  const stopYear = currentYear + (values.contributionYears ?? values.years) - 1;
  const contribution =
    values.annualContribution > 0
      ? {
          amount: { kind: 'dollars' as const, amount: values.annualContribution, frequency: 'annual' as const },
          growth:
            values.contributionGrowth === 0
              ? { mode: 'flat' as const }
              : { mode: 'rate' as const, rate: values.contributionGrowth },
          stopYear,
        }
      : null;
  return {
    id: 'calc-household',
    name: 'Calculator',
    filingStatus: 'single',
    people: [
      {
        id: PERSON_ID,
        name: 'You',
        birthYear: currentYear - age,
        retirementAge: age + values.years,
        planningAge: age + values.years,
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      {
        type: 'cash',
        id: SAVINGS_ID,
        name: 'Account',
        ownerId: PERSON_ID,
        balance: values.balance,
        expectedReturn: values.annualReturn,
        expenseRatio: values.expenseRatio,
        contribution,
      },
    ],
    spending: { currentAnnualSpending: 0, retirementAnnualSpending: 0 },
    assumptions: assumptionsTemplate(currentYear, {
      inflation: values.inflation,
      returnPreRetirement: values.annualReturn,
      returnPostRetirement: values.annualReturn,
    }),
  };
}

/** One year of a growth projection, read from the projection row. */
export interface GrowthRow {
  year: number;
  /** 1-based year index. */
  index: number;
  startBalance: Cents;
  contributions: Cents;
  /** Growth after fees (the reconciling item, §1.3). */
  growth: Cents;
  feeDrag: Cents;
  endBalance: Cents;
  /** Year-end balance in today's dollars. */
  endBalanceReal: Cents;
  deflator: number;
}

export function growthRows(rows: readonly YearRow[], years: number): GrowthRow[] {
  return rows.slice(0, years).map((r) => ({
    year: r.year,
    index: r.index,
    startBalance: r.totals.portfolioStart,
    contributions: r.flows.contributions,
    growth: r.flows.growthNet,
    feeDrag: r.flows.feeDrag,
    endBalance: r.totals.portfolioEnd,
    endBalanceReal: r.real.portfolioEnd,
    deflator: r.deflator,
  }));
}

/** Sum of integer cents (engine outputs). */
export function sumOf(values: readonly number[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total as Cents;
}

/** The codes a growth household raises by construction (it has no pay, and it never retires within the horizon). */
export const GROWTH_NOISE: readonly WarningCode[] = ['savingsPlanInfeasible'];
/** The codes the retirement-plan households raise by construction (no pay is modeled in working years). */
export const PLAN_NOISE: readonly WarningCode[] = ['savingsPlanInfeasible'];
