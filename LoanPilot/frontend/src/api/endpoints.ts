import { request, requestFile, type FileDownload } from './client';
import type {
  BudgetResult,
  ComparisonResult,
  Dashboard,
  ExportFormat,
  ExportRequest,
  ExportView,
  HealthResponse,
  ImportResult,
  Insight,
  IsoDate,
  Loan,
  LoanInput,
  LoanListItem,
  LoanPreview,
  PaymentRecord,
  PaymentRecordInput,
  Preferences,
  RefinanceInput,
  RefinanceResult,
  Scenario,
  ScenarioInput,
  ScheduleResponse,
  SimulationResult,
  TargetPayoffResult,
  TrackingResult,
} from './types';

/** Options shared by every call. `asOf` overrides "today" on calculation endpoints. */
export interface CallOptions {
  asOf?: IsoDate;
  signal?: AbortSignal;
}

const calc = (opts?: CallOptions) => ({ query: { asOf: opts?.asOf }, signal: opts?.signal });

// ── Health ───────────────────────────────────────────────────────────────────
export const getHealth = (opts?: CallOptions) => request<HealthResponse>('/health', { signal: opts?.signal });

// ── Loans ────────────────────────────────────────────────────────────────────
export const listLoans = (includeArchived = false, opts?: CallOptions) =>
  request<LoanListItem[]>('/loans', { query: { includeArchived, asOf: opts?.asOf }, signal: opts?.signal });

export const getLoan = (id: number, opts?: CallOptions) => request<Loan>(`/loans/${id}`, { signal: opts?.signal });

export const createLoan = (input: LoanInput) => request<Loan>('/loans', { method: 'POST', json: input });

export const updateLoan = (id: number, input: LoanInput) => request<Loan>(`/loans/${id}`, { method: 'PUT', json: input });

export const archiveLoan = (id: number) => request<Loan>(`/loans/${id}/archive`, { method: 'POST' });

export const unarchiveLoan = (id: number) => request<Loan>(`/loans/${id}/unarchive`, { method: 'POST' });

/** Deletes the loan with its scenarios and payment records. */
export const deleteLoan = (id: number) => request<void>(`/loans/${id}`, { method: 'DELETE' });

// ── Calculation ──────────────────────────────────────────────────────────────
/** Calculates an unsaved loan. Throws ApiError(400) with field errors on invalid input. */
export const previewLoan = (input: LoanInput, opts?: CallOptions) =>
  request<LoanPreview>('/calculate/preview', { method: 'POST', json: input, ...calc(opts) });

export const getDashboard = (loanId: number, opts?: CallOptions) =>
  request<Dashboard>(`/loans/${loanId}/dashboard`, calc(opts));

export const simulate = (loanId: number, scenario: ScenarioInput, opts?: CallOptions) =>
  request<SimulationResult>(`/loans/${loanId}/simulate`, { method: 'POST', json: scenario, ...calc(opts) });

export const solveTargetPayoff = (loanId: number, targetDate: IsoDate, opts?: CallOptions) =>
  request<TargetPayoffResult>(`/loans/${loanId}/target-payoff`, { method: 'POST', json: { targetDate }, ...calc(opts) });

export const solveBudget = (loanId: number, budget: number, opts?: CallOptions) =>
  request<BudgetResult>(`/loans/${loanId}/budget`, { method: 'POST', json: { budget }, ...calc(opts) });

// ── Scenarios ────────────────────────────────────────────────────────────────
export const listScenarios = (loanId: number, opts?: CallOptions) =>
  request<Scenario[]>(`/loans/${loanId}/scenarios`, { signal: opts?.signal });

export const createScenario = (loanId: number, input: ScenarioInput) =>
  request<Scenario>(`/loans/${loanId}/scenarios`, { method: 'POST', json: input });

export const updateScenario = (loanId: number, scenarioId: number, input: ScenarioInput) =>
  request<Scenario>(`/loans/${loanId}/scenarios/${scenarioId}`, { method: 'PUT', json: input });

export const deleteScenario = (loanId: number, scenarioId: number) =>
  request<void>(`/loans/${loanId}/scenarios/${scenarioId}`, { method: 'DELETE' });

export const getComparison = (loanId: number, budget?: number | null, opts?: CallOptions) =>
  request<ComparisonResult>(`/loans/${loanId}/comparison`, {
    query: { budget: budget ?? undefined, asOf: opts?.asOf },
    signal: opts?.signal,
  });

// ── Insights & schedule ──────────────────────────────────────────────────────
export const getInsights = (loanId: number, opts?: CallOptions) =>
  request<Insight[]>(`/loans/${loanId}/insights`, calc(opts));

export const getSchedule = (loanId: number, scenarioId?: number | null, opts?: CallOptions) =>
  request<ScheduleResponse>(`/loans/${loanId}/schedule`, {
    query: { scenarioId: scenarioId ?? undefined, asOf: opts?.asOf },
    signal: opts?.signal,
  });

/** Schedule for an unsaved scenario. */
export const previewSchedule = (loanId: number, scenario: ScenarioInput, opts?: CallOptions) =>
  request<ScheduleResponse>(`/loans/${loanId}/schedule`, { method: 'POST', json: scenario, ...calc(opts) });

/** Downloads the schedule as CSV or XLSX. Use `saveDownload` from ./client to hand it to the browser. */
export const exportSchedule = (
  loanId: number,
  format: ExportFormat,
  view: ExportView,
  body: ExportRequest = {},
  opts?: CallOptions,
): Promise<FileDownload> =>
  requestFile(
    `/loans/${loanId}/export`,
    { method: 'POST', json: body, query: { format, view, asOf: opts?.asOf }, signal: opts?.signal },
    `loanpilot-schedule-${view}.${format}`,
  );

// ── Refinance ────────────────────────────────────────────────────────────────
export const refinance = (loanId: number, input: RefinanceInput, opts?: CallOptions) =>
  request<RefinanceResult>(`/loans/${loanId}/refinance`, { method: 'POST', json: input, ...calc(opts) });

// ── Payment records ──────────────────────────────────────────────────────────
export const listPayments = (loanId: number, opts?: CallOptions) =>
  request<PaymentRecord[]>(`/loans/${loanId}/payments`, { signal: opts?.signal });

export const createPayment = (loanId: number, input: PaymentRecordInput) =>
  request<PaymentRecord>(`/loans/${loanId}/payments`, { method: 'POST', json: input });

export const deletePayment = (loanId: number, paymentId: number) =>
  request<void>(`/loans/${loanId}/payments/${paymentId}`, { method: 'DELETE' });

/** CSV body: `date,amount[,principal,interest,note]`, one payment per line. */
export const importPayments = (loanId: number, csv: string) =>
  request<ImportResult>(`/loans/${loanId}/payments/import`, { method: 'POST', body: csv, contentType: 'text/csv' });

export const getPaymentTracking = (loanId: number, opts?: CallOptions) =>
  request<TrackingResult>(`/loans/${loanId}/payments/tracking`, calc(opts));

// ── Preferences ──────────────────────────────────────────────────────────────
export const getPreferences = (opts?: CallOptions) => request<Preferences>('/preferences', { signal: opts?.signal });

export const updatePreferences = (prefs: Preferences) =>
  request<Preferences>('/preferences', { method: 'PUT', json: prefs });
