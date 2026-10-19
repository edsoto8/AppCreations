/** Public gross-up API (frozen signature) against the PINNED SYNTHETIC FIXTURE (§7.2). */
import { describe, expect, it } from 'vitest';
import { HouseholdSchema } from '../domain/household';
import { minimalHouseholdInput } from '../samples/minimal';
import { dollars } from '../money';
import { resolveRules } from '../rules/resolve';
import { RULES } from '../rules/index';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import type { Cents, NominalRate } from '../domain/primitives';
import type { GrossUpState } from '../api';
import { solveGrossUp } from './grossUp';

const resolve = (set: ReturnType<typeof fixtureRules>) =>
  resolveRules(set, { anchorYear: FIXTURE_YEAR, targetYear: FIXTURE_YEAR, indexRate: 0 as NominalRate });

function state(): GrossUpState {
  const base = minimalHouseholdInput(FIXTURE_YEAR);
  const household = HouseholdSchema.parse({
    ...base,
    accounts: [{ type: 'traditionalIra', id: 'ira', name: 'IRA', ownerId: 'person-1', balance: dollars(500_000) }],
  });
  return {
    year: FIXTURE_YEAR,
    household,
    balances: { ira: { balance: dollars(500_000), basis: 0 as Cents } },
    fixedIncome: {
      wages: 0 as Cents,
      wagesByPerson: [0 as Cents],
      otherOrdinaryIncome: 0 as Cents,
      socialSecurityBenefits: 0 as Cents,
      longTermCapitalGains: 0 as Cents,
      preTaxDeductions: 0 as Cents,
    },
    filingStatus: 'single',
    ages: [70],
    rmdTaken: {},
  };
}

describe('solveGrossUp', () => {
  it('finds gross withdrawals whose after-tax amount equals the net need', () => {
    // Same hand-checked case as the projection test: W = 43,250, tax 3,250.
    const r = solveGrossUp(dollars(40_000), state(), resolve(fixtureRules()), { maxIterations: 50, toleranceCents: 1 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.value.withdrawals['ira']).toBe(dollars(43_250));
    expect(r.value.taxes.totalTax).toBe(dollars(3_250));
    expect(r.value.netIncome).toBe(dollars(40_000));
    expect(r.value.converged).toBe(true);
    expect(r.value.unfunded).toBe(0);
  });

  it('reports non-convergence and returns unverified with the bundled rules', () => {
    const r = solveGrossUp(dollars(40_000), state(), resolve(fixtureRules()), { maxIterations: 1, toleranceCents: 1 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.value.converged).toBe(false);
    expect(r.warnings.map((w) => w.code)).toEqual(['grossUpNotConverged']);
    const bundled = solveGrossUp(dollars(40_000), state(), resolve(RULES), { maxIterations: 50, toleranceCents: 100 });
    expect(bundled.status).toBe('unverified');
  });

  it('reports the unfunded need when the balance runs out', () => {
    const s = state();
    s.balances = { ira: { balance: dollars(10_000), basis: 0 as Cents } };
    const r = solveGrossUp(dollars(40_000), s, resolve(fixtureRules()), { maxIterations: 50, toleranceCents: 100 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.value.withdrawals['ira']).toBe(dollars(10_000));
    expect(r.value.unfunded).toBe(dollars(30_000));
  });
});
