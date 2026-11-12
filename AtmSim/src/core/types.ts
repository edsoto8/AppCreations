/**
 * Shared contracts for the ATM simulator.
 *
 * Layering (see docs/ARCHITECTURE.md):
 *   core/        types, event bus, clock, rng            (no deps)
 *   banking/ cash/ transactions/ faults/ maintenance/ reconciliation/
 *                pure domain logic                        (depends on core only, NO three.js, NO DOM)
 *   app/         AtmApp screen flow + Simulator wiring    (domain + ports)
 *   scene/ models/ animations/ interactions/ ui/ audio/  (rendering + DOM; implement the ports)
 *
 * MONEY: every monetary amount is an integer number of CENTS. Denominations are whole dollars
 * (`Denomination`); use `denomCents(d)` to convert. Never use floating point dollars in domain code.
 */

// ───────────────────────────── Primitives ─────────────────────────────

export type Cents = number;
export type Denomination = 10 | 20 | 50 | 100;
export const DENOMINATIONS: readonly Denomination[] = [10, 20, 50, 100];
export const denomCents = (d: Denomination): Cents => d * 100;

/** Dispensing cassette slots. Slot letters are fixed; the denomination loaded in each is configurable. */
export type CassetteId = 'A' | 'B' | 'C';
export const CASSETTE_IDS: readonly CassetteId[] = ['A', 'B', 'C'];

// ───────────────────────────── Banknotes ─────────────────────────────

/**
 * Every fictional training note is an individual object with a physical location.
 * Notes are NEVER created or destroyed after initialisation: they only move between locations.
 * This makes "money cannot be created or destroyed" a checkable invariant.
 */
export type NoteLocation =
  | `cassette:${CassetteId}`
  | 'transport' // on the belts between picker and stacker
  | 'stacker' // staged bundle inside the dispenser
  | 'presented' // bundle held in the open presenter shutter, customer can reach it
  | 'customer' // in the (fictional) customer's wallet
  | 'reject' // reject cassette (double/skewed/suspect notes, purged notes)
  | 'retract' // retract compartment (bundles the customer did not take)
  | 'escrow' // deposit escrow, awaiting customer confirmation
  | 'deposit' // deposit cassette (accepted deposits)
  | 'vault' // branch vault / cash-in-transit stock used for replenishment
  | 'unaccounted'; // physically missing (only via deliberate discrepancy injection)

export interface Note {
  readonly id: number;
  readonly denom: Denomination;
  /** Fictional serial, e.g. "TRN-20-000123". */
  readonly serial: string;
  loc: NoteLocation;
  /** Training flag: a deposit note marked counterfeit-suspect by the simulated validator. */
  suspect?: boolean;
}

export interface CassetteState {
  id: CassetteId;
  denom: Denomination;
  capacity: number;
  /** The machine's LOGICAL counter (what the ATM software believes). */
  counter: number;
  installed: boolean;
  status: DeviceStatus;
  /** Low-cash threshold in notes. */
  lowThreshold: number;
}

/** Physical counts by denomination (from the actual Note objects). */
export type DenomCounts = Partial<Record<Denomination, number>>;

export interface InventorySnapshot {
  cassettes: Array<CassetteState & { physical: number; valueCents: Cents; low: boolean }>;
  reject: DenomCounts;
  retract: DenomCounts;
  deposit: DenomCounts;
  escrow: DenomCounts;
  inTransport: number;
  inStacker: number;
  presented: DenomCounts;
  /** Value of dispensable cash (logical counters × denom of installed, non-faulted cassettes). */
  availableCents: Cents;
  /** Totals since the last reconciliation baseline. */
  totals: {
    dispensedCents: Cents; // collected by customers
    acceptedCents: Cents; // deposits stored
    rejectedNotes: number;
    retractedNotes: number;
    replenishedCents: Cents;
  };
  lowCash: boolean;
}

/** How the dispenser chooses notes for an amount. */
export type DispenseStrategy = 'min-notes' | 'balanced' | 'small-notes';

export interface DispensePlan {
  amountCents: Cents;
  picks: Array<{ cassette: CassetteId; denom: Denomination; count: number }>;
  totalNotes: number;
}

export type PlanResult =
  | { ok: true; plan: DispensePlan }
  | { ok: false; reason: 'UNSUPPORTED_AMOUNT' | 'INSUFFICIENT_ATM_CASH' | 'NO_FEASIBLE_COMBINATION' | 'TOO_MANY_NOTES'; detail: string };

// ───────────────────────────── Accounts / ledger ─────────────────────────────

export type AccountType = 'CHECKING' | 'SAVINGS';
export type AccountStatus = 'ACTIVE' | 'FROZEN';

export interface Hold {
  id: string;
  txnId: string;
  amountCents: Cents;
  createdAt: number;
}

export interface Account {
  id: string; // e.g. "CHK-1001"
  customerId: string;
  type: AccountType;
  nickname: string;
  ledgerCents: Cents; // posted balance
  holds: Hold[];
  status: AccountStatus;
  dailyLimitCents: Cents;
  withdrawnTodayCents: Cents;
}

export interface Customer {
  id: string;
  name: string; // fictional
}

export type CardStatus = 'ACTIVE' | 'BLOCKED' | 'EXPIRED' | 'RETAINED';

/** A fictional training card. Card numbers use the non-issued 9990 prefix and are never real PANs. */
export interface Card {
  id: string;
  /** Fictional, display-only. */
  maskedNumber: string; // "9990 •••• •••• 1234"
  holderName: string;
  customerId: string;
  accountIds: string[];
  /** Simulated: the demo PIN is shown in the UI. Stored only as a toy hash, never real crypto. */
  pinHash: string;
  demoPin: string;
  status: CardStatus;
  pinTriesRemaining: number;
  expiry: string; // "12/29"
  contactless: boolean;
  /** Short description for the card picker ("Healthy balances", "Low balance", ...). */
  persona: string;
}

/** Double-entry ledger posting. The legs of one posting always sum to zero. */
export interface LedgerPosting {
  id: string;
  txnId: string;
  time: number;
  description: string;
  legs: Array<{ account: string; amountCents: Cents }>; // + credit to liability / - debit; see ARCHITECTURE.md
}

export interface StatementLine {
  time: number;
  description: string;
  amountCents: Cents;
  balanceCents: Cents;
}

// ───────────────────────────── Host messages ─────────────────────────────

export type HostMessageType =
  | 'CARD_AUTH' // card status + PIN verification
  | 'BALANCE_INQUIRY'
  | 'WITHDRAWAL_AUTH'
  | 'WITHDRAWAL_COMPLETION' // ATM confirms the customer collected cash → post
  | 'REVERSAL' // ATM cancels a prior authorization (full or partial)
  | 'DEPOSIT'
  | 'TRANSFER'
  | 'MINI_STATEMENT';

/** Conceptual ISO-8583-like response codes (educational, not a real protocol). */
export type ResponseCode =
  | '00' // approved
  | '05' // do not honor (generic decline)
  | '14' // invalid card
  | '51' // insufficient funds
  | '54' // expired card
  | '55' // incorrect PIN
  | '57' // transaction not permitted (frozen account)
  | '61' // exceeds withdrawal limit
  | '62' // restricted / blocked card
  | '75' // PIN tries exceeded
  | '91' // issuer / host unavailable
  | '68'; // response received too late (ATM-side timeout)

export interface HostRequest {
  msgId: string;
  type: HostMessageType;
  /** System trace audit number, 6 digits. */
  stan: string;
  terminalId: string;
  time: number;
  /** Tokenised card reference — the simulator never handles real card data. */
  cardToken: string;
  /** Simulated PIN block, e.g. "SIMPIN-3FA2C91B". Not real cryptography. */
  pinBlock?: string;
  accountId?: string;
  toAccountId?: string;
  amountCents?: Cents;
  /** For COMPLETION / REVERSAL: the stan + authCode of the original authorization. */
  originalStan?: string;
  authCode?: string;
  reversalReason?: string;
  /** For partial reversal: amount actually dispensed. */
  dispensedCents?: Cents;
  /** ATM transaction id (simulator convenience so the host can tag holds with the owning transaction). */
  txnId?: string;
}

export interface HostResponse {
  msgId: string;
  type: HostMessageType;
  stan: string;
  time: number;
  code: ResponseCode;
  approved: boolean;
  text: string; // human-readable explanation
  authCode?: string;
  ledgerCents?: Cents;
  availableCents?: Cents;
  accounts?: Array<{ id: string; type: AccountType; nickname: string }>;
  statement?: StatementLine[];
}

/** Hops of the conceptual architecture. */
export type NetworkNode = 'ATM' | 'CONTROLLER' | 'SWITCH' | 'HOST' | 'LEDGER';
export const NETWORK_PATH: readonly NetworkNode[] = ['ATM', 'CONTROLLER', 'SWITCH', 'HOST', 'LEDGER'];

// ───────────────────────────── Transactions ─────────────────────────────

export type TxnType = 'WITHDRAWAL' | 'BALANCE' | 'DEPOSIT' | 'TRANSFER' | 'MINI_STATEMENT';

/**
 * Transaction lifecycle. The full allowed-transition table lives in transactions/stateMachine.ts.
 *
 *  CREATED → AUTH_PENDING → AUTHORIZED → DISPENSING → PRESENTED → COLLECTED → COMPLETED
 *                        ↘ DECLINED                ↘ DISPENSE_FAILED → REVERSAL_PENDING → REVERSED
 *                        ↘ TIMED_OUT → REVERSAL_PENDING → REVERSED
 *                                                    PRESENTED → RETRACTED → REVERSAL_PENDING → REVERSED
 *  Any non-final state can go to SUSPECT (power loss) which resolves via REVERSAL_PENDING/REVERSED or COMPLETED.
 *  Non-cash txns: CREATED → AUTH_PENDING → AUTHORIZED → COMPLETED (or DECLINED/TIMED_OUT).
 *  DEPOSIT: CREATED → ESCROWED → AUTH_PENDING → AUTHORIZED → COMPLETED; ESCROWED → CANCELLED (notes returned).
 */
export type TxnState =
  | 'CREATED'
  | 'ESCROWED'
  | 'AUTH_PENDING'
  | 'AUTHORIZED'
  | 'DECLINED'
  | 'TIMED_OUT'
  | 'DISPENSING'
  | 'DISPENSE_FAILED'
  | 'PRESENTED'
  | 'COLLECTED'
  | 'RETRACTED'
  | 'SUSPECT'
  | 'REVERSAL_PENDING'
  | 'REVERSED'
  | 'CANCELLED'
  | 'COMPLETED';

export const FINAL_TXN_STATES: readonly TxnState[] = ['DECLINED', 'REVERSED', 'CANCELLED', 'COMPLETED'];

export interface TxnTransition {
  from: TxnState;
  to: TxnState;
  time: number;
  note: string;
}

export interface Transaction {
  id: string; // "TXN-000001"
  type: TxnType;
  stan: string;
  cardId: string;
  accountId?: string;
  toAccountId?: string;
  requestedCents: Cents;
  /** Cash physically presented / collected / retracted (withdrawals). */
  presentedCents: Cents;
  collectedCents: Cents;
  /** What was finally posted to the ledger (signed from the customer's perspective: withdrawal negative). */
  postedCents: Cents;
  state: TxnState;
  history: TxnTransition[];
  authCode?: string;
  responseCode?: ResponseCode;
  plan?: DispensePlan;
  createdAt: number;
  /** Free-form explanation of how the transaction ended. */
  outcome?: string;
}

// ───────────────────────────── Journal / audit ─────────────────────────────

export interface JournalEntry {
  seq: number;
  time: number;
  txnId?: string;
  kind: 'TXN' | 'DEVICE' | 'CASH' | 'HOST' | 'OPERATOR' | 'FAULT' | 'SESSION';
  text: string;
}

export interface AuditEntry {
  seq: number;
  time: number;
  actor: 'CUSTOMER' | 'ATM' | 'HOST' | 'OPERATOR' | 'TRAINER' | 'SYSTEM';
  action: string;
  detail?: string;
}

// ───────────────────────────── Devices / faults ─────────────────────────────

export type DeviceStatus = 'OK' | 'WARNING' | 'FAULT' | 'OFFLINE';

/** Logical devices whose health the ATM monitors (XFS-style "service providers", generic). */
export type DeviceId =
  | 'cardReader'
  | 'contactless'
  | 'dispenser'
  | 'printer'
  | 'depositModule'
  | 'network'
  | 'host'
  | 'power'
  | 'keypad'
  | 'display';

export interface DeviceHealth {
  id: DeviceId;
  name: string;
  status: DeviceStatus;
  detail: string;
  /** Monotonic counters (e.g. printer paper %, card reads, picks). */
  metrics: Record<string, number>;
}

export type FaultId =
  | 'insufficient-funds'
  | 'insufficient-atm-cash'
  | 'unsupported-amount'
  | 'no-feasible-combination'
  | 'low-cash-warning'
  | 'cash-jam'
  | 'pick-failure'
  | 'note-rejected'
  | 'printer-out-of-paper'
  | 'card-reader-unavailable'
  | 'network-timeout'
  | 'host-unavailable'
  | 'cash-not-collected'
  | 'power-loss';

export interface FaultDefinition {
  id: FaultId;
  title: string;
  category: 'ACCOUNT' | 'CASH' | 'MECHANICAL' | 'PERIPHERAL' | 'COMMUNICATION' | 'CUSTOMER' | 'POWER';
  /** 1. What happened. */
  explanation: string;
  /** 2. Components affected (ComponentIds, highlighted in 3D). */
  components: ComponentId[];
  /** 4. Resulting transaction state, described. */
  transactionOutcome: string;
  /** 5. Customer-facing outcome. */
  customerOutcome: string;
  /** 6. Recovery workflow steps. */
  recovery: string[];
  /** Suggested scenario to demonstrate it: which card and amount the autopilot uses. */
  demo: { cardId: string; amountCents: Cents; txn: TxnType };
  /** Whether the fault stays latched until an operator recovery action (vs. one-shot). */
  latching: boolean;
}

// ───────────────────────────── 3D component registry ─────────────────────────────

/** Every inspectable part. Shared by the 3D model, knowledge base, faults and tours. */
export type ComponentId =
  // exterior
  | 'cabinet'
  | 'topper-sign'
  | 'display'
  | 'keypad'
  | 'card-reader'
  | 'contactless-reader'
  | 'cash-slot'
  | 'deposit-slot'
  | 'receipt-slot'
  | 'camera'
  | 'speakers'
  | 'accessibility'
  | 'service-door'
  | 'vault-door'
  | 'locks-hinges'
  | 'status-leds'
  // internal
  | 'cassette-A'
  | 'cassette-B'
  | 'cassette-C'
  | 'reject-cassette'
  | 'retract-bin'
  | 'dispenser'
  | 'picker-rollers'
  | 'transport'
  | 'validation-sensors'
  | 'stacker'
  | 'presenter-shutter'
  | 'receipt-printer'
  | 'card-reader-module'
  | 'deposit-module'
  | 'power-supply'
  | 'controller-pc'
  | 'comms'
  | 'safe';

export interface ComponentInfo {
  id: ComponentId;
  name: string;
  group: 'Exterior' | 'Upper module' | 'Cash dispenser' | 'Safe' | 'Deposit';
  purpose: string;
  howItWorks: string;
  relationships: string;
  inputs: string;
  outputs: string;
  failures: string[];
  maintenance: string[];
  /** Set when a design differs between manufacturers. */
  genericNote?: string;
}

// ───────────────────────────── Ports implemented by the presentation layer ─────────────────────────────

/** Simulation clock. The UI version honours speed (0.25x..2x), pause and step-gating. Tests use an instant clock. */
export interface SimClock {
  /** Simulated milliseconds since start. */
  now(): number;
  /** Wait `ms` of simulated time. */
  wait(ms: number): Promise<void>;
  /**
   * Marks the start of a major observable stage (e.g. "Pick notes from cassette A").
   * In step mode this blocks until the user presses "Step"; otherwise resolves immediately.
   */
  stage(label: string): Promise<void>;
}

export type ValidationResult = 'OK' | 'DOUBLE' | 'SKEW';

/**
 * Physical mechanism driver. The 3D layer animates each call and resolves when the motion finishes.
 * The domain layer has already decided WHAT happens; the driver only shows it. A no-op driver is used in tests.
 */
export interface MechanismDriver {
  cardIn(method: 'chip' | 'contactless'): Promise<void>;
  cardEject(): Promise<void>;
  cardRetain(): Promise<void>;
  /** Picker pulls one note off cassette onto the transport. */
  pickNote(note: Note, cassette: CassetteId): Promise<void>;
  /** Note passes thickness / double-detect / skew sensors. */
  validateNote(note: Note, result: ValidationResult): Promise<void>;
  /** Diverter gate sends note to the reject cassette. */
  divertToReject(note: Note): Promise<void>;
  /** Belts carry note into the stacker wheel; it joins the staged bundle. */
  stackNote(note: Note): Promise<void>;
  /** Note stops in the transport (cash jam). */
  jamNote(note: Note): Promise<void>;
  /** Stacker clamps bundle → presenter belts move it to the shutter → shutter opens. */
  presentBundle(notes: Note[]): Promise<void>;
  /** Customer took the bundle (visual removal) and shutter closes. */
  bundleCollected(notes: Note[]): Promise<void>;
  /** Presenter pulls an uncollected bundle back into the retract bin; shutter closes. */
  retractBundle(notes: Note[]): Promise<void>;
  /** Notes left in transport/stacker are purged to the reject cassette (after jam clear / power restore). */
  purge(notes: Note[], to: 'reject' | 'retract'): Promise<void>;
  printReceipt(lines: string[]): Promise<void>;
  /** Customer inserts notes into deposit slot → escrow (validator scans each). */
  depositIntake(notes: Note[]): Promise<void>;
  depositStore(notes: Note[]): Promise<void>;
  depositReturn(notes: Note[]): Promise<void>;
  /** Visual cue for a component (fault highlight, led, vibration). */
  setComponentAlert(id: ComponentId, level: DeviceStatus): void;
}

/** Customer actions the ATM must wait for. The UI resolves these when the user clicks the 3D cash / card. */
export interface CustomerPort {
  /** Resolve 'collected' when the user takes the cash, or 'timeout' after `timeoutMs` of sim time. */
  awaitCashCollection(timeoutMs: number): Promise<'collected' | 'timeout'>;
  awaitCardTaken(timeoutMs: number): Promise<'taken' | 'timeout'>;
}

// ───────────────────────────── Events ─────────────────────────────

export interface SimEvents {
  'txn.created': { txn: Transaction };
  'txn.state': { txn: Transaction; from: TxnState; to: TxnState; note: string };
  'net.message': { from: NetworkNode; to: NetworkNode; direction: 'request' | 'response'; request: HostRequest; response?: HostResponse; dropped?: boolean };
  'note.moved': { note: Note; from: NoteLocation; to: NoteLocation };
  'inventory.changed': { snapshot: InventorySnapshot };
  'ledger.changed': { accountIds: string[] };
  'device.changed': { device: DeviceHealth };
  'fault.armed': { id: FaultId };
  'fault.cleared': { id: FaultId };
  'mech.stage': { label: string };
  'journal': { entry: JournalEntry };
  'audit': { entry: AuditEntry };
  'screen.changed': { screen: ScreenState };
  /** Customer-visible ATM hardware cues for the UI/3D layer (lead-through lights, beeps). */
  'atm.cue': { cue: 'card-light' | 'cash-light' | 'receipt-light' | 'deposit-light' | 'beep' | 'error-beep'; on?: boolean };
  'reset': Record<string, never>;
}

// ───────────────────────────── ATM screen (headless application state) ─────────────────────────────

export type ScreenId =
  | 'OUT_OF_SERVICE'
  | 'WELCOME'
  | 'READING_CARD'
  | 'PIN_ENTRY'
  | 'PROCESSING'
  | 'MAIN_MENU'
  | 'ACCOUNT_SELECT'
  | 'AMOUNT_ENTRY'
  | 'DEPOSIT_INSERT'
  | 'DEPOSIT_CONFIRM'
  | 'TRANSFER_TO'
  | 'TAKE_CASH'
  | 'RESULT'
  | 'RECEIPT_PRINTING'
  | 'ANOTHER_TXN'
  | 'TAKE_CARD'
  | 'CARD_RETAINED'
  | 'GOODBYE'
  | 'SERVICE_MODE';

export interface ScreenButton {
  /** Stable id passed back in `{ kind: 'touch', target }`. */
  id: string;
  label: string;
  enabled: boolean;
  /** Visual emphasis. */
  style?: 'primary' | 'normal' | 'danger';
}

/**
 * Everything the ATM display needs to render. Generic on purpose: the renderer draws
 * title, lines, an optional input field, and a grid of touch buttons.
 */
export interface ScreenState {
  id: ScreenId;
  title: string;
  lines: string[];
  buttons: ScreenButton[];
  /** Text entry field (PIN shows masked dots, amount shows digits). */
  input?: { label: string; value: string; masked: boolean };
  tone: 'normal' | 'busy' | 'warn' | 'error' | 'success';
  /** Remaining sim-ms for timed screens (take cash / take card). */
  countdownMs?: number;
  footer?: string;
}

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'CANCEL' | 'CLEAR' | 'ENTER' | 'BLANK';

export type AtmInput =
  | { kind: 'touch'; target: string }
  | { kind: 'key'; key: KeypadKey }
  | { kind: 'card'; cardId: string; method: 'chip' | 'contactless' };
