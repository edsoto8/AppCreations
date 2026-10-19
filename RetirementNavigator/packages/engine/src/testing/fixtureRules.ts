/**
 * PINNED TEST FIXTURE — SYNTHETIC rule values (round numbers chosen for hand-computed tests).
 * These are NOT real IRS/SSA values and are never used by the app; the brief allows one pinned
 * fixture year for golden tests. Real values live in src/rules/ with their sources.
 */
import type { RulesSet, StandingRules, TaxYearRules, Verified } from '../domain/rules';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { verifiedRule } from '../rules/helpers';

export const FIXTURE_YEAR = 2026;
const ref = { publication: 'Synthetic test fixture (not a real value)', url: 'https://www.irs.gov/fixture' };
const on = { retrievedOn: '2026-10-19' };
const idx = <T>(value: T, rounding?: { mode: 'down' | 'nearest' | 'up'; incrementDollars: number }): Verified<T> =>
  verifiedRule(value, ref, { ...on, indexation: 'indexed', ...(rounding ? { rounding } : {}) });
const fixed = <T>(value: T, sunsetYear?: number): Verified<T> =>
  verifiedRule(value, ref, { ...on, indexation: 'statutory-fixed', ...(sunsetYear ? { sunsetYear } : {}) });

export function fixtureYear(year = FIXTURE_YEAR): TaxYearRules {
  return {
    taxYear: year,
    workplace: {
      electiveDeferral: idx(dollars(20_000), { mode: 'down', incrementDollars: 500 }),
      catchUp50: idx(dollars(7_000), { mode: 'down', incrementDollars: 500 }),
      catchUp60to63: idx(dollars(10_000)),
      annualAdditions: idx(dollars(60_000), { mode: 'down', incrementDollars: 1_000 }),
      compensationLimit: idx(dollars(300_000), { mode: 'down', incrementDollars: 5_000 }),
      rothCatchUpWageThreshold: idx(dollars(140_000)),
      rothCatchUpInForce: fixed(true),
    },
    ira: {
      limit: idx(dollars(7_000), { mode: 'down', incrementDollars: 500 }),
      catchUp50: idx(dollars(1_000)),
      rothPhaseOut: {
        single: idx({ start: dollars(100_000), end: dollars(115_000) }),
        marriedFilingJointly: idx({ start: dollars(200_000), end: dollars(210_000) }),
      },
    },
    hsa: { selfOnly: idx(dollars(4_000)), family: idx(dollars(8_000)), catchUp55: fixed(dollars(1_000)) },
    tax: {
      brackets: {
        single: idx([
          { rate: 0.1, lowerBound: dollars(0) },
          { rate: 0.2, lowerBound: dollars(10_000) },
          { rate: 0.3, lowerBound: dollars(50_000) },
        ]),
        marriedFilingJointly: idx([
          { rate: 0.1, lowerBound: dollars(0) },
          { rate: 0.2, lowerBound: dollars(20_000) },
          { rate: 0.3, lowerBound: dollars(100_000) },
        ]),
      },
      standardDeduction: { single: idx(dollars(15_000)), marriedFilingJointly: idx(dollars(30_000)) },
      additionalStandardDeduction65: { unmarried: idx(dollars(2_000)), married: idx(dollars(1_500)) },
      seniorDeduction: {
        amountPerPerson: fixed(dollars(5_000), 2028),
        phaseOutStart: { single: fixed(dollars(70_000)), marriedFilingJointly: fixed(dollars(140_000)) },
        phaseOutRate: fixed(0.06),
      },
      ltcg: {
        single: idx({ zeroRateMax: dollars(40_000), fifteenRateMax: dollars(500_000) }),
        marriedFilingJointly: idx({ zeroRateMax: dollars(80_000), fifteenRateMax: dollars(600_000) }),
      },
    },
    payroll: { ssWageBase: idx(dollars(150_000)) },
    socialSecurity: {
      bendPoints: idx({ first: dollars(1_000), second: dollars(6_000) }),
      colaEffectiveJanuary: verifiedRule(0.02, ref, { ...on, indexation: 'statutory-fixed' }),
    },
  };
}

export function fixtureStanding(): StandingRules {
  const base = RULES.standing;
  return {
    ...base,
    payroll: { oasdiEmployeeRate: fixed(0.062), medicareEmployeeRate: fixed(0.0145) },
    capitalGainsRates: fixed({ low: 0, middle: 0.15, high: 0.2 }),
    ssBenefitTaxation: {
      thresholds: {
        single: fixed({ base: dollars(25_000), adjustedBase: dollars(34_000) }),
        marriedFilingJointly: fixed({ base: dollars(32_000), adjustedBase: dollars(44_000) }),
      },
      maxInclusion: fixed({ tier1: 0.5, tier2: 0.85 }),
    },
    roth: {
      ...base.roth,
      reducedContributionRounding: fixed({ roundUpToDollars: 10, minimumDollars: 200 }),
    },
  };
}

export function fixtureRules(): RulesSet {
  return { standing: fixtureStanding(), years: { [String(FIXTURE_YEAR)]: fixtureYear() } };
}
