/**
 * Inputs for the Roth IRA eligibility readout. The formulas are the engine's (`estimateMagi`,
 * `rothIraEligibility`); this module only gathers this year's inputs from the household.
 */
import {
  estimateMagi,
  rothIraEligibility,
  type AccumulationPreview,
  type Cents,
  type EngineResult,
  type Household,
  type Person,
  type ResolvedYearRules,
  type RothIraEligibility,
} from '@rn/engine';
import {
  hsaThisYear,
  personYearOne,
  scheduledRequest,
  type PersonYearOne,
  type RothIraAccount,
} from '@/features/accounts/thisYear';

export interface MagiEstimate {
  salary: number;
  bonus: number;
  partTimeIncome: number;
  traditionalDeferrals: number;
  hsaContributions: number;
  estimate: Cents;
  /** Married filing jointly: both people's pay is combined. */
  joint: boolean;
  /** Workplace deferrals are the requested amounts because the plan limits are unverified. */
  deferralsBeforeLimits: boolean;
  /** HSA contributions are the requested amounts because the HSA limit is unverified. */
  hsaBeforeLimit: boolean;
  /** An HSA set to "maximum allowed" is left out because its limit is unverified. */
  hsaMaxExcluded: boolean;
}

/** Household MAGI default estimate for this year (documented simplification; user-overridable). */
export function householdMagiEstimate(
  household: Household,
  preview: AccumulationPreview | null,
  year: number,
  rules: ResolvedYearRules,
): MagiEstimate {
  const years = new Map(household.people.map((p) => [p.id, personYearOne(preview, p, year)]));
  let salary = 0;
  let bonus = 0;
  let partTimeIncome = 0;
  let traditionalDeferrals = 0;
  let deferralsBeforeLimits = false;
  for (const y of years.values()) {
    salary += y.baseSalary;
    bonus += y.bonus;
    partTimeIncome += y.partTimeIncome;
    traditionalDeferrals += y.traditionalDeferrals;
    deferralsBeforeLimits ||= y.deferralsBeforeLimits;
  }
  let hsaContributions = 0;
  let hsaBeforeLimit = false;
  let hsaMaxExcluded = false;
  for (const account of household.accounts) {
    if (account.type !== 'hsa') continue;
    const ownerYear = years.get(account.ownerId);
    if (!ownerYear) continue;
    const hsa = hsaThisYear(account, ownerYear, preview, rules);
    if (hsa.planned === null) hsaMaxExcluded = true;
    else hsaContributions += hsa.planned;
    hsaBeforeLimit ||= hsa.beforeLimit;
  }
  const estimate = estimateMagi({
    salary: salary as Cents,
    bonus: bonus as Cents,
    traditionalDeferrals: traditionalDeferrals as Cents,
    hsaContributions: hsaContributions as Cents,
    otherIncome: partTimeIncome as Cents,
  });
  return {
    salary,
    bonus,
    partTimeIncome,
    traditionalDeferrals,
    hsaContributions,
    estimate,
    joint: household.filingStatus === 'marriedFilingJointly',
    deferralsBeforeLimits,
    hsaBeforeLimit,
    hsaMaxExcluded,
  };
}

export function rothAccountsOf(household: Household, personId: string): RothIraAccount[] {
  return household.accounts.filter((a): a is RothIraAccount => a.type === 'rothIra' && a.ownerId === personId);
}

export interface RothReadout {
  personYear: PersonYearOne;
  magi: number;
  magiSource: 'override' | 'estimate';
  /** This year's planned Roth IRA contribution, or "max" (the allowed amount). */
  planned: number | 'max';
  result: EngineResult<RothIraEligibility>;
  /** A traditional IRA set to "maximum allowed" shares the limit but is not counted here. */
  traditionalMaxNotCounted: boolean;
}

export function rothReadout(
  household: Household,
  person: Person,
  preview: AccumulationPreview | null,
  magi: MagiEstimate,
  year: number,
  rules: ResolvedYearRules,
): RothReadout {
  const personYear = personYearOne(preview, person, year);
  const roths = rothAccountsOf(household, person.id);
  const override = roths.find((a) => a.magiOverride !== null)?.magiOverride ?? null;

  let planned: number | 'max' = 0;
  for (const account of roths) {
    const amount = scheduledRequest(preview, account.id);
    planned = planned === 'max' || amount === 'max' ? 'max' : planned + amount;
  }
  let otherIra = 0;
  let traditionalMaxNotCounted = false;
  for (const account of household.accounts) {
    if (account.type !== 'traditionalIra' || account.ownerId !== person.id) continue;
    const amount = scheduledRequest(preview, account.id);
    if (amount === 'max') traditionalMaxNotCounted = true;
    else otherIra += amount;
  }

  const magiValue = override ?? magi.estimate;
  const result = rothIraEligibility(
    {
      magi: magiValue as Cents,
      filingStatus: household.filingStatus,
      age: personYear.age,
      earnedIncome: personYear.earnedIncome as Cents,
      otherIraContributions: otherIra as Cents,
    },
    rules,
  );
  return {
    personYear,
    magi: magiValue,
    magiSource: override === null ? 'estimate' : 'override',
    planned,
    result,
    traditionalMaxNotCounted,
  };
}
