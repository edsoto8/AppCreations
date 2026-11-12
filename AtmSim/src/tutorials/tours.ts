import type { Tour } from './TourRunner';
import type { Ctx } from '../ui/context';
import { ensureIdle, pressKeys, touch, touchPrefix, waitFor, waitScreen, waitTxn, takeWhenPresented } from './drive';
import type { TourRun } from './TourRunner';

/** Start a customer session with the demo card and get to the main menu. */
async function signIn(ctx: Ctx, run: TourRun, method: 'chip' | 'contactless' = 'chip'): Promise<boolean> {
  run.status('Getting the ATM ready…');
  if (!(await ensureIdle(ctx, run))) return false;
  ctx.ui.setActiveCard('card-alex');
  run.status('Inserting the training card…');
  ctx.ui.insertCard(method);
  if (!(await waitScreen(ctx, ['PIN_ENTRY'], run))) return false;
  run.status('Entering the demo PIN 1234 on the keypad…');
  await pressKeys(ctx, ['1', '2', '3', '4', 'ENTER'], run);
  return waitScreen(ctx, ['MAIN_MENU'], run);
}

export const TOURS: Tour[] = [
  // ───────────────────────────── 1 ─────────────────────────────
  {
    id: 'exterior',
    title: 'ATM exterior',
    summary: 'Walk through every customer-facing component.',
    steps: [
      { title: 'A freestanding lobby ATM', text: 'This is a generic modern <b>freestanding lobby ATM</b>: an upper cabinet with the customer interface and a heavy lower <b>safe</b> that holds the cash. Drag to orbit, scroll to zoom. Everything here — the bank, cards and notes — is fictional.', mode: 'inspect', view: 'exterior', camera: 'front', select: 'cabinet' },
      { title: 'Illuminated topper sign', text: 'The <b>topper</b> identifies the operator and is visible across the lobby. It is lit by LEDs and often shows the networks the ATM accepts.', camera: { part: 'topper-sign' }, highlight: ['topper-sign'], select: 'topper-sign' },
      { title: 'Display and privacy hood', text: 'The <b>display</b> guides the customer through each step. The surrounding hood and viewing angle limit shoulder-surfing. Above it sits the <b>security camera</b> housing.', camera: 'screen', highlight: ['display', 'camera'], select: 'display' },
      { title: 'PIN pad', text: 'The <b>keypad</b> is an encrypting PIN pad in real machines: the PIN is encrypted inside the keypad and never leaves it in clear text. Note the tactile dot on 5 and the coloured CANCEL / CLEAR / ENTER keys. In this simulator the “encryption” is a labelled toy.', camera: 'keypad', highlight: ['keypad'], select: 'keypad' },
      { title: 'Card reader & contactless reader', text: 'The <b>card slot</b> feeds a motorised reader that reads the chip; its lit throat flashes when a card is expected. The <b>contactless pad</b> lets a card (or phone) be tapped instead — the card never enters the machine.', camera: { part: 'card-reader' }, highlight: ['card-reader', 'contactless-reader'], select: 'card-reader' },
      { title: 'Cash slot', text: 'Cash is presented through a shuttered <b>cash slot</b>. The shutter only opens when a bundle is ready and closes again after the cash is taken — or after a timeout, when the cash is retracted.', camera: { part: 'cash-slot' }, highlight: ['cash-slot'], select: 'cash-slot' },
      { title: 'Receipt & deposit slots', text: 'The <b>receipt slot</b> delivers printed receipts; the <b>deposit slot</b> accepts notes into an escrow where they are counted and checked before the customer confirms.', camera: 'front', highlight: ['receipt-slot', 'deposit-slot'], select: 'receipt-slot' },
      { title: 'Speakers & accessibility', text: 'The <b>speaker grilles</b> provide audio prompts; the <b>headphone jack</b> and tactile/braille markings support customers with visual impairments (audio guidance mode).', camera: 'front', highlight: ['speakers', 'accessibility'], select: 'accessibility' },
      { title: 'Service door, vault door & indicators', text: 'Authorised staff open the hinged <b>service door</b> to reach the upper electronics, and the <b>vault door</b> (under dual control) to reach the cash. <b>Status LEDs</b> show service state; the lead-through lights next to each slot blink when that slot needs the customer’s attention.', camera: { position: [1.35, 1.2, 1.7], target: [0, 0.75, 0] }, highlight: ['service-door', 'vault-door', 'locks-hinges', 'status-leds'], select: 'vault-door' },
    ],
  },
  // ───────────────────────────── 2 ─────────────────────────────
  {
    id: 'withdrawal',
    title: 'Cash withdrawal',
    summary: 'Perform a complete withdrawal and follow the notes through the machine.',
    steps: [
      { title: 'Goal: withdraw $180', text: 'We will withdraw <b>$180</b> from Alex Rivera’s checking account and follow every stage. Use the timeline at the bottom to <b>pause</b>, slow down to <b>0.25×</b> or <b>step</b> stage by stage at any time.', mode: 'customer', view: 'exterior', camera: 'front', tab: 'transaction' },
      {
        title: '1–2 · Insert card, ATM reads it',
        text: 'The card is drawn into the motorised reader and the chip is read. Only a fictional token is used — no real card data exists in this simulator.',
        camera: { part: 'card-reader' },
        highlight: ['card-reader'],
        action: async (ctx, run) => {
          if (!(await ensureIdle(ctx, run))) return;
          ctx.ui.setActiveCard('card-alex');
          ctx.ui.insertCard('chip');
          await waitScreen(ctx, ['PIN_ENTRY'], run);
          run.status('Card read — the ATM now asks for the PIN.');
        },
      },
      {
        title: '3 · Enter the PIN',
        text: 'The PIN is typed on the keypad. The ATM turns it into a (simulated) <b>PIN block</b> and sends it to the bank host with the card token. The host verifies it — the ATM never decides on its own.',
        camera: 'keypad',
        highlight: ['keypad'],
        action: async (ctx, run) => {
          await pressKeys(ctx, ['1', '2', '3', '4', 'ENTER'], run);
          await waitScreen(ctx, ['MAIN_MENU'], run);
          run.status('PIN verified by the host (CARD_AUTH, code 00).');
        },
      },
      {
        title: 'Choose withdrawal, account and amount',
        text: 'The customer selects <b>Withdraw cash</b>, the <b>checking</b> account and types <b>180</b> on the keypad. Before asking the bank, the ATM checks the amount rules and that its cassettes can make $180 exactly.',
        camera: 'screen',
        action: async (ctx, run) => {
          await touch(ctx, 'menu-withdraw', run);
          if (await waitScreen(ctx, ['ACCOUNT_SELECT', 'AMOUNT_ENTRY'], run)) {
            if (ctx.sys.app.screen.id === 'ACCOUNT_SELECT') {
              if (!(await touch(ctx, 'acct-CHK-1001', run))) await touchPrefix(ctx, 'acct-', run);
              await waitScreen(ctx, ['AMOUNT_ENTRY'], run);
            }
          }
          await pressKeys(ctx, ['1', '8', '0'], run);
          run.status('Amount entered — next: authorization.');
        },
      },
      {
        title: '4–7 · Authorization by the host',
        text: 'The ATM sends <b>WITHDRAWAL_AUTH</b> through the controller and switch to the bank host. The host checks the account status, daily limit and <b>available funds</b>, then approves and places a <b>hold</b>. Watch the network strip at the top and the <i>Holds</i> column in the Transaction tab — nothing is debited yet.',
        camera: 'front',
        tab: 'transaction',
        action: async (ctx, run) => {
          await pressKeys(ctx, ['ENTER'], run);
          await waitTxn(ctx, ['AUTHORIZED', 'DECLINED', 'TIMED_OUT'], run);
          run.status('Approved: a hold now reduces the available balance.');
        },
      },
      {
        title: '8 · Notes are picked from the cassettes',
        text: 'Inside the safe, the <b>picker rollers</b> peel notes one at a time off the cassettes ($100 from C, then $20s from A). Each note passes the <b>sensor gate</b> that checks thickness (double notes) and skew; a bad note is diverted to the <b>reject cassette</b>.',
        view: 'xray',
        arrows: true,
        camera: 'dispenser',
        highlight: ['picker-rollers', 'cassette-A', 'cassette-C'],
        action: async (ctx, run) => {
          await waitTxn(ctx, ['DISPENSING'], run);
          run.status('Dispensing — use 0.25× or Step to watch individual notes.');
          await waitTxn(ctx, ['PRESENTED', 'DISPENSE_FAILED'], run);
        },
      },
      {
        title: '9 · Transport, stacking and presenting',
        text: 'Belts carry each note up the <b>transport</b> into the <b>stacker</b>, which builds a neat bundle. The presenter clamps the bundle and moves it to the <b>shutter</b>, which opens and presents the cash.',
        camera: { part: 'presenter-shutter' },
        highlight: ['transport', 'stacker', 'presenter-shutter'],
        action: async (ctx, run) => {
          await waitFor(ctx, () => ctx.port.waitingForCash, run);
          run.status('Cash presented. The customer has 30 s (sim time) to take it.');
        },
      },
      {
        title: '10–12 · Customer takes the cash; ledger posts',
        text: 'When the cash is taken, the ATM sends <b>WITHDRAWAL_COMPLETION</b>. Only now does the host <b>post</b> the debit (double entry: customer account ↓, ATM cash GL ↓) and release the hold. The cassette counters already went down as notes were picked.',
        view: 'exterior',
        arrows: false,
        camera: 'front',
        tab: 'transaction',
        action: async (ctx, run) => {
          await takeWhenPresented(ctx, 'cash', run, 1200);
          await waitTxn(ctx, ['COMPLETED', 'REVERSED'], run);
          run.status('Transaction COMPLETED and posted.');
        },
      },
      {
        title: '13–14 · Receipt and card return',
        text: 'The customer can ask for a <b>receipt</b> (thermal printer in the upper module), then ends the session and the <b>card is returned</b>. If a card is not taken in time, the ATM retains it for security.',
        camera: 'front',
        action: async (ctx, run) => {
          await waitScreen(ctx, ['RESULT', 'ANOTHER_TXN', 'TAKE_CARD', 'WELCOME'], run);
          if (ctx.sys.app.screen.id === 'RESULT') {
            if (!(await touch(ctx, 'receipt-yes', run))) await touchPrefix(ctx, 'receipt', run);
          }
          await waitScreen(ctx, ['ANOTHER_TXN', 'TAKE_CARD', 'WELCOME'], run);
          if (ctx.sys.app.screen.id === 'ANOTHER_TXN') {
            if (!(await touch(ctx, 'another-no', run))) await touchPrefix(ctx, 'another-no', run);
          }
          await takeWhenPresented(ctx, 'card', run, 1000);
          await waitScreen(ctx, ['WELCOME'], run);
          run.status('Session ended. Check the Cash tab: cassettes A and C went down.');
        },
      },
    ],
  },
  // ───────────────────────────── 3 ─────────────────────────────
  {
    id: 'inside',
    title: 'Inside the ATM',
    summary: 'Open the ATM and inspect every major component.',
    steps: [
      { title: 'Opening the ATM', text: 'In <b>Internal</b> view the service door swings open and the safe door opens, under inspection lighting. In a real branch this needs authorised staff under dual control — the simulator only shows the concept.', mode: 'inspect', view: 'internal', camera: { position: [1.2, 1.3, 1.9], target: [0, 0.85, 0.1] }, highlight: ['service-door', 'vault-door'] },
      { title: 'Card reader module', text: 'The motorised <b>card reader</b> transports the card past chip contacts and a magnetic head, and can retain a card into a capture bin.', camera: { part: 'card-reader-module' }, highlight: ['card-reader-module'], select: 'card-reader-module' },
      { title: 'Receipt printer', text: 'A <b>thermal printer</b>: heat elements darken special paper, a cutter separates the receipt. Paper-low and paper-out sensors report to the controller.', camera: { part: 'receipt-printer' }, highlight: ['receipt-printer'], select: 'receipt-printer' },
      { title: 'Controller PC, comms and power', text: 'The <b>controller PC</b> runs the ATM application and talks to every device through a device-abstraction layer (commonly CEN/XFS). The <b>comms</b> unit links to the bank network; the <b>power supply</b> feeds all modules.', camera: { part: 'controller-pc' }, highlight: ['controller-pc', 'comms', 'power-supply'], select: 'controller-pc' },
      { title: 'The safe and the cassettes', text: 'The <b>safe</b> protects the cash. Three dispensing <b>cassettes</b> hold one denomination each: A $20, B $50, C $100. Their fill level here follows the live inventory.', camera: 'safe', highlight: ['cassette-A', 'cassette-B', 'cassette-C'], select: 'cassette-A' },
      { title: 'Picker rollers', text: 'At the rear of each cassette, <b>pick rollers</b> separate one note at a time from the stack (friction or vacuum, depending on the manufacturer).', camera: { part: 'picker-rollers' }, highlight: ['picker-rollers'], select: 'picker-rollers', arrows: true },
      { title: 'Transport & validation sensors', text: 'Belts and rollers carry notes up the <b>transport</b>. The <b>sensor gate</b> measures thickness and length to catch double or skewed notes; a <b>diverter</b> sends those to the reject cassette.', camera: { part: 'transport' }, highlight: ['transport', 'validation-sensors'], select: 'validation-sensors' },
      { title: 'Stacker & presenter', text: 'The <b>stacker</b> collects the notes into a bundle. The <b>presenter</b> belts carry the bundle to the <b>shutter</b> on the fascia.', camera: { part: 'stacker' }, highlight: ['stacker', 'presenter-shutter'], select: 'stacker' },
      { title: 'Reject cassette & retract compartment', text: 'The <b>reject cassette</b> collects notes that failed checks or were purged. The <b>retract compartment</b> receives bundles the customer did not take. Both are counted separately so they can be reconciled.', camera: { part: 'reject-cassette' }, highlight: ['reject-cassette', 'retract-bin'], select: 'reject-cassette' },
      { title: 'Deposit module', text: 'Deposited notes go to an <b>escrow</b>, are checked by a <b>validator</b>, then stored in the <b>deposit cassette</b> once the customer confirms — or returned if cancelled.', camera: { part: 'deposit-module' }, highlight: ['deposit-module'], select: 'deposit-module' },
      { title: 'Exploded view', text: 'The <b>exploded view</b> separates the major assemblies while keeping their relative positions, so you can see how they stack together. Click any part for its details.', view: 'exploded', arrows: false },
    ],
  },
  // ───────────────────────────── 4 ─────────────────────────────
  {
    id: 'network',
    title: 'ATM banking communication',
    summary: 'Trace an authorization request from the ATM through the host and back.',
    steps: [
      { title: 'The conceptual path', text: '<b>ATM → ATM controller → network switch → authorization host → account ledger</b>. Each box is a separate system; messages travel hop by hop and every hop adds latency. This is a simplified educational model, not a real protocol.', mode: 'network', view: 'exterior', camera: 'front' },
      {
        title: 'Card authentication & PIN verification',
        text: 'After the PIN is entered the ATM sends <b>CARD_AUTH</b> with a card token and a simulated PIN block. The host checks the card status and the PIN, and returns the customer’s accounts. Watch the packets and the message log.',
        action: async (ctx, run) => {
          await signIn(ctx, run);
          run.status('CARD_AUTH approved (code 00).');
        },
      },
      {
        title: 'Balance inquiry',
        text: 'A <b>BALANCE_INQUIRY</b> reads the ledger: <i>ledger balance</i> (posted) and <i>available</i> (ledger minus holds). No money moves.',
        action: async (ctx, run) => {
          await touch(ctx, 'menu-balance', run);
          if (await waitScreen(ctx, ['ACCOUNT_SELECT', 'RESULT'], run)) {
            if (ctx.sys.app.screen.id === 'ACCOUNT_SELECT') await touchPrefix(ctx, 'acct-', run);
          }
          await waitScreen(ctx, ['RESULT'], run);
          run.status('Balance returned by the host.');
        },
      },
      { title: 'Authorization, holds and completion', text: 'For a withdrawal the host first <b>authorizes</b> (places a hold, returns an auth code). After the cash is collected the ATM sends a <b>completion</b> and the ledger <b>posts</b>. Declines carry response codes: 51 insufficient funds, 55 wrong PIN, 61 over limit, 62 blocked card, 91 issuer unavailable.' },
      {
        title: 'Timeouts and reversals',
        text: 'If the reply is lost, the ATM cannot tell whether the host approved. It times out and sends a <b>REVERSAL</b> so any hold is released. Let’s end this session and run the <i>network timeout</i> scenario.',
        action: async (ctx, run) => {
          if (ctx.sys.app.screen.id === 'RESULT') await touchPrefix(ctx, 'receipt-no', run);
          await waitScreen(ctx, ['ANOTHER_TXN', 'TAKE_CARD', 'WELCOME'], run);
          if (ctx.sys.app.screen.id === 'ANOTHER_TXN') await touchPrefix(ctx, 'another-no', run);
          await takeWhenPresented(ctx, 'card', run, 600);
          await waitScreen(ctx, ['WELCOME'], run);
          if (run.cancelled) return;
          run.status('Running the timeout scenario…');
          ctx.troubleshoot.select('network-timeout');
          ctx.ui.setMode('network');
          await ctx.troubleshoot.run('network-timeout');
          run.status('The host approved but the reply was lost → TIMED_OUT → REVERSED. Check the message log.');
        },
      },
      { title: 'Journals and settlement', text: 'Both the ATM (electronic journal) and the host log every message, so differences can be investigated. At day end, networks and banks <b>settle</b> totals between each other, and the ATM is <b>reconciled</b> against its cash — see Tour 6.', tab: 'network' },
    ],
  },
  // ───────────────────────────── 5 ─────────────────────────────
  {
    id: 'cash',
    title: 'Cash management',
    summary: 'Cassette replenishment and denomination selection.',
    steps: [
      { title: 'The cash inventory', text: 'The Inventory tab shows each cassette’s <b>denomination</b>, <b>note count</b> and <b>value</b>. Only cash in working cassettes is <i>available</i>; rejected, retracted, deposited and presented cash are tracked <b>separately</b>.', mode: 'cash', view: 'internal', camera: 'safe', highlight: ['cassette-A', 'cassette-B', 'cassette-C'] },
      { title: 'Choosing denominations', text: 'To pay an amount the dispenser must find an <b>exact combination</b> of available notes. $30 is impossible with $20/$50/$100 even though there is plenty of cash. Try amounts in the <b>Plan preview</b> and compare strategies: fewest notes, balanced (keeps cassettes even) and small notes.', tab: 'cash' },
      { title: 'Low-cash warnings', text: 'Each cassette has a <b>low threshold</b>. Below it the ATM still works but warns the operator; when a denomination runs out, some amounts become impossible. The status LED turns amber.' },
      {
        title: 'Replenishment',
        text: 'Replenishment loads counted notes from the branch vault into the cassettes under dual control. Watch cassette A: we enter maintenance, add 300 × $20 and leave maintenance. The ATM journals every operator action.',
        mode: 'cash',
        action: async (ctx, run) => {
          if (!(await ensureIdle(ctx, run))) return;
          const op = ctx.sys.operator;
          op.enter();
          await ctx.clock.wait(800);
          op.replenish('A', 300);
          await ctx.clock.wait(800);
          op.exit();
          run.status('Cassette A replenished by 300 notes ($6,000).');
        },
      },
      { title: 'Configuring the mix', text: 'In <b>Maintenance</b> mode you can remove/replace cassettes and change a cassette’s denomination (its notes go back to the vault and it is reloaded). The planner only ever uses cassettes that are installed and healthy — it can never plan notes that are not there.' },
    ],
  },
  // ───────────────────────────── 6 ─────────────────────────────
  {
    id: 'reconciliation',
    title: 'ATM reconciliation',
    summary: 'How transaction journals and physical cash are compared.',
    steps: [
      { title: 'Why reconcile?', text: 'At the end of the day an operator <b>balances</b> the ATM: what the journal says should be there is compared with the machine counters and with a <b>physical count</b> of every cassette and bin.', mode: 'reconciliation', view: 'exterior', camera: 'front', tab: 'reconciliation' },
      { title: 'The balancing equation', text: '<b>Beginning inventory + replenishments − cash dispensed − notes rejected − notes retracted = expected ending</b>. Deposits are balanced separately. Rejected and retracted notes are still bank cash — they just moved to another bin.' },
      {
        title: 'Introduce a discrepancy',
        text: 'We simulate <b>5 notes missing</b> from cassette B. The counters still say the notes are there, but the physical count disagrees — reconciliation flags the difference and explains how it was detected.',
        action: async (ctx, run) => {
          ctx.sys.recon.injectDiscrepancy('missing-notes');
          ctx.ui.refresh();
          run.status('Discrepancy injected — see the differences section.');
        },
      },
      { title: 'Investigate', text: 'Differences are investigated using the <b>electronic journal</b> (each dispense, reject and retract), the <b>audit log</b> and the host’s records. Typical causes: miscounted replenishment, a misloaded cassette, unrecorded notes in a bin, or a disputed transaction.' },
      { title: 'Close the day', text: 'After investigation the operator <b>closes the business day</b>: today’s ending inventory becomes tomorrow’s beginning. Use <b>Reset</b> (top right) at any time to return to the initial training state.' },
    ],
  },
  // ───────────────────────────── 7 ─────────────────────────────
  {
    id: 'troubleshooting',
    title: 'ATM troubleshooting',
    summary: 'Trigger operational failures and examine recovery paths.',
    steps: [
      { title: 'Failures are expected', text: 'ATMs are designed so that failures never lose track of money. Every failure leaves a clear <b>transaction state</b>, a <b>journal</b> trail and a <b>recovery</b> procedure.', mode: 'troubleshoot', view: 'exterior', camera: 'front' },
      {
        title: 'A cash jam',
        text: 'A note jams in the transport mid-dispense. The transaction becomes <b>DISPENSE_FAILED</b>, the ATM sends a <b>reversal</b>, and the customer is not charged. The dispenser goes out of service.',
        action: async (ctx, run) => {
          ctx.troubleshoot.select('cash-jam');
          await ctx.troubleshoot.run('cash-jam');
          run.status('Jam demonstrated — note the red outline on the transport.');
        },
      },
      {
        title: 'Recovery',
        text: 'An operator opens the ATM, clears the jam (stuck notes are <b>purged to the reject cassette</b>, never back into a cassette), resets the dispenser and runs a test.',
        view: 'internal',
        camera: 'dispenser',
        action: async (ctx, run) => {
          await ctx.troubleshoot.recover('cash-jam');
          run.status('Dispenser back in service.');
        },
      },
      {
        title: 'Cash not collected',
        text: 'If the customer walks away, the presenter <b>retracts</b> the bundle into the retract compartment after the timeout, and (by this bank’s policy) the authorization is reversed. Policies differ between banks.',
        view: 'xray',
        camera: 'front',
        action: async (ctx, run) => {
          ctx.troubleshoot.select('cash-not-collected');
          await ctx.troubleshoot.run('cash-not-collected');
          run.status('Bundle retracted, transaction reversed.');
        },
      },
      { title: 'Explore the rest', text: 'There are 14 scenarios: insufficient funds, ATM out of cash, unsupported amounts, impossible note combinations, pick failures, rejected notes, printer out of paper, card reader failure, network timeout, host unavailable and power loss. Each one explains what happened, the affected parts, the transaction state, the customer outcome and the recovery.', view: 'exterior' },
    ],
  },
];
