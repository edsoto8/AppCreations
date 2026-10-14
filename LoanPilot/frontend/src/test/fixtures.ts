/**
 * Realistic fixtures that conform to src/api/types.ts. The base dashboard was captured from the real
 * LoanPilot API (a $25,000 / 6% / 60-month loan started 2024-01-01, viewed on 2026-10-14), so the
 * numbers are internally consistent. Reuse these in page tests; override fields with the make* helpers.
 */
import type {
  CalcWarning,
  Dashboard,
  Insight,
  Loan,
  LoanListItem,
  LoanPreview,
  LoanStatus,
  Preferences,
  Projection,
  ProjectionSummary,
  ScheduleRow,
} from '@/api/types';

export const FIXTURE_TODAY = '2026-10-14';

export function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 1,
    name: '2024 Toyota RAV4',
    vehicleMake: 'Toyota',
    vehicleModel: 'RAV4',
    vehicleYear: 2024,
    lender: 'Ally Financial',
    originalAmount: 25000,
    downPayment: 4000,
    aprPercent: 6,
    termMonths: 60,
    startDate: '2024-01-01',
    firstPaymentDate: '2024-02-01',
    scheduledPayment: null,
    paymentFrequency: 'monthly',
    accrualMethod: 'monthly',
    dayCountBasis: 'actual365',
    currentBalance: null,
    balanceAsOf: null,
    paymentsMade: null,
    interestPaidToDate: null,
    vehicleValue: null,
    notes: null,
    isArchived: false,
    createdAt: '2026-10-14T22:14:44.998Z',
    updatedAt: '2026-10-14T22:14:44.998Z',
    ...overrides,
  };
}

/** [number, date, startingBalance, scheduledPayment, interest, principal, endingBalance, cumulativeInterest] */
type RowTuple = [number, string, number, number, number, number, number, number];

const BASELINE_ROWS: RowTuple[] = [
  [34, '2026-11-01', 12178.73, 483.32, 60.89, 422.43, 11756.3, 3189.18],
  [35, '2026-12-01', 11756.3, 483.32, 58.78, 424.54, 11331.76, 3247.96],
  [36, '2027-01-01', 11331.76, 483.32, 56.66, 426.66, 10905.1, 3304.62],
  [37, '2027-02-01', 10905.1, 483.32, 54.53, 428.79, 10476.31, 3359.15],
  [38, '2027-03-01', 10476.31, 483.32, 52.38, 430.94, 10045.37, 3411.53],
  [39, '2027-04-01', 10045.37, 483.32, 50.23, 433.09, 9612.28, 3461.76],
  [40, '2027-05-01', 9612.28, 483.32, 48.06, 435.26, 9177.02, 3509.82],
  [41, '2027-06-01', 9177.02, 483.32, 45.89, 437.43, 8739.59, 3555.71],
  [42, '2027-07-01', 8739.59, 483.32, 43.7, 439.62, 8299.97, 3599.41],
  [43, '2027-08-01', 8299.97, 483.32, 41.5, 441.82, 7858.15, 3640.91],
  [44, '2027-09-01', 7858.15, 483.32, 39.29, 444.03, 7414.12, 3680.2],
  [45, '2027-10-01', 7414.12, 483.32, 37.07, 446.25, 6967.87, 3717.27],
  [46, '2027-11-01', 6967.87, 483.32, 34.84, 448.48, 6519.39, 3752.11],
  [47, '2027-12-01', 6519.39, 483.32, 32.6, 450.72, 6068.67, 3784.71],
  [48, '2028-01-01', 6068.67, 483.32, 30.34, 452.98, 5615.69, 3815.05],
  [49, '2028-02-01', 5615.69, 483.32, 28.08, 455.24, 5160.45, 3843.13],
  [50, '2028-03-01', 5160.45, 483.32, 25.8, 457.52, 4702.93, 3868.93],
  [51, '2028-04-01', 4702.93, 483.32, 23.51, 459.81, 4243.12, 3892.44],
  [52, '2028-05-01', 4243.12, 483.32, 21.22, 462.1, 3781.02, 3913.66],
  [53, '2028-06-01', 3781.02, 483.32, 18.91, 464.41, 3316.61, 3932.57],
  [54, '2028-07-01', 3316.61, 483.32, 16.58, 466.74, 2849.87, 3949.15],
  [55, '2028-08-01', 2849.87, 483.32, 14.25, 469.07, 2380.8, 3963.4],
  [56, '2028-09-01', 2380.8, 483.32, 11.9, 471.42, 1909.38, 3975.3],
  [57, '2028-10-01', 1909.38, 483.32, 9.55, 473.77, 1435.61, 3984.85],
  [58, '2028-11-01', 1435.61, 483.32, 7.18, 476.14, 959.47, 3992.03],
  [59, '2028-12-01', 959.47, 483.32, 4.8, 478.52, 480.95, 3996.83],
  [60, '2029-01-01', 480.95, 483.35, 2.4, 480.95, 0, 3999.23],
];

export function makeRows(tuples: RowTuple[] = BASELINE_ROWS): ScheduleRow[] {
  return tuples.map(([number, date, startingBalance, scheduledPayment, interest, principal, endingBalance, cumulativeInterest]) => ({
    number,
    date,
    kind: 'payment',
    startingBalance,
    scheduledPayment,
    extraPayment: 0,
    recurringExtra: 0,
    totalPayment: scheduledPayment,
    interest,
    principal,
    endingBalance,
    cumulativeInterest,
    unpaidInterest: 0,
    isEstimated: false,
  }));
}

export const estimatedBalanceWarning: CalcWarning[] = [
  {
    code: 'estimated-balance',
    message: "No current balance was entered, so the balance and interest paid are estimated from the original schedule, assuming every payment was made on time with no extra payments. Enter the balance from a recent statement for an exact projection.",
    severity: 'info'
  }
];

export function makeStatus(overrides: Partial<LoanStatus> = {}): LoanStatus {
  return {
    isPaidOff: false,
    scheduledPayment: 483.32,
    paymentIsStandard: true,
    standardPayment: 483.32,
    contractPaymentCount: 60,
    maturityDate: '2029-01-01',
    originalScheduleTotalInterest: 3999.23,
    originalScheduleTotalCost: 28999.23,
    projectionStartDate: '2026-10-01',
    projectionStartBalance: 12178.73,
    nextPaymentNumber: 34,
    currentBalance: 12178.73,
    balanceIsEstimated: true,
    balanceAsOf: '2026-10-01',
    principalRepaid: 12821.27,
    percentRepaid: 51.29,
    paymentsMade: 33,
    paymentsMadeIsEstimated: true,
    interestPaidToDate: 3128.29,
    interestPaidSource: 'estimated',
    remainingPayments: 27,
    remainingInterest: 870.94,
    payoffDate: '2029-01-01',
    remainingTotalCost: 13049.67,
    projectedLifetimeCost: 28999.23,
    lifetimeCostIsEstimated: true,
    nextPayment: {
      number: 34,
      date: '2026-11-01',
      amount: 483.32,
      interest: 60.89,
      principal: 422.43
    },
    payoffEstimate: {
      date: '2026-10-14',
      principal: 12178.73,
      accruedInterest: 26.03,
      total: 12204.76
    },
    vehicleValue: null,
    equity: null,
    warnings: estimatedBalanceWarning,
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<ProjectionSummary> = {}): ProjectionSummary {
  return { ...{
    paysOff: true,
    payoffDate: '2029-01-01',
    paymentCount: 27,
    monthsToPayoff: 27,
    totalInterest: 870.94,
    totalPaid: 13049.67,
    totalExtra: 0,
    finalPayment: 483.35,
    warnings: []
  }, ...overrides };
}

export function makeProjection(overrides: Partial<Projection> = {}): Projection {
  return { summary: makeSummary(), rows: makeRows(), endingOwed: 0, ...overrides };
}

export const insightsFixture: Insight[] = [
  {
    id: 'progress',
    category: 'progress',
    tone: 'positive',
    title: "Repayment progress",
    message: "You have repaid 51.3% of your original principal.",
    explanation: "(Original amount $25,000.00 − current balance $12,178.73) ÷ $25,000.00 = 51.3%. The current balance is estimated from the original schedule assuming every payment so far was made on time.",
    metric: {
      label: "Principal repaid",
      value: 51.29,
      format: 'percent'
    }
  },
  {
    id: 'projection',
    category: 'projection',
    tone: 'neutral',
    title: "Projected payoff",
    message: "At your current payment rate, you are projected to finish in January 2029.",
    explanation: "Amortizing $12,178.73 from October 1, 2026 at 6% APR (interest of APR ÷ 12 per period) with $483.32 per month takes 27 more payments, the last on January 1, 2029, and $870.94 of interest.",
    metric: {
      label: "Payments left",
      value: 27,
      format: 'count'
    }
  },
  {
    id: 'extra-50',
    category: 'savings',
    tone: 'positive',
    title: "Pay a little extra",
    message: "Adding $50 per month could pay off your loan 2 months earlier and save about $85 in interest.",
    explanation: "Same projection as your baseline, with $50.00 added to every payment and applied to principal. Payoff moves from January 1, 2029 to November 1, 2028; remaining interest falls from $870.94 to $785.77.",
    metric: {
      label: "Interest saved",
      value: 85.17,
      format: 'currency'
    }
  },
  {
    id: 'extra-percent-75',
    category: 'savings',
    tone: 'positive',
    title: "Cut your remaining interest",
    message: "Paying an additional $75 per month could save approximately 14% of your remaining interest.",
    explanation: "Interest saved $121.79 ÷ baseline remaining interest $870.94 = 14%, with $75.00 extra principal on every payment from your next one.",
    metric: {
      label: "Interest reduction",
      value: 13.98,
      format: 'percent'
    }
  }
];

export const savingsOptionsFixture: Dashboard['savingsOptions'] = [
  {
    label: "+$50/mo",
    extraMonthly: 50,
    lumpSum: 0,
    interestSaved: 85.17,
    monthsSaved: 2,
    newPayoffDate: '2028-11-01'
  },
  {
    label: "+$100/mo",
    extraMonthly: 100,
    lumpSum: 0,
    interestSaved: 154.96,
    monthsSaved: 4,
    newPayoffDate: '2028-09-01'
  },
  {
    label: "+$250/mo",
    extraMonthly: 250,
    lumpSum: 0,
    interestSaved: 303.26,
    monthsSaved: 9,
    newPayoffDate: '2028-04-01'
  },
  {
    label: "$1,000 lump sum today",
    extraMonthly: 0,
    lumpSum: 1000,
    interestSaved: 134.36,
    monthsSaved: 2,
    newPayoffDate: '2028-11-01'
  },
  {
    label: "Pay off today",
    extraMonthly: 0,
    lumpSum: 12204.76,
    interestSaved: 844.91,
    monthsSaved: 27,
    newPayoffDate: '2026-10-14'
  }
];

export function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    loan: makeLoan(),
    status: makeStatus(),
    baseline: makeProjection(),
    savingsOptions: savingsOptionsFixture,
    insights: insightsFixture,
    ...overrides,
  };
}

export function makeLoanListItem(overrides: Partial<LoanListItem> = {}): LoanListItem {
  return {
    loan: makeLoan(),
    currentBalance: 12178.73,
    percentRepaid: 51.29,
    scheduledPayment: 483.32,
    payoffDate: '2029-01-01',
    isPaidOff: false,
    ...overrides,
  };
}

export function makePreview(overrides: Partial<LoanPreview> = {}): LoanPreview {
  return { status: makeStatus(), baseline: makeSummary(), ...overrides };
}

export function makePreferences(overrides: Partial<Preferences> = {}): Preferences {
  return { theme: 'system', currency: 'USD', defaultAccrualMethod: 'monthly', selectedLoanId: null, comparisonBudget: null, ...overrides };
}
