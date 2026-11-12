import type { EventBus } from '../core/events';
import type { AuditEntry, JournalEntry, SimClock, Transaction } from '../core/types';

/** Fictional business date the simulation starts on (sim time 0 = 09:00:00 that day, UTC). */
const SIM_EPOCH_MS = Date.UTC(2027, 2, 15, 9, 0, 0);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** "15 MAR 2027 09:01:23" for a sim time (deterministic, timezone independent). */
export function formatSimDateTime(simMs: number): string {
  const d = new Date(SIM_EPOCH_MS + Math.floor(simMs));
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/** "09:01:23.450" — clock time for journal lines. */
export function formatSimTime(simMs: number): string {
  const d = new Date(SIM_EPOCH_MS + Math.floor(simMs));
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
}

/** "15 MAR" — short date for statements. */
export function formatSimDate(simMs: number): string {
  const d = new Date(SIM_EPOCH_MS + Math.floor(simMs));
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Electronic journal (EJ) + audit log.
 *
 * Real ATMs write every customer and device event to a tamper-evident electronic journal; it is the first
 * thing an investigator reads when a customer disputes a withdrawal. The audit log records WHO did what
 * (customer, ATM, host, operator, trainer). Both are append-only.
 */
export class Journal {
  readonly entries: JournalEntry[] = [];
  readonly audit: AuditEntry[] = [];
  readonly transactions: Transaction[] = [];
  private seq = 0;
  private auditSeq = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly clock: SimClock,
  ) {}

  log(kind: JournalEntry['kind'], text: string, txnId?: string): JournalEntry {
    const entry: JournalEntry = { seq: ++this.seq, time: this.clock.now(), kind, text, ...(txnId ? { txnId } : {}) };
    this.entries.push(entry);
    this.bus.emit('journal', { entry });
    return entry;
  }

  auditLog(actor: AuditEntry['actor'], action: string, detail?: string): AuditEntry {
    const entry: AuditEntry = { seq: ++this.auditSeq, time: this.clock.now(), actor, action, ...(detail !== undefined ? { detail } : {}) };
    this.audit.push(entry);
    this.bus.emit('audit', { entry });
    return entry;
  }

  addTransaction(txn: Transaction): void {
    this.transactions.push(txn);
  }

  findTransaction(id: string): Transaction | undefined {
    return this.transactions.find((t) => t.id === id);
  }

  /** Printable EJ text, one line per entry. Deterministic for the same inputs (used by replay tests). */
  text(): string {
    return this.entries.map((e) => `${String(e.seq).padStart(5, '0')} ${formatSimTime(e.time)} ${e.kind.padEnd(8)} ${e.txnId ? e.txnId + ' ' : ''}${e.text}`).join('\n');
  }
}
