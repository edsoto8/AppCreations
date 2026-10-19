import { describe, expect, it } from 'vitest';
import { RULES, type RulesSet } from '@rn/engine';
import { collectRuleSections, formatIsoDate, formatRate, formatRuleValue, ruleLabel } from './rulesCatalog';

describe('collectRuleSections', () => {
  it('lists standing rules first, then each tax year, with labels for every bundled rule', () => {
    const sections = collectRuleSections(RULES);
    expect(sections.map((s) => s.title)).toEqual(['Standing rules', 'Tax year 2026', 'Tax year 2027']);
    for (const entry of sections.flatMap((s) => s.entries)) {
      expect(entry.key).toBe(`${entry.section}:${entry.path}`);
      // Every bundled rule has a human-readable label (not the dotted-path fallback).
      expect(entry.label).not.toBe(entry.path);
    }
  });

  it('picks up new rules generically and falls back to the dotted path for a label', () => {
    const rules = structuredClone(RULES) as unknown as { standing: Record<string, unknown> };
    rules.standing.brandNew = { thing: { status: 'notPublished', value: null, source: null, unverifiedReason: 'x' } };
    const standing = collectRuleSections(rules as unknown as RulesSet)[0];
    expect(standing?.entries.at(-1)).toMatchObject({ path: 'brandNew.thing', label: 'brandNew.thing' });
  });
});

describe('labels', () => {
  it('composes filing-status variants from the parent label', () => {
    expect(ruleLabel('ira.rothPhaseOut.marriedFilingJointly')).toBe(
      'Roth IRA income phase-out range (MAGI) (married filing jointly)',
    );
    expect(ruleLabel('workplace.electiveDeferral')).toBe('401(k)/403(b)/457(b) employee deferral limit');
  });
});

describe('formatRuleValue', () => {
  it('formats money (cents), rates, booleans and ranges', () => {
    expect(formatRuleValue(2_450_000, 'workplace.electiveDeferral')).toBe('$24,500');
    expect(formatRuleValue(6_662_180, 'socialSecurity.awiSeries.x')).toBe('$66,621.80');
    expect(formatRuleValue(0.062, 'payroll.oasdiEmployeeRate')).toBe('6.2%');
    expect(formatRuleValue(0.028, 'socialSecurity.colaEffectiveJanuary')).toBe('2.8%');
    expect(formatRuleValue(false, 'rmd.roth401kLifetimeRmdRequired')).toBe('No');
    expect(formatRuleValue(null, 'ira.limit')).toBe('—');
    expect(formatRuleValue({ start: 15_300_000, end: 16_800_000 }, 'ira.rothPhaseOut.single')).toBe(
      '$153,000 to $168,000',
    );
  });

  it('formats breakpoint objects without treating "RateMax" keys as rates', () => {
    expect(formatRuleValue({ zeroRateMax: 4_945_000, fifteenRateMax: 54_550_000 }, 'tax.ltcg.single')).toBe(
      '0% rate up to: $49,450; 15% rate up to: $545,500',
    );
    expect(formatRuleValue({ tier1: 0.5, tier2: 0.85 }, 'ssBenefitTaxation.maxInclusion')).toBe(
      'Tier 1: 50%; Tier 2: 85%',
    );
    expect(formatRuleValue({ roundUpToDollars: 10, minimumDollars: 200 }, 'roth.reducedContributionRounding')).toBe(
      'Round up to a multiple of: $10; Minimum: $200',
    );
  });

  it('formats bracket arrays', () => {
    expect(
      formatRuleValue(
        [
          { rate: 0.1, lowerBound: 0 },
          { rate: 0.12, lowerBound: 1_240_000 },
        ],
        'tax.brackets.single',
      ),
    ).toBe('10% from $0; 12% from $12,400');
  });

  it('formats tables and counts', () => {
    expect(
      formatRuleValue(
        [
          { fromBirthYear: 1955, toBirthYear: 1955, years: 66, months: 2 },
          { fromBirthYear: 1960, toBirthYear: null, years: 67, months: 0 },
        ],
        'socialSecurity.fraByBirthYear',
      ),
    ).toBe('1955: age 66 and 2 months; 1960 or later: age 67');
    expect(formatRuleValue([{ fromBirthYear: 1951, toBirthYear: 1958, age: 73 }], 'rmd.startAgeByBirthYear')).toBe(
      '1951–1958: age 73',
    );
    expect(formatRuleValue([{ age: 72, period: 27.4 }], 'rmd.uniformLifetimeTable')).toBe('age 72: 27.4');
    expect(formatRuleValue([{ year: 2024, awi: 6_984_657 }], 'socialSecurity.awiSeries')).toBe('2024: $69,846.57');
    expect(formatRuleValue(714, 'roth.qualifiedAgeMonths')).toBe('Age 59 and 6 months');
    expect(formatRuleValue(5, 'roth.fiveYearRuleYears')).toBe('5 years');
    expect(formatRuleValue(70, 'socialSecurity.delayedCreditMaxAge')).toBe('Age 70');
    expect(formatRuleValue([0.9, 0.32, 0.15], 'socialSecurity.piaFactors')).toBe('90% / 32% / 15%');
  });

  it('keeps per-month rates precise', () => {
    expect(formatRate(5 / 900)).toBe('0.5556%');
    expect(formatRate(0.0145)).toBe('1.45%');
  });
});

describe('formatIsoDate', () => {
  it('formats ISO dates in UTC and passes through anything else', () => {
    expect(formatIsoDate('2026-10-18')).toBe('Oct 18, 2026');
    expect(formatIsoDate('soon')).toBe('soon');
  });
});
