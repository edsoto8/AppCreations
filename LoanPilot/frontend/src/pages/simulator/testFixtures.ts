/**
 * Fixtures for simulator and comparison tests, built on the shared dashboard fixtures
 * ($12,178.73 balance, $483.32/month, baseline payoff 2029-01-01, $870.94 remaining interest).
 */
import type { ComparisonResult, ComparisonRow, Scenario, SimulationResult, TargetPayoffResult } from '@/api/types';
import { makeProjection, makeRows, makeSummary } from '@/test/fixtures';

/** "+$100/month" captured from the engine for the base fixture loan. */
export function makeSimulation(overrides: Partial<SimulationResult['comparison']> = {}): SimulationResult {
  const scenarioRows = makeRows().slice(0, 23);
  return {
    baseline: makeProjection(),
    scenario: makeProjection({
      rows: scenarioRows.map((r, i) => ({ ...r, extraPayment: 100, recurringExtra: 100, totalPayment: r.totalPayment + 100, endingBalance: i === 22 ? 0 : r.endingBalance })),
      summary: makeSummary({ payoffDate: '2028-09-01', paymentCount: 23, monthsToPayoff: 23, totalInterest: 715.98, totalPaid: 12894.71, totalExtra: 2200, finalPayment: 312.4 }),
    }),
    comparison: {
      baselinePayoffDate: '2029-01-01',
      newPayoffDate: '2028-09-01',
      monthsSaved: 4,
      paymentsSaved: 4,
      baselineInterest: 870.94,
      newInterest: 715.98,
      interestSaved: 154.96,
      percentInterestReduction: 17.79,
      totalExtraPaid: 2200,
      ...overrides,
    },
  };
}

export function makeTargetResult(overrides: Partial<TargetPayoffResult> = {}): TargetPayoffResult {
  return {
    targetDate: '2028-01-01',
    achievable: true,
    message: 'Pay $758.27 per month ($274.95 more than your scheduled payment) to be paid off by January 1, 2028.',
    requiredPayment: 758.27,
    additionalAmount: 274.95,
    scheduledPayment: 483.32,
    simulation: makeSimulation({ newPayoffDate: '2028-01-01', monthsSaved: 12, interestSaved: 401.12 }),
    ...overrides,
  };
}

export function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 7,
    loanId: 1,
    name: 'Bonus plan',
    description: 'Extra $60 plus the yearly bonus',
    budgetPayment: null,
    recurringExtras: [{ amount: 60, startDate: null, endDate: '2027-12-01' }],
    lumpSums: [{ amount: 1500, date: '2027-03-15', note: 'Bonus' }],
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    ...overrides,
  };
}

function row(overrides: Partial<ComparisonRow> & Pick<ComparisonRow, 'key' | 'name' | 'kind'>): ComparisonRow {
  return {
    scenarioId: null,
    paysOff: true,
    payoffDate: '2029-01-01',
    monthsToPayoff: 27,
    paymentCount: 27,
    totalInterest: 870.94,
    interestSaved: 0,
    monthsSaved: 0,
    percentInterestReduction: 0,
    recurringPayment: 483.32,
    lumpSumTotal: 0,
    totalPaid: 13049.67,
    balanceSeries: [
      { date: '2026-10-01', balance: 12178.73 },
      { date: '2027-10-01', balance: 6967.87 },
      { date: '2029-01-01', balance: 0 },
    ],
    ...overrides,
  };
}

export function makeComparison(overrides: Partial<ComparisonResult> = {}, saved: ComparisonRow[] = [savedRow()]): ComparisonResult {
  return {
    budget: null,
    rows: [
      row({ key: 'baseline', name: 'Standard payments', kind: 'baseline' }),
      row({
        key: 'preset:extra-50',
        name: 'Extra $50/month',
        kind: 'preset',
        payoffDate: '2028-11-01',
        monthsToPayoff: 25,
        paymentCount: 25,
        totalInterest: 785.77,
        interestSaved: 85.17,
        monthsSaved: 2,
        percentInterestReduction: 9.78,
        recurringPayment: 533.32,
        totalPaid: 12964.5,
      }),
      row({
        key: 'preset:lump-2000',
        name: '$2,000 lump sum today',
        kind: 'preset',
        payoffDate: '2028-09-01',
        monthsToPayoff: 23,
        paymentCount: 23,
        totalInterest: 640.1,
        interestSaved: 230.84,
        monthsSaved: 4,
        percentInterestReduction: 26.5,
        lumpSumTotal: 2000,
        totalPaid: 12818.83,
      }),
      ...saved,
    ],
    best: { fastestPayoff: 'scenario:12', lowestInterest: 'scenario:12', lowestRecurringPayment: 'preset:lump-2000', bestWithinBudget: null },
    notes: ['"Lowest recurring payment" is the strategy that saves interest with the smallest regular payment.'],
    ...overrides,
  };
}

export function savedRow(overrides: Partial<ComparisonRow> = {}): ComparisonRow {
  return row({
    key: 'scenario:12',
    name: 'Aggressive $300',
    kind: 'saved',
    scenarioId: 12,
    payoffDate: '2028-03-01',
    monthsToPayoff: 17,
    paymentCount: 17,
    totalInterest: 560.2,
    interestSaved: 310.74,
    monthsSaved: 10,
    percentInterestReduction: 35.68,
    recurringPayment: 783.32,
    totalPaid: 12738.93,
    ...overrides,
  });
}
