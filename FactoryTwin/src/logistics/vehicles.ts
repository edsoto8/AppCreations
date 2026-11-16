import type { HistoryEntry, MotionSegment, PhaseInfo, Vec2, VehicleKind, VehicleSnap, VehicleState } from '../simulation/types';
import type { MaterialLot, Pallet, Product } from '../entities/records';
import { addHistory } from '../entities/records';
import { StateTracker, WearClock } from '../entities/trackers';
import { distanceAt, pointAtDistance } from './motion';
import type { Factory } from '../production/factory';

export interface Stop {
  point: string;
  dur: number;
  action: 'pick-kits' | 'pick-rework' | 'deliver' | 'pick-lot' | 'putaway' | 'pick-pallet' | 'store' | 'pick-fg' | 'load-truck';
}

export interface Task {
  kind: 'kits' | 'rework' | 'putaway' | 'store' | 'load';
  priority: number;
  seq: number;
  label: string;
  stops: Stop[];
  stopIdx: number;
  cell?: number;
  products?: Product[];
  pallet?: Pallet;
  lot?: MaterialLot;
  truckId?: string;
  fgSlot?: number;
  createdAt?: number;
}

type Step = 'idle' | 'approach' | 'spur' | 'work' | 'home';

export class Vehicle {
  node: string;
  pos: Vec2;
  heading = 0;
  motion: MotionSegment | null = null;
  state: VehicleState = 'idle';
  step: Step = 'idle';
  target = '';
  task: Task | null = null;
  phase: PhaseInfo | null = null;
  failed = false;
  trips = 0;
  failures = 0;
  moveEvent: number | null = null;
  movingSince = 0;
  frozen: { points: Vec2[]; d: number; length: number } | null = null;
  readonly tracker: StateTracker<VehicleState>;
  readonly wear: WearClock;
  readonly history: HistoryEntry[] = [];
  heldPoint: string | null = null;

  constructor(
    readonly f: Factory,
    readonly id: string,
    readonly kind: VehicleKind,
    readonly index: number,
    readonly name: string,
    readonly speed: number,
    readonly homeNode: string,
  ) {
    this.node = homeNode;
    this.pos = [...f.layout.graph.position(homeNode)] as Vec2;
    this.tracker = new StateTracker<VehicleState>('idle');
    const spec = kind === 'agv' ? f.cfg.vehicles.agvFailure : f.cfg.vehicles.forkliftFailure;
    this.wear = new WearClock(spec, f.rng.stream(`fail:${id}`));
  }

  setState(s: VehicleState): void {
    this.state = s;
    this.tracker.set(s, this.f.engine.now);
  }

  get busy(): boolean {
    return this.task !== null;
  }

  utilization(now: number): number {
    const total = this.tracker.total(now) - this.tracker.time('off-shift', now);
    if (total <= 0) return 0;
    const idle = this.tracker.time('idle', now);
    return 1 - idle / total;
  }

  snap(): VehicleSnap {
    let cargo: VehicleSnap['cargo'] = null;
    const t = this.task;
    if (t && t.stopIdx > 0) {
      if (t.kind === 'kits') cargo = { kind: 'kits', count: t.products!.length, label: `${t.products!.length} kits` };
      else if (t.kind === 'rework') cargo = { kind: 'rework', count: t.products!.length, label: `${t.products!.length} rework` };
      else if (t.kind === 'putaway') cargo = { kind: 'material', count: 1, label: `${t.lot!.material} x${t.lot!.qty}` };
      else cargo = { kind: 'pallet', count: t.pallet!.productIds.length, label: t.pallet!.id };
    }
    return {
      id: this.id,
      kind: this.kind,
      name: this.name,
      state: this.state,
      pos: this.pos,
      heading: this.heading,
      motion: this.motion,
      phase: this.phase,
      cargo,
      trips: this.trips,
    };
  }
}

/**
 * Movement + point reservation shared by AGVs and forklifts.
 * Pick-up/drop-off points have capacity 1; vehicles queue (FIFO) at the aisle node in front.
 */
export abstract class Fleet {
  readonly vehicles: Vehicle[] = [];
  private static readonly points = new WeakMap<Factory, Map<string, { occupant: string | null; queue: Vehicle[] }>>();
  protected seq = 0;

  constructor(protected readonly f: Factory) {}

  private pointMap() {
    let m = Fleet.points.get(this.f);
    if (!m) {
      m = new Map();
      Fleet.points.set(this.f, m);
    }
    return m;
  }

  private point(id: string) {
    const m = this.pointMap();
    let p = m.get(id);
    if (!p) {
      p = { occupant: null, queue: [] };
      m.set(id, p);
    }
    return p;
  }

  pointQueue(id: string): number {
    const p = this.pointMap().get(id);
    return p ? p.queue.length : 0;
  }

  abstract dispatch(): void;
  protected abstract onStopDone(v: Vehicle, stop: Stop): void;
  protected abstract canWork(v: Vehicle): boolean;

  protected moveTo(v: Vehicle, node: string, step: Step): void {
    v.step = step;
    v.target = node;
    const { points, length } = this.f.layout.graph.path(v.node, node);
    this.startMotion(v, points, 0, length);
  }

  private startMotion(v: Vehicle, points: Vec2[], d0: number, length: number): void {
    const now = this.f.engine.now;
    const dur = Math.max(0, (length - d0) / v.speed);
    v.motion = dur > 0 ? { points, t0: now, t1: now + dur, d0, d1: length } : null;
    v.movingSince = now;
    v.phase = null;
    const rem = v.wear.remaining;
    v.moveEvent = rem < dur ? this.f.engine.in(Math.max(0, rem), 'veh.fail', v.id) : this.f.engine.in(dur, 'veh.arrive', v.id);
    const st: VehicleState =
      v.step === 'home' ? 'returning' : v.task && v.task.stopIdx === 0 ? 'to-pickup' : v.task ? 'to-dropoff' : 'returning';
    v.setState(st);
  }

  onArrive(v: Vehicle): void {
    v.moveEvent = null;
    v.wear.addAge(this.f.engine.now - v.movingSince);
    if (v.motion) {
      const end = pointAtDistance(v.motion.points, v.motion.d1);
      v.heading = end.heading;
    }
    v.node = v.target;
    v.pos = [...this.f.layout.graph.position(v.node)] as Vec2;
    v.motion = null;
    switch (v.step) {
      case 'approach': {
        const stop = v.task!.stops[v.task!.stopIdx];
        const p = this.point(stop.point);
        if (p.occupant === null) {
          p.occupant = v.id;
          v.heldPoint = stop.point;
          this.moveTo(v, stop.point, 'spur');
        } else {
          p.queue.push(v);
          v.setState('queued');
        }
        break;
      }
      case 'spur': {
        const stop = v.task!.stops[v.task!.stopIdx];
        const now = this.f.engine.now;
        v.step = 'work';
        v.phase = { name: stop.action, t0: now, t1: now + stop.dur };
        v.setState(v.task!.stopIdx === 0 ? 'loading' : 'unloading');
        this.f.engine.in(stop.dur, 'veh.work', v.id);
        break;
      }
      case 'home':
        v.step = 'idle';
        v.setState(this.canWork(v) ? 'idle' : 'off-shift');
        this.dispatch();
        break;
      default:
        break;
    }
  }

  onWorkDone(v: Vehicle): void {
    const task = v.task!;
    const stop = task.stops[task.stopIdx];
    v.phase = null;
    this.onStopDone(v, stop);
    this.releasePoint(v);
    task.stopIdx++;
    if (task.stopIdx < task.stops.length) {
      this.goStop(v);
      return;
    }
    v.task = null;
    v.trips++;
    this.f.log.write('vehicle.trip', v.id, task.kind);
    addHistory(v.history, this.f.engine.now, `Completed: ${task.label}`);
    v.step = 'idle';
    v.setState('idle');
    this.dispatch();
    if (!v.task) this.moveTo(v, v.homeNode, 'home');
  }

  private releasePoint(v: Vehicle): void {
    if (!v.heldPoint) return;
    const p = this.point(v.heldPoint);
    p.occupant = null;
    v.heldPoint = null;
    const next = p.queue.shift();
    if (next) {
      const stop = next.task!.stops[next.task!.stopIdx];
      p.occupant = next.id;
      next.heldPoint = stop.point;
      this.moveTo(next, stop.point, 'spur');
    }
  }

  protected assign(v: Vehicle, task: Task): void {
    v.task = task;
    addHistory(v.history, this.f.engine.now, `Assigned: ${task.label}`);
    if (v.moveEvent !== null) {
      // was heading home: stop where it is and re-plan from the nearest node
      this.f.engine.cancel(v.moveEvent);
      v.moveEvent = null;
      if (v.motion) {
        const now = this.f.engine.now;
        v.wear.addAge(now - v.movingSince);
        const d = distanceAt(v.motion, now);
        const p = pointAtDistance(v.motion.points, d);
        v.pos = [p.x, p.z];
        v.node = this.f.layout.nearestNode(v.pos);
        v.motion = null;
      }
    }
    this.goStop(v);
  }

  private goStop(v: Vehicle): void {
    const stop = v.task!.stops[v.task!.stopIdx];
    const approach = this.f.layout.approachNode(stop.point);
    this.moveTo(v, approach, 'approach');
  }

  onFail(v: Vehicle): void {
    const now = this.f.engine.now;
    v.moveEvent = null;
    v.wear.addAge(now - v.movingSince);
    if (v.motion) {
      const d = distanceAt(v.motion, now);
      const p = pointAtDistance(v.motion.points, d);
      v.pos = [p.x, p.z];
      v.heading = p.heading;
      v.frozen = { points: v.motion.points, d, length: v.motion.d1 };
    } else {
      v.frozen = { points: [v.pos], d: 0, length: 0 };
    }
    v.motion = null;
    v.failed = true;
    v.failures++;
    v.setState('failed');
    addHistory(v.history, now, 'Breakdown');
    this.f.log.write('vehicle.fail', v.id);
    this.f.alert('warning', `${v.name} broke down`, v.id);
    this.f.engine.in(v.wear.repairDuration(), 'veh.repair', v.id);
  }

  onRepair(v: Vehicle): void {
    v.failed = false;
    v.wear.renew();
    addHistory(v.history, this.f.engine.now, 'Repaired (field service)');
    this.f.log.write('vehicle.repair', v.id);
    const fr = v.frozen!;
    v.frozen = null;
    if (fr.length === 0) {
      this.startMotion(v, [v.pos], 0, 0);
    } else {
      this.startMotion(v, fr.points, fr.d, fr.length);
    }
  }
}

// ---------------------------------------------------------------------------

export class AgvFleet extends Fleet {
  private readonly claimed = new Set<string>();

  constructor(f: Factory) {
    super(f);
    const vc = f.cfg.vehicles;
    for (let k = 0; k < vc.agvCount; k++) {
      this.vehicles.push(new Vehicle(f, `agv-${k}`, 'agv', k, `AGV ${k + 1}`, vc.agvSpeedMps, f.layout.agvParking[k].node));
    }
  }

  protected canWork(): boolean {
    return true;
  }

  dispatch(): void {
    for (const v of this.vehicles) {
      if (v.task || v.failed) continue;
      const task = this.nextTask();
      if (!task) return;
      this.assign(v, task);
    }
  }

  private chooseCell(): number {
    let best = -1;
    for (const c of this.f.cells) {
      if (c.failed || c.rerouted) continue;
      if (best < 0 || c.committed < this.f.cells[best].committed) best = c.index;
    }
    return best < 0 ? 0 : best;
  }

  private nextTask(): Task | null {
    const vc = this.f.cfg.vehicles;
    const cfg = this.f.cfg;
    // 1) rework units waiting in the reject bin
    const waiting = this.f.rejectBin.filter((p) => !this.claimed.has(p.id));
    if (waiting.length > 0) {
      const n = Math.min(vc.agvCapacityKits, waiting.length, this.f.inventory.onHand.PCB);
      if (n === 0) this.f.inventory.noteStockout('PCB');
      else {
        const cell = this.chooseCell();
        const products = waiting.slice(0, n);
        for (const p of products) {
          this.claimed.add(p.id);
          p.cost += this.f.inventory.consumeAll([['PCB', 1]], p.id);
          p.rework = true;
          p.cellIndex = cell;
        }
        const c = this.f.cells[cell];
        c.committed += n;
        c.inTransit += n;
        return {
          kind: 'rework',
          priority: 0,
          seq: this.seq++,
          label: `Rework ${n} unit(s) to ${c.name}`,
          cell,
          products,
          stops: [
            { point: 'reject', dur: vc.loadSec, action: 'pick-rework' },
            { point: this.f.layout.cells[cell].dropNode, dur: vc.unloadSec, action: 'deliver' },
          ],
          stopIdx: 0,
        };
      }
    }
    // 2) kits for the cell with the oldest request
    const cells = this.f.cells
      .filter((c) => c.kitRequests.length > 0)
      .sort((a, b) => a.kitRequests[0].releasedAt - b.kitRequests[0].releasedAt || a.index - b.index);
    for (const c of cells) {
      const products: Product[] = [];
      while (products.length < vc.agvCapacityKits && c.kitRequests.length > 0) {
        const p = c.kitRequests[0];
        const bom = this.f.inventory.kitBom(p.type);
        const missing = this.f.inventory.canConsume(bom);
        if (missing) {
          this.f.inventory.noteStockout(missing);
          break;
        }
        c.kitRequests.shift();
        p.cost += this.f.inventory.consumeAll(bom, p.id);
        this.f.log.write('unit.kitted', p.id, c.id);
        this.f.setStage(p, 'kit-transport', `Kit picked for ${c.name}`);
        products.push(p);
      }
      if (products.length > 0) {
        c.inTransit += products.length;
        return {
          kind: 'kits',
          priority: 1,
          seq: this.seq++,
          label: `${products.length} kit(s) to ${c.name}`,
          cell: c.index,
          products,
          stops: [
            { point: 'kit', dur: vc.loadSec + 2 * products.length, action: 'pick-kits' },
            { point: this.f.layout.cells[c.index].dropNode, dur: vc.unloadSec, action: 'deliver' },
          ],
          stopIdx: 0,
        };
      }
    }
    void cfg;
    return null;
  }

  protected onStopDone(v: Vehicle, stop: Stop): void {
    const t = v.task!;
    if (stop.action === 'pick-kits') {
      t.products!.forEach((p, i) => (p.location = { kind: 'vehicle', ref: v.id, slot: i }));
    } else if (stop.action === 'pick-rework') {
      t.products!.forEach((p, i) => {
        const idx = this.f.rejectBin.indexOf(p);
        if (idx >= 0) this.f.rejectBin.splice(idx, 1);
        this.claimed.delete(p.id);
        p.location = { kind: 'vehicle', ref: v.id, slot: i };
        this.f.setStage(p, 'rework-transport', `Picked up for rework by ${v.name}`);
      });
      for (const s of this.f.inspections) s.retryOutput();
    } else if (stop.action === 'deliver') {
      this.f.cells[t.cell!].deliver(t.products!);
    }
  }
}

// ---------------------------------------------------------------------------

export class ForkliftFleet extends Fleet {
  readonly queue: Task[] = [];

  constructor(f: Factory) {
    super(f);
    const vc = f.cfg.vehicles;
    for (let k = 0; k < vc.forkliftCount; k++) {
      this.vehicles.push(new Vehicle(f, `fork-${k}`, 'forklift', k, `Forklift ${k + 1}`, vc.forkliftSpeedMps, f.layout.forkliftHome[k]));
    }
  }

  protected canWork(v: Vehicle): boolean {
    return this.f.workforce.staffedCount(`forklift-${v.index}`) > 0;
  }

  dispatch(): void {
    for (const v of this.vehicles) {
      if (v.task || v.failed) continue;
      if (!this.canWork(v)) {
        if (v.step === 'idle') v.setState('off-shift');
        continue;
      }
      if (this.queue.length === 0) {
        if (v.step === 'idle') v.setState('idle');
        return;
      }
      // effective priority: store first (the palletizer has few build positions), urgent put-away
      // when its material runs low, then loading, then routine put-away; aging moves a task up by at
      // most one class so nothing waits forever.
      const now = this.f.engine.now;
      const eff = (t: Task) => {
        let p = t.priority - Math.min(1, (now - (t.createdAt ?? now)) / 3600);
        if (t.kind === 'store') p = 0;
        if (t.kind === 'putaway') {
          const m = t.lot!.material;
          if (this.f.inventory.onHand[m] < this.f.cfg.materials[m].reorderPoint * 0.35) p = 0.5;
        }
        return p;
      };
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = eff(this.queue[i]);
        const b = eff(this.queue[best]);
        if (a < b || (a === b && this.queue[i].seq < this.queue[best].seq)) best = i;
      }
      const task = this.queue.splice(best, 1)[0];
      if (task.kind === 'store') {
        task.fgSlot = this.f.fg.alloc();
        task.stops[1].point = this.f.fg.nodeFor(task.fgSlot);
      }
      this.assign(v, task);
    }
  }

  requestPutaway(lot: MaterialLot): void {
    const vc = this.f.cfg.vehicles;
    const rack = this.f.layout.rawRacks.find((r) => r.materials.includes(lot.material))!;
    this.queue.push({
      kind: 'putaway',
      priority: 3,
      createdAt: this.f.engine.now,
      seq: this.seq++,
      label: `Put away ${lot.material} x${lot.qty}`,
      lot,
      stops: [
        { point: this.f.layout.receivingBays[lot.bay].node, dur: vc.loadSec, action: 'pick-lot' },
        { point: rack.node, dur: vc.unloadSec + 10, action: 'putaway' },
      ],
      stopIdx: 0,
    });
    this.dispatch();
  }

  requestStore(pallet: Pallet): void {
    const vc = this.f.cfg.vehicles;
    this.queue.push({
      kind: 'store',
      priority: 1,
      createdAt: this.f.engine.now,
      seq: this.seq++,
      label: `Store ${pallet.id} in FG`,
      pallet,
      stops: [
        { point: this.f.layout.palletizer.nodes[pallet.slot], dur: vc.loadSec, action: 'pick-pallet' },
        { point: 'fg-0', dur: vc.unloadSec + 8, action: 'store' },
      ],
      stopIdx: 0,
    });
    this.dispatch();
  }

  requestLoad(pallet: Pallet, truckId: string, bay: number): void {
    const vc = this.f.cfg.vehicles;
    this.queue.push({
      kind: 'load',
      priority: 2,
      createdAt: this.f.engine.now,
      seq: this.seq++,
      label: `Load ${pallet.id} onto ${truckId}`,
      pallet,
      truckId,
      stops: [
        { point: this.f.fg.nodeFor(pallet.slot), dur: vc.loadSec + 6, action: 'pick-fg' },
        { point: this.f.layout.shippingBays[bay].node, dur: vc.unloadSec, action: 'load-truck' },
      ],
      stopIdx: 0,
    });
    this.dispatch();
  }

  protected onStopDone(v: Vehicle, stop: Stop): void {
    const t = v.task!;
    switch (stop.action) {
      case 'pick-lot':
        break;
      case 'putaway':
        this.f.inventory.putaway(t.lot!);
        break;
      case 'pick-pallet': {
        const pal = t.pallet!;
        const pos = pal.slot;
        pal.location = 'forklift';
        pal.vehicleId = v.id;
        pal.slot = -1;
        this.f.palletizer.release(pos);
        break;
      }
      case 'store': {
        const pal = t.pallet!;
        pal.location = 'fg';
        pal.vehicleId = null;
        pal.slot = t.fgSlot!;
        this.f.log.write('pallet.store', pal.id, pal.orderId, pal.productIds.length);
        this.f.orders.onPalletStored(pal);
        break;
      }
      case 'pick-fg': {
        const pal = t.pallet!;
        this.f.fg.free(pal.slot);
        pal.location = 'forklift';
        pal.vehicleId = v.id;
        pal.slot = -1;
        break;
      }
      case 'load-truck': {
        const pal = t.pallet!;
        pal.location = 'truck';
        pal.vehicleId = null;
        this.f.shipping.onPalletLoaded(t.truckId!, pal);
        break;
      }
      default:
        break;
    }
  }
}
