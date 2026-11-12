import type { Cents } from './types';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Format integer cents as "$1,234.56". */
export function formatCents(c: Cents): string {
  return fmt.format(c / 100);
}

/** Format integer cents without decimals when whole: "$1,240". */
export function formatWhole(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return a % 100 === 0 ? `${sign}$${(a / 100).toLocaleString('en-US')}` : formatCents(c);
}

export const dollars = (d: number): Cents => Math.round(d * 100);
