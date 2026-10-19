/**
 * FROZEN ENGINE CONTRACT (CONTRACT_VERSION below). Signatures here change only with a version bump,
 * a note in docs/STATUS.md, and the main agent applying the change.
 *
 * Phase 0: every function is a stub that throws `NotImplementedError`. Milestones replace the bodies
 * (implementation lives in the module named in each comment) without changing the signatures.
 *
 * Purity: no Date.now(), no Math.random(), no globals. The current year and the PRNG are injected.
 */
import type { CalendarYear, Cents, FilingStatus, Fraction } from './domain/primitives';
import type { Household, WorkplacePlan } from './domain/household';
import type { RulesSet, StandingRules, TaxYearRules } from './domain/rules';
import type { EngineWarning, UnverifiedDetail } from './domain/results';
import type { OrphanedOp } from './domain/scenario';
import type { ProjectionResult } from './domain/projection';
import type { ValidationIssue } from './domain/results';

export { CONTRACT_VERSION } from './contractVersion';

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
  /** Total compensation this year (salary + bonus), for the 415(c) 100%-of-compensation test (contract 1.3.0). */
  compensation: Cents;
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
  /** Per workplace plan: requested deferrals (dollars and % of pay) and the pre-limit match readout. */
  plans: {
    planId: string;
    requestedTraditional: Cents;
    requestedRoth: Cents;
    /** Requested employee deferral as a share of eligible pay for the match. */
    deferralRate: number;
    matchBeforeLimits: MatchBreakdown;
  }[];
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
  /**
   * Scheduled (non-workplace) contributions per account this year: what the schedule asks for
   * (`requested`; null means "maximum allowed") and what is allowed after limits (null if unverified).
   */
  scheduled: { accountId: string; requested: Cents | null; allowed: Cents | null }[];
  /** Roth IRA eligibility for each person who owns a Roth IRA (null parts when unverified/unknown). */
  rothIra: RothIraYear[];
}

/** One person's Roth IRA eligibility in one year, with the MAGI it was computed from. */
export interface RothIraYear {
  personId: string;
  /** 'override' when the person entered MAGI; otherwise the documented household estimate. */
  magiSource: 'override' | 'estimate';
  /** Household estimate inputs (summed over both people for married filing jointly). Null = unknown. */
  magiComponents: {
    salary: Cents;
    bonus: Cents;
    partTimeIncome: Cents;
    traditionalDeferrals: Cents | null;
    hsaContributions: Cents | null;
  };
  magi: Cents | null;
  /** Traditional IRA contributions this year that share the limit; null when unknown. */
  otherIraContributions: Cents | null;
  eligibility: RothIraEligibility | null;
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
export { solveGrossUp } from './tax/grossUp'; // implemented in M4

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

export { fullRetirementAge } from './socialSecurity/socialSecurity'; // implemented in M4

/** Own retirement benefit at a claiming age (early reduction or delayed credits), monthly. */
export { ssBenefitAtClaim } from './socialSecurity/socialSecurity'; // implemented in M4

/** Illustrative PIA estimate — NOT an official SSA calculation. */
export { estimatePia } from './socialSecurity/socialSecurity'; // implemented in M4

/** Spousal benefit on the other spouse's PIA, reduced for claiming before the spouse's FRA. */
export { spousalBenefit } from './socialSecurity/socialSecurity'; // implemented in M4

/** Survivor benefit (simple model, documented): the higher of own and deceased's benefit incl. DRCs. */
export { survivorBenefit } from './socialSecurity/socialSecurity'; // implemented in M4

// =============================================================================================
// RMD (module: rmd/)
// =============================================================================================

export { rmdStartAge } from './rmd/rmd'; // implemented in M4

/** RMD for a year = prior Dec 31 balance / Uniform Lifetime Table period for the age in that year. */
export { rmdAmount } from './rmd/rmd'; // implemented in M4

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
 * `excludedFeatures` / `unverified` (for example, contributions as elected before unverified
 * limits), and the UI labels every dependent figure. Figures that would need a null rule value
 * directly (taxes, net pay) are null. Returns `invalid` when the household fails schema validation.
 * Implemented in M3 (projection/project.ts).
 */
export { projectHousehold } from './projection/project';

/** Dashboard cards (docs/financial-model.md §8): each with its dollar, tax and year basis. */
export interface DashboardCards {
  people: { personId: string; name: string; currentAge: number; retirementAge: number; yearsToRetirement: number }[];
  /** Σ account balances at the start of year 1 (nominal = today's dollars), gross of taxes. */
  currentSavings: Cents;
  /** First retirement-phase year (every living person retired). */
  firstRetirementYear: CalendarYear;
  /** Portfolio at the start of the first retirement year, gross. */
  savingsAtRetirement: { nominal: Cents; real: Cents };
  /** Income in the first retirement year / 12; `taxBasis` says whether taxes were subtracted. */
  monthlyRetirementIncome: { nominal: Cents; real: Cents; taxBasis: 'net' | 'beforeTaxes' };
  /** Spending need in the first retirement year / 12 (a net, after-tax need). */
  monthlyRetirementSpending: { nominal: Cents; real: Cents };
  /** monthlyRetirementIncome − monthlyRetirementSpending. */
  monthlySurplus: { nominal: Cents; real: Cents; taxBasis: 'net' | 'beforeTaxes' };
  longevity:
    | { kind: 'lastsThroughPlanningAge'; planningAge: number }
    /** `age` is the age that year of `personId`, the first listed person still alive then. */
    | { kind: 'depletes'; year: CalendarYear; age: number; personId: string };
  /** Labeled heuristic: on track = baseline and pessimistic succeed; borderline = baseline only; at risk = baseline fails. */
  readiness: { status: 'onTrack' | 'borderline' | 'atRisk'; baselineSuccess: boolean; pessimisticSuccess: boolean };
}

export interface DashboardResult {
  baseline: ProjectionResult;
  /** Reruns with the household's fixed return offsets (not confidence intervals). */
  optimistic: ProjectionResult;
  pessimistic: ProjectionResult;
  cards: DashboardCards;
}

/** Baseline, optimistic and pessimistic projections plus the dashboard cards. Implemented in M3. */
export { computeDashboard } from './projection/dashboard';

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

export { applyScenario } from './scenario/scenario'; // implemented in M5

/** Build preset scenario ops (A–G) for a base household. */
export { presetScenario } from './scenario/scenario'; // implemented in M5

/** Whether a preset's stored ops differ from a rebuild on the current base (contract 1.9.0). */
export { presetDrift } from './scenario/scenario';

/** Total change of a return sequence, Π(1 + r) − 1 (contract 1.9.0). */
export { marketShockTotal } from './scenario/scenario';

export interface OptimizerResult {
  /** Earliest retirement age (primary person, or both shifted together) meeting the criterion; null if none. */
  earliestAge: number | null;
  evaluated: { age: number; success: boolean; endingBalanceReal: Cents; successRate: number | null }[];
  criterion: 'deterministic' | 'monteCarlo';
  /** Monte Carlo criterion: the paths each age was scored on (paths 0 … n − 1, the quick-run count); null otherwise (contract 1.10.0). */
  monteCarloPaths: number | null;
}

/**
 * Earliest retirement age (first person; others shift by the same amount, salary stop ages cleared)
 * in the range meeting the criterion; every age is evaluated (a brute-force scan). Implemented in M5;
 * the Monte Carlo criterion arrives in M6.
 */
export { optimizeRetirementAge } from './scenario/scenario';

/** One outcome of a scenario comparison (base first). */
export interface ScenarioOutcome {
  /** Null for the base plan. */
  scenarioId: string | null;
  name: string;
  status: 'ok' | 'invalid';
  orphaned: OrphanedOp[];
  issues: ValidationIssue[];
  dashboard: DashboardResult | null;
  /** Real ending balance after an assumed liquidation tax on tax-deferred money; null while taxes are unverified. */
  afterTaxEndingBalanceReal: Cents | null;
}

/** Base plan plus each scenario, applied and projected (contract 1.8.0). */
export { compareScenarios } from './scenario/scenario';

// =============================================================================================
// Monte Carlo (module: montecarlo/)
// =============================================================================================

/**
 * Run paths [pathStart, pathEnd) (docs/financial-model.md §11). Pure; chunks from different workers
 * merge identically, because path i's numbers depend only on (seed, i). Implemented in M6.
 */
export { runMonteCarloChunk } from './montecarlo/run';

/** Prepare a run once and run its chunks (a worker reuses the preparation; contract 1.10.0). */
export { prepareMonteCarlo, runPreparedChunk, type PreparedMonteCarlo } from './montecarlo/run';

/**
 * Merge chunks into a result with the assumptions shown beside the success rate. Contract 1.9.0:
 * takes the household (for the capital-market assumptions and the minimum ending balance).
 */
export { summarizeMonteCarlo } from './montecarlo/run';

/** Arithmetic means implied by the geometric inputs, and the Monte Carlo readiness band (contract 1.10.0). */
export { impliedArithmeticMeans, monteCarloReadiness } from './montecarlo/run';

/** Positive semi-definite check (Cholesky with tolerance) for correlation matrices. */
export { isPositiveSemiDefinite } from './montecarlo/random';

/** Allocation view (c): year-end balances by asset class from target allocations (contract 1.9.0). */
export { allocationByAssetClass, type AssetClassYear } from './montecarlo/views';

/** Sequence-of-returns illustration: the same deviations in two orders (contract 1.9.0). */
export { sequenceRiskIllustration, SEQUENCE_DEVIATIONS, type SequenceRiskIllustration } from './montecarlo/views';

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

/**
 * The 15 calculators (docs/financial-model.md §12): thin wrappers that build engine inputs and call
 * the engine, with no formulas of their own. `CALCULATORS` / `runCalculator` index them by
 * `CalculatorId`. Implemented in M7a (contract 1.10.0).
 */
export * from './calculators/index';

/** Insights by what-if re-run of `projectHousehold` (docs/financial-model.md §13). Implemented in M7b. */
export { computeInsights } from './insights/insights';

// =============================================================================================
// IO (module: io/)
// =============================================================================================

/**
 * CSV of projection rows in the chosen dollar basis; cells starting with = + - @ (that are not plain
 * numbers) are escaped against formula injection. Optional display names (contract 1.9.0).
 */
export { toCsv, csvCell, type CsvOptions } from './io/csv';

/** Validated JSON export; import parses, migrates and validates with clear messages (M7b). */
export { exportJson, importJson, MAX_IMPORT_CHARS } from './io/json';

// Implemented in M1.
export { migrate } from './io/migrate';
