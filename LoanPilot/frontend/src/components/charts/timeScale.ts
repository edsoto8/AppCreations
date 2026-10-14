/**
 * Calendar helpers for charts that plot ISO dates on a true time axis (numeric day numbers), so
 * a lump sum between two due dates sits where it belongs instead of taking a full category slot.
 * Pure date arithmetic on "yyyy-MM-dd" strings in UTC — never `new Date(isoString)`.
 */
import type { IsoDate } from '@/api/types';
import { parseIsoDate, toIsoDate } from '@/lib/format';

const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for an ISO date (NaN when invalid). */
export function isoToDay(value: IsoDate): number {
  const p = parseIsoDate(value);
  if (!p) return Number.NaN;
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  return Math.round(d.getTime() / MS_PER_DAY);
}

/** Inverse of isoToDay. */
export function dayToIso(day: number): IsoDate {
  const d = new Date(day * MS_PER_DAY);
  return toIsoDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 36, 60];

/**
 * Month-start ticks (1st of the month) covering [minDay, maxDay], using the smallest step in
 * MONTH_STEPS that keeps the count at or under `maxTicks`. Yearly steps land on January.
 */
export function monthTicks(minDay: number, maxDay: number, maxTicks = 6): number[] {
  if (!Number.isFinite(minDay) || !Number.isFinite(maxDay) || maxDay <= minDay) return [minDay];
  const start = new Date(minDay * MS_PER_DAY);
  const end = new Date(maxDay * MS_PER_DAY);
  const firstIndex = start.getUTCFullYear() * 12 + start.getUTCMonth() + (start.getUTCDate() > 1 ? 1 : 0);
  const lastIndex = end.getUTCFullYear() * 12 + end.getUTCMonth();
  const span = lastIndex - firstIndex;
  const step = MONTH_STEPS.find((s) => Math.floor(span / s) + 1 <= maxTicks) ?? MONTH_STEPS[MONTH_STEPS.length - 1];
  // Align yearly-or-longer steps to January, shorter ones to a multiple of the step from January.
  let index = firstIndex;
  const align = step >= 12 ? 12 : step;
  while (index % align !== 0) index++;
  const ticks: number[] = [];
  for (; index <= lastIndex; index += step) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    ticks.push(isoToDay(toIsoDate({ year, month, day: 1 })));
  }
  return ticks.length > 0 ? ticks : [minDay];
}
