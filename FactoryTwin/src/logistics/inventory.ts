import { MATERIAL_IDS, type MaterialId, type ProductType, type TruckSnap } from '../simulation/types';
import type { MaterialLot } from '../entities/records';
import type { Factory } from '../production/factory';

type Counts = Record<MaterialId, number>;
const zero = (): Counts => ({ PCB: 0, ENCLOSURE: 0, SENSOR: 0, SPEAKER_DRIVER: 0, BATTERY: 0, PACKAGING_KIT: 0 });

export interface InboundTruck {
  id: string;
  lot: MaterialLot;
  bay: number;
  state: TruckSnap['state'];
}

/**
 * Raw-material inventory with a (reorder point, order quantity) policy per material,
 * supplier lead times, receiving bays and forklift put-away.
 */
export class Inventory {
  readonly onHand: Counts = zero();
  readonly staged: Counts = zero();
  readonly onOrder: Counts = zero();
  readonly consumed: Counts = zero();
  readonly received: Counts = zero();
  readonly quarantined: Counts = zero();
  readonly initial: Counts = zero();
  readonly stockedOut = new Set<MaterialId>();
  readonly trucks: InboundTruck[] = [];
  readonly bays: (InboundTruck | null)[];
  /** Extra supplier delay (hours) per material while a shortage incident is active. */
  readonly supplierDelayHours: Counts = zero();
  private poNum = 0;
  readonly lots = new Map<string, MaterialLot>();

  constructor(private readonly f: Factory) {
    for (const m of MATERIAL_IDS) {
      this.onHand[m] = f.cfg.materials[m].initialStock;
      this.initial[m] = f.cfg.materials[m].initialStock;
    }
    this.bays = Array.from({ length: f.cfg.logistics.receivingBays }, () => null);
  }

  /** Materials for one kit (BOM without packaging kit, which is consumed at packaging). */
  kitBom(type: ProductType): [MaterialId, number][] {
    const bom = this.f.cfg.products[type].bom;
    return MATERIAL_IDS.filter((m) => m !== 'PACKAGING_KIT' && (bom[m] ?? 0) > 0).map((m) => [m, bom[m]!]);
  }

  canConsume(items: [MaterialId, number][]): MaterialId | null {
    for (const [m, q] of items) if (this.onHand[m] < q) return m;
    return null;
  }

  /** Consume all items or nothing. Returns the cost of the materials consumed. */
  consumeAll(items: [MaterialId, number][], ref: string): number {
    const missing = this.canConsume(items);
    if (missing) throw new Error(`consumeAll: ${missing} short`);
    let cost = 0;
    for (const [m, q] of items) cost += this.take(m, q, ref);
    return cost;
  }

  tryConsume(m: MaterialId, q: number, ref: string): boolean {
    if (this.onHand[m] < q) {
      this.noteStockout(m);
      return false;
    }
    this.take(m, q, ref);
    return true;
  }

  private take(m: MaterialId, q: number, ref: string): number {
    this.onHand[m] -= q;
    this.consumed[m] += q;
    this.f.log.write('material.consume', m, ref, q);
    this.checkReorder(m);
    return q * this.f.cfg.materials[m].unitCost;
  }

  noteStockout(m: MaterialId): void {
    if (this.stockedOut.has(m)) return;
    this.stockedOut.add(m);
    this.f.log.write('material.stockout', m);
    this.f.alert('warning', `Stockout: ${m} — consumers starved`, m);
  }

  position(m: MaterialId): number {
    return this.onHand[m] + this.staged[m] + this.onOrder[m];
  }

  checkReorder(m: MaterialId): void {
    const spec = this.f.cfg.materials[m];
    if (spec.orderQty <= 0) return;
    // order enough lots to bring the position above the reorder point
    let guard = 0;
    while (this.position(m) <= spec.reorderPoint && guard++ < 10) this.placeOrder(m, spec.orderQty, false);
  }

  placeOrder(m: MaterialId, qty: number, expedited: boolean): void {
    const spec = this.f.cfg.materials[m];
    const id = `PO${++this.poNum}`;
    this.onOrder[m] += qty;
    const lot: MaterialLot = { id, material: m, qty, bay: -1, expedited };
    this.lots.set(id, lot);
    const supply = this.f.rng.stream('supply');
    const lt = spec.leadTimeHours;
    const hours = expedited ? 2 : supply.tri(lt.min, lt.mode, lt.max) + this.supplierDelayHours[m];
    this.f.log.write('material.po', m, id, qty);
    this.f.engine.in(hours * 3600, 'supply.arrive', id);
  }

  onTruckArrive(lotId: string): void {
    const lot = this.lots.get(lotId)!;
    const truck: InboundTruck = { id: `IN-${lotId}`, lot, bay: -1, state: 'waiting' };
    this.trucks.push(truck);
    this.dockWaiting();
  }

  private dockWaiting(): void {
    for (const truck of this.trucks) {
      if (truck.bay >= 0) continue;
      const bay = this.bays.findIndex((b) => b === null);
      if (bay < 0) return;
      this.bays[bay] = truck;
      truck.bay = bay;
      truck.lot.bay = bay;
      truck.state = 'docked';
      this.f.engine.in(this.f.cfg.logistics.unloadMin * 60, 'supply.unloaded', truck.lot.id);
    }
  }

  onUnloaded(lotId: string): void {
    const truck = this.trucks.find((t) => t.lot.id === lotId)!;
    const lot = truck.lot;
    this.onOrder[lot.material] -= lot.qty;
    this.staged[lot.material] += lot.qty;
    this.bays[truck.bay] = null;
    this.trucks.splice(this.trucks.indexOf(truck), 1);
    this.stagedLots.push(lot);
    this.f.forklifts.requestPutaway(lot);
    this.dockWaiting();
  }

  /** Lots unloaded at the dock and waiting for put-away. */
  readonly stagedLots: MaterialLot[] = [];

  putaway(lot: MaterialLot): void {
    const i = this.stagedLots.indexOf(lot);
    if (i >= 0) this.stagedLots.splice(i, 1);
    this.staged[lot.material] -= lot.qty;
    this.onHand[lot.material] += lot.qty;
    this.received[lot.material] += lot.qty;
    this.lots.delete(lot.id);
    this.stockedOut.delete(lot.material);
    this.f.log.write('material.receive', lot.material, lot.id, lot.qty);
    this.f.onMaterialReceived();
  }

  quarantine(m: MaterialId, qty: number): void {
    const q = Math.min(this.onHand[m], Math.max(0, Math.floor(qty)));
    this.onHand[m] -= q;
    this.quarantined[m] += q;
    this.f.log.write('material.quarantine', m, undefined, q);
    this.checkReorder(m);
  }

  truckSnaps(): TruckSnap[] {
    return this.trucks.map((t) => ({
      id: t.id,
      kind: 'inbound' as const,
      bay: t.bay,
      state: t.state,
      label: `${t.lot.material} x${t.lot.qty}`,
      pallets: 1,
    }));
  }
}
