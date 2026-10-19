/**
 * IRA limits and Roth IRA eligibility (docs/financial-model.md §3.6–3.7).
 * Spousal IRA contributions for a non-working spouse are unsupported: each IRA is capped at the
 * person's own earned income.
 */
import type { Cents, FilingStatus } from '../domain/primitives';
import type { EngineResult, EngineWarning } from '../domain/results';
import type { ResolvedYearRules, RothIraEligibility } from '../api';
import { RuleAccess, unverified } from '../rules/access';

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * Default MAGI estimate (documented simplification, user-overridable):
 * salary + bonus − traditional deferrals − HSA contributions + other taxable income, floored at 0.
 */
export function estimateMagi(input: {
  salary: Cents;
  bonus: Cents;
  traditionalDeferrals: Cents;
  hsaContributions: Cents;
  otherIncome: Cents;
}): Cents {
  return Math.max(
    0,
    input.salary + input.bonus - input.traditionalDeferrals - input.hsaContributions + input.otherIncome,
  ) as Cents;
}

/** Annual IRA limit for a person (limit + 50+ catch-up), before earned-income and phase-out caps. */
export function iraContributionLimit(age: number, rules: ResolvedYearRules, access: RuleAccess): number | null {
  const ira = rules.values.ira;
  const limit = access.get(ira.limit, 'ira.limit', 'iraLimits');
  const catchUp = age >= 50 ? access.get(ira.catchUp50, 'ira.catchUp50', 'iraLimits') : 0;
  return limit === null || catchUp === null ? null : limit + catchUp;
}

export function rothIraEligibility(
  input: {
    magi: Cents;
    filingStatus: FilingStatus;
    age: number;
    earnedIncome: Cents;
    otherIraContributions: Cents;
  },
  rules: ResolvedYearRules,
): EngineResult<RothIraEligibility> {
  const access = new RuleAccess(rules.taxYear);
  const limit = iraContributionLimit(input.age, rules, access);
  const range = access.get(
    rules.values.ira.rothPhaseOut[input.filingStatus],
    `ira.rothPhaseOut.${input.filingStatus}`,
    'rothIraEligibility',
  );
  if (limit === null || range === null) return unverified(access.missing);

  const warnings: EngineWarning[] = [];
  const year = rules.taxYear;
  const { start, end } = range;
  const magi = input.magi;

  // Worksheet order (Pub 590-A, pending verification at source): the base is the annual limit capped
  // at compensation; the phase-out reduces the base; the result is also capped at the base minus
  // other IRA contributions this year.
  const base = Math.min(limit, input.earnedIncome);
  if (input.earnedIncome < limit) {
    warnings.push({
      code: 'iraEarnedIncomeCap',
      year,
      message: `IRA contributions cannot exceed earned income (${usd(input.earnedIncome)}). Spousal IRA contributions are not supported.`,
    });
  }

  let phased: number;
  let status: RothIraEligibility['status'];
  let calculation: string;
  if (magi <= start) {
    status = 'full';
    phased = base;
    calculation = `MAGI ${usd(magi)} is at or below ${usd(start)}: the full ${usd(base)} limit applies.`;
  } else if (magi >= end) {
    status = 'ineligible';
    phased = 0;
    calculation = `MAGI ${usd(magi)} is at or above ${usd(end)}: no direct Roth IRA contribution is allowed.`;
    warnings.push({
      code: 'rothIraIneligible',
      year,
      message: 'Income is above the Roth IRA limit. Backdoor Roth contributions exist but are not modeled in this app.',
    });
  } else {
    const standing = new RuleAccess('standing');
    const rounding = standing.get(
      rules.standing.roth.reducedContributionRounding,
      'roth.reducedContributionRounding',
      'rothIraEligibility',
    );
    if (rounding === null) return unverified(standing.missing);
    status = 'reduced';
    const raw = (base * (end - magi)) / (end - start);
    const step = rounding.roundUpToDollars * 100;
    const minimum = rounding.minimumDollars * 100;
    const rounded = Math.ceil(raw / step - 1e-9) * step;
    phased = Math.min(base, rounded > 0 ? Math.max(rounded, minimum) : 0);
    calculation = `${usd(base)} × (${usd(end)} − ${usd(magi)}) ÷ (${usd(end)} − ${usd(start)}) = ${usd(raw)}, rounded up to a multiple of $${rounding.roundUpToDollars} (minimum $${rounding.minimumDollars}) = ${usd(phased)}.`;
    warnings.push({
      code: 'rothIraPhaseOutReduced',
      year,
      message: `Roth IRA contribution reduced by the income phase-out to ${usd(phased)}.`,
    });
  }

  const allowed = Math.max(0, Math.min(phased, base - input.otherIraContributions));

  return {
    status: 'ok',
    value: {
      status,
      magi,
      phaseOutStart: start,
      phaseOutEnd: end,
      baseLimit: base as Cents,
      allowed: allowed as Cents,
      calculation,
    },
    warnings,
  };
}
