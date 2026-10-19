/**
 * Roth IRA qualification year (docs/financial-model.md §7.4). Earnings are qualified from the calendar
 * year the owner reaches `qualifiedAgeMonths` of age AND at least `fiveYearRuleYears` after the first
 * contribution year. Rule values are read through `RuleAccess`; null returns `unverified`.
 */
import type { CalendarYear } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import type { StandingRules } from '../domain/rules';
import { RuleAccess, unverified } from '../rules/access';

/**
 * The first calendar year Roth IRA earnings are qualified.
 * - Age: the year of the month the person reaches `qualifiedAgeMonths`, counting from the birth month
 *   (with 714 months: `birthYear + 59` if `birthMonth ≤ 6`, else `birthYear + 60`).
 * - Five-year rule: `firstContributionYear + fiveYearRuleYears` (the caller passes year 1 when the
 *   first contribution year is unknown).
 */
export function rothQualifiedYear(
  birthYear: CalendarYear,
  birthMonth: number,
  firstContributionYear: CalendarYear,
  standing: StandingRules,
): EngineResult<number> {
  const isYear = (y: number) => Number.isInteger(y) && y >= 1900 && y <= 2200;
  if (!isYear(birthYear)) {
    return { status: 'invalid', issues: [{ path: ['birthYear'], message: 'Birth year must be a calendar year' }] };
  }
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) {
    return { status: 'invalid', issues: [{ path: ['birthMonth'], message: 'Birth month must be 1–12' }] };
  }
  if (!isYear(firstContributionYear)) {
    return {
      status: 'invalid',
      issues: [{ path: ['firstContributionYear'], message: 'First contribution year must be a calendar year' }],
    };
  }
  const access = new RuleAccess('standing');
  const ageMonths = access.get(standing.roth.qualifiedAgeMonths, 'roth.qualifiedAgeMonths', 'rothQualification');
  const fiveYear = access.get(standing.roth.fiveYearRuleYears, 'roth.fiveYearRuleYears', 'rothQualification');
  if (ageMonths === null || fiveYear === null) return unverified(access.missing);
  // Month index (0-based from January of year 0) of the birth month, plus the qualifying age in months.
  const ageYear = Math.floor((birthYear * 12 + (birthMonth - 1) + ageMonths) / 12);
  return { status: 'ok', value: Math.max(ageYear, firstContributionYear + fiveYear), warnings: [] };
}
