/**
 * Tax model against the PINNED SYNTHETIC FIXTURE (not real IRS values): single brackets 10% to $10k,
 * 20% to $50k, 30% above (MFJ doubled); standard deduction $15k / $30k; additional 65+ $2,000 /
 * $1,500; senior deduction $5,000 per person phased out at 6% above $70k / $140k (last year 2028);
 * LTCG 0% to $40k, 15% to $500k (single); wage base $150k; FICA 6.2% + 1.45%;
 * SS thresholds $25k/$34k single, $32k/$44k MFJ.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Cents, Fraction, NominalRate } from '../domain/primitives';
import type { TaxInput } from '../api';
import { dollars } from '../money';
import { resolveRules } from '../rules/resolve';
import { RULES } from '../rules/index';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import { bracketTax, computeTax, marginalRate, taxableSocialSecurity } from './tax';

const R = resolveRules(fixtureRules(), {
  anchorYear: FIXTURE_YEAR,
  targetYear: FIXTURE_YEAR,
  indexRate: 0 as NominalRate,
});
const real = resolveRules(RULES, { anchorYear: 2026, targetYear: 2026, indexRate: 0.025 as NominalRate });

const input = (i: Partial<TaxInput> = {}): TaxInput => ({
  filingStatus: 'single',
  ages: [40],
  wages: dollars(0),
  wagesByPerson: [],
  otherOrdinaryIncome: dollars(0),
  socialSecurityBenefits: dollars(0),
  longTermCapitalGains: dollars(0),
  preTaxDeductions: dollars(0),
  stateTaxRate: 0 as Fraction,
  ...i,
});

const tax = (i: Partial<TaxInput>, rules = R) => {
  const r = computeTax(input(i), rules);
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
  return r.value;
};

describe('computeTax', () => {
  it('computes ordinary tax, FICA and state tax on wages (hand-computed)', () => {
    const t = tax({ wages: dollars(60_000), wagesByPerson: [dollars(60_000)], stateTaxRate: 0.05 as Fraction });
    // Taxable 60,000 − 15,000 = 45,000 → 10% × 10,000 + 20% × 35,000 = 8,000.
    expect(t).toMatchObject({
      deductions: dollars(15_000),
      taxableOrdinaryIncome: dollars(45_000),
      federalOrdinaryTax: dollars(8_000),
      ficaSocialSecurity: dollars(3_720),
      ficaMedicare: dollars(870),
      stateTax: dollars(3_000),
      totalTax: dollars(15_590),
      marginalOrdinaryRate: 0.2,
    });
  });

  it('excludes pre-tax deductions from income tax but not from FICA', () => {
    const t = tax({ wages: dollars(60_000), wagesByPerson: [dollars(60_000)], preTaxDeductions: dollars(10_000) });
    expect(t.federalOrdinaryTax).toBe(dollars(6_000));
    expect(t.ficaSocialSecurity).toBe(dollars(3_720));
  });

  it('applies the Social Security wage base per person', () => {
    const t = tax({
      filingStatus: 'marriedFilingJointly',
      ages: [40, 40],
      wages: dollars(300_000),
      wagesByPerson: [dollars(200_000), dollars(100_000)],
    });
    expect(t.ficaSocialSecurity).toBe(dollars(15_500));
    expect(t.ficaMedicare).toBe(dollars(4_350));
  });

  it('adds the 65+ deductions and phases out the senior deduction', () => {
    const t = tax({ ages: [66], otherOrdinaryIncome: dollars(80_000) });
    // 15,000 + 2,000 + (5,000 − 6% × 10,000) = 21,400 → taxable 58,600 → 1,000 + 8,000 + 2,580.
    expect(t.deductions).toBe(dollars(21_400));
    expect(t.federalOrdinaryTax).toBe(dollars(11_580));
  });

  it('drops the senior deduction after its sunset year (law as written)', () => {
    const after = resolveRules(fixtureRules(), {
      anchorYear: FIXTURE_YEAR,
      targetYear: 2029,
      indexRate: 0 as NominalRate,
    });
    const t = tax({ ages: [66], otherOrdinaryIncome: dollars(80_000) }, after);
    expect(t.deductions).toBe(dollars(17_000));
  });

  it('stacks long-term gains on top of ordinary income', () => {
    const t = tax({ otherOrdinaryIncome: dollars(30_000), longTermCapitalGains: dollars(50_000) });
    // Ordinary taxable 15,000 → 2,000. Gains 15k→65k: 25k at 0%, 25k at 15% = 3,750.
    expect(t.federalOrdinaryTax).toBe(dollars(2_000));
    expect(t.capitalGainsTax).toBe(dollars(3_750));
    // Gains above the 15% band are taxed at 20%.
    const high = tax({ otherOrdinaryIncome: dollars(0), longTermCapitalGains: dollars(600_000) });
    // Taxable 585,000: 0–40k at 0, 40k–500k at 15% = 69,000, 500k–585k at 20% = 17,000.
    expect(high.capitalGainsTax).toBe(dollars(86_000));
  });

  it('includes taxable Social Security in ordinary income', () => {
    const t = tax({ socialSecurityBenefits: dollars(20_000), otherOrdinaryIncome: dollars(40_000) });
    expect(t.taxableSocialSecurity).toBe(dollars(17_000));
    expect(t.agi).toBe(dollars(57_000));
  });

  it('never returns negative taxes (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 30, max: 90 }),
        (wages, other, ss, gains, preTax, age) => {
          const t = tax({
            ages: [age],
            wages: wages as Cents,
            wagesByPerson: [wages as Cents],
            otherOrdinaryIncome: other as Cents,
            socialSecurityBenefits: ss as Cents,
            longTermCapitalGains: gains as Cents,
            preTaxDeductions: Math.min(preTax, wages) as Cents,
            stateTaxRate: 0.04 as Fraction,
          });
          return Object.values(t).every((v) => typeof v !== 'number' || v >= 0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('returns unverified with the real (unverified) rules, listing only what the input needs', () => {
    const wageOnly = computeTax(input({ wages: dollars(60_000), wagesByPerson: [dollars(60_000)] }), real);
    expect(wageOnly.status).toBe('unverified');
    if (wageOnly.status !== 'unverified') return;
    const keys = wageOnly.missing.map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        '2026:tax.brackets.single',
        '2026:payroll.ssWageBase',
        'standing:payroll.oasdiEmployeeRate',
      ]),
    );
    expect(
      keys.some((k) => k.includes('ltcg') || k.includes('seniorDeduction') || k.includes('ssBenefitTaxation')),
    ).toBe(false);
  });
});

describe('taxableSocialSecurity (Pub 915 method)', () => {
  const tss = (benefits: number, other: number, filingStatus: 'single' | 'marriedFilingJointly' = 'single') => {
    const r = taxableSocialSecurity(
      { benefits: dollars(benefits), otherIncome: dollars(other), taxExemptInterest: dollars(0), filingStatus },
      R,
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    return r.value;
  };

  it.each([
    [20_000, 10_000, 0], // provisional 20,000 ≤ 25,000
    [20_000, 20_000, 2_500], // provisional 30,000 → 50% × 5,000
    [20_000, 40_000, 17_000], // provisional 50,000 → capped at 85% of benefits
    // provisional 40,000 → 0.85 × (40,000 − 34,000) + min(0.5 × 9,000, 0.5 × 20,000) = 5,100 + 4,500.
    [20_000, 30_000, 9_600],
  ])('benefits $%d with other income $%d → $%d taxable', (b, o, expected) => {
    expect(tss(b, o)).toBe(dollars(expected));
  });

  it('uses the married-filing-jointly thresholds and returns 0 with no benefits', () => {
    expect(tss(20_000, 30_000, 'marriedFilingJointly')).toBe(dollars(4_000)); // PI 40,000 → 50% × 8,000
    expect(tss(0, 100_000)).toBe(0);
  });

  it('returns unverified with null thresholds', () => {
    const r = taxableSocialSecurity(
      {
        benefits: dollars(20_000),
        otherIncome: dollars(20_000),
        taxExemptInterest: dollars(0),
        filingStatus: 'single',
      },
      real,
    );
    expect(r.status).toBe('unverified');
  });
});

describe('bracket helpers', () => {
  const b = [
    { rate: 0.1, lowerBound: dollars(0) },
    { rate: 0.2, lowerBound: dollars(10_000) },
  ];
  it('computes tax and marginal rate at boundaries', () => {
    expect(bracketTax(b, 0)).toBe(0);
    expect(bracketTax(b, 10_000)).toBe(1_000);
    expect(bracketTax(b, 10_001)).toBeCloseTo(1_000.2, 10);
    expect(marginalRate(b, 9_999)).toBe(0.1);
    expect(marginalRate(b, 10_000)).toBe(0.2);
  });
});
