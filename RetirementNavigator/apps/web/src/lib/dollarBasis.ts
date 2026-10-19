import { priceIndex } from '@rn/engine';

/**
 * Convert a nominal value in projection year index t (1-based) to the selected basis using the
 * engine's price index (today's dollars are year-1 dollars; docs/financial-model.md §1.1).
 */
export function toBasis(nominalCents: number, t: number, inflation: number, basis: 'todays' | 'nominal'): number {
  return basis === 'nominal' ? nominalCents : nominalCents / priceIndex(inflation, t);
}
