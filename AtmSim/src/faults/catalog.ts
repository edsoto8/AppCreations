import type { FaultDefinition, FaultId } from '../core/types';

/**
 * Training fault catalogue. Each entry explains, in plain language, what happens inside a generic ATM
 * and at the bank, so learners connect the physical symptom to the money outcome.
 *
 * Golden rule taught throughout: a failure at the ATM NEVER means the customer was charged. Authorisation
 * only places a hold; money is posted only when the ATM confirms the cash was taken.
 */
export const FAULTS: FaultDefinition[] = [
  {
    id: 'insufficient-funds',
    title: 'Insufficient funds',
    category: 'ACCOUNT',
    explanation:
      'The customer asks for more than the AVAILABLE balance (posted balance minus existing holds). The ATM itself is healthy: it plans the notes, then sends a WITHDRAWAL_AUTH to the bank. The authorisation host compares the amount with the available balance and declines with response code 51.',
    components: ['display', 'controller-pc', 'comms'],
    transactionOutcome: 'CREATED → AUTH_PENDING → DECLINED (code 51). No hold is placed, nothing is posted and the dispenser never moves.',
    customerOutcome: '"Sorry, there are not enough available funds in this account. Your account has not been charged." The customer can try a smaller amount.',
    recovery: [
      'No technician action: the ATM worked correctly.',
      'Customer may choose a smaller amount or another account.',
      'Explain that available balance can be lower than the posted balance because of pending holds.',
    ],
    demo: { cardId: 'card-sam', amountCents: 10_000, txn: 'WITHDRAWAL' },
    latching: false,
  },
  {
    id: 'insufficient-atm-cash',
    title: 'ATM has insufficient cash',
    category: 'CASH',
    explanation:
      'The cassettes do not hold enough notes for the request. The ATM checks its own LOGICAL counters before contacting the bank, so it rejects the request locally. (Arming this fault moves most notes from the cassettes back to the branch vault, simulating a busy day — the notes are moved, never destroyed, and the move is journaled.)',
    components: ['cassette-A', 'cassette-B', 'cassette-C', 'dispenser', 'controller-pc'],
    transactionOutcome: 'CREATED → CANCELLED locally (INSUFFICIENT_ATM_CASH). The bank is never asked, so no hold exists.',
    customerOutcome: '"Sorry, this ATM cannot dispense that amount right now." The screen suggests the maximum it can pay out.',
    recovery: [
      'Open the vault door and check the cassette counters on the operator panel.',
      'Replenish the cassettes from the vault (respecting each cassette\'s capacity).',
      'Record the replenishment so end-of-day reconciliation balances.',
      'Exit service mode; the ATM returns to full service.',
    ],
    demo: { cardId: 'card-alex', amountCents: 40_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
  {
    id: 'unsupported-amount',
    title: 'Unsupported amount',
    category: 'CUSTOMER',
    explanation:
      'The amount breaks the ATM\'s withdrawal rules: it is not a multiple of the smallest note step ($10), or is below the minimum / above the maximum per withdrawal. This is validated on the ATM before anything else happens.',
    components: ['display', 'keypad', 'controller-pc'],
    transactionOutcome: 'CREATED → CANCELLED locally (UNSUPPORTED_AMOUNT). No host message, no hold.',
    customerOutcome: '"Please enter an amount in multiples of $10 between $20 and $800."',
    recovery: ['No technician action.', 'Customer re-enters a valid amount.'],
    demo: { cardId: 'card-alex', amountCents: 3_500, txn: 'WITHDRAWAL' },
    latching: false,
  },
  {
    id: 'no-feasible-combination',
    title: 'Amount cannot be made from the loaded notes',
    category: 'CASH',
    explanation:
      'The amount is a valid multiple of $10, but no combination of the denominations currently loaded can make it exactly. With $20, $50 and $100 notes, $30 is impossible ($10 notes are not loaded). The dispense planner searches every combination before giving up.',
    components: ['cassette-A', 'cassette-B', 'cassette-C', 'dispenser', 'controller-pc'],
    transactionOutcome: 'CREATED → CANCELLED locally (NO_FEASIBLE_COMBINATION). No host message, no hold.',
    customerOutcome: '"Sorry, this ATM can\'t make that exact amount." The screen suggests the nearest amounts it can pay (e.g. $20 or $40).',
    recovery: [
      'No fault in the machine.',
      'If it happens often, consider loading a $10 cassette (reconfigure a cassette denomination).',
    ],
    demo: { cardId: 'card-alex', amountCents: 3_000, txn: 'WITHDRAWAL' },
    latching: false,
  },
  {
    id: 'low-cash-warning',
    title: 'Low cash warning',
    category: 'CASH',
    explanation:
      'A cassette\'s counter has fallen to or below its low threshold (10% of a full load). The ATM keeps dispensing but raises a WARNING to the monitoring system so cash-in-transit can be scheduled before it runs out. (Arming moves notes from cassette A to the vault, journaled as a trainer action.)',
    components: ['cassette-A', 'dispenser', 'status-leds'],
    transactionOutcome: 'Withdrawals still complete normally (COMPLETED). The dispenser device reports WARNING.',
    customerOutcome: 'No visible impact unless the cassette empties; the customer gets their cash.',
    recovery: [
      'Monitoring flags "cassette A low".',
      'Schedule replenishment; load notes from the vault into cassette A.',
      'Confirm the cassette status returns to OK.',
    ],
    demo: { cardId: 'card-alex', amountCents: 6_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
  {
    id: 'cash-jam',
    title: 'Cash jam in the transport',
    category: 'MECHANICAL',
    explanation:
      'A note stops on the transport belts between the picker and the stacker (worn notes, a fold, a dirty sensor). The jam sensor trips, the dispenser stops and reports a FAULT. The notes already picked stay inside the machine — they are never presented to the customer.',
    components: ['transport', 'dispenser', 'stacker', 'validation-sensors'],
    transactionOutcome:
      'AUTHORIZED → DISPENSING → DISPENSE_FAILED → REVERSAL_PENDING → REVERSED. The ATM sends a REVERSAL so the bank releases the hold; nothing is posted.',
    customerOutcome: '"Sorry, we could not dispense your cash. Your account has not been charged." Cash withdrawals become unavailable; other services stay available.',
    recovery: [
      'Enter service mode and open the vault door.',
      'Remove the dispenser module and clear the jammed note(s).',
      'Purge the notes left in the transport/stacker to the reject cassette (clearJam).',
      'Run a dispenser test; confirm counters and the reject cassette increased.',
      'Exit service mode.',
    ],
    demo: { cardId: 'card-alex', amountCents: 20_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
  {
    id: 'pick-failure',
    title: 'Pick failure',
    category: 'MECHANICAL',
    explanation:
      'The picker rollers repeatedly fail to pull a note off a cassette (worn rollers, notes stuck together, cassette not seated). After several retries the cassette and dispenser are marked FAULT and the dispense is abandoned.',
    components: ['picker-rollers', 'cassette-A', 'cassette-B', 'cassette-C', 'dispenser'],
    transactionOutcome: 'DISPENSING → DISPENSE_FAILED → REVERSAL_PENDING → REVERSED. Any notes already stacked stay in the dispenser until purged.',
    customerOutcome: '"Sorry, we could not dispense your cash. Your account has not been charged."',
    recovery: [
      'Inspect the picker rollers and reseat the cassette.',
      'Purge stacked notes to reject (clear jam).',
      'Reset the dispenser device and run a dispenser test.',
    ],
    demo: { cardId: 'card-alex', amountCents: 10_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
  {
    id: 'note-rejected',
    title: 'Note rejected (double / skewed)',
    category: 'MECHANICAL',
    explanation:
      'The validation sensors measure every picked note. A note that is too thick (two notes stuck together — a "double") or skewed is diverted by the gate into the reject cassette and the picker picks a replacement. This is normal behaviour and protects both bank and customer.',
    components: ['validation-sensors', 'reject-cassette', 'transport', 'picker-rollers'],
    transactionOutcome: 'The withdrawal still COMPLETES. The cassette counter drops by one extra note and the reject cassette gains one note.',
    customerOutcome: 'No impact: the customer receives exactly the requested amount.',
    recovery: [
      'No immediate action.',
      'Empty the reject cassette during the next visit and include it in reconciliation.',
      'Frequent rejects suggest poor note quality or dirty sensors.',
    ],
    demo: { cardId: 'card-alex', amountCents: 6_000, txn: 'WITHDRAWAL' },
    latching: false,
  },
  {
    id: 'printer-out-of-paper',
    title: 'Receipt printer out of paper',
    category: 'PERIPHERAL',
    explanation:
      'The receipt printer\'s paper-out sensor trips. The ATM keeps working but switches off the receipt option and tells customers up front ("Receipts unavailable").',
    components: ['receipt-printer', 'receipt-slot'],
    transactionOutcome: 'Transactions COMPLETE normally; no receipt is printed (the electronic journal still records everything).',
    customerOutcome: '"Receipts unavailable" on the welcome and result screens. The balance is shown on screen instead.',
    recovery: ['Open the service door.', 'Load a new paper roll and feed it through the printer.', 'Print a test receipt.'],
    demo: { cardId: 'card-alex', amountCents: 4_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
  {
    id: 'card-reader-unavailable',
    title: 'Card reader unavailable',
    category: 'PERIPHERAL',
    explanation:
      'The motorised card reader reports a fault (dirty contacts, shutter stuck). Inserted cards cannot be read. Contactless cards can still be tapped on the separate contactless reader, so the ATM stays partly in service.',
    components: ['card-reader', 'card-reader-module', 'contactless-reader'],
    transactionOutcome: 'No transaction is created when a card cannot be read. With a contactless tap the transaction proceeds normally.',
    customerOutcome: '"Sorry, we can\'t read inserted cards right now. Please tap your card or use another ATM."',
    recovery: ['Open the service door.', 'Clean the card reader with a cleaning card; check the shutter.', 'Reset the card reader device and test it.'],
    demo: { cardId: 'card-alex', amountCents: 4_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
  {
    id: 'network-timeout',
    title: 'Network timeout (response lost)',
    category: 'COMMUNICATION',
    explanation:
      'The authorisation request reaches the bank, which APPROVES it and places a hold — but the response is lost on the way back. The ATM waits for its timeout, then must assume the worst: it does not dispense and sends a REVERSAL for the original STAN. The bank releases the hold it placed. This is why an ATM timeout must never be treated as "the account was not touched" without a reversal.',
    components: ['comms', 'controller-pc'],
    transactionOutcome: 'AUTH_PENDING → TIMED_OUT → REVERSAL_PENDING → REVERSED (code 68 recorded). The hold placed by the host is released.',
    customerOutcome: '"Sorry, your bank did not respond in time. Your account has not been charged."',
    recovery: [
      'Usually transient: no action for a single event.',
      'Check the journal: every timeout must be followed by a successful reversal.',
      'If reversals cannot be delivered they are queued (store-and-forward) and retried.',
    ],
    demo: { cardId: 'card-alex', amountCents: 10_000, txn: 'WITHDRAWAL' },
    latching: false,
  },
  {
    id: 'host-unavailable',
    title: 'Bank host unavailable',
    category: 'COMMUNICATION',
    explanation:
      'The network switch cannot reach the bank\'s authorisation host (maintenance window, link down). The switch answers on the host\'s behalf with code 91 "issuer unavailable". Because the request never reached the host, no hold exists.',
    components: ['comms', 'controller-pc'],
    transactionOutcome: 'AUTH_PENDING → DECLINED (code 91). No hold, nothing posted.',
    customerOutcome: '"Sorry, we can\'t reach your bank right now. Your account has not been charged." After the session the ATM shows Out of Service until the link is restored.',
    recovery: [
      'Check the network link and the switch status page.',
      'Contact the bank\'s operations centre.',
      'When the host is back, reset the host link; queued messages are sent and the ATM returns to service.',
    ],
    demo: { cardId: 'card-alex', amountCents: 10_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
  {
    id: 'cash-not-collected',
    title: 'Cash not collected',
    category: 'CUSTOMER',
    explanation:
      'The customer walks away without taking the presented cash. After the take-cash timeout the presenter pulls the bundle back into the retract bin. Under this (generic) bank policy the ATM then sends a REVERSAL so the customer is not charged; the retracted notes are counted at reconciliation. Policies differ between banks.',
    components: ['presenter-shutter', 'cash-slot', 'retract-bin'],
    transactionOutcome: 'PRESENTED → RETRACTED → REVERSAL_PENDING → REVERSED. Retracted notes are journaled for reconciliation.',
    customerOutcome: '"Your cash was not taken and has been retained for your security. Your account has not been charged."',
    recovery: [
      'No immediate action.',
      'At the next visit empty the retract bin and count it against the journal.',
      'Investigate any customer claim using the journal and the retract count.',
    ],
    demo: { cardId: 'card-alex', amountCents: 8_000, txn: 'WITHDRAWAL' },
    latching: false,
  },
  {
    id: 'power-loss',
    title: 'Power loss during dispensing',
    category: 'POWER',
    explanation:
      'Power fails while notes are being picked. When the ATM restarts it cannot know exactly what happened physically, so the transaction is marked SUSPECT. On recovery the notes left in the transport/stacker are purged to reject, the transaction is reversed because no cash was presented, and the customer\'s card is retained for safety.',
    components: ['power-supply', 'dispenser', 'transport', 'stacker', 'controller-pc'],
    transactionOutcome: 'DISPENSING → SUSPECT, then (after restorePower) SUSPECT → REVERSAL_PENDING → REVERSED.',
    customerOutcome: 'Screen goes dark / "Temporarily out of service". The customer is not charged; the card is retained and can be returned after identity checks.',
    recovery: [
      'Restore power and let the ATM restart.',
      'ATM purges notes to the reject cassette and reverses the SUSPECT transaction.',
      'Collect retained cards and return them to their owners after identity checks.',
      'Reconcile the reject cassette.',
    ],
    demo: { cardId: 'card-alex', amountCents: 30_000, txn: 'WITHDRAWAL' },
    latching: true,
  },
];

const byId = new Map(FAULTS.map((f) => [f.id, f]));

export function faultById(id: FaultId): FaultDefinition | undefined {
  return byId.get(id);
}
