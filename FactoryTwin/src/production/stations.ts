import type { FailureSpec, HistoryEntry, MachineState, PhaseInfo, StationKind } from '../simulation/types';
import type { Pallet, Product } from '../entities/records';
import { addHistory } from '../entities/records';
import { QueueTracker, StateTracker, WearClock } from '../entities/trackers';
import type { RandomStream } from '../simulation/rng';
import type { Factory } from './factory';

type PhaseKind = 'handling' | 'process';

interface JobPhase {
  name: string;
  kind: PhaseKind;
  /** Remaining nominal work in seconds at rate 1. */
  work: number;
  total: number;
}

export interface Job {
  product: Product | null;
  phases: JobPhase[];
  idx: number;
  t0: number;
  t1: number;
  rate: number;
  /** Waiting for staff mid-job. */
  waiting: boolean;
  /** Fraction of the current phase already done when it (re)started (after a pause or rate change). */
  p0?: number;
  /** Inspection: result decided at the end of the test phase. */
  reject?: boolean;
  /** Palletizer: build position the job works on. */
  pos?: number;
  wrap?: boolean;
}

/**
 * Base class for single-capacity stations. A job is a sequence of phases. Failures are sampled
 * on busy time; a failure pauses the current phase and the remaining work resumes after repair.
 */
export abstract class Machine {
  readonly tracker: StateTracker<MachineState>;
  readonly queueTracker = new QueueTracker();
  readonly wear: WearClock;
  readonly proc: RandomStream;
  state: MachineState = 'closed';
  open = false;
  failed = false;
  inPm = false;
  staffed = 0;
  job: Job | null = null;
  blocked: Product | null = null;
  produced = 0;
  failures = 0;
  incidentSpeed = 1;
  readonly maintenanceLog: HistoryEntry[] = [];
  readonly history: HistoryEntry[] = [];
  private phaseEvent: number | null = null;
  private busySince = 0;
  /** Phase progress frozen at failure (for rendering). */
  frozen: number | null = null;
  repairPending = false;

  constructor(
    protected readonly f: Factory,
    readonly id: string,
    readonly kind: StationKind,
    readonly index: number,
    readonly name: string,
    failure: FailureSpec,
    readonly staffRequired: number,
    readonly repairNode: string,
  ) {
    this.tracker = new StateTracker<MachineState>('closed');
    this.wear = new WearClock(failure, f.rng.stream(`fail:${id}`));
    this.proc = f.rng.stream(`proc:${id}`);
  }

  protected get now(): number {
    return this.f.engine.now;
  }

  staffFactor(): number {
    if (this.staffRequired <= 0) return 1;
    return Math.min(1, this.staffed / this.staffRequired);
  }

  protected speedFactor(): number {
    return 1;
  }

  protected rate(kind: PhaseKind): number {
    return this.staffFactor() * this.incidentSpeed * (kind === 'process' ? this.speedFactor() : 1);
  }

  /** May a new job start now? */
  protected canStartNew(): boolean {
    return !this.job && !this.blocked && !this.failed && !this.inPm && this.open && this.staffFactor() > 0;
  }

  /** Called whenever something changes that could let the station start work. */
  abstract tryStart(): void;
  /** Called when a job finishes. Return true if `product` must be pushed downstream. */
  protected abstract finish(job: Job): boolean;
  /** Push a finished product downstream; false when the output is full. */
  protected abstract pushOutput(product: Product): boolean;
  protected afterOutput(): void {}
  protected waitingState(): MachineState {
    return 'starved';
  }
  protected onPhaseDone(_job: Job, _phase: JobPhase): void {}
  abstract queueLength(): number;

  protected startJob(product: Product | null, phases: { name: string; kind: PhaseKind; work: number }[], extra?: Partial<Job>): void {
    this.job = {
      product,
      phases: phases.map((p) => ({ ...p, total: p.work })),
      idx: 0,
      t0: this.now,
      t1: this.now,
      rate: 1,
      waiting: false,
      ...extra,
    };
    if (product) product.location = { kind: 'station', ref: this.id, slot: 0 };
    this.beginPhase();
  }

  private beginPhase(): void {
    const job = this.job!;
    const phase = job.phases[job.idx];
    const rate = this.rate(phase.kind);
    if (rate <= 0) {
      job.waiting = true;
      this.updateState();
      return;
    }
    job.waiting = false;
    this.frozen = null;
    const dur = phase.work / rate;
    job.p0 = phase.total > 0 ? 1 - phase.work / phase.total : 0;
    job.t0 = this.now;
    job.t1 = this.now + dur;
    job.rate = rate;
    this.busySince = this.now;
    const rem = this.wear.remaining;
    this.phaseEvent =
      rem < dur ? this.f.engine.in(Math.max(0, rem), 'mach.fail', this.id) : this.f.engine.in(dur, 'mach.phase', this.id);
    this.updateState();
  }

  onPhaseEvent(): void {
    this.phaseEvent = null;
    const job = this.job!;
    this.wear.addAge(this.now - this.busySince);
    const phase = job.phases[job.idx];
    phase.work = 0;
    this.onPhaseDone(job, phase);
    job.idx++;
    if (job.idx < job.phases.length) {
      this.beginPhase();
      return;
    }
    this.job = null;
    const needsOutput = this.finish(job);
    if (needsOutput && job.product) {
      if (this.pushOutput(job.product)) {
        this.produced++;
        this.afterOutput();
      } else {
        this.blocked = job.product;
      }
    }
    this.checkPm();
    this.updateState();
    this.tryStart();
  }

  /** Output space became available downstream. */
  retryOutput(): void {
    if (!this.blocked) return;
    const p = this.blocked;
    if (this.pushOutput(p)) {
      this.blocked = null;
      this.produced++;
      this.afterOutput();
      this.updateState();
      this.tryStart();
    }
  }

  onWearFailure(): void {
    this.phaseEvent = null;
    this.fail();
  }

  fail(repairSec?: number, reason = 'breakdown'): void {
    if (this.failed) return;
    const job = this.job;
    if (job && !job.waiting && this.phaseEvent !== null) {
      this.f.engine.cancel(this.phaseEvent);
      this.phaseEvent = null;
    }
    if (job && !job.waiting && job.t1 > job.t0) {
      // pause: keep remaining work
      const worked = (this.now - this.busySince) * job.rate;
      const phase = job.phases[job.idx];
      this.wear.addAge(this.now - this.busySince);
      phase.work = Math.max(0, phase.work - worked);
      this.frozen = Math.min(1, Math.max(0, (this.now - job.t0) / (job.t1 - job.t0)));
    }
    this.failed = true;
    this.failures++;
    addHistory(this.maintenanceLog, this.now, `Failure: ${reason}`);
    addHistory(this.history, this.now, `Failed (${reason})`);
    this.f.log.write('station.fail', this.id, reason);
    this.f.alert('critical', `${this.name} failed: ${reason}`, this.id);
    this.updateState();
    this.f.workforce.requestRepair({
      id: this.id,
      name: this.name,
      node: this.repairNode,
      duration: repairSec ?? this.wear.repairDuration(),
      onRepaired: () => this.repair(),
    });
    this.onFailed();
  }

  protected onFailed(): void {}

  repair(): void {
    if (!this.failed) return;
    this.failed = false;
    this.wear.renew();
    addHistory(this.maintenanceLog, this.now, 'Repaired');
    addHistory(this.history, this.now, 'Repaired');
    this.f.log.write('station.repair', this.id);
    if (this.job) this.beginPhase();
    else this.updateState();
    this.tryStart();
    this.onRepaired();
  }

  protected onRepaired(): void {}

  private checkPm(): void {
    const interval = this.pmIntervalSec();
    if (interval <= 0 || this.failed || this.wear.sincePm < interval) return;
    this.inPm = true;
    this.wear.sincePm = 0;
    addHistory(this.maintenanceLog, this.now, 'Preventive maintenance started');
    this.f.log.write('station.pm', this.id);
    this.f.engine.in(this.pmDurationSec(), 'mach.pmEnd', this.id);
    this.updateState();
  }

  onPmEnd(): void {
    this.inPm = false;
    this.wear.renew();
    addHistory(this.maintenanceLog, this.now, 'Preventive maintenance done');
    this.updateState();
    this.tryStart();
  }

  protected pmIntervalSec(): number {
    return 0;
  }
  protected pmDurationSec(): number {
    return 0;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.updateState();
    this.tryStart();
  }

  onStaffChange(): void {
    const job = this.job;
    if (job && !job.waiting && !this.failed && this.phaseEvent !== null) {
      const phase = job.phases[job.idx];
      const rate = this.rate(phase.kind);
      if (Math.abs(rate - job.rate) > 1e-9) {
        // bank the work done at the old rate, then continue (or wait) at the new rate
        this.f.engine.cancel(this.phaseEvent);
        this.phaseEvent = null;
        this.wear.addAge(this.now - this.busySince);
        phase.work = Math.max(0, phase.work - (this.now - this.busySince) * job.rate);
        this.beginPhase();
      }
    } else if (job?.waiting && !this.failed) this.beginPhase();
    this.updateState();
    this.tryStart();
  }

  updateState(): void {
    let s: MachineState;
    if (this.failed) s = 'failed';
    else if (this.inPm) s = 'maintenance';
    else if (this.job && !this.job.waiting) s = 'running';
    else if (this.job) s = this.open ? 'unstaffed' : 'closed';
    else if (this.blocked) s = 'blocked';
    else if (!this.open) s = 'closed';
    else if (this.staffFactor() <= 0) s = 'unstaffed';
    else s = this.waitingState();
    this.state = s;
    // statistics: outside shift hours only real processing counts; everything else is "closed"
    this.tracker.set(!this.open && s !== 'running' ? 'closed' : s, this.now);
    this.queueTracker.update(this.queueLength(), this.now);
  }

  phaseInfo(): PhaseInfo | null {
    const job = this.job;
    if (!job) return null;
    const phase = job.phases[Math.min(job.idx, job.phases.length - 1)];
    // express a resumed phase as one continuous 0..1 progress (virtual start before t0)
    const p0 = Math.min(0.999, job.p0 ?? 0);
    const t0 = p0 > 0 && job.t1 > job.t0 ? job.t0 - (p0 * (job.t1 - job.t0)) / (1 - p0) : job.t0;
    const info: PhaseInfo = { name: phase.name, t0, t1: job.t1 };
    if (this.failed || job.waiting) {
      const done = phase.total > 0 ? 1 - phase.work / phase.total : 0;
      info.frozenProgress = this.frozen ?? done;
    }
    return info;
  }

  utilization(now: number): number {
    const open = this.tracker.total(now) - this.tracker.time('closed', now);
    return open > 0 ? this.tracker.time('running', now) / open : 0;
  }
}

// ---------------------------------------------------------------------------

export class AssemblyCell extends Machine {
  readonly buffer: Product[] = [];
  readonly kitRequests: Product[] = [];
  /** Units assigned to this cell and not yet pushed onto its outbound conveyor. */
  committed = 0;
  inTransit = 0;
  rerouted = false;

  constructor(f: Factory, index: number) {
    const c = f.cfg.assembly;
    super(f, `cell-${index}`, 'assembly', index, `Assembly Cell ${index + 1}`, c.failure, f.cfg.staffing.assemblersPerCell, `cell-${index}-op`);
  }

  protected speedFactor(): number {
    return this.f.cfg.assembly.speedFactor;
  }

  protected pmIntervalSec(): number {
    return this.f.cfg.assembly.pmIntervalHours * 3600;
  }

  protected pmDurationSec(): number {
    return this.f.cfg.assembly.pmDurationMin * 60;
  }

  queueLength(): number {
    return this.buffer.length;
  }

  acceptsRelease(): boolean {
    return this.open && !this.failed && !this.inPm && !this.rerouted && this.committed < this.f.cfg.assembly.wipPerCell;
  }

  tryStart(): void {
    if (!this.canStartNew()) {
      this.updateState();
      return;
    }
    if (this.buffer.length === 0) {
      this.updateState();
      return;
    }
    let idx = this.buffer.findIndex((p) => p.rework);
    if (idx < 0) idx = 0;
    const product = this.buffer.splice(idx, 1)[0];
    if (product.rework) product.reworked = true;
    const cfg = this.f.cfg;
    const mean = cfg.products[product.type].assemblyTimeSec;
    const process = product.rework ? cfg.assembly.reworkTimeFactor * this.proc.around(mean) : this.proc.around(mean);
    this.f.setStage(product, 'assembly', `${product.rework ? 'Rework' : 'Assembly'} started at ${this.name}`);
    this.f.log.write(product.rework ? 'unit.rework-start' : 'unit.assembly-start', product.id, this.id);
    this.startJob(product, [
      { name: 'load', kind: 'handling', work: cfg.assembly.robotLoadSec },
      { name: 'process', kind: 'process', work: process },
      { name: 'unload', kind: 'handling', work: cfg.assembly.robotUnloadSec },
    ]);
  }

  protected finish(job: Job): boolean {
    const p = job.product!;
    this.f.log.write('unit.assembled', p.id, this.id, p.rework ? 1 : 0);
    p.cost += ((job.phases.reduce((s, ph) => s + ph.total, 0) / 3600) * this.f.cfg.costs.machineCostPerHour.assembly) / 1;
    p.rework = false;
    return true;
  }

  protected pushOutput(product: Product): boolean {
    const conv = this.f.c1[this.index];
    if (!conv.canEnter()) return false;
    conv.enter(product);
    this.committed--;
    this.f.setStage(product, 'to-inspection', `Assembled, on ${conv.id}`);
    return true;
  }

  protected afterOutput(): void {
    this.f.orders.release();
  }

  protected waitingState(): MachineState {
    return this.committed > 0 || this.f.orders.backlogUnits > 0 ? 'starved' : 'idle';
  }

  protected onRepaired(): void {
    this.f.orders.release();
  }

  /** AGV delivered kits or rework units. */
  deliver(products: Product[]): void {
    for (const p of products) {
      if (p.rework) this.buffer.unshift(p);
      else this.buffer.push(p);
      this.inTransit--;
      p.location = { kind: 'buffer', ref: this.id, slot: 0 };
      this.f.setStage(p, 'awaiting-assembly', `Delivered to ${this.name}`);
    }
    this.updateState();
    this.tryStart();
  }
}

// ---------------------------------------------------------------------------

export class InspectionStation extends Machine {
  constructor(f: Factory, index: number) {
    super(f, `insp-${index}`, 'inspection', index, `Inspection ${index + 1}`, f.cfg.inspection.failure, f.cfg.staffing.inspectorsPerStation, `insp-${index}-op`);
  }

  protected speedFactor(): number {
    return this.f.cfg.inspection.speedFactor;
  }

  queueLength(): number {
    return this.f.infeed.length;
  }

  tryStart(): void {
    if (!this.canStartNew() || this.f.infeed.length === 0) {
      this.updateState();
      return;
    }
    const product = this.f.infeed.shift()!;
    const c = this.f.cfg.inspection;
    this.f.setStage(product, 'inspection', `Inspection started at ${this.name}`);
    this.f.log.write('unit.inspect-start', product.id, this.id);
    this.startJob(product, [
      { name: 'load', kind: 'handling', work: c.handlingSec / 2 },
      { name: 'test', kind: 'process', work: this.proc.around(c.testSec) },
      { name: 'unload', kind: 'handling', work: c.handlingSec / 2 },
    ]);
    this.f.pullIntoInfeed();
  }

  protected onPhaseDone(job: Job, phase: JobPhase): void {
    if (phase.name === 'test') {
      job.reject = this.f.qualityStream.chance(this.f.effectiveRejectRate());
    }
  }

  protected finish(job: Job): boolean {
    const p = job.product!;
    p.cost += (this.f.cfg.inspection.handlingSec + this.f.cfg.inspection.testSec) / 3600 * this.f.cfg.costs.machineCostPerHour.inspection;
    if (!job.reject) {
      p.quality = p.reworked ? 'passed-after-rework' : 'passed';
      this.f.log.write('unit.inspect-pass', p.id, this.id);
      return true;
    }
    this.f.log.write('unit.inspect-reject', p.id, this.id, p.reworked ? 1 : 0);
    if (p.reworked) {
      this.produced++;
      this.f.scrap(p, `Rejected again at ${this.name}`);
      return false;
    }
    p.quality = 'rejected-once';
    return true;
  }

  protected pushOutput(product: Product): boolean {
    if (product.quality === 'rejected-once') {
      if (this.f.rejectBin.length >= this.f.cfg.inspection.rejectBinCapacity) return false;
      this.f.rejectBin.push(product);
      product.location = { kind: 'buffer', ref: 'reject', slot: 0 };
      this.f.setStage(product, 'rework-wait', `Rejected at ${this.name}, waiting for rework transport`);
      this.f.agvs.dispatch();
      return true;
    }
    if (!this.f.c2.canEnter()) return false;
    this.f.c2.enter(product);
    this.f.setStage(product, 'to-packaging', `Passed inspection at ${this.name}`);
    return true;
  }
}

// ---------------------------------------------------------------------------

export class PackagingLine extends Machine {
  materialStarved = false;

  constructor(f: Factory) {
    super(f, 'pack', 'packaging', 0, 'Packaging Line', f.cfg.packaging.failure, f.cfg.staffing.packers, 'pack-op-0');
  }

  protected speedFactor(): number {
    return this.f.cfg.packaging.speedFactor;
  }

  queueLength(): number {
    return this.f.c2.items.length;
  }

  tryStart(): void {
    if (!this.canStartNew()) {
      this.updateState();
      return;
    }
    const head = this.f.c2.headProduct();
    if (!head) {
      this.updateState();
      return;
    }
    if (!this.f.inventory.tryConsume('PACKAGING_KIT', 1, head.id)) {
      this.materialStarved = true;
      this.updateState();
      return;
    }
    this.materialStarved = false;
    const product = this.f.c2.takeHead();
    product.cost += this.f.cfg.materials.PACKAGING_KIT.unitCost;
    this.f.setStage(product, 'packaging', 'Packaging started');
    this.f.log.write('unit.pack-start', product.id, this.id);
    this.startJob(product, [{ name: 'pack', kind: 'process', work: this.proc.around(this.f.cfg.packaging.packSec) }]);
  }

  protected finish(job: Job): boolean {
    const p = job.product!;
    p.cost += (this.f.cfg.packaging.packSec / 3600) * this.f.cfg.costs.machineCostPerHour.packaging;
    this.f.log.write('unit.packed', p.id, this.id);
    this.f.orders.onPacked(p);
    return true;
  }

  protected pushOutput(product: Product): boolean {
    if (!this.f.c3.canEnter()) return false;
    this.f.c3.enter(product);
    this.f.setStage(product, 'to-palletizer', 'Packed, on C3');
    return true;
  }
}

// ---------------------------------------------------------------------------

export class Palletizer extends Machine {
  readonly positions: (Pallet | null)[];
  private readonly wrapQueue: number[] = [];
  waitingForklift = false;

  constructor(f: Factory) {
    super(f, 'pal', 'palletizer', 0, 'Palletizer', { mtbfHours: 0, mttrMin: 0, weibullShape: 1 }, 0, 'pal-0');
    this.positions = Array.from({ length: f.cfg.palletizer.buildPositions }, () => null);
  }

  queueLength(): number {
    return this.f.c3.items.length;
  }

  protected waitingState(): MachineState {
    return this.waitingForklift ? 'blocked' : 'starved';
  }

  tryStart(): void {
    this.waitingForklift = false;
    if (!this.canStartNew()) {
      this.updateState();
      return;
    }
    // 1) wrap closed-out pallets first
    if (this.wrapQueue.length > 0) {
      const pos = this.wrapQueue.shift()!;
      this.startJob(null, [{ name: 'wrap', kind: 'process', work: this.f.cfg.palletizer.wrapSec }], { pos, wrap: true });
      return;
    }
    const head = this.f.c3.headProduct();
    if (!head) {
      this.updateState();
      return;
    }
    let pos = this.positions.findIndex((p) => p !== null && !p.closed && !closing(p) && p.orderId === head.orderId);
    if (pos < 0) pos = this.positions.findIndex((p) => p === null);
    if (pos < 0) {
      // close the oldest partial pallet short to free a position
      let oldest = -1;
      this.positions.forEach((p, i) => {
        if (p && !p.closed && !closing(p) && (oldest < 0 || p.lastTouch < this.positions[oldest]!.lastTouch)) oldest = i;
      });
      if (oldest >= 0) {
        markClosing(this.positions[oldest]!);
        this.wrapQueue.push(oldest);
        this.tryStart();
        return;
      }
      this.waitingForklift = true;
      this.updateState();
      return;
    }
    const product = this.f.c3.takeHead();
    if (!this.positions[pos]) this.positions[pos] = this.f.newPallet(product, pos);
    this.f.setStage(product, 'palletizing', `Palletizing on ${this.positions[pos]!.id}`);
    this.startJob(product, [{ name: 'place', kind: 'handling', work: 4 }], { pos });
  }

  protected finish(job: Job): boolean {
    const pallet = this.positions[job.pos!]!;
    if (job.wrap) {
      pallet.closed = true;
      this.f.log.write('pallet.close', pallet.id, pallet.orderId, pallet.productIds.length);
      this.f.forklifts.requestStore(pallet);
      return false;
    }
    const p = job.product!;
    pallet.productIds.push(p.id);
    pallet.lastTouch = this.now;
    p.location = { kind: 'pallet', ref: pallet.id, slot: pallet.productIds.length - 1 };
    this.f.setStage(p, 'finished', `Stacked on ${pallet.id}`);
    this.f.log.write('unit.palletized', p.id, pallet.id);
    const order = this.f.orders.get(p.orderId);
    order.palletized++;
    if (pallet.productIds.length >= this.f.cfg.palletizer.unitsPerPallet || order.palletized >= order.qty) {
      markClosing(pallet);
      this.wrapQueue.push(job.pos!);
    }
    this.produced++;
    return false;
  }

  protected pushOutput(): boolean {
    return true;
  }

  /** Forklift took the pallet from a build position. */
  release(pos: number): void {
    this.positions[pos] = null;
    this.updateState();
    this.tryStart();
  }
}

const closingSet = new WeakSet<Pallet>();
function closing(p: Pallet): boolean {
  return closingSet.has(p);
}
function markClosing(p: Pallet): void {
  closingSet.add(p);
}
