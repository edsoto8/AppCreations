/**
 * Tax year 2027 rules. As of 2026-10-18 the IRS had not published the 2027 retirement-plan limits or the
 * 2027 inflation-adjusted tax items (searched irs.gov); those are `notPublished`. HSA and SSA items had
 * been announced; they are UNVERIFIED candidates (search excerpts only).
 */
import type { TaxYearRules } from '../domain/rules';
import { dollars } from '../money';
import { candidateRule, notPublishedRule } from './helpers';

const ON = '2026-10-18';
const IRS_PENDING = 'Not published by the IRS as of 2026-10-18 (annual notice / revenue procedure not yet issued).';
const RP26_24 = { publication: 'IRS Rev. Proc. 2026-24', url: 'https://www.irs.gov/pub/irs-drop/rp-26-24.pdf' };
const SSA_FACT_2027 = {
  publication: 'SSA 2027 COLA Fact Sheet',
  url: 'https://www.ssa.gov/news/en/cola/factsheets/2027.html',
};
const SSA_BEND = { publication: 'SSA OACT Bend Points', url: 'https://www.ssa.gov/oact/cola/bendpoints.html' };
const SSA_COLA_2027 = {
  publication: 'SSA announcement 2026-10-14',
  url: 'https://www.ssa.gov/blog/en/posts/2026-10-14.html',
};

const pending = () => notPublishedRule<never>(IRS_PENDING, 'indexed');
const indexed = { retrievedOn: ON, indexation: 'indexed' as const };

export const RULES_2027: TaxYearRules = {
  taxYear: 2027,
  workplace: {
    electiveDeferral: pending(),
    catchUp50: pending(),
    catchUp60to63: pending(),
    annualAdditions: pending(),
    compensationLimit: pending(),
    rothCatchUpWageThreshold: pending(),
    rothCatchUpInForce: notPublishedRule(IRS_PENDING),
  },
  ira: {
    limit: pending(),
    catchUp50: pending(),
    rothPhaseOut: { single: pending(), marriedFilingJointly: pending() },
  },
  hsa: {
    selfOnly: candidateRule(dollars(4_500), RP26_24, indexed),
    family: candidateRule(dollars(9_000), RP26_24, indexed),
    catchUp55: pending(),
  },
  tax: {
    brackets: { single: pending(), marriedFilingJointly: pending() },
    standardDeduction: { single: pending(), marriedFilingJointly: pending() },
    additionalStandardDeduction65: { unmarried: pending(), married: pending() },
    seniorDeduction: {
      amountPerPerson: pending(),
      phaseOutStart: { single: pending(), marriedFilingJointly: pending() },
      phaseOutRate: pending(),
    },
    ltcg: { single: pending(), marriedFilingJointly: pending() },
  },
  payroll: {
    ssWageBase: candidateRule(dollars(192_300), SSA_FACT_2027, indexed),
  },
  socialSecurity: {
    bendPoints: candidateRule({ first: dollars(1_340), second: dollars(8_077) }, SSA_BEND, indexed),
    colaEffectiveJanuary: candidateRule(0.036, SSA_COLA_2027, { retrievedOn: ON }),
  },
};
