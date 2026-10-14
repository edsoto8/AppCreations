import type { AccrualMethod, IsoDate, PaymentFrequency } from '@/api/types';

/** Loan facts every control panel needs (from the dashboard). */
export interface ControlsContext {
  currency: string;
  frequency: PaymentFrequency;
  accrualMethod: AccrualMethod;
  /** "per month" for monthly loans, "per payment" for biweekly / weekly. */
  perPeriodLabel: string;
  /** Short suffix: "/mo" or "/payment". */
  perPeriodShort: string;
  /** Earliest date an extra payment can use: the projection start. */
  minDate: IsoDate;
  /** Default date for a new lump sum: today, or the projection start when that is later. */
  defaultLumpDate: IsoDate;
  scheduledPayment: number;
  sliderMax: number;
  baselinePayoffDate: IsoDate | null;
}

export function perPeriod(frequency: PaymentFrequency): { label: string; short: string } {
  return frequency === 'monthly' ? { label: 'per month', short: '/mo' } : { label: 'per payment', short: '/payment' };
}
