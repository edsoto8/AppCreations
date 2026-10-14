/** Schedule fixtures built on the shared $25,000 / 6% / 60-month loan (src/test/fixtures.ts). */
import type { AnnualSummaryRow, Scenario, ScheduleResponse, ScheduleRow } from '@/api/types';
import { makeProjection, makeRows, makeSummary } from '@/test/fixtures';

/** Payments #31–#33: the estimated past rows of a loan without a known balance. */
export function historyRows(): ScheduleRow[] {
  return makeRows([
    [31, '2026-08-01', 13434.4, 483.32, 67.17, 416.15, 13018.25, 2998.45],
    [32, '2026-09-01', 13018.25, 483.32, 65.09, 418.23, 12600.02, 3063.54],
    [33, '2026-10-01', 12600.02, 483.32, 63.0, 420.32, 12179.7, 3126.54],
  ]).map((r) => ({ ...r, isEstimated: true }));
}

export const baselineAnnual: AnnualSummaryRow[] = [
  { year: 2026, payments: 5, totalPaid: 2416.6, principal: 2091.07, interest: 325.53, extra: 0, endingBalance: 11331.76 },
  { year: 2027, payments: 12, totalPaid: 5799.84, principal: 5263.09, interest: 536.75, extra: 0, endingBalance: 6068.67 },
  { year: 2028, payments: 12, totalPaid: 5799.84, principal: 5587.72, interest: 212.12, extra: 0, endingBalance: 480.95 },
  { year: 2029, payments: 1, totalPaid: 483.35, principal: 480.95, interest: 2.4, extra: 0, endingBalance: 0 },
];

/** A scenario projection: $100 extra on #34–#36 plus a $1,000 lump sum on Dec 15, 2026. */
export function scenarioRows(): ScheduleRow[] {
  const base = makeRows().slice(0, 20);
  return base.map((r, i) => {
    if (i < 3)
      return {
        ...r,
        extraPayment: 100,
        recurringExtra: 100,
        totalPayment: r.scheduledPayment + 100,
        principal: r.principal + 100,
        endingBalance: r.endingBalance - 100 * (i + 1),
      };
    return { ...r, endingBalance: Math.max(0, r.endingBalance - 1300), interest: Math.max(0, r.interest - 6) };
  });
}

export const lumpSumRow: ScheduleRow = {
  number: null,
  date: '2026-12-15',
  kind: 'lumpSum',
  startingBalance: 11031.76,
  scheduledPayment: 0,
  extraPayment: 1000,
  recurringExtra: 0,
  totalPayment: 1000,
  interest: 0,
  principal: 1000,
  endingBalance: 10031.76,
  cumulativeInterest: 3247.96,
  unpaidInterest: 0,
  isEstimated: false,
};

export function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 5,
    loanId: 1,
    name: 'Extra $100 + bonus',
    description: null,
    budgetPayment: null,
    recurringExtras: [{ amount: 100, startDate: null, endDate: '2027-01-31' }],
    lumpSums: [{ amount: 1000, date: '2026-12-15', note: 'Bonus' }],
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    ...overrides,
  };
}

export function makeSchedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    history: historyRows(),
    baseline: makeProjection(),
    scenario: null,
    baselineAnnual,
    scenarioAnnual: null,
    cumulativeInterestFrom: 'origination',
    ...overrides,
  };
}

export function makeScenarioSchedule(): ScheduleResponse {
  const rows = scenarioRows();
  rows.splice(2, 0, lumpSumRow);
  return makeSchedule({
    scenario: makeProjection({
      rows,
      summary: makeSummary({
        payoffDate: '2028-06-01',
        paymentCount: 20,
        monthsToPayoff: 20,
        totalInterest: 760.12,
        totalPaid: 12938.85,
        totalExtra: 1300,
      }),
    }),
    scenarioAnnual: [
      { year: 2026, payments: 5, totalPaid: 3716.6, principal: 3397.07, interest: 319.53, extra: 1300, endingBalance: 10031.76 },
      { year: 2027, payments: 12, totalPaid: 5799.84, principal: 5363.09, interest: 436.75, extra: 0, endingBalance: 4668.67 },
      { year: 2028, payments: 6, totalPaid: 2900.0, principal: 2896.16, interest: 3.84, extra: 0, endingBalance: 0 },
    ],
  });
}
