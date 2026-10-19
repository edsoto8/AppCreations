/**
 * Required minimum distributions (docs/financial-model.md §7.1 step 3). Rule values are read through
 * `RuleAccess`; a null value returns `unverified` and is never replaced by a default. Whether an
 * account is subject to RMDs, and whether the age has reached the start age, is the caller's job.
 */
import type { CalendarYear, Cents } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import type { StandingRules } from '../domain/rules';
import { RuleAccess, unverified } from '../rules/access';
import { toCents } from '../money';

/** RMD start age for a birth year, from the verified `startAgeByBirthYear` ranges. */
export function rmdStartAge(birthYear: CalendarYear, standing: StandingRules): EngineResult<number> {
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2200) {
    return { status: 'invalid', issues: [{ path: ['birthYear'], message: 'Birth year must be a calendar year' }] };
  }
  const access = new RuleAccess('standing');
  const table = access.get(standing.rmd.startAgeByBirthYear, 'rmd.startAgeByBirthYear', 'rmd');
  if (table === null) return unverified(access.missing);
  const entry = table.find(
    (e) => e.fromBirthYear <= birthYear && (e.toBirthYear === null || birthYear <= e.toBirthYear),
  );
  if (!entry) {
    // A verified table may leave a birth year out on purpose (for example, a year the final
    // regulations reserve); it stays unverified rather than borrowing a neighbouring range.
    return unverified([
      {
        key: 'standing:rmd.startAgeByBirthYear',
        reason: `RMD start age not published for this birth year (${birthYear}).`,
        features: ['rmd'],
      },
    ]);
  }
  return { status: 'ok', value: entry.age, warnings: [] };
}

/**
 * RMD for a year = prior Dec 31 balance / Uniform Lifetime Table period for the age in that year.
 * An age that is not in the table is `invalid` (callers check the start age first).
 */
export function rmdAmount(
  input: { age: number; priorYearEndBalance: Cents },
  standing: StandingRules,
): EngineResult<Cents> {
  if (!Number.isSafeInteger(input.priorYearEndBalance) || input.priorYearEndBalance < 0) {
    return {
      status: 'invalid',
      issues: [{ path: ['priorYearEndBalance'], message: 'Balance must be a non-negative whole number of cents' }],
    };
  }
  const access = new RuleAccess('standing');
  const table = access.get(standing.rmd.uniformLifetimeTable, 'rmd.uniformLifetimeTable', 'rmd');
  if (table === null) return unverified(access.missing);
  const row = table.find((r) => r.age === input.age);
  if (!row) {
    return {
      status: 'invalid',
      issues: [{ path: ['age'], message: `Age ${input.age} is not in the Uniform Lifetime Table` }],
    };
  }
  return { status: 'ok', value: toCents(input.priorYearEndBalance / 100 / row.period), warnings: [] };
}
