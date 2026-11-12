import { describe, expect, it } from 'vitest';
import { Ledger, GL_ATM_CASH } from '../../src/banking/ledger';
import { AuthorizationHost } from '../../src/banking/host';
import { createSeedData } from '../../src/banking/seed';
import { cardTokenFor, makePinBlock } from '../../src/banking/pin';
import { Rng } from '../../src/core/rng';
import type { HostMessageType, HostRequest } from '../../src/core/types';

function setup() {
  const ledger = Ledger.fromSeed(createSeedData(), () => 0);
  const host = new AuthorizationHost(ledger, new Rng(1));
  let stan = 0;
  const req = (type: HostMessageType, cardId: string, fields: Partial<HostRequest> = {}): HostRequest => {
    const s = String(++stan).padStart(6, '0');
    return { msgId: `M${s}`, type, stan: s, terminalId: 'T', time: 0, cardToken: cardTokenFor(cardId), ...fields };
  };
  const pinReq = (cardId: string, pin: string) => {
    const r = req('CARD_AUTH', cardId);
    r.pinBlock = makePinBlock(pin, r.cardToken, r.stan);
    return r;
  };
  return { ledger, host, req, pinReq };
}

describe('Ledger', () => {
  it('seeds the documented balances', () => {
    const { ledger } = setup();
    expect(ledger.account('CHK-1001').ledgerCents).toBe(245_075);
    expect(ledger.account('SAV-1002').ledgerCents).toBe(812_000);
    expect(ledger.account('CHK-2001').ledgerCents).toBe(3_540);
    expect(ledger.account('CHK-3001').status).toBe('FROZEN');
    expect(ledger.trialBalanceCents()).toBe(0);
  });

  it('double entry: legs sum to zero, unbalanced postings throw', () => {
    const { ledger } = setup();
    expect(() => ledger.post('T', 'bad', [{ account: 'CHK-1001', amountCents: -100 }])).toThrow(/Unbalanced/);
    const p = ledger.post('T', 'ok', [
      { account: 'CHK-1001', amountCents: -100 },
      { account: GL_ATM_CASH, amountCents: 100 },
    ]);
    expect(p.legs.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
    for (const posting of ledger.postings) expect(posting.legs.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
    expect(ledger.trialBalanceCents()).toBe(0);
  });

  it('holds reduce available but not the ledger balance; release is idempotent', () => {
    const { ledger } = setup();
    const before = ledger.account('CHK-1001').ledgerCents;
    const h = ledger.placeHold('CHK-1001', 'TXN-X', 10_000);
    expect(ledger.account('CHK-1001').ledgerCents).toBe(before);
    expect(ledger.available('CHK-1001')).toBe(before - 10_000);
    expect(ledger.releaseHold(h.id)).toBeDefined();
    expect(ledger.releaseHold(h.id)).toBeUndefined();
    expect(ledger.available('CHK-1001')).toBe(before);
  });

  it('statement returns the latest lines', () => {
    const { ledger } = setup();
    const st = ledger.statement('CHK-1001', 3);
    expect(st).toHaveLength(3);
    expect(st[st.length - 1].balanceCents).toBe(245_075);
  });
});

describe('AuthorizationHost', () => {
  it('approves a correct PIN and returns linked accounts', () => {
    const { host, pinReq } = setup();
    const r = host.handle(pinReq('card-alex', '1234'));
    expect(r.code).toBe('00');
    expect(r.accounts?.map((a) => a.id)).toEqual(['CHK-1001', 'SAV-1002']);
  });

  it('wrong PIN → 55; third wrong → 75 and card BLOCKED', () => {
    const { host, ledger, pinReq } = setup();
    expect(host.handle(pinReq('card-alex', '0000')).code).toBe('55');
    expect(ledger.cards.get('card-alex')!.pinTriesRemaining).toBe(2);
    expect(host.handle(pinReq('card-alex', '0001')).code).toBe('55');
    expect(host.handle(pinReq('card-alex', '0002')).code).toBe('75');
    expect(ledger.cards.get('card-alex')!.status).toBe('BLOCKED');
    expect(host.handle(pinReq('card-alex', '1234')).code).toBe('62');
  });

  it('the PIN block changes with every STAN (no replay of the same block)', () => {
    const t = cardTokenFor('card-alex');
    expect(makePinBlock('1234', t, '000001')).not.toBe(makePinBlock('1234', t, '000002'));
    expect(makePinBlock('1234', t, '000001')).toMatch(/^SIMPIN-[0-9A-F]{8}$/);
  });

  it('blocked card → 62', () => {
    const { host, pinReq } = setup();
    expect(host.handle(pinReq('card-blocked', '0000')).code).toBe('62');
  });

  it('frozen account → 57, over limit → 61, insufficient → 51', () => {
    const { host, req } = setup();
    expect(host.handle(req('WITHDRAWAL_AUTH', 'card-jordan', { accountId: 'CHK-3001', amountCents: 2_000 })).code).toBe('57');
    expect(host.handle(req('WITHDRAWAL_AUTH', 'card-alex', { accountId: 'SAV-1002', amountCents: 120_000 })).code).toBe('61');
    expect(host.handle(req('WITHDRAWAL_AUTH', 'card-sam', { accountId: 'CHK-2001', amountCents: 10_000 })).code).toBe('51');
    expect(host.handle(req('WITHDRAWAL_AUTH', 'card-alex', { accountId: 'CHK-2001', amountCents: 2_000 })).code).toBe('05');
  });

  it('authorisation holds; completion posts once; reversal releases (idempotent)', () => {
    const { host, ledger, req } = setup();
    const auth = req('WITHDRAWAL_AUTH', 'card-alex', { accountId: 'CHK-1001', amountCents: 6_000, txnId: 'T1' });
    const r = host.handle(auth);
    expect(r.code).toBe('00');
    expect(ledger.account('CHK-1001').ledgerCents).toBe(245_075);
    expect(ledger.available('CHK-1001')).toBe(245_075 - 6_000);

    const comp = req('WITHDRAWAL_COMPLETION', 'card-alex', { originalStan: auth.stan, dispensedCents: 6_000 });
    expect(host.handle(comp).code).toBe('00');
    expect(host.handle({ ...comp, stan: '999999' }).code).toBe('00'); // duplicate ignored
    expect(ledger.account('CHK-1001').ledgerCents).toBe(245_075 - 6_000);
    expect(ledger.allHolds()).toHaveLength(0);

    const auth2 = req('WITHDRAWAL_AUTH', 'card-alex', { accountId: 'CHK-1001', amountCents: 4_000, txnId: 'T2' });
    host.handle(auth2);
    const rev = req('REVERSAL', 'card-alex', { originalStan: auth2.stan });
    expect(host.handle(rev).code).toBe('00');
    expect(host.handle(rev).text).toMatch(/already reversed/);
    expect(host.handle(req('REVERSAL', 'card-alex', { originalStan: '424242' })).text).toMatch(/nothing to reverse/);
    expect(ledger.account('CHK-1001').ledgerCents).toBe(245_075 - 6_000);
    expect(ledger.allHolds()).toHaveLength(0);
    expect(ledger.trialBalanceCents()).toBe(0);
  });

  it('transfer posts both legs; insufficient → 51; deposit credits', () => {
    const { host, ledger, req } = setup();
    expect(host.handle(req('TRANSFER', 'card-alex', { accountId: 'CHK-1001', toAccountId: 'SAV-1002', amountCents: 5_000 })).code).toBe('00');
    expect(ledger.account('SAV-1002').ledgerCents).toBe(817_000);
    expect(host.handle(req('TRANSFER', 'card-alex', { accountId: 'CHK-1001', toAccountId: 'SAV-1002', amountCents: 9_999_999 })).code).toBe('51');
    expect(host.handle(req('DEPOSIT', 'card-sam', { accountId: 'CHK-2001', amountCents: 2_000 })).code).toBe('00');
    expect(ledger.account('CHK-2001').ledgerCents).toBe(5_540);
    expect(host.handle(req('MINI_STATEMENT', 'card-sam', { accountId: 'CHK-2001' })).statement!.length).toBeLessThanOrEqual(6);
    expect(ledger.trialBalanceCents()).toBe(0);
  });
});
