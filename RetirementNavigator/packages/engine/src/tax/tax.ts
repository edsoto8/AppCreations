/**
 * Simplified federal + flat state + FICA tax estimate (docs/financial-model.md §6). Estimates only.
 * Unsupported: AMT, NIIT, IRMAA, itemized deductions, credits, Additional Medicare Tax, state rules.
 * Every rule value is read only when the input needs it (e.g. LTCG breakpoints only with gains).
 */
import type { Cents, FilingStatus } from '../domain/primitives';
import type { Brackets } from '../domain/rules';
import type { EngineResult } from '../domain/results';
import type { ResolvedYearRules, TaxBreakdown, TaxInput } from '../api';
import { RuleAccess, unverified } from '../rules/access';
import { toCents } from '../money';

/** Tax on `taxable` (float dollars) over ascending brackets (lower bounds in cents). */
export function bracketTax(brackets: Brackets, taxable: number): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lower = (brackets[i]?.lowerBound ?? 0) / 100;
    const upper = i + 1 < brackets.length ? (brackets[i + 1]?.lowerBound ?? 0) / 100 : Number.POSITIVE_INFINITY;
    if (taxable <= lower) break;
    tax += (Math.min(taxable, upper) - lower) * (brackets[i]?.rate ?? 0);
  }
  return tax;
}

export function marginalRate(brackets: Brackets, taxable: number): number {
  let rate = brackets[0]?.rate ?? 0;
  for (const b of brackets) if (taxable >= b.lowerBound / 100) rate = b.rate;
  return rate;
}

/**
 * Taxable Social Security (Pub 915 provisional-income method), float dollars. `otherIncome` is
 * modified AGI excluding Social Security; thresholds are statutory-fixed (base, adjusted base).
 */
export function taxableSsFloat(
  benefits: number,
  otherIncome: number,
  taxExempt: number,
  thresholds: { base: number; adjustedBase: number },
  inclusion: { tier1: number; tier2: number },
): number {
  if (benefits <= 0) return 0;
  const provisional = otherIncome + taxExempt + 0.5 * benefits;
  const { base, adjustedBase } = thresholds;
  if (provisional <= base) return 0;
  if (provisional <= adjustedBase) return Math.min(inclusion.tier1 * (provisional - base), inclusion.tier1 * benefits);
  return Math.min(
    inclusion.tier2 * benefits,
    inclusion.tier2 * (provisional - adjustedBase) +
      Math.min(inclusion.tier1 * (adjustedBase - base), inclusion.tier1 * benefits),
  );
}

function ssThresholds(filingStatus: FilingStatus, rules: ResolvedYearRules, access: RuleAccess) {
  const t = access.get(
    rules.standing.ssBenefitTaxation.thresholds[filingStatus],
    `ssBenefitTaxation.thresholds.${filingStatus}`,
    'ssBenefitTaxation',
  );
  const inclusion = access.get(
    rules.standing.ssBenefitTaxation.maxInclusion,
    'ssBenefitTaxation.maxInclusion',
    'ssBenefitTaxation',
  );
  return t === null || inclusion === null
    ? null
    : { thresholds: { base: t.base / 100, adjustedBase: t.adjustedBase / 100 }, inclusion };
}

export function taxableSocialSecurity(
  input: { benefits: Cents; otherIncome: Cents; taxExemptInterest: Cents; filingStatus: FilingStatus },
  rules: ResolvedYearRules,
): EngineResult<Cents> {
  if (input.benefits <= 0) return { status: 'ok', value: 0 as Cents, warnings: [] };
  const standing = new RuleAccess('standing');
  const params = ssThresholds(input.filingStatus, rules, standing);
  if (params === null) return unverified(standing.missing);
  const value = taxableSsFloat(
    input.benefits / 100,
    input.otherIncome / 100,
    input.taxExemptInterest / 100,
    params.thresholds,
    params.inclusion,
  );
  return { status: 'ok', value: toCents(value), warnings: [] };
}

export function computeTax(input: TaxInput, rules: ResolvedYearRules): EngineResult<TaxBreakdown> {
  const access = new RuleAccess(rules.taxYear);
  const standing = new RuleAccess('standing');
  const status = input.filingStatus;
  const v = rules.values.tax;

  const brackets = access.get(v.brackets[status], `tax.brackets.${status}`, 'federalIncomeTax');
  const standard = access.get(v.standardDeduction[status], `tax.standardDeduction.${status}`, 'federalIncomeTax');

  // Additional standard deduction and the senior deduction apply per filer aged 65+.
  const seniors = input.ages.filter((a) => a >= 65).length;
  let additional65 = 0;
  let seniorPerPerson = 0;
  let seniorStart = 0;
  let seniorRate = 0;
  if (seniors > 0) {
    const married = status === 'marriedFilingJointly';
    const add = access.get(
      married ? v.additionalStandardDeduction65.married : v.additionalStandardDeduction65.unmarried,
      `tax.additionalStandardDeduction65.${married ? 'married' : 'unmarried'}`,
      'federalIncomeTax',
    );
    additional65 = (add ?? 0) * seniors;
    // The senior deduction is a sunset provision; outside its years it is absent (law as written).
    const amountRule = v.seniorDeduction.amountPerPerson;
    const inForce =
      amountRule.status !== 'verified' || amountRule.sunsetYear === null || rules.taxYear <= amountRule.sunsetYear;
    if (inForce) {
      seniorPerPerson = access.get(amountRule, 'tax.seniorDeduction.amountPerPerson', 'federalIncomeTax') ?? 0;
      seniorStart =
        access.get(
          v.seniorDeduction.phaseOutStart[status],
          `tax.seniorDeduction.phaseOutStart.${status}`,
          'federalIncomeTax',
        ) ?? 0;
      seniorRate =
        access.get(v.seniorDeduction.phaseOutRate, 'tax.seniorDeduction.phaseOutRate', 'federalIncomeTax') ?? 0;
    }
  }

  const hasGains = input.longTermCapitalGains > 0;
  const ltcg = hasGains ? access.get(v.ltcg[status], `tax.ltcg.${status}`, 'capitalGainsTax') : null;
  const gainRates = hasGains
    ? standing.get(rules.standing.capitalGainsRates, 'capitalGainsRates', 'capitalGainsTax')
    : null;
  const ss = input.socialSecurityBenefits > 0 ? ssThresholds(status, rules, standing) : null;

  const hasWages = input.wages > 0;
  const oasdi = hasWages
    ? standing.get(rules.standing.payroll.oasdiEmployeeRate, 'payroll.oasdiEmployeeRate', 'payrollTax')
    : 0;
  const medicare = hasWages
    ? standing.get(rules.standing.payroll.medicareEmployeeRate, 'payroll.medicareEmployeeRate', 'payrollTax')
    : 0;
  const wageBase = hasWages ? access.get(rules.values.payroll.ssWageBase, 'payroll.ssWageBase', 'payrollTax') : 0;

  if (!access.ok || !standing.ok) {
    access.absorb(standing.missing);
    return unverified(access.missing);
  }
  // All needed values are present (the access checks above guarantee non-null).
  const B = brackets as Brackets;
  const D = (standard as number) / 100;

  const wages = input.wages / 100;
  const preTax = input.preTaxDeductions / 100;
  const other = input.otherOrdinaryIncome / 100;
  const gains = Math.max(0, input.longTermCapitalGains / 100);
  const benefits = input.socialSecurityBenefits / 100;

  const nonSsIncome = Math.max(0, wages - preTax) + other + gains;
  const taxableSs = ss ? taxableSsFloat(benefits, nonSsIncome, 0, ss.thresholds, ss.inclusion) : 0;
  const ordinaryAgi = Math.max(0, wages - preTax) + other + taxableSs;
  const agi = ordinaryAgi + gains;

  // SIMPLIFICATION: MAGI for the senior-deduction phase-out = AGI.
  const seniorDeduction =
    seniors > 0
      ? Math.max(0, (seniorPerPerson / 100) * seniors - seniorRate * Math.max(0, agi - seniorStart / 100))
      : 0;
  const deductions = D + additional65 / 100 + seniorDeduction;

  const taxableTotal = Math.max(0, agi - deductions);
  const taxableOrdinary = Math.max(0, ordinaryAgi - deductions);
  const ordinaryTax = bracketTax(B, taxableOrdinary);

  let gainsTax = 0;
  if (ltcg && gainRates) {
    const taxableGains = taxableTotal - taxableOrdinary;
    const zeroTop = ltcg.zeroRateMax / 100;
    const fifteenTop = ltcg.fifteenRateMax / 100;
    const from = taxableOrdinary;
    const to = taxableOrdinary + taxableGains;
    const inLow = Math.max(0, Math.min(to, zeroTop) - from);
    const inMiddle = Math.max(0, Math.min(to, fifteenTop) - Math.max(from, zeroTop));
    const inHigh = Math.max(0, to - Math.max(from, fifteenTop));
    gainsTax = gainRates.low * inLow + gainRates.middle * inMiddle + gainRates.high * inHigh;
  }

  const byPerson = input.wagesByPerson.length > 0 ? input.wagesByPerson : [input.wages];
  const ficaSs = byPerson.reduce(
    (sum, w) => sum + Math.min(w / 100, (wageBase as number) / 100) * (oasdi as number),
    0,
  );
  const ficaMedicare = wages * (medicare as number);
  const stateTax = Math.max(0, agi) * input.stateTaxRate;

  const federal = toCents(ordinaryTax);
  const cg = toCents(gainsTax);
  const fss = toCents(ficaSs);
  const fmed = toCents(ficaMedicare);
  const st = toCents(stateTax);
  return {
    status: 'ok',
    value: {
      taxableSocialSecurity: toCents(taxableSs),
      agi: toCents(agi),
      deductions: toCents(deductions),
      taxableOrdinaryIncome: toCents(taxableOrdinary),
      federalOrdinaryTax: federal,
      capitalGainsTax: cg,
      ficaSocialSecurity: fss,
      ficaMedicare: fmed,
      stateTax: st,
      totalTax: (federal + cg + fss + fmed + st) as Cents,
      marginalOrdinaryRate: marginalRate(B, taxableOrdinary),
    },
    warnings: [],
  };
}
