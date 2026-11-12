import { describe, expect, it } from 'vitest';
import { makeRig, type TestRig } from './helpers';
import { runScenario } from '../../src/faults/autopilot';

async function sequence(r: TestRig) {
  await r.login();
  await r.touch('menu-withdraw');
  await r.touch('acct-CHK-1001');
  await r.keys('370');
  await r.key('ENTER');
  await r.touch('receipt-yes');
  await r.touch('another-yes');
  await r.touch('menu-deposit');
  await r.touch('acct-SAV-1002');
  await r.touch('dep-plus-20');
  await r.touch('dep-insert');
  await r.touch('dep-confirm');
  await r.touch('receipt-no');
  await r.touch('another-no');
  r.customer.cash = 'never';
  await r.login();
  await r.touch('menu-withdraw');
  await r.touch('acct-CHK-1001');
  await r.touch('amt-4000');
  await r.key('CANCEL');
}

describe('determinism', () => {
  it('same seed + same inputs → identical journal text', async () => {
    const a = makeRig(42);
    const b = makeRig(42);
    await sequence(a);
    await sequence(b);
    expect(a.sys.journal.text()).toBe(b.sys.journal.text());
    expect(a.sys.journal.text().length).toBeGreaterThan(1000);
  });

  it('reset() restores the initial state', async () => {
    const r = makeRig(7);
    // Sim time belongs to the clock (presentation layer) and keeps running, so compare entry texts.
    const texts = () => r.sys.journal.entries.map((e) => e.text);
    const initial = texts();
    await sequence(r);
    r.sys.reset();
    expect(texts()).toEqual(initial);
    expect(r.sys.ledger.account('CHK-1001').ledgerCents).toBe(245_075);
    expect(r.screenId()).toBe('WELCOME');
    expect(r.sys.checkInvariants()).toEqual([]);
  });
});

describe('operator console', () => {
  it('enter/exit service mode only between sessions; checklist ticks', async () => {
    const r = makeRig();
    await r.login();
    expect(r.sys.operator.enter().ok).toBe(false);
    await r.touch('menu-end');
    expect(r.sys.operator.enter().ok).toBe(true);
    expect(r.screenId()).toBe('SERVICE_MODE');
    await r.card('card-alex');
    expect(r.screenId()).toBe('SERVICE_MODE');
    r.sys.operator.loadPaper();
    await r.sys.operator.runTest('cardReader');
    const done = Object.fromEntries(r.sys.operator.checklist.map((c) => [c.id, c.done]));
    expect(done['enter-service']).toBe(true);
    expect(done['paper']).toBe(true);
    expect(done['self-test']).toBe(true);
    expect(done['replenish']).toBe(false);
    r.sys.operator.exit();
    expect(r.sys.operator.checklist.find((c) => c.id === 'exit-service')!.done).toBe(true);
    expect(r.screenId()).toBe('WELCOME');
  });

  it('replenish respects capacity', () => {
    const r = makeRig();
    const res = r.sys.operator.replenish('A', 1_000);
    expect(r.sys.inventory.cassettes.A.counter).toBe(2_500);
    expect(r.sys.inventory.physicalCount('A')).toBe(2_500);
    expect(res.message).toMatch(/Loaded 500/);
    expect(r.sys.operator.replenish('A', 10).message).toMatch(/Loaded 0/);
    expect(r.sys.recon.report().balanced).toBe(true);
    expect(r.sys.checkInvariants()).toEqual([]);
  });

  it('reconfigure a cassette denomination', async () => {
    const r = makeRig();
    const res = r.sys.operator.reconfigureCassette('A', 10, 300);
    expect(res.ok).toBe(true);
    const a = r.sys.inventory.cassettes.A;
    expect(a.denom).toBe(10);
    expect(a.counter).toBe(300);
    expect(r.sys.inventory.notesAt('cassette:A').every((n) => n.denom === 10)).toBe(true);
    expect(r.sys.checkInvariants()).toEqual([]);
    // $30 is now possible.
    await r.login();
    await r.touch('menu-withdraw');
    await r.touch('acct-CHK-1001');
    await r.keys('30');
    await r.key('ENTER');
    expect(r.sys.app.lastTxn!.state).toBe('COMPLETED');
    expect(r.sys.recon.report().balanced).toBe(true);
  });

  it('remove / install cassette', () => {
    const r = makeRig();
    r.sys.operator.removeCassette('C');
    expect(r.sys.inventory.usableCassettes().map((c) => c.id)).toEqual(['A', 'B']);
    r.sys.operator.installCassette('C');
    expect(r.sys.inventory.usableCassettes().map((c) => c.id)).toEqual(['A', 'B', 'C']);
  });

  it('dispenser test moves one note per cassette to reject and updates counters', async () => {
    const r = makeRig();
    const t = await r.sys.operator.runTest('dispenser');
    expect(t.passed).toBe(true);
    expect(r.sys.inventory.count('reject')).toBe(3);
    expect(r.sys.inventory.cassettes.A.counter).toBe(1_999);
    expect(r.sys.inventory.cassettes.B.counter).toBe(999);
    expect(r.sys.inventory.cassettes.C.counter).toBe(499);
    expect(r.sys.checkInvariants()).toEqual([]);
    expect(r.sys.recon.report().balanced).toBe(true);
  });

  it('dispenser test fails while jammed; clearJam purges and fixes', async () => {
    const r = makeRig();
    await runScenario(r.sys, 'cash-jam', { collectCash() {}, takeCard() {}, onStep() {} });
    expect((await r.sys.operator.runTest('dispenser')).passed).toBe(false);
    // Resetting the dispenser is refused while notes are still in the transport/stacker.
    expect((await r.sys.operator.resetDevice('dispenser')).ok).toBe(false);
    const cleared = await r.sys.operator.clearJam();
    expect(cleared.message).toMatch(/2 note/);
    expect(r.sys.devices.get('dispenser').status).toBe('OK');
    expect((await r.sys.operator.runTest('dispenser')).passed).toBe(true);
    expect(r.sys.checkInvariants()).toEqual([]);
  });

  it('emptyBin moves notes to the vault and is recorded', async () => {
    const r = makeRig();
    await r.sys.operator.runTest('dispenser');
    const res = r.sys.operator.emptyBin('reject');
    expect(res.message).toMatch(/3 note/);
    expect(r.sys.inventory.count('reject')).toBe(0);
    const rep = r.sys.recon.report();
    expect(rep.binsEmptiedCents).toBe(17_000);
    expect(rep.balanced).toBe(true);
  });

  it('operator actions are refused while a customer flow is running', async () => {
    const r = makeRig();
    r.sys.app.input({ kind: 'card', cardId: 'card-alex', method: 'chip' });
    expect(r.sys.operator.replenish('A', 10).ok).toBe(false);
    await r.sys.app.settle();
  });
});
