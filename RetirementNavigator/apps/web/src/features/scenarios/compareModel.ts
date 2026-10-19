/**
 * Comparison and optimizer view model: shapes `compareScenarios` outcomes and `optimizeRetirementAge`
 * results for the table and charts in the selected dollar basis. Values come from the engine; this
 * module only picks the engine's real or nominal figure.
 */
import { ageInYear, type DollarBasis, type Household, type ScenarioOutcome } from '@rn/engine';
import { beforeLimits, forecastNotes } from '@/features/dashboard/viewModel';

/** Line styles for up to five outcomes: color plus a distinct dash pattern (never color alone). */
export const OUTCOME_STYLES = [
  { color: 'var(--chart-1)', dash: undefined, pattern: 'solid line' },
  { color: 'var(--chart-2)', dash: '8 4', pattern: 'dashed line' },
  { color: 'var(--chart-3)', dash: '2 3', pattern: 'dotted line' },
  { color: 'var(--chart-7)', dash: '12 4 2 4', pattern: 'dash-dot line' },
  { color: 'var(--chart-4)', dash: '16 6', pattern: 'long-dash line' },
] as const;

export const MAX_COMPARED = 4;

export const READINESS_LABELS = { onTrack: 'On track', borderline: 'Borderline', atRisk: 'At risk' } as const;

export interface PortfolioPoint {
  year: number;
  /** Year-end portfolio value per outcome key (`o0` = base), null where that outcome has no row. */
  [key: `o${number}`]: number | null;
}

/** Year-end baseline portfolio value per outcome, merged by calendar year. */
export function portfolioSeries(outcomes: readonly ScenarioOutcome[], basis: DollarBasis): PortfolioPoint[] {
  const byYear = new Map<number, PortfolioPoint>();
  outcomes.forEach((o, i) => {
    for (const row of o.dashboard?.baseline.rows ?? []) {
      const point = byYear.get(row.year) ?? { year: row.year };
      point[`o${i}`] = basis === 'nominal' ? row.totals.portfolioEnd : row.real.portfolioEnd;
      byYear.set(row.year, point);
    }
  });
  const points = [...byYear.values()].sort((a, b) => a.year - b.year);
  for (const p of points) outcomes.forEach((_, i) => (p[`o${i}`] ??= null));
  return points;
}

/** Ending balance (end of the last projection year) in the selected basis. */
export function endingBalance(o: ScenarioOutcome, basis: DollarBasis): number | null {
  const s = o.dashboard?.baseline.summary;
  if (!s) return null;
  return basis === 'nominal' ? s.endingBalance : s.endingBalanceReal;
}

export function outcomeBeforeLimits(o: ScenarioOutcome): boolean {
  return o.dashboard !== null && beforeLimits(o.dashboard.baseline);
}

export function anyBeforeLimits(outcomes: readonly ScenarioOutcome[]): boolean {
  return outcomes.some(outcomeBeforeLimits);
}

/** The dashboard's forecast notes (for example the pre-Medicare healthcare note) for one outcome. */
export function outcomeNotes(o: ScenarioOutcome): string[] {
  return o.dashboard ? forecastNotes(o.dashboard.baseline) : [];
}

/** Medicare eligibility age (statutory; the engine's healthcare note uses the same constant). */
export const MEDICARE_AGE = 65;

export const OPTIMIZER_HEALTHCARE_NOTE =
  'Some ages scanned are before 65: healthcare costs before Medicare are only the pre-Medicare healthcare amount you entered in the plan; nothing else is modeled.';

/**
 * Why the optimizer cannot scan this plan, or null: the first person is already retired this year
 * (their retirement age is in the past, so there is no age to choose).
 */
export function optimizerBlockedReason(h: Household, currentYear: number): string | null {
  const first = h.people[0];
  if (!first) return 'The plan has no people.';
  const age = ageInYear(first.birthYear, currentYear);
  if (age < first.retirementAge) return null;
  return `${first.name} is already retired (retirement age ${first.retirementAge}, age ${age} this year), so there is no retirement age left to scan for this plan.`;
}

export function anyBeforeTaxes(outcomes: readonly ScenarioOutcome[]): boolean {
  return outcomes.some((o) => o.dashboard?.cards.monthlyRetirementIncome.taxBasis === 'beforeTaxes');
}

/** "Runs out at age 84 (2068)" or "Lasts through planning age 92". */
export function longevityText(o: ScenarioOutcome, household: Household | null): string {
  const l = o.dashboard?.cards.longevity;
  if (!l) return '—';
  if (l.kind === 'lastsThroughPlanningAge') return `Lasts through planning age ${l.planningAge}`;
  const who = household && household.people.length > 1 ? household.people.find((p) => p.id === l.personId)?.name : null;
  return `Runs out at ${who ? `${who}’s ` : ''}age ${l.age} (${l.year})`;
}

/** Default optimizer range: from the first person's age next year to 75, clamped to valid ages. */
export function defaultOptimizerRange(h: Household, currentYear: number): { fromAge: number; toAge: number } {
  const bounds = optimizerBounds(h, currentYear);
  const toAge = Math.min(bounds.max, Math.max(bounds.min, 75));
  const fromAge = Math.min(toAge, Math.max(bounds.min, bounds.min + 1));
  return { fromAge, toAge };
}

/** Valid optimizer ages for the first person: today's age to their planning age. */
export function optimizerBounds(h: Household, currentYear: number): { min: number; max: number } {
  const first = h.people[0];
  if (!first) return { min: 0, max: 0 };
  const today = Math.max(0, currentYear - first.birthYear);
  return { min: today, max: Math.max(today, first.planningAge) };
}
