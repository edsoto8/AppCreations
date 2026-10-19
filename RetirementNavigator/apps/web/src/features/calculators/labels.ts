/** Display labels for calculator results (features, rule keys, bases). Display only. */
import { ruleLabel } from '@/features/rules/rulesCatalog';
import { formatCents, formatPercent } from '@/lib/format';

const FEATURE_LABELS: Record<string, string> = {
  workplaceLimits: 'workplace plan contribution limits',
  iraLimits: 'IRA contribution limits',
  hsaLimits: 'HSA contribution limits',
  rothIraEligibility: 'Roth IRA income limits',
  federalIncomeTax: 'federal income tax',
  payrollTax: 'payroll taxes',
  capitalGainsTax: 'capital gains tax',
  ssBenefitTaxation: 'taxes on Social Security benefits',
  socialSecurityClaiming: 'Social Security claiming adjustments',
  socialSecurityEstimator: 'the Social Security estimator',
  spousalSurvivorBenefits: 'spousal and survivor benefits',
  rmd: 'required minimum distributions',
  rothQualification: 'Roth qualification rules',
};

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

/** "standing:socialSecurity.fraByBirthYear" → "Full retirement age by birth year". */
export function ruleKeyLabel(key: string): string {
  const [section, path] = key.includes(':') ? key.split(':', 2) : ['', key];
  const label = ruleLabel(path ?? key);
  return section && section !== 'standing' ? `${label} (${section})` : label;
}

export const BASIS = {
  nominal: 'Nominal dollars',
  todays: 'Today’s dollars',
} as const;

/** "67" or "66 and 6 months". */
export function formatClaimAge(a: { years: number; months: number }): string {
  return a.months === 0 ? String(a.years) : `${a.years} and ${a.months} month${a.months === 1 ? '' : 's'}`;
}

/** A rate from the engine with up to two decimals of a percent. */
export const pct = (rate: number) => formatPercent(rate, 2);

export const money = (cents: number) => formatCents(cents);

export const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/**
 * Distinct rule names among null rule values (a rule unverified in several tax years is listed once),
 * optionally only those blocking one of `features`.
 */
export function uniqueRuleLabels(
  missing: readonly { key: string; features: readonly string[] }[],
  features?: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const m of missing) {
    if (features && !m.features.some((f) => features.includes(f))) continue;
    const path = m.key.includes(':') ? m.key.slice(m.key.indexOf(':') + 1) : m.key;
    out.add(ruleLabel(path));
  }
  return [...out];
}

export const TAX_FEATURES = ['federalIncomeTax', 'payrollTax', 'capitalGainsTax', 'ssBenefitTaxation'] as const;
