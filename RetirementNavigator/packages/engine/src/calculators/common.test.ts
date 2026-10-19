/** Calculator plumbing (docs/financial-model.md §12): search control logic, labels, step helpers. */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { HouseholdSchema } from '../domain/household';
import type { EngineResult, UnverifiedDetail } from '../domain/results';
import type { ProjectionResult } from '../domain/projection';
import { minimalHouseholdInput } from '../samples/minimal';
import {
  all,
  buildHousehold,
  itemAt,
  lastOf,
  notNull,
  projectInput,
  limitsBasisOf,
  mergeLabels,
  project,
  ruleValue,
  searchMaximum,
  searchMinimum,
  taxBasisOf,
  type Step,
} from './common';

const ctx = { currentYear: 2026, rules: RULES };
const pass = (ok: boolean): Step<{ pass: boolean; detail: null }> => ({ ok: true, value: { pass: ok, detail: null } });
const failing: Step<never> = { ok: false, result: { status: 'invalid', issues: [{ path: ['x'], message: 'bad' }] } };

describe('searchMinimum / searchMaximum', () => {
  it('finds integer and float boundaries within the tolerance', () => {
    const min = searchMinimum(0, 1_000, 1, true, (x) => pass(x >= 377));
    expect(min.ok && min.value).toMatchObject({ status: 'found', value: 377 });
    const minFloat = searchMinimum(0, 1, 1e-9, false, (x) => pass(x >= 0.6));
    expect(minFloat.ok && Math.abs((minFloat.value.value ?? 0) - 0.6)).toBeLessThan(1e-9);
    const max = searchMaximum(0, 1, 1e-9, false, (x) => pass(x <= 0.3));
    expect(max.ok && Math.abs((max.value.value ?? 0) - 0.3)).toBeLessThan(1e-9);
    expect(max.ok && max.value.status).toBe('found');
  });

  it('reports the bounds', () => {
    expect(searchMinimum(5, 10, 1, true, () => pass(true))).toMatchObject({ value: { status: 'atBound', value: 5 } });
    expect(searchMinimum(5, 10, 1, true, () => pass(false))).toMatchObject({
      value: { status: 'notWithinBound', value: null, evaluations: 2 },
    });
    expect(searchMaximum(5, 10, 1, true, () => pass(true))).toMatchObject({ value: { status: 'atBound', value: 10 } });
    expect(searchMaximum(5, 10, 1, true, () => pass(false))).toMatchObject({
      value: { status: 'notWithinBound', value: null, evaluations: 1 },
    });
  });

  it('stops when an integer bracket cannot be split, and passes engine failures through', () => {
    // Tolerance 0 on integers: the bracket [n, n+1] has no integer midpoint.
    const min = searchMinimum(0, 9, 0, true, (x) => pass(x >= 4));
    expect(min.ok && min.value.value).toBe(4);
    const max = searchMaximum(0, 9, 0, true, (x) => pass(x <= 4));
    expect(max.ok && max.value.value).toBe(4);
    for (const at of [0, 1, 2]) {
      let calls = 0;
      const f = (x: number) => (calls++ === at ? failing : pass(x > 3));
      expect(searchMinimum(0, 10, 1, true, f).ok).toBe(false);
      calls = 0;
      const g = (x: number) => (calls++ === at ? failing : pass(x < 3));
      expect(searchMaximum(0, 10, 1, true, g).ok).toBe(false);
    }
  });
});

describe('step helpers and labels', () => {
  it('reads rule results, recording missing keys and passing invalid through', () => {
    const missing: UnverifiedDetail[] = [];
    const gap: UnverifiedDetail = { key: 'standing:x', reason: 'r', features: ['rmd'] };
    expect(ruleValue({ status: 'ok', value: 3, warnings: [] }, missing)).toBe(3);
    expect(ruleValue({ status: 'unverified', missing: [gap] }, missing)).toBeNull();
    expect(missing).toEqual([gap]);
    const bad: EngineResult<number> = { status: 'invalid', issues: [] };
    expect(ruleValue(bad, missing)).toBeNull();
    expect(missing).toHaveLength(1);
  });

  it('reports household problems under `household` and passes projection failures through', () => {
    const input = minimalHouseholdInput(2026);
    const bad = buildHousehold({ ...input, people: [] });
    expect(!bad.ok && bad.result.status === 'invalid' && bad.result.issues[0]?.path[0]).toBe('household');
    const h = HouseholdSchema.parse(input);
    const past = project(h, { currentYear: 2200, rules: RULES });
    expect(past.ok).toBe(false);
  });

  it('merges labels and derives the tax and limits basis', () => {
    const h = HouseholdSchema.parse(minimalHouseholdInput(2026));
    const p = project(h, ctx);
    if (!p.ok) throw new Error('not ok');
    const proj = p.value.projection;
    const twin: ProjectionResult = {
      ...proj,
      excludedFeatures: ['workplaceLimits'],
      unverified: [{ key: proj.unverified[0]?.key ?? 'k', reason: 'r', features: ['workplaceLimits'] }],
    };
    const merged = mergeLabels([proj, twin]);
    expect(merged.excludedFeatures).toEqual([...new Set([...proj.excludedFeatures, 'workplaceLimits'])]);
    expect(merged.unverified[0]?.features).toContain('workplaceLimits');
    expect(taxBasisOf(proj)).toBe('beforeTaxes');
    expect(taxBasisOf(twin)).toBe('afterTaxes');
    expect(limitsBasisOf(twin)).toBe('beforeLimits');
    expect(limitsBasisOf({ ...proj, excludedFeatures: [] })).toBe('afterLimits');
  });

  it('guards construction invariants and combines steps', () => {
    expect(itemAt([1, 2], 1)).toBe(2);
    expect(lastOf([1, 2])).toBe(2);
    expect(() => itemAt([], 0)).toThrow(RangeError);
    expect(notNull(0, 'a number')).toBe(0);
    expect(() => notNull(null, 'a value')).toThrow('Expected a value');
    expect(all(pass(true), pass(false))).toMatchObject({ ok: true, value: [{ pass: true }, { pass: false }] });
    expect(all(pass(true), failing)).toBe(failing);
    const past = projectInput({ ...minimalHouseholdInput(2026), people: [] }, ctx);
    expect(!past.ok && past.result.status).toBe('invalid');
  });

  it('adds extra null-rule keys to the labels', () => {
    const extra = { key: 'standing:y', reason: 'r', features: ['rmd', 'rmd'] };
    expect(mergeLabels([], [extra])).toEqual({
      excludedFeatures: ['rmd'],
      unverified: [{ ...extra, features: ['rmd', 'rmd'] }],
    });
  });
});
