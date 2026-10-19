/**
 * FROZEN ENGINE CONTRACT (CONTRACT_VERSION below). Signatures here change only with a version bump,
 * a note in docs/STATUS.md, and the main agent applying the change.
 *
 * Phase 0: every function is a stub that throws `NotImplementedError`. Milestones replace the bodies
 * (implementation lives in the module named in each comment) without changing the signatures.
 *
 * Purity: no Date.now(), no Math.random(), no globals. The current year and the PRNG are injected.
 */
import type { AgeYearsMonths, CalendarYear, Cents, DollarBasis, FilingStatus, Fraction } from './domain/primitives';
import type { Household, WorkplacePlan } from './domain/household';
import type { RulesSet, StandingRules, TaxYearRules } from './domain/rules';
import type { EngineResult, EngineWarning, UnverifiedDetail } from './domain/results';
import type { OrphanedOp, Scenario, ScenarioPreset } from './domain/scenario';
import type { ProjectionResult } from './domain/projection';
import type { MonteCarloChunk, MonteCarloConfig, MonteCarloResult } from './domain/montecarlo';
import type { Insight } from './domain/insight';
import type { ExportBundle } from './domain/documents';
import type { ValidationIssue } from './domain/results';

export const CONTRACT_VERSION = '1.2.0';

export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(`${fn} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

/** Injected context for every projection-style call. */
export interface EngineContext {
  /** Year 1 of the projection (the injected current calendar year). */
  currentYear: CalendarYear;
  rules: RulesSet;
}

// =============================================================================================
// Rules (module: rules/)
// =============================================================================================

/** The rule values in force for one tax year, after anchor/indexing resolution. */
export interface ResolvedYearRules {
  taxYear: CalendarYear;
  /** Year whose published values were the base; < taxYear means values were projected. */
  baseYear: CalendarYear;
  projected: boolean;
  values: TaxYearRules;
  standing: StandingRules;
}

// Implemented in M2 (rules/resolve.ts).
export { resolveRules } from './rules/resolve';

// =============================================================================================
// Income and contributions (modules: income/, match/, limits/)
// =============================================================================================

/**
 * One year of a person's employment income. Eligible compensation is BEFORE the 401(a)(17)
 * compensation limit; `capContributions` applies that limit. Years after the person stops working
 * have zero salary and bonus (part-time income may continue).
 */
export interface CompensationYear {
  year: CalendarYear;
  age: number;
  working: boolean;
  baseSalary: Cents;
  bonus: Cents;
  partTimeIncome: Cents;
  totalCompensation: Cents;
  eligibleCompForDeferrals: Cents;
  eligibleCompForMatch: Cents;
  nominalRaise: number;
  realRaise: number;
}

/** Salary/bonus path for one person for `years` years from year 1 (rule-free). */
export { computeCompensationPath } from './income/compensation'; // implemented in M2

export interface MatchBreakdown {
  /** Match earned per tier, in tier order. */
  perTier: Cents[];
  match: Cents;
  flat: Cents;
  total: Cents;
  /** Match if the employee deferred enough to capture every tier. */
  maxPossibleMatch: Cents;
  /** Deferral % of eligible pay needed to capture the full match. */
  pctToCaptureFullMatch: Fraction;
  dollarsToCaptureFullMatch: Cents;
  unclaimed: Cents;
}

/**
 * Tiered match on eligible compensation (already capped at the 401(a)(17) limit by the caller or by
 * `capContributions`). `employeeDeferral` is the employee's total deferral dollars for the year.
 */
export { computeMatch } from './match/match'; // implemented in M2

export interface ContributionRequest {
  year: CalendarYear;
  age: number;
  plan: WorkplacePlan;
  /** Requested deferral dollars before limits. */
  requestedTraditional: Cents;
  requestedRoth: Cents;
  /** Other 402(g)-aggregated deferrals this year (another 401(k)/403(b)). */
  otherAggregatedDeferrals: Cents;
  eligibleCompForMatch: Cents;
  priorYearFicaWages: Cents | null;
}

export interface CappedContributions {
  traditional: Cents;
  roth: Cents;
  /** Portion of the above that is catch-up. */
  catchUp: Cents;
  catchUpIsRoth: boolean;
  employerMatch: Cents;
  employerFlat: Cents;
  /** Requested minus allowed (never silently truncated: each cap produces a warning). */
  cappedAmount: Cents;
}

/** Apply 402(g), catch-up (50+, 60–63), Roth-catch-up, 401(a)(17) and 415(c) limits with warnings. */
export { capContributions } from './limits/workplace'; // implemented in M2

export interface RothIraEligibility {
  status: 'full' | 'reduced' | 'ineligible';
  magi: Cents;
  phaseOutStart: Cents;
  phaseOutEnd: Cents;
  /** Limit before phase-out (annual limit + catch-up), capped at earned income. */
  baseLimit: Cents;
  allowed: Cents;
  /** Human-readable reduction calculation, shown in the UI. */
  calculation: string;
}

export { rothIraEligibility } from './limits/ira'; // implemented in M2

/** Default MAGI estimate (documented simplification): salary + bonus - traditional deferrals - HSA. */
export { estimateMagi } from './limits/ira'; // implemented in M2

export { hsaLimit } from './limits/hsa'; // implemented in M2

export interface PersonPreviewRow {
  year: CalendarYear;
  age: number;
  compensation: CompensationYear;
  /** Employee deferrals implied by the elections, before any limit. */
  requestedTraditional: Cents;
  requestedRoth: Cents;
  /** Employer match on the requested deferrals before limits (always available; no rules needed). */
  matchBeforeLimits: MatchBreakdown;
  /** Workplace contributions after limits, summed over the person's plans; null if a limit is unverified. */
  contributions: CappedContributions | null;
  /** Employee + employer after limits; null if unverified. */
  totalSaved: Cents | null;
  /** totalSaved / total compensation; null if unverified or no compensation. */
  savingsRate: number | null;
  /** Vested share of employer money at the end of the year (first plan). */
  vestedFractionEndOfYear: number;
  warnings: EngineWarning[];
}

export interface CashFlowPreviewRow {
  year: CalendarYear;
  grossPay: Cents;
  /** Federal + FICA + state estimate; null if a tax rule is unverified. */
  taxes: TaxBreakdown | null;
  netPay: Cents | null;
  /** Workplace employee deferrals after limits plus scheduled IRA/HSA/taxable/cash contributions. */
  employeeContributions: Cents | null;
  spending: Cents;
  /** netPay − contributions − spending; null if unverified. */
  surplus: Cents | null;
  infeasible: boolean | null;
  /** Household-level warnings for the year (IRA/HSA caps, infeasible plan) plus each person's warnings. */
  warnings: EngineWarning[];
}

export interface AccumulationPreview {
  years: number;
  people: { personId: string; rows: PersonPreviewRow[] }[];
  cashFlow: CashFlowPreviewRow[];
  /** Rules that were null; outputs depending on them are null. */
  unverified: UnverifiedDetail[];
}

/**
 * Income & Savings live preview (M2): salary, bonus, contributions, match, limits and accumulation-phase
 * net-pay feasibility for the next `years` years. Always `ok`; parts that need null rules are null and
 * listed in `unverified`.
 */
export { previewAccumulation } from './income/preview'; // implemented in M2

// =============================================================================================
// Tax (module: tax/)
// =============================================================================================

export interface TaxInput {
  filingStatus: FilingStatus;
  /** Ages of the filers this year (for 65+ deductions). */
  ages: number[];
  wages: Cents;
  /** FICA wages per person (sums to `wages`); the Social Security wage base applies per person. */
  wagesByPerson: Cents[];
  /** Ordinary income other than wages and SS (traditional withdrawals, pensions, taxable other income). */
  otherOrdinaryIncome: Cents;
  socialSecurityBenefits: Cents;
  longTermCapitalGains: Cents;
  /** Pre-tax payroll deductions (traditional deferrals, HSA) excluded from federal taxable wages. */
  preTaxDeductions: Cents;
  stateTaxRate: Fraction;
}

export interface TaxBreakdown {
  taxableSocialSecurity: Cents;
  agi: Cents;
  deductions: Cents;
  taxableOrdinaryIncome: Cents;
  federalOrdinaryTax: Cents;
  capitalGainsTax: Cents;
  ficaSocialSecurity: Cents;
  ficaMedicare: Cents;
  stateTax: Cents;
  totalTax: Cents;
  marginalOrdinaryRate: number;
}

/** Simplified federal + flat state + FICA estimate (docs/financial-model.md §6). */
export { computeTax } from './tax/tax'; // implemented in M2

/** Taxable portion of Social Security via the provisional-income formula (Pub 915). */
export { taxableSocialSecurity } from './tax/tax'; // implemented in M2

export interface GrossUpSolution {
  /** Gross withdrawals by account id. */
  withdrawals: Record<string, Cents>;
  grossIncome: Cents;
  taxes: TaxBreakdown;
  netIncome: Cents;
  iterations: number;
  converged: boolean;
  /** Net need that could not be funded (depletion). */
  unfunded: Cents;
}

/**
 * Bounded fixed-point iteration: find withdrawals W such that net(W) = need within tolerance, where
 * taxes depend on W. Non-convergence returns the best iterate with `converged: false` and a warning.
 */
export function solveGrossUp(
  netNeed: Cents,
  state: GrossUpState,
  rules: ResolvedYearRules,
  opts: { maxIterations: number; toleranceCents: number },
): EngineResult<GrossUpSolution> {
  void netNeed;
  void state;
  void rules;
  void opts;
  throw new NotImplementedError('solveGrossUp');
}

/** The per-year state the solver needs (balances, bases, fixed income, strategy). Built by the projection. */
export interface GrossUpState {
  year: CalendarYear;
  household: Household;
  /** Available balance and basis per account at the withdrawal point. */
  balances: Record<string, { balance: Cents; basis: Cents }>;
  /** Income already fixed this year (SS, pensions, other, RMDs already taken). */
  fixedIncome: Omit<TaxInput, 'filingStatus' | 'ages' | 'stateTaxRate'>;
  filingStatus: FilingStatus;
  ages: number[];
  rmdTaken: Record<string, Cents>;
}

// =============================================================================================
// Social Security (module: socialSecurity/)
// =============================================================================================

export function fullRetirementAge(
  birthYear: CalendarYear,
  birthMonth: number,
  standing: StandingRules,
): EngineResult<AgeYearsMonths> {
  void birthYear;
  void birthMonth;
  void standing;
  throw new NotImplementedError('fullRetirementAge');
}

/** Own retirement benefit at a claiming age (early reduction or delayed credits), monthly. */
export function ssBenefitAtClaim(
  input: { piaMonthly: Cents; birthYear: CalendarYear; birthMonth: number; claimAge: AgeYearsMonths },
  standing: StandingRules,
): EngineResult<{ monthly: Cents; adjustmentFactor: number; monthsFromFra: number }> {
  void input;
  void standing;
  throw new NotImplementedError('ssBenefitAtClaim');
}

/** Illustrative PIA estimate — NOT an official SSA calculation. */
export function estimatePia(
  input:
    | { kind: 'average'; birthYear: CalendarYear; averageAnnualEarnings: Cents; yearsOfEarnings: number }
    | { kind: 'history'; birthYear: CalendarYear; earnings: { year: CalendarYear; earnings: Cents }[] },
  rules: RulesSet,
): EngineResult<{ piaMonthly: Cents; aimeMonthly: Cents; eligibilityYear: CalendarYear; label: string }> {
  void input;
  void rules;
  throw new NotImplementedError('estimatePia');
}

/** Spousal benefit on the other spouse's PIA, reduced for claiming before the spouse's FRA. */
export function spousalBenefit(
  input: {
    ownPiaMonthly: Cents;
    otherPiaMonthly: Cents;
    birthYear: CalendarYear;
    birthMonth: number;
    claimAge: AgeYearsMonths;
  },
  standing: StandingRules,
): EngineResult<{ monthlyExcess: Cents }> {
  void input;
  void standing;
  throw new NotImplementedError('spousalBenefit');
}

/** Survivor benefit (simple model, documented): the higher of own and deceased's benefit incl. DRCs. */
export function survivorBenefit(
  input: { survivorOwnMonthly: Cents; deceasedBenefitMonthly: Cents; deceasedPiaMonthly: Cents },
  standing: StandingRules,
): EngineResult<{ monthly: Cents }> {
  void input;
  void standing;
  throw new NotImplementedError('survivorBenefit');
}

// =============================================================================================
// RMD (module: rmd/)
// =============================================================================================

export function rmdStartAge(birthYear: CalendarYear, standing: StandingRules): EngineResult<number> {
  void birthYear;
  void standing;
  throw new NotImplementedError('rmdStartAge');
}

/** RMD for a year = prior Dec 31 balance / Uniform Lifetime Table period for the age in that year. */
export function rmdAmount(
  input: { age: number; priorYearEndBalance: Cents },
  standing: StandingRules,
): EngineResult<Cents> {
  void input;
  void standing;
  throw new NotImplementedError('rmdAmount');
}

// =============================================================================================
// Projection (module: projection/)
// =============================================================================================

export interface ProjectionOptions {
  /** Return offset applied to every account (optimistic/pessimistic lines). Default 0. */
  returnOffset?: number;
  /** Per-year return override sequence (Monte Carlo paths reuse the projection core). */
  returnOverride?: (yearIndex: number, accountId: string) => number | undefined;
  /** Per-year inflation override (stochastic inflation in Monte Carlo). */
  inflationOverride?: (yearIndex: number) => number | undefined;
}

/**
 * Deterministic year-by-year projection (annual or monthly per assumptions.granularity).
 * Returns `ok` even when some rules are null: dependent steps are excluded and listed in
 * `excludedFeatures` / `unverified`, and the UI must not present dependent outputs as numbers.
 * Returns `invalid` when the household fails schema validation.
 */
export function projectHousehold(
  household: Household,
  ctx: EngineContext,
  options?: ProjectionOptions,
): EngineResult<ProjectionResult> {
  void household;
  void ctx;
  void options;
  throw new NotImplementedError('projectHousehold');
}

// =============================================================================================
// Scenarios and optimizer (module: scenario/)
// =============================================================================================

export interface ScenarioApplication {
  /** Null when the result fails validation (see issues). */
  household: Household | null;
  appliedOps: number;
  orphaned: OrphanedOp[];
  issues: ValidationIssue[];
}

export function applyScenario(base: Household, scenario: Scenario): ScenarioApplication {
  void base;
  void scenario;
  throw new NotImplementedError('applyScenario');
}

/** Build preset scenario ops (A–G) for a base household. */
export function presetScenario(
  preset: ScenarioPreset,
  base: Household,
  params: Record<string, number | string | boolean>,
  ids: { scenarioId: string; name: string; baseProfileId: string },
): Scenario {
  void preset;
  void base;
  void params;
  void ids;
  throw new NotImplementedError('presetScenario');
}

export interface OptimizerResult {
  /** Earliest retirement age (primary person, or both shifted together) meeting the criterion; null if none. */
  earliestAge: number | null;
  evaluated: { age: number; success: boolean; endingBalanceReal: Cents; successRate: number | null }[];
  criterion: 'deterministic' | 'monteCarlo';
}

export function optimizeRetirementAge(
  household: Household,
  ctx: EngineContext,
  criterion: { kind: 'deterministic' } | { kind: 'monteCarlo'; config: MonteCarloConfig; minSuccessRate: number },
  range: { fromAge: number; toAge: number },
): EngineResult<OptimizerResult> {
  void household;
  void ctx;
  void criterion;
  void range;
  throw new NotImplementedError('optimizeRetirementAge');
}

// =============================================================================================
// Monte Carlo (module: montecarlo/)
// =============================================================================================

/** Run paths [pathStart, pathEnd). Pure; chunks from different workers merge identically. */
export function runMonteCarloChunk(
  household: Household,
  ctx: EngineContext,
  config: MonteCarloConfig,
  range: { pathStart: number; pathEnd: number },
): EngineResult<MonteCarloChunk> {
  void household;
  void ctx;
  void config;
  void range;
  throw new NotImplementedError('runMonteCarloChunk');
}

export function summarizeMonteCarlo(
  chunks: MonteCarloChunk[],
  config: MonteCarloConfig,
  firstYear: CalendarYear,
): MonteCarloResult {
  void chunks;
  void config;
  void firstYear;
  throw new NotImplementedError('summarizeMonteCarlo');
}

/** Positive semi-definite check (Cholesky with tolerance) for correlation matrices. */
export function isPositiveSemiDefinite(matrix: number[][], tolerance?: number): boolean {
  void matrix;
  void tolerance;
  throw new NotImplementedError('isPositiveSemiDefinite');
}

// =============================================================================================
// Calculators and insights (modules: calculators/, insights/)
// =============================================================================================

export type CalculatorId =
  | 'compoundInterest'
  | 'contribution401k'
  | 'matchOptimizer'
  | 'rothVsTraditional'
  | 'retirementAge'
  | 'savingsGap'
  | 'inflationPurchasingPower'
  | 'withdrawal'
  | 'ssClaimingComparison'
  | 'feeImpact'
  | 'lumpSumVsRecurring'
  | 'spendingPlanner'
  | 'coastFire'
  | 'baristaFire'
  | 'fiNumber';

/** Insights by what-if re-run of `projectHousehold`. */
export function computeInsights(household: Household, ctx: EngineContext): EngineResult<Insight[]> {
  void household;
  void ctx;
  throw new NotImplementedError('computeInsights');
}

// =============================================================================================
// IO (module: io/)
// =============================================================================================

/** CSV of projection rows; cells starting with = + - @ are escaped against formula injection. */
export function toCsv(result: ProjectionResult, opts: { dollarBasis: DollarBasis }): string {
  void result;
  void opts;
  throw new NotImplementedError('toCsv');
}

export function exportJson(bundle: ExportBundle): string {
  void bundle;
  throw new NotImplementedError('exportJson');
}

/** Parse, migrate and validate an export file. Malformed input yields `invalid` with clear messages. */
export function importJson(text: string): EngineResult<ExportBundle> {
  void text;
  throw new NotImplementedError('importJson');
}

// Implemented in M1.
export { migrate } from './io/migrate';
