import type { Cents, DispenseStrategy } from '../core/types';
import type { DispenseLimits } from '../cash/dispense';

/** Terminal configuration (re-exported by app/AtmSystem.ts). */
export interface AtmConfig {
  strategy: DispenseStrategy;
  /** Presenter capacity: most notes in one bundle. */
  maxNotesPerDispense: number;
  minWithdrawalCents: Cents;
  maxWithdrawalCents: Cents;
  amountMultipleCents: Cents;
  cashTakeTimeoutMs: number;
  cardTakeTimeoutMs: number;
  /** Sim-ms per network hop. */
  hostHopLatencyMs: number;
  /** How long the ATM waits for the host before treating the request as timed out. */
  hostTimeoutMs: number;
  /** Generic bank policy: reverse (refund) a withdrawal whose cash was retracted. Policies vary by bank. */
  reversalOnRetract: boolean;
  terminalId: string;
}

export const DEFAULT_ATM_CONFIG: AtmConfig = {
  strategy: 'min-notes',
  maxNotesPerDispense: 40,
  minWithdrawalCents: 2_000,
  maxWithdrawalCents: 80_000,
  amountMultipleCents: 1_000,
  cashTakeTimeoutMs: 30_000,
  cardTakeTimeoutMs: 30_000,
  hostHopLatencyMs: 350,
  hostTimeoutMs: 8_000,
  reversalOnRetract: true,
  terminalId: 'TRN-ATM-0001',
};

export function dispenseLimits(c: AtmConfig): DispenseLimits {
  return { minCents: c.minWithdrawalCents, maxCents: c.maxWithdrawalCents, multipleCents: c.amountMultipleCents, maxNotes: c.maxNotesPerDispense };
}
