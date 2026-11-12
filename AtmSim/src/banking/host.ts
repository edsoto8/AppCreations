import type { Card, Cents, HostRequest, HostResponse, ResponseCode } from '../core/types';
import type { Rng } from '../core/rng';
import { formatCents } from '../core/money';
import { GL_ATM_CASH, type Ledger } from './ledger';
import { cardTokenFor, pinBlockFromHash } from './pin';

/** What the host remembers about each withdrawal authorisation, keyed by the request's STAN. */
export interface AuthRecord {
  stan: string;
  txnId: string;
  accountId: string;
  amountCents: Cents;
  holdId: string;
  authCode: string;
  status: 'HELD' | 'COMPLETED' | 'REVERSED';
  postedCents: Cents;
}

/**
 * Simulated bank authorisation host ("issuer"). Pure, synchronous decision logic — the Network wraps it
 * with latency and failures.
 *
 * Key banking idea: a WITHDRAWAL_AUTH only places a HOLD on the account. Nothing is posted to the ledger
 * until the ATM sends WITHDRAWAL_COMPLETION (the customer took the cash). If the ATM sends a REVERSAL
 * instead (cash not dispensed, not taken, or the ATM never got the answer) the hold is simply released.
 */
export class AuthorizationHost {
  readonly auths = new Map<string, AuthRecord>();
  private tokenToCard = new Map<string, Card>();

  constructor(
    private readonly ledger: Ledger,
    private readonly rng: Rng,
  ) {
    for (const c of ledger.cards.values()) this.tokenToCard.set(cardTokenFor(c.id), c);
  }

  handle(req: HostRequest): HostResponse {
    const card = this.tokenToCard.get(req.cardToken);
    if (!card) return this.respond(req, '14', 'Invalid card: token not recognised by issuer');
    switch (req.type) {
      case 'CARD_AUTH':
        return this.cardAuth(req, card);
      case 'BALANCE_INQUIRY':
        return this.balance(req, card);
      case 'WITHDRAWAL_AUTH':
        return this.withdrawalAuth(req, card);
      case 'WITHDRAWAL_COMPLETION':
        return this.completion(req);
      case 'REVERSAL':
        return this.reversal(req);
      case 'DEPOSIT':
        return this.deposit(req, card);
      case 'TRANSFER':
        return this.transfer(req, card);
      case 'MINI_STATEMENT':
        return this.miniStatement(req, card);
    }
  }

  private respond(req: HostRequest, code: ResponseCode, text: string, extra: Partial<HostResponse> = {}): HostResponse {
    return { msgId: `${req.msgId}-R`, type: req.type, stan: req.stan, time: req.time, code, approved: code === '00', text, ...extra };
  }

  private newAuthCode(): string {
    return this.rng.int(0, 0xffffff).toString(16).toUpperCase().padStart(6, '0');
  }

  /** Card status checks shared by every message except CARD_AUTH (which reports them in detail). */
  private cardProblem(req: HostRequest, card: Card): HostResponse | undefined {
    if (card.status === 'BLOCKED') return this.respond(req, '62', 'Restricted card: card is blocked');
    if (card.status === 'EXPIRED') return this.respond(req, '54', 'Expired card');
    if (card.status === 'RETAINED') return this.respond(req, '14', 'Invalid card: card reported retained');
    return undefined;
  }

  private linked(req: HostRequest, card: Card, accountId: string | undefined): HostResponse | undefined {
    if (!accountId || !card.accountIds.includes(accountId) || !this.ledger.accounts.has(accountId)) {
      return this.respond(req, '05', `Do not honor: account ${accountId ?? '(none)'} is not linked to this card`);
    }
    return undefined;
  }

  private cardAuth(req: HostRequest, card: Card): HostResponse {
    const problem = this.cardProblem(req, card);
    if (problem) return problem;
    const expected = pinBlockFromHash(card.pinHash, req.stan);
    if (req.pinBlock !== expected) {
      card.pinTriesRemaining = Math.max(0, card.pinTriesRemaining - 1);
      if (card.pinTriesRemaining === 0) {
        card.status = 'BLOCKED';
        return this.respond(req, '75', 'PIN tries exceeded: card blocked by issuer');
      }
      return this.respond(req, '55', `Incorrect PIN: ${card.pinTriesRemaining} ${card.pinTriesRemaining === 1 ? 'try' : 'tries'} remaining`);
    }
    card.pinTriesRemaining = 3;
    const accounts = card.accountIds.map((id) => this.ledger.account(id)).map((a) => ({ id: a.id, type: a.type, nickname: a.nickname }));
    return this.respond(req, '00', `Approved: PIN verified, ${accounts.length} linked account(s)`, { accounts });
  }

  private balance(req: HostRequest, card: Card): HostResponse {
    const bad = this.cardProblem(req, card) ?? this.linked(req, card, req.accountId);
    if (bad) return bad;
    const id = req.accountId!;
    return this.respond(req, '00', 'Approved: balance returned', { ledgerCents: this.ledger.account(id).ledgerCents, availableCents: this.ledger.available(id) });
  }

  private withdrawalAuth(req: HostRequest, card: Card): HostResponse {
    const bad = this.cardProblem(req, card) ?? this.linked(req, card, req.accountId);
    if (bad) return bad;
    const acct = this.ledger.account(req.accountId!);
    const amount = req.amountCents ?? 0;
    if (amount <= 0) return this.respond(req, '05', 'Do not honor: invalid amount');
    if (acct.status === 'FROZEN') return this.respond(req, '57', 'Transaction not permitted: account is frozen');
    if (acct.withdrawnTodayCents + amount > acct.dailyLimitCents) {
      const left = Math.max(0, acct.dailyLimitCents - acct.withdrawnTodayCents);
      return this.respond(req, '61', `Exceeds daily withdrawal limit: ${formatCents(left)} remaining today`);
    }
    const available = this.ledger.available(acct.id);
    if (available < amount) return this.respond(req, '51', `Insufficient funds: available ${formatCents(available)}`, { availableCents: available, ledgerCents: acct.ledgerCents });
    const txnId = req.txnId ?? `STAN-${req.stan}`;
    const hold = this.ledger.placeHold(acct.id, txnId, amount);
    const authCode = this.newAuthCode();
    this.auths.set(req.stan, { stan: req.stan, txnId, accountId: acct.id, amountCents: amount, holdId: hold.id, authCode, status: 'HELD', postedCents: 0 });
    return this.respond(req, '00', `Approved: hold ${hold.id} of ${formatCents(amount)} placed (nothing posted yet)`, {
      authCode,
      ledgerCents: acct.ledgerCents,
      availableCents: this.ledger.available(acct.id),
    });
  }

  /** Post the cash actually dispensed: Dr customer account / Cr GL-ATM-CASH, then release the hold. */
  private postWithdrawal(rec: AuthRecord, cents: Cents, description: string): void {
    if (cents > 0) {
      this.ledger.post(rec.txnId, description, [
        { account: rec.accountId, amountCents: -cents },
        { account: GL_ATM_CASH, amountCents: cents },
      ]);
      this.ledger.account(rec.accountId).withdrawnTodayCents += cents;
    }
    rec.postedCents += cents;
    this.ledger.releaseHold(rec.holdId);
  }

  private completion(req: HostRequest): HostResponse {
    const rec = this.auths.get(req.originalStan ?? '');
    if (!rec) return this.respond(req, '05', `Do not honor: no authorization found for STAN ${req.originalStan}`);
    if (rec.status === 'COMPLETED') return this.respond(req, '00', 'Duplicate completion ignored: already posted');
    if (rec.status === 'REVERSED') return this.respond(req, '05', 'Do not honor: authorization was already reversed');
    const cents = Math.min(req.dispensedCents ?? rec.amountCents, rec.amountCents);
    this.postWithdrawal(rec, cents, 'ATM cash withdrawal');
    rec.status = 'COMPLETED';
    const acct = this.ledger.account(rec.accountId);
    return this.respond(req, '00', `Approved: ${formatCents(cents)} posted, hold released`, {
      authCode: rec.authCode,
      ledgerCents: acct.ledgerCents,
      availableCents: this.ledger.available(acct.id),
    });
  }

  /** Release the hold. Idempotent. A partial reversal posts only the amount actually dispensed. */
  private reversal(req: HostRequest): HostResponse {
    const rec = this.auths.get(req.originalStan ?? '');
    if (!rec) return this.respond(req, '00', 'Approved: nothing to reverse (no hold exists for that STAN)');
    if (rec.status === 'REVERSED') return this.respond(req, '00', 'Approved: already reversed (duplicate reversal ignored)');
    if (rec.status === 'COMPLETED') return this.respond(req, '05', 'Do not honor: transaction already posted, raise a dispute instead');
    const dispensed = Math.min(req.dispensedCents ?? 0, rec.amountCents);
    if (dispensed > 0) this.postWithdrawal(rec, dispensed, 'ATM cash withdrawal (partial)');
    else this.ledger.releaseHold(rec.holdId);
    rec.status = 'REVERSED';
    const acct = this.ledger.account(rec.accountId);
    const what = dispensed > 0 ? `partial reversal: ${formatCents(dispensed)} posted, rest released` : `hold ${rec.holdId} released, nothing posted`;
    return this.respond(req, '00', `Approved: ${what}`, { ledgerCents: acct.ledgerCents, availableCents: this.ledger.available(acct.id) });
  }

  private deposit(req: HostRequest, card: Card): HostResponse {
    const bad = this.cardProblem(req, card) ?? this.linked(req, card, req.accountId);
    if (bad) return bad;
    const amount = req.amountCents ?? 0;
    if (amount <= 0) return this.respond(req, '05', 'Do not honor: invalid amount');
    const id = req.accountId!;
    // Dr GL-ATM-CASH (cash now in the ATM) / Cr customer account.
    this.ledger.post(req.txnId ?? `STAN-${req.stan}`, 'ATM cash deposit', [
      { account: GL_ATM_CASH, amountCents: -amount },
      { account: id, amountCents: amount },
    ]);
    const authCode = this.newAuthCode();
    return this.respond(req, '00', `Approved: ${formatCents(amount)} credited`, { authCode, ledgerCents: this.ledger.account(id).ledgerCents, availableCents: this.ledger.available(id) });
  }

  private transfer(req: HostRequest, card: Card): HostResponse {
    const bad = this.cardProblem(req, card) ?? this.linked(req, card, req.accountId) ?? this.linked(req, card, req.toAccountId);
    if (bad) return bad;
    const from = this.ledger.account(req.accountId!);
    const to = this.ledger.account(req.toAccountId!);
    const amount = req.amountCents ?? 0;
    if (amount <= 0 || from.id === to.id) return this.respond(req, '05', 'Do not honor: invalid transfer');
    if (from.status === 'FROZEN') return this.respond(req, '57', 'Transaction not permitted: source account is frozen');
    const available = this.ledger.available(from.id);
    if (available < amount) return this.respond(req, '51', `Insufficient funds: available ${formatCents(available)}`, { availableCents: available });
    this.ledger.post(req.txnId ?? `STAN-${req.stan}`, `Transfer ${from.id} → ${to.id}`, [
      { account: from.id, amountCents: -amount },
      { account: to.id, amountCents: amount },
    ]);
    const authCode = this.newAuthCode();
    return this.respond(req, '00', `Approved: ${formatCents(amount)} moved ${from.id} → ${to.id}`, { authCode, ledgerCents: from.ledgerCents, availableCents: this.ledger.available(from.id) });
  }

  private miniStatement(req: HostRequest, card: Card): HostResponse {
    const bad = this.cardProblem(req, card) ?? this.linked(req, card, req.accountId);
    if (bad) return bad;
    const id = req.accountId!;
    return this.respond(req, '00', 'Approved: last 6 statement lines', {
      statement: this.ledger.statement(id, 6),
      ledgerCents: this.ledger.account(id).ledgerCents,
      availableCents: this.ledger.available(id),
    });
  }
}
