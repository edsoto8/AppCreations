import type { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { formatCents } from '../core/money';
import { CASSETTE_IDS, DENOMINATIONS, type Cents, type CustomerPort, type DispenseStrategy, type PlanResult, type FaultId, type MechanismDriver, type SimClock } from '../core/types';
import { Ledger } from '../banking/ledger';
import { AuthorizationHost } from '../banking/host';
import { Network } from '../banking/network';
import { createSeedData, SEED_CASSETTES, SEED_VAULT, SEED_WALLET } from '../banking/seed';
import { CashInventory } from '../cash/inventory';
import { FaultState } from '../faults/faultState';
import { faultById } from '../faults/catalog';
import { DeviceManager } from '../maintenance/devices';
import { OperatorConsole } from '../maintenance/operator';
import { Reconciliation } from '../reconciliation/reconciliation';
import { DEFAULT_ATM_CONFIG, dispenseLimits, type AtmConfig } from '../transactions/config';
import { planDispense } from '../cash/dispense';
import { TransactionEngine } from '../transactions/engine';
import { Journal } from '../transactions/journal';
import { isFinal } from '../transactions/stateMachine';
import { AtmApp } from './AtmApp';

export type { AtmConfig } from '../transactions/config';
export { DEFAULT_ATM_CONFIG } from '../transactions/config';

export interface AtmSystemDeps {
  bus: EventBus;
  clock: SimClock;
  mech: MechanismDriver;
  customer: CustomerPort;
  seed?: number;
}

/**
 * Composition root of the domain. Builds the ledger, host, network, cash inventory, devices, faults,
 * journal, transaction engine, ATM screen app, operator console and reconciliation, and wires the
 * cross-cutting reactions (fault side effects, cassette/dispenser status).
 */
export class AtmSystem {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly mech: MechanismDriver;
  readonly customer: CustomerPort;
  readonly seed: number;
  config: AtmConfig = { ...DEFAULT_ATM_CONFIG };

  rng!: Rng;
  ledger!: Ledger;
  host!: AuthorizationHost;
  network!: Network;
  inventory!: CashInventory;
  devices!: DeviceManager;
  faults!: FaultState;
  journal!: Journal;
  engine!: TransactionEngine;
  app!: AtmApp;
  operator!: OperatorConsole;
  recon!: Reconciliation;

  /** Σ customer ledger balances + customer wallet value at build time (customer wealth conservation). */
  private initialWealthCents = 0;

  constructor(deps: AtmSystemDeps) {
    this.bus = deps.bus;
    this.clock = deps.clock;
    this.mech = deps.mech;
    this.customer = deps.customer;
    this.seed = deps.seed ?? 0x5eed;
    // Subscriptions reference `this.*`, so they keep working after reset() rebuilds the objects.
    this.bus.on('fault.armed', ({ id }) => this.onFaultArmed(id));
    this.bus.on('fault.cleared', ({ id }) => this.onFaultCleared(id));
    this.bus.on('inventory.changed', () => this.refreshDispenserStatus());
    this.build();
  }

  private build(): void {
    const now = () => this.clock.now();
    this.rng = new Rng(this.seed);
    this.journal = new Journal(this.bus, this.clock);
    this.ledger = Ledger.fromSeed(createSeedData(), now);
    this.host = new AuthorizationHost(this.ledger, this.rng);
    this.faults = new FaultState(this.bus);
    this.network = new Network(this.bus, this.clock, this.host, this.faults, () => this.config);
    this.devices = new DeviceManager(this.bus, this.journal);

    const cassettes = {} as ConstructorParameters<typeof CashInventory>[1];
    for (const id of CASSETTE_IDS) {
      const s = SEED_CASSETTES[id];
      cassettes[id] = { denom: s.denom, capacity: s.capacity, lowThreshold: Math.round(s.notes * 0.1) };
    }
    this.inventory = new CashInventory(this.bus, cassettes);
    for (const id of CASSETTE_IDS) this.inventory.createNotes(SEED_CASSETTES[id].denom, SEED_CASSETTES[id].notes, `cassette:${id}`);
    for (const [d, n] of SEED_VAULT) this.inventory.createNotes(d, n, 'vault');
    for (const [d, n] of SEED_WALLET) this.inventory.createNotes(d, n, 'customer');

    this.engine = new TransactionEngine({
      bus: this.bus,
      clock: this.clock,
      mech: this.mech,
      customer: this.customer,
      config: () => this.config,
      ledger: this.ledger,
      network: this.network,
      inventory: this.inventory,
      devices: this.devices,
      faults: this.faults,
      journal: this.journal,
    });
    this.operator = new OperatorConsole(this);
    this.recon = new Reconciliation(this.inventory, this.journal, this.ledger, now);
    this.app = new AtmApp(this);
    this.initialWealthCents = this.ledger.customerWealthCents() + this.inventory.valueAt('customer');
    this.journal.log('SESSION', `ATM ${this.config.terminalId} started. Cash available ${formatCents(this.inventory.availableCents())}`);
  }

  /** Restore the initial training state (same seed → same state). Emits 'reset'. Config is kept. */
  reset(): void {
    this.engine.abort();
    this.app.dispose();
    this.build();
    this.bus.emit('reset', {});
    this.inventory.changed();
    this.app.refresh(true);
  }

  /** Preview the dispense plan for an amount with the current cassettes and limits (pure; nothing moves). */
  planDispense(amountCents: Cents, strategy: DispenseStrategy = this.config.strategy): PlanResult {
    return planDispense(amountCents, this.inventory.cassettes, strategy, dispenseLimits(this.config));
  }

  // ───────────────────────────── cross-cutting reactions ─────────────────────────────

  /** Dispenser health follows the cassettes: WARNING when any cassette is low/empty, FAULT stays until cleared. */
  refreshDispenserStatus(): void {
    if (!this.devices || !this.inventory) return;
    for (const id of CASSETTE_IDS) this.inventory.refreshStatus(id);
    const disp = this.devices.get('dispenser');
    if (disp.status === 'FAULT' || disp.status === 'OFFLINE') return;
    const low = CASSETTE_IDS.filter((id) => this.inventory.isLow(id));
    if (this.inventory.availableCents() < this.config.minWithdrawalCents) this.devices.set('dispenser', 'WARNING', 'No dispensable cash');
    else if (low.length) this.devices.set('dispenser', 'WARNING', `Low cash: cassette ${low.join(', ')}`);
    else this.devices.set('dispenser', 'OK', 'Operational');
  }

  /** Side effects of arming a training fault (trainer action). Money is only ever moved, never removed. */
  private onFaultArmed(id: FaultId): void {
    const def = faultById(id);
    this.journal.log('FAULT', `Training fault armed: ${def?.title ?? id}`);
    this.journal.auditLog('TRAINER', 'Arm fault', id);
    const drainTo = (target: Record<string, number>, why: string) => {
      const parts: string[] = [];
      for (const cid of CASSETTE_IDS) {
        if (target[cid] === undefined) continue;
        const extra = this.inventory.physicalCount(cid) - target[cid];
        if (extra <= 0) continue;
        const moved = this.inventory.unloadCassette(cid, extra);
        parts.push(`${moved} × $${this.inventory.cassettes[cid].denom} from cassette ${cid}`);
      }
      if (parts.length) {
        this.journal.log('CASH', `Trainer: moved ${parts.join(', ')} to the vault (${why})`);
        this.journal.auditLog('TRAINER', 'Move cassette notes to vault', parts.join(', '));
      }
      this.inventory.changed();
    };
    switch (id) {
      case 'insufficient-atm-cash':
        drainTo({ A: 5, B: 1, C: 0 }, 'simulates a very busy day');
        break;
      case 'low-cash-warning': {
        const a = this.inventory.cassettes.A;
        drainTo({ A: Math.floor(a.lowThreshold * 0.75) }, 'simulates cassette A running low');
        break;
      }
      case 'printer-out-of-paper':
        this.devices.metric('printer', 'paperPct', 0, true);
        this.devices.set('printer', 'FAULT', 'Paper out');
        this.mech.setComponentAlert('receipt-printer', 'FAULT');
        break;
      case 'card-reader-unavailable':
        this.devices.set('cardReader', 'FAULT', 'Card reader not responding');
        this.mech.setComponentAlert('card-reader-module', 'FAULT');
        break;
      default:
        break; // other faults act at their trigger point (pick, validate, transport, present, host message, power)
    }
    this.app?.refresh();
  }

  private onFaultCleared(id: FaultId): void {
    this.journal.log('FAULT', `Training fault cleared: ${faultById(id)?.title ?? id}`);
    // A trainer may disarm directly; devices whose state is purely "logical" recover with it.
    if (id === 'card-reader-unavailable' && this.devices.get('cardReader').status === 'FAULT') this.devices.set('cardReader', 'OK', 'Operational');
    if (id === 'host-unavailable' && this.devices.get('host').status === 'OFFLINE') this.devices.set('host', 'OK', 'Host link up');
    this.app?.refresh();
  }

  // ───────────────────────────── invariants ─────────────────────────────

  /** [] when healthy; otherwise human-readable violations. */
  checkInvariants(): string[] {
    const v: string[] = [];
    const inv = this.inventory;

    // 1. Note conservation: notes only move, so per-denomination totals never change.
    const init = inv.initialDenomCounts();
    const now = inv.totalDenomCounts();
    for (const d of DENOMINATIONS) if ((init[d] ?? 0) !== (now[d] ?? 0)) v.push(`Note conservation broken for $${d}: ${init[d] ?? 0} → ${now[d] ?? 0}`);
    const idx = inv.indexProblems();
    if (idx) v.push(idx);

    // 2. Logical counters agree with physical cassettes; denominations are right.
    for (const id of CASSETTE_IDS) {
      const c = inv.cassettes[id];
      const phys = inv.physicalCount(id);
      if (c.counter !== phys) v.push(`Cassette ${id}: counter ${c.counter} ≠ physical ${phys}`);
      if (c.counter < 0 || phys > c.capacity) v.push(`Cassette ${id}: counter/physical outside 0..capacity`);
      const wrong = inv.notesAt(`cassette:${id}`).filter((n) => n.denom !== c.denom).length;
      if (wrong) v.push(`Cassette ${id}: ${wrong} note(s) of the wrong denomination`);
    }
    const unacc = inv.count('unaccounted') - inv.acknowledgedUnaccounted;
    if (unacc > 0) v.push(`${unacc} note(s) unaccounted for`);

    // 3. Double entry: every posting balances and the trial balance is zero.
    for (const p of this.ledger.postings) {
      const s = p.legs.reduce((x, l) => x + l.amountCents, 0);
      if (s !== 0) v.push(`Posting ${p.id} unbalanced by ${s}`);
    }
    if (this.ledger.trialBalanceCents() !== 0) v.push(`Trial balance is ${this.ledger.trialBalanceCents()}, expected 0`);

    // 4. Customer wealth conservation (ledger + wallet), valid under the reverse-on-retract policy.
    if (this.config.reversalOnRetract) {
      const wealth = this.ledger.customerWealthCents() + inv.valueAt('customer');
      if (wealth !== this.initialWealthCents) v.push(`Customer wealth changed: ${formatCents(this.initialWealthCents)} → ${formatCents(wealth)}`);
    }
    for (const a of this.ledger.accounts.values()) if (this.ledger.available(a.id) > a.ledgerCents) v.push(`${a.id}: available exceeds ledger`);

    // 5. Holds and transaction end states.
    const safTxns = new Set(this.engine.saf.map((s) => s.txnId));
    for (const h of this.ledger.allHolds()) {
      const txn = this.journal.findTransaction(h.txnId);
      if (!txn) v.push(`Hold ${h.id} on ${h.accountId} has no transaction`);
      else if (isFinal(txn.state)) v.push(`Dangling hold ${h.id} for ${txn.id} in final state ${txn.state}`);
    }
    if (!this.app.busy) {
      for (const t of this.journal.transactions) {
        if (isFinal(t.state)) continue;
        if (safTxns.has(t.id)) continue;
        if (t.state === 'SUSPECT' && this.engine.powerLost) continue;
        if (t.state === 'ESCROWED' && this.engine.hasEscrow) continue;
        v.push(`${t.id} (${t.type}) left in non-final state ${t.state}`);
      }
      for (const loc of ['transport', 'stacker', 'presented'] as const) {
        if (inv.count(loc) && this.devices.get('dispenser').status !== 'FAULT' && !this.engine.powerLost) v.push(`${inv.count(loc)} note(s) left in ${loc} with a healthy dispenser`);
      }
      if (inv.count('escrow') && !this.engine.hasEscrow) v.push(`${inv.count('escrow')} note(s) stuck in escrow`);
    }
    return v;
  }
}
