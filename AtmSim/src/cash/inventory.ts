import type { EventBus } from '../core/events';
import {
  CASSETTE_IDS,
  denomCents,
  type CassetteId,
  type CassetteState,
  type Cents,
  type DenomCounts,
  type Denomination,
  type InventorySnapshot,
  type Note,
  type NoteLocation,
} from '../core/types';

/** Physical activity per cassette since the last reconciliation baseline (recorded automatically by `move`). */
export interface CassetteActivity {
  /** Notes loaded from the vault (replenishment). */
  loaded: number;
  /** Notes removed to the vault (unload / reconfigure / trainer drain). */
  unloaded: number;
  /** Notes picked onto the transport by the dispenser. */
  picked: number;
}

/**
 * Everything the machine RECORDS about cash movements since the baseline. Reconciliation compares this
 * "journal view" with the logical counters and the physical notes. Deliberately injected discrepancies move
 * notes with `unrecorded: true`, which is exactly why they show up as differences.
 */
export interface InventoryActivity {
  cassettes: Record<CassetteId, CassetteActivity>;
  loadedCents: Cents;
  unloadedCents: Cents;
  /** Bins (reject / retract / deposit) emptied to the vault by the operator. */
  emptiedCents: Cents;
  emptiedNotes: number;
  dispensedCents: Cents;
  acceptedCents: Cents;
  rejectedNotes: number;
  rejectedCents: Cents;
  retractedNotes: number;
  retractedCents: Cents;
}

export interface MoveOptions {
  /** Don't emit 'note.moved' (bulk vault operations — thousands of notes). */
  silent?: boolean;
  /** Don't record the movement in the activity log (discrepancy injection only). */
  unrecorded?: boolean;
  /** Put the note at the bottom of a cassette instead of the top. */
  atBottom?: boolean;
}

/** Locations that are inside the ATM's safe/cabinet (used for whole-machine cash balancing). */
export const MACHINE_LOCATIONS: readonly NoteLocation[] = [
  'cassette:A',
  'cassette:B',
  'cassette:C',
  'transport',
  'stacker',
  'presented',
  'reject',
  'retract',
  'deposit',
];

const cassetteLoc = (id: CassetteId): NoteLocation => `cassette:${id}`;
const isCassetteLoc = (loc: NoteLocation): loc is `cassette:${CassetteId}` => loc.startsWith('cassette:');

function emptyActivity(): InventoryActivity {
  return {
    cassettes: { A: { loaded: 0, unloaded: 0, picked: 0 }, B: { loaded: 0, unloaded: 0, picked: 0 }, C: { loaded: 0, unloaded: 0, picked: 0 } },
    loadedCents: 0,
    unloadedCents: 0,
    emptiedCents: 0,
    emptiedNotes: 0,
    dispensedCents: 0,
    acceptedCents: 0,
    rejectedNotes: 0,
    rejectedCents: 0,
    retractedNotes: 0,
    retractedCents: 0,
  };
}

/**
 * Cash inventory with individual notes.
 *
 * Two separate views of the cash exist, exactly like a real ATM:
 *  - PHYSICAL: the `Note` objects and their `loc` (what a person would count);
 *  - LOGICAL: each cassette's `counter` (what the ATM software believes it holds).
 * Notes are created once and only ever MOVE, so value can never be created or destroyed.
 */
export class CashInventory {
  readonly notes: Note[] = [];
  readonly cassettes: Record<CassetteId, CassetteState>;
  activity: InventoryActivity = emptyActivity();
  /** Notes found 'unaccounted' that reconciliation has already acknowledged/written off. */
  acknowledgedUnaccounted = 0;
  private byLoc = new Map<NoteLocation, Note[]>();
  private initialByDenom: DenomCounts = {};
  private nextId = 1;

  constructor(
    private readonly bus: EventBus,
    cassettes: Record<CassetteId, { denom: Denomination; capacity: number; lowThreshold: number }>,
  ) {
    this.cassettes = {} as Record<CassetteId, CassetteState>;
    for (const id of CASSETTE_IDS) {
      const c = cassettes[id];
      this.cassettes[id] = { id, denom: c.denom, capacity: c.capacity, counter: 0, installed: true, status: 'OK', lowThreshold: c.lowThreshold };
    }
  }

  /** Create notes at initialisation only. After `seal()`, notes can only move. */
  createNotes(denom: Denomination, count: number, loc: NoteLocation): void {
    const list = this.list(loc);
    for (let i = 0; i < count; i++) {
      const id = this.nextId++;
      const note: Note = { id, denom, serial: `TRN-${denom}-${String(id).padStart(6, '0')}`, loc };
      this.notes.push(note);
      list.push(note);
      this.initialByDenom[denom] = (this.initialByDenom[denom] ?? 0) + 1;
    }
    if (isCassetteLoc(loc)) this.cassettes[loc.slice(9) as CassetteId].counter += count;
  }

  private list(loc: NoteLocation): Note[] {
    let l = this.byLoc.get(loc);
    if (!l) {
      l = [];
      this.byLoc.set(loc, l);
    }
    return l;
  }

  notesAt(loc: NoteLocation): readonly Note[] {
    return this.byLoc.get(loc) ?? [];
  }

  count(loc: NoteLocation): number {
    return this.byLoc.get(loc)?.length ?? 0;
  }

  countByDenom(loc: NoteLocation): DenomCounts {
    const out: DenomCounts = {};
    for (const n of this.notesAt(loc)) out[n.denom] = (out[n.denom] ?? 0) + 1;
    return out;
  }

  valueAt(loc: NoteLocation): Cents {
    let v = 0;
    for (const n of this.notesAt(loc)) v += denomCents(n.denom);
    return v;
  }

  /** Physical number of notes in a cassette. */
  physicalCount(id: CassetteId): number {
    return this.count(cassetteLoc(id));
  }

  /** Move one note. Records the movement for reconciliation unless `unrecorded`. */
  move(note: Note, to: NoteLocation, opts: MoveOptions = {}): void {
    const from = note.loc;
    if (from === to) return;
    const src = this.list(from);
    // Fast path: most moves take the top note.
    const idx = src[src.length - 1] === note ? src.length - 1 : src.indexOf(note);
    if (idx < 0) throw new Error(`Note ${note.serial} not found at ${from}`);
    src.splice(idx, 1);
    if (opts.atBottom) this.list(to).unshift(note);
    else this.list(to).push(note);
    note.loc = to;
    if (!opts.unrecorded) this.record(note, from, to);
    if (!opts.silent) this.bus.emit('note.moved', { note, from, to });
  }

  private record(note: Note, from: NoteLocation, to: NoteLocation): void {
    const v = denomCents(note.denom);
    const a = this.activity;
    if (isCassetteLoc(from) && to === 'transport') a.cassettes[from.slice(9) as CassetteId].picked++;
    if (from === 'vault' && isCassetteLoc(to)) {
      a.cassettes[to.slice(9) as CassetteId].loaded++;
      a.loadedCents += v;
    }
    if (isCassetteLoc(from) && to === 'vault') {
      a.cassettes[from.slice(9) as CassetteId].unloaded++;
      a.unloadedCents += v;
    }
    if (from === 'presented' && to === 'customer') a.dispensedCents += v;
    if (from === 'escrow' && to === 'deposit') a.acceptedCents += v;
    if (to === 'reject') {
      a.rejectedNotes++;
      a.rejectedCents += v;
    }
    if (to === 'retract') {
      a.retractedNotes++;
      a.retractedCents += v;
    }
    if ((from === 'reject' || from === 'retract' || from === 'deposit') && to === 'vault') {
      a.emptiedCents += v;
      a.emptiedNotes++;
    }
  }

  /**
   * Picker action: take the top note of a cassette onto the transport and decrement the LOGICAL counter.
   * Returns undefined if the cassette is physically empty (a counter/physical mismatch shows up here as a
   * pick failure, just like on a real machine).
   */
  takeFromCassette(id: CassetteId): Note | undefined {
    const list = this.list(cassetteLoc(id));
    const note = list[list.length - 1];
    if (!note) return undefined;
    this.move(note, 'transport');
    this.cassettes[id].counter = Math.max(0, this.cassettes[id].counter - 1);
    return note;
  }

  /** Replenish: move up to `n` notes of the cassette's denomination from the vault, respecting capacity. */
  loadCassette(id: CassetteId, n: number): number {
    const c = this.cassettes[id];
    const room = Math.max(0, c.capacity - this.physicalCount(id));
    const vault = this.list('vault');
    let moved = 0;
    for (let i = vault.length - 1; i >= 0 && moved < Math.min(n, room); i--) {
      const note = vault[i];
      if (note.denom !== c.denom) continue;
      this.move(note, cassetteLoc(id), { silent: true });
      moved++;
    }
    c.counter += moved;
    this.refreshStatus(id);
    return moved;
  }

  /** Unload up to `n` notes (default all) from a cassette back to the vault. */
  unloadCassette(id: CassetteId, n = Infinity): number {
    const list = this.list(cassetteLoc(id));
    let moved = 0;
    while (list.length && moved < n) {
      this.move(list[list.length - 1], 'vault', { silent: true });
      moved++;
    }
    this.cassettes[id].counter = Math.max(0, this.cassettes[id].counter - moved);
    this.refreshStatus(id);
    return moved;
  }

  /** Recompute a cassette's status from installation and fill level (a FAULT stays until reset). */
  refreshStatus(id: CassetteId): void {
    const c = this.cassettes[id];
    if (!c.installed) c.status = 'OFFLINE';
    else if (c.status === 'FAULT') return;
    else c.status = c.counter <= c.lowThreshold ? 'WARNING' : 'OK';
  }

  isLow(id: CassetteId): boolean {
    const c = this.cassettes[id];
    return c.installed && c.counter <= c.lowThreshold;
  }

  /** Cassettes the dispenser may use: installed and not faulted. */
  usableCassettes(): CassetteState[] {
    return CASSETTE_IDS.map((id) => this.cassettes[id]).filter((c) => c.installed && c.status !== 'FAULT' && c.status !== 'OFFLINE');
  }

  /** Dispensable value according to the LOGICAL counters. */
  availableCents(): Cents {
    return this.usableCassettes().reduce((s, c) => s + c.counter * denomCents(c.denom), 0);
  }

  /** Value of all notes physically inside the ATM. */
  machineValueCents(): Cents {
    return MACHINE_LOCATIONS.reduce((s, l) => s + this.valueAt(l), 0);
  }

  /** Total notes per denomination at creation (note conservation reference). */
  initialDenomCounts(): DenomCounts {
    return { ...this.initialByDenom };
  }

  /** Current total notes per denomination over all locations. */
  totalDenomCounts(): DenomCounts {
    const out: DenomCounts = {};
    for (const n of this.notes) out[n.denom] = (out[n.denom] ?? 0) + 1;
    return out;
  }

  get totals(): InventorySnapshot['totals'] {
    const a = this.activity;
    return {
      dispensedCents: a.dispensedCents,
      acceptedCents: a.acceptedCents,
      rejectedNotes: a.rejectedNotes,
      retractedNotes: a.retractedNotes,
      replenishedCents: a.loadedCents,
    };
  }

  /** Start a new reconciliation period. */
  resetTotals(): void {
    this.activity = emptyActivity();
  }

  snapshot(): InventorySnapshot {
    const cassettes = CASSETTE_IDS.map((id) => {
      const c = this.cassettes[id];
      // valueCents follows the LOGICAL counter (what the ATM believes); compare with `physical`.
      return { ...c, physical: this.physicalCount(id), valueCents: c.counter * denomCents(c.denom), low: this.isLow(id) };
    });
    return {
      cassettes,
      reject: this.countByDenom('reject'),
      retract: this.countByDenom('retract'),
      deposit: this.countByDenom('deposit'),
      escrow: this.countByDenom('escrow'),
      inTransport: this.count('transport'),
      inStacker: this.count('stacker'),
      presented: this.countByDenom('presented'),
      availableCents: this.availableCents(),
      totals: this.totals,
      lowCash: cassettes.some((c) => c.low),
    };
  }

  /** Tell listeners (3D fill levels, dashboards) that the inventory changed. */
  changed(): void {
    this.bus.emit('inventory.changed', { snapshot: this.snapshot() });
  }
}
