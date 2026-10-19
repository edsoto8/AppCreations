/**
 * Limits use the PINNED SYNTHETIC FIXTURE (src/testing/fixtureRules.ts), not real IRS values:
 * deferral $20,000; catch-up 50+ $7,000; 60–63 $10,000; annual additions $60,000; compensation limit
 * $300,000; Roth catch-up wage threshold $140,000 (in force); IRA $7,000 (+$1,000 at 50+);
 * Roth phase-out single $100k–$115k, MFJ $200k–$210k; rounding up to $10 with a $200 minimum;
 * HSA $4,000 / $8,000 (+$1,000 at 55+).
 */
import { describe, expect, it } from 'vitest';
import type { NominalRate } from '../domain/primitives';
import { WorkplacePlanSchema, type WorkplacePlan } from '../domain/household';
import type { ContributionRequest } from '../api';
import { dollars } from '../money';
import { resolveRules } from '../rules/resolve';
import { RULES } from '../rules/index';
import { unverifiedRule } from '../rules/helpers';
import { FIXTURE_YEAR, fixtureRules, fixtureStanding, fixtureYear } from '../testing/fixtureRules';
import { capContributions } from './workplace';
import { estimateMagi, rothIraEligibility } from './ira';
import { hsaLimit } from './hsa';

const resolve = (rules = fixtureRules()) =>
  resolveRules(rules, { anchorYear: FIXTURE_YEAR, targetYear: FIXTURE_YEAR, indexRate: 0 as NominalRate });
const R = resolve();
const realRules = resolveRules(RULES, { anchorYear: 2026, targetYear: 2026, indexRate: 0.025 as NominalRate });

const plan = (p: Record<string, unknown> = {}): WorkplacePlan =>
  WorkplacePlanSchema.parse({
    id: 'plan-1',
    planType: '401k',
    traditionalAccountId: 'k',
    rothAccountId: 'kr',
    planOffersRoth: true,
    match: {
      tiers: [
        { matchRate: 1, bandPctOfPay: 0.03 },
        { matchRate: 0.5, bandPctOfPay: 0.02 },
      ],
    },
    ...p,
  });

const req = (r: Partial<ContributionRequest> = {}): ContributionRequest => ({
  year: FIXTURE_YEAR,
  age: 40,
  plan: plan(),
  requestedTraditional: dollars(15_000),
  requestedRoth: dollars(0),
  otherAggregatedDeferrals: dollars(0),
  eligibleCompForMatch: dollars(100_000),
  priorYearFicaWages: dollars(100_000),
  ...r,
});

const ok = <T>(r: { status: string; value?: T }) => {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
  return r as { status: 'ok'; value: T; warnings: { code: string; message: string }[] };
};

describe('capContributions', () => {
  it('passes contributions below the limit through and computes the match', () => {
    const r = ok(capContributions(req(), R));
    expect(r.value).toMatchObject({
      traditional: dollars(15_000),
      roth: 0,
      catchUp: 0,
      employerMatch: dollars(4_000),
      cappedAmount: 0,
    });
    expect(r.warnings).toEqual([]);
  });

  it('accepts exactly the limit and caps above it pro rata, with a warning', () => {
    expect(ok(capContributions(req({ requestedTraditional: dollars(20_000) }), R)).value.cappedAmount).toBe(0);
    const r = ok(capContributions(req({ requestedTraditional: dollars(15_000), requestedRoth: dollars(10_000) }), R));
    expect(r.value).toMatchObject({ traditional: dollars(12_000), roth: dollars(8_000), cappedAmount: dollars(5_000) });
    expect(r.warnings.map((w) => w.code)).toContain('deferralCapped');
  });

  it.each([
    [49, 20_000],
    [50, 27_000],
    [59, 27_000],
    [60, 30_000],
    [63, 30_000],
    [64, 27_000],
  ])('catch-up age boundary: age %d may defer up to $%d', (age, max) => {
    const r = ok(
      capContributions(req({ age, requestedTraditional: dollars(40_000), priorYearFicaWages: dollars(100_000) }), R),
    );
    expect(r.value.traditional + r.value.roth).toBe(dollars(max));
    expect(r.value.catchUp).toBe(dollars(max - 20_000));
  });

  it('makes catch-ups Roth for prior-year wages above the threshold', () => {
    const r = ok(
      capContributions(
        req({ age: 55, requestedTraditional: dollars(27_000), priorYearFicaWages: dollars(150_000) }),
        R,
      ),
    );
    expect(r.value).toMatchObject({ traditional: dollars(20_000), roth: dollars(7_000), catchUpIsRoth: true });
    expect(r.warnings.map((w) => w.code)).toContain('rothCatchUpRequired');
    // At (not above) the threshold the rule does not apply.
    const at = ok(
      capContributions(
        req({ age: 55, requestedTraditional: dollars(27_000), priorYearFicaWages: dollars(140_000) }),
        R,
      ),
    );
    expect(at.value).toMatchObject({ traditional: dollars(27_000), catchUpIsRoth: false });
  });

  it('removes the catch-up when Roth is required but the plan has no Roth', () => {
    const r = ok(
      capContributions(
        req({
          age: 55,
          plan: plan({ planOffersRoth: false, rothAccountId: null }),
          requestedTraditional: dollars(27_000),
          priorYearFicaWages: dollars(150_000),
        }),
        R,
      ),
    );
    expect(r.value).toMatchObject({ traditional: dollars(20_000), roth: 0, catchUp: 0 });
  });

  it('keeps the catch-up as elected and warns when prior-year wages are unknown', () => {
    const r = ok(
      capContributions(req({ age: 55, requestedTraditional: dollars(27_000), priorYearFicaWages: null }), R),
    );
    expect(r.value.traditional).toBe(dollars(27_000));
    expect(r.warnings.some((w) => w.code === 'rothCatchUpRequired' && /unknown/.test(w.message))).toBe(true);
  });

  it('computes the match on pay up to the compensation limit', () => {
    const r = ok(
      capContributions(req({ requestedTraditional: dollars(20_000), eligibleCompForMatch: dollars(400_000) }), R),
    );
    // 20,000 / 300,000 = 6.7% ≥ 5% → full match of 4% × 300,000.
    expect(r.value.employerMatch).toBe(dollars(12_000));
    expect(r.warnings.map((w) => w.code)).toContain('compensationLimitApplied');
  });

  it('reduces employer contributions to respect the 415(c) annual additions limit', () => {
    const generous = plan({
      match: {
        tiers: [
          { matchRate: 1, bandPctOfPay: 0.03 },
          { matchRate: 0.5, bandPctOfPay: 0.02 },
        ],
        flatPctOfPay: 0.25,
      },
    });
    const r = ok(
      capContributions(
        req({ plan: generous, requestedTraditional: dollars(20_000), eligibleCompForMatch: dollars(300_000) }),
        R,
      ),
    );
    // 20,000 + match 12,000 + flat 75,000 = 107,000 → reduce 47,000 (match first).
    expect(r.value).toMatchObject({ employerMatch: 0, employerFlat: dollars(40_000), cappedAmount: dollars(47_000) });
    expect(r.warnings.map((w) => w.code)).toContain('annualAdditionsCapped');
    // 100%-of-compensation cap for a low earner.
    const low = ok(
      capContributions(req({ requestedTraditional: dollars(10_000), eligibleCompForMatch: dollars(10_000) }), R),
    );
    expect(low.value.traditional + low.value.employerMatch).toBe(dollars(10_000));
  });

  it('aggregates deferrals across 401(k)/403(b) plans', () => {
    const r = ok(
      capContributions(req({ requestedTraditional: dollars(10_000), otherAggregatedDeferrals: dollars(15_000) }), R),
    );
    expect(r.value.traditional).toBe(dollars(5_000));
  });

  it('returns unverified (never a default) when limits are null', () => {
    const r = capContributions(req(), realRules);
    expect(r.status).toBe('unverified');
    if (r.status === 'unverified') {
      expect(r.missing.map((m) => m.key)).toEqual(
        expect.arrayContaining([
          '2026:workplace.electiveDeferral',
          '2026:workplace.compensationLimit',
          '2026:workplace.annualAdditions',
        ]),
      );
      expect(r.missing.every((m) => m.features.includes('workplaceLimits'))).toBe(true);
    }
  });

  it('needs the Roth catch-up rule only when a catch-up is made', () => {
    const y = fixtureYear();
    y.workplace.rothCatchUpInForce = unverifiedRule('test');
    const rules = resolve({ standing: fixtureStanding(), years: { [FIXTURE_YEAR]: y } });
    expect(capContributions(req(), rules).status).toBe('ok');
    expect(capContributions(req({ age: 55, requestedTraditional: dollars(27_000) }), rules).status).toBe('unverified');
    y.workplace.rothCatchUpInForce = fixtureYear().workplace.rothCatchUpInForce;
    y.workplace.rothCatchUpWageThreshold = unverifiedRule('test');
    const r2 = resolve({ standing: fixtureStanding(), years: { [FIXTURE_YEAR]: y } });
    expect(capContributions(req({ age: 55, requestedTraditional: dollars(27_000) }), r2).status).toBe('unverified');
  });
});

describe('rothIraEligibility (phase-out start, midpoint, end; both statuses)', () => {
  const elig = (magi: number, filingStatus: 'single' | 'marriedFilingJointly', extra: Record<string, number> = {}) =>
    rothIraEligibility(
      {
        magi: dollars(magi),
        filingStatus,
        age: 40,
        earnedIncome: dollars(80_000),
        otherIraContributions: dollars(0),
        ...extra,
      } as never,
      R,
    );

  it.each([
    ['single', 100_000, 'full', 7_000],
    ['single', 107_500, 'reduced', 3_500],
    ['single', 115_000, 'ineligible', 0],
    ['marriedFilingJointly', 200_000, 'full', 7_000],
    ['marriedFilingJointly', 205_000, 'reduced', 3_500],
    ['marriedFilingJointly', 210_000, 'ineligible', 0],
  ] as const)('%s MAGI $%d → %s, $%d allowed', (status, magi, expected, allowed) => {
    const r = ok(elig(magi, status));
    expect(r.value.status).toBe(expected);
    expect(r.value.allowed).toBe(dollars(allowed));
  });

  it('rounds the reduced amount up to $10 with a $200 minimum', () => {
    // 7,000 × (115,000 − 114,900) / 15,000 = 46.67 → 50 → minimum 200.
    expect(ok(elig(114_900, 'single')).value.allowed).toBe(dollars(200));
    // 7,000 × (115,000 − 101,234) / 15,000 = 6,424.13 → 6,430.
    expect(ok(elig(101_234, 'single')).value.allowed).toBe(dollars(6_430));
    expect(ok(elig(101_234, 'single')).value.calculation).toMatch(/rounded up to a multiple of \$10/);
  });

  it('uses the catch-up limit at 50 and caps at earned income and other IRA contributions', () => {
    expect(
      ok(
        rothIraEligibility(
          {
            magi: dollars(50_000),
            filingStatus: 'single',
            age: 50,
            earnedIncome: dollars(80_000),
            otherIraContributions: dollars(0),
          } as never,
          R,
        ),
      ).value.allowed,
    ).toBe(dollars(8_000));
    const capped = ok(elig(50_000, 'single', { earnedIncome: dollars(3_000) }));
    expect(capped.value.allowed).toBe(dollars(3_000));
    expect(capped.warnings.map((w) => w.code)).toContain('iraEarnedIncomeCap');
    expect(ok(elig(50_000, 'single', { otherIraContributions: dollars(2_000) })).value.allowed).toBe(dollars(5_000));
  });

  it('notes backdoor Roth (not modeled) when ineligible', () => {
    expect(ok(elig(150_000, 'single')).warnings.some((w) => /Backdoor Roth/.test(w.message))).toBe(true);
  });

  it('returns unverified when limits, the phase-out or the rounding rule are null', () => {
    expect(elig(50_000, 'single').status).toBe('ok');
    const real = rothIraEligibility(
      {
        magi: dollars(50_000),
        filingStatus: 'single',
        age: 40,
        earnedIncome: dollars(80_000),
        otherIraContributions: dollars(0),
      } as never,
      realRules,
    );
    expect(real.status).toBe('unverified');
    const standing = fixtureStanding();
    standing.roth.reducedContributionRounding = unverifiedRule('test');
    const noRounding = resolve({ standing, years: { [FIXTURE_YEAR]: fixtureYear() } });
    const fullOk = rothIraEligibility(
      {
        magi: dollars(50_000),
        filingStatus: 'single',
        age: 40,
        earnedIncome: dollars(80_000),
        otherIraContributions: dollars(0),
      } as never,
      noRounding,
    );
    expect(fullOk.status).toBe('ok');
    const reduced = rothIraEligibility(
      {
        magi: dollars(107_500),
        filingStatus: 'single',
        age: 40,
        earnedIncome: dollars(80_000),
        otherIraContributions: dollars(0),
      } as never,
      noRounding,
    );
    expect(reduced.status === 'unverified' && reduced.missing[0]!.key).toBe(
      'standing:roth.reducedContributionRounding',
    );
  });
});

describe('estimateMagi', () => {
  it('is salary + bonus − traditional deferrals − HSA + other income, floored at 0', () => {
    expect(
      estimateMagi({
        salary: dollars(100_000),
        bonus: dollars(10_000),
        traditionalDeferrals: dollars(20_000),
        hsaContributions: dollars(4_000),
        otherIncome: dollars(1_000),
      }),
    ).toBe(dollars(87_000));
    expect(
      estimateMagi({
        salary: dollars(0),
        bonus: dollars(0),
        traditionalDeferrals: dollars(5_000),
        hsaContributions: dollars(0),
        otherIncome: dollars(0),
      }),
    ).toBe(0);
  });
});

describe('hsaLimit', () => {
  it('returns the coverage limit plus the 55+ catch-up', () => {
    expect(ok(hsaLimit({ coverage: 'selfOnly', age: 40, hdhpAttested: true }, R)).value).toBe(dollars(4_000));
    expect(ok(hsaLimit({ coverage: 'family', age: 55, hdhpAttested: true }, R)).value).toBe(dollars(9_000));
    expect(ok(hsaLimit({ coverage: 'family', age: 54, hdhpAttested: true }, R)).value).toBe(dollars(8_000));
  });

  it('allows no contribution without HDHP attestation', () => {
    const r = ok(hsaLimit({ coverage: 'selfOnly', age: 40, hdhpAttested: false }, R));
    expect(r.value).toBe(0);
    expect(r.warnings[0]!.code).toBe('hsaNoHdhp');
  });

  it('returns unverified with null limits', () => {
    expect(hsaLimit({ coverage: 'selfOnly', age: 40, hdhpAttested: true }, realRules).status).toBe('unverified');
  });
});
