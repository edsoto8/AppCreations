import type { TruckSnap } from '../simulation/types';
import type { Order, Pallet } from '../entities/records';
import type { Factory } from '../production/factory';

export interface OutboundTruck {
  id: string;
  order: Order;
  bay: number;
  state: TruckSnap['state'];
  pallets: Pallet[];
  loaded: number;
  requestedAt: number;
}

/** Finished-goods rack slots. */
export class FgStorage {
  private readonly used = new Set<number>();
  constructor(private readonly f: Factory) {}

  get perRack(): number {
    const r = this.f.layout.fgRacks[0];
    return r.bays * r.levels;
  }

  alloc(): number {
    let k = 0;
    while (this.used.has(k)) k++;
    this.used.add(k);
    return k;
  }

  free(slot: number): void {
    this.used.delete(slot);
  }

  get count(): number {
    return this.used.size;
  }

  nodeFor(slot: number): string {
    const racks = this.f.layout.fgRacks;
    const r = Math.floor(slot / this.perRack) % racks.length;
    return racks[r].node;
  }
}

/** Carrier trucks per completed order, shipping bays, loading and departure. */
export class Shipping {
  readonly trucks: OutboundTruck[] = [];
  readonly bays: (OutboundTruck | null)[];
  closedBays = 0;
  carrierDelayFactor = 1;

  constructor(private readonly f: Factory) {
    this.bays = Array.from({ length: f.cfg.logistics.shippingBays }, () => null);
  }

  requestCarrier(order: Order): void {
    const pallets = this.f.orders.palletsOf(order).filter((p) => p.location === 'fg');
    const truck: OutboundTruck = {
      id: `OUT-${order.id}`,
      order,
      bay: -1,
      state: 'arriving',
      pallets,
      loaded: 0,
      requestedAt: this.f.engine.now,
    };
    this.trucks.push(truck);
    order.state = 'shipping';
    const c = this.f.cfg.logistics.carrierLeadMin;
    const minutes = this.f.rng.stream('carrier').tri(c.min, c.mode, c.max) * this.carrierDelayFactor;
    this.f.engine.in(minutes * 60, 'ship.arrive', truck.id);
  }

  onArrive(id: string): void {
    const t = this.trucks.find((x) => x.id === id)!;
    t.state = 'waiting';
    this.dock();
  }

  dock(): void {
    const open = this.bays.length - this.closedBays;
    for (const t of this.trucks) {
      if (t.state !== 'waiting') continue;
      const bay = this.bays.findIndex((b, i) => b === null && i < open);
      if (bay < 0) return;
      this.bays[bay] = t;
      t.bay = bay;
      t.state = 'docked';
      for (const p of t.pallets) this.f.forklifts.requestLoad(p, t.id, bay);
    }
  }

  onPalletLoaded(truckId: string, _pallet: Pallet): void {
    const t = this.trucks.find((x) => x.id === truckId)!;
    t.loaded++;
    if (t.loaded >= t.pallets.length) {
      t.state = 'departing';
      this.f.engine.in(300, 'ship.depart', t.id);
    }
  }

  onDepart(id: string): void {
    const t = this.trucks.find((x) => x.id === id)!;
    this.trucks.splice(this.trucks.indexOf(t), 1);
    this.bays[t.bay] = null;
    this.f.orders.ship(t.order, t.pallets);
    this.dock();
  }

  truckSnaps(): TruckSnap[] {
    return this.trucks
      .filter((t) => t.state !== 'arriving')
      .map((t) => ({
        id: t.id,
        kind: 'outbound' as const,
        bay: t.bay,
        state: t.state,
        label: `${t.order.id} (${t.order.qty}× ${t.order.type})`,
        pallets: t.loaded,
      }));
  }
}
