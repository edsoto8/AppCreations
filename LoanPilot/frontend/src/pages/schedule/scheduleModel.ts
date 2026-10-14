/**
 * Pure helpers for the Amortization Schedule page: row assembly, search/filter, the baseline vs
 * scenario join and the payment calendar. No financial math beyond adding up and differencing the
 * engine's own per-row figures for totals and difference columns.
 */
import type { AnnualSummaryRow, IsoDate, ScheduleRow } from '@/api/types';
import { formatCurrency, formatDate, parseIsoDate } from '@/lib/format';

/** A schedule row tagged with where it came from and a stable key. */
export interface DisplayRow extends ScheduleRow {
  key: string;
  /** "history" = estimated past rows; "projection" = the projection from the current balance. */
  phase: 'history' | 'projection';
}

export function buildRows(history: ScheduleRow[], projection: ScheduleRow[]): DisplayRow[] {
  return [
    ...history.map((r, i) => ({ ...r, key: `h-${i}`, phase: 'history' as const })),
    ...projection.map((r, i) => ({ ...r, key: `p-${i}`, phase: 'projection' as const })),
  ];
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface RowFilters {
  search: string;
  year: number | null;
  extraOnly: boolean;
  from: IsoDate | null;
  to: IsoDate | null;
}

export const EMPTY_FILTERS: RowFilters = { search: '', year: null, extraOnly: false, from: null, to: null };

export function activeFilterCount(f: RowFilters): number {
  return [f.search.trim() !== '', f.year !== null, f.extraOnly, f.from !== null, f.to !== null].filter(Boolean).length;
}

/** Lower-case, without currency symbols, grouping commas or a leading "#", so "$1,234.5" finds 1234.50. */
export function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/[$,#]/g, '').replace(/\s+/g, ' ').trim();
}

function amountForms(value: number, currency: string): string {
  return value === 0 ? '' : `${value.toFixed(2)} ${formatCurrency(value, currency)}`;
}

const AMOUNT_FIELDS = [
  'startingBalance',
  'scheduledPayment',
  'extraPayment',
  'totalPayment',
  'interest',
  'principal',
  'endingBalance',
  'cumulativeInterest',
] as const;

/**
 * Every searchable form of a row: its number, ISO/medium/long/short dates and each amount, then
 * whole-word tokens (` n:<number> `, ` d:<whole dollars> `, ` y:<year> `) for integer queries.
 */
export function rowSearchText(row: ScheduleRow, currency: string): string {
  const tokens = [
    row.number !== null ? `n:${row.number}` : '',
    `y:${yearOf(row.date)}`,
    ...AMOUNT_FIELDS.map((f) => (row[f] !== 0 ? `d:${Math.trunc(row[f])}` : '')),
  ].filter(Boolean);
  const text = normalizeSearch(
    [
      row.number ?? '',
      row.kind === 'lumpSum' ? 'lump sum' : '',
      row.isEstimated ? 'estimated' : '',
      row.date,
      formatDate(row.date),
      formatDate(row.date, 'long'),
      formatDate(row.date, 'short'),
      amountForms(row.startingBalance, currency),
      amountForms(row.scheduledPayment, currency),
      amountForms(row.extraPayment, currency),
      amountForms(row.totalPayment, currency),
      amountForms(row.interest, currency),
      amountForms(row.principal, currency),
      amountForms(row.endingBalance, currency),
      amountForms(row.cumulativeInterest, currency),
    ].join(' | '),
  );
  return `${text} || ${tokens.map((t) => ` ${t} `).join('')}`;
}

/**
 * "#12" matches payment 12 only. A bare whole number matches a payment number, a year or an amount's
 * whole dollars ("483" finds $483.32). Anything else is a substring of the row's text.
 */
export function matchesSearch(text: string, rawQuery: string): boolean {
  const query = normalizeSearch(rawQuery);
  if (!query) return true;
  if (/^#\s*\d+$/.test(rawQuery.trim())) return text.includes(` n:${query} `);
  if (/^\d+$/.test(query)) return text.includes(` n:${query} `) || text.includes(` y:${query} `) || text.includes(` d:${query} `);
  return text.includes(query);
}

export function yearOf(date: IsoDate): number {
  return parseIsoDate(date)?.year ?? 0;
}

/** Applies the filter bar (search per `matchesSearch`, year, date range, extra payments only). */
export function filterItems<T>(
  items: T[],
  filters: RowFilters,
  access: { date: (item: T) => IsoDate; text: (item: T) => string; hasExtra: (item: T) => boolean },
): T[] {
  if (activeFilterCount(filters) === 0) return items;
  return items.filter((item) => {
    const date = access.date(item);
    if (filters.year !== null && yearOf(date) !== filters.year) return false;
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    if (filters.extraOnly && !access.hasExtra(item)) return false;
    if (filters.search.trim() && !matchesSearch(access.text(item), filters.search)) return false;
    return true;
  });
}

export function distinctYears(dates: IsoDate[]): number[] {
  return [...new Set(dates.map(yearOf))].filter((y) => y > 0).sort((a, b) => a - b);
}

// ── Totals ───────────────────────────────────────────────────────────────────

/** Sum in whole cents so a long column does not pick up floating-point noise. */
export function sumCents(values: number[]): number {
  return values.reduce((sum, v) => sum + Math.round(v * 100), 0) / 100;
}

export interface RowTotals {
  scheduledPayment: number;
  extraPayment: number;
  totalPayment: number;
  interest: number;
  principal: number;
}

export function rowTotals(rows: ScheduleRow[]): RowTotals {
  return {
    scheduledPayment: sumCents(rows.map((r) => r.scheduledPayment)),
    extraPayment: sumCents(rows.map((r) => r.extraPayment)),
    totalPayment: sumCents(rows.map((r) => r.totalPayment)),
    interest: sumCents(rows.map((r) => r.interest)),
    principal: sumCents(rows.map((r) => r.principal)),
  };
}

export interface AnnualTotals {
  payments: number;
  totalPaid: number;
  principal: number;
  interest: number;
  extra: number;
}

export function annualTotals(rows: AnnualSummaryRow[]): AnnualTotals {
  return {
    payments: rows.reduce((n, r) => n + r.payments, 0),
    totalPaid: sumCents(rows.map((r) => r.totalPaid)),
    principal: sumCents(rows.map((r) => r.principal)),
    interest: sumCents(rows.map((r) => r.interest)),
    extra: sumCents(rows.map((r) => r.extra)),
  };
}

const diff = (a: number, b: number) => (Math.round(a * 100) - Math.round(b * 100)) / 100;

// ── Baseline vs scenario ─────────────────────────────────────────────────────

export interface CompareRow {
  key: string;
  kind: ScheduleRow['kind'];
  number: number | null;
  date: IsoDate;
  baseline: ScheduleRow | null;
  scenario: ScheduleRow | null;
  /** scenario − baseline (negative = the scenario pays less interest). null for lump-sum rows. */
  interestDiff: number | null;
  /** scenario − baseline ending balance (negative = ahead of the baseline). null for lump-sum rows. */
  balanceDiff: number | null;
}

/**
 * Lines the two projections up by payment number (dates match for the same number); scenario
 * lump-sum rows are placed by date. After the scenario pays off, its side counts as zero.
 */
export function compareRows(baseline: ScheduleRow[], scenario: ScheduleRow[]): CompareRow[] {
  const byNumber = new Map<number, { baseline: ScheduleRow | null; scenario: ScheduleRow | null }>();
  for (const r of baseline) if (r.kind === 'payment' && r.number !== null) byNumber.set(r.number, { baseline: r, scenario: null });
  for (const r of scenario) {
    if (r.kind !== 'payment' || r.number === null) continue;
    const entry = byNumber.get(r.number);
    if (entry) entry.scenario = r;
    else byNumber.set(r.number, { baseline: null, scenario: r });
  }

  const out: CompareRow[] = [];
  for (const [number, pair] of byNumber) {
    const b = pair.baseline;
    const s = pair.scenario;
    out.push({
      key: `n-${number}`,
      kind: 'payment',
      number,
      date: (b ?? s)!.date,
      baseline: b,
      scenario: s,
      interestDiff: diff(s?.interest ?? 0, b?.interest ?? 0),
      balanceDiff: diff(s?.endingBalance ?? 0, b?.endingBalance ?? 0),
    });
  }
  const lumps = [...baseline.map((r) => ['b', r] as const), ...scenario.map((r) => ['s', r] as const)].filter(([, r]) => r.kind === 'lumpSum');
  lumps.forEach(([side, r], i) =>
    out.push({
      key: `l-${side}-${i}`,
      kind: 'lumpSum',
      number: null,
      date: r.date,
      baseline: side === 'b' ? r : null,
      scenario: side === 's' ? r : null,
      interestDiff: null,
      balanceDiff: null,
    }),
  );
  // Date order; on the same date the regular payment comes first.
  return out.sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? 0 : a.kind === 'payment' ? -1 : 1) : a.date < b.date ? -1 : 1));
}

export function compareSearchText(row: CompareRow, currency: string): string {
  return [row.baseline, row.scenario]
    .filter((r): r is ScheduleRow => r !== null)
    .map((r) => rowSearchText(r, currency))
    .join(' | ');
}

export interface AnnualCompareRow {
  year: number;
  baseline: AnnualSummaryRow | null;
  scenario: AnnualSummaryRow | null;
  interestDiff: number;
  balanceDiff: number;
  paidDiff: number;
}

export function compareAnnual(baseline: AnnualSummaryRow[], scenario: AnnualSummaryRow[]): AnnualCompareRow[] {
  const years = [...new Set([...baseline.map((r) => r.year), ...scenario.map((r) => r.year)])].sort((a, b) => a - b);
  return years.map((year) => {
    const b = baseline.find((r) => r.year === year) ?? null;
    const s = scenario.find((r) => r.year === year) ?? null;
    return {
      year,
      baseline: b,
      scenario: s,
      interestDiff: diff(s?.interest ?? 0, b?.interest ?? 0),
      balanceDiff: diff(s?.endingBalance ?? 0, b?.endingBalance ?? 0),
      paidDiff: diff(s?.totalPaid ?? 0, b?.totalPaid ?? 0),
    };
  });
}

// ── Payment calendar ─────────────────────────────────────────────────────────

/** The next `count` projected payments (and lump sums) due on or after `today`. */
export function upcomingRows(rows: ScheduleRow[], today: IsoDate, count = 12): ScheduleRow[] {
  return rows.filter((r) => r.date >= today && r.totalPayment > 0).slice(0, count);
}

/** Index of the first row due on or after `today` (the "next payment"), or -1. */
export function nextRowIndex(rows: ScheduleRow[], today: IsoDate): number {
  return rows.findIndex((r) => r.kind === 'payment' && !r.isEstimated && r.date >= today);
}

/** iCalendar file with one all-day event per upcoming payment. */
export function buildIcs(rows: ScheduleRow[], loanName: string, currency: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const nextDay = (iso: IsoDate) => {
    const p = parseIsoDate(iso)!;
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  const events = rows.map((r, i) => {
    const what = r.kind === 'lumpSum' ? 'Lump-sum payment' : `Car payment #${r.number}`;
    return [
      'BEGIN:VEVENT',
      `UID:loanpilot-${r.date}-${r.number ?? `lump-${i}`}@loanpilot.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${r.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${nextDay(r.date)}`,
      `SUMMARY:${escape(`${what}: ${formatCurrency(r.totalPayment, currency)} (${loanName})`)}`,
      `DESCRIPTION:${escape(`${formatCurrency(r.principal, currency)} principal, ${formatCurrency(r.interest, currency)} interest. Estimated by LoanPilot.`)}`,
      'END:VEVENT',
    ].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LoanPilot//Payment calendar//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join(
    '\r\n',
  );
}
