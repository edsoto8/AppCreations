import { CASSETTE_IDS, type FaultId, type KeypadKey, type Transaction } from '../core/types';
import type { AtmSystem } from '../app/AtmSystem';
import { faultById } from './catalog';
import { SEED_CASSETTES } from '../banking/seed';

export interface AutopilotHooks {
  /** Called when the TAKE_CASH screen appears (the UI resolves its CustomerPort as if the user took the cash). */
  collectCash(): void;
  /** Called when the TAKE_CARD screen appears. */
  takeCard(): void;
  /** Narration of each step, for the UI timeline / captions. */
  onStep(text: string): void;
}

export interface ScenarioResult {
  txn?: Transaction;
  summary: string;
  steps: string[];
}

/**
 * Faults that only make sense once a card session exists: arming them before PIN verification would make
 * the PIN check fail instead of the transaction, so the autopilot arms them just before the transaction.
 */
const ARM_BEFORE_TRANSACTION: readonly FaultId[] = ['host-unavailable'];

/**
 * Drive a complete demonstration of a fault through the ATM's own inputs:
 * arm fault → insert card → enter PIN → withdraw the demo amount → receipt → finish.
 * The domain does all the work; the hooks let the UI play the customer's part.
 */
export async function runScenario(sys: AtmSystem, faultId: FaultId, hooks: AutopilotHooks): Promise<ScenarioResult> {
  const def = faultById(faultId);
  if (!def) throw new Error(`Unknown fault ${faultId}`);
  const app = sys.app;
  const steps: string[] = [];
  const step = (t: string) => {
    steps.push(t);
    hooks.onStep(t);
  };
  const press = async (key: KeypadKey) => {
    app.input({ kind: 'key', key });
    await app.settle();
  };
  /** Current screen id (a function so TypeScript does not narrow it across awaits). */
  const screen = () => app.screen.id;
  const touch = async (target: string) => {
    app.input({ kind: 'touch', target });
    await app.settle();
  };

  await app.settle();
  if (sys.engine.powerLost) return { summary: 'The ATM is out of service: restore power first.', steps };
  if (sys.operator.active) sys.operator.exit();
  if (app.sessionActive) await press('CANCEL');
  if (screen() === 'CARD_RETAINED') await touch('retained-ok');

  const startCount = sys.journal.transactions.length;
  const off = sys.bus.on('screen.changed', ({ screen }) => {
    if (screen.id === 'TAKE_CASH' && faultId !== 'cash-not-collected') hooks.collectCash();
    if (screen.id === 'TAKE_CARD') hooks.takeCard();
  });

  try {
    const card = sys.ledger.cards.get(def.demo.cardId);
    if (!card) return { summary: `Demo card ${def.demo.cardId} not found`, steps };
    const armLate = ARM_BEFORE_TRANSACTION.includes(faultId);
    if (!armLate) {
      step(`Arm fault: ${def.title}`);
      sys.faults.arm(faultId);
    }

    step(`Insert card ${card.maskedNumber} (${card.holderName})`);
    app.input({ kind: 'card', cardId: card.id, method: 'chip' });
    await app.settle();
    if (screen() !== 'PIN_ENTRY' && card.contactless && sys.devices.isOk('contactless')) {
      step('The card could not be inserted — tap it on the contactless reader instead');
      app.input({ kind: 'card', cardId: card.id, method: 'contactless' });
      await app.settle();
    }
    if (screen() !== 'PIN_ENTRY') return finish();

    step(`Enter demo PIN ${card.demoPin}`);
    for (const k of card.demoPin) await press(k as KeypadKey);
    await press('ENTER');
    if (screen() !== 'MAIN_MENU') return finish();

    if (armLate) {
      step(`Arm fault: ${def.title}`);
      sys.faults.arm(faultId);
    }
    step('Choose "Withdraw cash"');
    await touch('menu-withdraw');
    if (screen() !== 'ACCOUNT_SELECT') return finish();
    const acct = card.accountIds[0];
    step(`Choose account ${acct}`);
    await touch(`acct-${acct}`);
    if (screen() !== 'AMOUNT_ENTRY') return finish();

    const dollars = String(Math.round(def.demo.amountCents / 100));
    step(`Type amount $${dollars} and press Enter`);
    for (const k of dollars) await press(k as KeypadKey);
    await press('ENTER');

    if (screen() === 'RESULT') {
      const yes = app.screen.buttons.find((b) => b.id === 'receipt-yes');
      step(yes?.enabled ? 'Ask for a receipt' : 'No receipt available — continue');
      await touch(yes?.enabled ? 'receipt-yes' : 'receipt-no');
    }
    if (screen() === 'ANOTHER_TXN') {
      step('No more transactions — take the card');
      await touch('another-no');
    }
    return finish();
  } finally {
    off();
    // One-shot faults that never reached their trigger point are not left armed by accident.
    if (!def.latching) sys.faults.disarm(faultId);
  }

  function finish(): ScenarioResult {
    const txns = sys.journal.transactions.slice(startCount);
    const txn = txns[txns.length - 1];
    const where = sys.engine.powerLost ? ' The ATM is now out of service.' : '';
    const summary = `${def!.title}: ${txn ? `${txn.id} ended ${txn.state}${txn.responseCode ? ` (code ${txn.responseCode})` : ''}` : 'no transaction was created'}.${where} ${def!.transactionOutcome}`;
    step('Scenario finished');
    return { txn, summary, steps };
  }
}

/**
 * Perform the operator recovery workflow for a fault (what a technician would do), returning a log of actions.
 * Afterwards the ATM is back in (full) service.
 */
export async function recoverFault(sys: AtmSystem, faultId: FaultId): Promise<string[]> {
  const out: string[] = [];
  const op = sys.operator;
  await sys.app.settle();
  if (faultId === 'power-loss') out.push((await op.restorePower()).message);
  const entered = op.enter();
  out.push(entered.message);
  switch (faultId) {
    case 'insufficient-atm-cash':
    case 'low-cash-warning':
      // Top each cassette up to its standard load (cash-in-transit order), never above capacity.
      for (const id of CASSETTE_IDS) {
        const need = SEED_CASSETTES[id].notes - sys.inventory.physicalCount(id);
        if (need > 0) out.push(op.replenish(id, need).message);
      }
      break;
    case 'cash-jam':
    case 'pick-failure':
      out.push((await op.clearJam()).message);
      out.push(...(await op.runTest('dispenser')).lines);
      break;
    case 'note-rejected':
      out.push(op.emptyBin('reject').message);
      break;
    case 'printer-out-of-paper':
      out.push(op.loadPaper().message);
      break;
    case 'card-reader-unavailable':
      out.push((await op.resetDevice('cardReader')).message);
      break;
    case 'host-unavailable':
    case 'network-timeout':
      out.push((await op.resetDevice('host')).message);
      break;
    case 'cash-not-collected':
      out.push(op.emptyBin('retract').message);
      break;
    case 'power-loss':
      out.push((await op.clearJam()).message);
      out.push(op.returnRetainedCards().message);
      out.push(op.emptyBin('reject').message);
      break;
    default:
      out.push('No technician action required: the ATM behaved correctly.');
  }
  if (entered.ok) out.push(op.exit().message);
  return out;
}
