import type { ComparisonBest, ComparisonRow } from '@/api/types';
import { BASELINE_SERIES_COLOR, categoricalColor } from '@/components/charts/seriesPalette';

export type BestKey = keyof ComparisonBest;

export const BEST_LABELS: Record<BestKey, { title: string; badge: string }> = {
  fastestPayoff: { title: 'Fastest payoff', badge: 'Fastest' },
  lowestInterest: { title: 'Lowest remaining interest', badge: 'Lowest interest' },
  lowestRecurringPayment: { title: 'Lowest recurring payment', badge: 'Lowest payment' },
  bestWithinBudget: { title: 'Best within budget', badge: 'Within budget' },
};

export const BEST_ORDER: BestKey[] = ['fastestPayoff', 'lowestInterest', 'lowestRecurringPayment', 'bestWithinBudget'];

/** Row key → the "best" picks it holds. */
export function bestByRow(best: ComparisonBest): Map<string, BestKey[]> {
  const map = new Map<string, BestKey[]>();
  for (const key of BEST_ORDER) {
    const rowKey = best[key];
    if (!rowKey) continue;
    map.set(rowKey, [...(map.get(rowKey) ?? []), key]);
  }
  return map;
}

/**
 * Colour per row, following the entity: the baseline is neutral; every other row takes the next
 * categorical slot in the server's stable order (baseline, presets, saved by id). Rows past the
 * palette get null and are left out of the charts (they stay in the table).
 */
export function rowColors(rows: ComparisonRow[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  let i = 0;
  for (const r of rows) {
    if (r.kind === 'baseline') map.set(r.key, BASELINE_SERIES_COLOR);
    else map.set(r.key, categoricalColor(i++));
  }
  return map;
}

export type SortKey =
  | 'name'
  | 'payoffDate'
  | 'monthsToPayoff'
  | 'paymentCount'
  | 'totalInterest'
  | 'interestSaved'
  | 'monthsSaved'
  | 'percentInterestReduction'
  | 'recurringPayment'
  | 'lumpSumTotal'
  | 'totalPaid';

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

/** Sorts strategies; the baseline stays pinned first as the reference. Unpaid-off rows sort last by date. */
export function sortRows(rows: ComparisonRow[], sort: SortState | null): ComparisonRow[] {
  const baseline = rows.filter((r) => r.kind === 'baseline');
  const rest = rows.filter((r) => r.kind !== 'baseline');
  if (!sort) return [...baseline, ...rest];
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (r: ComparisonRow): string | number | null => {
    if (sort.key === 'name') return r.name.toLowerCase();
    if (sort.key === 'payoffDate') return r.payoffDate;
    return r[sort.key];
  };
  const sorted = [...rest].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -1 * sign;
    if (va > vb) return 1 * sign;
    return 0;
  });
  return [...baseline, ...sorted];
}
