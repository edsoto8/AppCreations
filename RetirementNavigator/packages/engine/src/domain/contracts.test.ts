import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BracketsSchema, PhaseOutRangeSchema, RuleSourceSchema, verified } from './rules';
import { ScenarioOpSchema, ScenarioSchema } from './scenario';
import { MonteCarloConfigSchema } from './montecarlo';
import { EntityIdSchema, IsoDateSchema } from './primitives';

const source = {
  publication: 'IRS Notice 2025-67',
  url: 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf',
  retrievedOn: '2026-10-18',
  method: 'primary-document',
};

describe('Verified<T>', () => {
  const Money = verified(z.number().int());

  it('accepts a verified value with a source and fills defaults', () => {
    const r = Money.parse({ status: 'verified', value: 2_450_000, source, indexation: 'indexed' });
    expect(r).toMatchObject({
      status: 'verified',
      value: 2_450_000,
      secondSource: null,
      rounding: null,
      sunsetYear: null,
    });
  });

  it('requires unverifiedReason and a null value when unverified', () => {
    expect(
      Money.safeParse({ status: 'unverified', value: null, source: null, unverifiedReason: 'blocked' }).success,
    ).toBe(true);
    expect(Money.safeParse({ status: 'unverified', value: null, source: null }).success).toBe(false);
    expect(Money.safeParse({ status: 'unverified', value: 5, source: null, unverifiedReason: 'x' }).success).toBe(
      false,
    );
  });

  it('keeps a candidate for display only', () => {
    const r = Money.parse({
      status: 'unverified',
      value: null,
      source: null,
      unverifiedReason: 'Only a search excerpt was seen',
      candidate: { value: 2_450_000, source: { ...source, method: 'search-excerpt' } },
    });
    expect(r.value).toBeNull();
  });

  it('accepts notPublished', () => {
    expect(
      Money.safeParse({ status: 'notPublished', value: null, source: null, unverifiedReason: 'Not yet published' })
        .success,
    ).toBe(true);
  });

  it('restricts sources to irs.gov, ssa.gov and federalregister.gov', () => {
    expect(RuleSourceSchema.safeParse(source).success).toBe(true);
    expect(
      RuleSourceSchema.safeParse({ ...source, url: 'https://www.ssa.gov/oact/cola/bendpoints.html' }).success,
    ).toBe(true);
    expect(RuleSourceSchema.safeParse({ ...source, url: 'https://www.federalregister.gov/d/2024-14542' }).success).toBe(
      true,
    );
    expect(RuleSourceSchema.safeParse({ ...source, url: 'https://example.com/irs.gov/x' }).success).toBe(false);
    expect(RuleSourceSchema.safeParse({ ...source, url: 'https://irs.gov.evil.com/x' }).success).toBe(false);
  });
});

describe('rule value shapes', () => {
  it('requires brackets to start at 0 and ascend', () => {
    expect(
      BracketsSchema.safeParse([
        { rate: 0.1, lowerBound: 0 },
        { rate: 0.12, lowerBound: 100 },
      ]).success,
    ).toBe(true);
    expect(BracketsSchema.safeParse([{ rate: 0.1, lowerBound: 5 }]).success).toBe(false);
    expect(
      BracketsSchema.safeParse([
        { rate: 0.1, lowerBound: 0 },
        { rate: 0.12, lowerBound: 0 },
      ]).success,
    ).toBe(false);
  });

  it('requires a phase-out end above its start', () => {
    expect(PhaseOutRangeSchema.safeParse({ start: 100, end: 200 }).success).toBe(true);
    expect(PhaseOutRangeSchema.safeParse({ start: 200, end: 200 }).success).toBe(false);
  });
});

describe('Scenario', () => {
  it('parses set/unset/add ops with defaults', () => {
    const s = ScenarioSchema.parse({
      id: 'scenario-1',
      name: 'Early retirement',
      baseProfileId: 'household-1',
      ops: [
        { op: 'set', collection: 'people', id: 'person-1', path: ['retirementAge'], value: 60 },
        { op: 'unset', collection: 'accounts', id: 'account-1' },
        { op: 'add', collection: 'pensions', entity: { id: 'p' } },
      ],
    });
    expect(s.preset).toBeNull();
    expect(s.ops[1]).toMatchObject({ op: 'unset', path: null });
    expect(s.ops[2]).toMatchObject({ op: 'add', parentId: null });
  });

  it('rejects adding people or the household, and empty set paths', () => {
    expect(ScenarioOpSchema.safeParse({ op: 'add', collection: 'people', entity: {} }).success).toBe(false);
    expect(ScenarioOpSchema.safeParse({ op: 'set', collection: 'people', id: 'a', path: [], value: 1 }).success).toBe(
      false,
    );
  });
});

describe('MonteCarloConfig', () => {
  it('bounds paths to 1,000–10,000 and validates the inflation correlation length', () => {
    expect(MonteCarloConfigSchema.safeParse({ paths: 1000, seed: 1, inflation: { mode: 'fixed' } }).success).toBe(true);
    expect(MonteCarloConfigSchema.safeParse({ paths: 999, seed: 1, inflation: { mode: 'fixed' } }).success).toBe(false);
    expect(MonteCarloConfigSchema.safeParse({ paths: 10_001, seed: 1, inflation: { mode: 'fixed' } }).success).toBe(
      false,
    );
    const stochastic = { mode: 'stochastic', median: 0.025, volatility: 0.015, correlationWithAssets: [0, 0, 0] };
    expect(MonteCarloConfigSchema.safeParse({ paths: 5000, seed: 7, inflation: stochastic }).success).toBe(true);
    expect(
      MonteCarloConfigSchema.safeParse({
        paths: 5000,
        seed: 7,
        inflation: { ...stochastic, correlationWithAssets: [0] },
      }).success,
    ).toBe(false);
  });
});

describe('primitives', () => {
  it('validates ids and ISO dates', () => {
    expect(EntityIdSchema.safeParse('person-1').success).toBe(true);
    expect(EntityIdSchema.safeParse('has space').success).toBe(false);
    expect(IsoDateSchema.safeParse('2026-10-18').success).toBe(true);
    expect(IsoDateSchema.safeParse('10/18/2026').success).toBe(false);
  });
});

describe('ProjectionResult and Insight contracts', () => {
  it('parse well-formed values', async () => {
    const { ProjectionResultSchema } = await import('./projection');
    const { InsightSchema } = await import('./insight');
    const zero = 0;
    const row = {
      year: 2026,
      index: 1,
      phase: 'accumulation',
      deflator: 1.025,
      people: [],
      accounts: [],
      flows: Object.fromEntries(
        [
          'contributions',
          'employerContributions',
          'growthGross',
          'feeDrag',
          'growthNet',
          'withdrawals',
          'socialSecurity',
          'pensions',
          'otherIncome',
          'oneTimeInflows',
          'oneTimeOutflows',
          'spendingNeed',
          'spendingFunded',
          'shortfall',
        ].map((k) => [k, zero]),
      ),
      cashFlow: { netPay: zero, employeeContributions: zero, surplus: zero, infeasible: false },
      tax: null,
      totals: {
        portfolioStart: zero,
        portfolioEnd: zero,
        byTaxTreatment: { taxDeferred: zero, taxFree: zero, taxable: zero },
      },
      real: { portfolioEnd: zero, spendingNeed: zero, grossIncome: zero, netIncome: zero },
      grossIncome: zero,
      netIncome: zero,
      depleted: false,
      markers: ['retirement'],
    };
    const result = {
      contractVersion: '1.0.0',
      granularity: 'annual',
      rows: [row],
      summary: {
        firstYear: 2026,
        lastYear: 2026,
        retirementYear: 2026,
        firstDeathYear: null,
        depletionYear: null,
        depletionAge: null,
        endingBalance: zero,
        endingBalanceReal: zero,
        infeasibleYears: [],
        deterministicSuccess: true,
      },
      excludedFeatures: ['federalIncomeTax'],
      unverified: [{ key: '2026:tax.brackets.single', reason: 'blocked', features: ['federalIncomeTax'] }],
      warnings: [],
    };
    expect(ProjectionResultSchema.safeParse(result).success).toBe(true);
    expect(ProjectionResultSchema.safeParse({ ...result, rows: [{ ...row, phase: 'other' }] }).success).toBe(false);

    const insight = {
      kind: 'retireTwoYearsLater',
      title: 'Retiring two years later',
      body: 'In this model, retiring two years later raises the ending balance.',
      metric: { label: 'Ending balance', basis: 'todays', baseline: 100, whatIf: 150, delta: 50 },
      whatIfOps: [{ op: 'set', collection: 'people', id: 'person-1', path: ['retirementAge'], value: 67 }],
      assumptions: ['Same returns and spending as the baseline.'],
      tone: 'neutral',
    };
    expect(InsightSchema.safeParse(insight).success).toBe(true);
    expect(InsightSchema.safeParse({ ...insight, assumptions: [] }).success).toBe(false);
  });
});
