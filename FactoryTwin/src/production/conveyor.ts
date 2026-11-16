import type { ConveyorState, Vec2 } from '../simulation/types';
import type { Product } from '../entities/records';
import { StateTracker, QueueTracker, WearClock } from '../entities/trackers';
import { polylineLength } from '../logistics/motion';
import type { Factory } from './factory';

export interface ConveyorItem {
  product: Product;
  basePos: number;
  baseBelt: number;
}

/** Downstream of a conveyor: told when the head item reaches the end. */
export interface ConveyorSink {
  offer(conv: Conveyor): void;
}

/**
 * Accumulating belt conveyor. Items keep (basePos, baseBelt); their position is
 * min(basePos + beltPos - baseBelt, positionOfItemAhead - pitch). Only the head's arrival at the
 * end is scheduled. On hand-off, remaining items are rebased to their current (clamped) positions.
 */
export class Conveyor {
  readonly length: number;
  readonly capacity: number;
  readonly items: ConveyorItem[] = [];
  readonly tracker: StateTracker<ConveyorState>;
  readonly queue = new QueueTracker();
  readonly wear: WearClock;
  beltPos = 0;
  beltTime = 0;
  open = false;
  failed = false;
  headWaiting = false;
  headSince = 0;
  sink: ConveyorSink | null = null;
  /** Called when an item leaves (space freed). */
  onSpace: (() => void) | null = null;
  failures = 0;
  readonly history: { t: number; text: string }[] = [];
  private headEvent: number | null = null;
  private failEvent: number | null = null;
  private runningSince = 0;
  repairPending = false;

  constructor(
    private readonly f: Factory,
    readonly id: string,
    readonly points: Vec2[],
    readonly speed: number,
    readonly pitch: number,
    readonly repairNode: string,
  ) {
    this.length = polylineLength(points);
    this.capacity = Math.max(1, Math.floor(this.length / pitch));
    this.tracker = new StateTracker<ConveyorState>('closed');
    this.wear = new WearClock(f.cfg.conveyors.failure, f.rng.stream(`fail:${id}`));
  }

  get name(): string {
    return `Conveyor ${this.id}`;
  }

  get running(): boolean {
    return this.open && !this.failed;
  }

  get state(): ConveyorState {
    if (this.failed) return 'failed';
    if (!this.open) return 'closed';
    return this.headWaiting ? 'stopped' : 'running';
  }

  private sync(): void {
    const now = this.f.engine.now;
    if (this.running) this.beltPos += (now - this.beltTime) * this.speed;
    this.beltTime = now;
  }

  private track(): void {
    this.tracker.set(this.state, this.f.engine.now);
    this.queue.update(this.items.length, this.f.engine.now);
  }

  /** True when the entry spot is free: below capacity and the last item has moved one pitch. */
  canEnter(): boolean {
    if (this.items.length >= this.capacity) return false;
    if (this.items.length === 0) return true;
    this.sync();
    const pos = this.positions();
    const tail = pos[pos.length - 1];
    if (tail >= this.pitch - 1e-9) return true;
    this.entryWanted = true;
    this.scheduleEntry(tail);
    return false;
  }

  private entryWanted = false;
  private entryEvent: number | null = null;

  private scheduleEntry(tail?: number): void {
    if (!this.entryWanted || !this.running || this.entryEvent !== null || this.items.length === 0) return;
    let t = tail;
    if (t === undefined) {
      const pos = this.positions();
      t = pos[pos.length - 1];
    }
    // the tail may itself be held back by accumulation; then space appears on a hand-off instead
    const natural = this.items[this.items.length - 1];
    const nat = natural.basePos + (this.beltPos - natural.baseBelt);
    if (nat > t + 1e-9) return;
    this.entryEvent = this.f.engine.in(Math.max(0, (this.pitch - t) / this.speed), 'conv.entry', this.id);
  }

  onEntryEvent(): void {
    this.entryEvent = null;
    if (!this.entryWanted) return;
    this.entryWanted = false;
    this.onSpace?.();
  }

  enter(product: Product): void {
    this.sync();
    this.items.push({ product, basePos: 0, baseBelt: this.beltPos });
    product.location = { kind: 'conveyor', ref: this.id, slot: 0 };
    if (this.items.length === 1) this.scheduleHead();
    this.track();
  }

  /** Current clamped positions, head first. */
  positions(): number[] {
    const out: number[] = [];
    let cap = this.length;
    for (const it of this.items) {
      const p = Math.min(it.basePos + (this.beltPos - it.baseBelt), cap);
      out.push(p);
      cap = p - this.pitch;
    }
    return out;
  }

  headProduct(): Product | null {
    return this.headWaiting && this.items.length > 0 ? this.items[0].product : null;
  }

  /** Remove and return the head item (only valid while it waits at the end). */
  takeHead(): Product {
    if (!this.headWaiting || this.items.length === 0) throw new Error(`${this.id}: no head waiting`);
    this.sync();
    const pos = this.positions();
    const head = this.items.shift()!;
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].basePos = Math.max(0, pos[i + 1]);
      this.items[i].baseBelt = this.beltPos;
    }
    this.headWaiting = false;
    this.scheduleHead();
    this.track();
    this.onSpace?.();
    return head.product;
  }

  private scheduleHead(): void {
    this.f.engine.cancel(this.entryEvent);
    this.entryEvent = null;
    this.sync();
    this.scheduleEntry();
    this.f.engine.cancel(this.headEvent);
    this.headEvent = null;
    if (!this.running || this.items.length === 0 || this.headWaiting) return;
    const h = this.items[0];
    const pos = h.basePos + (this.beltPos - h.baseBelt);
    const remaining = Math.max(0, this.length - pos);
    this.headEvent = this.f.engine.in(remaining / this.speed, 'conv.head', this.id);
  }

  onHeadEvent(): void {
    this.headEvent = null;
    this.sync();
    this.headWaiting = true;
    this.headSince = this.f.engine.now;
    this.track();
    this.sink?.offer(this);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.sync();
    this.stopWear();
    this.open = open;
    this.startWear();
    this.scheduleHead();
    this.track();
  }

  private startWear(): void {
    if (!this.running) return;
    this.runningSince = this.f.engine.now;
    if (isFinite(this.wear.remaining)) {
      this.failEvent = this.f.engine.in(Math.max(0, this.wear.remaining), 'conv.fail', this.id);
    }
  }

  private stopWear(): void {
    if (this.running) this.wear.addAge(this.f.engine.now - this.runningSince);
    this.f.engine.cancel(this.failEvent);
    this.failEvent = null;
  }

  onWearFailure(): void {
    this.failEvent = null;
    this.fail();
  }

  fail(repairSec?: number, reason = 'breakdown'): void {
    if (this.failed) return;
    this.sync();
    this.stopWear();
    this.failed = true;
    this.failures++;
    this.scheduleHead();
    this.track();
    this.history.push({ t: this.f.engine.now, text: `Failed (${reason})` });
    this.f.log.write('conveyor.fail', this.id, reason);
    this.f.alert('critical', `${this.name} stopped: ${reason}`, this.id);
    this.f.workforce.requestRepair({
      id: this.id,
      name: this.name,
      node: this.repairNode,
      duration: repairSec ?? this.wear.repairDuration(),
      onRepaired: () => this.repair(),
    });
  }

  repair(): void {
    if (!this.failed) return;
    this.sync();
    this.failed = false;
    this.wear.renew();
    this.startWear();
    this.scheduleHead();
    this.track();
    this.history.push({ t: this.f.engine.now, text: 'Repaired' });
    this.f.log.write('conveyor.repair', this.id);
    // Downstream may already be waiting for the head that was frozen
  }
}
