import { FINAL_TXN_STATES, type Transaction, type TxnState, type TxnTransition } from '../core/types';

/**
 * Allowed transaction state transitions. Anything not listed is a programming error and throws, so a
 * transaction can never "skip" a step (e.g. post money without being authorised).
 *
 * Any non-final state may go to SUSPECT (power loss: the ATM cannot know what physically happened),
 * which is later resolved to REVERSED (via REVERSAL_PENDING) or COMPLETED.
 */
export const ALLOWED: Record<TxnState, TxnState[]> = {
  CREATED: ['AUTH_PENDING', 'ESCROWED', 'CANCELLED', 'SUSPECT'],
  ESCROWED: ['AUTH_PENDING', 'CANCELLED', 'SUSPECT'],
  AUTH_PENDING: ['AUTHORIZED', 'DECLINED', 'TIMED_OUT', 'SUSPECT'],
  // Non-cash transactions complete straight after authorisation.
  AUTHORIZED: ['DISPENSING', 'COMPLETED', 'REVERSAL_PENDING', 'SUSPECT'],
  TIMED_OUT: ['REVERSAL_PENDING', 'SUSPECT'],
  DISPENSING: ['PRESENTED', 'DISPENSE_FAILED', 'SUSPECT'],
  DISPENSE_FAILED: ['REVERSAL_PENDING', 'SUSPECT'],
  PRESENTED: ['COLLECTED', 'RETRACTED', 'SUSPECT'],
  COLLECTED: ['COMPLETED', 'SUSPECT'],
  // RETRACTED → COMPLETED only when the bank's policy is NOT to reverse retracted cash (config.reversalOnRetract=false).
  RETRACTED: ['REVERSAL_PENDING', 'COMPLETED', 'SUSPECT'],
  SUSPECT: ['REVERSAL_PENDING', 'COMPLETED'],
  REVERSAL_PENDING: ['REVERSED', 'SUSPECT'],
  DECLINED: [],
  REVERSED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly txnId: string,
    readonly from: TxnState,
    readonly to: TxnState,
  ) {
    super(`Illegal transaction transition ${txnId}: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: TxnState, to: TxnState): boolean {
  return ALLOWED[from].includes(to);
}

export function isFinal(state: TxnState): boolean {
  return FINAL_TXN_STATES.includes(state);
}

/** Apply a transition (mutates `txn`). Throws IllegalTransitionError if the table does not allow it. */
export function transition(txn: Transaction, to: TxnState, note: string, time: number): TxnTransition {
  const from = txn.state;
  if (!canTransition(from, to)) throw new IllegalTransitionError(txn.id, from, to);
  const t: TxnTransition = { from, to, time, note };
  txn.state = to;
  txn.history.push(t);
  return t;
}
