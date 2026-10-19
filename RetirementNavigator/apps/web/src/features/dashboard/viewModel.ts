/**
 * Dashboard view model: converts engine projection rows to the selected dollar basis and shapes
 * them for cards, charts and tables. No financial formulas here: every figure comes from the engine
 * result; this module only divides by the row's own deflator (real = nominal / P_t, docs §1.1)
 * and groups account balances for display.
 */
import type { AccountType, DashboardResult, DollarBasis, Household, ProjectionResult, YearRow } from '@rn/engine';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from '@/features/accounts/accountModel';

/** Rule-dependent steps whose exclusion means contributions are "as elected, before plan limits". */
export const LIMIT_FEATURES = ['workplaceLimits', 'iraLimits', 'hsaLimits', 'rothIraEligibility'] as const;

const EXCLUDED_LABELS: Record<string, string> = {
  workplaceLimits:
    'Workplace plan limits: 401(k), 403(b) and 457(b) contributions and the match are as elected, before plan limits.',
  iraLimits: 'IRA limits: IRA contributions are as scheduled, before the annual limit.',
  hsaLimits: 'HSA limits: HSA contributions are as scheduled, before the annual limit.',
  rothIraEligibility: 'Roth IRA income limits: Roth IRA contributions are as scheduled, before the income phase-out.',
  federalIncomeTax: 'Income taxes: take-home pay and the working-years surplus are not shown as numbers.',
  payrollTax: 'Payroll taxes: take-home pay and the working-years surplus are not shown as numbers.',
};

/** Plain-language line for an excluded (unverified) step; unknown keys fall back to the key. */
export function excludedFeatureLabel(feature: string): string {
  return EXCLUDED_LABELS[feature] ?? `${feature}: left out because its rule values are unverified.`;
}

export function beforeLimits(result: ProjectionResult): boolean {
  return result.excludedFeatures.some((f) => (LIMIT_FEATURES as readonly string[]).includes(f));
}

/** Unique `featureNotModeled` messages (things modeled in a later milestone). */
export function notModeledMessages(result: ProjectionResult): string[] {
  return [...new Set(result.warnings.filter((w) => w.code === 'featureNotModeled').map((w) => w.message))];
}

const NOTE_CODES = new Set([
  'portfolioDepleted',
  'withdrawalStrategyFallback',
  'retirementContributionsReduced',
  'grossUpNotConverged',
  'savingsPlanInfeasible',
]);

/** Forecast notes worth surfacing on the dashboard (one per code + message). */
export function forecastNotes(result: ProjectionResult): string[] {
  const seen = new Map<string, string[]>();
  for (const w of result.warnings) {
    if (!NOTE_CODES.has(w.code)) continue;
    const list = seen.get(w.code) ?? [];
    if (!list.includes(w.message)) list.push(w.message);
    seen.set(w.code, list);
  }
  return [...seen.values()].flatMap((messages) =>
    messages.length > 2 ? [messages[0] ?? '', `…and ${messages.length - 1} similar notes.`] : messages,
  );
}

/** Convert a row's nominal cents to the selected basis using that row's deflator. */
export function inBasis(cents: number, row: Pick<YearRow, 'deflator'>, basis: DollarBasis): number {
  return basis === 'nominal' ? cents : cents / row.deflator;
}

/**
 * A start-of-year balance is the prior year-end money, so in today's dollars it is deflated by the
 * prior year's price level (1 in year 1): row t's start then equals row t−1's end on screen.
 */
export function startInBasis(
  cents: number,
  rows: readonly Pick<YearRow, 'deflator'>[],
  index: number,
  basis: DollarBasis,
): number {
  if (basis === 'nominal') return cents;
  const prior = index > 0 ? rows[index - 1] : undefined;
  return cents / (prior?.deflator ?? 1);
}

export function basisName(basis: DollarBasis): string {
  return basis === 'nominal' ? 'future dollars' : 'today’s dollars';
}

/** "Sam 42, Jordan 40" (living people only; a deceased person is omitted). */
export function agesLabel(row: YearRow, household: Household): string {
  const names = new Map(household.people.map((p) => [p.id as string, p.name]));
  return row.people
    .filter((p) => p.alive)
    .map((p) => (household.people.length > 1 ? `${names.get(p.personId) ?? ''} ${p.age}` : `${p.age}`))
    .join(', ');
}

export interface ForecastPoint {
  year: number;
  ages: string;
  phase: YearRow['phase'];
  start: number;
  contributions: number;
  growth: number;
  withdrawals: number;
  forfeited: number;
  end: number;
  optimistic: number | null;
  pessimistic: number | null;
}

/** One point per year: baseline flows and end balance, plus the offset lines' end balances. */
export function forecastSeries(dashboard: DashboardResult, household: Household, basis: DollarBasis): ForecastPoint[] {
  return dashboard.baseline.rows.map((row, i) => {
    const opt = dashboard.optimistic.rows[i];
    const pes = dashboard.pessimistic.rows[i];
    const v = (c: number) => inBasis(c, row, basis);
    return {
      year: row.year,
      ages: agesLabel(row, household),
      phase: row.phase,
      start: startInBasis(row.totals.portfolioStart, dashboard.baseline.rows, i, basis),
      contributions: v(row.flows.contributions),
      growth: v(row.flows.growthNet),
      withdrawals: v(row.flows.withdrawals),
      forfeited: v(row.flows.forfeited),
      end: v(row.totals.portfolioEnd),
      optimistic: opt ? inBasis(opt.totals.portfolioEnd, opt, basis) : null,
      pessimistic: pes ? inBasis(pes.totals.portfolioEnd, pes, basis) : null,
    };
  });
}

export interface AllocationSeries {
  key: string;
  label: string;
  /** CSS color variable for the series (fixed per entity, never by rank). */
  color: string;
}

export interface AllocationView {
  series: AllocationSeries[];
  points: ({ year: number; ages: string } & Record<string, number | string>)[];
}

/** Year-end balances grouped by account type (only types the household has). */
export function allocationByAccountType(
  result: ProjectionResult,
  household: Household,
  basis: DollarBasis,
): AllocationView {
  const typeOf = new Map(household.accounts.map((a) => [a.id as string, a.type]));
  const present = ACCOUNT_TYPES.filter((t) => household.accounts.some((a) => a.type === t));
  const series = present.map((t) => ({
    key: t,
    label: ACCOUNT_TYPE_LABELS[t],
    color: `var(--chart-${ACCOUNT_TYPES.indexOf(t) + 1})`,
  }));
  const points = result.rows.map((row) => {
    const sums: Partial<Record<AccountType, number>> = {};
    for (const a of row.accounts) {
      const t = typeOf.get(a.accountId);
      if (t) sums[t] = (sums[t] ?? 0) + a.end;
    }
    const point: { year: number; ages: string } & Record<string, number | string> = {
      year: row.year,
      ages: agesLabel(row, household),
    };
    for (const t of present) point[t] = inBasis(sums[t] ?? 0, row, basis);
    return point;
  });
  return { series, points };
}

export const TAX_TREATMENT_SERIES: AllocationSeries[] = [
  { key: 'taxDeferred', label: 'Tax-deferred', color: 'var(--chart-1)' },
  { key: 'taxFree', label: 'Tax-free', color: 'var(--chart-2)' },
  { key: 'taxable', label: 'Taxable', color: 'var(--chart-3)' },
];

/** Year-end balances by tax treatment (`totals.byTaxTreatment`). */
export function allocationByTaxTreatment(
  result: ProjectionResult,
  household: Household,
  basis: DollarBasis,
): AllocationView {
  return {
    series: TAX_TREATMENT_SERIES,
    points: result.rows.map((row) => ({
      year: row.year,
      ages: agesLabel(row, household),
      taxDeferred: inBasis(row.totals.byTaxTreatment.taxDeferred, row, basis),
      taxFree: inBasis(row.totals.byTaxTreatment.taxFree, row, basis),
      taxable: inBasis(row.totals.byTaxTreatment.taxable, row, basis),
    })),
  };
}

const compact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Axis ticks: "$1.2M". Cents in, dollars out. */
export function formatCompactCents(cents: number): string {
  return compact.format(cents / 100);
}

/** A return offset in percentage points with an explicit sign: 0.02 → "+2", -0.015 → "−1.5". */
export function formatOffset(offset: number): string {
  const points = Math.round(Math.abs(offset) * 10_000) / 100;
  if (points === 0) return '0';
  return `${offset > 0 ? '+' : '−'}${points}`;
}

export function phaseLabel(phase: YearRow['phase']): string {
  return phase === 'retirement' ? 'Retirement' : 'Working years';
}

/** "Age" for one person, "Ages" when the label lists several. */
export function agePrefix(ages: string): string {
  return ages.includes(',') ? 'Ages' : 'Age';
}
