/** Allocation view (c) and the sequence-of-returns illustration (docs/financial-model.md §11). */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema } from '../domain/household';
import { SAMPLE_PROFILES } from '../samples/profiles';
import { projectHousehold } from '../projection/project';
import { RULES } from '../rules/index';
import { allocationByAssetClass, SEQUENCE_DEVIATIONS, sequenceRiskIllustration } from './views';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const near = () => SAMPLE_PROFILES.find((s) => s.id === 'nearRetirement')!.build(YEAR);

describe('allocation by asset class', () => {
  it('splits each account by its target allocation and keeps unallocated accounts apart', () => {
    const base = near();
    const h = HouseholdSchema.parse({
      ...base,
      accounts: base.accounts.map((a, i) =>
        i === 0 ? { ...a, allocation: { stocks: 0.6, bonds: 0.3, cash: 0.1 } } : { ...a, allocation: null },
      ),
    });
    const r = projectHousehold(h, ctx);
    if (r.status !== 'ok') throw new Error('projection');
    const view = allocationByAssetClass(h, r.value);
    expect(view).toHaveLength(r.value.rows.length);
    const first = view[0]!;
    const row = r.value.rows[0]!;
    const allocated = row.accounts[0]!.end;
    expect(first.stocks).toBe(Math.round(allocated * 0.6));
    expect(first.bonds).toBe(Math.round(allocated * 0.3));
    expect(
      Math.abs(first.stocks + first.bonds + first.cash + first.unallocated - row.totals.portfolioEnd),
    ).toBeLessThanOrEqual(2);
    expect(first.unallocated).toBe(row.totals.portfolioEnd - allocated);
    expect(first.deflator).toBe(row.deflator);
  });
});

describe('sequence-of-returns illustration', () => {
  it('uses the same deviations (same average) in two orders; bad years first ends lower', () => {
    expect(SEQUENCE_DEVIATIONS.reduce((x, y) => x + y, 0)).toBeCloseTo(0, 12);
    const r = sequenceRiskIllustration(near(), ctx);
    if (r.status !== 'ok') throw new Error(JSON.stringify(r));
    const v = r.value;
    expect(v.startYear).toBe(v.baseline.summary.retirementYear);
    const start = v.baseline.rows.findIndex((row) => row.year === v.startYear);
    const applied = (p: typeof v.baseline, k: number) => p.rows[start + k]!.accounts[0]!.appliedReturn;
    expect(applied(v.badYearsFirst, 0) - applied(v.baseline, 0)).toBeCloseTo(SEQUENCE_DEVIATIONS[0]!, 12);
    expect(applied(v.goodYearsFirst, 0) - applied(v.baseline, 0)).toBeCloseTo(SEQUENCE_DEVIATIONS.at(-1)!, 12);
    // Outside the window the baseline return applies.
    const after = start + SEQUENCE_DEVIATIONS.length;
    if (after < v.baseline.rows.length)
      expect(applied(v.badYearsFirst, SEQUENCE_DEVIATIONS.length)).toBe(
        applied(v.baseline, SEQUENCE_DEVIATIONS.length),
      );
    // Same average, different order: with withdrawals, bad years first leaves less at the window's end.
    const end = start + SEQUENCE_DEVIATIONS.length - 1;
    expect(v.badYearsFirst.rows[end]!.totals.portfolioEnd).toBeLessThan(
      v.goodYearsFirst.rows[end]!.totals.portfolioEnd,
    );
  });

  it('rejects unusable deviations', () => {
    expect(sequenceRiskIllustration(near(), ctx, []).status).toBe('invalid');
    expect(sequenceRiskIllustration(near(), ctx, [-0.95]).status).toBe('invalid');
  });
});
