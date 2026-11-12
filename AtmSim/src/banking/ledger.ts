import type { Account, Card, Cents, Customer, Hold, LedgerPosting, StatementLine } from '../core/types';
import type { SeedData } from './seed';

/**
 * Double-entry ledger.
 *
 * Every posting has two or more legs whose amounts sum to zero. Sign convention (credit-positive):
 *  - a POSITIVE leg is a CREDIT, a NEGATIVE leg is a DEBIT;
 *  - customer deposit accounts are LIABILITIES of the bank, so a credit increases the customer's balance;
 *  - general-ledger (GL) accounts are kept as the raw signed sum of their legs. `GL-ATM-CASH` is an ASSET
 *    (cash physically in this ATM): a debit (negative leg) increases it, a credit decreases it.
 *
 * Holds ("authorisations") are NOT postings: they only reduce the AVAILABLE balance
 * (available = ledger − holds). Money only moves on the ledger when a transaction is completed.
 */
export const GL_ATM_CASH = 'GL-ATM-CASH';
export const GL_SUSPENSE = 'GL-SUSPENSE';

export interface LedgerSnapshot {
  accounts: Array<{
    id: string;
    customerId: string;
    nickname: string;
    type: Account['type'];
    status: Account['status'];
    ledgerCents: Cents;
    availableCents: Cents;
    holdsCents: Cents;
    withdrawnTodayCents: Cents;
  }>;
  gl: Record<string, Cents>;
  postingCount: number;
}

export class Ledger {
  readonly customers = new Map<string, Customer>();
  readonly accounts = new Map<string, Account>();
  readonly cards = new Map<string, Card>();
  /** GL account balances (credit-positive sum of legs). */
  readonly gl = new Map<string, Cents>([
    [GL_ATM_CASH, 0],
    [GL_SUSPENSE, 0],
  ]);
  readonly postings: LedgerPosting[] = [];
  private lines = new Map<string, StatementLine[]>();
  private holdSeq = 0;
  private postSeq = 0;

  constructor(private readonly now: () => number) {}

  /** Build a ledger from seed data; opening history is posted against GL-SUSPENSE (external counterparty). */
  static fromSeed(seed: SeedData, now: () => number): Ledger {
    const l = new Ledger(now);
    for (const c of seed.customers) l.customers.set(c.id, c);
    for (const a of seed.accounts) l.accounts.set(a.id, a);
    for (const c of seed.cards) l.cards.set(c.id, c);
    const sorted = [...seed.history].sort((a, b) => b.daysAgo - a.daysAgo);
    for (const h of sorted) {
      const time = -h.daysAgo * 86_400_000;
      l.postAt(time, 'SEED', h.description, [
        { account: h.accountId, amountCents: h.amountCents },
        { account: GL_SUSPENSE, amountCents: -h.amountCents },
      ]);
    }
    return l;
  }

  account(id: string): Account {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`Unknown account ${id}`);
    return a;
  }

  holdsTotal(id: string): Cents {
    return this.account(id).holds.reduce((s, h) => s + h.amountCents, 0);
  }

  /** Available balance = posted (ledger) balance − outstanding holds. */
  available(id: string): Cents {
    const a = this.account(id);
    return a.ledgerCents - this.holdsTotal(id);
  }

  /** Reserve funds for an authorised transaction. Changes AVAILABLE, never the ledger balance. */
  placeHold(accountId: string, txnId: string, cents: Cents): Hold {
    const a = this.account(accountId);
    const hold: Hold = { id: `HOLD-${String(++this.holdSeq).padStart(6, '0')}`, txnId, amountCents: cents, createdAt: this.now() };
    a.holds.push(hold);
    return hold;
  }

  /** Release a hold. Idempotent: releasing an unknown / already released hold returns undefined. */
  releaseHold(holdId: string): Hold | undefined {
    for (const a of this.accounts.values()) {
      const i = a.holds.findIndex((h) => h.id === holdId);
      if (i >= 0) return a.holds.splice(i, 1)[0];
    }
    return undefined;
  }

  findHoldByTxn(txnId: string): (Hold & { accountId: string }) | undefined {
    return this.allHolds().find((h) => h.txnId === txnId);
  }

  allHolds(): Array<Hold & { accountId: string }> {
    const out: Array<Hold & { accountId: string }> = [];
    for (const a of this.accounts.values()) for (const h of a.holds) out.push({ ...h, accountId: a.id });
    return out;
  }

  /** Post a balanced double-entry transaction. Throws if the legs do not sum to zero. */
  post(txnId: string, description: string, legs: LedgerPosting['legs']): LedgerPosting {
    return this.postAt(this.now(), txnId, description, legs);
  }

  private postAt(time: number, txnId: string, description: string, legs: LedgerPosting['legs']): LedgerPosting {
    const sum = legs.reduce((s, l) => s + l.amountCents, 0);
    if (sum !== 0) throw new Error(`Unbalanced posting "${description}": legs sum to ${sum}`);
    if (legs.some((l) => !Number.isInteger(l.amountCents))) throw new Error('Posting amounts must be integer cents');
    for (const leg of legs) {
      if (!this.accounts.has(leg.account) && !leg.account.startsWith('GL-')) throw new Error(`Unknown ledger account ${leg.account}`);
    }
    const posting: LedgerPosting = { id: `PST-${String(++this.postSeq).padStart(6, '0')}`, txnId, time, description, legs: legs.map((l) => ({ ...l })) };
    for (const leg of legs) {
      const acct = this.accounts.get(leg.account);
      if (acct) {
        acct.ledgerCents += leg.amountCents;
        const list = this.lines.get(acct.id) ?? [];
        list.push({ time, description, amountCents: leg.amountCents, balanceCents: acct.ledgerCents });
        this.lines.set(acct.id, list);
      } else {
        this.gl.set(leg.account, (this.gl.get(leg.account) ?? 0) + leg.amountCents);
      }
    }
    this.postings.push(posting);
    return posting;
  }

  /** Most recent `n` statement lines (oldest first). */
  statement(accountId: string, n = 6): StatementLine[] {
    const list = this.lines.get(accountId) ?? [];
    return list.slice(Math.max(0, list.length - n)).map((l) => ({ ...l }));
  }

  /** Σ customer ledger balances (the bank's deposit liabilities to customers). */
  customerWealthCents(): Cents {
    let s = 0;
    for (const a of this.accounts.values()) s += a.ledgerCents;
    return s;
  }

  /** Σ of every balance (customer + GL). Always 0 in a correct double-entry ledger. */
  trialBalanceCents(): Cents {
    let s = this.customerWealthCents();
    for (const v of this.gl.values()) s += v;
    return s;
  }

  snapshot(): LedgerSnapshot {
    return {
      accounts: [...this.accounts.values()].map((a) => ({
        id: a.id,
        customerId: a.customerId,
        nickname: a.nickname,
        type: a.type,
        status: a.status,
        ledgerCents: a.ledgerCents,
        availableCents: this.available(a.id),
        holdsCents: this.holdsTotal(a.id),
        withdrawnTodayCents: a.withdrawnTodayCents,
      })),
      gl: Object.fromEntries(this.gl),
      postingCount: this.postings.length,
    };
  }
}
