import { describe, expect, it } from 'vitest';
import { makeRig, type TestRig } from './helpers';

async function busyDay(r: TestRig) {
  await r.login();
  for (const amt of ['amt-6000', 'amt-20000', 'amt-4000']) {
    await r.touch('menu-withdraw');
    await r.touch('acct-CHK-1001');
    await r.touch(amt);
    await r.touch('receipt-no');
    await r.touch('another-yes');
  }
  await r.touch('menu-deposit');
  await r.touch('acct-SAV-1002');
  await r.touch('dep-plus-50');
  await r.touch('dep-insert');
  await r.touch('dep-confirm');
  await r.touch('receipt-no');
  await r.touch('another-no');
}

describe('reconciliation', () => {
  it('balances after a normal day (incl. reject, retract and replenishment)', async () => {
    const r = makeRig();
    await busyDay(r);
    r.sys.faults.arm('note-rejected');
    r.customer.cash = 'never';
    await r.login();
    await r.touch('menu-withdraw');
    await r.touch('acct-CHK-1001');
    await r.touch('amt-10000');
    await r.touch('receipt-no');
    await r.touch('another-no');
    r.sys.operator.replenish('A', 100);

    const rep = r.sys.recon.report();
    expect(rep.balanced).toBe(true);
    expect(rep.dispensedPerJournalCents).toBe(30_000);
    expect(rep.hostPostedCents).toBe(30_000);
    expect(rep.depositsCents).toBe(5_000);
    expect(rep.retractedNotes).toBe(1); // 1 × $100
    expect(rep.rejectedNotes).toBe(1);
    expect(rep.replenishedCents).toBe(2_000 * 100);
    expect(rep.expectedEndingCents).toBe(rep.physicalEndingCents);
    expect(rep.differences[0].title).toBe('ATM balanced');
    expect(rep.method.length).toBeGreaterThan(3);
  });

  const cases = [
    ['missing-notes', /missing/, /short/],
    ['counter-error', /counter error/, /counter itself is wrong/],
    ['misloaded-note', /misloaded/, /replenishment/],
  ] as const;
  for (const [kind, title, expl] of cases) {
    it(`detects and explains ${kind}; closeDay settles and resets the baseline`, async () => {
      const r = makeRig();
      await busyDay(r);
      r.sys.recon.injectDiscrepancy(kind);
      expect(r.sys.checkInvariants().length).toBeGreaterThan(0);
      const rep = r.sys.recon.report();
      expect(rep.balanced).toBe(false);
      const d = rep.differences.find((x) => title.test(x.title));
      expect(d, JSON.stringify(rep.differences, null, 1)).toBeDefined();
      expect(d!.explanation).toMatch(expl);
      expect(r.sys.journal.audit.some((a) => a.actor === 'TRAINER' && a.action.includes(kind))).toBe(true);

      const closed = r.sys.recon.closeDay();
      expect(closed.balanced).toBe(false);
      const fresh = r.sys.recon.report();
      expect(fresh.balanced).toBe(true);
      expect(fresh.dispensedPerJournalCents).toBe(0);
      expect(fresh.replenishedCents).toBe(0);
      expect(r.sys.inventory.totals.dispensedCents).toBe(0);
      expect(r.sys.checkInvariants()).toEqual([]);
    });
  }

  it('closeDay on a balanced day starts a new baseline', async () => {
    const r = makeRig();
    await busyDay(r);
    const before = r.sys.recon.baseline.time;
    r.clock.wait(1000);
    r.sys.recon.closeDay();
    expect(r.sys.recon.baseline.time).toBeGreaterThanOrEqual(before);
    expect(r.sys.recon.baseline.machineCents).toBe(r.sys.inventory.machineValueCents());
    expect(r.sys.ledger.account('CHK-1001').withdrawnTodayCents).toBe(0);
  });
});
