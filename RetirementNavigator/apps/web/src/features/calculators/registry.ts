/** The 15 standalone calculators (brief §5.8; docs/financial-model.md §12): titles, summaries and grouping. */
import type { CalculatorId } from '@rn/engine';

export type CalculatorGroup = 'Growth and costs' | 'Workplace plans' | 'Retirement readiness' | 'In retirement';

export interface CalculatorMeta {
  id: CalculatorId;
  title: string;
  /** One or two sentences: what the calculator shows. */
  summary: string;
  group: CalculatorGroup;
  /**
   * Runs a search (bisection or an age scan) that takes tens to hundreds of milliseconds, so its
   * result is computed deferred, after the input settles.
   */
  heavy: boolean;
}

export const CALCULATOR_GROUPS: readonly CalculatorGroup[] = [
  'Growth and costs',
  'Workplace plans',
  'Retirement readiness',
  'In retirement',
];

export const CALCULATOR_META: readonly CalculatorMeta[] = [
  {
    id: 'compoundInterest',
    title: 'Compound interest',
    summary:
      'How a starting balance and yearly contributions grow over time at a fixed return, net of fees, with the year-by-year growth.',
    group: 'Growth and costs',
    heavy: false,
  },
  {
    id: 'feeImpact',
    title: 'Fee impact',
    summary:
      'The same savings grown with and without an expense ratio: the fees charged and the growth they would have earned.',
    group: 'Growth and costs',
    heavy: false,
  },
  {
    id: 'lumpSumVsRecurring',
    title: 'Lump sum vs recurring',
    summary: 'Investing an amount all at once compared with spreading it in equal amounts over several years.',
    group: 'Growth and costs',
    heavy: false,
  },
  {
    id: 'inflationPurchasingPower',
    title: 'Inflation and purchasing power',
    summary: 'What today’s amount will cost in the future, and what a fixed future amount is worth in today’s dollars.',
    group: 'Growth and costs',
    heavy: false,
  },
  {
    id: 'contribution401k',
    title: '401(k) contributions',
    summary:
      'Workplace-plan contributions and employer match each working year, and the balance at retirement, with this year’s limits.',
    group: 'Workplace plans',
    heavy: false,
  },
  {
    id: 'matchOptimizer',
    title: 'Employer match',
    summary: 'The deferral rate that captures the full employer match, and how much match is left at the current rate.',
    group: 'Workplace plans',
    heavy: false,
  },
  {
    id: 'rothVsTraditional',
    title: 'Roth vs traditional',
    summary:
      'The same share of salary deferred as traditional (pre-tax) or Roth (after tax), compared at the end of the plan.',
    group: 'Workplace plans',
    heavy: false,
  },
  {
    id: 'retirementAge',
    title: 'Retirement age',
    summary: 'Every retirement age in a range, and the earliest one whose savings last through the planning age.',
    group: 'Retirement readiness',
    heavy: true,
  },
  {
    id: 'savingsGap',
    title: 'Savings gap',
    summary: 'The extra yearly contribution, if any, that lets savings last through the planning age.',
    group: 'Retirement readiness',
    heavy: true,
  },
  {
    id: 'coastFire',
    title: 'Coast FIRE',
    summary:
      'Whether today’s savings, with no further contributions, would last through retirement, and the balance that would.',
    group: 'Retirement readiness',
    heavy: true,
  },
  {
    id: 'baristaFire',
    title: 'Barista FIRE',
    summary: 'The part-time income that, alongside savings, lets an early retirement last through the planning age.',
    group: 'Retirement readiness',
    heavy: true,
  },
  {
    id: 'fiNumber',
    title: 'FI number',
    summary:
      'The savings balance whose withdrawals cover a yearly spending amount through the plan, beside the rule-of-thumb figure.',
    group: 'Retirement readiness',
    heavy: true,
  },
  {
    id: 'withdrawal',
    title: 'Withdrawal',
    summary:
      'How long savings last at a fixed withdrawal rate, or the highest starting rate that lasts through the plan.',
    group: 'In retirement',
    heavy: true,
  },
  {
    id: 'spendingPlanner',
    title: 'Spending planner',
    summary:
      'A retirement spending plan with steps by age and Social Security, year by year, and how long savings last.',
    group: 'In retirement',
    heavy: false,
  },
  {
    id: 'ssClaimingComparison',
    title: 'Social Security claiming',
    summary: 'Lifetime Social Security benefits by claiming age, with break-even ages against the earliest claim.',
    group: 'In retirement',
    heavy: false,
  },
];

export function calculatorMeta(id: string | null | undefined): CalculatorMeta | undefined {
  return CALCULATOR_META.find((m) => m.id === id);
}

/** Deep link to a calculator; `prefill` (with a person id) opens it filled from that person’s plan. */
export function calculatorHref(id: CalculatorId, prefill?: { personId: string }): string {
  const params = new URLSearchParams({ c: id });
  if (prefill) {
    params.set('prefill', 'plan');
    params.set('person', prefill.personId);
  }
  return `/calculators?${params.toString()}`;
}
