/**
 * Social Security against the PINNED SYNTHETIC FIXTURE (src/testing/fixtureRules.ts), not real SSA
 * values: FRA 66y0m (born before 1950) / 67y0m (1950+); early reduction 0.5%/month for 36 months then
 * 0.4%; delayed credits 0.6%/month to 70; spousal 45% with 0.6%/0.4%; survivor 95% with an 80% floor;
 * PIA factors 0.85/0.3/0.2; 2026 bend points $1,000 / $6,000; AWI(Y) = $50,000 + $1,000·(Y − 2000).
 * Expected values are computed by hand in the comments.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AgeYearsMonths, CalendarYear, Cents } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import type { RulesSet, StandingRules } from '../domain/rules';
import { dollars } from '../money';
import { RULES } from '../rules/index';
import { unverifiedRule } from '../rules/helpers';
import { fixtureRules, fixtureStanding, fixtureYear } from '../testing/fixtureRules';
import * as api from '../api';
import {
  ILLUSTRATIVE_LABEL,
  estimatePia,
  fullRetirementAge,
  spousalBenefit,
  ssBenefitAtClaim,
  survivorBenefit,
} from './socialSecurity';

const S = fixtureStanding();
const age = (years: number, months = 0): AgeYearsMonths => ({ years, months });
const c = (cents: number) => cents as Cents;
const y = (year: number) => year as CalendarYear;

function ok<T>(r: EngineResult<T>): T {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}
const keys = (r: EngineResult<unknown>) => (r.status === 'unverified' ? r.missing.map((m) => m.key).sort() : r.status);
const withSs = (patch: Partial<StandingRules['socialSecurity']>): StandingRules => ({
  ...S,
  socialSecurity: { ...S.socialSecurity, ...patch },
});
const claim = (claimAge: AgeYearsMonths, opts: { pia?: number; birthYear?: number; standing?: StandingRules } = {}) =>
  ssBenefitAtClaim(
    { piaMonthly: dollars(opts.pia ?? 2_000), birthYear: y(opts.birthYear ?? 1960), birthMonth: 3, claimAge },
    opts.standing ?? S,
  );

describe('api wiring', () => {
  it('re-exports the module functions from the frozen API', () => {
    expect(api.fullRetirementAge).toBe(fullRetirementAge);
    expect(api.ssBenefitAtClaim).toBe(ssBenefitAtClaim);
    expect(api.estimatePia).toBe(estimatePia);
    expect(api.spousalBenefit).toBe(spousalBenefit);
    expect(api.survivorBenefit).toBe(survivorBenefit);
  });
});

describe('fullRetirementAge', () => {
  it('looks up the table at its boundaries', () => {
    expect(ok(fullRetirementAge(y(1900), 1, S))).toEqual(age(66));
    expect(ok(fullRetirementAge(y(1949), 12, S))).toEqual(age(66));
    expect(ok(fullRetirementAge(y(1950), 1, S))).toEqual(age(67));
    expect(ok(fullRetirementAge(y(2100), 6, S))).toEqual(age(67));
  });

  it('reads months from a table entry', () => {
    const s = withSs({
      fraByBirthYear: {
        ...S.socialSecurity.fraByBirthYear,
        value: [{ fromBirthYear: 1950, toBirthYear: 1955, years: 66, months: 4 }],
      } as StandingRules['socialSecurity']['fraByBirthYear'],
    });
    expect(ok(fullRetirementAge(y(1955), 1, s))).toEqual(age(66, 4));
  });

  it('is unverified for a birth year the verified table does not cover', () => {
    const s = withSs({
      fraByBirthYear: {
        ...S.socialSecurity.fraByBirthYear,
        value: [{ fromBirthYear: 1950, toBirthYear: null, years: 67, months: 0 }],
      } as StandingRules['socialSecurity']['fraByBirthYear'],
    });
    const r = fullRetirementAge(y(1949), 1, s);
    expect(r.status).toBe('unverified');
    if (r.status === 'unverified') {
      expect(r.missing[0]?.key).toBe('standing:socialSecurity.fraByBirthYear');
      expect(r.missing[0]?.reason).toContain('not published for birth year 1949');
      expect(r.missing[0]?.features).toEqual(['socialSecurityClaiming']);
    }
  });

  it('is invalid for a bad birth month or year', () => {
    expect(fullRetirementAge(y(1960), 0, S).status).toBe('invalid');
    expect(fullRetirementAge(y(1960), 13, S).status).toBe('invalid');
    expect(fullRetirementAge(y(1960), 1.5, S).status).toBe('invalid');
    expect(fullRetirementAge(y(1800), 1, S).status).toBe('invalid');
  });
});

describe('ssBenefitAtClaim (PIA $2,000, born 1960, FRA 67y0m = 804 months)', () => {
  it('claim at 62: m = 60 → 1 − (0.005·36 + 0.004·24) = 0.724 → $1,448.00', () => {
    const v = ok(claim(age(62)));
    expect(v.adjustmentFactor).toBeCloseTo(0.724, 12);
    expect(v.monthly).toBe(dollars(1_448));
    expect(v.monthsFromFra).toBe(-60);
  });

  it('36-month boundary: 64y0m (m=36) 0.82; 63y11m (m=37) 0.816; 64y1m (m=35) 0.825', () => {
    expect(ok(claim(age(64))).monthly).toBe(dollars(1_640));
    expect(ok(claim(age(63, 11))).monthly).toBe(dollars(1_632));
    expect(ok(claim(age(64, 1))).monthly).toBe(dollars(1_650));
  });

  it('claim at FRA: factor 1, and the factor rules are not read', () => {
    const v = ok(claim(age(67)));
    expect(v).toEqual({ monthly: dollars(2_000), adjustmentFactor: 1, monthsFromFra: 0 });
    const s = withSs({
      earlyReduction: unverifiedRule('x'),
      delayedCreditPerMonth: unverifiedRule('x'),
      delayedCreditMaxAge: unverifiedRule('x'),
    });
    expect(ok(claim(age(67), { standing: s })).monthly).toBe(dollars(2_000));
  });

  it('claim at 70: 36 delayed months → 1 + 0.006·36 = 1.216 → $2,432.00; 67y1m → 1.006', () => {
    const v = ok(claim(age(70)));
    expect(v.monthly).toBe(dollars(2_432));
    expect(v.monthsFromFra).toBe(36);
    expect(ok(claim(age(67, 1))).monthly).toBe(dollars(2_012));
  });

  it('caps delayed credits at the max age (max 69 → 24 months → 1.144 → $2,288.00)', () => {
    const s = withSs({
      delayedCreditMaxAge: {
        ...S.socialSecurity.delayedCreditMaxAge,
        value: 69,
      } as StandingRules['socialSecurity']['delayedCreditMaxAge'],
    });
    expect(ok(claim(age(70), { standing: s })).monthly).toBe(dollars(2_288));
    expect(ok(claim(age(69), { standing: s })).monthly).toBe(dollars(2_288));
  });

  it('uses the birth year’s FRA (born 1949, FRA 66: claim 70 → 48 months → 1.288)', () => {
    expect(ok(claim(age(70), { birthYear: 1949 })).monthly).toBe(dollars(2_576));
    // claim 62 with FRA 66: m = 48 → 1 − (0.18 + 0.048) = 0.772
    expect(ok(claim(age(62), { birthYear: 1949 })).monthly).toBe(dollars(1_544));
  });

  it('rounds the monthly amount to the cent once (PIA $1,234.57 × 0.724 = 893.82868 → $893.83)', () => {
    expect(ok(claim(age(62), { pia: 1_234.57 })).monthly).toBe(89_383);
    expect(ok(claim(age(62), { pia: 0 })).monthly).toBe(0);
  });

  it('is invalid outside 62–70 or for a bad PIA', () => {
    expect(claim(age(61, 11)).status).toBe('invalid');
    expect(claim(age(70, 1)).status).toBe('invalid');
    expect(claim({ years: 65, months: 12 }).status).toBe('invalid');
    expect(claim({ years: 65.5, months: 0 }).status).toBe('invalid');
    expect(
      ssBenefitAtClaim({ piaMonthly: c(-1), birthYear: y(1960), birthMonth: 1, claimAge: age(67) }, S).status,
    ).toBe('invalid');
    expect(
      ssBenefitAtClaim({ piaMonthly: c(1.5), birthYear: y(1960), birthMonth: 1, claimAge: age(67) }, S).status,
    ).toBe('invalid');
    expect(
      ssBenefitAtClaim({ piaMonthly: c(100), birthYear: y(1960), birthMonth: 0, claimAge: age(67) }, S).status,
    ).toBe('invalid');
  });

  it('reports exactly the rule keys it needed when they are null', () => {
    const s = withSs({ earlyReduction: unverifiedRule('x'), delayedCreditPerMonth: unverifiedRule('y') });
    expect(keys(claim(age(62), { standing: s }))).toEqual(['standing:socialSecurity.earlyReduction']);
    expect(keys(claim(age(70), { standing: s }))).toEqual(['standing:socialSecurity.delayedCreditPerMonth']);
    const r = claim(age(62), { standing: RULES.standing });
    expect(keys(r)).toEqual(['standing:socialSecurity.fraByBirthYear']);
    if (r.status === 'unverified') expect(r.missing[0]?.features).toEqual(['socialSecurityClaiming']);
  });

  it('property: the benefit never decreases with a later claim age', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 744, max: 839 }), (pia, m) => {
        const a = ok(
          ssBenefitAtClaim(
            { piaMonthly: c(pia), birthYear: y(1960), birthMonth: 1, claimAge: age(Math.floor(m / 12), m % 12) },
            S,
          ),
        );
        const b = ok(
          ssBenefitAtClaim(
            {
              piaMonthly: c(pia),
              birthYear: y(1960),
              birthMonth: 1,
              claimAge: age(Math.floor((m + 1) / 12), (m + 1) % 12),
            },
            S,
          ),
        );
        return b.monthly >= a.monthly;
      }),
    );
  });
});

describe('estimatePia (illustrative)', () => {
  const R = fixtureRules();
  const average = (avg: number, years: number, birthYear = 1964, rules: RulesSet = R) =>
    estimatePia(
      { kind: 'average', birthYear: y(birthYear), averageAnnualEarnings: dollars(avg), yearsOfEarnings: years },
      rules,
    );
  const history = (birthYear: number, rows: [number, number][], rules: RulesSet = R) =>
    estimatePia(
      {
        kind: 'history',
        birthYear: y(birthYear),
        earnings: rows.map(([year, e]) => ({ year: y(year), earnings: dollars(e) })),
      },
      rules,
    );

  it('average mode, middle band: $60,000 × 35 / 420 = AIME $5,000 → 0.85·1000 + 0.3·4000 = $2,050.00', () => {
    const v = ok(average(60_000, 35));
    expect(v.aimeMonthly).toBe(dollars(5_000));
    expect(v.piaMonthly).toBe(dollars(2_050));
    expect(v.eligibilityYear).toBe(2026);
    expect(v.label).toContain(ILLUSTRATIVE_LABEL);
    expect(v.label).toContain('latest tax year');
  });

  it('average mode, fewer than 35 years: $60,000 × 20 / 420 = 2857.14 → $2,857 → $1,407.10', () => {
    const v = ok(average(60_000, 20));
    expect(v.aimeMonthly).toBe(dollars(2_857));
    expect(v.piaMonthly).toBe(dollars(1_407.1));
    // More than 35 years counts as 35.
    expect(ok(average(60_000, 40)).piaMonthly).toBe(dollars(2_050));
    expect(ok(average(60_000, 0)).piaMonthly).toBe(0);
  });

  it('truncates AIME to the dollar and PIA to the dime (top band: AIME 8333.33 → 8333 → $2,816.60)', () => {
    const v = ok(average(100_000, 35));
    expect(v.aimeMonthly).toBe(dollars(8_333));
    expect(v.piaMonthly).toBe(dollars(2_816.6));
    // First band: $6,455 × 35 / 420 = 537.92 → AIME $537 → 0.85 × 537 = 456.45 → $456.40 (to the dime).
    expect(ok(average(6_455, 35)).piaMonthly).toBe(dollars(456.4));
    // $60,001 × 35 / 420 = 5000.083 → AIME $5,000.
    expect(ok(average(60_001, 35)).aimeMonthly).toBe(dollars(5_000));
  });

  it('average mode warns that the figure is illustrative', () => {
    const r = average(60_000, 35);
    expect(r.status === 'ok' && r.warnings.map((w) => w.code)).toEqual(['ssEstimateIllustrative']);
  });

  it('history: indexes to E − 2 = 2024 (AWI $74,000), later years nominal, fewer than 35 years', () => {
    // 2000: 25,000 × 74/50 = 37,000; 2010: 30,000 × 74/60 = 37,000; 2024: 40,000; 2025: 45,000.
    // Σ 159,000 / 420 = 378.57 → AIME $378 → PIA 0.85 × 378 = $321.30.
    const v = ok(
      history(1964, [
        [2000, 25_000],
        [2010, 30_000],
        [2024, 40_000],
        [2025, 45_000],
        [2015, 0],
      ]),
    );
    expect(v.aimeMonthly).toBe(dollars(378));
    expect(v.piaMonthly).toBe(dollars(321.3));
    expect(v.eligibilityYear).toBe(2026);
    expect(v.label).toContain(ILLUSTRATIVE_LABEL);
    expect(v.label).toContain('indexed to 2024');
    expect(v.label).not.toContain('projected');
  });

  it('history: takes the top 35 indexed years', () => {
    // 1990–2024 earnings = AWI(year) → each indexes to 74,000; 1980–1989 $1,000 each (≈ $2.4k indexed) drop out.
    const rows: [number, number][] = [];
    for (let yr = 1980; yr <= 1989; yr++) rows.push([yr, 1_000]);
    for (let yr = 1990; yr <= 2024; yr++) rows.push([yr, 50_000 + 1_000 * (yr - 2000)]);
    // Σ 35 × 74,000 = 2,590,000 / 420 = 6166.67 → $6,166 → 850 + 1500 + 0.2 × 166 = $2,383.20.
    const v = ok(history(1964, rows));
    expect(v.aimeMonthly).toBe(dollars(6_166));
    expect(v.piaMonthly).toBe(dollars(2_383.2));
    expect(v.label).toContain('top 35 of 45');
  });

  it('history for a younger worker: indexes to the latest AWI year and carries the bend points (projected)', () => {
    // E = 2042; I = 2040 is past the series (ends 2025), so index to 2025 (AWI $75,000).
    // 2000: 25,000 × 75/50 = 37,500; 2025: 42,000 nominal. Σ 79,500 / 420 = 189.29 → $189 → 160.65 → $160.60.
    const r = history(1980, [
      [2000, 25_000],
      [2025, 42_000],
    ]);
    const v = ok(r);
    expect(v.aimeMonthly).toBe(dollars(189));
    expect(v.piaMonthly).toBe(dollars(160.6));
    expect(v.eligibilityYear).toBe(2042);
    expect(v.label).toContain('projected');
    expect(v.label).toContain('latest AWI year');
    expect(r.status === 'ok' && r.warnings.map((w) => w.code)).toEqual(['ssEstimateIllustrative', 'rulesProjected']);
  });

  it('is unverified when the eligibility year precedes every tax year in the rules', () => {
    const r = history(1950, [[2000, 25_000]]);
    expect(keys(r)).toEqual(['2012:socialSecurity.bendPoints']);
    if (r.status === 'unverified') expect(r.missing[0]?.features).toEqual(['socialSecurityEstimator']);
  });

  it('is unverified when the AWI series lacks an earnings year', () => {
    const r = history(1964, [
      [1965, 5_000],
      [2000, 25_000],
    ]);
    expect(keys(r)).toEqual(['standing:socialSecurity.awiSeries']);
    if (r.status === 'unverified') expect(r.missing[0]?.reason).toContain('1965');
  });

  it('is unverified when the AWI series has no value for the indexing year', () => {
    const standing = fixtureStanding();
    const series = standing.socialSecurity.awiSeries;
    if (series.status !== 'verified') throw new Error('fixture');
    const rules: RulesSet = {
      ...R,
      standing: {
        ...standing,
        socialSecurity: {
          ...standing.socialSecurity,
          awiSeries: { ...series, value: series.value.filter((a) => a.year !== 2024) },
        },
      },
    };
    const r = history(1964, [[2000, 25_000]], rules);
    expect(keys(r)).toEqual(['standing:socialSecurity.awiSeries']);
    if (r.status === 'unverified') expect(r.missing[0]?.reason).toContain('2000, 2024');
    // An empty series: earnings at or after E − 2 still need no AWI.
    const empty: RulesSet = {
      ...rules,
      standing: {
        ...rules.standing,
        socialSecurity: { ...rules.standing.socialSecurity, awiSeries: { ...series, value: [] } },
      },
    };
    expect(ok(history(1964, [[2024, 42_000]], empty)).aimeMonthly).toBe(dollars(100));
    expect(keys(history(1964, [[2000, 42_000]], empty))).toEqual(['standing:socialSecurity.awiSeries']);
  });

  it('is unverified with no tax-year rules at all', () => {
    expect(keys(average(60_000, 35, 1964, { standing: R.standing, years: {} }))).toEqual([
      '2026:socialSecurity.bendPoints',
    ]);
  });

  it('average mode uses the latest tax year in the rules (2026 unverified, 2027 verified → 2027)', () => {
    const y26 = fixtureYear(2026);
    y26.socialSecurity.bendPoints = unverifiedRule('x');
    const y27 = fixtureYear(2027);
    y27.socialSecurity.bendPoints = {
      ...fixtureYear().socialSecurity.bendPoints,
      value: { first: dollars(2_000), second: dollars(6_000) },
    } as typeof y27.socialSecurity.bendPoints;
    const rules: RulesSet = { standing: R.standing, years: { '2026': y26, '2027': y27 } };
    // AIME 5,000: 0.85 × 2,000 + 0.3 × 3,000 = $2,600.
    const v = ok(average(60_000, 35, 1964, rules));
    expect(v.piaMonthly).toBe(dollars(2_600));
    expect(v.label).toContain('bend points of 2027');
  });

  it('every needed key is reported against the bundled (unverified) rules', () => {
    expect(keys(history(1964, [[2000, 25_000]], RULES))).toEqual([
      '2026:socialSecurity.bendPoints',
      'standing:socialSecurity.awiSeries',
      'standing:socialSecurity.piaFactors',
    ]);
    expect(keys(average(60_000, 35, 1964, RULES))).toEqual([
      '2027:socialSecurity.bendPoints',
      'standing:socialSecurity.piaFactors',
    ]);
  });

  it('is invalid for bad inputs', () => {
    expect(
      history(1964, [
        [2000, 1],
        [2000, 2],
      ]).status,
    ).toBe('invalid');
    expect(history(1964, [[1800, 1]]).status).toBe('invalid');
    expect(history(1964, [[2000, -1]]).status).toBe('invalid');
    expect(average(-1, 35).status).toBe('invalid');
    expect(average(60_000, -1).status).toBe('invalid');
    expect(average(60_000, 2.5).status).toBe('invalid');
    expect(average(60_000, 35, 1800).status).toBe('invalid');
  });

  it('property: the PIA never decreases with higher average earnings', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 40 }),
        (a, d, n) => {
          const lo = ok(
            estimatePia({ kind: 'average', birthYear: y(1964), averageAnnualEarnings: c(a), yearsOfEarnings: n }, R),
          );
          const hi = ok(
            estimatePia(
              { kind: 'average', birthYear: y(1964), averageAnnualEarnings: c(a + d), yearsOfEarnings: n },
              R,
            ),
          );
          return hi.piaMonthly >= lo.piaMonthly && lo.piaMonthly % 10 === 0 && lo.aimeMonthly % 100 === 0;
        },
      ),
    );
  });
});

describe('spousalBenefit (own PIA $800, other PIA $2,000 → excess 45% × 2,000 − 800 = $100; born 1960, FRA 67)', () => {
  const spousal = (claimAge: AgeYearsMonths, own = 800, other = 2_000, standing: StandingRules = S) =>
    spousalBenefit(
      { ownPiaMonthly: dollars(own), otherPiaMonthly: dollars(other), birthYear: y(1960), birthMonth: 5, claimAge },
      standing,
    );

  it('at and after FRA: the full excess, no delayed credits', () => {
    expect(ok(spousal(age(67))).monthlyExcess).toBe(dollars(100));
    expect(ok(spousal(age(70))).monthlyExcess).toBe(dollars(100));
  });

  it('before FRA: 62 → 1 − (0.006·36 + 0.004·24) = 0.688 → $68.80; 64 → 0.784 → $78.40', () => {
    expect(ok(spousal(age(62))).monthlyExcess).toBe(dollars(68.8));
    expect(ok(spousal(age(64))).monthlyExcess).toBe(dollars(78.4));
    // 63y11m: m = 37 → 1 − (0.216 + 0.004) = 0.78 → $78.00
    expect(ok(spousal(age(63, 11))).monthlyExcess).toBe(dollars(78));
  });

  it('zero excess when the own PIA is at or above the spousal share of the other PIA (FRA not needed)', () => {
    expect(ok(spousal(age(62), 1_200)).monthlyExcess).toBe(0);
    expect(ok(spousal(age(62), 900)).monthlyExcess).toBe(0);
    const noFra = withSs({ fraByBirthYear: unverifiedRule('x') });
    expect(ok(spousal(age(62), 1_200, 2_000, noFra)).monthlyExcess).toBe(0);
    expect(keys(spousal(age(62), 800, 2_000, noFra))).toEqual(['standing:socialSecurity.fraByBirthYear']);
  });

  it('reports its rule keys against the bundled rules', () => {
    const r = spousal(age(62), 800, 2_000, RULES.standing);
    expect(keys(r)).toEqual(['standing:socialSecurity.spousal']);
    if (r.status === 'unverified') expect(r.missing[0]?.features).toEqual(['spousalSurvivorBenefits']);
  });

  it('is invalid for bad inputs', () => {
    expect(spousal(age(61)).status).toBe('invalid');
    expect(spousal(age(62), -1).status).toBe('invalid');
    expect(spousal(age(62), 800, -1).status).toBe('invalid');
    expect(
      spousalBenefit(
        { ownPiaMonthly: c(0), otherPiaMonthly: c(0), birthYear: y(1960), birthMonth: 13, claimAge: age(67) },
        S,
      ).status,
    ).toBe('invalid');
  });
});

describe('survivorBenefit (95% of the deceased benefit, 80% RIB-LIM floor of the PIA)', () => {
  const survivor = (own: number, deceased: number, pia: number, standing: StandingRules = S) =>
    survivorBenefit(
      { survivorOwnMonthly: dollars(own), deceasedBenefitMonthly: dollars(deceased), deceasedPiaMonthly: dollars(pia) },
      standing,
    );

  it('takes the higher of own and the deceased’s benefit', () => {
    expect(ok(survivor(1_000, 2_200, 2_000)).monthly).toBe(dollars(2_090)); // 95% × 2,200
    expect(ok(survivor(2_500, 2_200, 2_000)).monthly).toBe(dollars(2_500));
  });

  it('floors the survivor amount at 80% of the deceased PIA (reduced deceased benefit $1,500 → $1,600)', () => {
    expect(ok(survivor(1_000, 1_500, 2_000)).monthly).toBe(dollars(1_600));
    // 0.8 × 1,234.57 = 987.656 → $987.66
    expect(ok(survivor(0, 0, 1_234.57)).monthly).toBe(98_766);
  });

  it('has no floor when the PIA is unknown (0)', () => {
    expect(ok(survivor(1_000, 1_200, 0)).monthly).toBe(dollars(1_140));
    expect(ok(survivor(0, 0, 0)).monthly).toBe(0);
  });

  it('reports its rule key against the bundled rules and rejects bad amounts', () => {
    const r = survivor(1_000, 1_200, 2_000, RULES.standing);
    expect(keys(r)).toEqual(['standing:socialSecurity.survivor']);
    if (r.status === 'unverified') expect(r.missing[0]?.features).toEqual(['spousalSurvivorBenefits']);
    expect(survivor(-1, 0, 0).status).toBe('invalid');
    expect(survivor(0, 0, -1).status).toBe('invalid');
  });
});

describe('every Social Security function is unverified against the bundled rules', () => {
  it('fullRetirementAge', () => {
    expect(keys(fullRetirementAge(y(1960), 1, RULES.standing))).toEqual(['standing:socialSecurity.fraByBirthYear']);
  });
});
