import { describe, expect, it } from 'vitest';
import type { NominalRate } from '../domain/primitives';
import type { RulesSet, TaxYearRules, Verified } from '../domain/rules';
import { dollars } from '../money';
import { RULES } from './index';
import { notPublishedRule, unverifiedRule, verifiedRule } from './helpers';
import { resolveRules } from './resolve';

/**
 * Synthetic rules (NOT real values): resolution logic is tested independently of what is verified.
 * Amounts are arbitrary round numbers.
 */
const ref = { publication: 'Synthetic test source', url: 'https://www.irs.gov/test' };
const on = { retrievedOn: '2026-10-18' };
const idx = <T>(v: T, rounding?: { mode: 'down' | 'nearest' | 'up'; incrementDollars: number }) =>
  verifiedRule(v, ref, { ...on, indexation: 'indexed', ...(rounding ? { rounding } : {}) });
const fixed = <T>(v: T) => verifiedRule(v, ref, { ...on, indexation: 'statutory-fixed' });

function synthetic(year: number, deferral: Verified<number>): TaxYearRules {
  const base = structuredClone(RULES.years['2026']!);
  base.taxYear = year;
  base.workplace.electiveDeferral = deferral as TaxYearRules['workplace']['electiveDeferral'];
  base.ira.limit = idx(dollars(1_000)) as TaxYearRules['ira']['limit'];
  base.tax.brackets.single = idx([
    { rate: 0.1, lowerBound: dollars(0) },
    { rate: 0.2, lowerBound: dollars(10_000) },
  ]) as TaxYearRules['tax']['brackets']['single'];
  base.payroll.ssWageBase = fixed(dollars(50_000)) as TaxYearRules['payroll']['ssWageBase'];
  base.socialSecurity.colaEffectiveJanuary = verifiedRule(0.03, ref, { ...on, indexation: 'indexed' });
  // A verified value with no projection path: indexation recorded as fixed? No — use null via cast below.
  return base;
}

function set(years: Record<number, TaxYearRules>): RulesSet {
  return {
    standing: RULES.standing,
    years: Object.fromEntries(Object.entries(years).map(([y, r]) => [y, r])),
  };
}

const rate = (r: number) => r as NominalRate;

describe('resolveRules', () => {
  const y2026 = synthetic(2026, idx(dollars(20_000), { mode: 'down', incrementDollars: 500 }));
  const rules = set({ 2026: y2026 });

  it('uses the published value for a year at or before the anchor', () => {
    const r = resolveRules(rules, { anchorYear: 2026, targetYear: 2026, indexRate: rate(0.03) });
    expect(r.projected).toBe(false);
    expect(r.baseYear).toBe(2026);
    expect(r.values.workplace.electiveDeferral).toEqual(y2026.workplace.electiveDeferral);
  });

  it('projects indexed values with the published rounding rule', () => {
    const r = resolveRules(rules, { anchorYear: 2026, targetYear: 2028, indexRate: rate(0.03) });
    expect(r.projected).toBe(true);
    expect(r.values.taxYear).toBe(2028);
    // 20,000 × 1.03² = 21,218 → down to a multiple of $500 = 21,000
    expect(r.values.workplace.electiveDeferral.value).toBe(dollars(21_000));
    expect(
      r.values.workplace.electiveDeferral.status === 'verified' && r.values.workplace.electiveDeferral.notes,
    ).toMatch(/Projected from 2026 at 3% per year for 2 year/);
  });

  it('rounds to the cent when no rounding rule is recorded', () => {
    const r = resolveRules(rules, { anchorYear: 2026, targetYear: 2027, indexRate: rate(0.025) });
    expect(r.values.ira.limit.value).toBe(dollars(1_025));
  });

  it('indexes bracket thresholds but never bracket rates', () => {
    const r = resolveRules(rules, { anchorYear: 2026, targetYear: 2027, indexRate: rate(0.1) });
    expect(r.values.tax.brackets.single.value).toEqual([
      { rate: 0.1, lowerBound: dollars(0) },
      { rate: 0.2, lowerBound: dollars(11_000) },
    ]);
  });

  it('carries statutory-fixed values unchanged', () => {
    const r = resolveRules(rules, { anchorYear: 2026, targetYear: 2040, indexRate: rate(0.05) });
    expect(r.values.payroll.ssWageBase.value).toBe(dollars(50_000));
    expect(r.values.payroll.ssWageBase.status === 'verified' && r.values.payroll.ssWageBase.notes).toMatch(
      /statutory-fixed/,
    );
  });

  it('keeps null values null and never substitutes a default', () => {
    const r = resolveRules(rules, { anchorYear: 2026, targetYear: 2030, indexRate: rate(0.03) });
    // catchUp50 is unverified in the 2026 data file.
    expect(r.values.workplace.catchUp50.value).toBeNull();
    expect(r.values.workplace.catchUp50.status).toBe('unverified');
  });

  it('does not project a value whose indexation is unknown', () => {
    const y = synthetic(2026, idx(dollars(20_000)));
    y.workplace.catchUp50 = { ...fixed(dollars(5_000)), indexation: null as never };
    const r = resolveRules(set({ 2026: y }), { anchorYear: 2026, targetYear: 2027, indexRate: rate(0.03) });
    expect(r.values.workplace.catchUp50.status).toBe('unverified');
    expect(r.values.workplace.catchUp50.status !== 'verified' && r.values.workplace.catchUp50.unverifiedReason).toMatch(
      /cannot be projected/,
    );
  });

  it('falls back to the prior verified year when the target year is not yet published', () => {
    const y2027 = synthetic(2027, notPublishedRule('pending', 'indexed'));
    const r = resolveRules(set({ 2026: y2026, 2027: y2027 }), {
      anchorYear: 2027,
      targetYear: 2027,
      indexRate: rate(0.03),
    });
    expect(r.values.workplace.electiveDeferral.value).toBe(dollars(20_500)); // 20,600 → down to $500
    expect(r.values.ira.limit.value).toBe(dollars(1_000)); // 2027 file has its own verified value
  });

  it('respects the anchor year even when a newer file exists', () => {
    const y2027 = synthetic(2027, idx(dollars(30_000)));
    const r = resolveRules(set({ 2026: y2026, 2027: y2027 }), {
      anchorYear: 2026,
      targetYear: 2027,
      indexRate: rate(0),
    });
    expect(r.values.workplace.electiveDeferral.value).toBe(dollars(20_000));
    expect(r.baseYear).toBe(2026);
  });

  it('reports the target-year null entry when nothing is verified', () => {
    const y2027 = synthetic(2027, unverifiedRule('target reason'));
    const y2026u = synthetic(2026, unverifiedRule('base reason'));
    const r = resolveRules(set({ 2026: y2026u, 2027: y2027 }), {
      anchorYear: 2027,
      targetYear: 2027,
      indexRate: rate(0),
    });
    expect(r.values.workplace.electiveDeferral).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'target reason',
    });
    const later = resolveRules(set({ 2026: y2026u }), { anchorYear: 2026, targetYear: 2030, indexRate: rate(0) });
    expect(later.values.workplace.electiveDeferral).toMatchObject({ unverifiedReason: 'base reason' });
  });

  it('marks every value unverified for years before the earliest rules file', () => {
    const r = resolveRules(rules, { anchorYear: 2026, targetYear: 2020, indexRate: rate(0) });
    expect(r.values.ira.limit).toMatchObject({
      status: 'unverified',
      unverifiedReason: 'No rules data at or before 2020.',
    });
  });

  it('rejects an empty rules set (programming error)', () => {
    expect(() => resolveRules(set({}), { anchorYear: 2026, targetYear: 2026, indexRate: rate(0) })).toThrow(RangeError);
  });

  it('supports nearest and up rounding', () => {
    const near = synthetic(2026, idx(dollars(20_000), { mode: 'nearest', incrementDollars: 1_000 }));
    const up = synthetic(2026, idx(dollars(20_000), { mode: 'up', incrementDollars: 1_000 }));
    const at = (r: RulesSet) => resolveRules(r, { anchorYear: 2026, targetYear: 2027, indexRate: rate(0.03) });
    expect(at(set({ 2026: near })).values.workplace.electiveDeferral.value).toBe(dollars(21_000)); // 20,600 → 21,000
    expect(at(set({ 2026: up })).values.workplace.electiveDeferral.value).toBe(dollars(21_000));
  });

  it('resolves the bundled rules (currently all null) without inventing values', () => {
    const r = resolveRules(RULES, { anchorYear: 2027, targetYear: 2035, indexRate: rate(0.025) });
    expect(r.values.workplace.electiveDeferral.value).toBeNull();
    expect(r.values.hsa.selfOnly.value).toBeNull();
  });
});
