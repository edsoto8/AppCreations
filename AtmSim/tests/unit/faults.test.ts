import { describe, expect, it } from 'vitest';
import { FAULTS, faultById } from '../../src/faults/catalog';
import { recoverFault, runScenario } from '../../src/faults/autopilot';
import type { ComponentId, FaultId, TxnState } from '../../src/core/types';
import { allNotesValue, makeRig, wealth } from './helpers';

const EXPECTED: Record<FaultId, { final: TxnState | 'NONE'; path?: TxnState[] }> = {
  'insufficient-funds': { final: 'DECLINED' },
  'insufficient-atm-cash': { final: 'CANCELLED' },
  'unsupported-amount': { final: 'CANCELLED' },
  'no-feasible-combination': { final: 'CANCELLED' },
  'low-cash-warning': { final: 'COMPLETED' },
  'cash-jam': { final: 'REVERSED', path: ['DISPENSING', 'DISPENSE_FAILED', 'REVERSAL_PENDING', 'REVERSED'] },
  'pick-failure': { final: 'REVERSED', path: ['DISPENSING', 'DISPENSE_FAILED', 'REVERSAL_PENDING', 'REVERSED'] },
  'note-rejected': { final: 'COMPLETED' },
  'printer-out-of-paper': { final: 'COMPLETED' },
  'card-reader-unavailable': { final: 'COMPLETED' },
  'network-timeout': { final: 'REVERSED', path: ['AUTH_PENDING', 'TIMED_OUT', 'REVERSAL_PENDING', 'REVERSED'] },
  'host-unavailable': { final: 'DECLINED' },
  'cash-not-collected': { final: 'REVERSED', path: ['PRESENTED', 'RETRACTED', 'REVERSAL_PENDING', 'REVERSED'] },
  'power-loss': { final: 'SUSPECT' },
};

const COMPONENT_IDS: ComponentId[] = [
  'cabinet', 'topper-sign', 'display', 'keypad', 'card-reader', 'contactless-reader', 'cash-slot', 'deposit-slot', 'receipt-slot', 'camera', 'speakers',
  'accessibility', 'service-door', 'vault-door', 'locks-hinges', 'status-leds', 'cassette-A', 'cassette-B', 'cassette-C', 'reject-cassette', 'retract-bin',
  'dispenser', 'picker-rollers', 'transport', 'validation-sensors', 'stacker', 'presenter-shutter', 'receipt-printer', 'card-reader-module', 'deposit-module',
  'power-supply', 'controller-pc', 'comms', 'safe',
];

const hooks = { collectCash() {}, takeCard() {}, onStep() {} };

describe('fault catalog', () => {
  it('defines all 14 faults completely', () => {
    expect(FAULTS).toHaveLength(14);
    expect(new Set(FAULTS.map((f) => f.id)).size).toBe(14);
    for (const f of FAULTS) {
      expect(f.explanation.length).toBeGreaterThan(80);
      expect(f.components.length).toBeGreaterThan(0);
      for (const c of f.components) expect(COMPONENT_IDS).toContain(c);
      expect(f.recovery.length).toBeGreaterThan(0);
      expect(f.transactionOutcome).toBeTruthy();
      expect(f.customerOutcome).toBeTruthy();
      expect(['card-alex', 'card-sam', 'card-jordan', 'card-blocked']).toContain(f.demo.cardId);
    }
  });
});

describe.each(FAULTS.map((f) => f.id))('fault scenario: %s', (id) => {
  it('ends correctly, conserves money and recovers', async () => {
    const r = makeRig();
    const { sys } = r;
    const wealth0 = wealth(sys);
    const notes0 = allNotesValue(sys);

    const res = await runScenario(sys, id, hooks);
    const exp = EXPECTED[id];
    expect(res.txn, res.summary).toBeDefined();
    expect(res.txn!.state).toBe(exp.final);
    if (exp.path) {
      const states = res.txn!.history.map((h) => h.to);
      for (const s of exp.path) expect(states).toContain(s);
    }
    expect(res.summary).toContain(faultById(id)!.title);

    // Money is never created or destroyed; no dangling holds.
    expect(wealth(sys)).toBe(wealth0);
    expect(allNotesValue(sys)).toBe(notes0);
    expect(sys.checkInvariants()).toEqual([]);

    // Fault-specific checks.
    if (id === 'network-timeout') {
      expect(res.txn!.responseCode).toBe('68');
      expect(sys.journal.text()).toMatch(/no response to WITHDRAWAL_AUTH/);
      expect(sys.journal.text()).toMatch(/hold HOLD-\d+ released/);
    }
    if (id === 'note-rejected') expect(sys.inventory.count('reject')).toBe(1);
    if (id === 'cash-not-collected') expect(sys.inventory.count('retract')).toBe(4);
    if (id === 'cash-jam') {
      expect(sys.devices.get('dispenser').status).toBe('FAULT');
      expect(sys.inventory.count('transport') + sys.inventory.count('stacker')).toBe(2);
      expect(sys.app.screen.lines).toContain('Cash withdrawals unavailable');
    }
    if (id === 'printer-out-of-paper') expect(sys.app.screen.lines).toContain('Receipts unavailable');
    if (id === 'low-cash-warning') expect(sys.devices.get('dispenser').status).toBe('WARNING');
    if (id === 'host-unavailable') expect(r.screenId()).toBe('OUT_OF_SERVICE');
    if (id === 'power-loss') {
      expect(r.screenId()).toBe('OUT_OF_SERVICE');
      expect(sys.ledger.allHolds()).toHaveLength(1); // the bank still holds funds for the SUSPECT txn
    }
    expect(sys.app.busy).toBe(false);

    // Recovery returns the ATM to full, usable service.
    await recoverFault(sys, id);
    expect(r.screenId()).toBe('WELCOME');
    expect(sys.faults.armed).toEqual([]);
    expect(sys.checkInvariants()).toEqual([]);
    expect(wealth(sys)).toBe(wealth0);
    if (id === 'power-loss') {
      expect(res.txn!.state).toBe('REVERSED');
      expect(sys.ledger.allHolds()).toHaveLength(0);
      expect(sys.ledger.cards.get('card-alex')!.status).toBe('ACTIVE');
    }

    // ...and can serve the next customer.
    await r.login();
    expect(r.screenId()).toBe('MAIN_MENU');
    await r.touch('menu-withdraw');
    await r.touch('acct-CHK-1001');
    await r.touch('amt-4000');
    expect(sys.app.lastTxn!.state).toBe('COMPLETED');
    await r.touch('receipt-no');
    await r.touch('another-no');
    expect(r.screenId()).toBe('WELCOME');
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('fault details', () => {
  it('power loss journals SUSPECT and recovery retains the card', async () => {
    const r = makeRig();
    await runScenario(r.sys, 'power-loss', hooks);
    expect(r.sys.journal.text()).toMatch(/POWER FAILURE/);
    expect(r.sys.inventory.count('stacker')).toBe(1);
    const res = await r.sys.operator.restorePower();
    expect(res.message).toMatch(/reversed/);
    expect(r.sys.ledger.cards.get('card-alex')!.status).toBe('RETAINED');
    expect(r.sys.inventory.count('stacker')).toBe(0);
    expect(r.sys.inventory.count('reject')).toBe(1);
    expect(r.screenId()).toBe('WELCOME');
    expect(r.sys.checkInvariants()).toEqual([]);
  });

  it('arming insufficient-atm-cash moves notes to the vault (journaled), never destroys them', () => {
    const r = makeRig();
    const total = allNotesValue(r.sys);
    const vault0 = r.sys.inventory.count('vault');
    r.sys.faults.arm('insufficient-atm-cash');
    expect(r.sys.inventory.availableCents()).toBe(5 * 2_000 + 5_000);
    expect(r.sys.inventory.count('vault')).toBeGreaterThan(vault0);
    expect(allNotesValue(r.sys)).toBe(total);
    expect(r.sys.journal.audit.some((a) => a.actor === 'TRAINER')).toBe(true);
    expect(r.sys.checkInvariants()).toEqual([]);
  });

  it('host-unavailable reversal is queued (store-and-forward) and delivered on reset', async () => {
    const r = makeRig();
    r.customer.cash = 'never';
    await r.login();
    await r.touch('menu-withdraw');
    await r.touch('acct-CHK-1001');
    // Arm host-unavailable while the cash is presented: the reversal cannot be delivered.
    const off = r.bus.on('txn.state', ({ to }) => {
      if (to === 'PRESENTED') r.sys.faults.arm('host-unavailable');
    });
    await r.touch('amt-6000');
    off();
    const txn = r.sys.app.lastTxn!;
    expect(txn.state).toBe('REVERSAL_PENDING');
    expect(r.sys.engine.saf).toHaveLength(1);
    expect(r.sys.ledger.allHolds()).toHaveLength(1);
    expect(r.sys.checkInvariants()).toEqual([]);
    await r.touch('receipt-no');
    await r.touch('another-no');
    expect(r.screenId()).toBe('OUT_OF_SERVICE');
    await r.sys.operator.resetDevice('host');
    expect(txn.state).toBe('REVERSED');
    expect(r.sys.ledger.allHolds()).toHaveLength(0);
    expect(r.screenId()).toBe('WELCOME');
    expect(r.sys.checkInvariants()).toEqual([]);
  });
});
