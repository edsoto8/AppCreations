/**
 * Deterministic projection output: one row per calendar year from year 1 (the injected current
 * year) through the longer-lived person's planning age.
 *
 * Every money field is integer cents, NOMINAL unless it sits under `real`. Rows are computed in
 * float64 and converted to cents once on output (round half to even, docs/financial-model.md §1.3).
 * Invariant per account and per row: start + contributions + growthNet - withdrawals = end (±1 cent).
 */
import { z } from 'zod';
import { CalendarYearSchema, CentsSchema, EntityIdSchema, FilingStatusSchema } from './primitives';

const C = CentsSchema;

export const PhaseSchema = z.enum(['accumulation', 'retirement']);
export type Phase = z.infer<typeof PhaseSchema>;

export const PersonYearSchema = z.object({
  personId: EntityIdSchema,
  age: z.number().int(),
  alive: z.boolean(),
  retired: z.boolean(),
  baseSalary: C,
  bonus: C,
  partTimeIncome: C,
  totalCompensation: C,
  eligibleCompForDeferrals: C,
  eligibleCompForMatch: C,
  /** Nominal raise applied this year, and the implied real raise ((1+n)/(1+i) - 1). */
  nominalRaise: z.number(),
  realRaise: z.number(),
  employeeTraditional: C,
  employeeRoth: C,
  catchUp: C,
  employerMatch: C,
  employerFlat: C,
  socialSecurity: C,
  pension: C,
});
export type PersonYear = z.infer<typeof PersonYearSchema>;

export const AccountYearSchema = z.object({
  accountId: EntityIdSchema,
  start: C,
  contributions: C,
  /** Employer part of `contributions` (workplace accounts). */
  employerContributions: C,
  growthGross: C,
  /** Fee shadow figure: growthNet = growthGross - feeDrag. */
  feeDrag: C,
  growthNet: C,
  /** Money leaving the account: spending withdrawals plus any forfeiture (see `forfeited`). */
  withdrawals: C,
  /** Of `withdrawals`, the required minimum distribution. */
  rmd: C,
  /** Of `withdrawals`, unvested employer money forfeited at separation (taken at the start of the year). */
  forfeited: C,
  end: C,
  /** Taxable: cost basis at year end. Roth IRA: contribution basis at year end. Otherwise 0. */
  basisEnd: C,
  appliedReturn: z.number(),
});
export type AccountYear = z.infer<typeof AccountYearSchema>;

export const TaxYearDetailSchema = z.object({
  filingStatus: FilingStatusSchema,
  wages: C,
  ordinaryIncome: C,
  taxableSocialSecurity: C,
  capitalGains: C,
  agi: C,
  deductions: C,
  taxableIncome: C,
  federalOrdinaryTax: C,
  capitalGainsTax: C,
  ficaSocialSecurity: C,
  ficaMedicare: C,
  stateTax: C,
  totalTax: C,
  marginalOrdinaryRate: z.number(),
  solver: z.object({ iterations: z.number().int(), converged: z.boolean() }),
});
export type TaxYearDetail = z.infer<typeof TaxYearDetailSchema>;

export const YearRowSchema = z.object({
  year: CalendarYearSchema,
  /** 1-based year index. */
  index: z.number().int().min(1),
  phase: PhaseSchema,
  /** Price level relative to the start of year 1 (1 at year 1). Real = nominal / deflator. */
  deflator: z.number().positive(),
  people: z.array(PersonYearSchema),
  accounts: z.array(AccountYearSchema),
  flows: z.object({
    contributions: C,
    employerContributions: C,
    growthGross: C,
    feeDrag: C,
    growthNet: C,
    /** Spending withdrawals (excludes forfeitures), including RMDs and HSA medical withdrawals. */
    withdrawals: C,
    /** Of `withdrawals`, required minimum distributions. */
    rmd: C,
    /** Of `withdrawals`, tax-free HSA withdrawals for qualified medical expenses. */
    hsaMedical: C,
    /** RMD (or fixed income) beyond the year's need, reinvested after tax in a taxable or cash account. */
    reinvested: C,
    /** Unvested employer money forfeited at separation. */
    forfeited: C,
    /** Accumulation-phase surplus added to the surplus account. */
    surplusRouted: C,
    socialSecurity: C,
    pensions: C,
    otherIncome: C,
    oneTimeInflows: C,
    oneTimeOutflows: C,
    /** Net spending need for the year (spending steps, glide, healthcare line item, survivor reduction). */
    spendingNeed: C,
    /** Spending actually funded; < spendingNeed after depletion. */
    spendingFunded: C,
    shortfall: C,
  }),
  cashFlow: z.object({
    /** Null when a tax rule it needs is unverified (taxes are never filled in). */
    netPay: C.nullable(),
    employeeContributions: C,
    /** netPay - employee contributions - spending (accumulation phase). Negative => infeasible. Null when unknown. */
    surplus: C.nullable(),
    /** Null when unknown (taxes unverified) or in the retirement phase. */
    infeasible: z.boolean().nullable(),
  }),
  tax: TaxYearDetailSchema.nullable(),
  totals: z.object({
    portfolioStart: C,
    portfolioEnd: C,
    byTaxTreatment: z.object({ taxDeferred: C, taxFree: C, taxable: C }),
  }),
  real: z.object({
    portfolioEnd: C,
    spendingNeed: C,
    grossIncome: C,
    netIncome: C.nullable(),
  }),
  /** Earned income + other income (+ spending withdrawals in the retirement phase), before taxes. */
  grossIncome: C,
  /** grossIncome − taxes; null when taxes are not computed (unverified rules, or retirement-phase taxes before M4). */
  netIncome: C.nullable(),
  depleted: z.boolean(),
  /** Events in this year for chart markers. */
  markers: z.array(z.enum(['retirement', 'firstDeath', 'secondDeath', 'depletion'])),
});
export type YearRow = z.infer<typeof YearRowSchema>;

export const ProjectionSummarySchema = z.object({
  firstYear: CalendarYearSchema,
  lastYear: CalendarYearSchema,
  /** First retirement-phase year: every living person is retired (firstYear if already retired). */
  retirementYear: CalendarYearSchema,
  firstDeathYear: CalendarYearSchema.nullable(),
  depletionYear: CalendarYearSchema.nullable(),
  /** Age in the depletion year of the first listed person still alive that year. */
  depletionAge: z.number().int().nullable(),
  endingBalance: C,
  endingBalanceReal: C,
  infeasibleYears: z.array(CalendarYearSchema),
  /** Deterministic success: no depletion before planning age and ending balance ≥ minimum. */
  deterministicSuccess: z.boolean(),
});
export type ProjectionSummary = z.infer<typeof ProjectionSummarySchema>;

export const ProjectionResultSchema = z.object({
  contractVersion: z.string(),
  granularity: z.enum(['annual', 'monthly']),
  rows: z.array(YearRowSchema),
  summary: ProjectionSummarySchema,
  /**
   * Rule-dependent steps that were skipped because a needed rule value is null (for example
   * `workplaceLimits`: contributions are as elected, before limits). Dependent figures are labeled.
   */
  excludedFeatures: z.array(z.string()),
  /** Rules that were null and the features they block (outputs depending on these are not shown as numbers). */
  unverified: z.array(z.object({ key: z.string(), reason: z.string(), features: z.array(z.string()) })),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), year: z.number().optional() })),
});
export type ProjectionResult = z.infer<typeof ProjectionResultSchema>;
