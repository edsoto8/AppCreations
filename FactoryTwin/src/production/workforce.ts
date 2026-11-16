import type { HistoryEntry, MotionSegment, ShiftIndex, Vec2, WorkerRole, WorkerSnap, WorkerState } from '../simulation/types';
import { addHistory } from '../entities/records';
import { distanceAt, pointAtDistance, polylineLength } from '../logistics/motion';
import { dayStart, HOUR } from '../simulation/clock';
import type { Factory } from './factory';

export interface RepairRequest {
  id: string;
  name: string;
  node: string;
  duration: number;
  onRepaired(): void;
}

type Step = 'none' | 'to-station' | 'to-cover' | 'to-break' | 'leaving' | 'to-repair' | 'to-idle' | 'to-absent';

export class Worker {
  state: WorkerState = 'off-shift';
  step: Step = 'none';
  pos: Vec2;
  heading = 0;
  motion: MotionSegment | null = null;
  moveEvent: number | null = null;
  /** Station the worker is currently counted at. */
  station: string | null = null;
  /** Floater: station being covered (target while walking). */
  coverTarget: string | null = null;
  repair: RepairRequest | null = null;
  repairEvent: number | null = null;
  onShift = false;
  absent = false;
  leaveAfterRepair = false;
  presentSince = 0;
  laborSec = 0;
  readonly history: HistoryEntry[] = [];

  constructor(
    readonly id: string,
    readonly name: string,
    readonly role: WorkerRole,
    readonly shift: ShiftIndex,
    /** Home station id (cell-0, insp-1, pack, forklift-0) or null for floater/technician. */
    public home: string | null,
    public workNode: string,
    readonly breakSlot: number,
    entrance: Vec2,
  ) {
    this.pos = [...entrance] as Vec2;
  }
}

const FIRST = ['Ana', 'Ben', 'Chen', 'Dara', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kofi', 'Lena', 'Mo', 'Nia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Vik', 'Wen', 'Xavi', 'Yara', 'Zed'];
const LAST = ['Okafor', 'Silva', 'Novak', 'Haddad', 'Kim', 'Moreau', 'Reyes', 'Tanaka', 'Berg', 'Costa'];

/**
 * Shifts, breaks, absences, floater coverage and technicians.
 * Station staffing = number of workers currently counted at the station.
 */
export class Workforce {
  readonly workers: Worker[] = [];
  private readonly staff = new Map<string, Worker[]>();
  private readonly coverage: { station: string; reason: 'break' | 'absence'; worker: string }[] = [];
  readonly repairs: RepairRequest[] = [];
  private readonly external = new Map<string, RepairRequest>();
  private readonly byId = new Map<string, Worker>();

  constructor(private readonly f: Factory) {
    const s = f.cfg.staffing;
    const entrance = f.layout.graph.position('entrance');
    let n = 0;
    for (let shift = 0; shift < f.cfg.shifts.startHours.length; shift++) {
      let slot = 0;
      const add = (role: WorkerRole, home: string | null, node: string) => {
        const name = `${FIRST[(n * 7 + 3) % FIRST.length]} ${LAST[(n * 3 + shift) % LAST.length]}`;
        const w = new Worker(`W${shift + 1}-${String(++n).padStart(2, '0')}`, name, role, shift as ShiftIndex, home, node, home ? slot++ : -1, entrance);
        this.workers.push(w);
        this.byId.set(w.id, w);
      };
      for (let i = 0; i < f.cfg.assembly.cells; i++)
        for (let k = 0; k < s.assemblersPerCell; k++) add('assembler', `cell-${i}`, `cell-${i}-op`);
      for (let j = 0; j < f.cfg.inspection.stations; j++)
        for (let k = 0; k < s.inspectorsPerStation; k++) add('inspector', `insp-${j}`, `insp-${j}-op`);
      for (let k = 0; k < s.packers; k++) add('packer', 'pack', `pack-op-${k % 2}`);
      for (let k = 0; k < s.drivers; k++) {
        const fk = k % Math.max(1, f.cfg.vehicles.forkliftCount);
        add('driver', `forklift-${fk}`, f.layout.forkliftHome[fk]);
      }
      for (let k = 0; k < s.floaters; k++) add('floater', null, 'break');
      for (let k = 0; k < s.technicians; k++) add('technician', null, 'control');
    }
  }

  get(id: string): Worker | undefined {
    return this.byId.get(id);
  }

  required(station: string): number {
    const s = this.f.cfg.staffing;
    if (station.startsWith('cell-')) return s.assemblersPerCell;
    if (station.startsWith('insp-')) return s.inspectorsPerStation;
    if (station === 'pack') return s.packers;
    if (station.startsWith('forklift-')) return 1;
    return 0;
  }

  staffedCount(station: string): number {
    return this.staff.get(station)?.length ?? 0;
  }

  staffAt(station: string): Worker[] {
    return this.staff.get(station) ?? [];
  }

  private notify(station: string): void {
    if (station.startsWith('forklift-')) {
      this.f.forklifts.dispatch();
      return;
    }
    const m = this.f.machines.get(station);
    if (m) {
      m.staffed = this.staffedCount(station);
      m.onStaffChange();
    }
  }

  private assign(w: Worker, station: string): void {
    const list = this.staff.get(station) ?? [];
    if (!list.includes(w)) list.push(w);
    this.staff.set(station, list);
    w.station = station;
    w.state = 'working';
    addHistory(w.history, this.f.engine.now, `Working at ${station}`);
    this.notify(station);
  }

  private unassign(w: Worker): void {
    const st = w.station;
    if (!st) return;
    const list = this.staff.get(st) ?? [];
    const i = list.indexOf(w);
    if (i >= 0) list.splice(i, 1);
    w.station = null;
    this.notify(st);
  }

  // --- movement ---------------------------------------------------------------

  private walk(w: Worker, node: string, step: Step): void {
    const now = this.f.engine.now;
    this.f.engine.cancel(w.moveEvent);
    w.moveEvent = null;
    // current position (may be mid-walk)
    if (w.motion) {
      const p = pointAtDistance(w.motion.points, distanceAt(w.motion, now));
      w.pos = [p.x, p.z];
    }
    const g = this.f.layout.graph;
    const start = g.nearest(w.pos);
    const path = g.path(start, node);
    const points: Vec2[] = [[w.pos[0], w.pos[1]], ...path.points];
    const length = polylineLength(points);
    const dur = length / this.f.cfg.staffing.walkSpeedMps;
    w.step = step;
    w.motion = dur > 0 ? { points, t0: now, t1: now + dur, d0: 0, d1: length } : null;
    if (w.state !== 'on-break' || step !== 'to-break') w.state = 'walking';
    w.moveEvent = this.f.engine.in(dur, 'wk.arrive', w.id);
  }

  onArrive(w: Worker): void {
    w.moveEvent = null;
    if (w.motion) {
      const end = pointAtDistance(w.motion.points, w.motion.d1);
      w.pos = [end.x, end.z];
      w.heading = end.heading;
    }
    w.motion = null;
    const step = w.step;
    w.step = 'none';
    switch (step) {
      case 'to-station': {
        const st = w.home!;
        // a floater covering this station hands over
        const floater = this.staffAt(st).find((x) => x.role === 'floater' && x.coverTarget === st && x !== w);
        if (floater && this.staffedCount(st) >= this.required(st)) this.releaseFloater(floater);
        this.cancelCoverage(st, w.id);
        this.assign(w, st);
        break;
      }
      case 'to-cover': {
        const st = w.coverTarget!;
        if (this.staffedCount(st) < this.required(st)) this.assign(w, st);
        else {
          w.coverTarget = null;
          this.floaterNext(w);
        }
        break;
      }
      case 'to-break':
        w.state = 'on-break';
        break;
      case 'leaving':
        w.state = 'off-shift';
        break;
      case 'to-absent':
        w.state = 'absent';
        break;
      case 'to-repair': {
        const req = w.repair;
        if (!req || !this.isPending(req)) {
          w.repair = null;
          this.techNext(w);
          break;
        }
        w.state = 'repairing';
        addHistory(w.history, this.f.engine.now, `Repairing ${req.name}`);
        w.repairEvent = this.f.engine.in(req.duration, 'repair.done', w.id);
        break;
      }
      case 'to-idle':
        w.state = 'idle';
        break;
      default:
        break;
    }
  }

  // --- shifts -------------------------------------------------------------------

  /** Schedule the next shift edge after `t`. */
  scheduleShiftEdges(fromT: number): void {
    const edges = new Set<number>();
    const sc = this.f.cfg.shifts;
    for (let d = -1; d <= 1; d++) {
      const base = dayStart(fromT) + d * 86400;
      for (const h of sc.startHours) {
        edges.add(base + h * HOUR);
        edges.add(base + (h + sc.lengthHours) * HOUR);
      }
    }
    const next = [...edges].filter((t) => t >= fromT - 1e-6).sort((a, b) => a - b)[0];
    this.f.engine.at(Math.max(next, this.f.engine.now), 'shift.edge');
  }

  onShiftEdge(): void {
    const now = this.f.engine.now;
    const sc = this.f.cfg.shifts;
    const hod = (((now / HOUR + 6) % 24) + 24) % 24;
    const near = (a: number, b: number) => {
      const x = (((a - b) % 24) + 24) % 24;
      return x < 1e-6 || x > 24 - 1e-6;
    };
    for (let s = 0; s < sc.startHours.length; s++) {
      if (near(hod, (sc.startHours[s] + sc.lengthHours) % 24)) this.endShift(s as ShiftIndex);
    }
    let anyStart = false;
    for (let s = 0; s < sc.startHours.length; s++) {
      if (near(hod, sc.startHours[s] % 24)) {
        this.startShift(s as ShiftIndex);
        anyStart = true;
      }
    }
    this.f.setOpen(anyStart || this.f.shiftNow() !== null);
    this.scheduleShiftEdges(now + 1);
  }

  private startShift(s: ShiftIndex): void {
    const now = this.f.engine.now;
    const sc = this.f.cfg.shifts;
    const absence = this.f.rng.stream('absence');
    const shiftWorkers = this.workers.filter((w) => w.shift === s);
    const slotted = shiftWorkers.filter((w) => w.breakSlot >= 0).length;
    const maxSlots = Math.max(1, Math.floor((sc.lengthHours - sc.firstBreakAfterHours - 0.5) * 60 / sc.breakMin));
    let extra = slotted;
    for (const w of shiftWorkers) {
      w.onShift = true;
      w.absent = false;
      w.leaveAfterRepair = false;
      w.pos = [...this.f.layout.graph.position('entrance')] as Vec2;
      // break time: slotted workers first, floaters/technicians after them
      const slot = w.breakSlot >= 0 ? w.breakSlot : extra++;
      const breakAt = now + sc.firstBreakAfterHours * HOUR + (slot % maxSlots) * sc.breakMin * 60;
      if (absence.chance(this.f.cfg.staffing.absenceProbability)) {
        w.absent = true;
        w.state = 'absent';
        addHistory(w.history, now, 'Absent for the shift');
        this.f.log.write('worker.absent', w.id, w.home ?? w.role);
        this.f.alert('info', `${w.name} (${w.role}) absent this shift`, w.id);
        if (w.home) this.requestCoverage(w.home, 'absence', w.id);
        continue;
      }
      w.presentSince = now;
      this.f.engine.at(breakAt, 'wk.break', w.id);
      if (w.home) this.walk(w, w.workNode, 'to-station');
      else this.walk(w, w.workNode, 'to-idle');
    }
    // dispatch after everyone is placed so floaters/technicians see all requests
    this.dispatchFloaters();
    this.dispatchTechs();
  }

  private endShift(s: ShiftIndex): void {
    const now = this.f.engine.now;
    for (const w of this.workers) {
      if (w.shift !== s || !w.onShift) continue;
      w.onShift = false;
      if (!w.absent && w.state !== 'off-shift') {
        w.laborSec += now - w.presentSince;
      }
      if (w.state === 'repairing') {
        w.leaveAfterRepair = true;
        continue;
      }
      this.unassign(w);
      w.coverTarget = null;
      if (w.repair) {
        // walking to a repair: give it back to the queue
        this.repairs.unshift(w.repair);
        w.repair = null;
      }
      if (w.absent || w.state === 'absent') {
        w.state = 'off-shift';
        continue;
      }
      this.walk(w, 'entrance', 'leaving');
    }
    for (let i = this.coverage.length - 1; i >= 0; i--) {
      const wk = this.byId.get(this.coverage[i].worker);
      if (wk && wk.shift === s) this.coverage.splice(i, 1);
    }
  }

  laborSeconds(now: number): number {
    let s = 0;
    for (const w of this.workers) {
      s += w.laborSec;
      if (w.onShift && !w.absent) s += now - w.presentSince;
    }
    return s;
  }

  // --- breaks ---------------------------------------------------------------------

  onBreak(w: Worker): void {
    if (!w.onShift || w.absent) return;
    const busyForklift = w.station?.startsWith('forklift-') && this.f.forklifts.vehicles[Number(w.station.split('-')[1])]?.busy;
    if (w.state === 'repairing' || w.step === 'to-repair' || busyForklift || w.state === 'walking') {
      this.f.engine.in(180, 'wk.break', w.id);
      return;
    }
    addHistory(w.history, this.f.engine.now, 'Break started');
    this.f.log.write('worker.break', w.id, w.station ?? w.role);
    const st = w.station;
    // mark the break first so a floater can't pick its own uncovered station back up
    w.state = 'on-break';
    if (w.role === 'floater' && w.coverTarget) {
      // floater on break: the covered station is uncovered again
      const target = w.coverTarget;
      w.coverTarget = null;
      this.unassign(w);
      const owner = this.workers.find((x) => x.home === target && x.onShift && (x.absent || x.state === 'on-break'));
      if (owner) this.requestCoverage(target, owner.absent ? 'absence' : 'break', owner.id);
    } else {
      this.unassign(w);
      if (st && w.home === st) this.requestCoverage(st, 'break', w.id);
    }
    w.state = 'on-break';
    this.walk(w, 'break', 'to-break');
    w.state = 'on-break';
    this.f.engine.in(this.f.cfg.shifts.breakMin * 60, 'wk.breakEnd', w.id);
  }

  onBreakEnd(w: Worker): void {
    if (!w.onShift || w.absent) return;
    addHistory(w.history, this.f.engine.now, 'Break ended');
    if (w.home) this.walk(w, w.workNode, 'to-station');
    else if (w.role === 'floater') {
      w.state = 'idle';
      this.floaterNext(w);
    } else {
      w.state = 'idle';
      this.techNext(w);
    }
  }

  // --- floaters -------------------------------------------------------------------

  requestCoverage(station: string, reason: 'break' | 'absence', worker: string): void {
    this.coverage.push({ station, reason, worker });
    this.dispatchFloaters();
  }

  private cancelCoverage(station: string, worker: string): void {
    for (let i = this.coverage.length - 1; i >= 0; i--) {
      if (this.coverage[i].station === station && this.coverage[i].worker === worker) this.coverage.splice(i, 1);
    }
  }

  private floaterFree(w: Worker): boolean {
    return w.role === 'floater' && w.onShift && !w.absent && !w.coverTarget && w.state !== 'on-break' && w.state !== 'absent';
  }

  dispatchFloaters(): void {
    for (const w of this.workers) {
      if (this.floaterFree(w)) this.floaterNext(w);
    }
  }

  private floaterNext(w: Worker): void {
    if (!this.floaterFree(w)) return;
    // absences first, then breaks, FIFO
    const order = [...this.coverage].sort((a, b) => (a.reason === b.reason ? 0 : a.reason === 'absence' ? -1 : 1));
    for (const req of order) {
      if (this.staffedCount(req.station) >= this.required(req.station)) continue;
      const covered = this.workers.some((x) => x !== w && x.coverTarget === req.station);
      if (covered) continue;
      w.coverTarget = req.station;
      addHistory(w.history, this.f.engine.now, `Covering ${req.station} (${req.reason})`);
      this.walk(w, this.stationNode(req.station), 'to-cover');
      return;
    }
    if (w.state !== 'idle' || w.step !== 'none') this.walk(w, 'break', 'to-idle');
  }

  private releaseFloater(w: Worker): void {
    this.unassign(w);
    w.coverTarget = null;
    w.state = 'idle';
    this.floaterNext(w);
  }

  stationNode(station: string): string {
    if (station.startsWith('cell-')) return `${station}-op`;
    if (station.startsWith('insp-')) return `${station}-op`;
    if (station === 'pack') return 'pack-op-0';
    if (station.startsWith('forklift-')) return this.f.layout.forkliftHome[Number(station.split('-')[1])];
    return 'control';
  }

  // --- technicians ----------------------------------------------------------------------

  requestRepair(req: RepairRequest): void {
    this.repairs.push(req);
    this.dispatchTechs();
  }

  private isPending(req: RepairRequest): boolean {
    return !this.external.has(req.id) && this.pendingIds.has(req.id);
  }

  private readonly pendingIds = new Set<string>();

  dispatchTechs(): void {
    for (const r of this.repairs) this.pendingIds.add(r.id);
    for (const w of this.workers) {
      if (w.role !== 'technician') continue;
      this.techNext(w);
    }
  }

  private techNext(w: Worker): void {
    if (w.role !== 'technician' || !w.onShift || w.absent || w.repair || w.state === 'on-break') return;
    const req = this.repairs.shift();
    if (!req) {
      if (w.state !== 'idle' && w.step !== 'to-idle' && w.step !== 'to-station') this.walk(w, 'control', 'to-idle');
      return;
    }
    w.repair = req;
    this.walk(w, req.node, 'to-repair');
  }

  onRepairDone(w: Worker): void {
    const req = w.repair!;
    w.repair = null;
    w.repairEvent = null;
    this.pendingIds.delete(req.id);
    addHistory(w.history, this.f.engine.now, `Repaired ${req.name}`);
    req.onRepaired();
    w.state = 'idle';
    if (w.leaveAfterRepair || !w.onShift) {
      w.leaveAfterRepair = false;
      this.walk(w, 'entrance', 'leaving');
      return;
    }
    this.techNext(w);
  }

  /** Recovery: contractor repairs a resource in `sec` seconds, bypassing the technician queue. */
  repairNow(resourceId: string, sec: number): boolean {
    let req = this.repairs.find((r) => r.id === resourceId) ?? null;
    if (req) this.repairs.splice(this.repairs.indexOf(req), 1);
    for (const w of this.workers) {
      if (w.repair && w.repair.id === resourceId) {
        req = w.repair;
        this.f.engine.cancel(w.repairEvent);
        w.repairEvent = null;
        w.repair = null;
        w.state = 'idle';
        this.techNext(w);
      }
    }
    if (!req) return false;
    this.pendingIds.delete(req.id);
    this.external.set(req.id, req);
    this.f.engine.in(sec, 'repair.external', req.id);
    return true;
  }

  onExternalRepair(id: string): void {
    const req = this.external.get(id);
    if (!req) return;
    this.external.delete(id);
    req.onRepaired();
  }

  // --- incidents & recovery -----------------------------------------------------------

  /** Worker leaves for `sec` seconds (absence incident). */
  makeAbsent(w: Worker, sec: number): void {
    if (!w.onShift || w.absent) return;
    addHistory(w.history, this.f.engine.now, `Called away for ${(sec / 3600).toFixed(1)} h`);
    const st = w.station;
    this.unassign(w);
    w.absent = true;
    w.laborSec += this.f.engine.now - w.presentSince;
    if (w.home && st === w.home) this.requestCoverage(w.home, 'absence', w.id);
    if (w.role === 'floater' && w.coverTarget) {
      const target = w.coverTarget;
      w.coverTarget = null;
      const owner = this.workers.find((x) => x.home === target && x.onShift && (x.absent || x.state === 'on-break'));
      if (owner) this.requestCoverage(target, 'absence', owner.id);
    }
    this.walk(w, 'entrance', 'to-absent');
    this.f.engine.in(sec, 'wk.return', w.id);
  }

  onReturn(w: Worker): void {
    if (!w.onShift || !w.absent) return;
    w.absent = false;
    w.presentSince = this.f.engine.now;
    addHistory(w.history, this.f.engine.now, 'Returned');
    if (w.home) this.walk(w, w.workNode, 'to-station');
    else if (w.role === 'floater') {
      w.state = 'idle';
      this.floaterNext(w);
    } else {
      w.state = 'idle';
      this.techNext(w);
    }
  }

  /** Move a worker to a different station for the rest of the shift. */
  reassign(w: Worker, station: string): void {
    if (!w.onShift || w.absent) return;
    if (w.role === 'technician') return;
    const prevHome = w.home;
    this.unassign(w);
    w.coverTarget = null;
    w.home = station;
    w.workNode = this.stationNode(station);
    addHistory(w.history, this.f.engine.now, `Reassigned to ${station}`);
    if (prevHome && prevHome !== station && w.role !== 'floater') this.requestCoverage(prevHome, 'absence', w.id);
    this.walk(w, w.workNode, 'to-station');
  }

  snaps(): WorkerSnap[] {
    return this.workers.map((w) => ({
      id: w.id,
      name: w.name,
      role: w.role,
      shift: w.shift,
      state: w.state,
      pos: w.pos,
      heading: w.heading,
      motion: w.motion,
      stationId: w.station ?? w.coverTarget ?? (w.repair ? w.repair.id : null),
    }));
  }
}
