/**
 * Tax year 2026 rules. STATUS: every value is UNVERIFIED (candidates from web-search excerpts of the
 * official pages, retrieved 2026-10-18). See docs/rules-verification.md.
 */
import type { TaxYearRules } from '../domain/rules';
import { dollars } from '../money';
import { candidateRule, unverifiedRule } from './helpers';

const ON = '2026-10-18';
const N25_67 = { publication: 'IRS Notice 2025-67', url: 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf' };
const IR25_111 = {
  publication: 'IRS News Release IR-2025-111',
  url: 'https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500',
};
const RP25_32 = { publication: 'IRS Rev. Proc. 2025-32', url: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf' };
const RP25_19 = { publication: 'IRS Rev. Proc. 2025-19', url: 'https://www.irs.gov/pub/irs-drop/rp-25-19.pdf' };
const SENIOR = {
  publication: 'IRS newsroom: enhanced deduction for seniors',
  url: 'https://www.irs.gov/newsroom/check-your-eligibility-for-the-new-enhanced-deduction-for-seniors',
};
const SSA_FACT_2026 = {
  publication: 'SSA 2026 COLA Fact Sheet',
  url: 'https://www.ssa.gov/news/en/cola/factsheets/2026.html',
};
const SSA_BEND = { publication: 'SSA OACT Bend Points', url: 'https://www.ssa.gov/oact/cola/bendpoints.html' };
const SSA_COLA_2026 = {
  publication: 'SSA press release 2025-10-24',
  url: 'https://www.ssa.gov/news/en/press/releases/2025-10-24.html',
};

const indexed = { retrievedOn: ON, indexation: 'indexed' as const };

export const RULES_2026: TaxYearRules = {
  taxYear: 2026,
  workplace: {
    electiveDeferral: candidateRule(dollars(24_500), N25_67, indexed),
    catchUp50: candidateRule(dollars(8_000), IR25_111, indexed),
    catchUp60to63: candidateRule(dollars(11_250), IR25_111, { retrievedOn: ON }),
    annualAdditions: candidateRule(dollars(72_000), N25_67, indexed),
    compensationLimit: candidateRule(dollars(360_000), N25_67, indexed),
    rothCatchUpWageThreshold: candidateRule(
      dollars(150_000),
      {
        publication: 'IRS: Retirement topics - catch-up contributions',
        url: 'https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-catch-up-contributions',
      },
      { ...indexed, reason: 'Search excerpt only, and not corroborated in the Notice 2025-67 excerpt.' },
    ),
    rothCatchUpInForce: unverifiedRule(
      'Applicability is unclear: the statute says 2026, while the final regulations (T.D. 10033) apply to taxable years beginning after 2026-12-31 and allow good-faith compliance before then. Needs the primary documents.',
    ),
  },
  ira: {
    limit: candidateRule(dollars(7_500), N25_67, indexed),
    catchUp50: candidateRule(dollars(1_100), IR25_111, indexed),
    rothPhaseOut: {
      single: candidateRule({ start: dollars(153_000), end: dollars(168_000) }, N25_67, indexed),
      marriedFilingJointly: candidateRule({ start: dollars(242_000), end: dollars(252_000) }, N25_67, indexed),
    },
  },
  hsa: {
    selfOnly: candidateRule(dollars(4_400), RP25_19, indexed),
    family: candidateRule(dollars(8_750), RP25_19, indexed),
    catchUp55: unverifiedRule(
      'Only the 2025 Pub 969 amount ($1,000) was seen in an excerpt; the 2026 amount and its indexation status were not stated.',
    ),
  },
  tax: {
    brackets: {
      single: candidateRule(
        [
          { rate: 0.1, lowerBound: dollars(0) },
          { rate: 0.12, lowerBound: dollars(12_400) },
          { rate: 0.22, lowerBound: dollars(50_400) },
          { rate: 0.24, lowerBound: dollars(105_700) },
          { rate: 0.32, lowerBound: dollars(201_775) },
          { rate: 0.35, lowerBound: dollars(256_225) },
          { rate: 0.37, lowerBound: dollars(640_600) },
        ],
        RP25_32,
        indexed,
      ),
      marriedFilingJointly: candidateRule(
        [
          { rate: 0.1, lowerBound: dollars(0) },
          { rate: 0.12, lowerBound: dollars(24_800) },
          { rate: 0.22, lowerBound: dollars(100_800) },
          { rate: 0.24, lowerBound: dollars(211_400) },
          { rate: 0.32, lowerBound: dollars(403_550) },
          { rate: 0.35, lowerBound: dollars(512_450) },
          { rate: 0.37, lowerBound: dollars(768_700) },
        ],
        RP25_32,
        indexed,
      ),
    },
    standardDeduction: {
      single: candidateRule(dollars(16_100), RP25_32, indexed),
      marriedFilingJointly: candidateRule(dollars(32_200), RP25_32, indexed),
    },
    additionalStandardDeduction65: {
      unmarried: candidateRule(dollars(2_050), RP25_32, indexed),
      married: candidateRule(dollars(1_650), RP25_32, indexed),
    },
    seniorDeduction: {
      amountPerPerson: candidateRule(dollars(6_000), SENIOR, { retrievedOn: ON }),
      phaseOutStart: {
        single: candidateRule(dollars(75_000), SENIOR, { retrievedOn: ON }),
        marriedFilingJointly: candidateRule(dollars(150_000), SENIOR, { retrievedOn: ON }),
      },
      phaseOutRate: unverifiedRule('The phase-out rate was not stated in any irs.gov excerpt seen.'),
    },
    ltcg: {
      single: candidateRule({ zeroRateMax: dollars(49_450), fifteenRateMax: dollars(545_500) }, RP25_32, indexed),
      marriedFilingJointly: candidateRule(
        { zeroRateMax: dollars(98_900), fifteenRateMax: dollars(613_700) },
        RP25_32,
        indexed,
      ),
    },
  },
  payroll: {
    ssWageBase: candidateRule(dollars(184_500), SSA_FACT_2026, indexed),
  },
  socialSecurity: {
    bendPoints: candidateRule({ first: dollars(1_286), second: dollars(7_749) }, SSA_BEND, indexed),
    colaEffectiveJanuary: candidateRule(0.028, SSA_COLA_2026, { retrievedOn: ON }),
  },
};
