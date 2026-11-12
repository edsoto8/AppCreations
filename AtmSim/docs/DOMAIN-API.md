# Domain API (contract between domain and presentation)

All types referenced come from `src/core/types.ts`. Domain code must not import three.js or touch the DOM.

## Composition root — `src/app/AtmSystem.ts`

```ts
export interface AtmSystemDeps {
  bus: EventBus; clock: SimClock; mech: MechanismDriver; customer: CustomerPort; seed?: number;
}
export interface AtmConfig {
  strategy: DispenseStrategy;          // default 'min-notes'
  maxNotesPerDispense: number;         // 40 (presenter capacity)
  minWithdrawalCents: Cents;           // $20
  maxWithdrawalCents: Cents;           // $800
  amountMultipleCents: Cents;          // $10
  cashTakeTimeoutMs: number;           // 30_000 sim-ms
  cardTakeTimeoutMs: number;           // 30_000 sim-ms
  hostHopLatencyMs: number;            // per hop, ~350
  hostTimeoutMs: number;               // 8_000
  reversalOnRetract: boolean;          // true (bank policy varies — labelled generic)
  terminalId: string;                  // 'TRN-ATM-0001'
}
export class AtmSystem {
  constructor(deps: AtmSystemDeps);
  readonly bus: EventBus; readonly clock: SimClock;
  config: AtmConfig;
  ledger: Ledger; host: AuthorizationHost; network: Network;
  inventory: CashInventory; devices: DeviceManager; faults: FaultState;
  journal: Journal; engine: TransactionEngine; app: AtmApp;
  operator: OperatorConsole; recon: Reconciliation;
  /** Restore the initial training state (same seed → same state). Emits 'reset'. */
  reset(): void;
  /** [] when healthy; otherwise human-readable violations. */
  checkInvariants(): string[];
}
```

## Seed data (fictional)

Bank: "Meridian Training Bank". Cards use prefix 9990 (never issued). Demo PINs are displayed in the UI.

| cardId | holder | PIN | accounts | persona |
|---|---|---|---|---|
| `card-alex` | Alex Rivera | 1234 | CHK-1001 Everyday Checking $2,450.75 · SAV-1002 Savings $8,120.00 | Healthy balances, contactless |
| `card-sam` | Sam Okafor | 2468 | CHK-2001 Checking $35.40 | Low balance (insufficient funds demo) |
| `card-jordan` | Jordan Lee | 1111 | CHK-3001 Checking $640.00 (status FROZEN) · SAV-3002 $1,000.00 | Frozen checking account |
| `card-blocked` | Casey Moreau | 0000 | CHK-4001 $300.00 | Card status BLOCKED |

Daily withdrawal limit $1,000 per account. Customer wallet starts with 10 × $20, 4 × $50, 2 × $100 training
notes (for deposits). Cassettes: A $20 × 2,000 (cap 2,500) · B $50 × 1,000 (cap 2,000) · C $100 × 500
(cap 2,000) · low threshold 10% of the initial load. Branch vault: 3,000 × $20, 1,500 × $50, 1,000 × $100,
500 × $10. Reject / retract / deposit empty.

## Ledger — `banking/ledger.ts`
`accounts`, `customers`, `cards` maps; `available(id)`, `placeHold(accountId, txnId, cents)`,
`releaseHold(holdId)`, `post(txnId, description, legs)` (throws if legs don't sum to 0),
`statement(accountId, n)`, `customerWealthCents()` (Σ customer ledger balances), `snapshot()`.

## Host — `banking/host.ts`
`AuthorizationHost.handle(req: HostRequest): HostResponse` — pure, synchronous logic:
- `CARD_AUTH`: card status (BLOCKED→62, EXPIRED→54, RETAINED→14), PIN check via simulated pin block
  (wrong → 55 and decrement tries; tries hit 0 → 75 and card BLOCKED), returns linked `accounts`.
- `BALANCE_INQUIRY`: ledger + available.
- `WITHDRAWAL_AUTH`: frozen→57, over daily limit→61, available < amount→51, else place hold, `authCode`.
- `WITHDRAWAL_COMPLETION`: post `dispensedCents` (Dr customer / Cr GL-ATM-CASH), release hold, bump daily usage.
- `REVERSAL`: release hold (idempotent; unknown stan → still 00 "nothing to reverse").
- `DEPOSIT`: post credit (Dr GL-ATM-CASH / Cr customer). `TRANSFER`: post both legs; 51 if insufficient.
- `MINI_STATEMENT`: last 6 lines.
Simulated PIN block: `makePinBlock(pin, cardToken, stan)` returns `"SIMPIN-" + 8 hex` from a toy FNV hash.

## Network — `banking/network.ts`
`Network.send(req): Promise<{ response?: HostResponse; timedOut: boolean }>` walks ATM→CONTROLLER→SWITCH→HOST
→LEDGER and back, `clock.wait(hostHopLatencyMs)` per hop, emits `net.message` for every hop
(`direction` request/response). Faults: `host-unavailable` (latching) → SWITCH answers code 91 without reaching
HOST; `network-timeout` (one-shot) → request reaches HOST and is processed (hold placed!) but the response is
dropped (`dropped: true`), ATM waits `hostTimeoutMs` then returns `timedOut: true`.

## Cash — `cash/inventory.ts`, `cash/dispense.ts`
`CashInventory`: `notes: Note[]`, `cassettes: Record<CassetteId, CassetteState>`, `notesAt(loc)`,
`move(note, to)` (emits `note.moved`), `takeFromCassette(id)` (top note; decrements counter), `snapshot()`
(InventorySnapshot), `totals` since baseline, `countByDenom(loc)`.
`planDispense(amountCents, cassettes, strategy, limits): PlanResult` — pure; uses counters of installed,
non-FAULT cassettes; exact search (bounded DP / backtracking), never plans notes that aren't available.
`UNSUPPORTED_AMOUNT` (below min, above max, not a multiple) · `INSUFFICIENT_ATM_CASH` (amount > available)
· `NO_FEASIBLE_COMBINATION` (e.g. $30 with $20/$50/$100) · `TOO_MANY_NOTES`.
Strategies: `min-notes` (fewest notes), `balanced` (prefers cassettes with the highest fill ratio),
`small-notes` (most small notes up to the note limit).

## Transactions — `transactions/`
`stateMachine.ts`: `ALLOWED: Record<TxnState, TxnState[]>`, `transition(txn, to, note, time)` (throws on illegal).
`journal.ts`: `Journal` with `entries: JournalEntry[]`, `audit: AuditEntry[]`, `transactions: Transaction[]`,
`log(kind, text, txnId?)`, `auditLog(actor, action, detail?)`; emits `journal`/`audit` events.
`engine.ts`: `TransactionEngine` — performs the physical + host work. Each major step calls
`clock.stage(label)` first (labels are shown in the timeline, e.g. "Request authorization",
"Pick 3 × $20 from cassette A", "Validate note", "Stack notes", "Present cash", "Wait for customer").
```ts
readCard(cardId, method): Promise<{ ok: boolean; reason?: string }>      // mech.cardIn; card-reader fault
verifyPin(pin): Promise<{ ok: boolean; code: ResponseCode; triesLeft: number; retained: boolean; accounts?: ... }>
balance(accountId): Promise<TxnResult>
withdraw(accountId, amountCents): Promise<TxnResult>   // full 14-step flow incl. dispense/present/collect/post or reverse
depositIntake(counts: DenomCounts): Promise<{ escrow: DenomCounts; returned: number; totalCents: Cents }>
depositConfirm(accountId): Promise<TxnResult>; depositCancel(): Promise<void>
transfer(fromId, toId, amountCents): Promise<TxnResult>
miniStatement(accountId): Promise<TxnResult & { lines: StatementLine[] }>
printReceipt(lines: string[]): Promise<boolean>        // false when printer unavailable
ejectCard(): Promise<'taken' | 'retained'>               // waits customer.awaitCardTaken
interface TxnResult { txn: Transaction; ok: boolean; message: string; receipt: string[] }
```
Withdrawal sequence (each line a stage): validate amount → verify dispensable denominations (plan) → request
authorization (hold) → pick notes cassette by cassette (pick → validate → stack; a DOUBLE/SKEW note is diverted
to reject and replaced by another pick) → present bundle (shutter opens) → wait for customer (CustomerPort,
`cashTakeTimeoutMs`) → collected: send COMPLETION (post) → COMPLETED; timeout: retract → REVERSAL → REVERSED.
Jam / pick failure → DISPENSE_FAILED → REVERSAL → REVERSED, notes stay in transport/stacker until the operator
clears the jam. Power loss → SUSPECT; `operator.restorePower()` purges notes, reverses, journals.

## ATM application — `app/AtmApp.ts`
Headless screen flow. `screen: ScreenState`, `input(i: AtmInput): void` (never throws; async work runs in the
background; inputs ignored while busy except CANCEL where meaningful), `busy: boolean`, `sessionActive`,
`settle(): Promise<void>` (resolves when no background flow is running), emits `screen.changed` and `atm.cue`.
Screens: WELCOME → (card) READING_CARD → PIN_ENTRY (keypad digits, ENTER, CLEAR, CANCEL; 3 tries) → PROCESSING →
MAIN_MENU (withdraw, deposit, balance, transfer, statement, end) → ACCOUNT_SELECT → AMOUNT_ENTRY (quick amounts
$20 $40 $60 $100 $200 $500 + keypad entry) → PROCESSING → TAKE_CASH (countdown) → RESULT (receipt? yes/no) →
RECEIPT_PRINTING → ANOTHER_TXN → TAKE_CARD → GOODBYE → WELCOME. Deposit: DEPOSIT_INSERT (+/− buttons per
denomination limited by the wallet) → DEPOSIT_CONFIRM. Transfer: ACCOUNT_SELECT(from) → TRANSFER_TO → AMOUNT_ENTRY.
OUT_OF_SERVICE when power is lost or no card entry method / dispenser works; SERVICE_MODE while the operator
console is active. Touch button ids are stable strings (e.g. `menu-withdraw`, `acct-CHK-1001`, `amt-6000`,
`receipt-yes`, `dep-plus-20`) — tests rely on them.

## Faults — `faults/`
`catalog.ts`: `FAULTS: FaultDefinition[]` (all 14 `FaultId`s with explanation, components, outcomes,
recovery steps, demo). `FaultState`: `arm(id)`, `disarm(id)`, `isArmed(id)`, `consume(id)` (one-shot), `armed`.
Arming `insufficient-atm-cash` / `low-cash-warning` moves notes from cassettes to the vault (journaled
trainer action — money is never destroyed). `autopilot.ts`: `runScenario(sys, faultId, hooks)` where
`hooks = { collectCash(): void; takeCard(): void; onStep(text: string): void }` drives `sys.app.input` through the
demo (arm fault → insert card → PIN → transaction) and returns `{ txn?: Transaction; summary: string }`.

## Maintenance — `maintenance/`
`devices.ts`: `DeviceManager` (`get(id)`, `set(id, status, detail)`, `all()`, metrics: printer paper %, picks,
card reads). `operator.ts`: `OperatorConsole`:
`enter()` / `exit()` (only between sessions; ATM shows SERVICE_MODE), `replenish(id, notes)` (vault → cassette,
respects capacity), `removeCassette(id)` / `installCassette(id)`, `reconfigureCassette(id, denom, notes)`
(returns notes to vault, reloads), `clearJam()`, `loadPaper()`, `resetDevice(id)`, `restorePower()`,
`emptyBin('reject' | 'retract' | 'deposit')` (→ vault, recorded for reconciliation), `returnRetainedCards()`,
`runTest(deviceId): Promise<{ passed: boolean; lines: string[] }>` (dispenser test picks 1 note per cassette to
reject), `checklist: { id, label, done }[]` (auto-ticks as actions are done).

## Reconciliation — `reconciliation/`
`Reconciliation`: `baseline` (per-cassette counts + bins at start of business day), `report(): ReconReport`
(beginning, replenishments, dispensed per journal, deposits, rejected, retracted, expected ending, counters,
physical count, per-cassette differences, `differences: { severity, title, explanation }[]`, `balanced`),
`injectDiscrepancy(kind: 'missing-notes' | 'counter-error' | 'misloaded-note')`, `closeDay()` (new baseline).
