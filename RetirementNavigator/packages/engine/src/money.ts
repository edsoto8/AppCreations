/**
 * Money conversion and rounding (docs/financial-model.md §1.3).
 * Internal math is float64 dollars; values are converted to integer cents once, on output,
 * rounding half to even. Never use `toFixed` for logic.
 */
import type { Cents } from './domain/primitives';

/**
 * Round half to even. Values within a float tolerance (1e-9 absolute plus 8 ulp relative) of an
 * exact .5 are treated as ties, so that e.g. 2.675 * 100 (= 267.49999999999997 in float64) rounds as
 * the tie it represents. Intended for cent-scale values, where a 1e-9 band is far below precision.
 */
export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot round non-finite value ${value}`);
  const floor = Math.floor(value);
  const diff = value - floor;
  const tolerance = 1e-9 + Math.abs(value) * 8 * Number.EPSILON;
  let result: number;
  if (diff > 0.5 + tolerance) result = floor + 1;
  else if (diff < 0.5 - tolerance) result = floor;
  else result = floor % 2 === 0 ? floor : floor + 1;
  return result === 0 ? 0 : result; // normalize -0
}

/**
 * Float64 dollars to integer cents (round half to even). Throws RangeError beyond the safe-integer
 * range (about $90 trillion), which validated inputs cannot reach: a programming-error guard.
 */
export function toCents(dollars: number): Cents {
  return asCents(roundHalfEven(dollars * 100));
}

/** Integer cents to float64 dollars (for internal math). */
export function toDollars(cents: Cents): number {
  return cents / 100;
}

/** Sum of cents (stays an integer). */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total as Cents;
}

/** Cast a known-integer number to Cents; throws on a programming error (non-safe-integer). */
export function asCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Not an integer cent amount: ${value}`);
  return (value === 0 ? 0 : value) as Cents;
}

/** Whole dollars to cents, for readable fixtures and rule tables. */
export function dollars(amount: number): Cents {
  return toCents(amount);
}
