/**
 * Employer match optimizer (docs/financial-model.md §12.3). Hand-computed tier cases and engine
 * parity with `computeMatch`.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { dollars } from '../money';
import { computeMatch } from '../match/match';
import { EmployerMatchRuleSchema } from '../domain/household';
import { matchOptimizer } from './matchOptimizer';

const ctx = { currentYear: 2026, rules: RULES };
// 100% of the first 3% of pay, then 50% of the next 2%.
const tiers = [
  { matchRate: 1, bandPctOfPay: 0.03 },
  { matchRate: 0.5, bandPctOfPay: 0.02 },
];

describe('matchOptimizer', () => {
  it('reads out the full-capture point and the match left on the table (hand-computed)', () => {
    const r = matchOptimizer({ eligiblePay: dollars(100_000), match: { tiers }, currentDeferralRate: 0.04 }, ctx);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const v = r.value;
    expect(v.pctToCaptureFullMatch).toBeCloseTo(0.05, 12);
    expect(v.dollarsToCaptureFullMatch).toBe(dollars(5_000));
    expect(v.maxPossibleMatch).toBe(dollars(4_000));
    expect(v.current.deferral).toBe(dollars(4_000));
    expect(v.current.readout.match).toBe(dollars(3_500));
    expect(v.unclaimedAtCurrentRate).toBe(dollars(500));
    expect(v.additionalDeferralNeeded).toBe(dollars(1_000));
    expect(v.lowestScannedFullCaptureRate).toBe(0.05);
    expect(v.basis.limits).toBe('beforeLimits');
    // Scan rows are computeMatch at each grid rate (engine parity).
    const rule = EmployerMatchRuleSchema.parse({ tiers });
    for (const row of v.scan) {
      expect(row.match).toBe(computeMatch(rule, dollars(100_000), row.deferral).match);
    }
    expect(v.scan).toHaveLength(41);
    expect(v.scan[6]).toMatchObject({ deferralRate: 0.03, deferral: dollars(3_000), match: dollars(3_000) });
  });

  it('handles a dollar cap that binds inside a tier, a flat contribution and rates above the match', () => {
    const r = matchOptimizer(
      {
        eligiblePay: dollars(200_000),
        match: { tiers, annualMatchCap: dollars(4_500), flatPctOfPay: 0.02 },
        currentDeferralRate: 0.1,
        scanStep: 0.01,
        scanTo: 0.06,
      },
      ctx,
    );
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const v = r.value;
    // Tier 1 gives $6,000 > cap $4,500: the cap binds at 2.25% of pay.
    expect(v.pctToCaptureFullMatch).toBeCloseTo(0.0225, 12);
    expect(v.maxPossibleMatch).toBe(dollars(4_500));
    expect(v.unclaimedAtCurrentRate).toBe(0);
    expect(v.additionalDeferralNeeded).toBe(0);
    expect(v.current.readout.flat).toBe(dollars(4_000));
    expect(v.lowestScannedFullCaptureRate).toBe(0.03);
  });

  it('reports no capture rate when there is no match, and rejects invalid input', () => {
    const none = matchOptimizer({ eligiblePay: dollars(50_000), match: { tiers: [] }, currentDeferralRate: 0.05 }, ctx);
    expect(none.status === 'ok' && none.value.lowestScannedFullCaptureRate).toBeNull();
    const bad = matchOptimizer(
      { eligiblePay: -1, match: { tiers: [{ matchRate: 1, bandPctOfPay: 2 }] }, currentDeferralRate: 1.5, scanTo: 0 },
      ctx,
    );
    expect(bad.status).toBe('invalid');
    if (bad.status !== 'invalid') return;
    expect(bad.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['eligiblePay', 'match', 'currentDeferralRate']),
    );
    const step = matchOptimizer(
      { eligiblePay: 1, match: { tiers }, currentDeferralRate: 0, scanStep: 0.05, scanTo: 0.01 },
      ctx,
    );
    expect(step.status === 'invalid' && step.issues[0]?.path).toEqual(['scanTo']);
  });
});
