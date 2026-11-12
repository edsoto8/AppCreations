import { formatCents } from '../core/money';
import { CASSETTE_IDS, denomCents, type CassetteId, type Cents, type Denomination } from '../core/types';
import type { CashInventory } from '../cash/inventory';
import { GL_ATM_CASH, type Ledger } from '../banking/ledger';
import type { Journal } from '../transactions/journal';

export interface ReconBaseline {
  time: number;
  cassettes: Record<CassetteId, { denom: Denomination; counter: number; physical: number }>;
  bins: Record<'reject' | 'retract' | 'deposit', { notes: number; cents: Cents }>;
  /** Value of all notes physically inside the ATM at the start of the business day. */
  machineCents: Cents;
}

export interface ReconDifference {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  explanation: string;
}

export interface CassetteRecon {
  id: CassetteId;
  denom: Denomination;
  beginning: number;
  loaded: number;
  unloaded: number;
  picked: number;
  /** Beginning + loaded − unloaded − picked: what the journal says should be there. */
  expected: number;
  /** The ATM's logical counter. */
  counter: number;
  /** Notes physically counted in the cassette. */
  physical: number;
  physicalCents: Cents;
  expectedCents: Cents;
  /** Notes in the cassette whose denomination does not match the cassette's configured denomination. */
  misdenominated: number;
}

export interface ReconReport {
  time: number;
  baselineTime: number;
  beginningCents: Cents;
  replenishedCents: Cents;
  unloadedCents: Cents;
  /** Cash collected by customers according to the electronic journal (withdrawal transactions). */
  dispensedPerJournalCents: Cents;
  /** Cash collected according to the dispenser's own movement records. */
  dispensedPerDeviceCents: Cents;
  /** Cash withdrawals the bank host actually posted for this ATM (settlement view). */
  hostPostedCents: Cents;
  depositsCents: Cents;
  rejectedNotes: number;
  rejectedCents: Cents;
  retractedNotes: number;
  retractedCents: Cents;
  binsEmptiedCents: Cents;
  expectedEndingCents: Cents;
  physicalEndingCents: Cents;
  /** Value implied by the logical counters + bins. */
  counterEndingCents: Cents;
  cassettes: CassetteRecon[];
  bins: { reject: number; retract: number; deposit: number };
  unaccountedNotes: number;
  differences: ReconDifference[];
  /** How each kind of difference is detected (educational). */
  method: string[];
  balanced: boolean;
}

const METHOD = [
  'Journal view: beginning count + replenishments − unloads − notes picked, per cassette, from the recorded movements.',
  'Counter view: the ATM software\'s logical counter for each cassette.',
  'Physical view: notes actually counted in each cassette and bin by the custodian.',
  'Journal ≠ counter → the counter was corrupted (software/counter error).',
  'Counter ≠ physical → notes are missing (or extra) in the cassette.',
  'Wrong denomination found in a cassette → a note was misloaded during replenishment.',
  'Machine cash: expected ending value (beginning + loads − unloads − dispensed + deposits − bins emptied) vs. the physical value.',
  'Settlement: cash the journal says customers took vs. what the bank host posted for this ATM.',
];

/**
 * End-of-day ATM balancing ("settlement"). Three independent views of the cash are compared:
 * what the journal says happened, what the logical counters say, and what is physically there.
 * Any disagreement is listed with an explanation of how it was detected and what it usually means.
 */
export class Reconciliation {
  baseline!: ReconBaseline;

  constructor(
    private readonly inventory: CashInventory,
    private readonly journal: Journal,
    private readonly ledger: Ledger,
    private readonly now: () => number,
  ) {
    this.baseline = this.capture();
  }

  private capture(): ReconBaseline {
    const inv = this.inventory;
    const cassettes = {} as ReconBaseline['cassettes'];
    for (const id of CASSETTE_IDS) cassettes[id] = { denom: inv.cassettes[id].denom, counter: inv.cassettes[id].counter, physical: inv.physicalCount(id) };
    const bin = (b: 'reject' | 'retract' | 'deposit') => ({ notes: inv.count(b), cents: inv.valueAt(b) });
    return { time: this.now(), cassettes, bins: { reject: bin('reject'), retract: bin('retract'), deposit: bin('deposit') }, machineCents: inv.machineValueCents() };
  }

  report(): ReconReport {
    const inv = this.inventory;
    const a = inv.activity;
    const base = this.baseline;
    const diffs: ReconDifference[] = [];

    const cassettes: CassetteRecon[] = CASSETTE_IDS.map((id) => {
      const c = inv.cassettes[id];
      const act = a.cassettes[id];
      const b = base.cassettes[id];
      const expected = b.counter + act.loaded - act.unloaded - act.picked;
      const notes = inv.notesAt(`cassette:${id}`);
      const physicalCents = notes.reduce((s, n) => s + denomCents(n.denom), 0);
      const misdenominated = notes.filter((n) => n.denom !== c.denom).length;
      return {
        id,
        denom: c.denom,
        beginning: b.counter,
        loaded: act.loaded,
        unloaded: act.unloaded,
        picked: act.picked,
        expected,
        counter: c.counter,
        physical: notes.length,
        physicalCents,
        expectedCents: expected * denomCents(c.denom),
        misdenominated,
      };
    });

    for (const c of cassettes) {
      if (c.counter !== c.expected) {
        diffs.push({
          severity: 'critical',
          title: `Cassette ${c.id}: counter error (${c.counter} vs ${c.expected} expected)`,
          explanation: `The journal of loads and picks says cassette ${c.id} should hold ${c.expected} notes, but the ATM's logical counter says ${c.counter}. No recorded movement explains the change, so the counter itself is wrong (software or counter error). Correct the counter to the physical count and investigate.`,
        });
      }
      // Compare the physical count with the JOURNAL view, so a pure counter error is not mistaken for missing cash.
      if (c.physical !== c.expected) {
        const diff = c.physical - c.expected;
        diffs.push({
          severity: 'critical',
          title: `Cassette ${c.id}: ${Math.abs(diff)} note(s) ${diff < 0 ? 'missing' : 'extra'}`,
          explanation: `The custodian counted ${c.physical} notes but the journal says ${c.expected} should be there (${formatCents(Math.abs(diff) * denomCents(c.denom))} ${diff < 0 ? 'short' : 'over'}). ${diff < 0 ? 'Notes left the cassette without being picked by the dispenser — possible miscount at loading, or theft.' : 'More notes than recorded — likely a loading miscount.'}`,
        });
      }
      if (c.misdenominated > 0) {
        diffs.push({
          severity: 'warning',
          title: `Cassette ${c.id}: ${c.misdenominated} misloaded note(s)`,
          explanation: `Cassette ${c.id} is configured for $${c.denom} notes but contains ${c.misdenominated} note(s) of another denomination. The count matches, yet the value does not: a customer could receive the wrong amount. This happens when notes are mixed up during replenishment.`,
        });
      }
    }

    // Journal view of customer activity since the baseline.
    const txns = this.journal.transactions.filter((t) => t.createdAt >= base.time);
    const dispensedPerJournal = txns.filter((t) => t.type === 'WITHDRAWAL').reduce((s, t) => s + t.collectedCents, 0);
    const depositsPerJournal = txns.filter((t) => t.type === 'DEPOSIT' && t.state === 'COMPLETED').reduce((s, t) => s + t.postedCents, 0);
    const hostPosted = this.ledger.postings
      .filter((p) => p.time >= base.time && p.description.startsWith('ATM cash withdrawal'))
      .reduce((s, p) => s + p.legs.filter((l) => l.account === GL_ATM_CASH).reduce((x, l) => x + l.amountCents, 0), 0);

    const expectedEnding = base.machineCents + a.loadedCents - a.unloadedCents - a.dispensedCents + a.acceptedCents - a.emptiedCents;
    const physicalEnding = inv.machineValueCents();
    const binsValue = inv.valueAt('reject') + inv.valueAt('retract') + inv.valueAt('deposit') + inv.valueAt('transport') + inv.valueAt('stacker') + inv.valueAt('presented');
    const counterEnding = CASSETTE_IDS.reduce((s, id) => s + inv.cassettes[id].counter * denomCents(inv.cassettes[id].denom), 0) + binsValue;

    if (physicalEnding !== expectedEnding) {
      const d = physicalEnding - expectedEnding;
      diffs.push({
        severity: 'critical',
        title: `Machine cash ${d < 0 ? 'short' : 'over'} by ${formatCents(Math.abs(d))}`,
        explanation: `Beginning ${formatCents(base.machineCents)} + replenished ${formatCents(a.loadedCents)} − unloaded ${formatCents(a.unloadedCents)} − dispensed ${formatCents(a.dispensedCents)} + deposits ${formatCents(a.acceptedCents)} − bins emptied ${formatCents(a.emptiedCents)} = expected ${formatCents(expectedEnding)}, but ${formatCents(physicalEnding)} is physically in the ATM.`,
      });
    }
    if (dispensedPerJournal !== a.dispensedCents) {
      diffs.push({
        severity: 'warning',
        title: 'Journal and dispenser disagree on cash dispensed',
        explanation: `Transactions in the journal record ${formatCents(dispensedPerJournal)} taken by customers but the dispenser recorded ${formatCents(a.dispensedCents)}.`,
      });
    }
    if (hostPosted !== dispensedPerJournal) {
      diffs.push({
        severity: hostPosted < dispensedPerJournal ? 'warning' : 'critical',
        title: 'ATM and bank host settlement differ',
        explanation: `Customers took ${formatCents(dispensedPerJournal)} according to the ATM journal, but the bank posted ${formatCents(hostPosted)}. ${hostPosted < dispensedPerJournal ? 'A completion message may still be queued (store-and-forward) — check the host link.' : 'The bank posted more than was dispensed: a reversal was probably not delivered.'}`,
      });
    }
    if (depositsPerJournal !== a.acceptedCents) {
      diffs.push({
        severity: 'warning',
        title: 'Deposits per journal differ from the deposit cassette',
        explanation: `The journal shows ${formatCents(depositsPerJournal)} credited to customers, but ${formatCents(a.acceptedCents)} was stored in the deposit cassette.`,
      });
    }
    const unaccounted = inv.count('unaccounted') - inv.acknowledgedUnaccounted;
    if (unaccounted > 0) {
      diffs.push({
        severity: 'info',
        title: `${unaccounted} note(s) unaccounted for`,
        explanation: 'Training view only: the simulator knows these notes left the cassette without any recorded movement (that is what makes them a discrepancy).',
      });
    }
    const retractedTxns = txns.filter((t) => t.history.some((h) => h.to === 'RETRACTED')).length;
    if (a.retractedNotes > 0) {
      diffs.push({
        severity: 'info',
        title: `${a.retractedNotes} retracted note(s) (${formatCents(a.retractedCents)}) from ${retractedTxns} transaction(s)`,
        explanation: 'Retracted bundles were reversed for the customer. Count the retract bin and match it to these transactions in the journal.',
      });
    }
    if (a.rejectedNotes > 0) {
      diffs.push({
        severity: 'info',
        title: `${a.rejectedNotes} note(s) (${formatCents(a.rejectedCents)}) in the reject cassette`,
        explanation: 'Rejected (double/skewed), test and purged notes never reached a customer; they stay in the bank\'s cash and are counted from the reject cassette.',
      });
    }

    const balanced = !diffs.some((d) => d.severity !== 'info');
    if (balanced) {
      diffs.unshift({ severity: 'info', title: 'ATM balanced', explanation: 'Journal, counters and physical count agree for every cassette, and the bank posted exactly what customers took.' });
    }

    return {
      time: this.now(),
      baselineTime: base.time,
      beginningCents: base.machineCents,
      replenishedCents: a.loadedCents,
      unloadedCents: a.unloadedCents,
      dispensedPerJournalCents: dispensedPerJournal,
      dispensedPerDeviceCents: a.dispensedCents,
      hostPostedCents: hostPosted,
      depositsCents: a.acceptedCents,
      rejectedNotes: a.rejectedNotes,
      rejectedCents: a.rejectedCents,
      retractedNotes: a.retractedNotes,
      retractedCents: a.retractedCents,
      binsEmptiedCents: a.emptiedCents,
      expectedEndingCents: expectedEnding,
      physicalEndingCents: physicalEnding,
      counterEndingCents: counterEnding,
      cassettes,
      bins: { reject: inv.count('reject'), retract: inv.count('retract'), deposit: inv.count('deposit') },
      unaccountedNotes: unaccounted,
      differences: diffs,
      method: [...METHOD],
      balanced,
    };
  }

  /**
   * Trainer tool: create a hidden discrepancy for learners to find. These changes are deliberately NOT
   * recorded as cash movements (only in the trainer audit log).
   */
  injectDiscrepancy(kind: 'missing-notes' | 'counter-error' | 'misloaded-note'): string {
    const inv = this.inventory;
    let text: string;
    if (kind === 'missing-notes') {
      const notes = inv.notesAt('cassette:A').slice(-5);
      for (const n of [...notes]) inv.move(n, 'unaccounted', { unrecorded: true, silent: true });
      text = `${notes.length} note(s) removed from cassette A without any record (counter unchanged)`;
    } else if (kind === 'counter-error') {
      inv.cassettes.B.counter += 3;
      text = 'Cassette B logical counter increased by 3 with no notes added';
    } else {
      const a = inv.cassettes.A;
      const wrong = inv.notesAt('vault').find((n) => n.denom !== a.denom);
      const own = inv.notesAt('cassette:A')[0];
      if (!wrong || !own) return 'Could not inject: no suitable notes';
      inv.move(own, 'vault', { unrecorded: true, silent: true });
      inv.move(wrong, 'cassette:A', { unrecorded: true, silent: true, atBottom: true });
      text = `One $${wrong.denom} note swapped into cassette A ($${a.denom}) in place of a $${own.denom} note`;
    }
    this.journal.auditLog('TRAINER', `Inject discrepancy: ${kind}`, text);
    inv.changed();
    return text;
  }

  /**
   * Close the business day: produce the final report, settle the cassettes to the physical count
   * (misloaded notes back to the vault, counters set to what was counted, shortages written off),
   * reset daily withdrawal usage and start a new baseline.
   */
  closeDay(): ReconReport {
    const final = this.report();
    const inv = this.inventory;
    for (const id of CASSETTE_IDS) {
      const c = inv.cassettes[id];
      for (const n of inv.notesAt(`cassette:${id}`).filter((x) => x.denom !== c.denom)) inv.move(n, 'vault', { silent: true });
      c.counter = inv.physicalCount(id);
      inv.refreshStatus(id);
    }
    inv.acknowledgedUnaccounted = inv.count('unaccounted');
    for (const acct of this.ledger.accounts.values()) acct.withdrawnTodayCents = 0;
    inv.resetTotals();
    this.baseline = this.capture();
    this.journal.log('OPERATOR', `Business day closed: ${final.balanced ? 'balanced' : `${final.differences.filter((d) => d.severity !== 'info').length} difference(s) settled`}; new baseline ${formatCents(this.baseline.machineCents)} in machine`);
    this.journal.auditLog('OPERATOR', 'Close day', final.balanced ? 'Balanced' : 'Differences settled');
    inv.changed();
    return final;
  }
}
