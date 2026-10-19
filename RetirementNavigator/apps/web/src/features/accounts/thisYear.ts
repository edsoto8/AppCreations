/**
 * Year-1 figures shared by the Roth IRA and HSA pages, read from the engine's accumulation preview.
 * The UI does no limit arithmetic of its own: allowed amounts come from `cashFlow[0].scheduled`.
 */
import {
  hsaLimit,
  previewAccumulation,
  type Account,
  type AccumulationPreview,
  type Cents,
  type EngineContext,
  type EngineResult,
  type Household,
  type Person,
  type ResolvedYearRules,
} from '@rn/engine';

export type HsaAccount = Extract<Account, { type: 'hsa' }>;
export type RothIraAccount = Extract<Account, { type: 'rothIra' }>;

/** One-year accumulation preview (always `ok` for a valid household; null otherwise). */
export function previewYearOne(household: Household, ctx: EngineContext): AccumulationPreview | null {
  const result = previewAccumulation(household, ctx, 1);
  return result.status === 'ok' ? result.value : null;
}

/** The person's age this year (from the preview when available). */
export function ageThisYear(preview: AccumulationPreview | null, person: Person, currentYear: number): number {
  return preview?.people.find((p) => p.personId === person.id)?.rows[0]?.age ?? currentYear - person.birthYear;
}

export interface ScheduledThisYear {
  /** What the schedule asks for ('max' = "maximum allowed"; 0 when not active this year). */
  requested: number | 'max';
  /** What the engine allows after limits; null when a limit it needs is unverified. */
  allowed: number | null;
}

/** This year's scheduled contribution for a non-workplace account, from the engine preview. */
export function scheduledThisYear(preview: AccumulationPreview | null, accountId: string): ScheduledThisYear {
  const entry = preview?.cashFlow[0]?.scheduled.find((s) => s.accountId === accountId);
  if (!entry) return { requested: 0, allowed: 0 };
  return { requested: entry.requested ?? 'max', allowed: entry.allowed };
}

export interface HsaThisYear extends ScheduledThisYear {
  /** The owner's HSA limit for this account's coverage (shown next to the allowed amount). */
  limit: EngineResult<Cents>;
}

export function hsaThisYear(
  account: HsaAccount,
  ownerAge: number,
  preview: AccumulationPreview | null,
  rules: ResolvedYearRules,
): HsaThisYear {
  const limit = hsaLimit({ coverage: account.coverage, age: ownerAge, hdhpAttested: account.hdhpAttested }, rules);
  return { limit, ...scheduledThisYear(preview, account.id) };
}
