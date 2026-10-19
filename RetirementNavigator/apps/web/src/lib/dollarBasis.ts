/**
 * Convert a nominal value in projection year index t (1-based) to the selected basis.
 * Today's dollars are year-1 dollars: real = nominal / (1 + inflation)^(t − 1) (docs/financial-model.md §1.1).
 */
export function toBasis(nominalCents: number, t: number, inflation: number, basis: 'todays' | 'nominal'): number {
  return basis === 'nominal' ? nominalCents : nominalCents / Math.pow(1 + inflation, t - 1);
}
