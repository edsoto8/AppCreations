/**
 * Retirement Income view model. No financial formulas: every figure comes from the engine
 * (`projectHousehold`, `ssBenefitAtClaim`, `fullRetirementAge`, `estimatePia`); this module only
 * converts to the selected dollar basis with each row's own deflator, groups flows for display and
 * lists which accounts a destination select may offer.
 */
import {
  NotImplementedError,
  estimatePia,
  fullRetirementAge,
  ssBenefitAtClaim,
  type Account,
  type AgeYearsMonths,
  type DollarBasis,
  type EngineResult,
  type Household,
  type Person,
  type ProjectionResult,
  type RulesSet,
  type UnverifiedDetail,
  type YearRow,
} from '@rn/engine';
import { agesLabel, inBasis } from '@/features/dashboard/viewModel';

// ---------------------------------------------------------------------------------------------
// Engine calls that may not be implemented in this build
// ---------------------------------------------------------------------------------------------

export type SafeResult<T> = EngineResult<T> | { status: 'notImplemented' };

/** Runs an engine call; a function the engine has not implemented yet reads as `notImplemented`. */
export function safeEngine<T>(call: () => EngineResult<T>): SafeResult<T> {
  try {
    return call();
  } catch (error) {
    if (error instanceof NotImplementedError) return { status: 'notImplemented' };
    throw error;
  }
}

function mergeMissing(into: UnverifiedDetail[], more: readonly UnverifiedDetail[]) {
  for (const m of more) if (!into.some((x) => x.key === m.key)) into.push(m);
}

// ---------------------------------------------------------------------------------------------
// Social Security
// ---------------------------------------------------------------------------------------------

export type SsSourceKind = Person['socialSecurity']['source']['kind'];

/** The illustrative PIA estimate for an estimator input (null for entered amounts). */
export function illustrativeEstimate(person: Person, rules: RulesSet) {
  const source = person.socialSecurity.source;
  if (source.kind === 'estimateAverage') {
    return safeEngine(() =>
      estimatePia(
        {
          kind: 'average',
          birthYear: person.birthYear,
          averageAnnualEarnings: source.averageAnnualEarnings,
          yearsOfEarnings: source.yearsOfEarnings,
        },
        rules,
      ),
    );
  }
  if (source.kind === 'estimateHistory') {
    return safeEngine(() =>
      estimatePia({ kind: 'history', birthYear: person.birthYear, earnings: source.earnings }, rules),
    );
  }
  return null;
}

export interface ClaimRow {
  age: AgeYearsMonths;
  label: string;
  monthly: number;
  adjustmentFactor: number;
  monthsFromFra: number;
  planned: boolean;
}

export type ClaimingComparison =
  | { kind: 'noBenefit' }
  /** Benefit entered at the claiming age: there is no full-retirement-age amount to adjust. */
  | { kind: 'noPia' }
  | { kind: 'unverified'; missing: UnverifiedDetail[] }
  | { kind: 'notImplemented' }
  | { kind: 'invalid'; messages: string[] }
  | { kind: 'ok'; piaMonthly: number; piaSource: 'statement' | 'estimate'; fra: AgeYearsMonths; rows: ClaimRow[] };

const months = (a: AgeYearsMonths) => a.years * 12 + a.months;

export function formatAge(a: AgeYearsMonths): string {
  return a.months === 0 ? `${a.years}` : `${a.years} and ${a.months} month${a.months === 1 ? '' : 's'}`;
}

/** Own benefit at 62, full retirement age, 70 and the planned age (docs §7.5), all from the engine. */
export function claimingComparison(person: Person, rules: RulesSet): ClaimingComparison {
  const source = person.socialSecurity.source;
  if (source.kind === 'none') return { kind: 'noBenefit' };
  if (source.kind === 'atClaimAge') return { kind: 'noPia' };

  const missing: UnverifiedDetail[] = [];
  let pia: number | null = null;
  let piaSource: 'statement' | 'estimate' = 'statement';
  if (source.kind === 'statement') {
    pia = source.piaMonthly;
  } else {
    const estimate = illustrativeEstimate(person, rules);
    if (!estimate || estimate.status === 'notImplemented') return { kind: 'notImplemented' };
    if (estimate.status === 'invalid') return { kind: 'invalid', messages: estimate.issues.map((i) => i.message) };
    if (estimate.status === 'unverified') mergeMissing(missing, estimate.missing);
    else {
      pia = estimate.value.piaMonthly;
      piaSource = 'estimate';
    }
  }

  const fra = safeEngine(() => fullRetirementAge(person.birthYear, person.birthMonth, rules.standing));
  if (fra.status === 'notImplemented') return { kind: 'notImplemented' };
  if (fra.status === 'invalid') return { kind: 'invalid', messages: fra.issues.map((i) => i.message) };
  if (fra.status === 'unverified') mergeMissing(missing, fra.missing);

  const planned = person.socialSecurity.claimAge;
  const ages: { age: AgeYearsMonths; label: string }[] = [
    { age: { years: 62, months: 0 }, label: 'Earliest (62)' },
    ...(fra.status === 'ok' ? [{ age: fra.value, label: `Full retirement age (${formatAge(fra.value)})` }] : []),
    { age: { years: 70, months: 0 }, label: 'Latest with credits (70)' },
  ];
  if (!ages.some((a) => months(a.age) === months(planned))) {
    ages.push({ age: planned, label: `Your planned age (${formatAge(planned)})` });
  }
  ages.sort((a, b) => months(a.age) - months(b.age));

  // Probe the claiming rules even when the PIA is unknown, so every missing value is listed once.
  const rows: ClaimRow[] = [];
  for (const { age, label } of ages) {
    const result = safeEngine(() =>
      ssBenefitAtClaim(
        { piaMonthly: (pia ?? 0) as never, birthYear: person.birthYear, birthMonth: person.birthMonth, claimAge: age },
        rules.standing,
      ),
    );
    if (result.status === 'notImplemented') return { kind: 'notImplemented' };
    if (result.status === 'invalid') return { kind: 'invalid', messages: result.issues.map((i) => i.message) };
    if (result.status === 'unverified') {
      mergeMissing(missing, result.missing);
      continue;
    }
    rows.push({
      age,
      label,
      monthly: result.value.monthly,
      adjustmentFactor: result.value.adjustmentFactor,
      monthsFromFra: result.value.monthsFromFra,
      planned: months(age) === months(planned),
    });
  }
  if (missing.length > 0 || pia === null || fra.status !== 'ok') return { kind: 'unverified', missing };
  return { kind: 'ok', piaMonthly: pia, piaSource, fra: fra.value, rows };
}

/** Whether the engine can adjust a full-retirement-age amount to this person's claiming age (verified rules). */
export function claimingRulesVerified(person: Person, rules: RulesSet): boolean {
  const fra = safeEngine(() => fullRetirementAge(person.birthYear, person.birthMonth, rules.standing));
  if (fra.status !== 'ok') return false;
  const probe = safeEngine(() =>
    ssBenefitAtClaim(
      {
        piaMonthly: 0 as never,
        birthYear: person.birthYear,
        birthMonth: person.birthMonth,
        claimAge: person.socialSecurity.claimAge,
      },
      rules.standing,
    ),
  );
  return probe.status === 'ok';
}

/** The person's first forecast year with a Social Security benefit, in the selected basis. */
export function firstBenefitYear(result: ProjectionResult, personId: string, basis: DollarBasis) {
  for (const row of result.rows) {
    const p = row.people.find((x) => x.personId === personId);
    if (p && p.socialSecurity > 0) return { year: row.year, age: p.age, amount: inBasis(p.socialSecurity, row, basis) };
  }
  return null;
}

/** Unique warning messages with the given codes. */
export function warningMessages(result: ProjectionResult, codes: readonly string[]): string[] {
  return [...new Set(result.warnings.filter((w) => codes.includes(w.code)).map((w) => w.message))];
}

// ---------------------------------------------------------------------------------------------
// Excluded (unverified) features
// ---------------------------------------------------------------------------------------------

export const TAX_FEATURES = ['federalIncomeTax', 'payrollTax', 'capitalGainsTax', 'ssBenefitTaxation'] as const;

/** Features this page labels (the rest are covered on the dashboard). */
export const RETIREMENT_FEATURES = [
  'socialSecurityClaiming',
  'socialSecurityEstimator',
  'spousalSurvivorBenefits',
  'rmd',
  'federalIncomeTax',
  'capitalGainsTax',
  'ssBenefitTaxation',
  'rothQualification',
] as const;

export function isExcluded(result: ProjectionResult, feature: string): boolean {
  return result.excludedFeatures.includes(feature) || result.unverified.some((u) => u.features.includes(feature));
}

export function taxesUnverified(result: ProjectionResult): boolean {
  return TAX_FEATURES.some((f) => isExcluded(result, f));
}

export function retirementExclusions(result: ProjectionResult): string[] {
  return RETIREMENT_FEATURES.filter((f) => result.excludedFeatures.includes(f));
}

// ---------------------------------------------------------------------------------------------
// Destination accounts
// ---------------------------------------------------------------------------------------------

const TAX_DEFERRED_ROLLOVER = new Set<Account['type']>(['traditionalIra', 'workplaceTraditional']);
const TAXABLE_DESTINATIONS = new Set<Account['type']>(['taxableBrokerage', 'cash']);

/**
 * Accounts a pension lump sum may roll into: the owner's tax-deferred accounts (a rollover), or a
 * taxable brokerage or cash account. Never a Roth account or an HSA, which would bypass their limits.
 */
export function lumpSumDestinations(household: Pick<Household, 'accounts'>, ownerId: string): Account[] {
  return household.accounts.filter((a) => {
    if (TAXABLE_DESTINATIONS.has(a.type)) return true;
    if (a.type === 'other')
      return a.taxTreatment !== 'taxFree' && (a.taxTreatment === 'taxable' || a.ownerId === ownerId);
    return TAX_DEFERRED_ROLLOVER.has(a.type) && a.ownerId === ownerId;
  });
}

/**
 * Accounts a one-time inflow may go into: a taxable brokerage, cash or "other" account (the same
 * accounts surplus cash may use), so an inheritance never bypasses plan, IRA or HSA limits.
 */
export function inflowDestinations(household: Pick<Household, 'accounts'>): Account[] {
  return household.accounts.filter((a) => a.type === 'taxableBrokerage' || a.type === 'cash' || a.type === 'other');
}

// ---------------------------------------------------------------------------------------------
// Gross-to-net
// ---------------------------------------------------------------------------------------------

export interface IncomeSeries {
  key: IncomeKey;
  label: string;
  color: string;
}

export type IncomeKey =
  'earned' | 'socialSecurity' | 'pensions' | 'otherIncome' | 'rmd' | 'hsaMedical' | 'otherWithdrawals';

/** Fixed colors per source (never by rank), from the chart tokens in index.css. */
export const INCOME_SERIES: readonly IncomeSeries[] = [
  { key: 'socialSecurity', label: 'Social Security', color: 'var(--chart-1)' },
  { key: 'pensions', label: 'Pensions', color: 'var(--chart-3)' },
  { key: 'otherIncome', label: 'Other income', color: 'var(--chart-4)' },
  { key: 'earned', label: 'Part-time pay', color: 'var(--chart-6)' },
  { key: 'rmd', label: 'Required minimum distributions', color: 'var(--chart-7)' },
  { key: 'hsaMedical', label: 'HSA medical withdrawals', color: 'var(--chart-5)' },
  { key: 'otherWithdrawals', label: 'Other withdrawals', color: 'var(--chart-2)' },
];

export interface TaxCells {
  totalTax: number;
  federalOrdinaryTax: number;
  capitalGainsTax: number;
  stateTax: number;
  taxableSocialSecurity: number;
  converged: boolean;
}

export interface GrossToNetPoint extends Record<IncomeKey, number> {
  year: number;
  ages: string;
  withdrawals: number;
  reinvested: number;
  grossIncome: number;
  tax: TaxCells | null;
  netIncome: number | null;
  spendingNeed: number;
  shortfall: number;
}

/** Retirement-phase rows of a projection in the selected basis. */
export function grossToNet(result: ProjectionResult, household: Household, basis: DollarBasis): GrossToNetPoint[] {
  return result.rows
    .filter((row) => row.phase === 'retirement')
    .map((row) => {
      const v = (cents: number) => inBasis(cents, row, basis);
      const f = row.flows;
      const earned = row.people.reduce((sum, p) => sum + (p.alive ? p.totalCompensation : 0), 0);
      return {
        year: row.year,
        ages: agesLabel(row, household),
        earned: v(earned),
        socialSecurity: v(f.socialSecurity),
        pensions: v(f.pensions),
        otherIncome: v(f.otherIncome),
        rmd: v(f.rmd),
        hsaMedical: v(f.hsaMedical),
        otherWithdrawals: v(Math.max(0, f.withdrawals - f.rmd - f.hsaMedical)),
        withdrawals: v(f.withdrawals),
        reinvested: v(f.reinvested),
        grossIncome: v(row.grossIncome),
        tax: taxCells(row, v),
        netIncome: row.netIncome === null ? null : v(row.netIncome),
        spendingNeed: v(f.spendingNeed),
        shortfall: v(f.shortfall),
      };
    });
}

function taxCells(row: YearRow, v: (cents: number) => number): TaxCells | null {
  const t = row.tax;
  if (!t) return null;
  return {
    totalTax: v(t.totalTax),
    federalOrdinaryTax: v(t.federalOrdinaryTax),
    capitalGainsTax: v(t.capitalGainsTax),
    stateTax: v(t.stateTax),
    taxableSocialSecurity: v(t.taxableSocialSecurity),
    converged: t.solver.converged,
  };
}

/** Sources with any amount in the shown years (Social Security and withdrawals always show). */
export function presentSeries(points: readonly GrossToNetPoint[]): IncomeSeries[] {
  return INCOME_SERIES.filter(
    (s) => s.key === 'socialSecurity' || s.key === 'otherWithdrawals' || points.some((p) => p[s.key] > 0),
  );
}
