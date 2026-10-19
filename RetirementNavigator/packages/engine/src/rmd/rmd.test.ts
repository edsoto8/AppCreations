/**
 * RMDs and Roth qualification against the PINNED SYNTHETIC FIXTURE (src/testing/fixtureRules.ts), not
 * real IRS values: start age 71 (born 1900–1959) / 74 (born 1960+); Uniform Lifetime Table for ages
 * 70–120 with period = 30 − 0.5·(age − 70); Roth qualified at 712 months (59y4m) and a 4-year rule.
 */
import { describe, expect, it } from 'vitest';
import type { CalendarYear, Cents } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import type { StandingRules } from '../domain/rules';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { unverifiedRule } from '../rules/helpers';
import { fixtureStanding } from '../testing/fixtureRules';
import * as api from '../api';
import { rmdAmount, rmdStartAge } from './rmd';
import { rothQualifiedYear } from './roth';

const S = fixtureStanding();
const y = (year: number) => year as CalendarYear;

function ok<T>(r: EngineResult<T>): T {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}
const keys = (r: EngineResult<unknown>) => (r.status === 'unverified' ? r.missing.map((m) => m.key).sort() : r.status);

describe('api wiring', () => {
  it('re-exports the module functions from the frozen API', () => {
    expect(api.rmdStartAge).toBe(rmdStartAge);
    expect(api.rmdAmount).toBe(rmdAmount);
  });
});

describe('rmdStartAge', () => {
  it('looks up each birth-year range at its boundaries', () => {
    expect(ok(rmdStartAge(y(1900), S))).toBe(71);
    expect(ok(rmdStartAge(y(1951), S))).toBe(71);
    expect(ok(rmdStartAge(y(1959), S))).toBe(71);
    expect(ok(rmdStartAge(y(1960), S))).toBe(74);
    expect(ok(rmdStartAge(y(2000), S))).toBe(74);
  });

  it('is unverified for a birth year no verified range covers (e.g. a reserved 1959)', () => {
    const table = S.rmd.startAgeByBirthYear;
    if (table.status !== 'verified') throw new Error('fixture');
    const gap: StandingRules = {
      ...S,
      rmd: {
        ...S.rmd,
        startAgeByBirthYear: {
          ...table,
          value: [
            { fromBirthYear: 1951, toBirthYear: 1958, age: 71 },
            { fromBirthYear: 1960, toBirthYear: null, age: 74 },
          ],
        },
      },
    };
    const r = rmdStartAge(y(1959), gap);
    expect(r.status).toBe('unverified');
    if (r.status === 'unverified') {
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]?.key).toBe('standing:rmd.startAgeByBirthYear');
      expect(r.missing[0]?.reason).toContain('start age not published for this birth year');
      expect(r.missing[0]?.features).toEqual(['rmd']);
    }
    expect(ok(rmdStartAge(y(1958), gap))).toBe(71);
    expect(rmdStartAge(y(1950), gap).status).toBe('unverified');
  });

  it('is unverified against the bundled rules and invalid for a bad year', () => {
    expect(keys(rmdStartAge(y(1960), RULES.standing))).toEqual(['standing:rmd.startAgeByBirthYear']);
    expect(rmdStartAge(y(1899), S).status).toBe('invalid');
    expect(rmdStartAge(y(1960.5), S).status).toBe('invalid');
  });
});

describe('rmdAmount = prior year-end balance / period(age)', () => {
  const rmd = (age: number, balance: number, standing: StandingRules = S) =>
    rmdAmount({ age, priorYearEndBalance: dollars(balance) }, standing);

  it('divides by the table period at several ages', () => {
    expect(ok(rmd(70, 300_000))).toBe(dollars(10_000)); // period 30
    expect(ok(rmd(73, 100_000))).toBe(350_877); // period 28.5: 3508.7719 → $3,508.77
    expect(ok(rmd(75, 275_000))).toBe(dollars(10_000)); // period 27.5
    expect(ok(rmd(80, 100_000))).toBe(dollars(4_000)); // period 25
    expect(ok(rmd(120, 100_000))).toBe(dollars(20_000)); // period 5
    expect(ok(rmd(80, 0))).toBe(0);
  });

  it('is invalid for an age not in the table or a bad balance', () => {
    expect(rmd(69, 100_000).status).toBe('invalid');
    expect(rmd(121, 100_000).status).toBe('invalid');
    expect(rmd(80, -1).status).toBe('invalid');
    expect(rmdAmount({ age: 80, priorYearEndBalance: 0.5 as Cents }, S).status).toBe('invalid');
  });

  it('is unverified against the bundled rules', () => {
    const r = rmd(75, 100_000, RULES.standing);
    expect(keys(r)).toEqual(['standing:rmd.uniformLifetimeTable']);
    if (r.status === 'unverified') expect(r.missing[0]?.features).toEqual(['rmd']);
  });
});

describe('rothQualifiedYear (synthetic fixture: 712 months = 59y4m; five-year rule 4)', () => {
  it('reaches 59y4m in birthYear + 59 for birth months 1–8 and birthYear + 60 for 9–12', () => {
    expect(ok(rothQualifiedYear(y(1970), 1, y(2000), S))).toBe(2029);
    expect(ok(rothQualifiedYear(y(1970), 8, y(2000), S))).toBe(2029);
    expect(ok(rothQualifiedYear(y(1970), 9, y(2000), S))).toBe(2030);
    expect(ok(rothQualifiedYear(y(1970), 12, y(2000), S))).toBe(2030);
  });

  it('the four-year rule binds when the first contribution is late', () => {
    expect(ok(rothQualifiedYear(y(1970), 3, y(2025), S))).toBe(2029); // 2029 = 2025 + 4 = age year
    expect(ok(rothQualifiedYear(y(1970), 3, y(2027), S))).toBe(2031);
    expect(ok(rothQualifiedYear(y(1970), 10, y(2027), S))).toBe(2031);
  });

  it('reads the qualifying age from the rules', () => {
    const s: StandingRules = {
      ...S,
      roth: {
        ...S.roth,
        qualifiedAgeMonths: {
          ...S.roth.qualifiedAgeMonths,
          value: 60 * 12,
        } as StandingRules['roth']['qualifiedAgeMonths'],
      },
    };
    expect(ok(rothQualifiedYear(y(1970), 12, y(2000), s))).toBe(2030);
  });

  it('is unverified against the bundled rules, with both keys', () => {
    const r = rothQualifiedYear(y(1970), 3, y(2020), RULES.standing);
    expect(keys(r)).toEqual(['standing:roth.fiveYearRuleYears', 'standing:roth.qualifiedAgeMonths']);
    if (r.status === 'unverified') expect(r.missing.every((m) => m.features.includes('rothQualification'))).toBe(true);
    const one: StandingRules = { ...S, roth: { ...S.roth, fiveYearRuleYears: unverifiedRule('x') } };
    expect(keys(rothQualifiedYear(y(1970), 3, y(2020), one))).toEqual(['standing:roth.fiveYearRuleYears']);
  });

  it('is invalid for bad inputs', () => {
    expect(rothQualifiedYear(y(1800), 3, y(2020), S).status).toBe('invalid');
    expect(rothQualifiedYear(y(1970), 0, y(2020), S).status).toBe('invalid');
    expect(rothQualifiedYear(y(1970), 13, y(2020), S).status).toBe('invalid');
    expect(rothQualifiedYear(y(1970), 3, y(1800), S).status).toBe('invalid');
  });
});
