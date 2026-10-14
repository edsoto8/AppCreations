import type { AccrualMethod, DayCountBasis, IsoDate, Loan, LoanInput, PaymentFrequency } from '@/api/types';
import { addMonthsIso, parseIsoDate, todayIso } from '@/lib/format';

/** Editable form state. Numbers are null while empty; strings are '' while empty. */
export interface LoanFormValues {
  name: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number | null;
  originalAmount: number | null;
  downPayment: number | null;
  aprPercent: number | null;
  termMonths: number | null;
  startDate: IsoDate | null;
  firstPaymentDate: IsoDate | null;
  useStandardPayment: boolean;
  scheduledPayment: number | null;
  paymentFrequency: PaymentFrequency;
  accrualMethod: AccrualMethod;
  dayCountBasis: DayCountBasis;
  inProgress: boolean;
  currentBalance: number | null;
  balanceAsOf: IsoDate | null;
  paymentsMade: number | null;
  interestPaidToDate: number | null;
  lender: string;
  vehicleValue: number | null;
  notes: string;
}

export type LoanFormField = keyof LoanFormValues;
export type LoanFormErrors = Partial<Record<LoanFormField, string>>;

export const TERM_QUICK_PICKS = [36, 48, 60, 72, 84] as const;

export const LIMITS = {
  maxAmount: 10_000_000,
  maxApr: 100,
  maxTermMonths: 240,
  minYear: 1900,
  maxNameLength: 100,
  maxNotesLength: 2000,
} as const;

/** Field order used to focus the first invalid control after a failed submit. */
export const FIELD_ORDER: LoanFormField[] = [
  'name',
  'vehicleMake',
  'vehicleModel',
  'vehicleYear',
  'originalAmount',
  'downPayment',
  'aprPercent',
  'termMonths',
  'startDate',
  'firstPaymentDate',
  'scheduledPayment',
  'paymentFrequency',
  'accrualMethod',
  'dayCountBasis',
  'currentBalance',
  'balanceAsOf',
  'paymentsMade',
  'interestPaidToDate',
  'lender',
  'vehicleValue',
  'notes',
];

/** DOM id of a field's control, so labels, errors and focus all line up. */
export const fieldId = (field: LoanFormField) => `loan-${field}`;

export function emptyLoanForm(defaultAccrualMethod: AccrualMethod = 'monthly', today: IsoDate = todayIso()): LoanFormValues {
  return {
    name: '',
    vehicleMake: '',
    vehicleModel: '',
    vehicleYear: null,
    originalAmount: null,
    downPayment: null,
    aprPercent: null,
    termMonths: 60,
    startDate: today,
    firstPaymentDate: addMonthsIso(today, 1),
    useStandardPayment: true,
    scheduledPayment: null,
    paymentFrequency: 'monthly',
    accrualMethod: defaultAccrualMethod,
    dayCountBasis: 'actual365',
    inProgress: false,
    currentBalance: null,
    balanceAsOf: today,
    paymentsMade: null,
    interestPaidToDate: null,
    lender: '',
    vehicleValue: null,
    notes: '',
  };
}

export function loanToForm(loan: Loan, today: IsoDate = todayIso()): LoanFormValues {
  const inProgress = loan.currentBalance !== null && loan.currentBalance !== undefined;
  return {
    name: loan.name,
    vehicleMake: loan.vehicleMake ?? '',
    vehicleModel: loan.vehicleModel ?? '',
    vehicleYear: loan.vehicleYear ?? null,
    originalAmount: loan.originalAmount,
    downPayment: loan.downPayment ?? null,
    aprPercent: loan.aprPercent,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    firstPaymentDate: loan.firstPaymentDate,
    useStandardPayment: loan.scheduledPayment === null || loan.scheduledPayment === undefined,
    scheduledPayment: loan.scheduledPayment ?? null,
    paymentFrequency: loan.paymentFrequency,
    accrualMethod: loan.accrualMethod,
    dayCountBasis: loan.dayCountBasis,
    inProgress,
    currentBalance: loan.currentBalance ?? null,
    balanceAsOf: loan.balanceAsOf ?? (inProgress ? null : today),
    paymentsMade: loan.paymentsMade ?? null,
    interestPaidToDate: loan.interestPaidToDate ?? null,
    lender: loan.lender ?? '',
    vehicleValue: loan.vehicleValue ?? null,
    notes: loan.notes ?? '',
  };
}

const text = (s: string) => {
  const t = s.trim();
  return t === '' ? null : t;
};

/** Maps the form to the API's LoanInput. Assumes `validateLoanForm` found no errors. */
export function formToInput(values: LoanFormValues): LoanInput {
  return {
    name: values.name.trim(),
    vehicleMake: text(values.vehicleMake),
    vehicleModel: text(values.vehicleModel),
    vehicleYear: values.vehicleYear,
    lender: text(values.lender),
    originalAmount: values.originalAmount ?? 0,
    downPayment: values.downPayment,
    aprPercent: values.aprPercent ?? 0,
    termMonths: values.termMonths ?? 0,
    startDate: values.startDate ?? '',
    firstPaymentDate: values.firstPaymentDate ?? '',
    scheduledPayment: values.useStandardPayment ? null : values.scheduledPayment,
    paymentFrequency: values.paymentFrequency,
    accrualMethod: values.accrualMethod,
    // Only meaningful for daily simple interest; the API still requires a value.
    dayCountBasis: values.accrualMethod === 'dailySimple' ? values.dayCountBasis : 'actual365',
    currentBalance: values.inProgress ? values.currentBalance : null,
    balanceAsOf: values.inProgress ? values.balanceAsOf : null,
    paymentsMade: values.inProgress ? values.paymentsMade : null,
    interestPaidToDate: values.inProgress ? values.interestPaidToDate : null,
    vehicleValue: values.vehicleValue,
    notes: text(values.notes),
  };
}

/**
 * Client-side checks for required fields and obvious ranges. The server re-validates everything;
 * its 400 `errors` are mapped onto the same field names.
 */
export function validateLoanForm(values: LoanFormValues, today: IsoDate = todayIso()): LoanFormErrors {
  const e: LoanFormErrors = {};
  const currentYear = parseIsoDate(today)?.year ?? new Date().getFullYear();

  if (!values.name.trim()) e.name = 'Give this loan a name, e.g. "2024 RAV4".';
  else if (values.name.trim().length > LIMITS.maxNameLength) e.name = `Keep the name under ${LIMITS.maxNameLength} characters.`;

  if (values.vehicleYear !== null && (values.vehicleYear < LIMITS.minYear || values.vehicleYear > currentYear + 2)) {
    e.vehicleYear = `Enter a year between ${LIMITS.minYear} and ${currentYear + 2}.`;
  }

  if (values.originalAmount === null) e.originalAmount = 'Enter the amount you financed.';
  else if (values.originalAmount <= 0) e.originalAmount = 'The loan amount must be more than zero.';
  else if (values.originalAmount > LIMITS.maxAmount) e.originalAmount = 'That amount looks too large for an auto loan.';

  if (values.downPayment !== null && values.downPayment < 0) e.downPayment = 'The down payment cannot be negative.';

  if (values.aprPercent === null) e.aprPercent = 'Enter the APR from your contract (0 is allowed).';
  else if (values.aprPercent < 0 || values.aprPercent > LIMITS.maxApr) e.aprPercent = `Enter an APR between 0% and ${LIMITS.maxApr}%.`;

  if (values.termMonths === null) e.termMonths = 'Enter the loan term in months.';
  else if (!Number.isInteger(values.termMonths) || values.termMonths < 1 || values.termMonths > LIMITS.maxTermMonths) {
    e.termMonths = `Enter a whole number of months between 1 and ${LIMITS.maxTermMonths}.`;
  }

  if (!values.startDate) e.startDate = 'Enter the date the loan started.';
  if (!values.firstPaymentDate) e.firstPaymentDate = 'Enter the date of your first payment.';
  else if (values.startDate && values.firstPaymentDate <= values.startDate) {
    e.firstPaymentDate = 'The first payment must be after the start date.';
  }

  if (!values.useStandardPayment) {
    if (values.scheduledPayment === null) e.scheduledPayment = 'Enter your payment, or switch on "Use standard payment".';
    else if (values.scheduledPayment <= 0) e.scheduledPayment = 'The payment must be more than zero.';
  }

  if (values.inProgress) {
    if (values.currentBalance === null) e.currentBalance = 'Enter your current principal balance.';
    else if (values.currentBalance < 0) e.currentBalance = 'The balance cannot be negative.';
    if (!values.balanceAsOf) e.balanceAsOf = 'Enter the date this balance was accurate.';
    else if (values.startDate && values.balanceAsOf < values.startDate) e.balanceAsOf = 'This date must be on or after the start date.';
    else if (values.balanceAsOf > today) e.balanceAsOf = 'This date cannot be in the future.';
    if (values.paymentsMade !== null && (!Number.isInteger(values.paymentsMade) || values.paymentsMade < 0)) {
      e.paymentsMade = 'Enter a whole number of payments.';
    }
    if (values.interestPaidToDate !== null && values.interestPaidToDate < 0) e.interestPaidToDate = 'Interest paid cannot be negative.';
  }

  if (values.vehicleValue !== null && values.vehicleValue < 0) e.vehicleValue = 'The vehicle value cannot be negative.';
  if (values.notes.length > LIMITS.maxNotesLength) e.notes = `Keep notes under ${LIMITS.maxNotesLength} characters.`;

  return e;
}

const PREVIEW_IGNORED: LoanFormField[] = ['name', 'notes', 'vehicleYear', 'lender'];

/**
 * The LoanInput to preview, or null while the calculation inputs are incomplete/invalid.
 * Name and notes are not needed for a calculation.
 */
export function previewInput(values: LoanFormValues, today: IsoDate = todayIso()): LoanInput | null {
  const errors = validateLoanForm(values, today);
  const blocking = (Object.keys(errors) as LoanFormField[]).filter((k) => !PREVIEW_IGNORED.includes(k));
  if (blocking.length > 0) return null;
  return formToInput({ ...values, name: values.name.trim() || 'Preview' });
}
