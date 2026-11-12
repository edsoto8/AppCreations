import { formatCents } from '../core/money';
import { CASSETTE_IDS, denomCents, type CassetteId, type ComponentId, type Denomination, type DeviceId } from '../core/types';
import type { AtmSystem } from '../app/AtmSystem';

export interface OpResult {
  ok: boolean;
  message: string;
}

export interface ChecklistItem {
  id: 'enter-service' | 'self-test' | 'clear-faults' | 'replenish' | 'empty-bins' | 'paper' | 'retained-cards' | 'exit-service';
  label: string;
  done: boolean;
}

const CHECKLIST: Array<Omit<ChecklistItem, 'done'>> = [
  { id: 'enter-service', label: 'Enter service mode (ATM shows "Service mode")' },
  { id: 'self-test', label: 'Run device self-tests' },
  { id: 'clear-faults', label: 'Clear jams and reset faulted devices' },
  { id: 'replenish', label: 'Replenish cassettes from the vault' },
  { id: 'empty-bins', label: 'Empty reject / retract / deposit bins (count for reconciliation)' },
  { id: 'paper', label: 'Check / load receipt paper' },
  { id: 'retained-cards', label: 'Collect retained cards' },
  { id: 'exit-service', label: 'Return the ATM to service' },
];

/**
 * Operator / technician console ("supervisor mode"). Every action is journaled and written to the audit log
 * with actor OPERATOR, and cash movements are recorded so end-of-day reconciliation can balance.
 *
 * Actions are refused while a customer flow is running (the app is busy). `restorePower()` is always allowed.
 */
export class OperatorConsole {
  active = false;
  checklist: ChecklistItem[] = CHECKLIST.map((c) => ({ ...c, done: false }));

  constructor(private readonly sys: AtmSystem) {}

  private tick(id: ChecklistItem['id']): void {
    const item = this.checklist.find((c) => c.id === id);
    if (item) item.done = true;
  }

  private log(action: string, detail: string): void {
    this.sys.journal.log('OPERATOR', `${action}: ${detail}`);
    this.sys.journal.auditLog('OPERATOR', action, detail);
  }

  private blocked(): OpResult | undefined {
    if (this.sys.app.busy) return { ok: false, message: 'Wait until the current customer transaction has finished.' };
    return undefined;
  }

  private afterChange(): void {
    this.sys.inventory.changed();
    this.sys.refreshDispenserStatus();
    this.sys.app.refresh();
  }

  /** Enter service mode. Only between customer sessions. */
  enter(): OpResult {
    if (this.sys.app.busy || this.sys.app.sessionActive) return { ok: false, message: 'A customer session is in progress. Wait until it ends.' };
    this.active = true;
    this.checklist = CHECKLIST.map((c) => ({ ...c, done: false }));
    this.tick('enter-service');
    this.log('Enter service mode', 'ATM taken out of customer service');
    this.sys.app.refresh();
    return { ok: true, message: 'Service mode active.' };
  }

  exit(): OpResult {
    if (!this.active) return { ok: true, message: 'Not in service mode.' };
    this.active = false;
    this.tick('exit-service');
    this.log('Exit service mode', 'ATM returned to customer service');
    this.sys.app.refresh();
    return { ok: true, message: 'ATM back in service.' };
  }

  /** Move notes from the vault into a cassette (respects capacity and the vault stock). */
  replenish(id: CassetteId, notes: number): OpResult {
    const b = this.blocked();
    if (b) return b;
    const c = this.sys.inventory.cassettes[id];
    const before = c.counter;
    const moved = this.sys.inventory.loadCassette(id, Math.max(0, Math.floor(notes)));
    const room = c.capacity - this.sys.inventory.physicalCount(id);
    this.log('Replenish', `Cassette ${id}: +${moved} × $${c.denom} (${formatCents(moved * denomCents(c.denom))}), counter ${before} → ${c.counter}`);
    this.tick('replenish');
    this.sys.faults.disarm('insufficient-atm-cash');
    if (!CASSETTE_IDS.some((x) => this.sys.inventory.isLow(x))) this.sys.faults.disarm('low-cash-warning');
    this.afterChange();
    const capped = moved < notes ? ` (requested ${notes}; limited by ${room === 0 ? 'cassette capacity' : 'vault stock'})` : '';
    return { ok: moved > 0, message: `Loaded ${moved} × $${c.denom} into cassette ${id}${capped}.` };
  }

  removeCassette(id: CassetteId): OpResult {
    const b = this.blocked();
    if (b) return b;
    const c = this.sys.inventory.cassettes[id];
    c.installed = false;
    this.sys.inventory.refreshStatus(id);
    this.log('Remove cassette', `Cassette ${id} removed (${c.counter} × $${c.denom})`);
    this.afterChange();
    return { ok: true, message: `Cassette ${id} removed.` };
  }

  installCassette(id: CassetteId): OpResult {
    const b = this.blocked();
    if (b) return b;
    const c = this.sys.inventory.cassettes[id];
    c.installed = true;
    if (c.status === 'OFFLINE') c.status = 'OK';
    this.sys.inventory.refreshStatus(id);
    this.log('Install cassette', `Cassette ${id} installed (${c.counter} × $${c.denom})`);
    this.afterChange();
    return { ok: true, message: `Cassette ${id} installed.` };
  }

  /** Change a cassette's denomination: unload all notes to the vault, set the denomination, load `notes`. */
  reconfigureCassette(id: CassetteId, denom: Denomination, notes: number): OpResult {
    const b = this.blocked();
    if (b) return b;
    const inv = this.sys.inventory;
    const c = inv.cassettes[id];
    const unloaded = inv.unloadCassette(id);
    const old = c.denom;
    c.denom = denom;
    c.counter = 0;
    c.lowThreshold = Math.max(1, Math.round(notes * 0.1));
    if (c.status === 'FAULT') c.status = 'OK';
    const loaded = inv.loadCassette(id, notes);
    this.log('Reconfigure cassette', `Cassette ${id}: unloaded ${unloaded} × $${old} to vault, now $${denom}, loaded ${loaded}`);
    this.afterChange();
    return { ok: loaded > 0, message: `Cassette ${id} now holds ${loaded} × $${denom}.` };
  }

  /** Clear a jam / pick failure: purge notes left in the dispenser to the reject cassette and reset it. */
  async clearJam(): Promise<OpResult> {
    const b = this.blocked();
    if (b) return b;
    const purged = await this.sys.engine.purgeDispenser('Jam cleared by operator');
    for (const id of CASSETTE_IDS) {
      const c = this.sys.inventory.cassettes[id];
      if (c.status === 'FAULT') {
        c.status = 'OK';
        this.sys.inventory.refreshStatus(id);
      }
    }
    this.sys.faults.disarm('cash-jam');
    this.sys.faults.disarm('pick-failure');
    this.sys.devices.set('dispenser', 'OK', 'Operational');
    for (const comp of ['transport', 'dispenser', 'stacker', 'picker-rollers', 'cassette-A', 'cassette-B', 'cassette-C'] as ComponentId[]) this.sys.mech.setComponentAlert(comp, 'OK');
    this.log('Clear jam', `${purged} note(s) purged to the reject cassette; dispenser reset`);
    this.tick('clear-faults');
    this.afterChange();
    return { ok: true, message: `Jam cleared. ${purged} note(s) moved to the reject cassette.` };
  }

  loadPaper(): OpResult {
    const b = this.blocked();
    if (b) return b;
    this.sys.devices.metric('printer', 'paperPct', 100, true);
    this.sys.devices.set('printer', 'OK', 'Paper loaded');
    this.sys.faults.disarm('printer-out-of-paper');
    this.sys.mech.setComponentAlert('receipt-printer', 'OK');
    this.log('Load paper', 'New receipt roll loaded (100%)');
    this.tick('paper');
    this.sys.app.refresh();
    return { ok: true, message: 'Receipt paper loaded.' };
  }

  /** Reset a device after the physical cause has been fixed. Host/network reset also flushes queued messages. */
  async resetDevice(id: DeviceId): Promise<OpResult> {
    const b = this.blocked();
    if (b) return b;
    const s = this.sys;
    switch (id) {
      case 'power':
        return this.restorePower();
      case 'dispenser': {
        const stuck = s.inventory.count('transport') + s.inventory.count('stacker');
        if (stuck > 0) return { ok: false, message: `${stuck} note(s) are still in the transport/stacker. Clear the jam first.` };
        return this.clearJam();
      }
      case 'printer':
        if ((s.devices.get('printer').metrics.paperPct ?? 0) <= 0) return { ok: false, message: 'Printer is out of paper. Load paper first.' };
        s.faults.disarm('printer-out-of-paper');
        s.devices.set('printer', 'OK', 'Operational');
        s.mech.setComponentAlert('receipt-printer', 'OK');
        break;
      case 'cardReader':
        s.faults.disarm('card-reader-unavailable');
        s.devices.set('cardReader', 'OK', 'Operational');
        s.mech.setComponentAlert('card-reader', 'OK');
        s.mech.setComponentAlert('card-reader-module', 'OK');
        break;
      case 'host':
      case 'network':
        s.faults.disarm('host-unavailable');
        s.devices.set('host', 'OK', 'Host link up');
        s.devices.set('network', 'OK', 'Operational');
        s.mech.setComponentAlert('comms', 'OK');
        break;
      default:
        s.devices.set(id, 'OK', 'Operational');
    }
    this.log('Reset device', s.devices.get(id).name);
    this.tick('clear-faults');
    let extra = '';
    if (id === 'host' || id === 'network') {
      const n = await s.engine.flushStoreAndForward();
      if (n) extra = ` ${n} queued message(s) delivered.`;
    }
    s.app.refresh();
    return { ok: true, message: `${s.devices.get(id).name} reset.${extra}` };
  }

  /** Restore power after an outage: purge, resolve SUSPECT transactions, retain the card left in the reader. */
  async restorePower(): Promise<OpResult> {
    const s = this.sys;
    const lines = await s.engine.recoverAfterPower();
    s.faults.disarm('power-loss');
    s.devices.set('power', 'OK', 'Mains power restored');
    this.log('Restore power', lines.length ? lines.join('; ') : 'No recovery actions needed');
    this.tick('clear-faults');
    this.afterChange();
    return { ok: true, message: lines.length ? `Power restored. ${lines.join('. ')}.` : 'Power OK.' };
  }

  /** Empty a bin to the vault; the counted contents are recorded for reconciliation. */
  emptyBin(bin: 'reject' | 'retract' | 'deposit'): OpResult {
    const b = this.blocked();
    if (b) return b;
    const inv = this.sys.inventory;
    const notes = [...inv.notesAt(bin)];
    const value = notes.reduce((s, n) => s + denomCents(n.denom), 0);
    for (const n of notes) inv.move(n, 'vault', { silent: true });
    this.log('Empty bin', `${bin} bin: ${notes.length} note(s), ${formatCents(value)} counted and moved to the vault`);
    this.tick('empty-bins');
    this.afterChange();
    return { ok: true, message: `Emptied the ${bin} bin: ${notes.length} note(s), ${formatCents(value)}.` };
  }

  /** Hand retained cards back (after identity checks). PIN tries are reset; previously blocked cards stay blocked. */
  returnRetainedCards(): OpResult {
    const b = this.blocked();
    if (b) return b;
    const list = this.sys.engine.retainedCards.splice(0);
    for (const r of list) {
      const card = this.sys.ledger.cards.get(r.cardId);
      if (!card) continue;
      card.status = r.prevStatus === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE';
      card.pinTriesRemaining = 3;
      this.log('Return retained card', `${card.maskedNumber} (${r.reason}) → ${card.status}`);
    }
    this.tick('retained-cards');
    this.sys.app.refresh();
    return { ok: true, message: list.length ? `${list.length} retained card(s) returned.` : 'No retained cards.' };
  }

  /** Device self-test. The dispenser test picks one note per cassette and diverts it to the reject cassette. */
  async runTest(deviceId: DeviceId): Promise<{ passed: boolean; lines: string[] }> {
    if (this.sys.app.busy) return { passed: false, lines: ['Busy: a customer transaction is running.'] };
    const s = this.sys;
    const dev = s.devices.get(deviceId);
    const lines: string[] = [`${dev.name} self-test`];
    let passed = dev.status === 'OK' || dev.status === 'WARNING';
    this.tick('self-test');
    if (deviceId === 'dispenser') {
      if (s.inventory.count('transport') + s.inventory.count('stacker') > 0) {
        lines.push('FAIL: notes in transport/stacker — clear the jam first.');
        passed = false;
      } else if (dev.status === 'FAULT') {
        lines.push(`FAIL: ${dev.detail}`);
      } else {
        await s.clock.stage('Dispenser test: pick one note per cassette to reject');
        for (const c of s.inventory.usableCassettes()) {
          const note = s.inventory.takeFromCassette(c.id);
          if (!note) {
            lines.push(`Cassette ${c.id}: FAIL (could not pick)`);
            passed = false;
            continue;
          }
          await s.mech.pickNote(note, c.id);
          await s.mech.validateNote(note, 'OK');
          s.inventory.move(note, 'reject');
          await s.mech.divertToReject(note);
          lines.push(`Cassette ${c.id}: picked 1 × $${note.denom} → reject cassette OK (counter now ${c.counter})`);
        }
        s.journal.log('OPERATOR', `Dispenser test: ${lines.slice(1).join('; ')}`);
        this.afterChange();
      }
    } else if (deviceId === 'printer') {
      passed = await s.engine.printReceipt(['*** PRINTER TEST ***', 'MERIDIAN TRAINING BANK', 'TEST PAGE - NOT A RECEIPT']);
      lines.push(passed ? 'Test page printed.' : `FAIL: ${dev.detail}`);
    } else {
      lines.push(passed ? `PASS: ${dev.detail}` : `FAIL: ${dev.detail}`);
    }
    lines.push(passed ? 'Result: PASS' : 'Result: FAIL');
    s.journal.auditLog('OPERATOR', 'Run test', `${dev.name}: ${passed ? 'PASS' : 'FAIL'}`);
    return { passed, lines };
  }
}
