import type { CustomerPort, SimClock } from '../core/types';

/**
 * The browser implementation of the customer: the ATM waits until the user clicks the presented
 * cash or the ejected card in the 3D view (or until the sim-time timeout expires).
 */
export class UiCustomerPort implements CustomerPort {
  private cash?: () => void;
  private card?: () => void;
  private listeners = new Set<() => void>();

  constructor(private clock: SimClock) {}

  awaitCashCollection(timeoutMs: number): Promise<'collected' | 'timeout'> {
    return this.await(timeoutMs, (fn) => (this.cash = fn), () => (this.cash = undefined), 'collected');
  }

  awaitCardTaken(timeoutMs: number): Promise<'taken' | 'timeout'> {
    return this.await(timeoutMs, (fn) => (this.card = fn), () => (this.card = undefined), 'taken');
  }

  private await<T extends string>(timeoutMs: number, set: (fn: () => void) => void, clear: () => void, ok: T): Promise<T | 'timeout'> {
    return new Promise((resolve) => {
      let done = false;
      set(() => {
        if (done) return;
        done = true;
        clear();
        this.notify();
        resolve(ok);
      });
      this.notify();
      void this.clock.wait(timeoutMs).then(() => {
        if (done) return;
        done = true;
        clear();
        this.notify();
        resolve('timeout');
      });
    });
  }

  get waitingForCash(): boolean {
    return !!this.cash;
  }
  get waitingForCard(): boolean {
    return !!this.card;
  }

  collectCash(): boolean {
    if (!this.cash) return false;
    this.cash();
    return true;
  }

  takeCard(): boolean {
    if (!this.card) return false;
    this.card();
    return true;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  reset(): void {
    this.cash = undefined;
    this.card = undefined;
    this.notify();
  }
}
