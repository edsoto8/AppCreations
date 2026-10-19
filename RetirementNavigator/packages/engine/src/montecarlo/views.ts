/**
 * Views that need the engine but no randomness (docs/financial-model.md §11):
 * - allocation view (c): each account's year-end balance split by its target allocation (annual
 *   rebalancing keeps an account at its target), with accounts that have no allocation shown apart;
 * - the sequence-of-returns illustration: the same return deviations in two orders around the
 *   first retirement years, each run through the full projection.
 */
import type { Household } from '../domain/household';
import type { EngineResult } from '../domain/results';
import type { CalendarYear, Cents } from '../domain/primitives';
import type { ProjectionResult } from '../domain/projection';
import type { EngineContext } from '../api';
import { HouseholdSchema } from '../domain/household';
import { zodIssues } from '../validation';
import { projectHousehold } from '../projection/project';
import { toCents } from '../money';

export interface AssetClassYear {
  year: CalendarYear;
  /** Price level P_t, to convert to today's dollars. */
  deflator: number;
  stocks: Cents;
  bonds: Cents;
  cash: Cents;
  /** Accounts without an allocation (blended-return fallback). */
  unallocated: Cents;
}

/** Year-end balances by asset class (nominal cents) from each account's target allocation. */
export function allocationByAssetClass(household: Household, result: ProjectionResult): AssetClassYear[] {
  const allocation = new Map(household.accounts.map((a) => [a.id as string, a.allocation]));
  return result.rows.map((row) => {
    let stocks = 0;
    let bonds = 0;
    let cash = 0;
    let unallocated = 0;
    for (const a of row.accounts) {
      const end = a.end / 100;
      const w = allocation.get(a.accountId);
      if (!w) {
        unallocated += end;
        continue;
      }
      stocks += end * w.stocks;
      bonds += end * w.bonds;
      cash += end * w.cash;
    }
    return {
      year: row.year,
      deflator: row.deflator,
      stocks: toCents(stocks),
      bonds: toCents(bonds),
      cash: toCents(cash),
      unallocated: toCents(unallocated),
    };
  });
}

/** Default deviations from each account's expected return: bad years first (sum 0, so same average). */
export const SEQUENCE_DEVIATIONS: readonly number[] = [-0.2, -0.12, -0.06, 0.02, 0.08, 0.12, 0.16];

export interface SequenceRiskIllustration {
  /** First year the deviations apply (the first retirement year, or year 1 if already retired). */
  startYear: CalendarYear;
  /** Deviations added to each account's own expected return, in the "bad years first" order. */
  deviations: number[];
  baseline: ProjectionResult;
  badYearsFirst: ProjectionResult;
  goodYearsFirst: ProjectionResult;
}

/**
 * The same deviations (same arithmetic average return over the window) applied in two orders from
 * the first retirement year. Withdrawals in the early years turn early losses into lasting damage,
 * so the two endings differ although the average return is the same.
 */
export function sequenceRiskIllustration(
  input: Household,
  ctx: EngineContext,
  deviations: readonly number[] = SEQUENCE_DEVIATIONS,
): EngineResult<SequenceRiskIllustration> {
  const parsed = HouseholdSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid', issues: zodIssues(parsed.error) };
  if (deviations.length === 0 || deviations.length > 20 || deviations.some((d) => !Number.isFinite(d) || d <= -0.9)) {
    return { status: 'invalid', issues: [{ path: ['deviations'], message: 'Use 1 to 20 deviations above −90%' }] };
  }
  const household = { ...parsed.data, assumptions: { ...parsed.data.assumptions, granularity: 'annual' as const } };
  const baseline = projectHousehold(household, ctx);
  if (baseline.status !== 'ok') return baseline;
  const rows = baseline.value.rows;
  const startYear = baseline.value.summary.retirementYear;
  const t0 = rows.findIndex((r) => r.year === startYear);
  const applied = rows.map((r) => new Map(r.accounts.map((a) => [a.accountId as string, a.appliedReturn])));
  const run = (order: readonly number[]) =>
    projectHousehold(household, ctx, {
      returnOverride: (t, accountId) => {
        const k = t - 1 - t0;
        const base = applied[t - 1]?.get(accountId);
        if (base === undefined || k < 0 || k >= order.length) return undefined;
        return base + (order[k] ?? 0);
      },
    });
  const bad = run(deviations);
  const good = run([...deviations].reverse());
  if (bad.status !== 'ok') return bad;
  if (good.status !== 'ok') return good;
  return {
    status: 'ok',
    value: {
      startYear,
      deviations: [...deviations],
      baseline: baseline.value,
      badYearsFirst: bad.value,
      goodYearsFirst: good.value,
    },
    warnings: [],
  };
}
