/**
 * Social Security claiming comparison (docs/financial-model.md §12.9). PIA mode needs the verified
 * FRA table and claim factors: the SYNTHETIC fixture (FRA 67y0m for 1950+, 0.5%/0.4% early reduction,
 * 0.6% delayed credits; not real values) gives hand-computed amounts, and the bundled rules give
 * `unverified`. The amounts-at-claim-age mode is rule-free. Cumulative totals are checked against
 * monthly × months (computed here only).
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { ssBenefitAtClaim } from '../socialSecurity/socialSecurity';
import { ssClaimingComparison, type SsClaimingComparisonResult } from './ssClaimingComparison';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const fixtureCtx = { currentYear: YEAR, rules: fixtureRules() };

function ok(r: ReturnType<typeof ssClaimingComparison>): SsClaimingComparisonResult {
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') throw new Error(JSON.stringify(r));
  return r.value;
}

describe('ssClaimingComparison: PIA mode', () => {
  const input = { mode: 'pia' as const, birthYear: YEAR - 62, piaMonthly: dollars(2_000), throughAge: 90 };

  it('applies the claim factor at each age 62–70 (parity with ssBenefitAtClaim) and sums lifetime totals', () => {
    const v = ok(ssClaimingComparison(input, fixtureCtx));
    expect(v.fullRetirementAge).toEqual({ years: 67, months: 0 });
    expect(v.options.map((o) => o.claimAge.years)).toEqual([62, 63, 64, 65, 66, 67, 68, 69, 70]);
    for (const o of v.options) {
      const direct = ssBenefitAtClaim(
        { piaMonthly: dollars(2_000), birthYear: YEAR - 62, birthMonth: 1, claimAge: o.claimAge },
        fixtureRules().standing,
      );
      expect(direct.status === 'ok' && direct.value.monthly).toBe(o.monthly);
      // Born in January: 12 months a year from the claim year through 90.
      expect(o.cumulativeThroughAge).toBe(o.monthly * 12 * (91 - o.claimAge.years));
      expect(o.firstBenefitYear).toBe(YEAR - 62 + o.claimAge.years);
    }
    const at62 = v.options[0]!;
    const at70 = v.options[8]!;
    expect(at62.monthly).toBe(dollars(1_448)); // 1 − (0.005·36 + 0.004·24) = 0.724
    expect(at62.monthsFromFra).toBe(-60);
    expect(at70.monthly).toBe(dollars(2_432)); // 1 + 0.006·36 = 1.216
    expect(at70.adjustmentFactor).toBeCloseTo(1.216, 12);
    // Break-even of 70 vs 62: first age with 2432·(age − 69) ≥ 1448·(age − 61).
    let breakEven = 70;
    while (2_432 * (breakEven - 69) < 1_448 * (breakEven - 61)) breakEven++;
    expect(at70.breakEvenAgeVsEarliest).toBe(breakEven);
    expect(at62.breakEvenAgeVsEarliest).toBeNull();
    expect(v.highestTotal).toEqual({ years: 70, months: 0 });
    expect(v.basis).toEqual({ dollars: 'todaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' });
    expect(v.excludedFeatures).toEqual([]);
  });

  it('prorates the claim year by birth month', () => {
    const v = ok(ssClaimingComparison({ ...input, birthMonth: 7, throughAge: 70 }, fixtureCtx));
    const at67 = v.options.find((o) => o.claimAge.years === 67)!;
    // Six months in the claim year (July–December), then 12 a year through 70.
    expect(at67.cumulativeThroughAge).toBe(at67.monthly * (6 + 12 * 3));
  });

  it('is unverified with the bundled rules, naming the missing keys', () => {
    const r = ssClaimingComparison(input, ctx);
    expect(r.status).toBe('unverified');
    if (r.status !== 'unverified') return;
    expect(r.missing.map((m) => m.key)).toContain('standing:socialSecurity.fraByBirthYear');
    expect(new Set(r.missing.map((m) => m.key)).size).toBe(r.missing.length);
  });
});

describe('ssClaimingComparison: amounts at each claiming age (rule-free)', () => {
  const options = [
    { claimAge: { years: 70, months: 0 }, monthlyAtClaim: dollars(2_480) },
    { claimAge: { years: 62, months: 0 }, monthlyAtClaim: dollars(1_400) },
    { claimAge: { years: 67, months: 0 }, monthlyAtClaim: dollars(2_000) },
  ];

  it('works with the bundled (unverified) rules and sorts the options by age', () => {
    const v = ok(
      ssClaimingComparison({ mode: 'amountsAtClaimAge', birthYear: YEAR - 60, throughAge: 85, options }, ctx),
    );
    expect(v.options.map((o) => o.claimAge.years)).toEqual([62, 67, 70]);
    expect(v.options.map((o) => o.cumulativeThroughAge)).toEqual([
      dollars(1_400) * 12 * 24,
      dollars(2_000) * 12 * 19,
      dollars(2_480) * 12 * 16,
    ]);
    expect(v.options[0]?.adjustmentFactor).toBeNull();
    expect(v.fullRetirementAge).toBeNull();
    expect(v.options[0]?.cumulativeByAge[0]).toEqual({ age: 60, cumulative: 0 });
    // 2,480·12·16 = 476,160 > 2,000·12·19 = 456,000 > 1,400·12·24 = 403,200.
    expect(v.highestTotal).toEqual({ years: 70, months: 0 });
  });

  it('leaves out claiming ages already passed, and compares months-precise ages', () => {
    const v = ok(
      ssClaimingComparison(
        {
          mode: 'amountsAtClaimAge',
          birthYear: YEAR - 65,
          throughAge: 75,
          options: [...options, { claimAge: { years: 66, months: 6 }, monthlyAtClaim: dollars(1_900) }],
        },
        ctx,
      ),
    );
    expect(v.currentAge).toBe(65);
    expect(v.options.map((o) => o.claimAge)).toEqual([
      { years: 66, months: 6 },
      { years: 67, months: 0 },
      { years: 70, months: 0 },
    ]);
    // 66y6m, born January: six months in the claim year, then 12 a year through 75.
    expect(v.options[0]?.cumulativeThroughAge).toBe(dollars(1_900) * (6 + 12 * 9));
  });

  it('reports nothing to compare when every claiming age has passed', () => {
    const v = ok(
      ssClaimingComparison({ mode: 'amountsAtClaimAge', birthYear: YEAR - 75, throughAge: 80, options }, ctx),
    );
    expect(v.options).toEqual([]);
    expect(v.highestTotal).toBeNull();
  });

  it('rejects invalid input', () => {
    const bad = ssClaimingComparison(
      {
        mode: 'amountsAtClaimAge',
        birthYear: YEAR - 60,
        throughAge: 61,
        options: [
          { claimAge: { years: 61, months: 0 }, monthlyAtClaim: 1 },
          { claimAge: { years: 61, months: 0 }, monthlyAtClaim: 1 },
        ],
      },
      ctx,
    );
    expect(bad.status).toBe('invalid');
    if (bad.status !== 'invalid') return;
    expect(bad.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(['throughAge', 'options']));
    const passed = ssClaimingComparison({ mode: 'pia', birthYear: YEAR - 95, piaMonthly: 1, throughAge: 90 }, ctx);
    expect(passed.status === 'invalid' && passed.issues[0]?.path).toEqual(['throughAge']);
    expect(ssClaimingComparison({ mode: 'pia' } as never, ctx).status).toBe('invalid');
  });
});
