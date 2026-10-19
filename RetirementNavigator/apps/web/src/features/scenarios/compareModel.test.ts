import { describe, expect, it } from 'vitest';
import { compareScenarios, RULES, SAMPLE_PROFILES } from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import { optimizerBlockedReason, outcomeNotes, portfolioSeries } from './compareModel';

const ctx = { currentYear: TEST_YEAR, rules: RULES };
const couple = () => SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(TEST_YEAR);

describe('compare view model', () => {
  it('takes real portfolio values from the engine row (not rounded nominal ÷ deflator)', () => {
    const [base] = compareScenarios(couple(), [], ctx);
    const rows = base!.dashboard!.baseline.rows;
    const real = portfolioSeries([base!], 'todays');
    const nominal = portfolioSeries([base!], 'nominal');
    expect(real.map((p) => p.o0)).toEqual(rows.map((r) => r.real.portfolioEnd));
    expect(nominal.map((p) => p.o0)).toEqual(rows.map((r) => r.totals.portfolioEnd));
    expect(real.every((p) => Number.isInteger(p.o0))).toBe(true);
  });

  it('lists an outcome’s dashboard notes, including the pre-Medicare healthcare note', () => {
    const [base] = compareScenarios(couple(), [], ctx);
    // Jordan retires at 63 in the sample.
    expect(outcomeNotes(base!).some((n) => /Jordan retires before 65/.test(n))).toBe(true);
  });

  it('blocks the optimizer only when the first person is already retired', () => {
    const h = couple();
    expect(optimizerBlockedReason(h, TEST_YEAR)).toBeNull();
    const [sam, jordan] = h.people;
    const retired = { ...h, people: [{ ...sam!, retirementAge: 42 }, jordan!] };
    expect(optimizerBlockedReason(retired, TEST_YEAR)).toMatch(/^Sam is already retired \(retirement age 42, age 42/);
  });
});
