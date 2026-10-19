/**
 * Year-1 figures shared by the Roth IRA and HSA pages: each person's pay from the engine's
 * accumulation preview, and the contributions the account schedules ask for this year, capped by the
 * engine's limit functions when those limits are verified.
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

export interface PersonYearOne {
  personId: string;
  age: number;
  baseSalary: number;
  bonus: number;
  partTimeIncome: number;
  /** Salary + bonus + part-time income (earned income for the IRA cap). */
  earnedIncome: number;
  /** Traditional workplace deferrals after limits, or the requested amount when limits are unverified. */
  traditionalDeferrals: number;
  /** True when `traditionalDeferrals` is the requested amount before (unverified) limits. */
  deferralsBeforeLimits: boolean;
}

/** One-year accumulation preview (always `ok` for a valid household; null otherwise). */
export function previewYearOne(household: Household, ctx: EngineContext): AccumulationPreview | null {
  const result = previewAccumulation(household, ctx, 1);
  return result.status === 'ok' ? result.value : null;
}

export function personYearOne(preview: AccumulationPreview | null, person: Person, currentYear: number): PersonYearOne {
  const row = preview?.people.find((p) => p.personId === person.id)?.rows[0];
  if (!row) {
    return {
      personId: person.id,
      age: currentYear - person.birthYear,
      baseSalary: 0,
      bonus: 0,
      partTimeIncome: 0,
      earnedIncome: 0,
      traditionalDeferrals: 0,
      deferralsBeforeLimits: false,
    };
  }
  const c = row.compensation;
  return {
    personId: person.id,
    age: row.age,
    baseSalary: c.baseSalary,
    bonus: c.bonus,
    partTimeIncome: c.partTimeIncome,
    earnedIncome: c.totalCompensation,
    traditionalDeferrals: row.contributions?.traditional ?? row.requestedTraditional,
    deferralsBeforeLimits: row.contributions === null && row.requestedTraditional > 0,
  };
}

/**
 * This year's scheduled request for a non-workplace account, from the engine preview
 * ('max' = "maximum allowed"; 0 when the schedule is not active this year).
 */
export function scheduledRequest(preview: AccumulationPreview | null, accountId: string): number | 'max' {
  const entry = preview?.cashFlow[0]?.scheduled.find((s) => s.accountId === accountId);
  if (!entry) return 0;
  return entry.requested === null ? 'max' : entry.requested;
}

export interface HsaThisYear {
  /** The engine's limit result for this account's owner and coverage. */
  limit: EngineResult<Cents>;
  /** The schedule's request this year (null for "maximum allowed", which needs the limit). */
  requested: number | 'max';
  /** The contribution after the limit; null when the limit is unverified and needed. */
  planned: number | null;
  /** True when `planned` is the request before an unverified limit. */
  beforeLimit: boolean;
}

export function hsaThisYear(
  account: HsaAccount,
  ownerYear: PersonYearOne,
  preview: AccumulationPreview | null,
  rules: ResolvedYearRules,
): HsaThisYear {
  const limit = hsaLimit({ coverage: account.coverage, age: ownerYear.age, hdhpAttested: account.hdhpAttested }, rules);
  const requested = scheduledRequest(preview, account.id);
  if (limit.status === 'ok') {
    const planned = requested === 'max' ? limit.value : Math.min(requested, limit.value);
    return { limit, requested, planned, beforeLimit: false };
  }
  if (requested === 'max') return { limit, requested, planned: null, beforeLimit: false };
  return { limit, requested, planned: requested, beforeLimit: requested > 0 };
}
