import { describe, expect, it } from 'vitest';
import { SAMPLE_PROFILES, type Insight, type ScenarioOp } from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import { describeInsightOp, formatDelta, metricView } from './insightModel';

const h = SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(TEST_YEAR);
const set = (collection: string, id: string, path: string[], value: unknown) =>
  ({ op: 'set', collection, id, path, value }) as ScenarioOp;

describe('insight view model', () => {
  it('describes the ops insights use in plain words', () => {
    const account = h.accounts[0]!;
    expect(describeInsightOp(set('accounts', account.id, ['expenseRatio'], 0), h)).toBe(
      `${account.name}: expense ratio → 0%`,
    );
    expect(
      describeInsightOp(set('household', h.id, ['assumptions', 'capitalMarket', 'stocks', 'geometricReturn'], 0.06), h),
    ).toBe('Household: stock return (capital-market assumption) → 6%');
    expect(describeInsightOp(set('household', h.id, ['spending', 'steps'], []), h)).toBe(
      'Household: spending steps → none',
    );
    expect(
      describeInsightOp(set('household', h.id, ['spending', 'steps'], [{ fromAge: 80, annualSpending: 5_000_000 }]), h),
    ).toBe('Household: spending steps → from age 80, $50,000 a year');
    const add = {
      op: 'add',
      collection: 'accounts',
      parentId: null,
      entity: { name: 'Extra', contribution: { amount: { kind: 'dollars', amount: 900_000, frequency: 'annual' } } },
    } as ScenarioOp;
    expect(describeInsightOp(add, h)).toBe('Adds an account “Extra”, contributing $9,000 a year');
    // Everything else goes through the scenario describer.
    expect(describeInsightOp(set('people', h.people[0]!.id, ['retirementAge'], 67), h)).toBe(
      `${h.people[0]!.name}: retirement age → 67`,
    );
  });

  it('formats the metric and a signed change', () => {
    expect([formatDelta(120_000), formatDelta(-340_000), formatDelta(0)]).toEqual(['+$1,200', '−$3,400', '$0']);
    const insight = {
      kind: 'savingsIncreaseForGoal',
      metric: { label: 'Extra savings a year', basis: 'todays', baseline: 0, whatIf: null, delta: null },
    } as unknown as Insight;
    expect(metricView(insight)).toEqual({
      label: 'Extra savings a year',
      baseline: '$0',
      whatIf: 'Not within $500,000 a year',
      delta: '—',
      basis: 'Today’s dollars',
    });
  });
});
