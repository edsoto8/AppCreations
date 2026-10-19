/**
 * Flattens the bundled rules set into a display list for the Rules & Sources page and formats rule
 * values for reading. Display only: nothing here feeds a calculation.
 *
 * The walk is generic (a leaf is any object with a string `status` and a `value` key), so a rule added
 * to the engine's data files appears on the page without a code change. Labels fall back to the
 * dotted path when a rule has no entry in `RULE_LABELS`.
 */
import type { RulesSet, Verified } from '@rn/engine';
import { formatCents } from '@/lib/format';

export type RuleStatus = Verified<unknown>['status'];

export interface RuleEntry {
  /** Section key: "standing" or a tax year such as "2026". */
  section: string;
  /** Dotted path within the section, e.g. "workplace.electiveDeferral". */
  path: string;
  /** Engine rule key, e.g. "2026:workplace.electiveDeferral". */
  key: string;
  label: string;
  category: string;
  rule: Verified<unknown>;
}

export interface RuleSection {
  key: string;
  title: string;
  entries: RuleEntry[];
}

export function isRuleLeaf(node: unknown): node is Verified<unknown> {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as { status?: unknown }).status === 'string' &&
    'value' in node
  );
}

function isRecord(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

function walk(node: unknown, path: string[], out: { path: string; rule: Verified<unknown> }[]): void {
  if (isRuleLeaf(node)) {
    out.push({ path: path.join('.'), rule: node });
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, child] of Object.entries(node)) walk(child, [...path, key], out);
}

/** Standing rules first, then each tax year in ascending order. */
export function collectRuleSections(rules: RulesSet): RuleSection[] {
  const sources: { key: string; title: string; root: unknown }[] = [
    { key: 'standing', title: 'Standing rules', root: rules.standing },
    ...Object.keys(rules.years)
      .sort()
      .map((year) => ({ key: year, title: `Tax year ${year}`, root: rules.years[year] })),
  ];
  return sources.map(({ key, title, root }) => {
    const leaves: { path: string; rule: Verified<unknown> }[] = [];
    walk(root, [], leaves);
    return {
      key,
      title,
      entries: leaves.map(({ path, rule }) => ({
        section: key,
        path,
        key: `${key}:${path}`,
        label: ruleLabel(path),
        category: ruleCategory(path),
        rule,
      })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

/** Human-readable names keyed by dotted path within a section (shared by every tax year). */
export const RULE_LABELS: Readonly<Record<string, string>> = {
  // Tax-year rules
  'workplace.electiveDeferral': '401(k)/403(b)/457(b) employee deferral limit',
  'workplace.catchUp50': 'Workplace plan catch-up contribution, age 50+',
  'workplace.catchUp60to63': 'Workplace plan enhanced catch-up, ages 60–63',
  'workplace.annualAdditions': 'Annual additions limit (employee + employer)',
  'workplace.compensationLimit': 'Compensation limit for plan contributions',
  'workplace.rothCatchUpWageThreshold': 'Prior-year wage threshold for mandatory Roth catch-up',
  'workplace.rothCatchUpInForce': 'Mandatory Roth catch-up rule in force',
  'ira.limit': 'IRA contribution limit',
  'ira.catchUp50': 'IRA catch-up contribution, age 50+',
  'ira.rothPhaseOut': 'Roth IRA income phase-out range (MAGI)',
  'hsa.selfOnly': 'HSA contribution limit, self-only coverage',
  'hsa.family': 'HSA contribution limit, family coverage',
  'hsa.catchUp55': 'HSA catch-up contribution, age 55+',
  'tax.brackets': 'Ordinary income tax brackets',
  'tax.standardDeduction': 'Standard deduction',
  'tax.additionalStandardDeduction65': 'Additional standard deduction, age 65+',
  'tax.seniorDeduction.amountPerPerson': 'Senior deduction (age 65+), amount per person',
  'tax.seniorDeduction.phaseOutStart': 'Senior deduction phase-out start (MAGI)',
  'tax.seniorDeduction.phaseOutRate': 'Senior deduction phase-out rate',
  'tax.ltcg': 'Long-term capital gains rate thresholds (taxable income)',
  'payroll.ssWageBase': 'Social Security taxable maximum (wage base)',
  'socialSecurity.bendPoints': 'PIA bend points (monthly)',
  'socialSecurity.colaEffectiveJanuary': 'Cost-of-living adjustment (COLA), effective January',
  // Standing rules
  'payroll.oasdiEmployeeRate': 'Social Security (OASDI) employee tax rate',
  'payroll.medicareEmployeeRate': 'Medicare employee tax rate',
  capitalGainsRates: 'Long-term capital gains rates',
  'ssBenefitTaxation.thresholds': 'Provisional-income thresholds for taxing benefits',
  'ssBenefitTaxation.maxInclusion': 'Maximum share of benefits that is taxable',
  'rmd.startAgeByBirthYear': 'RMD starting age by birth year',
  'rmd.uniformLifetimeTable': 'Uniform Lifetime Table (distribution periods)',
  'rmd.roth401kLifetimeRmdRequired': 'Lifetime RMDs required from a Roth 401(k)',
  'roth.qualifiedAgeMonths': 'Minimum age for qualified Roth distributions',
  'roth.fiveYearRuleYears': 'Roth five-year rule period',
  'roth.reducedContributionRounding': 'Roth IRA reduced-contribution rounding',
  'socialSecurity.fraByBirthYear': 'Full retirement age by birth year',
  'socialSecurity.earlyReduction': 'Early-claiming reduction, retirement benefit',
  'socialSecurity.delayedCreditPerMonth': 'Delayed retirement credit, per month',
  'socialSecurity.delayedCreditMaxAge': 'Age when delayed retirement credits stop',
  'socialSecurity.spousal': 'Spousal benefit share and early-claiming reduction',
  'socialSecurity.survivor': 'Survivor benefit share and widow(er)’s limit',
  'socialSecurity.piaFactors': 'PIA formula factors',
  'socialSecurity.awiSeries': 'National average wage index (AWI) series',
  'socialSecurity.wepGpoRepealed': 'Windfall Elimination Provision / Government Pension Offset repealed',
};

/** Trailing path segments that split one rule by filing status or marital status. */
const STATUS_SUFFIXES: Readonly<Record<string, string>> = {
  single: 'single',
  marriedFilingJointly: 'married filing jointly',
  unmarried: 'unmarried',
  married: 'married',
};

export function ruleLabel(path: string): string {
  const direct = RULE_LABELS[path];
  if (direct) return direct;
  const segments = path.split('.');
  const last = segments.at(-1) ?? '';
  const suffix = STATUS_SUFFIXES[last];
  const parent = RULE_LABELS[segments.slice(0, -1).join('.')];
  if (suffix && parent) return `${parent} (${suffix})`;
  return path;
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  workplace: 'Workplace plans',
  ira: 'IRAs',
  hsa: 'Health savings accounts',
  tax: 'Federal income tax',
  capitalGainsRates: 'Federal income tax',
  payroll: 'Payroll tax',
  ssBenefitTaxation: 'Taxation of Social Security benefits',
  socialSecurity: 'Social Security',
  rmd: 'Required minimum distributions',
  roth: 'Roth accounts',
};

export function ruleCategory(path: string): string {
  const first = path.split('.')[0] ?? path;
  return CATEGORY_LABELS[first] ?? humanize(first);
}

function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------------------------
// Status, indexation, dates
// ---------------------------------------------------------------------------------------------

export const STATUS_LABELS: Readonly<Record<RuleStatus, string>> = {
  verified: 'Verified',
  unverified: 'Unverified',
  notPublished: 'Not yet published',
};

export function indexationLabel(indexation: string | null | undefined): string {
  if (indexation === 'indexed') return 'Indexed';
  if (indexation === 'statutory-fixed') return 'Statutory, fixed';
  return '—';
}

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/** "2026-10-18" → "Oct 18, 2026" (falls back to the input if it is not an ISO date). */
export function formatIsoDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

export interface StatusCounts {
  total: number;
  verified: number;
  unverified: number;
  notPublished: number;
}

export function countStatuses(entries: readonly RuleEntry[]): StatusCounts {
  const counts: StatusCounts = { total: entries.length, verified: 0, unverified: 0, notPublished: 0 };
  for (const e of entries) counts[e.rule.status] += 1;
  return counts;
}

/** The reason text shared by the most rules with the given status, with how many share it. */
export function mostCommonReason(
  entries: readonly RuleEntry[],
  status: Exclude<RuleStatus, 'verified'>,
): { reason: string; count: number; of: number } | null {
  const tally = new Map<string, number>();
  let of = 0;
  for (const { rule } of entries) {
    if (rule.status !== status) continue;
    of += 1;
    tally.set(rule.unverifiedReason, (tally.get(rule.unverifiedReason) ?? 0) + 1);
  }
  let best: { reason: string; count: number; of: number } | null = null;
  for (const [reason, count] of tally) if (!best || count > best.count) best = { reason, count, of };
  return best;
}

// ---------------------------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------------------------

/** Keys whose numbers are decimal rates (shown as percents). */
const RATE_KEY = /(?:rate|permonth|factors?)$|share|^tier\d$|^cola|^(?:low|middle|high)$/i;
/** Keys whose numbers are whole dollars rather than cents. */
const DOLLARS_KEY = /Dollars$/;

const VALUE_KEY_LABELS: Readonly<Record<string, string>> = {
  first: 'First',
  second: 'Second',
  base: 'Base amount',
  adjustedBase: 'Adjusted base amount',
  tier1: 'Tier 1',
  tier2: 'Tier 2',
  low: 'Low band',
  middle: 'Middle band',
  high: 'High band',
  zeroRateMax: '0% rate up to',
  fifteenRateMax: '15% rate up to',
  first36PerMonth: 'First 36 months, per month',
  beyond36PerMonth: 'Beyond 36 months, per month',
  maxShareOfPia: 'Maximum share of worker’s PIA',
  maxShareOfDeceased: 'Maximum share of deceased’s benefit',
  ribLimFloorShareOfPia: 'Widow(er)’s limit floor, share of PIA',
  roundUpToDollars: 'Round up to a multiple of',
  minimumDollars: 'Minimum',
};

const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatMoneyCents(cents: number): string {
  return formatCents(cents, { exact: cents % 100 !== 0 });
}

/** Percent with up to four decimals and no trailing zeros: 0.062 → "6.2%", 5/900 → "0.5556%". */
export function formatRate(rate: number): string {
  const pct = Math.round(rate * 100 * 10_000) / 10_000;
  return `${pct.toLocaleString('en-US', { maximumFractionDigits: 4 })}%`;
}

function formatNumber(n: number, key: string): string {
  if (RATE_KEY.test(key)) return formatRate(n);
  if (DOLLARS_KEY.test(key)) return usdWhole.format(n);
  return formatMoneyCents(n);
}

function num(record: Record<string, unknown>, key: string): number | null {
  const v = record[key];
  return typeof v === 'number' ? v : null;
}

function birthYears(record: Record<string, unknown>): string {
  const from = num(record, 'fromBirthYear');
  const to = record.toBirthYear;
  if (from === null) return '?';
  if (to === null) return `${from} or later`;
  if (typeof to === 'number') return to === from ? String(from) : `${from}–${to}`;
  return String(from);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function formatAgeMonths(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  return months === 0 ? `Age ${years}` : `Age ${years} and ${plural(months, 'month')}`;
}

/** Formatters for rules whose numbers are not money or rates, keyed by the rule's last path segment. */
const SPECIAL: Readonly<Record<string, (value: unknown) => string | null>> = {
  fraByBirthYear: (v) =>
    Array.isArray(v)
      ? v
          .filter(isRecord)
          .map((e) => {
            const years = num(e, 'years') ?? 0;
            const months = num(e, 'months') ?? 0;
            return `${birthYears(e)}: ${months === 0 ? `age ${years}` : `age ${years} and ${plural(months, 'month')}`}`;
          })
          .join('; ')
      : null,
  startAgeByBirthYear: (v) =>
    Array.isArray(v)
      ? v
          .filter(isRecord)
          .map((e) => `${birthYears(e)}: age ${num(e, 'age') ?? '?'}`)
          .join('; ')
      : null,
  uniformLifetimeTable: (v) =>
    Array.isArray(v)
      ? v
          .filter(isRecord)
          .map((e) => `age ${num(e, 'age') ?? '?'}: ${num(e, 'period') ?? '?'}`)
          .join('; ')
      : null,
  awiSeries: (v) =>
    Array.isArray(v)
      ? v
          .filter(isRecord)
          .map((e) => {
            const awi = num(e, 'awi');
            return `${num(e, 'year') ?? '?'}: ${awi === null ? '?' : formatMoneyCents(awi)}`;
          })
          .join('; ')
      : null,
  qualifiedAgeMonths: (v) => (typeof v === 'number' ? formatAgeMonths(v) : null),
  fiveYearRuleYears: (v) => (typeof v === 'number' ? plural(v, 'year') : null),
  delayedCreditMaxAge: (v) => (typeof v === 'number' ? `Age ${v}` : null),
  piaFactors: (v) =>
    Array.isArray(v) && v.every((x) => typeof x === 'number') ? v.map((x) => formatRate(x)).join(' / ') : null,
};

function isBracketList(v: unknown[]): v is { rate: number; lowerBound: number }[] {
  return v.every((x) => isRecord(x) && typeof x.rate === 'number' && typeof x.lowerBound === 'number');
}

function formatGeneric(value: unknown, key: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatNumber(value, key);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.length > 0 && isBracketList(value))
      return value.map((b) => `${formatRate(b.rate)} from ${formatMoneyCents(b.lowerBound)}`).join('; ');
    return value.map((item) => formatGeneric(item, key)).join('; ');
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 2 && typeof value.start === 'number' && typeof value.end === 'number')
      return `${formatNumber(value.start, key)} to ${formatNumber(value.end, key)}`;
    return keys.map((k) => `${VALUE_KEY_LABELS[k] ?? humanize(k)}: ${formatGeneric(value[k], k)}`).join('; ');
  }
  return String(value);
}

/**
 * Readable text for a rule value. `path` is the rule's dotted path within its section; its last
 * non-filing-status segment decides how bare numbers read (rate, count or money in cents).
 */
export function formatRuleValue(value: unknown, path: string): string {
  if (value === null || value === undefined) return '—';
  const segments = path.split('.').filter((s) => !(s in STATUS_SUFFIXES));
  const key = segments.at(-1) ?? path;
  const special = SPECIAL[key];
  const text = special ? special(value) : null;
  return text ?? formatGeneric(value, key);
}
