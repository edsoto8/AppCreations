/**
 * Gate (M2): match readout matches hand-computed tier cases.
 * Rule: 100% of the first 3% of pay, then 50% of the next 2% (bands [0,3%) and [3%,5%)).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EmployerMatchRuleSchema, type EmployerMatchRule } from '../domain/household';
import { dollars } from '../money';
import { computeMatch, matchFloat, vestedFraction } from './match';

const rule = (r: Record<string, unknown> = {}): EmployerMatchRule =>
  EmployerMatchRuleSchema.parse({
    tiers: [
      { matchRate: 1, bandPctOfPay: 0.03 },
      { matchRate: 0.5, bandPctOfPay: 0.02 },
    ],
    ...r,
  });

const PAY = dollars(100_000);

describe('computeMatch (hand-computed tiers on $100,000 pay)', () => {
  it.each([
    // deferral %, tier 1, tier 2, total match
    [0, 0, 0, 0],
    [0.02, 2_000, 0, 2_000], // below tier 1 end
    [0.03, 3_000, 0, 3_000], // at tier 1 end
    [0.04, 3_000, 500, 3_500], // inside tier 2
    [0.05, 3_000, 1_000, 4_000], // at tier 2 end (full match)
    [0.1, 3_000, 1_000, 4_000], // above every tier
  ])('deferring %d of pay earns the documented match', (rate, t1, t2, total) => {
    const m = computeMatch(rule(), PAY, dollars(100_000 * rate));
    expect(m.perTier).toEqual([dollars(t1), dollars(t2)]);
    expect(m.match).toBe(dollars(total));
    expect(m.maxPossibleMatch).toBe(dollars(4_000));
    expect(m.pctToCaptureFullMatch).toBeCloseTo(0.05, 12);
    expect(m.dollarsToCaptureFullMatch).toBe(dollars(5_000));
    expect(m.unclaimed).toBe(dollars(4_000 - total));
  });

  it('adds a flat non-elective contribution regardless of deferrals', () => {
    const m = computeMatch(rule({ flatPctOfPay: 0.03 }), PAY, dollars(0));
    expect(m.flat).toBe(dollars(3_000));
    expect(m.total).toBe(dollars(3_000));
  });

  it('applies a plan dollar cap and finds the capture rate inside the capped tier', () => {
    // Cap $3,500: reached halfway through tier 2 → 3% + (500 / (0.5 × 100,000)) = 4%.
    const m = computeMatch(rule({ annualMatchCap: dollars(3_500) }), PAY, dollars(10_000));
    expect(m.match).toBe(dollars(3_500));
    expect(m.maxPossibleMatch).toBe(dollars(3_500));
    expect(m.pctToCaptureFullMatch).toBeCloseTo(0.04, 12);
    expect(m.dollarsToCaptureFullMatch).toBe(dollars(4_000));
  });

  it('handles zero pay, no tiers, and a zero-rate tier between positive tiers', () => {
    expect(computeMatch(rule(), dollars(0), dollars(1_000))).toMatchObject({
      match: 0,
      maxPossibleMatch: 0,
      pctToCaptureFullMatch: 0,
    });
    expect(computeMatch(rule({ tiers: [] }), PAY, dollars(5_000))).toMatchObject({
      match: 0,
      pctToCaptureFullMatch: 0,
    });
    const gap = rule({
      tiers: [
        { matchRate: 1, bandPctOfPay: 0.02 },
        { matchRate: 0, bandPctOfPay: 0.02 },
        { matchRate: 0.25, bandPctOfPay: 0.02 },
      ],
    });
    const m = computeMatch(gap, PAY, dollars(6_000));
    expect(m.match).toBe(dollars(2_500));
    expect(m.pctToCaptureFullMatch).toBeCloseTo(0.06, 12);
  });

  it('never decreases as the employee defers more, and never exceeds the possible match (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30_000 }), fc.integer({ min: 0, max: 30_000 }), (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const f = (d: number) => matchFloat(rule(), 100_000, d);
        return f(lo).match <= f(hi).match + 1e-9 && f(hi).match <= f(hi).possible + 1e-9;
      }),
    );
  });
});

describe('vestedFraction', () => {
  it('handles immediate, cliff and graded schedules', () => {
    expect(vestedFraction({ kind: 'immediate' }, 0)).toBe(1);
    expect(vestedFraction({ kind: 'cliff', years: 3 }, 2)).toBe(0);
    expect(vestedFraction({ kind: 'cliff', years: 3 }, 3)).toBe(1);
    const graded = { kind: 'graded' as const, vestedByYear: [0.2, 0.4, 0.6, 0.8, 1] };
    expect(vestedFraction(graded, 0)).toBe(0);
    expect(vestedFraction(graded, 1)).toBe(0.2);
    expect(vestedFraction(graded, 4)).toBe(0.8);
    expect(vestedFraction(graded, 9)).toBe(1);
  });
});
