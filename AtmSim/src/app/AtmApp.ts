import { formatCents, formatWhole } from '../core/money';
import {
  DENOMINATIONS,
  denomCents,
  type AtmInput,
  type Cents,
  type DenomCounts,
  type Denomination,
  type KeypadKey,
  type ScreenButton,
  type ScreenState,
  type Transaction,
  type TxnType,
} from '../core/types';
import { BANK_NAME } from '../banking/seed';
import { AbortedError, PowerLossError, type SessionAccount, type TxnResult } from '../transactions/engine';
import type { AtmSystem } from './AtmSystem';

/** Quick-amount buttons on the amount screen (cents). Ids are `amt-<cents>`. */
export const QUICK_AMOUNTS: readonly Cents[] = [2_000, 4_000, 6_000, 10_000, 20_000, 50_000];

const MAX_PIN = 6;
const MIN_PIN = 4;
const MAX_AMOUNT_DIGITS = 5;

const FOOTER = `${BANK_NAME} · Training ATM · fictional money only`;

/**
 * Headless ATM application: the customer-facing screen flow.
 *
 * `input()` never throws. Long work (host messages, mechanism animations) runs in the background while
 * `busy` is true; inputs arriving while busy are ignored. `settle()` resolves when no flow is running.
 * Every screen change is emitted as 'screen.changed'.
 *
 * Service policy (generic): a dispenser fault or empty cassettes only disable cash withdrawals
 * ("reduced service"); the ATM goes OUT_OF_SERVICE when power is lost, no card can be read (chip and
 * contactless both down), the bank host / network is down, or the display / keypad has failed.
 */
export class AtmApp {
  screen: ScreenState;
  busy = false;
  sessionActive = false;
  /** The last transaction this app started (for tutorials / autopilot). */
  lastTxn?: Transaction;
  lastResult?: TxnResult;

  private flow: Promise<void> | null = null;
  private pin = '';
  private pinError = '';
  private amount = '';
  private amountError = '';
  private txnType: TxnType | null = null;
  private fromAccount = '';
  private toAccount = '';
  private depCounts: DenomCounts = {};
  private depNote = '';
  private welcomeNotice = '';
  private disposed = false;
  private unsubs: Array<() => void> = [];

  constructor(private readonly sys: AtmSystem) {
    this.screen = this.idleScreen();
    const refresh = () => this.refresh();
    this.unsubs.push(
      sys.bus.on('device.changed', refresh),
      sys.bus.on('fault.armed', refresh),
      sys.bus.on('fault.cleared', refresh),
      sys.bus.on('inventory.changed', refresh),
      sys.bus.on('txn.state', ({ txn, to }) => this.onTxnState(txn, to)),
      sys.bus.on('txn.created', ({ txn }) => {
        if (this.busy && !this.disposed) this.lastTxn = txn;
      }),
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** Resolves once no background flow is running. */
  async settle(): Promise<void> {
    while (this.flow) await this.flow;
  }

  // ───────────────────────────── input ─────────────────────────────

  input(i: AtmInput): void {
    if (this.disposed) return;
    try {
      if (this.busy) return;
      if (i.kind === 'key') this.sys.devices.metric('keypad', 'keyPresses', 1);
      this.handle(i);
    } catch (err) {
      console.error('[AtmApp] input failed', err);
      this.recover();
    }
  }

  private handle(i: AtmInput): void {
    if (this.sys.engine.powerLost || this.sys.operator.active) return;
    const id = this.screen.id;
    const touch = i.kind === 'touch' ? i.target : undefined;
    const key: KeypadKey | undefined = i.kind === 'key' ? i.key : undefined;

    if (i.kind === 'card') {
      if (!this.sessionActive && (id === 'WELCOME' || id === 'CARD_RETAINED')) this.startCard(i.cardId, i.method);
      return;
    }

    // CANCEL ends the session (returning the card) on every interactive session screen.
    const cancelIds = ['pin-cancel', 'menu-end', 'acct-cancel', 'to-cancel', 'amt-cancel', 'dep-cancel', 'another-no'];
    if (this.sessionActive && (key === 'CANCEL' || (touch && cancelIds.includes(touch)))) {
      if (id === 'RESULT' && key === 'CANCEL') return this.toAnother();
      this.cancelSession(touch === 'menu-end' || touch === 'another-no' ? undefined : 'Your transaction has been cancelled.');
      return;
    }

    switch (id) {
      case 'PIN_ENTRY':
        if (key && /^[0-9]$/.test(key)) {
          if (this.pin.length < MAX_PIN) this.pin += key;
          this.pinError = '';
          this.render(this.pinScreen());
        } else if (key === 'CLEAR' || touch === 'pin-clear') {
          this.pin = '';
          this.render(this.pinScreen());
        } else if (key === 'ENTER' || touch === 'pin-enter') {
          if (this.pin.length < MIN_PIN) {
            this.pinError = `Please enter at least ${MIN_PIN} digits.`;
            this.render(this.pinScreen());
          } else this.submitPin();
        }
        return;
      case 'MAIN_MENU':
        if (touch?.startsWith('menu-')) this.menu(touch);
        return;
      case 'ACCOUNT_SELECT':
        if (touch?.startsWith('acct-')) this.accountChosen(touch.slice(5));
        return;
      case 'TRANSFER_TO':
        if (touch?.startsWith('to-')) {
          const to = touch.slice(3);
          if (this.accounts().some((a) => a.id === to && a.id !== this.fromAccount)) {
            this.toAccount = to;
            this.amount = '';
            this.amountError = '';
            this.render(this.amountScreen());
          }
        }
        return;
      case 'AMOUNT_ENTRY':
        if (key && /^[0-9]$/.test(key)) {
          if (this.amount.length < MAX_AMOUNT_DIGITS && !(this.amount === '' && key === '0')) this.amount += key;
          this.amountError = '';
          this.render(this.amountScreen());
        } else if (key === 'CLEAR' || touch === 'amt-clear') {
          this.amount = '';
          this.render(this.amountScreen());
        } else if (key === 'ENTER' || touch === 'amt-enter') {
          if (!this.amount) {
            this.amountError = 'Please enter an amount.';
            this.render(this.amountScreen());
          } else this.submitAmount(Number(this.amount) * 100);
        } else if (touch?.startsWith('amt-')) {
          const cents = Number(touch.slice(4));
          if (QUICK_AMOUNTS.includes(cents)) this.submitAmount(cents);
        }
        return;
      case 'DEPOSIT_INSERT':
        if (touch?.startsWith('dep-plus-') || touch?.startsWith('dep-minus-')) {
          const plus = touch.startsWith('dep-plus-');
          const d = Number(touch.split('-')[2]) as Denomination;
          if (!DENOMINATIONS.includes(d)) return;
          const cur = this.depCounts[d] ?? 0;
          const wallet = this.walletCount(d);
          this.depCounts[d] = plus ? Math.min(wallet, cur + 1) : Math.max(0, cur - 1);
          this.depNote = '';
          this.render(this.depositInsertScreen());
        } else if (touch === 'dep-insert' || key === 'ENTER') {
          if (this.depositTotal() > 0) this.depositIntake();
        }
        return;
      case 'DEPOSIT_CONFIRM':
        if (touch === 'dep-confirm' || key === 'ENTER') this.depositConfirm();
        return;
      case 'RESULT':
        if (touch === 'receipt-yes' && this.receiptAvailable()) this.printReceipt();
        else if (touch === 'receipt-no' || key === 'ENTER') this.toAnother();
        return;
      case 'ANOTHER_TXN':
        if (touch === 'another-yes' || key === 'ENTER') {
          this.resetTxnContext();
          this.render(this.menuScreen());
        }
        return;
      case 'CARD_RETAINED':
        if (touch === 'retained-ok' || key === 'ENTER' || key === 'CANCEL') {
          this.welcomeNotice = '';
          this.refresh(true);
        }
        return;
      default:
        return;
    }
  }

  // ───────────────────────────── background flows ─────────────────────────────

  private run(task: () => Promise<void>): void {
    this.busy = true;
    let p!: Promise<void>;
    p = (async () => {
      await Promise.resolve();
      try {
        await task();
      } catch (err) {
        await this.flowError(err);
      } finally {
        this.busy = false;
        if (this.flow === p) this.flow = null;
      }
    })();
    this.flow = p;
  }

  private async flowError(err: unknown): Promise<void> {
    if (err instanceof AbortedError || this.disposed) return;
    if (err instanceof PowerLossError || this.sys.engine.powerLost) {
      this.sessionActive = false;
      this.resetTxnContext();
      this.render(this.outOfServiceScreen());
      return;
    }
    console.error('[AtmApp] flow failed', err);
    try {
      await this.sys.engine.depositCancel();
      if (this.sys.engine.session) await this.sys.engine.ejectCard();
    } catch {
      /* best effort */
    }
    this.sessionActive = false;
    this.resetTxnContext();
    this.welcomeNotice = 'Sorry, something went wrong. Please try again.';
    this.showIdle();
  }

  private recover(): void {
    this.busy = false;
    this.refresh(true);
  }

  private startCard(cardId: string, method: 'chip' | 'contactless'): void {
    this.run(async () => {
      this.welcomeNotice = '';
      this.render({ id: 'READING_CARD', title: 'Reading your card', lines: [method === 'chip' ? 'Please wait while we read your card…' : 'Card detected. Please wait…'], buttons: [], tone: 'busy', footer: FOOTER });
      const r = await this.sys.engine.readCard(cardId, method);
      if (!r.ok) {
        this.welcomeNotice = r.reason ?? 'Sorry, we could not read your card.';
        this.showIdle();
        return;
      }
      this.sessionActive = true;
      this.pin = '';
      this.pinError = '';
      this.render(this.pinScreen());
    });
  }

  private submitPin(): void {
    const pin = this.pin;
    this.pin = '';
    this.run(async () => {
      this.render(this.processing('Verifying your PIN…'));
      const r = await this.sys.engine.verifyPin(pin);
      if (r.ok) {
        this.resetTxnContext();
        this.render(this.menuScreen());
        return;
      }
      if (r.code === '55') {
        this.pinError = r.message;
        this.render(this.pinScreen());
        return;
      }
      if (r.retained) {
        this.sessionActive = false;
        this.render(this.retainedScreen(r.message));
        return;
      }
      await this.endSessionFlow(r.message);
    });
  }

  private submitAmount(cents: Cents): void {
    const type = this.txnType;
    this.run(async () => {
      this.render(this.processing('Please wait while we process your request…'));
      const r = type === 'TRANSFER' ? await this.sys.engine.transfer(this.fromAccount, this.toAccount, cents) : await this.sys.engine.withdraw(this.fromAccount, cents);
      this.afterTxn(r);
    });
  }

  private afterTxn(r: TxnResult): void {
    this.lastResult = r;
    this.lastTxn = r.txn;
    if (this.sys.engine.powerLost) throw new PowerLossError();
    this.render(this.resultScreen(r));
  }

  private menu(id: string): void {
    const opts = this.menuOptions();
    const map: Record<string, TxnType> = {
      'menu-withdraw': 'WITHDRAWAL',
      'menu-deposit': 'DEPOSIT',
      'menu-balance': 'BALANCE',
      'menu-transfer': 'TRANSFER',
      'menu-statement': 'MINI_STATEMENT',
    };
    const type = map[id];
    if (!type || !opts[id]) return;
    this.txnType = type;
    this.render(this.accountScreen());
  }

  private accountChosen(acctId: string): void {
    if (!this.accounts().some((a) => a.id === acctId)) return;
    this.fromAccount = acctId;
    this.amount = '';
    this.amountError = '';
    switch (this.txnType) {
      case 'WITHDRAWAL':
        this.render(this.amountScreen());
        return;
      case 'DEPOSIT':
        this.depCounts = {};
        this.depNote = '';
        this.render(this.depositInsertScreen());
        return;
      case 'TRANSFER':
        this.render(this.transferToScreen());
        return;
      case 'BALANCE':
        this.run(async () => {
          this.render(this.processing('Retrieving your balance…'));
          this.afterTxn(await this.sys.engine.balance(acctId));
        });
        return;
      case 'MINI_STATEMENT':
        this.run(async () => {
          this.render(this.processing('Retrieving your recent transactions…'));
          this.afterTxn(await this.sys.engine.miniStatement(acctId));
        });
        return;
      default:
        return;
    }
  }

  private depositIntake(): void {
    const counts = { ...this.depCounts };
    this.run(async () => {
      this.render(this.processing('Please insert your notes… Counting and checking your notes.'));
      const r = await this.sys.engine.depositIntake(counts);
      if (r.totalCents === 0) {
        this.depCounts = {};
        this.depNote = r.returned ? `${r.returned} note(s) could not be accepted and were returned.` : 'No notes were accepted.';
        this.render(this.depositInsertScreen());
        return;
      }
      const parts = DENOMINATIONS.filter((d) => r.escrow[d]).map((d) => `${r.escrow[d]} × $${d}`);
      this.render({
        id: 'DEPOSIT_CONFIRM',
        title: 'Confirm your deposit',
        lines: [
          `We counted: ${parts.join(', ')}`,
          `Total: ${formatCents(r.totalCents)}`,
          ...(r.returned ? [`${r.returned} note(s) could not be accepted and were returned.`] : []),
          `Deposit into ${this.accountName(this.fromAccount)}?`,
        ],
        buttons: [
          { id: 'dep-confirm', label: 'Confirm deposit', enabled: true, style: 'primary' },
          { id: 'dep-cancel', label: 'Cancel – return my notes', enabled: true, style: 'danger' },
        ],
        tone: 'normal',
        footer: FOOTER,
      });
    });
  }

  private depositConfirm(): void {
    this.run(async () => {
      this.render(this.processing('Depositing your notes…'));
      this.afterTxn(await this.sys.engine.depositConfirm(this.fromAccount));
    });
  }

  private printReceipt(): void {
    const lines = this.lastResult?.receipt ?? [];
    this.run(async () => {
      this.render({ id: 'RECEIPT_PRINTING', title: 'Printing your receipt', lines: ['Please wait…'], buttons: [], tone: 'busy', footer: FOOTER });
      const ok = await this.sys.engine.printReceipt(lines);
      this.render(this.anotherScreen(ok ? 'Please take your receipt.' : 'Sorry, receipts are unavailable right now.'));
    });
  }

  private toAnother(): void {
    this.render(this.anotherScreen());
  }

  private cancelSession(message?: string): void {
    this.run(async () => {
      if (this.sys.engine.hasEscrow) {
        this.render(this.processing('Returning your notes…'));
        await this.sys.engine.depositCancel();
        message = 'Your notes have been returned. Your account has not been charged.';
      }
      await this.endSessionFlow(message);
    });
  }

  /** Return the card (chip) or finish (contactless), then say goodbye. Runs inside a flow. */
  private async endSessionFlow(message?: string): Promise<void> {
    const s = this.sys.engine.session;
    if (s && s.method === 'chip') {
      this.render({
        id: 'TAKE_CARD',
        title: 'Please take your card',
        lines: [...(message ? [message] : []), 'Please take your card.'],
        buttons: [],
        tone: 'normal',
        countdownMs: this.sys.config.cardTakeTimeoutMs,
        footer: FOOTER,
      });
    }
    const r = await this.sys.engine.ejectCard();
    this.sessionActive = false;
    this.resetTxnContext();
    if (r === 'retained') {
      this.render(this.retainedScreen('Your card was not taken and has been retained for your security.'));
      return;
    }
    this.render({
      id: 'GOODBYE',
      title: 'Thank you',
      lines: [...(message && s?.method !== 'chip' ? [message] : []), `Thank you for banking with ${BANK_NAME}.`, 'Have a nice day!'],
      buttons: [],
      tone: 'success',
      footer: FOOTER,
    });
    await this.sys.clock.wait(2_500);
    this.showIdle();
  }

  private onTxnState(_txn: Transaction, to: string): void {
    if (!this.busy || this.disposed) return;
    switch (to) {
      case 'AUTH_PENDING':
        this.render(this.processing('Contacting your bank…'));
        break;
      case 'DISPENSING':
        this.render(this.processing('Counting your cash…'));
        break;
      case 'PRESENTED':
        this.render({
          id: 'TAKE_CASH',
          title: 'Please take your cash',
          lines: ['Please take your cash.', 'For your security, uncollected cash will be retained.'],
          buttons: [],
          tone: 'success',
          countdownMs: this.sys.config.cashTakeTimeoutMs,
          footer: FOOTER,
        });
        break;
      case 'RETRACTED':
        this.render(this.processing('Your cash was not taken. Retaining cash for your security…'));
        break;
      case 'TIMED_OUT':
      case 'DISPENSE_FAILED':
        this.render(this.processing('Sorry, there was a problem. Cancelling your request…'));
        break;
      default:
        break;
    }
  }

  // ───────────────────────────── screen state ─────────────────────────────

  /**
   * Re-render the idle screen after a device / fault / inventory / operator change. Does nothing while a
   * flow is running. `force` also replaces CARD_RETAINED / welcome notices.
   */
  refresh(force = false): void {
    if (this.disposed || this.busy) return;
    if (this.sys.operator.active) return this.render(this.serviceScreen());
    if (this.sys.engine.powerLost) {
      this.sessionActive = false;
      return this.render(this.outOfServiceScreen());
    }
    if (this.sessionActive) {
      if (this.screen.id === 'MAIN_MENU') this.render(this.menuScreen());
      return;
    }
    if (!force && this.screen.id === 'CARD_RETAINED') return;
    this.render(this.idleScreen());
  }

  /** Show the idle screen (WELCOME / OUT_OF_SERVICE / SERVICE_MODE) from inside a flow. */
  private showIdle(): void {
    if (this.sys.engine.powerLost) this.sessionActive = false;
    this.render(this.idleScreen());
  }

  private render(s: ScreenState): void {
    if (this.disposed) return;
    const prev = this.screen?.id;
    this.screen = s;
    if (s.id === 'WELCOME' && prev !== 'WELCOME') this.sys.bus.emit('atm.cue', { cue: 'card-light', on: true });
    if (s.tone === 'error' && prev !== s.id) this.sys.bus.emit('atm.cue', { cue: 'error-beep' });
    this.sys.bus.emit('screen.changed', { screen: s });
  }

  /** Reasons the whole ATM is out of service (empty = in service). */
  outOfServiceReasons(): string[] {
    const d = this.sys.devices;
    const r: string[] = [];
    if (this.sys.engine.powerLost || !d.isOk('power')) r.push('Power failure');
    if (!d.isOk('cardReader') && !d.isOk('contactless')) r.push('No card reader available');
    if (!d.isOk('host')) r.push('Bank host unavailable');
    if (!d.isOk('network')) r.push('Network unavailable');
    if (!d.isOk('display') || !d.isOk('keypad')) r.push('Display or keypad fault');
    return r;
  }

  private withdrawalsAvailable(): boolean {
    return this.sys.devices.isOk('dispenser') && this.sys.inventory.availableCents() >= this.sys.config.minWithdrawalCents;
  }

  /** Customer-facing list of unavailable services. */
  private unavailableLines(): string[] {
    const d = this.sys.devices;
    const out: string[] = [];
    if (!this.withdrawalsAvailable()) out.push('Cash withdrawals unavailable');
    if (!d.isOk('printer')) out.push('Receipts unavailable');
    if (!d.isOk('depositModule')) out.push('Deposits unavailable');
    if (!d.isOk('cardReader')) out.push('Card reader unavailable – please tap your card');
    if (!d.isOk('contactless')) out.push('Contactless unavailable – please insert your card');
    return out;
  }

  private idleScreen(): ScreenState {
    if (this.sys.operator?.active) return this.serviceScreen();
    if (this.sys.engine.powerLost) return this.outOfServiceScreen();
    if (this.outOfServiceReasons().length) return this.outOfServiceScreen();
    const notice = this.welcomeNotice;
    return {
      id: 'WELCOME',
      title: `Welcome to ${BANK_NAME}`,
      lines: [...(notice ? [notice] : []), 'Insert or tap your card', ...this.unavailableLines()],
      buttons: [],
      tone: notice ? 'warn' : 'normal',
      footer: FOOTER,
    };
  }

  private outOfServiceScreen(): ScreenState {
    return {
      id: 'OUT_OF_SERVICE',
      title: 'Temporarily out of service',
      lines: ['Sorry, this ATM is temporarily out of service.', 'Please use another ATM. We apologise for the inconvenience.'],
      buttons: [],
      tone: 'error',
      footer: `${FOOTER} · ${this.outOfServiceReasons().join(', ') || 'Service required'}`,
    };
  }

  private serviceScreen(): ScreenState {
    return { id: 'SERVICE_MODE', title: 'Service mode', lines: ['This ATM is being serviced.', 'Please use another ATM.'], buttons: [], tone: 'warn', footer: FOOTER };
  }

  private processing(text: string): ScreenState {
    return { id: 'PROCESSING', title: 'Please wait', lines: [text], buttons: [], tone: 'busy', footer: FOOTER };
  }

  private pinScreen(): ScreenState {
    const card = this.sys.engine.session?.card;
    return {
      id: 'PIN_ENTRY',
      title: 'Enter your PIN',
      lines: [...(this.pinError ? [this.pinError] : []), 'Please enter your PIN and press Enter.', 'Shield the keypad with your hand.'],
      buttons: [
        { id: 'pin-enter', label: 'Enter', enabled: this.pin.length >= MIN_PIN, style: 'primary' },
        { id: 'pin-clear', label: 'Clear', enabled: this.pin.length > 0 },
        { id: 'pin-cancel', label: 'Cancel', enabled: true, style: 'danger' },
      ],
      input: { label: 'PIN', value: '•'.repeat(this.pin.length), masked: true },
      tone: this.pinError ? 'warn' : 'normal',
      footer: card ? `Training card – demo PIN ${card.demoPin} (fictional)` : FOOTER,
    };
  }

  private accounts(): SessionAccount[] {
    return this.sys.engine.session?.accounts ?? [];
  }

  private accountName(id: string): string {
    const a = this.accounts().find((x) => x.id === id);
    return a ? `${a.nickname} ••${a.id.slice(-4)}` : id;
  }

  private walletCount(d: Denomination): number {
    return this.sys.inventory.notesAt('customer').filter((n) => n.denom === d).length;
  }

  private menuOptions(): Record<string, boolean> {
    const s = this.sys;
    return {
      'menu-withdraw': this.withdrawalsAvailable(),
      'menu-deposit': s.devices.isOk('depositModule') && s.inventory.count('customer') > 0,
      'menu-balance': true,
      'menu-transfer': this.accounts().length >= 2,
      'menu-statement': true,
      'menu-end': true,
    };
  }

  private menuScreen(): ScreenState {
    const o = this.menuOptions();
    const name = this.sys.engine.session?.card.holderName.split(' ')[0] ?? '';
    const btn = (id: string, label: string, style?: ScreenButton['style']): ScreenButton => ({ id, label, enabled: o[id], ...(style ? { style } : {}) });
    return {
      id: 'MAIN_MENU',
      title: `Hello${name ? ', ' + name : ''}`,
      lines: ['What would you like to do?', ...this.unavailableLines().filter((l) => !l.startsWith('Card reader') && !l.startsWith('Contactless'))],
      buttons: [
        btn('menu-withdraw', 'Withdraw cash', 'primary'),
        btn('menu-deposit', 'Deposit cash'),
        btn('menu-balance', 'Balance inquiry'),
        btn('menu-transfer', 'Transfer'),
        btn('menu-statement', 'Mini statement'),
        btn('menu-end', 'End session', 'danger'),
      ],
      tone: 'normal',
      footer: FOOTER,
    };
  }

  private accountScreen(): ScreenState {
    const titles: Record<TxnType, string> = {
      WITHDRAWAL: 'Withdraw from which account?',
      DEPOSIT: 'Deposit into which account?',
      BALANCE: 'Balance for which account?',
      TRANSFER: 'Transfer from which account?',
      MINI_STATEMENT: 'Statement for which account?',
    };
    return {
      id: 'ACCOUNT_SELECT',
      title: titles[this.txnType ?? 'BALANCE'],
      lines: ['Please choose an account.'],
      buttons: [
        ...this.accounts().map((a) => ({ id: `acct-${a.id}`, label: `${a.nickname} ••${a.id.slice(-4)}`, enabled: true })),
        { id: 'acct-cancel', label: 'Cancel', enabled: true, style: 'danger' as const },
      ],
      tone: 'normal',
      footer: FOOTER,
    };
  }

  private transferToScreen(): ScreenState {
    return {
      id: 'TRANSFER_TO',
      title: 'Transfer to which account?',
      lines: [`From: ${this.accountName(this.fromAccount)}`],
      buttons: [
        ...this.accounts()
          .filter((a) => a.id !== this.fromAccount)
          .map((a) => ({ id: `to-${a.id}`, label: `${a.nickname} ••${a.id.slice(-4)}`, enabled: true })),
        { id: 'to-cancel', label: 'Cancel', enabled: true, style: 'danger' as const },
      ],
      tone: 'normal',
      footer: FOOTER,
    };
  }

  private amountScreen(): ScreenState {
    const isTransfer = this.txnType === 'TRANSFER';
    const cfg = this.sys.config;
    const denoms = [...new Set(this.sys.inventory.usableCassettes().filter((c) => c.counter > 0).map((c) => c.denom))].sort((a, b) => a - b);
    const lines = isTransfer
      ? [`From ${this.accountName(this.fromAccount)} to ${this.accountName(this.toAccount)}`, 'Choose an amount or type it on the keypad (whole dollars), then press Enter.']
      : [
          'Choose an amount or type it on the keypad, then press Enter.',
          `Amounts in multiples of ${formatWhole(cfg.amountMultipleCents)}, ${formatWhole(cfg.minWithdrawalCents)}–${formatWhole(cfg.maxWithdrawalCents)}.`,
          `Notes available: ${denoms.map((d) => `$${d}`).join(' ') || 'none'}`,
        ];
    return {
      id: 'AMOUNT_ENTRY',
      title: isTransfer ? 'Transfer amount' : 'Withdrawal amount',
      lines: [...(this.amountError ? [this.amountError] : []), ...lines],
      buttons: [
        ...QUICK_AMOUNTS.map((c) => ({ id: `amt-${c}`, label: formatWhole(c), enabled: true })),
        { id: 'amt-enter', label: 'Enter', enabled: this.amount.length > 0, style: 'primary' as const },
        { id: 'amt-clear', label: 'Clear', enabled: this.amount.length > 0 },
        { id: 'amt-cancel', label: 'Cancel', enabled: true, style: 'danger' as const },
      ],
      input: { label: 'Amount', value: `$${this.amount || '0'}`, masked: false },
      tone: this.amountError ? 'warn' : 'normal',
      footer: FOOTER,
    };
  }

  private depositTotal(): Cents {
    return DENOMINATIONS.reduce((s, d) => s + (this.depCounts[d] ?? 0) * denomCents(d), 0);
  }

  private depositInsertScreen(): ScreenState {
    const buttons: ScreenButton[] = [];
    const lines: string[] = [...(this.depNote ? [this.depNote] : []), `Deposit into ${this.accountName(this.fromAccount)}`, 'Choose the notes to insert from your wallet:'];
    for (const d of DENOMINATIONS) {
      const n = this.depCounts[d] ?? 0;
      const w = this.walletCount(d);
      if (w > 0) lines.push(`$${d} notes: ${n} (wallet has ${w})`);
      buttons.push({ id: `dep-minus-${d}`, label: `− $${d}`, enabled: n > 0 });
      buttons.push({ id: `dep-plus-${d}`, label: `+ $${d}`, enabled: n < w });
    }
    const total = this.depositTotal();
    lines.push(`Total to insert: ${formatCents(total)}`);
    buttons.push({ id: 'dep-insert', label: 'Insert notes', enabled: total > 0, style: 'primary' });
    buttons.push({ id: 'dep-cancel', label: 'Cancel', enabled: true, style: 'danger' });
    return { id: 'DEPOSIT_INSERT', title: 'Deposit cash', lines, buttons, tone: this.depNote ? 'warn' : 'normal', footer: FOOTER };
  }

  private receiptAvailable(): boolean {
    return this.sys.devices.isOk('printer') && (this.lastResult?.receipt.length ?? 0) > 0;
  }

  private resultScreen(r: TxnResult): ScreenState {
    const printer = this.sys.devices.isOk('printer');
    return {
      id: 'RESULT',
      title: r.ok ? 'Transaction complete' : 'Transaction not completed',
      lines: [...r.message.split('\n'), printer ? 'Would you like a receipt?' : 'Receipts unavailable'],
      buttons: [
        { id: 'receipt-yes', label: 'Receipt', enabled: printer && r.receipt.length > 0, style: 'primary' },
        { id: 'receipt-no', label: printer ? 'No receipt' : 'Continue', enabled: true },
      ],
      tone: r.ok ? 'success' : 'warn',
      footer: FOOTER,
    };
  }

  private anotherScreen(extra?: string): ScreenState {
    return {
      id: 'ANOTHER_TXN',
      title: 'Another transaction?',
      lines: [...(extra ? [extra] : []), 'Would you like to do anything else?'],
      buttons: [
        { id: 'another-yes', label: 'Yes', enabled: true, style: 'primary' },
        { id: 'another-no', label: 'No, return my card', enabled: true },
      ],
      tone: 'normal',
      footer: FOOTER,
    };
  }

  private retainedScreen(message: string): ScreenState {
    return {
      id: 'CARD_RETAINED',
      title: 'Card retained',
      lines: [message, 'Please contact your bank to get your card back.'],
      buttons: [{ id: 'retained-ok', label: 'OK', enabled: true, style: 'primary' }],
      tone: 'error',
      footer: FOOTER,
    };
  }

  private resetTxnContext(): void {
    this.txnType = null;
    this.fromAccount = '';
    this.toAccount = '';
    this.amount = '';
    this.amountError = '';
    this.depCounts = {};
    this.depNote = '';
  }
}
