/**
 * Display formatting only — the front end performs no financial math.
 * All number formatting uses the en-US locale for grouping/decimals; the currency code comes from
 * the user's preferences. Dates are ISO "yyyy-MM-dd" strings and are NEVER passed to
 * `new Date(string)` (that parses as UTC midnight and shifts a day in negative-offset zones).
 */
import type { InsightMetric, IsoDate, PaymentFrequency } from '@/api/types';

export const LOCALE = 'en-US';
export const DEFAULT_CURRENCY = 'USD';
export const EMPTY_VALUE = '—';

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'US dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'British pound' },
  { code: 'CAD', label: 'Canadian dollar' },
  { code: 'AUD', label: 'Australian dollar' },
  { code: 'MXN', label: 'Mexican peso' },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

const numberFormatCache = new Map<string, Intl.NumberFormat>();
function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let nf = numberFormatCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(LOCALE, options);
    numberFormatCache.set(key, nf);
  }
  return nf;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Avoid "-$0.00": anything that rounds to zero at the shown precision is zero. */
function cleanZero(value: number, fractionDigits: number): number {
  const threshold = 0.5 * 10 ** -fractionDigits;
  return Math.abs(value) < threshold ? 0 : value;
}

function safeCurrency(currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return DEFAULT_CURRENCY;
  try {
    numberFormat({ style: 'currency', currency: code });
    return code;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

export interface CurrencyFormatOptions {
  /** Show cents (default true). */
  cents?: boolean;
  /** "always" renders +$50.00 for positive deltas. */
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
}

/** "$1,234.56". null/undefined/NaN → "—". */
export function formatCurrency(
  value: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  options: CurrencyFormatOptions = {},
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  const digits = options.cents === false ? 0 : 2;
  return numberFormat({
    style: 'currency',
    currency: safeCurrency(currency),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signDisplay ?? 'auto',
  }).format(cleanZero(value, digits));
}

/** Compact currency for chart axes: "$950", "$25K", "$1.2M". */
export function formatCurrencyCompact(value: number | null | undefined, currency: string = DEFAULT_CURRENCY): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return numberFormat({
    style: 'currency',
    currency: safeCurrency(currency),
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
  }).format(cleanZero(value, 0));
}

/** The symbol shown in currency inputs: "$", "€", "£", "CA$", "A$", "MX$". */
export function currencySymbol(currency: string = DEFAULT_CURRENCY): string {
  const parts = numberFormat({ style: 'currency', currency: safeCurrency(currency) }).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? '$';
}

/** Percent values are already in percent units (6.49 → "6.49%"). */
export function formatPercent(value: number | null | undefined, fractionDigits = 2): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  const formatted = numberFormat({
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cleanZero(value, fractionDigits));
  return `${formatted}%`;
}

/** Plain grouped number: 1234 → "1,234". */
export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return numberFormat({
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cleanZero(value, fractionDigits));
}

/** "1 payment" / "48 payments". */
export function formatCount(value: number | null | undefined, singular: string, plural = `${singular}s`): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return `${formatNumber(value)} ${Math.abs(value) === 1 ? singular : plural}`;
}

// ── Durations ────────────────────────────────────────────────────────────────

/** "1 month" / "18 months". */
export function formatMonths(months: number | null | undefined): string {
  if (!isFiniteNumber(months)) return EMPTY_VALUE;
  return formatCount(Math.round(months), 'month');
}

/** "5 yr 3 mo", "2 yr", "8 mo", "0 mo". Negative values keep a leading minus. */
export function formatDuration(months: number | null | undefined): string {
  if (!isFiniteNumber(months)) return EMPTY_VALUE;
  const total = Math.round(Math.abs(months));
  const sign = months < 0 && total > 0 ? '-' : '';
  const years = Math.floor(total / 12);
  const rest = total % 12;
  if (years === 0) return `${sign}${rest} mo`;
  if (rest === 0) return `${sign}${years} yr`;
  return `${sign}${years} yr ${rest} mo`;
}

// ── Dates ────────────────────────────────────────────────────────────────────

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "yyyy-MM-dd" (also tolerates a trailing time, e.g. "2026-01-15T00:00:00"). Rejects impossible dates. */
export function parseIsoDate(value: string | null | undefined): DateParts | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value.slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidIsoDate(value: string | null | undefined): boolean {
  return parseIsoDate(value) !== null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function toIsoDate(parts: DateParts): IsoDate;
export function toIsoDate(date: Date): IsoDate;
export function toIsoDate(input: DateParts | Date): IsoDate {
  if (input instanceof Date) {
    // Local calendar date of a Date object (what the user sees on their wall calendar).
    return `${pad(input.getFullYear(), 4)}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}`;
  }
  return `${pad(input.year, 4)}-${pad(input.month)}-${pad(input.day)}`;
}

/** Today's local calendar date as "yyyy-MM-dd". */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

/** Calendar month arithmetic; the day is clamped to the target month's length (Jan 31 + 1 → Feb 28). */
export function addMonthsIso(value: IsoDate, months: number): IsoDate {
  const p = parseIsoDate(value);
  if (!p) return value;
  const index = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return toIsoDate({ year, month, day: Math.min(p.day, daysInMonth(year, month)) });
}

/** A UTC Date at midnight for the given calendar date — format it with timeZone "UTC" only. */
function utcDate(p: DateParts): Date {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  return d;
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let df = dateFormatCache.get(key);
  if (!df) {
    df = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'UTC' });
    dateFormatCache.set(key, df);
  }
  return df;
}

export type DateStyle = 'short' | 'medium' | 'long';

/** "Jan 15, 2026" (medium), "January 15, 2026" (long), "01/15/2026" (short). */
export function formatDate(value: string | null | undefined, style: DateStyle = 'medium'): string {
  const p = parseIsoDate(value);
  if (!p) return EMPTY_VALUE;
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { year: 'numeric', month: '2-digit', day: '2-digit' }
      : { year: 'numeric', month: style === 'long' ? 'long' : 'short', day: 'numeric' };
  return dateFormat(options).format(utcDate(p));
}

/** "Jan 2026" (short) or "January 2026" (long). */
export function formatMonthYear(value: string | null | undefined, style: 'short' | 'long' = 'short'): string {
  const p = parseIsoDate(value);
  if (!p) return EMPTY_VALUE;
  return dateFormat({ year: 'numeric', month: style }).format(utcDate(p));
}

/** Compact axis label: "Jan '27". */
export function formatAxisMonth(value: string | null | undefined): string {
  const p = parseIsoDate(value);
  if (!p) return '';
  const month = dateFormat({ month: 'short' }).format(utcDate(p));
  return `${month} '${pad(p.year % 100)}`;
}

// ── Domain labels ────────────────────────────────────────────────────────────

export const FREQUENCY_LABELS: Record<PaymentFrequency, { adjective: string; noun: string; perPeriod: string }> = {
  monthly: { adjective: 'Monthly', noun: 'month', perPeriod: '/mo' },
  biweekly: { adjective: 'Biweekly', noun: 'two weeks', perPeriod: '/2 wk' },
  weekly: { adjective: 'Weekly', noun: 'week', perPeriod: '/wk' },
};

/** Formats an Insight metric according to its declared format. */
export function formatMetric(metric: InsightMetric, currency: string = DEFAULT_CURRENCY): string {
  switch (metric.format) {
    case 'currency':
      return formatCurrency(metric.value, currency);
    case 'percent':
      return formatPercent(metric.value, 1);
    case 'months':
      return formatDuration(metric.value);
    case 'count':
      return formatNumber(metric.value);
  }
}
