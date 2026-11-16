import type { IncidentInfo, InjectedEvent, InjectedKind, MaterialId } from '../simulation/types';
import { MATERIAL_IDS } from '../simulation/types';
import type { Factory } from './factory';

const num = (ev: InjectedEvent, key: string, dflt: number): number => {
  const v = ev.params?.[key];
  return typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && isFinite(Number(v)) ? Number(v) : dflt;
};
const str = (ev: InjectedEvent, key: string, dflt: string): string => {
  const v = ev.params?.[key];
  return typeof v === 'string' ? v : v !== undefined ? String(v) : dflt;
};

export const INCIDENT_LABELS: Record<InjectedKind, string> = {
  'machine-failure': 'Assembly machine failure',
  'conveyor-breakdown': 'Conveyor breakdown',
  'material-shortage': 'Raw material shortage',
  'worker-absence': 'Worker absence',
  'inspection-spike': 'Inspection failure spike',
  'order-surge': 'Sudden order surge',
  'shipping-bottleneck': 'Shipping bottleneck',
  'packaging-slowdown': 'Packaging slowdown',
  'repair-now': 'Repair now (contractor)',
  'reassign-worker': 'Reassign worker',
  reroute: 'Reroute cell work',
  'expedite-material': 'Expedite materials',
};

/** Applies injected incidents and recovery actions; keeps the incident timeline. */
export class Incidents {
  private readonly items: IncidentInfo[] = [];
  private readonly waitingRepair = new Map<string, IncidentInfo>();
  private num = 0;

  constructor(private readonly f: Factory) {
    f.log.subscribe((r) => {
      if (r.type === 'station.repair' || r.type === 'conveyor.repair') {
        const inc = this.waitingRepair.get(r.id);
        if (inc) {
          inc.end = r.t;
          this.waitingRepair.delete(r.id);
        }
      }
    });
  }

  list(): IncidentInfo[] {
    return this.items.slice(-60);
  }

  active(): IncidentInfo[] {
    return this.items.filter((i) => i.end === null || i.end > this.f.engine.now);
  }

  private add(ev: InjectedEvent, description: string, durationSec: number | null): IncidentInfo {
    const now = this.f.engine.now;
    const info: IncidentInfo = {
      id: `I${++this.num}`,
      kind: ev.kind,
      target: ev.target,
      start: now,
      end: durationSec === null ? null : now + durationSec,
      description,
    };
    this.items.push(info);
    const recovery = ['repair-now', 'reassign-worker', 'reroute', 'expedite-material'].includes(ev.kind);
    this.f.log.write(recovery ? 'recovery' : 'incident', info.id, ev.kind, durationSec ?? undefined);
    this.f.alert(recovery ? 'info' : 'warning', `${recovery ? 'Recovery' : 'Incident'}: ${description}`, ev.target);
    return info;
  }

  apply(ev: InjectedEvent): void {
    const f = this.f;
    const H = 3600;
    switch (ev.kind) {
      case 'machine-failure': {
        const id = ev.target ?? 'cell-0';
        const m = f.machines.get(id);
        if (!m) return;
        const min = num(ev, 'repairMin', 90);
        const info = this.add(ev, `${m.name} breakdown (repair ≈ ${min} min once a technician is on site)`, null);
        this.waitingRepair.set(id, info);
        m.fail(min * 60, 'injected breakdown');
        break;
      }
      case 'conveyor-breakdown': {
        const id = ev.target ?? 'C2';
        const c = f.conveyors.get(id);
        if (!c) return;
        const min = num(ev, 'repairMin', 45);
        const info = this.add(ev, `${c.name} belt failure (repair ≈ ${min} min)`, null);
        this.waitingRepair.set(id, info);
        c.fail(min * 60, 'injected breakdown');
        break;
      }
      case 'material-shortage': {
        const m = (MATERIAL_IDS.includes(ev.target as MaterialId) ? ev.target : 'PCB') as MaterialId;
        const pct = num(ev, 'quarantinePct', 80);
        const delay = num(ev, 'delayHours', 24);
        const dur = num(ev, 'durationHours', 24);
        const qty = Math.floor((f.inventory.onHand[m] * pct) / 100);
        this.add(ev, `${m}: ${qty} units quarantined (${pct}%), supplier delayed +${delay} h`, dur * H);
        f.inventory.supplierDelayHours[m] += delay;
        f.inventory.quarantine(m, qty);
        f.engine.in(dur * H, 'incident.end', `shortage:${m}`, delay);
        break;
      }
      case 'worker-absence': {
        const dur = num(ev, 'durationHours', 4);
        const target = ev.target ?? 'cell-0';
        const w =
          f.workforce.get(target) ??
          f.workforce.staffAt(target).find((x) => x.role !== 'floater') ??
          f.workforce.staffAt(target)[0];
        if (!w) {
          this.add(ev, `Worker absence at ${target}: nobody on station`, 0);
          return;
        }
        this.add(ev, `${w.name} (${w.role}) leaves ${w.station ?? ''} for ${dur} h`, dur * H);
        f.workforce.makeAbsent(w, dur * H);
        break;
      }
      case 'inspection-spike': {
        const rate = num(ev, 'rejectRate', 0.3);
        const dur = num(ev, 'durationHours', 2);
        this.add(ev, `Inspection reject rate ${Math.round(rate * 100)}% for ${dur} h`, dur * H);
        f.rejectSpike = rate;
        f.engine.in(dur * H, 'incident.end', 'spike');
        break;
      }
      case 'order-surge': {
        const n = Math.max(1, Math.round(num(ev, 'orders', 10)));
        const qty = num(ev, 'qty', 0);
        this.add(ev, `${n} rush orders arrive at once`, 0);
        for (let i = 0; i < n; i++) f.orders.create(true, undefined, qty > 0 ? qty : undefined, (str(ev, 'priority', 'high') as 'high' | 'normal' | 'low'));
        f.orders.release();
        break;
      }
      case 'shipping-bottleneck': {
        const dur = num(ev, 'durationHours', 6);
        const factor = num(ev, 'carrierDelayFactor', 3);
        const closed = Math.min(f.shipping.bays.length - 1, Math.round(num(ev, 'baysClosed', 1)));
        this.add(ev, `${closed} shipping bay(s) closed, carriers ${factor}× slower for ${dur} h`, dur * H);
        f.shipping.closedBays = closed;
        f.shipping.carrierDelayFactor = factor;
        f.engine.in(dur * H, 'incident.end', 'shipping');
        break;
      }
      case 'packaging-slowdown': {
        const factor = num(ev, 'factor', 0.5);
        const dur = num(ev, 'durationHours', 3);
        this.add(ev, `Packaging runs at ${Math.round(factor * 100)}% speed for ${dur} h`, dur * H);
        f.packaging.incidentSpeed = factor;
        f.engine.in(dur * H, 'incident.end', 'packaging');
        break;
      }
      case 'repair-now': {
        const id = ev.target ?? '';
        const min = num(ev, 'minutes', 5);
        if (f.workforce.repairNow(id, min * 60)) {
          this.add(ev, `Contractor repairs ${id} in ${min} min (fee $${f.cfg.costs.expediteFee})`, min * 60);
          f.log.write('cost', 'expedite-repair', id, f.cfg.costs.expediteFee);
        } else {
          this.add(ev, `Repair now: ${id} is not waiting for repair`, 0);
        }
        break;
      }
      case 'reassign-worker': {
        const w = f.workforce.get(ev.target ?? '');
        const station = str(ev, 'station', 'cell-0');
        if (!w) return;
        this.add(ev, `${w.name} reassigned to ${station}`, 0);
        f.workforce.reassign(w, station);
        break;
      }
      case 'reroute': {
        const id = ev.target ?? 'cell-0';
        const cell = f.cells.find((c) => c.id === id);
        if (!cell) return;
        const dur = num(ev, 'durationHours', 2);
        const moved = f.reroute(cell);
        this.add(ev, `${cell.name}: ${moved} queued unit(s) rerouted to other cells for ${dur} h`, dur * H);
        f.engine.in(dur * H, 'incident.end', `reroute:${cell.index}`);
        break;
      }
      case 'expedite-material': {
        const m = (MATERIAL_IDS.includes(ev.target as MaterialId) ? ev.target : 'PCB') as MaterialId;
        const qty = Math.round(num(ev, 'qty', f.cfg.materials[m].orderQty));
        this.add(ev, `Expedited ${qty} ${m} (2 h lead time, fee $${f.cfg.costs.expediteFee})`, 2 * H);
        f.inventory.placeOrder(m, qty, true);
        f.log.write('cost', 'expedite-material', m, f.cfg.costs.expediteFee);
        break;
      }
    }
  }

  onEnd(key: string, n: number): void {
    const f = this.f;
    if (key.startsWith('shortage:')) {
      const m = key.split(':')[1] as MaterialId;
      f.inventory.supplierDelayHours[m] = Math.max(0, f.inventory.supplierDelayHours[m] - n);
    } else if (key === 'spike') f.rejectSpike = null;
    else if (key === 'shipping') {
      f.shipping.closedBays = 0;
      f.shipping.carrierDelayFactor = 1;
      f.shipping.dock();
    } else if (key === 'packaging') f.packaging.incidentSpeed = 1;
    else if (key.startsWith('reroute:')) {
      const cell = f.cells[Number(key.split(':')[1])];
      if (cell) {
        cell.rerouted = false;
        f.orders.release();
      }
    }
  }
}
