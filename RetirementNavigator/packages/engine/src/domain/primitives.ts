/**
 * Primitive value types shared by every contract.
 *
 * Conventions (see docs/financial-model.md §1):
 * - Money crossing a public engine boundary, storage or export is integer cents (`Cents`).
 * - Rates are decimals (0.07, not 7). Nominal and real rates are distinct branded types.
 * - Calendar years are integers; a person's age in a year is `year - birthYear`.
 */
import { z } from 'zod';

/** Integer number of US cents. Safe-integer range only. */
export const CentsSchema = z
  .number()
  .int()
  .refine(Number.isSafeInteger, { message: 'Amount is too large' })
  .brand<'Cents'>();
export type Cents = z.infer<typeof CentsSchema>;
export const ZERO_CENTS = 0 as Cents;

/** Non-negative cents (balances, salaries, limits). */
export const NonNegativeCentsSchema = z
  .number()
  .int()
  .min(0, { message: 'Amount cannot be negative' })
  .refine(Number.isSafeInteger, { message: 'Amount is too large' })
  .brand<'Cents'>();

/** A nominal annual rate as a decimal. Bounded to keep inputs sane; -100% .. +100%. */
export const NominalRateSchema = z
  .number()
  .min(-1, { message: 'Rate must be at least -100%' })
  .max(1, { message: 'Rate must be at most 100%' })
  .brand<'NominalRate'>();
export type NominalRate = z.infer<typeof NominalRateSchema>;

/** A real (inflation-adjusted) annual rate as a decimal. */
export const RealRateSchema = z
  .number()
  .min(-1, { message: 'Rate must be at least -100%' })
  .max(1, { message: 'Rate must be at most 100%' })
  .brand<'RealRate'>();
export type RealRate = z.infer<typeof RealRateSchema>;

/** A share or percentage in [0, 1] (contribution %, taxable %, allocation weight). */
export const FractionSchema = z
  .number()
  .min(0, { message: 'Must be at least 0%' })
  .max(1, { message: 'Must be at most 100%' });
export type Fraction = z.infer<typeof FractionSchema>;

export const CalendarYearSchema = z.number().int().min(1900).max(2200);
export type CalendarYear = z.infer<typeof CalendarYearSchema>;

/** Whole-year age. */
export const AgeSchema = z.number().int().min(0).max(120);
export type Age = z.infer<typeof AgeSchema>;

/** Age with months, used where SSA rules count months (claiming age, FRA). */
export const AgeYearsMonthsSchema = z.object({
  years: z.number().int().min(0).max(120),
  months: z.number().int().min(0).max(11),
});
export type AgeYearsMonths = z.infer<typeof AgeYearsMonthsSchema>;

/** Stable entity identifier (scenario diffs are keyed by these). */
export const EntityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, { message: 'Invalid identifier' })
  .brand<'EntityId'>();
export type EntityId = z.infer<typeof EntityIdSchema>;

/** ISO-8601 date (YYYY-MM-DD). Dates are injected, never read from the clock inside the engine. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected YYYY-MM-DD' });
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Supported filing statuses (MVP). Others are listed as unsupported and not selectable. */
export const FilingStatusSchema = z.enum(['single', 'marriedFilingJointly']);
export type FilingStatus = z.infer<typeof FilingStatusSchema>;

/** Which dollar basis a displayed or exported figure uses. */
export const DollarBasisSchema = z.enum(['todays', 'nominal']);
export type DollarBasis = z.infer<typeof DollarBasisSchema>;
