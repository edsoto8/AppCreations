/**
 * Time axis helpers (docs/financial-model.md §1.4). Year 1 is the injected current calendar year.
 * A person's age in calendar year Y is `Y - birthYear`.
 */

/** Age in a calendar year (no months; brief §2). */
export function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}

/**
 * Price level of year t relative to year 1 (today's dollars = year-1 dollars):
 * P_t = (1 + i)^(t − 1). Real value = nominal / P_t.
 */
export function priceIndex(inflation: number, t: number): number {
  return Math.pow(1 + inflation, t - 1);
}
