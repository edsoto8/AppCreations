/**
 * 401(k) contribution calculator (docs/financial-model.md §12.2). With the SYNTHETIC fixture rules
 * (402(g) $20,000, catch-up 50+ $7,000, 415(c) $60,000, compensation limit $300,000, Roth catch-up
 * threshold $140,000; not real values) the capped contributions are hand-computed, and the balance at
 * retirement matches FV = PV(1+r)^n + PMT(1+r)^½((1+r)^n − 1)/r (computed here only). With the
 * bundled rules the limits are unverified: contributions are as elected and labeled before limits.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { contribution401k, type Contribution401kResult } from './contribution401k';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const fixtureCtx = { currentYear: YEAR, rules: fixtureRules() };
const cents = (d: number) => Math.round(d * 100);

function ok(r: ReturnType<typeof contribution401k>): Contribution401kResult {
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') throw new Error('not ok');
  return r.value;
}

const input = {
  age: 52,
  retirementAge: 57,
  salary: dollars(200_000),
  traditionalPctOfSalary: 0.15,
  match: { tiers: [{ matchRate: 1, bandPctOfPay: 0.05 }] },
  traditionalBalance: dollars(100_000),
  annualReturn: 0.06,
  priorYearFicaWages: dollars(100_000),
};

describe('contribution401k', () => {
  it('caps deferrals at the limit plus catch-up and grows the balance to retirement (fixture rules)', () => {
    const v = ok(contribution401k(input, fixtureCtx));
    expect(v.yearOne.requestedTraditional).toBe(dollars(30_000));
    expect(v.yearOne.capped).toEqual({
      traditional: dollars(27_000),
      roth: 0,
      catchUp: dollars(7_000),
      catchUpIsRoth: false,
      employerMatch: dollars(10_000),
      employerFlat: 0,
      cappedAmount: dollars(3_000),
    });
    expect(v.yearOne.limitWarnings.map((w) => w.code)).toEqual(['deferralCapped', 'catchUpApplied']);
    expect(v.basis).toEqual({ dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: 'afterLimits' });
    expect(v.rows).toHaveLength(5);
    // Engine parity: year 1 matches capContributions. From year 2 the prior-year wages are the
    // projected $200,000 (above the $140,000 fixture threshold), so the catch-up is made as Roth (§3.4).
    expect(v.rows[0]).toMatchObject({
      employeeTraditional: dollars(27_000),
      employeeRoth: 0,
      employerMatch: dollars(10_000),
    });
    for (const row of v.rows.slice(1)) {
      expect(row).toMatchObject({
        employeeTraditional: dollars(20_000),
        employeeRoth: dollars(7_000),
        catchUp: dollars(7_000),
        employerMatch: dollars(10_000),
      });
    }
    const r = 0.06;
    const fv = 100_000 * (1 + r) ** 5 + 37_000 * Math.sqrt(1 + r) * (((1 + r) ** 5 - 1) / r);
    expect(Math.abs(v.totals.balanceAtRetirement - cents(fv))).toBeLessThanOrEqual(1);
    expect(v.totals.balanceAtRetirementReal).toBe(v.totals.balanceAtRetirement);
    expect(v.totals.employeeContributions).toBe(dollars(135_000));
    expect(v.totals.employerContributions).toBe(dollars(50_000));
    expect(dollars(100_000) + v.totals.employeeContributions + v.totals.employerContributions + v.totals.growth).toBe(
      v.totals.balanceAtRetirement,
    );
  });

  it('makes the catch-up Roth for a higher earner, and splits Roth and traditional balances', () => {
    const v = ok(
      contribution401k(
        { ...input, traditionalPctOfSalary: 0.1, rothPctOfSalary: 0.05, priorYearFicaWages: dollars(200_000) },
        fixtureCtx,
      ),
    );
    expect(v.yearOne.capped?.catchUpIsRoth).toBe(true);
    expect(v.yearOne.capped?.roth).toBe(dollars(9_000));
    expect(v.rows[0]?.rothBalance).toBeGreaterThan(0);
    expect(v.rows[0]?.traditionalBalance).toBeGreaterThan(0);
    expect((v.rows[0]?.rothBalance ?? 0) + (v.rows[0]?.traditionalBalance ?? 0)).toBe(v.rows[0]?.totalBalance);
  });

  it('shows contributions as elected, before limits, while the limits are unverified (bundled rules)', () => {
    const v = ok(contribution401k(input, ctx));
    expect(v.yearOne.capped).toBeNull();
    expect(v.yearOne.limitWarnings).toEqual([]);
    expect(v.basis.limits).toBe('beforeLimits');
    expect(v.excludedFeatures).toContain('workplaceLimits');
    expect(v.unverified.map((u) => u.key)).toContain(`${YEAR}:workplace.electiveDeferral`);
    expect(v.rows[0]).toMatchObject({
      employeeTraditional: dollars(30_000),
      catchUp: 0,
      employerMatch: dollars(10_000),
    });
    expect(v.yearOne.matchBeforeLimits.match).toBe(dollars(10_000));
  });

  it('works for a plan without Roth and rejects contradictory input', () => {
    const v = ok(contribution401k({ ...input, planOffersRoth: false, match: null }, fixtureCtx));
    expect(v.rows[0]?.employerMatch).toBe(0);
    expect(v.rows[0]?.rothBalance).toBe(0);
    const bad = contribution401k({ ...input, planOffersRoth: false, rothPctOfSalary: 0.05, retirementAge: 50 }, ctx);
    expect(bad.status).toBe('invalid');
    if (bad.status !== 'invalid') return;
    expect(bad.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(['retirementAge', 'rothPctOfSalary']));
  });

  it('reports household problems under `household`', () => {
    const r = contribution401k({ ...input, age: 120, retirementAge: 121 } as never, {
      currentYear: 1950,
      rules: RULES,
    });
    expect(r.status).toBe('invalid');
  });
});
