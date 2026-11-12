import type { EventBus } from '../core/events';
import { formatCents } from '../core/money';
import {
  DENOMINATIONS,
  denomCents,
  type Card,
  type CardStatus,
  type CassetteId,
  type Cents,
  type CustomerPort,
  type DenomCounts,
  type DispensePlan,
  type HostMessageType,
  type HostRequest,
  type HostResponse,
  type MechanismDriver,
  type Note,
  type ResponseCode,
  type SimClock,
  type StatementLine,
  type Transaction,
  type TxnState,
  type TxnType,
  type ValidationResult,
  type AccountType,
} from '../core/types';
import type { Ledger } from '../banking/ledger';
import type { Network, NetResult } from '../banking/network';
import { cardTokenFor, makePinBlock } from '../banking/pin';
import { BANK_NAME } from '../banking/seed';
import type { CashInventory } from '../cash/inventory';
import { planDispense, suggestAmounts } from '../cash/dispense';
import type { FaultState } from '../faults/faultState';
import type { DeviceManager } from '../maintenance/devices';
import { dispenseLimits, type AtmConfig } from './config';
import { formatSimDate, formatSimDateTime, type Journal } from './journal';
import { transition } from './stateMachine';

export interface EngineDeps {
  bus: EventBus;
  clock: SimClock;
  mech: MechanismDriver;
  customer: CustomerPort;
  config: () => AtmConfig;
  ledger: Ledger;
  network: Network;
  inventory: CashInventory;
  devices: DeviceManager;
  faults: FaultState;
  journal: Journal;
}

export interface TxnResult {
  txn: Transaction;
  ok: boolean;
  /** Customer-facing message (friendly ATM wording). */
  message: string;
  receipt: string[];
}

export interface SessionAccount {
  id: string;
  type: AccountType;
  nickname: string;
}

export interface CardSession {
  card: Card;
  token: string;
  method: 'chip' | 'contactless';
  pinVerified: boolean;
  accounts: SessionAccount[];
  /** Card status when the session started (restored when a retained card is handed back). */
  prevStatus: CardStatus;
}

export interface RetainedCard {
  cardId: string;
  reason: string;
  time: number;
  prevStatus: CardStatus;
}

/** A message the host must eventually receive (reversal / completion) queued while the host was unreachable. */
export interface SafItem {
  txnId: string;
  kind: 'REVERSAL' | 'WITHDRAWAL_COMPLETION';
  request: HostRequest;
}

export interface PinResult {
  ok: boolean;
  code: ResponseCode;
  triesLeft: number;
  retained: boolean;
  accounts?: SessionAccount[];
  message: string;
}

/** Thrown inside a flow when power fails; the transaction has already been marked SUSPECT. */
export class PowerLossError extends Error {
  constructor() {
    super('Power lost');
    this.name = 'PowerLossError';
  }
}

/** Thrown when the system was reset while a flow was running (the old flow just stops). */
export class AbortedError extends Error {
  constructor() {
    super('Simulation reset');
    this.name = 'AbortedError';
  }
}

const NOT_CHARGED = 'Your account has not been charged.';

/** Friendly customer text for host response codes (ISO-8583-like, educational). */
export const RESPONSE_TEXT: Record<ResponseCode, string> = {
  '00': 'Approved.',
  '05': 'Sorry, your bank declined this transaction.',
  '14': 'Sorry, this card cannot be used.',
  '51': 'Sorry, there are not enough available funds in this account.',
  '54': 'Sorry, this card has expired.',
  '55': 'Incorrect PIN.',
  '57': 'Sorry, this transaction is not permitted on this account. Please contact your bank.',
  '61': 'Sorry, this amount is over your daily withdrawal limit.',
  '62': 'Sorry, this card is restricted. Please contact your bank.',
  '75': 'Too many incorrect PIN attempts.',
  '91': "Sorry, we can't reach your bank right now. Please try again later.",
  '68': 'Sorry, your bank did not respond in time.',
};

/**
 * Transaction engine: performs the physical and host work for each customer transaction and drives the
 * transaction state machine. It calls `clock.stage(label)` before each major observable step so the UI
 * timeline (and "step" mode) can follow along, and the MechanismDriver to animate what physically happens.
 */
export class TransactionEngine {
  session: CardSession | null = null;
  /** Card physically inside the motorised reader (contactless cards never enter the ATM). */
  cardInReader: string | null = null;
  powerLost = false;
  readonly retainedCards: RetainedCard[] = [];
  readonly saf: SafItem[] = [];
  private aborted = false;
  private txnSeq = 0;
  private stanSeq = 0;
  private msgSeq = 0;
  private escrow: { txn: Transaction; notes: Note[] } | null = null;

  constructor(private readonly d: EngineDeps) {}

  private get cfg(): AtmConfig {
    return this.d.config();
  }

  /** Stop any flow in progress at its next stage (used by AtmSystem.reset()). */
  abort(): void {
    this.aborted = true;
  }

  private async stage(label: string): Promise<void> {
    if (this.aborted) throw new AbortedError();
    await this.d.clock.stage(label);
    if (this.aborted) throw new AbortedError();
  }

  private cue(cue: 'card-light' | 'cash-light' | 'receipt-light' | 'deposit-light' | 'beep' | 'error-beep', on?: boolean): void {
    this.d.bus.emit('atm.cue', on === undefined ? { cue } : { cue, on });
  }

  private nextStan(): string {
    this.stanSeq = (this.stanSeq % 999_999) + 1;
    return String(this.stanSeq).padStart(6, '0');
  }

  // ───────────────────────────── transactions & state ─────────────────────────────

  private createTxn(type: TxnType, fields: Partial<Transaction> = {}): Transaction {
    const txn: Transaction = {
      id: `TXN-${String(++this.txnSeq).padStart(6, '0')}`,
      type,
      stan: this.nextStan(),
      cardId: this.session?.card.id ?? '',
      requestedCents: 0,
      presentedCents: 0,
      collectedCents: 0,
      postedCents: 0,
      state: 'CREATED',
      history: [],
      createdAt: this.d.clock.now(),
      ...fields,
    };
    this.d.journal.addTransaction(txn);
    const amt = txn.requestedCents ? ` ${formatCents(txn.requestedCents)}` : '';
    const acct = txn.accountId ? ` account ${txn.accountId}` : '';
    this.d.journal.log('TXN', `${type} started${amt}${acct} (STAN ${txn.stan})`, txn.id);
    this.d.bus.emit('txn.created', { txn });
    return txn;
  }

  private setState(txn: Transaction, to: TxnState, note: string): void {
    const from = txn.state;
    transition(txn, to, note, this.d.clock.now());
    this.d.journal.log('TXN', `${from} → ${to}: ${note}`, txn.id);
    this.d.bus.emit('txn.state', { txn, from, to, note });
  }

  private requireSession(): CardSession {
    if (this.powerLost) throw new PowerLossError();
    if (!this.session || !this.session.pinVerified) throw new Error('No verified card session');
    return this.session;
  }

  private request(type: HostMessageType, fields: Partial<HostRequest> & { stan?: string }): HostRequest {
    return {
      msgId: `MSG-${String(++this.msgSeq).padStart(6, '0')}`,
      type,
      stan: fields.stan ?? this.nextStan(),
      terminalId: this.cfg.terminalId,
      time: this.d.clock.now(),
      cardToken: this.session?.token ?? '',
      ...fields,
    };
  }

  /** Send a message through the network, journaling both directions. */
  private async sendToHost(req: HostRequest, txnId?: string): Promise<NetResult> {
    const amt = req.amountCents !== undefined ? ` ${formatCents(req.amountCents)}` : '';
    const orig = req.originalStan ? ` (original STAN ${req.originalStan})` : '';
    this.d.journal.log('HOST', `→ ${req.type} STAN ${req.stan}${amt}${req.accountId ? ' ' + req.accountId : ''}${orig}`, txnId);
    this.d.devices.metric('network', 'messages', 1);
    const res = await this.d.network.send(req);
    if (res.timedOut) {
      this.d.journal.log('HOST', `✕ no response to ${req.type} STAN ${req.stan} within ${this.cfg.hostTimeoutMs} ms (timeout)`, txnId);
    } else if (res.response) {
      this.d.journal.log('HOST', `← ${res.response.code} ${res.response.text}`, txnId);
      if (res.response.code === '91') {
        this.d.devices.metric('host', 'declines91', 1);
        this.d.devices.set('host', 'OFFLINE', 'Switch reports issuer unavailable (91)');
        this.d.mech.setComponentAlert('comms', 'FAULT');
      }
    }
    return res;
  }

  private declineMessage(code: ResponseCode, financial: boolean): string {
    return financial ? `${RESPONSE_TEXT[code]} ${NOT_CHARGED}` : RESPONSE_TEXT[code];
  }

  /**
   * Common authorisation step: AUTH_PENDING → AUTHORIZED, or DECLINED, or TIMED_OUT → reversal.
   * Returns the host response when approved, otherwise a finished TxnResult.
   */
  private async authorize(txn: Transaction, req: HostRequest, financial: boolean): Promise<{ ok: true; res: HostResponse } | { ok: false; result: TxnResult }> {
    if (this.saf.length) await this.flushStoreAndForward();
    this.setState(txn, 'AUTH_PENDING', `${req.type} sent to bank`);
    const net = await this.sendToHost(req, txn.id);
    if (net.timedOut || !net.response) {
      txn.responseCode = '68';
      this.setState(txn, 'TIMED_OUT', `No response within ${this.cfg.hostTimeoutMs} ms — the bank may have approved it, so the ATM must reverse`);
      this.cue('error-beep');
      await this.reverse(txn, 'Response timeout (68)', 0);
      const message = `${RESPONSE_TEXT['68']} ${financial ? NOT_CHARGED : ''}`.trim();
      txn.outcome = 'Timed out waiting for the bank; reversal sent so any hold the bank placed is released.';
      return { ok: false, result: { txn, ok: false, message, receipt: this.receipt(txn, ['NO RESPONSE FROM BANK', 'TRANSACTION CANCELLED']) } };
    }
    const res = net.response;
    txn.responseCode = res.code;
    if (!res.approved) {
      this.setState(txn, 'DECLINED', `Declined ${res.code}: ${res.text}`);
      txn.outcome = `Declined by ${res.code === '91' ? 'the network switch' : 'the bank'} with code ${res.code}. Nothing was held or posted.`;
      this.cue('error-beep');
      return { ok: false, result: { txn, ok: false, message: this.declineMessage(res.code, financial), receipt: this.receipt(txn, [`DECLINED ${res.code}`]) } };
    }
    if (res.authCode) txn.authCode = res.authCode;
    this.setState(txn, 'AUTHORIZED', res.text);
    return { ok: true, res };
  }

  /** Send a REVERSAL for the transaction's original STAN; queue it (store-and-forward) if it cannot be delivered. */
  private async reverse(txn: Transaction, reason: string, dispensedCents: Cents): Promise<void> {
    this.setState(txn, 'REVERSAL_PENDING', `Reversal required: ${reason}`);
    await this.stage('Send reversal to bank (release hold)');
    const req = this.request('REVERSAL', {
      accountId: txn.accountId,
      amountCents: txn.requestedCents,
      originalStan: txn.stan,
      authCode: txn.authCode,
      reversalReason: reason,
      dispensedCents,
      txnId: txn.id,
    });
    const net = await this.sendToHost(req, txn.id);
    if (net.response?.approved) {
      this.setState(txn, 'REVERSED', net.response.text);
      txn.postedCents = -dispensedCents;
    } else {
      this.saf.push({ txnId: txn.id, kind: 'REVERSAL', request: req });
      this.d.journal.log('HOST', 'Reversal not delivered — queued for store-and-forward; it will be resent when the host is reachable', txn.id);
    }
  }

  /** Confirm to the host that the customer took the cash; this is the moment the ledger is debited. */
  private async complete(txn: Transaction, dispensedCents: Cents): Promise<HostResponse | undefined> {
    const req = this.request('WITHDRAWAL_COMPLETION', {
      accountId: txn.accountId,
      amountCents: txn.requestedCents,
      originalStan: txn.stan,
      authCode: txn.authCode,
      dispensedCents,
      txnId: txn.id,
    });
    const net = await this.sendToHost(req, txn.id);
    if (net.response?.approved) {
      txn.postedCents = -dispensedCents;
      this.setState(txn, 'COMPLETED', net.response.text);
      return net.response;
    }
    this.saf.push({ txnId: txn.id, kind: 'WITHDRAWAL_COMPLETION', request: req });
    this.d.journal.log('HOST', 'Completion not delivered — queued for store-and-forward (hold stays until it is delivered)', txn.id);
    return undefined;
  }

  /** Re-send queued reversals/completions. Called before new authorisations and when the host link is reset. */
  async flushStoreAndForward(): Promise<number> {
    let delivered = 0;
    for (const item of [...this.saf]) {
      const txn = this.d.journal.findTransaction(item.txnId);
      const req = { ...item.request, msgId: `MSG-${String(++this.msgSeq).padStart(6, '0')}`, time: this.d.clock.now() };
      this.d.journal.log('HOST', `Store-and-forward: resending ${item.kind}`, item.txnId);
      const net = await this.sendToHost(req, item.txnId);
      if (!net.response?.approved) break;
      this.saf.splice(this.saf.indexOf(item), 1);
      delivered++;
      if (txn) {
        if (item.kind === 'REVERSAL' && txn.state === 'REVERSAL_PENDING') {
          this.setState(txn, 'REVERSED', `${net.response.text} (store-and-forward)`);
          txn.postedCents = -(item.request.dispensedCents ?? 0);
        } else if (item.kind === 'WITHDRAWAL_COMPLETION' && txn.state === 'COLLECTED') {
          txn.postedCents = -(item.request.dispensedCents ?? 0);
          this.setState(txn, 'COMPLETED', `${net.response.text} (store-and-forward)`);
        }
      }
    }
    return delivered;
  }

  // ───────────────────────────── receipts ─────────────────────────────

  private receipt(txn: Transaction, body: string[]): string[] {
    const s = this.session;
    return [
      BANK_NAME.toUpperCase(),
      'TRAINING RECEIPT - NOT A REAL TRANSACTION',
      formatSimDateTime(this.d.clock.now()),
      `TERMINAL ${this.cfg.terminalId}`,
      `CARD ${s ? s.card.maskedNumber : '-'}`,
      `${txn.type.replace('_', ' ')}${txn.accountId ? '  ACCT ••' + txn.accountId.slice(-4) : ''}`,
      ...body,
      `STAN ${txn.stan}  AUTH ${txn.authCode ?? '------'}`,
      `REF ${txn.id}`,
    ];
  }

  private accountLabel(id: string): string {
    const a = this.d.ledger.accounts.get(id);
    return a ? `${a.nickname} (••${id.slice(-4)})` : id;
  }

  // ───────────────────────────── card & PIN ─────────────────────────────

  async readCard(cardId: string, method: 'chip' | 'contactless'): Promise<{ ok: boolean; reason?: string }> {
    if (this.powerLost) return { ok: false, reason: 'The ATM is temporarily out of service.' };
    if (this.session) return { ok: false, reason: 'A card is already in use.' };
    const card = this.d.ledger.cards.get(cardId);
    if (!card) return { ok: false, reason: 'Sorry, this card is not recognised.' };
    if (card.status === 'RETAINED') return { ok: false, reason: 'That card is being held inside the ATM.' };
    if (method === 'chip' && !this.d.devices.isOk('cardReader')) {
      this.d.journal.log('DEVICE', `Card insertion refused: ${this.d.devices.get('cardReader').detail}`);
      this.d.mech.setComponentAlert('card-reader', 'FAULT');
      this.cue('error-beep');
      return { ok: false, reason: "Sorry, we can't read inserted cards right now. Please tap your card or use another ATM." };
    }
    if (method === 'contactless') {
      if (!card.contactless) return { ok: false, reason: 'This card does not support contactless. Please insert it instead.' };
      if (!this.d.devices.isOk('contactless')) return { ok: false, reason: 'Contactless is unavailable. Please insert your card.' };
    }
    this.cue('card-light', false);
    await this.stage(method === 'chip' ? 'Card inserted — read chip' : 'Card tapped — read contactless');
    await this.d.mech.cardIn(method);
    this.d.devices.metric(method === 'chip' ? 'cardReader' : 'contactless', method === 'chip' ? 'reads' : 'taps', 1);
    if (method === 'chip') this.cardInReader = cardId;
    this.session = { card, token: cardTokenFor(cardId), method, pinVerified: false, accounts: [], prevStatus: card.status };
    this.d.journal.log('SESSION', `Card ${card.maskedNumber} read by ${method === 'chip' ? 'chip reader' : 'contactless reader'}`);
    this.d.journal.auditLog('CUSTOMER', method === 'chip' ? 'Inserted card' : 'Tapped card', card.maskedNumber);
    return { ok: true };
  }

  async verifyPin(pin: string): Promise<PinResult> {
    if (this.powerLost) throw new PowerLossError();
    const s = this.session;
    if (!s) throw new Error('No card session');
    await this.stage('Encrypt PIN and verify with bank');
    const stan = this.nextStan();
    const pinBlock = makePinBlock(pin, s.token, stan);
    this.d.journal.log('SESSION', `PIN entered (${pin.length} digits) and encrypted into simulated PIN block — the clear PIN never leaves the PIN pad`);
    const net = await this.sendToHost(this.request('CARD_AUTH', { stan, pinBlock }));
    if (net.timedOut || !net.response) {
      return { ok: false, code: '68', triesLeft: s.card.pinTriesRemaining, retained: false, message: RESPONSE_TEXT['68'] };
    }
    const r = net.response;
    if (r.approved) {
      s.pinVerified = true;
      s.accounts = r.accounts ?? [];
      return { ok: true, code: '00', triesLeft: s.card.pinTriesRemaining, retained: false, accounts: s.accounts, message: 'PIN accepted.' };
    }
    this.cue('error-beep');
    if (r.code === '75') {
      const retained = this.cardInReader === s.card.id;
      if (retained) await this.retainCard('PIN tries exceeded (75)');
      else this.endSession('PIN tries exceeded (contactless card cannot be retained)');
      return { ok: false, code: '75', triesLeft: 0, retained, message: `${RESPONSE_TEXT['75']} ${retained ? 'Your card has been retained. Please contact your bank.' : 'Please contact your bank.'}` };
    }
    if (r.code === '55') {
      const n = s.card.pinTriesRemaining;
      return { ok: false, code: '55', triesLeft: n, retained: false, message: `Incorrect PIN. ${n} ${n === 1 ? 'try' : 'tries'} remaining.` };
    }
    return { ok: false, code: r.code, triesLeft: s.card.pinTriesRemaining, retained: false, message: RESPONSE_TEXT[r.code] };
  }

  /** Keep the card in the ATM's capture bin (marks it RETAINED until an operator returns it). */
  private async retainCard(reason: string): Promise<void> {
    const s = this.session;
    const cardId = this.cardInReader;
    if (!cardId) return;
    await this.stage('Retain card');
    await this.d.mech.cardRetain();
    const card = this.d.ledger.cards.get(cardId)!;
    this.retainedCards.push({ cardId, reason, time: this.d.clock.now(), prevStatus: s?.card.id === cardId ? s.prevStatus : card.status });
    card.status = 'RETAINED';
    this.cardInReader = null;
    this.session = null;
    this.d.devices.metric('cardReader', 'retained', 1);
    this.d.journal.log('SESSION', `Card ${card.maskedNumber} RETAINED: ${reason}`);
    this.d.journal.auditLog('ATM', 'Retained card', `${card.maskedNumber}: ${reason}`);
  }

  private endSession(why: string): void {
    if (this.session) this.d.journal.log('SESSION', `Session ended: ${why}`);
    this.session = null;
  }

  /** Return the card (or finish a contactless session). Retains the card if it is not taken in time. */
  async ejectCard(): Promise<'taken' | 'retained'> {
    const s = this.session;
    if (!s) return 'taken';
    if (s.method === 'contactless' || this.cardInReader !== s.card.id) {
      this.endSession('contactless card — nothing to return');
      return 'taken';
    }
    await this.stage('Eject card');
    await this.d.mech.cardEject();
    this.cue('card-light', true);
    this.cue('beep');
    await this.stage('Wait for customer to take card');
    const r = await this.d.customer.awaitCardTaken(this.cfg.cardTakeTimeoutMs);
    this.cue('card-light', false);
    if (r === 'taken') {
      this.cardInReader = null;
      this.d.journal.auditLog('CUSTOMER', 'Took card', s.card.maskedNumber);
      this.endSession('card returned to customer');
      return 'taken';
    }
    await this.retainCard('Card not taken within time-out');
    return 'retained';
  }

  // ───────────────────────────── non-cash transactions ─────────────────────────────

  async balance(accountId: string): Promise<TxnResult> {
    this.requireSession();
    const txn = this.createTxn('BALANCE', { accountId });
    await this.stage('Request balance from bank');
    const a = await this.authorize(txn, this.request('BALANCE_INQUIRY', { stan: txn.stan, accountId, txnId: txn.id }), false);
    if (!a.ok) return a.result;
    this.setState(txn, 'COMPLETED', 'Balance displayed');
    txn.outcome = 'Balance inquiry completed (no money moves).';
    const lines = [`Ledger balance:    ${formatCents(a.res.ledgerCents ?? 0)}`, `Available balance: ${formatCents(a.res.availableCents ?? 0)}`];
    return { txn, ok: true, message: `${this.accountLabel(accountId)}\n${lines.join('\n')}`, receipt: this.receipt(txn, lines) };
  }

  async miniStatement(accountId: string): Promise<TxnResult & { lines: StatementLine[] }> {
    this.requireSession();
    const txn = this.createTxn('MINI_STATEMENT', { accountId });
    await this.stage('Request mini statement from bank');
    const a = await this.authorize(txn, this.request('MINI_STATEMENT', { stan: txn.stan, accountId, txnId: txn.id }), false);
    if (!a.ok) return { ...a.result, lines: [] };
    this.setState(txn, 'COMPLETED', 'Statement displayed');
    txn.outcome = 'Mini statement shown (no money moves).';
    const lines = a.res.statement ?? [];
    const text = lines.map((l) => `${formatSimDate(l.time)} ${l.description.slice(0, 22).padEnd(22)} ${formatCents(l.amountCents).padStart(11)}`);
    text.push(`Available: ${formatCents(a.res.availableCents ?? 0)}`);
    return { txn, ok: true, message: text.join('\n'), receipt: this.receipt(txn, text), lines };
  }

  async transfer(fromId: string, toId: string, amountCents: Cents): Promise<TxnResult> {
    this.requireSession();
    const txn = this.createTxn('TRANSFER', { accountId: fromId, toAccountId: toId, requestedCents: amountCents });
    await this.stage('Validate amount');
    if (!Number.isInteger(amountCents) || amountCents <= 0 || fromId === toId) {
      this.setState(txn, 'CANCELLED', 'Invalid transfer request');
      return { txn, ok: false, message: 'Please enter a valid amount.', receipt: [] };
    }
    await this.stage('Request transfer from bank');
    const a = await this.authorize(txn, this.request('TRANSFER', { stan: txn.stan, accountId: fromId, toAccountId: toId, amountCents, txnId: txn.id }), true);
    if (!a.ok) return a.result;
    txn.postedCents = -amountCents;
    this.setState(txn, 'COMPLETED', 'Transfer posted (both legs)');
    txn.outcome = `Transferred ${formatCents(amountCents)} from ${fromId} to ${toId}.`;
    const body = [`AMOUNT ${formatCents(amountCents)}`, `FROM ••${fromId.slice(-4)}  TO ••${toId.slice(-4)}`, `AVAILABLE ${formatCents(a.res.availableCents ?? 0)}`];
    return {
      txn,
      ok: true,
      message: `Transfer complete. ${formatCents(amountCents)} moved from ${this.accountLabel(fromId)} to ${this.accountLabel(toId)}.`,
      receipt: this.receipt(txn, body),
    };
  }

  // ───────────────────────────── deposits ─────────────────────────────

  /** Customer feeds notes from the wallet into the deposit slot; valid notes wait in escrow. */
  async depositIntake(counts: DenomCounts): Promise<{ escrow: DenomCounts; returned: number; totalCents: Cents }> {
    this.requireSession();
    if (this.escrow) throw new Error('Deposit already in escrow');
    if (!this.d.devices.isOk('depositModule')) throw new Error('Deposit module unavailable');
    const notes: Note[] = [];
    for (const d of DENOMINATIONS) {
      const want = counts[d] ?? 0;
      const have = this.d.inventory.notesAt('customer').filter((n) => n.denom === d);
      notes.push(...have.slice(have.length - Math.min(want, have.length)));
    }
    if (notes.length === 0) return { escrow: {}, returned: 0, totalCents: 0 };
    const txn = this.createTxn('DEPOSIT');
    this.cue('deposit-light', true);
    await this.stage('Open deposit slot and accept notes');
    for (const n of notes) this.d.inventory.move(n, 'escrow');
    await this.d.mech.depositIntake(notes);
    this.cue('deposit-light', false);
    await this.stage('Validate deposited notes');
    const bad = notes.filter((n) => n.suspect);
    const good = notes.filter((n) => !n.suspect);
    if (bad.length) {
      for (const n of bad) this.d.inventory.move(n, 'customer');
      await this.d.mech.depositReturn(bad);
      this.d.devices.metric('depositModule', 'notesReturned', bad.length);
      this.d.journal.log('CASH', `${bad.length} note(s) failed validation and were returned to the customer`, txn.id);
    }
    const total = good.reduce((s, n) => s + denomCents(n.denom), 0);
    txn.requestedCents = total;
    const escrow: DenomCounts = {};
    for (const n of good) escrow[n.denom] = (escrow[n.denom] ?? 0) + 1;
    if (!good.length) {
      this.setState(txn, 'CANCELLED', 'No valid notes inserted');
    } else {
      this.escrow = { txn, notes: good };
      this.setState(txn, 'ESCROWED', `${good.length} note(s) totalling ${formatCents(total)} held in escrow awaiting confirmation`);
    }
    this.d.inventory.changed();
    return { escrow, returned: bad.length, totalCents: total };
  }

  async depositConfirm(accountId: string): Promise<TxnResult> {
    this.requireSession();
    const e = this.escrow;
    if (!e) throw new Error('Nothing in escrow');
    const txn = e.txn;
    txn.accountId = accountId;
    await this.stage('Send deposit to bank');
    const a = await this.authorize(txn, this.request('DEPOSIT', { stan: txn.stan, accountId, amountCents: txn.requestedCents, txnId: txn.id }), false);
    if (!a.ok) {
      await this.returnEscrow();
      return { ...a.result, message: `${a.result.message} Please take your notes.` };
    }
    await this.stage('Store notes in deposit cassette');
    for (const n of e.notes) this.d.inventory.move(n, 'deposit');
    await this.d.mech.depositStore(e.notes);
    this.d.devices.metric('depositModule', 'notesAccepted', e.notes.length);
    this.escrow = null;
    txn.postedCents = txn.requestedCents;
    this.setState(txn, 'COMPLETED', 'Notes stored and account credited');
    txn.outcome = `Deposited ${formatCents(txn.requestedCents)} into ${accountId}.`;
    this.d.inventory.changed();
    const body = [`DEPOSIT ${formatCents(txn.requestedCents)}`, `AVAILABLE ${formatCents(a.res.availableCents ?? 0)}`];
    return { txn, ok: true, message: `Deposit complete. ${formatCents(txn.requestedCents)} added to ${this.accountLabel(accountId)}.`, receipt: this.receipt(txn, body) };
  }

  async depositCancel(): Promise<void> {
    const e = this.escrow;
    if (!e) return;
    await this.returnEscrow();
    this.setState(e.txn, 'CANCELLED', 'Customer cancelled; notes returned');
    e.txn.outcome = 'Deposit cancelled; all notes returned to the customer.';
  }

  private async returnEscrow(): Promise<void> {
    const e = this.escrow;
    if (!e) return;
    await this.stage('Return notes to customer');
    for (const n of e.notes) this.d.inventory.move(n, 'customer');
    await this.d.mech.depositReturn(e.notes);
    this.escrow = null;
    this.d.inventory.changed();
  }

  get hasEscrow(): boolean {
    return this.escrow !== null;
  }

  // ───────────────────────────── withdrawal ─────────────────────────────

  async withdraw(accountId: string, amountCents: Cents): Promise<TxnResult> {
    this.requireSession();
    const cfg = this.cfg;
    const txn = this.createTxn('WITHDRAWAL', { accountId, requestedCents: amountCents });
    try {
      // 1–2. Validate amount and verify that the loaded notes can make it (before bothering the bank).
      await this.stage('Validate amount');
      if (!this.d.devices.isOk('dispenser')) {
        this.setState(txn, 'CANCELLED', `Dispenser unavailable: ${this.d.devices.get('dispenser').detail}`);
        return { txn, ok: false, message: 'Sorry, cash withdrawals are unavailable at this ATM right now.', receipt: [] };
      }
      const limits = dispenseLimits(cfg);
      const planned = planDispense(amountCents, this.d.inventory.cassettes, cfg.strategy, limits);
      if (!planned.ok && planned.reason === 'UNSUPPORTED_AMOUNT') {
        this.d.faults.consume('unsupported-amount');
        this.setState(txn, 'CANCELLED', `Unsupported amount: ${planned.detail}`);
        txn.outcome = 'Rejected locally by the ATM before contacting the bank.';
        return { txn, ok: false, message: `Sorry, we can't dispense that amount. ${planned.detail}`, receipt: [] };
      }
      await this.stage('Plan notes from cassettes');
      if (!planned.ok) {
        const sugg = suggestAmounts(amountCents, this.d.inventory.cassettes, cfg.strategy, limits);
        const hint = sugg.length ? ` You could try ${sugg.map((s) => formatCents(s).replace('.00', '')).join(' or ')}.` : '';
        if (planned.reason === 'NO_FEASIBLE_COMBINATION') this.d.faults.consume('no-feasible-combination');
        this.setState(txn, 'CANCELLED', `${planned.reason}: ${planned.detail}`);
        txn.outcome = 'Rejected locally by the ATM before contacting the bank.';
        const lead =
          planned.reason === 'INSUFFICIENT_ATM_CASH'
            ? 'Sorry, this ATM cannot dispense that amount right now.'
            : planned.reason === 'TOO_MANY_NOTES'
              ? 'Sorry, that amount needs too many notes.'
              : "Sorry, this ATM can't make that exact amount with the notes it has.";
        return { txn, ok: false, message: `${lead} ${planned.detail}${hint}`, receipt: [] };
      }
      const plan = planned.plan;
      txn.plan = plan;
      this.d.journal.log('CASH', `Dispense plan (${cfg.strategy}): ${plan.picks.map((p) => `${p.count}×$${p.denom} from ${p.cassette}`).join(', ')}`, txn.id);

      // 3. Authorise: the bank places a HOLD; nothing is posted yet.
      await this.stage('Request authorization (place hold)');
      const a = await this.authorize(txn, this.request('WITHDRAWAL_AUTH', { stan: txn.stan, accountId, amountCents, txnId: txn.id }), true);
      if (!a.ok) {
        if (a.result.txn.responseCode === '51') this.d.faults.consume('insufficient-funds');
        return a.result;
      }

      // 4–8. Pick, validate and stack notes cassette by cassette.
      this.setState(txn, 'DISPENSING', `Dispensing ${plan.totalNotes} note(s)`);
      const dispensed = await this.dispense(txn, plan);
      if (!dispensed.ok) {
        this.setState(txn, 'DISPENSE_FAILED', dispensed.reason);
        this.cue('error-beep');
        this.d.inventory.changed();
        await this.stage('Dispense failed — reverse authorization');
        await this.reverse(txn, dispensed.reason, 0);
        txn.outcome = `${dispensed.reason}. No cash was presented; the hold was reversed. Notes remain in the dispenser until the operator clears the jam.`;
        return { txn, ok: false, message: `Sorry, we could not dispense your cash. ${NOT_CHARGED}`, receipt: this.receipt(txn, ['DISPENSE FAILED', 'NO CASH DISPENSED', 'AUTHORIZATION REVERSED']) };
      }

      // 9. Present the bundle.
      await this.stage('Present cash');
      const notes = [...this.d.inventory.notesAt('stacker')];
      for (const n of notes) this.d.inventory.move(n, 'presented');
      await this.d.mech.presentBundle(notes);
      txn.presentedCents = notes.reduce((s, n) => s + denomCents(n.denom), 0);
      this.d.devices.metric('dispenser', 'dispenses', 1);
      this.d.inventory.changed();
      this.setState(txn, 'PRESENTED', `${notes.length} note(s) (${formatCents(txn.presentedCents)}) presented at the shutter`);
      this.cue('cash-light', true);
      this.cue('beep');

      // 10. Wait for the customer.
      await this.stage('Wait for customer to take cash');
      let taken: 'collected' | 'timeout';
      if (this.d.faults.consume('cash-not-collected')) {
        this.d.journal.log('FAULT', 'Training fault: the customer walks away without taking the cash', txn.id);
        await this.d.clock.wait(cfg.cashTakeTimeoutMs);
        taken = 'timeout';
      } else {
        taken = await this.d.customer.awaitCashCollection(cfg.cashTakeTimeoutMs);
      }
      this.cue('cash-light', false);

      if (taken === 'collected') {
        for (const n of notes) this.d.inventory.move(n, 'customer');
        await this.d.mech.bundleCollected(notes);
        txn.collectedCents = txn.presentedCents;
        this.d.inventory.changed();
        this.d.journal.auditLog('CUSTOMER', 'Took cash', formatCents(txn.collectedCents));
        this.setState(txn, 'COLLECTED', 'Customer took the cash');
        // 11. Completion: NOW the bank posts the debit and releases the hold.
        await this.stage('Confirm withdrawal to bank (post debit)');
        const res = await this.complete(txn, txn.collectedCents);
        txn.outcome = res ? `Dispensed and posted ${formatCents(txn.collectedCents)}.` : 'Cash taken; completion queued for store-and-forward.';
        const avail = res?.availableCents;
        const body = [`WITHDRAWAL ${formatCents(txn.collectedCents)}`, ...(avail !== undefined ? [`AVAILABLE ${formatCents(avail)}`] : [])];
        return {
          txn,
          ok: true,
          message: `Withdrawal complete. ${formatCents(txn.collectedCents)} from ${this.accountLabel(accountId)}.${avail !== undefined ? ` Available balance: ${formatCents(avail)}.` : ''}`,
          receipt: this.receipt(txn, body),
        };
      }

      // 12. Timeout: retract the bundle into the retract bin.
      await this.stage('Retract uncollected cash');
      for (const n of notes) this.d.inventory.move(n, 'retract');
      await this.d.mech.retractBundle(notes);
      this.d.devices.metric('dispenser', 'retracts', 1);
      this.d.inventory.changed();
      this.setState(txn, 'RETRACTED', `Cash not taken within ${cfg.cashTakeTimeoutMs / 1000}s; ${notes.length} note(s) retracted`);
      this.cue('error-beep');
      if (cfg.reversalOnRetract) {
        await this.reverse(txn, 'Cash not collected — retracted', 0);
        txn.outcome = 'Cash retracted into the retract bin and the authorization reversed (generic policy).';
        return { txn, ok: false, message: `Your cash was not taken and has been retained by the ATM for your security. ${NOT_CHARGED}`, receipt: this.receipt(txn, ['CASH RETRACTED', 'AUTHORIZATION REVERSED']) };
      }
      await this.stage('Confirm withdrawal to bank (post debit)');
      await this.complete(txn, txn.presentedCents);
      txn.outcome = 'Cash retracted; bank policy posts the withdrawal anyway (customer must raise a claim).';
      return { txn, ok: false, message: 'Your cash was not taken and has been retained by the ATM. Please contact your bank.', receipt: this.receipt(txn, ['CASH RETRACTED']) };
    } catch (err) {
      if (err instanceof PowerLossError) {
        return { txn, ok: false, message: 'Temporarily out of service.', receipt: [] };
      }
      throw err;
    }
  }

  /** Pick → validate → stack each planned note. Returns ok:false on jam / pick failure (notes stay inside). */
  private async dispense(txn: Transaction, plan: DispensePlan): Promise<{ ok: true } | { ok: false; reason: string }> {
    let stacked = 0;
    for (const pick of plan.picks) {
      await this.stage(`Pick ${pick.count} × $${pick.denom} from cassette ${pick.cassette}`);
      let done = 0;
      while (done < pick.count) {
        if (this.d.faults.isArmed('pick-failure')) return this.pickFailure(txn, pick.cassette, 'picker rollers slipped on 3 retries');
        const note = this.d.inventory.takeFromCassette(pick.cassette);
        if (!note) return this.pickFailure(txn, pick.cassette, 'cassette physically empty although the counter says otherwise');
        await this.d.mech.pickNote(note, pick.cassette);
        this.d.devices.metric('dispenser', 'picks', 1);

        const result: ValidationResult = this.d.faults.consume('note-rejected') ? 'DOUBLE' : 'OK';
        await this.d.mech.validateNote(note, result);
        if (result !== 'OK') {
          await this.stage('Divert rejected note to reject cassette');
          this.d.inventory.move(note, 'reject');
          await this.d.mech.divertToReject(note);
          this.d.devices.metric('dispenser', 'rejects', 1);
          this.d.journal.log('CASH', `Note ${note.serial} failed validation (${result}) → reject cassette; picking a replacement from cassette ${pick.cassette}`, txn.id);
          this.d.inventory.changed();
          continue;
        }

        if (this.d.faults.isArmed('cash-jam') && (stacked >= 1 || plan.totalNotes === 1)) {
          await this.d.mech.jamNote(note);
          this.d.devices.set('dispenser', 'FAULT', 'Cash jam in transport');
          this.d.mech.setComponentAlert('transport', 'FAULT');
          this.d.mech.setComponentAlert('dispenser', 'FAULT');
          await this.stage('Cash jam in transport');
          this.d.journal.log('FAULT', `CASH JAM: note ${note.serial} stopped in the transport; ${stacked} note(s) left in the stacker`, txn.id);
          return { ok: false, reason: 'Cash jam in transport' };
        }

        this.d.inventory.move(note, 'stacker');
        await this.d.mech.stackNote(note);
        stacked++;
        done++;
        this.d.inventory.changed();

        if (this.d.faults.isArmed('power-loss')) await this.powerFail(txn);
      }
    }
    return { ok: true };
  }

  private async pickFailure(txn: Transaction, cassette: CassetteId, why: string): Promise<{ ok: false; reason: string }> {
    this.d.inventory.cassettes[cassette].status = 'FAULT';
    this.d.devices.set('dispenser', 'FAULT', `Pick failure on cassette ${cassette}`);
    this.d.mech.setComponentAlert('picker-rollers', 'FAULT');
    this.d.mech.setComponentAlert(`cassette-${cassette}`, 'FAULT');
    await this.stage(`Pick failure — cassette ${cassette}`);
    this.d.journal.log('FAULT', `PICK FAILURE on cassette ${cassette}: ${why}`, txn.id);
    return { ok: false, reason: `Pick failure on cassette ${cassette}` };
  }

  private async powerFail(txn: Transaction): Promise<never> {
    this.powerLost = true;
    this.d.devices.metric('power', 'outages', 1);
    this.d.devices.set('power', 'OFFLINE', 'Mains power lost');
    this.d.mech.setComponentAlert('power-supply', 'FAULT');
    this.d.journal.log('FAULT', 'POWER FAILURE during dispensing — the ATM cannot know what physically happened', txn.id);
    this.setState(txn, 'SUSPECT', 'Power lost mid-dispense; physical outcome unknown');
    txn.outcome = 'Power lost mid-dispense. Transaction SUSPECT until power is restored and it is resolved.';
    await this.d.clock.stage('Power failure');
    throw new PowerLossError();
  }

  /**
   * Restart after a power failure (operator action). Purges notes left in the dispenser to the reject
   * cassette, resolves SUSPECT transactions (reversed if no cash was taken) and retains any card in the reader.
   */
  async recoverAfterPower(): Promise<string[]> {
    const out: string[] = [];
    if (!this.powerLost) return out;
    this.powerLost = false;
    await this.stage('Restore power — restart ATM');
    this.d.devices.set('power', 'OK', 'Mains power restored');
    this.d.mech.setComponentAlert('power-supply', 'OK');
    const purged = await this.purgeDispenser('Power-up purge');
    if (purged) out.push(`${purged} note(s) purged to the reject cassette`);
    for (const txn of this.d.journal.transactions.filter((t) => t.state === 'SUSPECT')) {
      if (txn.collectedCents > 0) {
        this.d.journal.log('TXN', 'Recovery: cash was collected before the outage → send completion', txn.id);
        await this.complete(txn, txn.collectedCents);
        out.push(`${txn.id} completed (cash had been taken)`);
      } else {
        this.d.journal.log('TXN', 'Recovery: no cash was presented → reverse the authorization', txn.id);
        await this.reverse(txn, 'Power failure before cash was presented', 0);
        txn.outcome = 'Power failed mid-dispense; on recovery notes were purged to reject and the authorization reversed.';
        out.push(`${txn.id} reversed (no cash presented)`);
      }
    }
    if (this.cardInReader) {
      const id = this.cardInReader;
      await this.retainCard('Power failure during transaction');
      out.push(`Card ${this.d.ledger.cards.get(id)?.maskedNumber} retained`);
    }
    this.session = null;
    return out;
  }

  /** Move every note left in transport / stacker / presenter to the reject cassette. */
  async purgeDispenser(why: string): Promise<number> {
    const notes = [...this.d.inventory.notesAt('transport'), ...this.d.inventory.notesAt('stacker'), ...this.d.inventory.notesAt('presented')];
    if (!notes.length) return 0;
    await this.stage('Purge notes to reject cassette');
    for (const n of notes) this.d.inventory.move(n, 'reject');
    await this.d.mech.purge(notes, 'reject');
    this.d.journal.log('CASH', `${why}: ${notes.length} note(s) (${formatCents(notes.reduce((s, n) => s + denomCents(n.denom), 0))}) purged to the reject cassette`);
    this.d.inventory.changed();
    return notes.length;
  }

  // ───────────────────────────── printer ─────────────────────────────

  async printReceipt(lines: string[]): Promise<boolean> {
    if (!this.d.devices.isOk('printer') || this.powerLost) return false;
    await this.stage('Print receipt');
    this.cue('receipt-light', true);
    await this.d.mech.printReceipt(lines);
    const pct = Math.max(0, (this.d.devices.get('printer').metrics.paperPct ?? 100) - 1);
    this.d.devices.metric('printer', 'paperPct', pct, true);
    this.d.devices.metric('printer', 'receipts', 1);
    if (pct === 0) this.d.devices.set('printer', 'FAULT', 'Paper out');
    else if (pct <= 10) this.d.devices.set('printer', 'WARNING', `Paper low (${pct}%)`);
    this.cue('receipt-light', false);
    return true;
  }
}
