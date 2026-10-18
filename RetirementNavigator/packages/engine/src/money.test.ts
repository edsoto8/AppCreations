import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { asCents, dollars, roundHalfEven, sumCents, toCents, toDollars } from './money';
import type { Cents } from './domain/primitives';

describe('roundHalfEven', () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [-0.5, 0],
    [-1.5, -2],
    [-2.5, -2],
    [2.4, 2],
    [2.6, 3],
    [-2.6, -3],
    [0, 0],
  ])('rounds %d to %d', (input, expected) => {
    expect(roundHalfEven(input)).toBe(expected);
  });

  it('treats float representations of exact halves as ties', () => {
    // 2.675 * 100 is 267.49999999999997 in float64; it represents the tie 267.5 -> 268 (even).
    expect(roundHalfEven(2.675 * 100)).toBe(268);
    // 1.005 * 100 = 100.49999999999999 -> tie 100.5 -> 100 (even).
    expect(roundHalfEven(1.005 * 100)).toBe(100);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundHalfEven(-0.4), 0)).toBe(true);
    expect(Object.is(roundHalfEven(-0.5), 0)).toBe(true);
  });

  it('rejects non-finite input (programming error)', () => {
    expect(() => roundHalfEven(Number.NaN)).toThrow(RangeError);
    expect(() => roundHalfEven(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('is within 0.5 of the input and integral (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }), (x) => {
        const r = roundHalfEven(x);
        return Number.isInteger(r) && Math.abs(r - x) <= 0.5 + 1e-6;
      }),
    );
  });
});

describe('cents conversion', () => {
  it('converts dollars to cents and back', () => {
    expect(toCents(123.45)).toBe(12345);
    expect(toDollars(12345 as Cents)).toBe(123.45);
    expect(dollars(24_500)).toBe(2_450_000);
  });

  it('round-trips any integer cents value (property)', () => {
    fc.assert(fc.property(fc.integer({ min: -1e13, max: 1e13 }), (c) => toCents(toDollars(c as Cents)) === c));
  });

  it('sums cents as integers', () => {
    expect(sumCents([1, 2, 3] as Cents[])).toBe(6);
    expect(sumCents([])).toBe(0);
  });

  it('asCents accepts safe integers only', () => {
    expect(asCents(5)).toBe(5);
    expect(Object.is(asCents(-0), 0)).toBe(true);
    expect(() => asCents(1.5)).toThrow(RangeError);
    expect(() => asCents(2 ** 60)).toThrow(RangeError);
  });
});
