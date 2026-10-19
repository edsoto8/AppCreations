/** Display formatting. Values arrive as integer cents or decimal rates from the engine. */

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export function formatCents(cents: number, opts: { exact?: boolean } = {}): string {
  return (opts.exact ? usd2 : usd0).format(cents / 100);
}

export function formatPercent(rate: number, digits = 1): string {
  const pct = rate * 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(digits)}%`;
}

/** Plain dollars for inputs (no currency symbol), e.g. "62,000". */
export function formatDollarsInput(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Parse user-entered dollars ("$62,000.50", "62000") to cents; null if not a number. */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Parse a percent ("6", "6.5%") to a decimal fraction, avoiding float noise; null if not a number. */
export function parsePercent(text: string): number | null {
  const cleaned = text.replace(/[%\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e8 : null;
}

export function percentInputValue(fraction: number): string {
  return String(Math.round(fraction * 1e8) / 1e6);
}
