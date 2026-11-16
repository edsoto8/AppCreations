import type { Priority, ProductType } from '../simulation/types';
import { PRIORITY_RANK, type Order, type Pallet, type Product } from '../entities/records';
import { QueueTracker } from '../entities/trackers';
import type { Factory } from './factory';

const PRIORITIES: Priority[] = ['high', 'normal', 'low'];

/**
 * Order book: Poisson arrivals, release of units to assembly cells (WIP-limited), completion
 * and shipping bookkeeping.
 */
export class OrderBook {
  readonly orders = new Map<string, Order>();
  /** Orders with units left to release, in creation order. */
  private readonly open: Order[] = [];
  private num = 0;
  private backlog = 0;
  /** Time-weighted unreleased units (queue in front of assembly). */
  readonly backlogTracker = new QueueTracker();
  /** Closed orders kept for lookup (bounded). */
  private readonly done: string[] = [];

  constructor(private readonly f: Factory) {}

  get backlogUnits(): number {
    return this.backlog;
  }

  private setBacklog(n: number): void {
    this.backlog = n;
    this.backlogTracker.update(n, this.f.engine.now);
  }

  get(id: string): Order {
    const o = this.orders.get(id);
    if (!o) throw new Error(`Unknown order ${id}`);
    return o;
  }

  get active(): number {
    let n = 0;
    for (const o of this.orders.values()) if (o.state !== 'shipped') n++;
    return n;
  }

  scheduleNextArrival(): void {
    const rate = this.f.cfg.orders.arrivalsPerDay;
    if (rate <= 0) return;
    this.f.engine.in(this.f.rng.stream('arrivals').exp(86400 / rate), 'order.arrive');
  }

  onArrivalEvent(): void {
    this.create(false);
    this.scheduleNextArrival();
    this.release();
  }

  create(surge: boolean, typeOverride?: ProductType, qtyOverride?: number, priorityOverride?: Priority): Order {
    const c = this.f.cfg.orders;
    const s = this.f.rng.stream(surge ? 'surge' : 'arrivals');
    const mixA = this.f.cfg.products.A.mix;
    const type: ProductType = typeOverride ?? (s.next() < mixA / (mixA + this.f.cfg.products.B.mix) ? 'A' : 'B');
    const qty = qtyOverride ?? s.int(c.qtyMin, c.qtyMax);
    const priority = priorityOverride ?? PRIORITIES[s.pick(PRIORITIES.map((p) => c.priorityWeights[p]))];
    const now = this.f.engine.now;
    const order: Order = {
      id: `O${++this.num}`,
      num: this.num,
      type,
      qty,
      priority,
      createdAt: now,
      dueAt: now + c.dueHours[priority] * 3600,
      toRelease: qty,
      released: 0,
      scrapped: 0,
      packed: 0,
      palletized: 0,
      pallets: [],
      palletsStored: 0,
      state: 'open',
      completeAt: null,
      shippedAt: null,
      surge,
    };
    this.orders.set(order.id, order);
    this.open.push(order);
    this.setBacklog(this.backlog + qty);
    this.f.log.write('order.arrive', order.id, type, qty);
    return order;
  }

  private pickOrder(): Order | null {
    const rule = this.f.cfg.orders.dispatchRule;
    let best: Order | null = null;
    for (const o of this.open) {
      if (o.toRelease <= 0) continue;
      if (!best) {
        best = o;
        continue;
      }
      let better: boolean;
      if (rule === 'fifo') better = o.createdAt < best.createdAt;
      else if (rule === 'edd') better = o.dueAt < best.dueAt;
      else {
        const a = PRIORITY_RANK[o.priority];
        const b = PRIORITY_RANK[best.priority];
        better = a < b || (a === b && o.dueAt < best.dueAt);
      }
      if (better) best = o;
    }
    return best;
  }

  /** Release units to cells while some cell has WIP room. */
  release(): void {
    let released = false;
    for (;;) {
      if (this.backlogUnits <= 0) break;
      let cell = null;
      for (const c of this.f.cells) {
        if (!c.acceptsRelease()) continue;
        if (!cell || c.committed < cell.committed) cell = c;
      }
      if (!cell) break;
      const order = this.pickOrder();
      if (!order) break;
      const p = this.f.newProduct(order, cell.index);
      order.toRelease--;
      order.released++;
      this.setBacklog(this.backlog - 1);
      if (order.toRelease === 0) this.open.splice(this.open.indexOf(order), 1);
      cell.committed++;
      cell.kitRequests.push(p);
      cell.updateState();
      released = true;
    }
    if (released) this.f.agvs.dispatch();
  }

  onPacked(p: Product): void {
    this.get(p.orderId).packed++;
  }

  onScrap(p: Product): void {
    const o = this.get(p.orderId);
    o.scrapped++;
    o.toRelease++;
    this.setBacklog(this.backlog + 1);
    if (!this.open.includes(o)) {
      // keep creation order for FIFO stability
      let i = 0;
      while (i < this.open.length && this.open[i].num < o.num) i++;
      this.open.splice(i, 0, o);
    }
    this.release();
  }

  palletsOf(o: Order): Pallet[] {
    return o.pallets.map((id) => this.f.pallets.get(id)!).filter(Boolean);
  }

  onPalletStored(p: Pallet): void {
    const o = this.get(p.orderId);
    o.palletsStored++;
    this.checkComplete(o);
  }

  private checkComplete(o: Order): void {
    if (o.state !== 'open' || o.palletized < o.qty) return;
    if (o.palletsStored < o.pallets.length) return;
    o.state = 'complete';
    o.completeAt = this.f.engine.now;
    this.f.log.write('order.complete', o.id, undefined, o.qty);
    this.f.shipping.requestCarrier(o);
  }

  ship(o: Order, pallets: Pallet[]): void {
    const now = this.f.engine.now;
    const price = this.f.cfg.products[o.type].price;
    for (const pal of pallets) {
      for (const pid of pal.productIds) {
        const p = this.f.products.get(pid);
        if (!p) continue;
        this.f.log.write('unit.ship', pid, o.id, price);
        this.f.setStage(p, 'shipped', `Shipped on ${`OUT-${o.id}`}`);
        p.location = { kind: 'gone', ref: null, slot: 0 };
        this.f.retire(p);
      }
      this.f.pallets.delete(pal.id);
    }
    o.state = 'shipped';
    o.shippedAt = now;
    const lateness = now - o.dueAt;
    this.f.log.write('order.ship', o.id, o.priority, lateness);
    if (lateness > 0) this.f.alert('warning', `Order ${o.id} shipped ${(lateness / 3600).toFixed(1)} h late`, o.id);
    this.done.push(o.id);
    if (this.done.length > 500) this.orders.delete(this.done.shift()!);
  }

  openOrders(): Order[] {
    return [...this.orders.values()].filter((o) => o.state !== 'shipped');
  }
}
