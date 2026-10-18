/**
 * Regulatory rule values. Every value is a `Verified<T>`: either a sourced value, or null with an
 * `unverifiedReason`. The engine NEVER substitutes a default for a null value; any calculation that
 * needs one returns `{ status: 'unverified' }` (see results.ts).
 *
 * Two collections:
 * - `TaxYearRules`: calendar-year values (limits, brackets, wage base, bend points for that year).
 * - `StandingRules`: values not tied to one tax year (FRA table, reduction formulas, RMD table,
 *   statutory thresholds, AWI series).
 *
 * Data files live in `packages/engine/src/rules/<taxYear>.ts` and `rules/standing.ts`.
 */
import { z } from 'zod';
import { CalendarYearSchema, IsoDateSchema, NonNegativeCentsSchema } from './primitives';

// ---------------------------------------------------------------------------------------------
// Verified<T>
// ---------------------------------------------------------------------------------------------

export const RuleSourceSchema = z.object({
  /** Publication name/number, e.g. "IRS Notice 2025-67". */
  publication: z.string().min(1),
  url: z.url().refine((u) => /^https:\/\/(www\.|www-origin\.|eitc\.)?(irs\.gov|ssa\.gov|federalregister\.gov)\//.test(u), {
    message: 'Sources must be irs.gov, ssa.gov or federalregister.gov',
  }),
  /** Section, table or page within the publication. */
  locator: z.string().nullable().default(null),
  retrievedOn: IsoDateSchema,
  /**
   * How the value was read. `primary-document` = the document itself was read.
   * `search-excerpt` = only a search-engine excerpt of the official page was seen.
   */
  method: z.enum(['primary-document', 'search-excerpt']),
});
export type RuleSource = z.infer<typeof RuleSourceSchema>;

export const IndexationSchema = z.enum(['indexed', 'statutory-fixed']);
export type Indexation = z.infer<typeof IndexationSchema>;

/** How an indexed value is rounded after indexing (as published by the agency). */
export const RoundingSchema = z.object({
  mode: z.enum(['down', 'nearest', 'up']),
  /** In dollars, e.g. 500 for "rounded down to the next lower multiple of $500". */
  incrementDollars: z.number().positive(),
});
export type Rounding = z.infer<typeof RoundingSchema>;

/** Build the Verified<T> schema for a given inner value schema. */
export function verified<T extends z.ZodType>(inner: T) {
  return z.discriminatedUnion('status', [
    z.object({
      status: z.literal('verified'),
      value: inner,
      source: RuleSourceSchema,
      secondSource: RuleSourceSchema.nullable().default(null),
      indexation: IndexationSchema,
      rounding: RoundingSchema.nullable().default(null),
      /** Last tax year the provision applies under current law; null = no sunset. */
      sunsetYear: CalendarYearSchema.nullable().default(null),
      notes: z.string().nullable().default(null),
    }),
    z.object({
      status: z.literal('unverified'),
      value: z.null(),
      source: z.null(),
      unverifiedReason: z.string().min(1),
      indexation: IndexationSchema.nullable().default(null),
      /** A candidate value seen but not confirmed at source. Display only; the engine never reads it. */
      candidate: z.object({ value: inner, source: RuleSourceSchema }).nullable().default(null),
    }),
    z.object({
      /** The agency has not yet published this year's value; the indexer may project from a prior year. */
      status: z.literal('notPublished'),
      value: z.null(),
      source: z.null(),
      unverifiedReason: z.string().min(1),
      indexation: IndexationSchema.nullable().default(null),
    }),
  ]);
}
export type Verified<T> =
  | {
      status: 'verified';
      value: T;
      source: RuleSource;
      secondSource: RuleSource | null;
      indexation: Indexation;
      rounding: Rounding | null;
      sunsetYear: number | null;
      notes: string | null;
    }
  | {
      status: 'unverified';
      value: null;
      source: null;
      unverifiedReason: string;
      indexation: Indexation | null;
      candidate: { value: T; source: RuleSource } | null;
    }
  | { status: 'notPublished'; value: null; source: null; unverifiedReason: string; indexation: Indexation | null };

const Money = NonNegativeCentsSchema;
const Rate = z.number().min(0).max(1);

export const PhaseOutRangeSchema = z
  .object({ start: Money, end: Money })
  .refine((r) => r.end > r.start, { message: 'Phase-out end must exceed start' });
export type PhaseOutRange = z.infer<typeof PhaseOutRangeSchema>;

/** Ordinary brackets: ascending lower bounds of taxable income; first bracket starts at 0. */
export const BracketsSchema = z
  .array(z.object({ rate: Rate, lowerBound: Money }))
  .min(1)
  .refine((b) => b[0]?.lowerBound === 0 && b.every((x, i) => i === 0 || x.lowerBound > (b[i - 1]?.lowerBound ?? 0)), {
    message: 'Brackets must start at 0 and ascend',
  });
export type Brackets = z.infer<typeof BracketsSchema>;

/** Long-term capital gains: taxable-income tops of the 0% and 15% brackets. */
export const LtcgBreakpointsSchema = z.object({ zeroRateMax: Money, fifteenRateMax: Money });

export const PerStatusSchema = <T extends z.ZodType>(inner: T) =>
  z.object({ single: inner, marriedFilingJointly: inner });

// ---------------------------------------------------------------------------------------------
// Tax-year rules
// ---------------------------------------------------------------------------------------------

export const TaxYearRulesSchema = z.object({
  taxYear: CalendarYearSchema,
  workplace: z.object({
    /** IRC 402(g) elective deferral limit (401(k)/403(b); 457(b) has its own equal limit). */
    electiveDeferral: verified(Money),
    catchUp50: verified(Money),
    /** SECURE 2.0 enhanced catch-up for ages 60–63. */
    catchUp60to63: verified(Money),
    /** IRC 415(c) annual additions (employee + employer, excluding catch-up). */
    annualAdditions: verified(Money),
    /** IRC 401(a)(17) compensation limit. */
    compensationLimit: verified(Money),
    /** Prior-year FICA wages above which catch-ups must be Roth. */
    rothCatchUpWageThreshold: verified(Money),
    /** Whether the mandatory-Roth-catch-up rule is modeled as in force for this tax year. */
    rothCatchUpInForce: verified(z.boolean()),
  }),
  ira: z.object({
    limit: verified(Money),
    catchUp50: verified(Money),
    rothPhaseOut: PerStatusSchema(verified(PhaseOutRangeSchema)),
  }),
  hsa: z.object({
    selfOnly: verified(Money),
    family: verified(Money),
    catchUp55: verified(Money),
  }),
  tax: z.object({
    brackets: PerStatusSchema(verified(BracketsSchema)),
    standardDeduction: PerStatusSchema(verified(Money)),
    /** Additional standard deduction per person aged 65+ (unmarried vs married amounts). */
    additionalStandardDeduction65: z.object({ unmarried: verified(Money), married: verified(Money) }),
    /** Temporary additional deduction for people 65+ (amount per eligible person, MAGI phase-out). */
    seniorDeduction: z.object({
      amountPerPerson: verified(Money),
      phaseOutStart: PerStatusSchema(verified(Money)),
      phaseOutRate: verified(Rate),
    }),
    ltcg: PerStatusSchema(verified(LtcgBreakpointsSchema)),
  }),
  payroll: z.object({
    /** OASDI taxable maximum (wage base). */
    ssWageBase: verified(Money),
  }),
  socialSecurity: z.object({
    /** PIA bend points for workers first eligible (turning 62) in this year. Monthly dollars → cents. */
    bendPoints: verified(z.object({ first: Money, second: Money })),
    /** COLA effective with January benefits of this year (history; projections use the assumption). */
    colaEffectiveJanuary: verified(z.number().min(-0.1).max(0.2)),
  }),
});
export type TaxYearRules = z.infer<typeof TaxYearRulesSchema>;

// ---------------------------------------------------------------------------------------------
// Standing rules (not tied to one tax year)
// ---------------------------------------------------------------------------------------------

export const FraEntrySchema = z.object({
  fromBirthYear: CalendarYearSchema,
  toBirthYear: CalendarYearSchema.nullable(),
  years: z.number().int(),
  months: z.number().int().min(0).max(11),
});

export const StandingRulesSchema = z.object({
  payroll: z.object({ oasdiEmployeeRate: verified(Rate), medicareEmployeeRate: verified(Rate) }),
  ssBenefitTaxation: z.object({
    /** Provisional-income thresholds for 50% and 85% inclusion. */
    thresholds: PerStatusSchema(verified(z.object({ base: Money, adjustedBase: Money }))),
    maxInclusion: verified(z.object({ tier1: Rate, tier2: Rate })),
  }),
  rmd: z.object({
    startAgeByBirthYear: verified(
      z.array(z.object({ fromBirthYear: CalendarYearSchema, toBirthYear: CalendarYearSchema.nullable(), age: z.number().int() })),
    ),
    /** Uniform Lifetime Table: age -> distribution period. */
    uniformLifetimeTable: verified(z.array(z.object({ age: z.number().int(), period: z.number().positive() }))),
    roth401kLifetimeRmdRequired: verified(z.boolean()),
  }),
  roth: z.object({
    qualifiedAgeMonths: verified(z.number().int()),
    fiveYearRuleYears: verified(z.number().int()),
  }),
  socialSecurity: z.object({
    fraByBirthYear: verified(z.array(FraEntrySchema)),
    earlyReduction: verified(z.object({ first36PerMonth: Rate, beyond36PerMonth: Rate })),
    delayedCreditPerMonth: verified(Rate),
    delayedCreditMaxAge: verified(z.number().int()),
    spousal: verified(z.object({ maxShareOfPia: Rate, first36PerMonth: Rate, beyond36PerMonth: Rate })),
    survivor: verified(z.object({ maxShareOfDeceased: Rate, ribLimFloorShareOfPia: Rate })),
    piaFactors: verified(z.tuple([Rate, Rate, Rate])),
    /** National average wage index by year (dollars → cents). */
    awiSeries: verified(z.array(z.object({ year: CalendarYearSchema, awi: Money }))),
    /** Windfall Elimination Provision / Government Pension Offset repealed for current benefits. */
    wepGpoRepealed: verified(z.boolean()),
  }),
});
export type StandingRules = z.infer<typeof StandingRulesSchema>;

export const RulesSetSchema = z.object({
  standing: StandingRulesSchema,
  /** Keyed by tax year as a string (JSON-friendly). */
  years: z.record(z.string().regex(/^\d{4}$/), TaxYearRulesSchema),
});
export type RulesSet = z.infer<typeof RulesSetSchema>;

/** Dotted path to a rule value, e.g. "2026:workplace.electiveDeferral" or "standing:rmd.uniformLifetimeTable". */
export type RuleKey = `${'standing' | number}:${string}`;
