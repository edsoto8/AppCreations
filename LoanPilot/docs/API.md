# LoanPilot HTTP API

Base URL: `http://localhost:5080/api`. JSON uses camelCase; enums are camelCase strings; dates are
`"yyyy-MM-dd"`; money and percentages are JSON numbers (dollars, and percent values such as `6.49`).
Validation failures return **400** `application/problem+json` with `errors: { fieldName: string[] }`
where `fieldName` matches the request property (camelCase; nested scenario fields look like
`lumpSums[0].date`, unreadable JSON is reported under `body`). Missing resources return **404**.

Every calculation endpoint accepts an optional `?asOf=yyyy-MM-dd` query to override "today".

## Types (TypeScript notation)

```ts
type PaymentFrequency = 'monthly' | 'biweekly' | 'weekly';
type AccrualMethod = 'monthly' | 'dailySimple';
type DayCountBasis = 'actual365' | 'actualActual';

interface LoanInput {
  name: string;
  vehicleMake?: string | null; vehicleModel?: string | null; vehicleYear?: number | null;
  lender?: string | null;
  originalAmount: number; downPayment?: number | null;
  aprPercent: number; termMonths: number;
  startDate: string; firstPaymentDate: string;
  scheduledPayment?: number | null;          // null → standard amortized payment
  paymentFrequency: PaymentFrequency;
  accrualMethod: AccrualMethod;
  dayCountBasis: DayCountBasis;
  currentBalance?: number | null;            // existing loan: principal balance...
  balanceAsOf?: string | null;               // ...as of this date (required with currentBalance)
  paymentsMade?: number | null;
  interestPaidToDate?: number | null;
  vehicleValue?: number | null;
  notes?: string | null;
}
interface Loan extends LoanInput { id: number; isArchived: boolean; createdAt: string; updatedAt: string; }

interface LoanListItem {
  loan: Loan;
  currentBalance: number; percentRepaid: number; scheduledPayment: number;
  payoffDate: string | null; isPaidOff: boolean;
}

type Severity = 'info' | 'warning' | 'critical';
interface CalcWarning { code: string; message: string; severity: Severity; }

type ScheduleRowKind = 'payment' | 'lumpSum';
interface ScheduleRow {
  number: number | null;          // scheduled payment number in the loan (null for a lump-sum row)
  date: string; kind: ScheduleRowKind;
  startingBalance: number;
  scheduledPayment: number;       // regular payment actually paid in this row (smaller on the final one)
  extraPayment: number;           // extra principal in this row (recurring extra, budget surplus or lump sum)
  totalPayment: number;
  interest: number;               // interest charged for the period this row closes
  principal: number;              // principal repaid by this row
  endingBalance: number;
  cumulativeInterest: number;
  unpaidInterest: number;         // accrued interest still owed after this row (0 unless payment is insufficient)
  isEstimated: boolean;           // true for reconstructed past rows of a loan without a known balance
  recurringExtra: number;         // part of extraPayment from recurring extras / budget surplus (rest = lump sums)
}

interface ProjectionSummary {
  paysOff: boolean;
  payoffDate: string | null;
  paymentCount: number;           // regular payments from projection start to payoff
  monthsToPayoff: number;         // calendar months from projection start to payoff
  totalInterest: number;          // remaining interest from projection start
  totalPaid: number;
  totalExtra: number;
  finalPayment: number;
  warnings: CalcWarning[];
}
interface Projection { summary: ProjectionSummary; rows: ScheduleRow[]; endingOwed: number; }

interface NextPayment { number: number; date: string; amount: number; interest: number; principal: number; }
interface PayoffEstimate { date: string; principal: number; accruedInterest: number; total: number; }

interface LoanStatus {
  isPaidOff: boolean;
  scheduledPayment: number; paymentIsStandard: boolean; standardPayment: number;
  contractPaymentCount: number; maturityDate: string;
  originalScheduleTotalInterest: number; originalScheduleTotalCost: number;
  projectionStartDate: string; projectionStartBalance: number; nextPaymentNumber: number;
  currentBalance: number; balanceIsEstimated: boolean; balanceAsOf: string;
  principalRepaid: number; percentRepaid: number;            // 0–100
  paymentsMade: number; paymentsMadeIsEstimated: boolean;
  interestPaidToDate: number | null;
  interestPaidSource: 'entered' | 'records' | 'estimated' | 'unknown';
  remainingPayments: number; remainingInterest: number;
  payoffDate: string | null; remainingTotalCost: number;
  projectedLifetimeCost: number | null; lifetimeCostIsEstimated: boolean;
  nextPayment: NextPayment | null;
  payoffEstimate: PayoffEstimate;     // estimate as of today — not a lender payoff quote
  vehicleValue: number | null; equity: number | null;
  warnings: CalcWarning[];
}

interface RecurringExtraInput { amount: number; startDate?: string | null; endDate?: string | null; }
interface LumpSumInput { amount: number; date: string; note?: string | null; }
interface ScenarioInput {
  name: string; description?: string | null;
  budgetPayment?: number | null;
  recurringExtras: RecurringExtraInput[];
  lumpSums: LumpSumInput[];
}
interface Scenario extends ScenarioInput { id: number; loanId: number; createdAt: string; updatedAt: string; }

interface ScenarioComparison {
  baselinePayoffDate: string | null; newPayoffDate: string | null;
  monthsSaved: number; paymentsSaved: number;
  baselineInterest: number; newInterest: number;
  interestSaved: number; percentInterestReduction: number;   // 0–100
  totalExtraPaid: number;
}
interface SimulationResult { baseline: Projection; scenario: Projection; comparison: ScenarioComparison; }

interface Insight {
  id: string;
  category: 'progress' | 'projection' | 'savings' | 'warning' | 'refinance' | 'scenario';
  tone: 'positive' | 'neutral' | 'warning';
  title: string;
  message: string;
  explanation: string;            // how the number was calculated, with the inputs used
  metric?: { label: string; value: number; format: 'currency' | 'percent' | 'months' | 'count' } | null;
}

interface DashboardSavingsOption { label: string; extraMonthly: number; lumpSum: number; interestSaved: number; monthsSaved: number; newPayoffDate: string | null; }
interface Dashboard {
  loan: Loan; status: LoanStatus; baseline: Projection;
  savingsOptions: DashboardSavingsOption[];        // e.g. +$50, +$100, +$250/month and pay-off-today
  insights: Insight[];                             // top insights
}

interface TargetPayoffResult {
  targetDate: string; achievable: boolean; message: string;
  requiredPayment: number | null; additionalAmount: number | null; scheduledPayment: number;
  simulation: SimulationResult | null;
}

interface BudgetResult { budget: number; extraAmount: number; simulation: SimulationResult; }

interface ComparisonRow {
  key: string;                    // "baseline" | "preset:extra-50" | "preset:lump-2000" | "scenario:12"
  name: string; kind: 'baseline' | 'preset' | 'saved'; scenarioId: number | null;
  paysOff: boolean; payoffDate: string | null; monthsToPayoff: number; paymentCount: number;
  totalInterest: number; interestSaved: number; monthsSaved: number; percentInterestReduction: number;
  recurringPayment: number;       // highest regular outlay per period in the scenario
  lumpSumTotal: number; totalPaid: number;
  balanceSeries: { date: string; balance: number }[];
}
interface ComparisonResult {
  budget: number | null;
  rows: ComparisonRow[];
  best: { fastestPayoff: string | null; lowestInterest: string | null; lowestRecurringPayment: string | null; bestWithinBudget: string | null };
  notes: string[];
}

interface AnnualSummaryRow { year: number; payments: number; totalPaid: number; principal: number; interest: number; extra: number; endingBalance: number; }
interface ScheduleResponse {
  history: ScheduleRow[];         // estimated past rows (only for loans without a known balance)
  baseline: Projection;
  scenario: Projection | null;
  baselineAnnual: AnnualSummaryRow[]; scenarioAnnual: AnnualSummaryRow[] | null;   // include history rows
  cumulativeInterestFrom: 'origination' | 'projectionStart';   // what cumulativeInterest counts from
}

interface RefinanceInput { newAprPercent: number; newTermMonths: number; fees: number; feesFinanced: boolean; }
interface RefinanceResult {
  current: { payment: number; remainingPayments: number; remainingInterest: number; totalRemainingCost: number; payoffDate: string | null };
  refinanced: { principal: number; payment: number; payments: number; totalInterest: number; fees: number; totalCost: number; payoffDate: string | null };
  monthlyPaymentChange: number;   // negative = lower payment
  lifetimeSavings: number;        // positive = refinancing costs less overall
  breakEvenMonth: number | null; breakEvenDate: string | null;
  verdict: string;
  rateComparison: { aprPercent: number; payment: number; totalInterest: number; lifetimeSavings: number }[];
  costSeries: { month: number; date: string; currentCost: number; refinanceCost: number }[];
}

interface PaymentRecordInput { date: string; amount: number; principal?: number | null; interest?: number | null; note?: string | null; }
interface PaymentRecord extends PaymentRecordInput { id: number; loanId: number; createdAt: string; }
interface ImportResult { imported: number; errors: { line: number; message: string }[]; }
interface TrackingPoint { date: string; scheduledCumulative: number; actualCumulative: number | null; }
interface TrackingResult { points: TrackingPoint[]; totalScheduled: number; totalActual: number; difference: number; note: string; }

interface Preferences { theme: 'system' | 'light' | 'dark'; currency: string; defaultAccrualMethod: AccrualMethod; selectedLoanId: number | null; comparisonBudget: number | null; }
```

## Endpoints

| Method & path | Body | Returns |
|---|---|---|
| `GET /health` | | `{ status: "ok" }` |
| `GET /loans?includeArchived=false` | | `LoanListItem[]` |
| `GET /loans/{id}` | | `Loan` |
| `POST /loans` | `LoanInput` | `201 Loan` |
| `PUT /loans/{id}` | `LoanInput` | `Loan` |
| `POST /loans/{id}/archive` · `POST /loans/{id}/unarchive` | | `Loan` |
| `DELETE /loans/{id}` | | `204` (deletes scenarios and payment records too) |
| `POST /calculate/preview` | `LoanInput` | `{ status: LoanStatus; baseline: ProjectionSummary }` (unsaved loan; 400 on invalid input) |
| `GET /loans/{id}/dashboard` | | `Dashboard` |
| `POST /loans/{id}/simulate` | `ScenarioInput` | `SimulationResult` |
| `POST /loans/{id}/target-payoff` | `{ targetDate: string }` | `TargetPayoffResult` |
| `POST /loans/{id}/budget` | `{ budget: number }` | `BudgetResult` |
| `GET /loans/{id}/scenarios` | | `Scenario[]` |
| `POST /loans/{id}/scenarios` | `ScenarioInput` | `201 Scenario` |
| `PUT /loans/{id}/scenarios/{scenarioId}` | `ScenarioInput` | `Scenario` |
| `DELETE /loans/{id}/scenarios/{scenarioId}` | | `204` |
| `GET /loans/{id}/comparison?budget=` | | `ComparisonResult` (baseline, presets, saved scenarios) |
| `GET /loans/{id}/insights` | | `Insight[]` |
| `GET /loans/{id}/schedule?scenarioId=` | | `ScheduleResponse` |
| `POST /loans/{id}/schedule` | `ScenarioInput` | `ScheduleResponse` for an unsaved scenario |
| `POST /loans/{id}/export?format=csv\|xlsx&view=monthly\|annual` | `{ scenarioId?: number; scenario?: ScenarioInput }` | file download |
| `POST /loans/{id}/refinance` | `RefinanceInput` | `RefinanceResult` |
| `GET /loans/{id}/payments` | | `PaymentRecord[]` (date order) |
| `POST /loans/{id}/payments` | `PaymentRecordInput` | `201 PaymentRecord` |
| `DELETE /loans/{id}/payments/{paymentId}` | | `204` |
| `POST /loans/{id}/payments/import` | `text/csv` body: `date,amount[,principal,interest,note]` | `ImportResult` |
| `GET /loans/{id}/payments/tracking` | | `TrackingResult` |
| `GET /preferences` · `PUT /preferences` | `Preferences` | `Preferences` |
