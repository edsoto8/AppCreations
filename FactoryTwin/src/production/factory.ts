import {
  MATERIAL_IDS,
  type BufferSnap,
  type EntityDetail,
  type EntityRef,
  type FactoryConfig,
  type InjectedEvent,
  type MaterialId,
  type ProductSnap,
  type ProductStage,
  type Scenario,
  type SimSnapshot,
  type StationSnap,
} from '../simulation/types';
import { Engine, type EventLog } from '../simulation/engine';
import { RngStreams, type RandomStream } from '../simulation/rng';
import { clockInfo, formatDuration, formatTime, shiftAt } from '../simulation/clock';
import { addHistory, type Order, type Pallet, type Product } from '../entities/records';
import { buildLayout, conveyorId, type FactoryLayout } from '../logistics/layout';
import { Inventory } from '../logistics/inventory';
import { AgvFleet, ForkliftFleet, type Fleet, type Vehicle } from '../logistics/vehicles';
import { FgStorage, Shipping } from '../logistics/shipping';
import { Conveyor } from './conveyor';
import { AssemblyCell, InspectionStation, type Machine, PackagingLine, Palletizer } from './stations';
import { OrderBook } from './orders';
import { Workforce } from './workforce';
import { Metrics, SAMPLE_INTERVAL } from './metrics';
import { Incidents, INCIDENT_LABELS } from './incidents';

export interface FactoryOptions {
  keepLog?: boolean;
}

/** Deep copy of plain JSON data. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * The factory model. Owns the engine and every subsystem. Pure TypeScript: runs on the main
 * thread, in a Web Worker or in Node.
 */
export class Factory {
  readonly engine: Engine;
  readonly log: EventLog;
  readonly cfg: FactoryConfig;
  readonly scenario: Scenario;
  readonly layout: FactoryLayout;
  readonly rng: RngStreams;
  readonly qualityStream: RandomStream;

  readonly products = new Map<string, Product>();
  readonly archive = new Map<string, Product>();
  readonly pallets = new Map<string, Pallet>();
  readonly machines = new Map<string, Machine>();
  readonly cells: AssemblyCell[] = [];
  readonly inspections: InspectionStation[] = [];
  readonly packaging: PackagingLine;
  readonly palletizer: Palletizer;
  readonly conveyors = new Map<string, Conveyor>();
  readonly c1: Conveyor[] = [];
  readonly c2: Conveyor;
  readonly c3: Conveyor;
  readonly infeed: Product[] = [];
  readonly rejectBin: Product[] = [];

  readonly inventory: Inventory;
  readonly orders: OrderBook;
  readonly workforce: Workforce;
  readonly agvs: AgvFleet;
  readonly forklifts: ForkliftFleet;
  readonly shipping: Shipping;
  readonly fg: FgStorage;
  readonly metrics: Metrics;
  readonly incidents: Incidents;

  rejectSpike: number | null = null;
  private open = false;
  private openSince = 0;
  private openAccum = 0;
  private productNum = 0;
  private palletNum = 0;
  private pulling = false;

  constructor(scenario: Scenario, opts: FactoryOptions = {}) {
    this.scenario = clone(scenario);
    this.cfg = this.scenario.config;
    this.engine = new Engine(opts.keepLog ?? false);
    this.log = this.engine.log;
    this.rng = new RngStreams(this.scenario.seed);
    this.qualityStream = this.rng.stream('quality');
    this.layout = buildLayout(this.cfg);

    this.metrics = new Metrics(this);
    this.incidents = new Incidents(this);
    this.inventory = new Inventory(this);
    this.orders = new OrderBook(this);
    this.fg = new FgStorage(this);
    this.shipping = new Shipping(this);

    for (let i = 0; i < this.cfg.assembly.cells; i++) {
      const c = new AssemblyCell(this, i);
      this.cells.push(c);
      this.machines.set(c.id, c);
    }
    for (let j = 0; j < this.cfg.inspection.stations; j++) {
      const s = new InspectionStation(this, j);
      this.inspections.push(s);
      this.machines.set(s.id, s);
    }
    this.packaging = new PackagingLine(this);
    this.machines.set(this.packaging.id, this.packaging);
    this.palletizer = new Palletizer(this);
    this.machines.set(this.palletizer.id, this.palletizer);

    const cc = this.cfg.conveyors;
    for (const cl of this.layout.conveyors) {
      const repairNode = cl.id.startsWith('C1-') ? `cell-${Number(cl.id.split('-')[1]) - 1}-op` : cl.id === 'C2' ? 'pack-op-0' : 'pal-0';
      const conv = new Conveyor(this, cl.id, cl.points, cc.speedMps, cc.pitchM, repairNode);
      this.conveyors.set(conv.id, conv);
    }
    for (let i = 0; i < this.cells.length; i++) {
      const conv = this.conveyors.get(conveyorId('C1', i))!;
      this.c1.push(conv);
      conv.sink = { offer: () => this.pullIntoInfeed() };
      conv.onSpace = () => this.cells[i].retryOutput();
    }
    this.c2 = this.conveyors.get('C2')!;
    this.c2.sink = { offer: () => this.packaging.tryStart() };
    this.c2.onSpace = () => this.inspections.forEach((s) => s.retryOutput());
    this.c3 = this.conveyors.get('C3')!;
    this.c3.sink = { offer: () => this.palletizer.tryStart() };
    this.c3.onSpace = () => this.packaging.retryOutput();

    this.agvs = new AgvFleet(this);
    this.forklifts = new ForkliftFleet(this);
    this.workforce = new Workforce(this);

    this.registerHandlers();

    // initial state & events
    for (let i = 0; i < this.cfg.orders.initialBacklogOrders; i++) this.orders.create(false);
    this.workforce.scheduleShiftEdges(0);
    this.orders.scheduleNextArrival();
    this.engine.at(SAMPLE_INTERVAL, 'metrics.sample');
    this.scenario.injectedEvents.forEach((ev, i) => this.engine.at(Math.max(0, ev.at), 'inject', '', i, 1));
  }

  private registerHandlers(): void {
    const e = this.engine;
    const m = (k: string) => this.machines.get(k)!;
    const v = (k: string): [Fleet, Vehicle] => {
      const fleet: Fleet = k.startsWith('agv') ? this.agvs : this.forklifts;
      return [fleet, fleet.vehicles.find((x) => x.id === k)!];
    };
    const w = (k: string) => this.workforce.get(k)!;
    e.on('shift.edge', () => this.workforce.onShiftEdge());
    e.on('order.arrive', () => this.orders.onArrivalEvent());
    e.on('mach.phase', (ev) => m(ev.k).onPhaseEvent());
    e.on('mach.fail', (ev) => m(ev.k).onWearFailure());
    e.on('mach.pmEnd', (ev) => m(ev.k).onPmEnd());
    e.on('conv.head', (ev) => this.conveyors.get(ev.k)!.onHeadEvent());
    e.on('conv.fail', (ev) => this.conveyors.get(ev.k)!.onWearFailure());
    e.on('conv.entry', (ev) => this.conveyors.get(ev.k)!.onEntryEvent());
    e.on('veh.arrive', (ev) => {
      const [f, x] = v(ev.k);
      f.onArrive(x);
    });
    e.on('veh.work', (ev) => {
      const [f, x] = v(ev.k);
      f.onWorkDone(x);
    });
    e.on('veh.fail', (ev) => {
      const [f, x] = v(ev.k);
      f.onFail(x);
    });
    e.on('veh.repair', (ev) => {
      const [f, x] = v(ev.k);
      f.onRepair(x);
    });
    e.on('wk.arrive', (ev) => this.workforce.onArrive(w(ev.k)));
    e.on('wk.break', (ev) => this.workforce.onBreak(w(ev.k)));
    e.on('wk.breakEnd', (ev) => this.workforce.onBreakEnd(w(ev.k)));
    e.on('wk.return', (ev) => this.workforce.onReturn(w(ev.k)));
    e.on('repair.done', (ev) => this.workforce.onRepairDone(w(ev.k)));
    e.on('repair.external', (ev) => this.workforce.onExternalRepair(ev.k));
    e.on('supply.arrive', (ev) => this.inventory.onTruckArrive(ev.k));
    e.on('supply.unloaded', (ev) => this.inventory.onUnloaded(ev.k));
    e.on('ship.arrive', (ev) => this.shipping.onArrive(ev.k));
    e.on('ship.depart', (ev) => this.shipping.onDepart(ev.k));
    e.on('metrics.sample', () => {
      this.metrics.onSample();
      this.engine.in(SAMPLE_INTERVAL, 'metrics.sample');
    });
    e.on('inject', (ev) => this.incidents.apply(this.scenario.injectedEvents[ev.n]));
    e.on('incident.end', (ev) => this.incidents.onEnd(ev.k, ev.n));
  }

  // --- helpers used by subsystems ----------------------------------------------------

  alert(severity: 'info' | 'warning' | 'critical', message: string, ref?: string): void {
    this.metrics.alert({ t: this.engine.now, severity, message, ref });
  }

  shiftNow() {
    return shiftAt(this.engine.now, this.cfg.shifts);
  }

  setOpen(open: boolean): void {
    const now = this.engine.now;
    if (open && !this.open) this.openSince = now;
    if (!open && this.open) this.openAccum += now - this.openSince;
    this.open = open;
    for (const m of this.machines.values()) m.setOpen(open);
    for (const c of this.conveyors.values()) c.setOpen(open);
    if (open) {
      this.orders.release();
      this.agvs.dispatch();
    }
    this.forklifts.dispatch();
  }

  get isOpen(): boolean {
    return this.open;
  }

  openSeconds(now: number): number {
    return this.openAccum + (this.open ? now - this.openSince : 0);
  }

  newProduct(order: Order, cellIndex: number): Product {
    const now = this.engine.now;
    const p: Product = {
      id: `P${++this.productNum}`,
      num: this.productNum,
      type: order.type,
      orderId: order.id,
      stage: 'released',
      quality: 'unknown',
      rework: false,
      reworked: false,
      cellIndex,
      location: { kind: 'pending', ref: null, slot: 0 },
      releasedAt: now,
      stageTimes: { released: now },
      cost: 0,
      history: [],
    };
    addHistory(p.history, now, `Released for order ${order.id} to Assembly Cell ${cellIndex + 1}`);
    this.products.set(p.id, p);
    this.log.write('unit.release', p.id, order.id, cellIndex);
    return p;
  }

  setStage(p: Product, stage: ProductStage, text: string): void {
    p.stage = stage;
    p.stageTimes[stage] = this.engine.now;
    addHistory(p.history, this.engine.now, text);
  }

  scrap(p: Product, text: string): void {
    p.quality = 'scrapped';
    this.setStage(p, 'scrapped', text);
    p.location = { kind: 'gone', ref: null, slot: 0 };
    this.log.write('unit.scrap', p.id, p.orderId);
    this.alert('info', `${p.id} scrapped after failed rework`, p.id);
    this.retire(p);
    this.orders.onScrap(p);
  }

  retire(p: Product): void {
    this.products.delete(p.id);
    this.archive.set(p.id, p);
    if (this.archive.size > 3000) this.archive.delete(this.archive.keys().next().value!);
  }

  newPallet(first: Product, pos: number): Pallet {
    const order = this.orders.get(first.orderId);
    const pal: Pallet = {
      id: `PL${++this.palletNum}`,
      orderId: order.id,
      type: order.type,
      productIds: [],
      location: 'palletizer',
      slot: pos,
      vehicleId: null,
      closed: false,
      lastTouch: this.engine.now,
    };
    this.pallets.set(pal.id, pal);
    order.pallets.push(pal.id);
    return pal;
  }

  effectiveRejectRate(): number {
    return this.rejectSpike ?? this.cfg.inspection.rejectRate;
  }

  /** Move heads of waiting C1 conveyors onto the inspection infeed table (oldest first). */
  pullIntoInfeed(): void {
    if (this.pulling) return;
    this.pulling = true;
    const cap = this.cfg.inspection.infeedCapacity;
    while (this.infeed.length < cap) {
      let best: Conveyor | null = null;
      for (const c of this.c1) {
        if (c.headWaiting && !c.failed && (!best || c.headSince < best.headSince)) best = c;
      }
      if (!best) break;
      const p = best.takeHead();
      this.infeed.push(p);
      p.location = { kind: 'buffer', ref: 'infeed', slot: this.infeed.length - 1 };
    }
    this.pulling = false;
    for (const s of this.inspections) s.tryStart();
  }

  onMaterialReceived(): void {
    this.agvs.dispatch();
    this.packaging.tryStart();
  }

  reroute(cell: AssemblyCell): number {
    cell.rerouted = true;
    let moved = 0;
    while (cell.kitRequests.length > 0) {
      let target: AssemblyCell | null = null;
      for (const c of this.cells) {
        if (c === cell || c.failed || c.rerouted) continue;
        if (!target || c.committed < target.committed) target = c;
      }
      if (!target) break;
      const p = cell.kitRequests.shift()!;
      cell.committed--;
      target.committed++;
      target.kitRequests.push(p);
      p.cellIndex = target.index;
      addHistory(p.history, this.engine.now, `Rerouted to ${target.name}`);
      moved++;
    }
    cell.updateState();
    this.agvs.dispatch();
    return moved;
  }

  // --- live interventions ---------------------------------------------------------------

  /** Schedule a user intervention; it is recorded in the scenario so replays reproduce it. */
  inject(ev: InjectedEvent): InjectedEvent {
    const rec: InjectedEvent = clone({ ...ev, at: Math.max(ev.at, this.engine.now) });
    const idx = this.scenario.injectedEvents.length;
    this.scenario.injectedEvents.push(rec);
    this.engine.at(rec.at, 'inject', '', idx, 1);
    return rec;
  }

  // --- snapshot -------------------------------------------------------------------------------

  snapshot(): SimSnapshot {
    const now = this.engine.now;
    const stations: StationSnap[] = [...this.machines.values()].map((m) => {
      const prod = m.job?.product ?? m.blocked;
      return {
        id: m.id,
        kind: m.kind,
        index: m.index,
        name: m.name,
        state: m.state,
        phase: m.phaseInfo(),
        productId: prod?.id ?? null,
        productType: prod?.type ?? null,
        queue: m.queueLength(),
        staffed: this.workforce.staffedCount(m.id),
        staffRequired: m.staffRequired,
        utilization: m.utilization(now),
        produced: m.produced,
        failures: m.failures,
        result: m.job && m.job.reject !== undefined ? (m.job.reject ? 'reject' : 'pass') : null,
        buildPos: m.job?.pos ?? null,
      };
    });
    const products: ProductSnap[] = [];
    const push = (p: Product, kind: ProductSnap['location']['kind'], ref: string, slot: number) =>
      products.push({ id: p.id, type: p.type, stage: p.stage, rework: p.rework || p.quality === 'rejected-once', location: { kind, ref, slot } });
    const buffers: BufferSnap[] = [];
    for (const c of this.cells) {
      c.buffer.forEach((p, i) => push(p, 'buffer', c.id, i));
      buffers.push({ id: c.id, capacity: this.cfg.assembly.wipPerCell + 2, items: c.buffer.map((p) => ({ productId: p.id, type: p.type, rework: p.rework })) });
    }
    this.infeed.forEach((p, i) => push(p, 'buffer', 'infeed', i));
    buffers.push({ id: 'infeed', capacity: this.cfg.inspection.infeedCapacity, items: this.infeed.map((p) => ({ productId: p.id, type: p.type, rework: p.reworked })) });
    this.rejectBin.forEach((p, i) => push(p, 'buffer', 'reject', i));
    buffers.push({ id: 'reject', capacity: this.cfg.inspection.rejectBinCapacity, items: this.rejectBin.map((p) => ({ productId: p.id, type: p.type, rework: true })) });
    for (const m of this.machines.values()) {
      if (m.job?.product) push(m.job.product, 'station', m.id, 0);
      if (m.blocked) push(m.blocked, 'station', m.id, 1);
    }
    for (const c of this.conveyors.values()) c.items.forEach((it, i) => push(it.product, 'conveyor', c.id, i));
    for (const v of [...this.agvs.vehicles]) {
      const t = v.task;
      if (t && t.products && t.stopIdx > 0) t.products.forEach((p, i) => push(p, 'vehicle', v.id, i));
    }
    const inventory = {} as Record<MaterialId, number>;
    for (const m of MATERIAL_IDS) inventory[m] = this.inventory.onHand[m];
    return {
      version: this.engine.version,
      time: now,
      clock: clockInfo(now, this.cfg.shifts),
      stations,
      conveyors: [...this.conveyors.values()].map((c) => ({
        id: c.id,
        points: c.points,
        length: c.length,
        pitch: c.pitch,
        state: c.state,
        speed: c.speed,
        beltPos: c.beltPos,
        beltTime: c.beltTime,
        items: c.items.map((it) => ({ productId: it.product.id, type: it.product.type, boxed: c.id === 'C3', basePos: it.basePos, baseBelt: it.baseBelt })),
      })),
      buffers,
      vehicles: [...this.agvs.vehicles, ...this.forklifts.vehicles].map((v) => v.snap()),
      workers: this.workforce.snaps(),
      products,
      pallets: [...this.pallets.values()].map((p) => ({
        id: p.id,
        orderId: p.orderId,
        type: p.type,
        units: p.productIds.length,
        location: p.location,
        slot: p.slot,
        vehicleId: p.vehicleId,
      })),
      trucks: [...this.inventory.truckSnaps(), ...this.shipping.truckSnaps()],
      inventory,
      activeIncidents: this.incidents.active(),
    };
  }

  // --- entity detail (inspector) ----------------------------------------------------------

  detail(ref: EntityRef): EntityDetail | null {
    const now = this.engine.now;
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const money = (x: number) => `$${x.toFixed(2)}`;
    switch (ref.kind) {
      case 'station': {
        const m = this.machines.get(ref.id);
        if (!m) return null;
        const openH = Math.max(1e-9, this.openSeconds(now) / 3600);
        const job = m.job;
        const task = job ? `${job.phases[Math.min(job.idx, job.phases.length - 1)].name} ${job.product ? job.product.id : ''}`.trim() : m.blocked ? `Blocked holding ${m.blocked.id}` : '—';
        return {
          kind: 'station',
          id: m.id,
          title: m.name,
          fields: [
            { label: 'ID', value: m.id },
            { label: 'Status', value: m.state },
            { label: 'Current task', value: task },
            { label: 'Processing rate', value: `${(m.produced / openH).toFixed(1)} units/h (open time)` },
            { label: 'Utilisation', value: pct(m.utilization(now)) },
            { label: 'Items produced', value: String(m.produced) },
            { label: 'Queue', value: String(m.queueLength()) },
            { label: 'Staffing', value: `${this.workforce.staffedCount(m.id)} / ${m.staffRequired}` },
            { label: 'Failures', value: String(m.failures) },
            { label: 'Busy hours since renewal', value: (m.wear.age / 3600).toFixed(1) },
          ],
          history: [...m.maintenanceLog.map((h) => ({ t: h.t, text: `[maint] ${h.text}` })), ...m.history].sort((a, b) => a.t - b.t).slice(-40),
        };
      }
      case 'conveyor': {
        const c = this.conveyors.get(ref.id);
        if (!c) return null;
        return {
          kind: 'conveyor',
          id: c.id,
          title: c.name,
          fields: [
            { label: 'Status', value: c.state },
            { label: 'Items', value: `${c.items.length} / ${c.capacity}` },
            { label: 'Length', value: `${c.length.toFixed(1)} m` },
            { label: 'Speed', value: `${c.speed} m/s` },
            { label: 'Average load', value: c.queue.average(now).toFixed(2) },
            { label: 'Failures', value: String(c.failures) },
          ],
          history: c.history.slice(-30),
        };
      }
      case 'vehicle': {
        const fleet = ref.id.startsWith('agv') ? this.agvs : this.forklifts;
        const v = fleet.vehicles.find((x) => x.id === ref.id);
        if (!v) return null;
        return {
          kind: 'vehicle',
          id: v.id,
          title: v.name,
          fields: [
            { label: 'Status', value: v.state },
            { label: 'Current task', value: v.task?.label ?? '—' },
            { label: 'Trips completed', value: String(v.trips) },
            { label: 'Utilisation', value: pct(v.utilization(now)) },
            { label: 'Failures', value: String(v.failures) },
            { label: 'Speed', value: `${v.speed} m/s` },
          ],
          history: v.history.slice(-30),
        };
      }
      case 'worker': {
        const w = this.workforce.get(ref.id);
        if (!w) return null;
        return {
          kind: 'worker',
          id: w.id,
          title: w.name,
          fields: [
            { label: 'Role', value: w.role },
            { label: 'Shift', value: String(w.shift + 1) },
            { label: 'Status', value: w.state },
            { label: 'Station', value: w.station ?? w.coverTarget ?? (w.repair ? `repair ${w.repair.id}` : '—') },
            { label: 'Home station', value: w.home ?? '—' },
            { label: 'Hours worked (all shifts)', value: ((w.laborSec + (w.onShift && !w.absent ? now - w.presentSince : 0)) / 3600).toFixed(1) },
          ],
          history: w.history.slice(-30),
        };
      }
      case 'product': {
        const p = this.products.get(ref.id) ?? this.archive.get(ref.id);
        if (!p) return null;
        const order = this.orders.orders.get(p.orderId);
        const end = p.stageTimes.shipped ?? p.stageTimes.scrapped ?? now;
        return {
          kind: 'product',
          id: p.id,
          title: `${p.id} — ${this.cfg.products[p.type].name}`,
          fields: [
            { label: 'Type', value: p.type },
            { label: 'Order', value: `${p.orderId}${order ? ` (${order.priority}, due ${formatTime(order.dueAt)})` : ''}` },
            { label: 'Stage', value: p.stage },
            { label: 'Quality', value: p.quality },
            { label: 'Assembly cell', value: `Cell ${p.cellIndex + 1}` },
            { label: 'Accumulated cost', value: money(p.cost) },
            { label: 'Released', value: formatTime(p.releasedAt) },
            { label: 'Time in system', value: formatDuration((p.stage === 'shipped' || p.stage === 'scrapped' ? end : now) - p.releasedAt) },
          ],
          history: p.history,
        };
      }
      case 'pallet': {
        const p = this.pallets.get(ref.id);
        if (!p) return null;
        return {
          kind: 'pallet',
          id: p.id,
          title: `Pallet ${p.id}`,
          fields: [
            { label: 'Order', value: p.orderId },
            { label: 'Product', value: this.cfg.products[p.type].name },
            { label: 'Units', value: `${p.productIds.length} / ${this.cfg.palletizer.unitsPerPallet}` },
            { label: 'Location', value: p.location },
            { label: 'Closed', value: p.closed ? 'yes' : 'no' },
          ],
          history: [],
        };
      }
      case 'order': {
        const o = this.orders.orders.get(ref.id);
        if (!o) return null;
        return {
          kind: 'order',
          id: o.id,
          title: `Order ${o.id}`,
          fields: [
            { label: 'Product', value: `${o.qty} × ${this.cfg.products[o.type].name}` },
            { label: 'Priority', value: o.priority },
            { label: 'Arrived', value: formatTime(o.createdAt) },
            { label: 'Due', value: formatTime(o.dueAt) },
            { label: 'Released / packed / palletized', value: `${o.released} / ${o.packed} / ${o.palletized}` },
            { label: 'Scrapped (replaced)', value: String(o.scrapped) },
            { label: 'State', value: o.state },
          ],
          history: [],
        };
      }
      case 'storage': {
        const inv = this.inventory;
        if (ref.id === 'fg') {
          return {
            kind: 'storage',
            id: 'fg',
            title: 'Finished goods storage',
            fields: [
              { label: 'Pallets stored', value: String(this.fg.count) },
              { label: 'Orders waiting for carrier', value: String(this.shipping.trucks.length) },
            ],
            history: [],
          };
        }
        const rack = this.layout.rawRacks.find((r) => `raw-${r.index}` === ref.id);
        const mats = rack ? rack.materials : MATERIAL_IDS;
        return {
          kind: 'storage',
          id: ref.id,
          title: rack ? `Raw storage rack ${rack.index + 1}` : 'Raw storage',
          fields: mats.flatMap((m) => [
            { label: `${m} on hand`, value: String(inv.onHand[m]) },
            { label: `${m} on order / ROP`, value: `${inv.onOrder[m]} / ${this.cfg.materials[m].reorderPoint}` },
          ]),
          history: [],
        };
      }
    }
  }

  incidentLabel(kind: keyof typeof INCIDENT_LABELS): string {
    return INCIDENT_LABELS[kind];
  }
}
