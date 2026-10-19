/**
 * Rules integrity (brief §4): a test fails if any non-null rule value lacks a source, if a null value
 * lacks `unverifiedReason`, or if a year's file is missing required keys.
 */
import { describe, expect, it } from 'vitest';
import { RulesSetSchema, TaxYearRulesSchema, StandingRulesSchema, type Verified } from '../domain/rules';
import { RULES } from './index';
import { candidateRule, notPublishedRule, unverifiedRule, verifiedRule } from './helpers';

type Leaf = { path: string; rule: Verified<unknown> };

function leaves(node: unknown, path: string, out: Leaf[] = []): Leaf[] {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    if (typeof obj['status'] === 'string' && 'value' in obj) {
      out.push({ path, rule: obj as unknown as Verified<unknown> });
      return out;
    }
    for (const [key, child] of Object.entries(obj)) leaves(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const all = [
  ...leaves(RULES.standing, 'standing'),
  ...Object.entries(RULES.years).flatMap(([year, rules]) => leaves(rules, year)),
];

describe('rules data', () => {
  it('validates against the schemas (every year file has every required key)', () => {
    expect(RulesSetSchema.safeParse(RULES).success).toBe(true);
    expect(StandingRulesSchema.safeParse(RULES.standing).success).toBe(true);
    for (const [year, rules] of Object.entries(RULES.years)) {
      const parsed = TaxYearRulesSchema.safeParse(rules);
      expect(parsed.success, `year ${year}`).toBe(true);
      expect(String(rules.taxYear)).toBe(year);
    }
  });

  it('finds the rule leaves', () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it.each(all)('$path: verified values have a primary source; nulls have a reason', ({ rule }) => {
    if (rule.status === 'verified') {
      expect(rule.value).not.toBeNull();
      expect(rule.source.url).toMatch(/^https:\/\//);
      expect(rule.source.method).toBe('primary-document');
      expect(rule.indexation).toMatch(/^(indexed|statutory-fixed)$/);
    } else {
      expect(rule.value).toBeNull();
      expect(rule.source).toBeNull();
      expect(rule.unverifiedReason.length).toBeGreaterThan(10);
    }
    if (rule.status === 'unverified' && rule.candidate) {
      expect(rule.candidate.source.method).toBe('search-excerpt');
    }
  });

  it('records the current verification state honestly (no value verified while sources are blocked)', () => {
    const counts = { verified: 0, unverified: 0, notPublished: 0 };
    for (const { rule } of all) counts[rule.status]++;
    // Update this expectation when values are verified at source (docs/rules-verification.md).
    expect(counts.verified).toBe(0);
    expect(counts.unverified).toBeGreaterThan(0);
  });
});

describe('rule helpers', () => {
  const ref = { publication: 'IRS Notice 2025-67', url: 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf' };

  it('builds complete Verified<T> shapes', () => {
    expect(verifiedRule(1, ref, { retrievedOn: '2026-10-18', indexation: 'indexed' })).toMatchObject({
      status: 'verified',
      secondSource: null,
      rounding: null,
      sunsetYear: null,
      notes: null,
    });
    const full = verifiedRule(1, ref, {
      retrievedOn: '2026-10-18',
      indexation: 'indexed',
      secondSource: { ...ref, locator: 'p. 2' },
      rounding: { mode: 'down', incrementDollars: 500 },
      sunsetYear: 2028,
      notes: 'n',
    });
    expect(full).toMatchObject({
      secondSource: { locator: 'p. 2' },
      sunsetYear: 2028,
      rounding: { incrementDollars: 500 },
    });
    expect(candidateRule(1, ref, { retrievedOn: '2026-10-18' })).toMatchObject({ status: 'unverified', value: null });
    expect(unverifiedRule('reason text')).toMatchObject({ status: 'unverified', candidate: null, indexation: null });
    expect(notPublishedRule('reason text', 'indexed')).toMatchObject({ status: 'notPublished', indexation: 'indexed' });
  });
});

describe('RuleAccess', () => {
  it('records each missing key once, merging features, and absorbs other accessors', async () => {
    const { RuleAccess } = await import('./access');
    const a = new RuleAccess(2026);
    const missingRule = unverifiedRule<number>('not verified');
    expect(a.get(missingRule, 'ira.limit', 'iraLimits')).toBeNull();
    a.get(missingRule, 'ira.limit', 'iraLimits');
    a.get(missingRule, 'ira.limit', 'rothIraEligibility');
    expect(a.missing).toEqual([
      { key: '2026:ira.limit', reason: 'not verified', features: ['iraLimits', 'rothIraEligibility'] },
    ]);
    const b = new RuleAccess('standing');
    b.get(missingRule, 'payroll.oasdiEmployeeRate', 'payrollTax');
    a.absorb(b.missing);
    a.absorb([{ key: '2026:ira.limit', reason: 'x', features: ['iraLimits', 'hsaLimits'] }]);
    expect(a.missing.map((m) => m.key)).toEqual(['2026:ira.limit', 'standing:payroll.oasdiEmployeeRate']);
    expect(a.missing[0]!.features).toEqual(['iraLimits', 'rothIraEligibility', 'hsaLimits']);
    expect(a.ok).toBe(false);
    const ref = { publication: 'p', url: 'https://www.irs.gov/x' };
    const c = new RuleAccess(2026);
    expect(c.get(verifiedRule(5, ref, { retrievedOn: '2026-10-19', indexation: 'indexed' }), 'x', 'iraLimits')).toBe(5);
    expect(c.ok).toBe(true);
  });
});
