import { describe, expect, it } from 'vitest';
import { makeRig, wealth } from './helpers';

describe('deposit, transfer, balance, statement', () => {
  it('deposit: wallet → escrow → deposit cassette, account credited', async () => {
    const r = makeRig();
    const { sys } = r;
    const w0 = wealth(sys);
    await r.login();
    await r.touch('menu-deposit');
    await r.touch('acct-CHK-1001');
    expect(r.screenId()).toBe('DEPOSIT_INSERT');
    expect(r.buttons()).toEqual(expect.arrayContaining(['dep-plus-20', 'dep-minus-20', 'dep-plus-50', 'dep-plus-100', 'dep-insert', 'dep-cancel']));
    expect(sys.app.screen.buttons.find((b) => b.id === 'dep-plus-10')!.enabled).toBe(false); // wallet has no $10s
    await r.touch('dep-plus-20');
    await r.touch('dep-plus-20');
    await r.touch('dep-plus-50');
    await r.touch('dep-insert');
    expect(r.screenId()).toBe('DEPOSIT_CONFIRM');
    expect(sys.inventory.count('escrow')).toBe(3);
    expect(sys.app.screen.lines.join(' ')).toMatch(/\$90\.00/);
    await r.touch('dep-confirm');
    expect(r.screenId()).toBe('RESULT');
    const txn = sys.app.lastTxn!;
    expect(txn.type).toBe('DEPOSIT');
    expect(txn.history.map((h) => h.to)).toEqual(['ESCROWED', 'AUTH_PENDING', 'AUTHORIZED', 'COMPLETED']);
    expect(sys.ledger.account('CHK-1001').ledgerCents).toBe(245_075 + 9_000);
    expect(sys.inventory.count('deposit')).toBe(3);
    expect(sys.inventory.totals.acceptedCents).toBe(9_000);
    expect(wealth(sys)).toBe(w0);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('deposit cancel at confirm returns the notes and the card', async () => {
    const r = makeRig();
    const wallet0 = r.sys.inventory.valueAt('customer');
    await r.login();
    await r.touch('menu-deposit');
    await r.touch('acct-SAV-1002');
    await r.touch('dep-plus-100');
    await r.touch('dep-insert');
    await r.touch('dep-cancel');
    expect(r.screenId()).toBe('WELCOME');
    expect(r.sys.inventory.valueAt('customer')).toBe(wallet0);
    expect(r.sys.inventory.count('escrow')).toBe(0);
    expect(r.sys.journal.transactions[0].state).toBe('CANCELLED');
    expect(r.sys.checkInvariants()).toEqual([]);
  });

  it('transfer between own accounts', async () => {
    const r = makeRig();
    await r.login();
    await r.touch('menu-transfer');
    await r.touch('acct-SAV-1002');
    expect(r.screenId()).toBe('TRANSFER_TO');
    expect(r.buttons()).toEqual(['to-CHK-1001', 'to-cancel']);
    await r.touch('to-CHK-1001');
    await r.keys('150');
    await r.key('ENTER');
    expect(r.sys.app.lastTxn!.state).toBe('COMPLETED');
    expect(r.sys.ledger.account('SAV-1002').ledgerCents).toBe(812_000 - 15_000);
    expect(r.sys.ledger.account('CHK-1001').ledgerCents).toBe(245_075 + 15_000);
    expect(r.sys.checkInvariants()).toEqual([]);
  });

  it('transfer is disabled for single-account cards; insufficient transfer declines 51', async () => {
    const r = makeRig();
    await r.login('card-sam');
    expect(r.sys.app.screen.buttons.find((b) => b.id === 'menu-transfer')!.enabled).toBe(false);
    await r.touch('menu-end');
    await r.login();
    await r.touch('menu-transfer');
    await r.touch('acct-CHK-1001');
    await r.touch('to-SAV-1002');
    await r.keys('99999');
    await r.key('ENTER');
    expect(r.sys.app.lastTxn!.responseCode).toBe('51');
    expect(r.sys.app.lastTxn!.state).toBe('DECLINED');
  });

  it('balance inquiry shows ledger and available balance', async () => {
    const r = makeRig();
    await r.login();
    await r.touch('menu-balance');
    await r.touch('acct-CHK-1001');
    expect(r.screenId()).toBe('RESULT');
    expect(r.sys.app.screen.lines.join('\n')).toMatch(/Available balance: \$2,450\.75/);
    expect(r.sys.app.lastTxn!.state).toBe('COMPLETED');
    expect(r.sys.ledger.postings.filter((p) => p.txnId === r.sys.app.lastTxn!.id)).toHaveLength(0);
  });

  it('mini statement lists the latest lines', async () => {
    const r = makeRig();
    await r.login();
    await r.touch('menu-statement');
    await r.touch('acct-CHK-1001');
    expect(r.sys.app.screen.lines.join('\n')).toMatch(/Payroll/);
    await r.touch('receipt-yes');
    expect(r.screenId()).toBe('ANOTHER_TXN');
  });
});

describe('cancel at each screen ends the session and returns the card', () => {
  const paths: Array<[string, string[]]> = [
    ['PIN_ENTRY', []],
    ['MAIN_MENU', ['PIN']],
    ['ACCOUNT_SELECT', ['PIN', 'menu-withdraw']],
    ['AMOUNT_ENTRY', ['PIN', 'menu-withdraw', 'acct-CHK-1001']],
    ['TRANSFER_TO', ['PIN', 'menu-transfer', 'acct-CHK-1001']],
    ['DEPOSIT_INSERT', ['PIN', 'menu-deposit', 'acct-CHK-1001']],
    ['DEPOSIT_CONFIRM', ['PIN', 'menu-deposit', 'acct-CHK-1001', 'dep-plus-20', 'dep-insert']],
  ];
  for (const [screen, steps] of paths) {
    it(`CANCEL on ${screen}`, async () => {
      const r = makeRig();
      const wallet0 = r.sys.inventory.valueAt('customer');
      await r.card('card-alex');
      for (const s of steps) {
        if (s === 'PIN') {
          await r.keys('1234');
          await r.key('ENTER');
        } else await r.touch(s);
      }
      expect(r.screenId()).toBe(screen);
      await r.key('CANCEL');
      expect(r.screenId()).toBe('WELCOME');
      expect(r.sys.app.sessionActive).toBe(false);
      expect(r.sys.engine.session).toBeNull();
      expect(r.mech.calls).toContain('cardEject');
      expect(r.sys.inventory.valueAt('customer')).toBe(wallet0);
      expect(r.sys.checkInvariants()).toEqual([]);
    });
  }
});
