import { describe, expect, it } from 'vitest';
import { ALLOWED, IllegalTransitionError, isFinal, transition } from '../../src/transactions/stateMachine';
import { FINAL_TXN_STATES, type Transaction, type TxnState } from '../../src/core/types';
import { makeRig } from './helpers';

function txn(state: TxnState): Transaction {
  return { id: 'T', type: 'WITHDRAWAL', stan: '1', cardId: 'c', requestedCents: 0, presentedCents: 0, collectedCents: 0, postedCents: 0, state, history: [], createdAt: 0 };
}

describe('transaction state machine', () => {
  it('illegal transitions throw', () => {
    expect(() => transition(txn('CREATED'), 'COMPLETED', 'x', 0)).toThrow(IllegalTransitionError);
    expect(() => transition(txn('AUTHORIZED'), 'COLLECTED', 'x', 0)).toThrow(IllegalTransitionError);
    expect(() => transition(txn('COMPLETED'), 'REVERSED', 'x', 0)).toThrow(IllegalTransitionError);
    expect(() => transition(txn('DECLINED'), 'AUTHORIZED', 'x', 0)).toThrow(IllegalTransitionError);
  });

  it('legal transitions record history', () => {
    const t = txn('CREATED');
    transition(t, 'AUTH_PENDING', 'a', 1);
    transition(t, 'AUTHORIZED', 'b', 2);
    expect(t.state).toBe('AUTHORIZED');
    expect(t.history.map((h) => h.to)).toEqual(['AUTH_PENDING', 'AUTHORIZED']);
  });

  it('final states have no exits; every non-final state can reach a final state', () => {
    for (const s of FINAL_TXN_STATES) expect(ALLOWED[s]).toEqual([]);
    for (const s of Object.keys(ALLOWED) as TxnState[]) {
      const seen = new Set<TxnState>([s]);
      const queue = [s];
      while (queue.length) for (const n of ALLOWED[queue.shift()!]) if (!seen.has(n)) (seen.add(n), queue.push(n));
      expect([...seen].some(isFinal)).toBe(true);
    }
  });

  it('every journaled transaction ends in a final state after settle', async () => {
    const r = makeRig();
    await r.login();
    for (const [menu, acct, amt] of [
      ['menu-withdraw', 'acct-CHK-1001', 'amt-4000'],
      ['menu-balance', 'acct-SAV-1002', ''],
      ['menu-withdraw', 'acct-CHK-1001', 'amt-50000'],
    ] as const) {
      await r.touch(menu);
      await r.touch(acct);
      if (amt) await r.touch(amt);
      await r.touch('receipt-no');
      await r.touch('another-yes');
    }
    await r.touch('menu-end');
    expect(r.sys.journal.transactions.length).toBe(3);
    for (const t of r.sys.journal.transactions) expect(isFinal(t.state)).toBe(true);
    expect(r.sys.checkInvariants()).toEqual([]);
  });
});
