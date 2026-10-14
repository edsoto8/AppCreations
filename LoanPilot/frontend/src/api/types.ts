/**
 * LoanPilot HTTP contract. Mirrors docs/API.md exactly — keep the two in sync.
 * JSON is camelCase, enums are camelCase strings, dates are "yyyy-MM-dd", money and
 * percentages are numbers (dollars, and percent values such as 6.49).
 */

/** ISO calendar date, "yyyy-MM-dd". */
export type IsoDate = string;

export type PaymentFrequency = 'monthly' | 'biweekly' | 'weekly';
export type AccrualMethod = 'monthly' | 'dailySimple';
export type DayCountBasis = 'actual365' | 'actualActual';

export interface LoanInput {
  name: string;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  lender?: string | null;
  originalAmount: number;
  downPayment?: number | null;
  aprPercent: number;
  termMonths: number;
  startDate: IsoDate;
  firstPaymentDate: IsoDate;
  /** null → standard amortized payment */
  scheduledPayment?: number | null;
  paymentFrequency: PaymentFrequency;
  accrualMethod: AccrualMethod;
  dayCountBasis: DayCountBasis;
  /** existing loan: principal balance... */
  currentBalance?: number | null;
  /** ...as of this date (required with currentBalance) */
  balanceAsOf?: IsoDate | null;
  paymentsMade?: number | null;
  interestPaidToDate?: number | null;
  vehicleValue?: number | null;
  notes?: string | null;
}

export interface Loan extends LoanInput {
  id: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoanListItem {
  loan: Loan;
  currentBalance: number;
  percentRepaid: number;
  scheduledPayment: number;
  payoffDate: IsoDate | null;
  isPaidOff: boolean;
}

export type Severity = 'info' | 'warning' | 'critical';
export interface CalcWarning {
  code: string;
  message: string;
  severity: Severity;
}

export type ScheduleRowKind = 'payment' | 'lumpSum';
export interface ScheduleRow {
  /** scheduled payment number in the loan (null for a lump-sum row) */
  number: number | null;
  date: IsoDate;
  kind: ScheduleRowKind;
  startingBalance: number;
  /** regular payment actually paid in this row (smaller on the final one) */
  scheduledPayment: number;
  /** extra principal in this row (recurring extra, budget surplus or lump sum) */
  extraPayment: number;
  /** part of extraPayment from recurring extras / budget surplus (rest = lump sums) */
  recurringExtra: number;
  totalPayment: number;
  /** interest charged for the period this row closes */
  interest: number;
  /** principal repaid by this row */
  principal: number;
  endingBalance: number;
  cumulativeInterest: number;
  /** accrued interest still owed after this row (0 unless payment is insufficient) */
  unpaidInterest: number;
  /** true for reconstructed past rows of a loan without a known balance */
  isEstimated: boolean;
}

export interface ProjectionSummary {
  paysOff: boolean;
  payoffDate: IsoDate | null;
  /** regular payments from projection start to payoff */
  paymentCount: number;
  /** calendar months from projection start to payoff */
  monthsToPayoff: number;
  /** remaining interest from projection start */
  totalInterest: number;
  totalPaid: number;
  totalExtra: number;
  finalPayment: number;
  warnings: CalcWarning[];
}

export interface Projection {
  summary: ProjectionSummary;
  rows: ScheduleRow[];
  endingOwed: number;
}

export interface NextPayment {
  number: number;
  date: IsoDate;
  amount: number;
  interest: number;
  principal: number;
}

export interface PayoffEstimate {
  date: IsoDate;
  principal: number;
  accruedInterest: number;
  total: number;
}

export type InterestPaidSource = 'entered' | 'records' | 'estimated' | 'unknown';

export interface LoanStatus {
  isPaidOff: boolean;
  scheduledPayment: number;
  paymentIsStandard: boolean;
  standardPayment: number;
  contractPaymentCount: number;
  maturityDate: IsoDate;
  originalScheduleTotalInterest: number;
  originalScheduleTotalCost: number;
  projectionStartDate: IsoDate;
  projectionStartBalance: number;
  nextPaymentNumber: number;
  currentBalance: number;
  balanceIsEstimated: boolean;
  balanceAsOf: IsoDate;
  principalRepaid: number;
  /** 0–100 */
  percentRepaid: number;
  paymentsMade: number;
  paymentsMadeIsEstimated: boolean;
  interestPaidToDate: number | null;
  interestPaidSource: InterestPaidSource;
  remainingPayments: number;
  remainingInterest: number;
  payoffDate: IsoDate | null;
  remainingTotalCost: number;
  projectedLifetimeCost: number | null;
  lifetimeCostIsEstimated: boolean;
  /** first payment due on or after today */
  nextPayment: NextPayment | null;
  /** estimate as of today — not a lender payoff quote */
  payoffEstimate: PayoffEstimate;
  vehicleValue: number | null;
  equity: number | null;
  warnings: CalcWarning[];
}

export interface RecurringExtraInput {
  amount: number;
  startDate?: IsoDate | null;
  endDate?: IsoDate | null;
}

export interface LumpSumInput {
  amount: number;
  date: IsoDate;
  note?: string | null;
}

export interface ScenarioInput {
  name: string;
  description?: string | null;
  budgetPayment?: number | null;
  recurringExtras: RecurringExtraInput[];
  lumpSums: LumpSumInput[];
}

export interface Scenario extends ScenarioInput {
  id: number;
  loanId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioComparison {
  baselinePayoffDate: IsoDate | null;
  newPayoffDate: IsoDate | null;
  monthsSaved: number;
  paymentsSaved: number;
  baselineInterest: number;
  newInterest: number;
  interestSaved: number;
  /** 0–100 */
  percentInterestReduction: number;
  totalExtraPaid: number;
}

export interface SimulationResult {
  baseline: Projection;
  scenario: Projection;
  comparison: ScenarioComparison;
}

export type InsightCategory = 'progress' | 'projection' | 'savings' | 'warning' | 'refinance' | 'scenario';
export type InsightTone = 'positive' | 'neutral' | 'warning';
export type InsightMetricFormat = 'currency' | 'percent' | 'months' | 'count';

export interface InsightMetric {
  label: string;
  value: number;
  format: InsightMetricFormat;
}

export interface Insight {
  id: string;
  category: InsightCategory;
  tone: InsightTone;
  title: string;
  message: string;
  /** how the number was calculated, with the inputs used */
  explanation: string;
  metric?: InsightMetric | null;
}

export interface DashboardSavingsOption {
  label: string;
  extraMonthly: number;
  lumpSum: number;
  interestSaved: number;
  monthsSaved: number;
  newPayoffDate: IsoDate | null;
}

export interface Dashboard {
  loan: Loan;
  status: LoanStatus;
  baseline: Projection;
  /** +$50/mo, +$100/mo, +$250/mo, a suggested lump sum today, and "Pay off today" (lumpSum = estimated payoff total) */
  savingsOptions: DashboardSavingsOption[];
  /** top insights (warning-category insights excluded; warnings live in status.warnings) */
  insights: Insight[];
}

export interface TargetPayoffResult {
  targetDate: IsoDate;
  achievable: boolean;
  message: string;
  requiredPayment: number | null;
  additionalAmount: number | null;
  scheduledPayment: number;
  simulation: SimulationResult | null;
}

export interface BudgetResult {
  budget: number;
  extraAmount: number;
  simulation: SimulationResult;
}

export type ComparisonRowKind = 'baseline' | 'preset' | 'saved';

export interface BalancePoint {
  date: IsoDate;
  balance: number;
}

export interface ComparisonRow {
  /** "baseline" | "preset:extra-50" | "preset:lump-2000" | "scenario:12" */
  key: string;
  name: string;
  kind: ComparisonRowKind;
  scenarioId: number | null;
  paysOff: boolean;
  payoffDate: IsoDate | null;
  monthsToPayoff: number;
  paymentCount: number;
  totalInterest: number;
  interestSaved: number;
  monthsSaved: number;
  percentInterestReduction: number;
  /** highest regular outlay per period in the scenario */
  recurringPayment: number;
  lumpSumTotal: number;
  totalPaid: number;
  balanceSeries: BalancePoint[];
}

export interface ComparisonBest {
  fastestPayoff: string | null;
  lowestInterest: string | null;
  lowestRecurringPayment: string | null;
  bestWithinBudget: string | null;
}

export interface ComparisonResult {
  budget: number | null;
  rows: ComparisonRow[];
  best: ComparisonBest;
  notes: string[];
}

export interface AnnualSummaryRow {
  year: number;
  payments: number;
  totalPaid: number;
  principal: number;
  interest: number;
  extra: number;
  endingBalance: number;
}

export interface ScheduleResponse {
  /** estimated past rows (only for loans without a known balance) */
  history: ScheduleRow[];
  baseline: Projection;
  scenario: Projection | null;
  baselineAnnual: AnnualSummaryRow[];
  scenarioAnnual: AnnualSummaryRow[] | null;
  /** what ScheduleRow.cumulativeInterest counts from */
  cumulativeInterestFrom: 'origination' | 'projectionStart';
}

export interface RefinanceInput {
  newAprPercent: number;
  newTermMonths: number;
  fees: number;
  feesFinanced: boolean;
}

export interface RefinanceCurrent {
  payment: number;
  remainingPayments: number;
  remainingInterest: number;
  totalRemainingCost: number;
  payoffDate: IsoDate | null;
}

export interface RefinanceRefinanced {
  principal: number;
  payment: number;
  payments: number;
  totalInterest: number;
  fees: number;
  totalCost: number;
  payoffDate: IsoDate | null;
}

export interface RateComparisonRow {
  aprPercent: number;
  payment: number;
  totalInterest: number;
  lifetimeSavings: number;
}

export interface RefinanceCostPoint {
  /** payment number */
  month: number;
  date: IsoDate;
  currentCost: number;
  refinanceCost: number;
}

export interface RefinanceResult {
  current: RefinanceCurrent;
  refinanced: RefinanceRefinanced;
  /** negative = lower payment */
  monthlyPaymentChange: number;
  /** positive = refinancing costs less overall */
  lifetimeSavings: number;
  /** calendar months from the refinance until savings cover the fees */
  breakEvenMonth: number | null;
  breakEvenDate: IsoDate | null;
  verdict: string;
  rateComparison: RateComparisonRow[];
  costSeries: RefinanceCostPoint[];
}

export interface PaymentRecordInput {
  date: IsoDate;
  amount: number;
  principal?: number | null;
  interest?: number | null;
  note?: string | null;
}

export interface PaymentRecord extends PaymentRecordInput {
  id: number;
  loanId: number;
  createdAt: string;
}

export interface ImportError {
  line: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  errors: ImportError[];
}

export interface TrackingPoint {
  date: IsoDate;
  scheduledCumulative: number;
  actualCumulative: number | null;
}

export interface TrackingResult {
  points: TrackingPoint[];
  totalScheduled: number;
  totalActual: number;
  difference: number;
  note: string;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Preferences {
  theme: ThemePreference;
  currency: string;
  defaultAccrualMethod: AccrualMethod;
  selectedLoanId: number | null;
  comparisonBudget: number | null;
}

/** Response of POST /calculate/preview. */
export interface LoanPreview {
  status: LoanStatus;
  baseline: ProjectionSummary;
}

export interface HealthResponse {
  status: 'ok';
}

export type ExportFormat = 'csv' | 'xlsx';
export type ExportView = 'monthly' | 'annual';

/** Body of POST /loans/{id}/export: a saved scenario id, an unsaved scenario, or neither (baseline). */
export interface ExportRequest {
  scenarioId?: number;
  scenario?: ScenarioInput;
}

/**
 * RFC 7807 problem details as returned by ASP.NET Core for 400 validation failures.
 * Nested keys look like `lumpSums[0].date` / `recurringExtras[1].amount`; unreadable JSON is under `body`.
 */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}
