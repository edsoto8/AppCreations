/**
 * Roth vs traditional (docs/financial-model.md §12.4). Engine parity with `compareScenarios` on the
 * same household and the preset G Roth twin; the after-tax figure needs verified tax rules, so the
 * after-tax path uses the SYNTHETIC fixture rules and the bundled rules give the labeled before-tax path.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../rules/index';
import { fixtureRules } from '../testing/fixtureRules';
import { dollars } from '../money';
import { HouseholdSchema } from '../domain/household';
import { compareScenarios, presetScenario } from '../scenario/scenario';
import { RothVsTraditionalInputSchema, rothVsTraditional, rothVsTraditionalHousehold } from './rothVsTraditional';

const YEAR = 2026;
const ctx = { currentYear: YEAR, rules: RULES };
const fixtureCtx = { currentYear: YEAR, rules: fixtureRules() };

const input = {
  age: 40,
  retirementAge: 65,
  planningAge: 90,
  salary: dollars(100_000),
  deferralPct: 0.1,
  returnBeforeRetirement: 0.05,
  returnInRetirement: 0.04,
  inflation: 0.02,
  currentSpending: dollars(50_000),
  retirementSpending: dollars(20_000),
};

describe('rothVsTraditional', () => {
  it('reports the engine’s after-tax ending balances (parity with compareScenarios, fixture rules)', () => {
    const r = rothVsTraditional(input, fixtureCtx);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const v = r.value;
    const base = HouseholdSchema.parse(rothVsTraditionalHousehold(RothVsTraditionalInputSchema.parse(input), YEAR));
    const g = presetScenario(
      'G_rothStrategy',
      base,
      { currentYear: YEAR },
      { scenarioId: 's', name: 'G', baseProfileId: base.id },
    );
    const [trad, roth] = compareScenarios(base, [g], fixtureCtx);
    expect(v.traditional.afterTaxEndingBalanceReal).toBe(trad?.afterTaxEndingBalanceReal);
    expect(v.roth.afterTaxEndingBalanceReal).toBe(roth?.afterTaxEndingBalanceReal);
    expect(v.traditional.endingBalance).toBe(trad?.dashboard?.baseline.summary.endingBalance);
    expect(v.afterTaxDifferenceReal).toBe(
      (roth?.afterTaxEndingBalanceReal ?? 0) - (trad?.afterTaxEndingBalanceReal ?? 0),
    );
    expect(v.basis).toEqual({ dollars: 'nominalAndTodaysDollars', tax: 'afterTaxes', limits: 'afterLimits' });
    expect(v.traditional.marginalRate).not.toBeNull();
    // The Roth twin holds no tax-deferred money, so its after-tax balance is its real ending balance.
    expect(v.roth.endingTaxDeferred).toBe(0);
    expect(v.roth.afterTaxEndingBalanceReal).toBe(v.roth.endingBalanceReal);
    expect(v.traditional.endingTaxDeferred).toBeGreaterThan(0);
  });

  it('gives identical before-tax twins and no after-tax figure while taxes are unverified', () => {
    const r = rothVsTraditional(input, ctx);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const v = r.value;
    expect(v.afterTaxDifferenceReal).toBeNull();
    expect(v.traditional.afterTaxEndingBalanceReal).toBeNull();
    expect(v.traditional.marginalRate).toBeNull();
    expect(v.basis.tax).toBe('beforeTaxes');
    expect(v.basis.limits).toBe('beforeLimits');
    expect(v.excludedFeatures).toEqual(expect.arrayContaining(['federalIncomeTax', 'workplaceLimits']));
    // Before taxes, the same deferral grows the same way in either bucket.
    expect(v.beforeTaxDifferenceReal).toBe(0);
  });

  it('rejects invalid input', () => {
    const r = rothVsTraditional({ ...input, retirementAge: 30, planningAge: 20 }, ctx);
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') return;
    expect(r.issues.map((i) => i.path.join('.'))).toContain('retirementAge');
    const h = rothVsTraditional(
      { ...input, age: 100, retirementAge: 110, planningAge: 120 },
      { currentYear: 1990, rules: RULES },
    );
    expect(h.status === 'invalid' && h.issues[0]?.path[0]).toBe('household');
  });
});
