import { describe, expect, it } from 'vitest';
import { makeRig, wealth } from './helpers';
import type { ScreenState } from '../../src/core/types';

describe('full withdrawal via AtmApp inputs', () => {
  it('card → PIN → withdraw → collect → receipt → card taken', async () => {
    const r = makeRig();
    const { sys } = r;
    const screens: ScreenState['id'][] = [];
    const cues: string[] = [];
    r.bus.on('screen.changed', ({ screen }) => screens.push(screen.id));
    r.bus.on('atm.cue', ({ cue }) => cues.push(cue));

    const ledger0 = sys.ledger.account('CHK-1001').ledgerCents;
    const counterA0 = sys.inventory.cassettes.A.counter;
    const physA0 = sys.inventory.physicalCount('A');
    const wallet0 = sys.inventory.valueAt('customer');
    const wealth0 = wealth(sys);

    expect(r.screenId()).toBe('WELCOME');
    expect(sys.app.screen.lines).toContain('Insert or tap your card');
    await r.card('card-alex');
    expect(r.screenId()).toBe('PIN_ENTRY');
    expect(sys.app.screen.footer).toMatch(/demo PIN 1234/);
    await r.keys('1234');
    expect(sys.app.screen.input?.value).toBe('••••');
    await r.key('ENTER');
    expect(r.screenId()).toBe('MAIN_MENU');
    await r.touch('menu-withdraw');
    expect(r.screenId()).toBe('ACCOUNT_SELECT');
    expect(r.buttons()).toEqual(['acct-CHK-1001', 'acct-SAV-1002', 'acct-cancel']);
    await r.touch('acct-CHK-1001');
    expect(r.screenId()).toBe('AMOUNT_ENTRY');
    expect(r.buttons()).toContain('amt-6000');
    await r.touch('amt-6000');
    expect(r.screenId()).toBe('RESULT');
    expect(sys.app.screen.lines[0]).toMatch(/Withdrawal complete/);
    await r.touch('receipt-yes');
    expect(r.screenId()).toBe('ANOTHER_TXN');
    await r.touch('another-no');
    expect(r.screenId()).toBe('WELCOME');
    expect(sys.app.sessionActive).toBe(false);

    expect(screens).toEqual(
      expect.arrayContaining(['READING_CARD', 'PIN_ENTRY', 'PROCESSING', 'MAIN_MENU', 'TAKE_CASH', 'RESULT', 'RECEIPT_PRINTING', 'ANOTHER_TXN', 'TAKE_CARD', 'GOODBYE', 'WELCOME']),
    );
    expect(cues).toEqual(expect.arrayContaining(['card-light', 'cash-light', 'receipt-light', 'beep']));

    const txn = sys.app.lastTxn!;
    expect(txn.state).toBe('COMPLETED');
    expect(txn.history.map((h) => h.to)).toEqual(['AUTH_PENDING', 'AUTHORIZED', 'DISPENSING', 'PRESENTED', 'COLLECTED', 'COMPLETED']);
    expect(txn.plan?.picks).toEqual([{ cassette: 'A', denom: 20, count: 3 }]);
    // Debited exactly once.
    expect(sys.ledger.account('CHK-1001').ledgerCents).toBe(ledger0 - 6_000);
    expect(sys.ledger.postings.filter((p) => p.txnId === txn.id)).toHaveLength(1);
    expect(sys.ledger.allHolds()).toHaveLength(0);
    // Inventory moved exactly by the plan.
    expect(sys.inventory.cassettes.A.counter).toBe(counterA0 - 3);
    expect(sys.inventory.physicalCount('A')).toBe(physA0 - 3);
    expect(sys.inventory.valueAt('customer')).toBe(wallet0 + 6_000);
    expect(sys.inventory.totals.dispensedCents).toBe(6_000);
    expect(wealth(sys)).toBe(wealth0);
    expect(sys.devices.get('printer').metrics.receipts).toBe(1);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('keypad amount entry and stage labels', async () => {
    const r = makeRig();
    await r.login();
    await r.touch('menu-withdraw');
    await r.touch('acct-CHK-1001');
    await r.keys('270');
    expect(r.sys.app.screen.input?.value).toBe('$270');
    await r.key('ENTER');
    expect(r.sys.app.lastTxn?.state).toBe('COMPLETED');
    expect(r.sys.app.lastTxn?.collectedCents).toBe(27_000);
    expect(r.clock.stages).toEqual(
      expect.arrayContaining(['Validate amount', 'Plan notes from cassettes', 'Request authorization (place hold)', 'Pick 1 × $20 from cassette A', 'Present cash', 'Wait for customer to take cash', 'Confirm withdrawal to bank (post debit)']),
    );
  });

  it('wrong PIN three times → card retained, then usable again after OK', async () => {
    const r = makeRig();
    await r.card('card-alex');
    for (let i = 0; i < 2; i++) {
      await r.keys('9999');
      await r.key('ENTER');
      expect(r.screenId()).toBe('PIN_ENTRY');
    }
    expect(r.sys.app.screen.lines[0]).toMatch(/1 try remaining/);
    await r.keys('9999');
    await r.key('ENTER');
    expect(r.screenId()).toBe('CARD_RETAINED');
    expect(r.sys.ledger.cards.get('card-alex')!.status).toBe('RETAINED');
    await r.touch('retained-ok');
    expect(r.screenId()).toBe('WELCOME');
    expect(r.sys.operator.returnRetainedCards().ok).toBe(true);
    expect(r.sys.ledger.cards.get('card-alex')!.status).toBe('ACTIVE');
    await r.login();
    expect(r.screenId()).toBe('MAIN_MENU');
  });

  it('blocked card and frozen account', async () => {
    const r = makeRig();
    await r.login('card-blocked');
    expect(r.screenId()).toBe('WELCOME');
    expect(r.sys.app.sessionActive).toBe(false);
    await r.login('card-jordan');
    await r.touch('menu-withdraw');
    await r.touch('acct-CHK-3001');
    await r.touch('amt-2000');
    expect(r.sys.app.lastTxn?.responseCode).toBe('57');
    expect(r.sys.app.screen.lines[0]).toMatch(/not permitted/);
    expect(r.sys.app.screen.lines[0]).toMatch(/has not been charged/);
  });

  it('card not taken is retained', async () => {
    const r = makeRig();
    r.customer.card = 'never';
    await r.login();
    await r.touch('menu-end');
    expect(r.screenId()).toBe('CARD_RETAINED');
    expect(r.sys.engine.retainedCards).toHaveLength(1);
    expect(r.sys.checkInvariants()).toEqual([]);
  });

  it('inputs while busy are ignored and input() never throws', async () => {
    const r = makeRig();
    r.sys.app.input({ kind: 'card', cardId: 'card-alex', method: 'chip' });
    expect(r.sys.app.busy).toBe(true);
    r.sys.app.input({ kind: 'key', key: '1' });
    r.sys.app.input({ kind: 'touch', target: 'nonsense' });
    await r.sys.app.settle();
    expect(r.screenId()).toBe('PIN_ENTRY');
    expect(r.sys.app.screen.input?.value).toBe('');
    expect(() => r.sys.app.input({ kind: 'card', cardId: 'no-such-card', method: 'chip' })).not.toThrow();
  });
});
