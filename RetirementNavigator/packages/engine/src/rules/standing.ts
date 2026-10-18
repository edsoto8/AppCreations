/**
 * Rules not tied to one tax year. STATUS: every value is UNVERIFIED (candidates from web-search
 * excerpts retrieved 2026-10-18). See docs/rules-verification.md.
 */
import type { StandingRules } from '../domain/rules';
import { dollars } from '../money';
import { candidateRule, unverifiedRule } from './helpers';

const ON = '2026-10-18';
const fixed = { retrievedOn: ON, indexation: 'statutory-fixed' as const };
const PUB15 = { publication: 'IRS Publication 15 (2026)', url: 'https://www.irs.gov/pub/irs-pdf/p15.pdf' };
const PUB915 = { publication: 'IRS Publication 915', url: 'https://www.irs.gov/publications/p915' };
const SSA_TAX = {
  publication: 'SSA Benefits Planner: Income Taxes',
  url: 'https://www.ssa.gov/benefits/retirement/planner/taxes.html',
};
const RMD_REGS = {
  publication: 'T.D. 10001 final RMD regulations (IRB 2024-33)',
  url: 'https://www.irs.gov/irb/2024-33_IRB',
};
const PUB590B = {
  publication: 'IRS Publication 590-B',
  url: 'https://www.irs.gov/publications/p590b',
  locator: 'Appendix B, Table III',
};
const SSA_NRA = { publication: 'SSA OACT Normal Retirement Age', url: 'https://www.ssa.gov/oact/progdata/nra.html' };
const CFR_410 = { publication: '20 CFR 404.410', url: 'https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm' };
const SSA_DELAY = {
  publication: 'SSA Benefits Planner: Delayed Retirement',
  url: 'https://www.ssa.gov/benefits/retirement/planner/delayret.html',
};
const HANDBOOK_724 = {
  publication: 'SSA Handbook §724',
  url: 'https://www.ssa.gov/OP_Home/handbook/handbook.07/handbook-0724.html',
};
const SSA_WP92 = {
  publication: 'SSA Working Paper 92',
  url: 'https://www.ssa.gov/policy/docs/workingpapers/wp92.html',
};
const SSA_PIA = { publication: 'SSA OACT PIA Formula', url: 'https://www.ssa.gov/oact/cola/piaformula.html' };
const SSA_AWI = { publication: 'SSA OACT National Average Wage Index', url: 'https://www.ssa.gov/oact/cola/AWI.html' };
const SSA_SSFA = {
  publication: 'SSA: Social Security Fairness Act',
  url: 'https://www.ssa.gov/benefits/retirement/social-security-fairness-act.html',
};

export const STANDING_RULES: StandingRules = {
  payroll: {
    oasdiEmployeeRate: candidateRule(0.062, PUB15, fixed),
    medicareEmployeeRate: candidateRule(0.0145, PUB15, fixed),
  },
  ssBenefitTaxation: {
    thresholds: {
      single: candidateRule({ base: dollars(25_000), adjustedBase: dollars(34_000) }, SSA_TAX, fixed),
      marriedFilingJointly: candidateRule({ base: dollars(32_000), adjustedBase: dollars(44_000) }, SSA_TAX, fixed),
    },
    maxInclusion: candidateRule({ tier1: 0.5, tier2: 0.85 }, PUB915, fixed),
  },
  rmd: {
    startAgeByBirthYear: unverifiedRule(
      'Candidates: age 73 (born 1951–1958) and 75 (born 1960 or later) per T.D. 10001; the age for people born in 1959 is reserved in the final regulations (proposed 73). Not read at source.',
    ),
    uniformLifetimeTable: unverifiedRule(
      'Only ages 72–75 (27.4, 26.5, 25.5, 24.6) were seen in excerpts of Pub 590-B Table III; the full table was not available.',
    ),
    roth401kLifetimeRmdRequired: candidateRule(false, RMD_REGS, fixed),
  },
  roth: {
    qualifiedAgeMonths: candidateRule(59 * 12 + 6, { ...PUB590B, locator: 'Qualified distributions' }, fixed),
    fiveYearRuleYears: candidateRule(5, { ...PUB590B, locator: 'Qualified distributions' }, fixed),
  },
  socialSecurity: {
    fraByBirthYear: candidateRule(
      [
        { fromBirthYear: 1943, toBirthYear: 1954, years: 66, months: 0 },
        { fromBirthYear: 1955, toBirthYear: 1955, years: 66, months: 2 },
        { fromBirthYear: 1956, toBirthYear: 1956, years: 66, months: 4 },
        { fromBirthYear: 1957, toBirthYear: 1957, years: 66, months: 6 },
        { fromBirthYear: 1958, toBirthYear: 1958, years: 66, months: 8 },
        { fromBirthYear: 1959, toBirthYear: 1959, years: 66, months: 10 },
        { fromBirthYear: 1960, toBirthYear: null, years: 67, months: 0 },
      ],
      SSA_NRA,
      fixed,
    ),
    earlyReduction: candidateRule({ first36PerMonth: 5 / 900, beyond36PerMonth: 5 / 1200 }, CFR_410, fixed),
    delayedCreditPerMonth: candidateRule(2 / 300, SSA_DELAY, fixed),
    delayedCreditMaxAge: candidateRule(70, SSA_DELAY, fixed),
    spousal: candidateRule(
      { maxShareOfPia: 0.5, first36PerMonth: 25 / 3600, beyond36PerMonth: 5 / 1200 },
      HANDBOOK_724,
      fixed,
    ),
    survivor: candidateRule({ maxShareOfDeceased: 1, ribLimFloorShareOfPia: 0.825 }, SSA_WP92, {
      ...fixed,
      reason:
        'Seen only in an older SSA research paper excerpt (widow(er)’s limit); needs the current SSA Handbook/POMS at source.',
    }),
    piaFactors: candidateRule([0.9, 0.32, 0.15] as [number, number, number], SSA_PIA, fixed),
    awiSeries: candidateRule(
      [
        { year: 2023, awi: dollars(66_621.8) },
        { year: 2024, awi: dollars(69_846.57) },
        { year: 2025, awi: dollars(72_800.33) },
      ],
      SSA_AWI,
      {
        retrievedOn: ON,
        reason: 'Only 2023–2025 seen in excerpts; the estimator needs the full series from SSA OACT.',
      },
    ),
    wepGpoRepealed: candidateRule(true, SSA_SSFA, fixed),
  },
};
