import {
  MATERIAL_IDS,
  type Alert,
  type LogRecord,
  type MaterialId,
  type MetricsSample,
  type MetricsSnapshot,
  type MetricsTotals,
  type ResourceStats,
} from '../simulation/types';
import { detectBottleneck } from './bottleneck';
import type { Factory } from './factory';

export const SAMPLE_INTERVAL = 900;

/** Counters that are computed purely from the event log (also recomputed independently in tests). */
export interface LogCounters {
  ordersArrived: number;
  ordersShipped: number;
  ordersOnTime: number;
  unitsReleased: number;
  unitsAssembled: number;
  unitsInspected: number;
  unitsRejected: number;
  unitsReworked: number;
  unitsScrapped: number;
  unitsPacked: number;
  unitsShipped: number;
  cycleTimeSum: number;
  leadTimeSum: number;
  latenessSec: number;
  revenue: number;
  materialCost: number;
  otherCost: number;
}

export function emptyCounters(): LogCounters {
  return {
    ordersArrived: 0,
    ordersShipped: 0,
    ordersOnTime: 0,
    unitsReleased: 0,
    unitsAssembled: 0,
    unitsInspected: 0,
    unitsRejected: 0,
    unitsReworked: 0,
    unitsScrapped: 0,
    unitsPacked: 0,
    unitsShipped: 0,
    cycleTimeSum: 0,
    leadTimeSum: 0,
    latenessSec: 0,
    revenue: 0,
    materialCost: 0,
    otherCost: 0,
  };
}

/** Event-sourced KPIs plus state-derived costs and utilisation. */
export class Metrics {
  readonly c = emptyCounters();
  private readonly releaseT = new Map<string, number>();
  private readonly arriveT = new Map<string, number>();
  private readonly packedTimes: number[] = [];
  readonly series: MetricsSample[] = [];
  readonly alerts: Alert[] = [];

  constructor(private readonly f: Factory) {
    f.log.subscribe((r) => this.onRecord(r));
  }

  private onRecord(r: LogRecord): void {
    const c = this.c;
    switch (r.type) {
      case 'order.arrive':
        c.ordersArrived++;
        this.arriveT.set(r.id, r.t);
        break;
      case 'order.ship': {
        c.ordersShipped++;
        const late = r.v ?? 0;
        if (late <= 0) c.ordersOnTime++;
        else c.latenessSec += late;
        const a = this.arriveT.get(r.id);
        if (a !== undefined) {
          c.leadTimeSum += r.t - a;
          this.arriveT.delete(r.id);
        }
        break;
      }
      case 'unit.release':
        c.unitsReleased++;
        this.releaseT.set(r.id, r.t);
        break;
      case 'unit.assembled':
        c.unitsAssembled++;
        break;
      case 'unit.inspect-pass':
        c.unitsInspected++;
        break;
      case 'unit.inspect-reject':
        c.unitsInspected++;
        c.unitsRejected++;
        break;
      case 'unit.rework-start':
        c.unitsReworked++;
        break;
      case 'unit.scrap':
        c.unitsScrapped++;
        this.releaseT.delete(r.id);
        break;
      case 'unit.packed': {
        c.unitsPacked++;
        const t0 = this.releaseT.get(r.id);
        if (t0 !== undefined) {
          c.cycleTimeSum += r.t - t0;
          this.releaseT.delete(r.id);
        }
        this.packedTimes.push(r.t);
        break;
      }
      case 'unit.ship':
        c.unitsShipped++;
        c.revenue += r.v ?? 0;
        break;
      case 'material.consume':
        c.materialCost += (r.v ?? 0) * this.f.cfg.materials[r.id as MaterialId].unitCost;
        break;
      case 'cost':
        c.otherCost += r.v ?? 0;
        break;
      default:
        break;
    }
  }

  alert(a: Alert): void {
    this.alerts.push(a);
    if (this.alerts.length > 100) this.alerts.shift();
  }

  private packedLastHour(now: number): number {
    while (this.packedTimes.length > 0 && this.packedTimes[0] <= now - 3600) this.packedTimes.shift();
    return this.packedTimes.length;
  }

  costs(now: number) {
    const f = this.f;
    const k = f.cfg.costs;
    const openH = f.openSeconds(now) / 3600;
    const machineCost =
      openH *
      (f.cells.length * k.machineCostPerHour.assembly +
        f.inspections.length * k.machineCostPerHour.inspection +
        k.machineCostPerHour.packaging +
        k.machineCostPerHour.palletizer +
        f.conveyors.size * k.conveyorCostPerHour);
    const vehicleCost = openH * (f.agvs.vehicles.length * k.agvCostPerHour + f.forklifts.vehicles.length * k.forkliftCostPerHour);
    const laborCost = (f.workforce.laborSeconds(now) / 3600) * k.laborCostPerHour;
    const operatingCost = this.c.materialCost + machineCost + vehicleCost + laborCost + this.c.otherCost;
    return { machineCost, vehicleCost, laborCost, operatingCost };
  }

  totals(now: number): MetricsTotals {
    const c = this.c;
    const costs = this.costs(now);
    return {
      ordersArrived: c.ordersArrived,
      ordersShipped: c.ordersShipped,
      ordersOnTime: c.ordersOnTime,
      activeOrders: c.ordersArrived - c.ordersShipped,
      unitsReleased: c.unitsReleased,
      unitsAssembled: c.unitsAssembled,
      unitsInspected: c.unitsInspected,
      unitsRejected: c.unitsRejected,
      unitsReworked: c.unitsReworked,
      unitsScrapped: c.unitsScrapped,
      unitsPacked: c.unitsPacked,
      unitsShipped: c.unitsShipped,
      wip: c.unitsReleased - c.unitsPacked - c.unitsScrapped,
      avgCycleTimeSec: c.unitsPacked > 0 ? c.cycleTimeSum / c.unitsPacked : 0,
      avgOrderLeadTimeSec: c.ordersShipped > 0 ? c.leadTimeSum / c.ordersShipped : 0,
      onTimeRate: c.ordersShipped > 0 ? c.ordersOnTime / c.ordersShipped : 1,
      materialCost: c.materialCost,
      machineCost: costs.machineCost,
      laborCost: costs.laborCost,
      vehicleCost: costs.vehicleCost,
      otherCost: c.otherCost,
      operatingCost: costs.operatingCost,
      revenue: c.revenue,
      latenessHours: c.latenessSec / 3600,
    };
  }

  resources(now: number): ResourceStats[] {
    const f = this.f;
    const out: ResourceStats[] = [];
    const stageOf: Record<string, string> = { assembly: 'Assembly', inspection: 'Inspection', packaging: 'Packaging', palletizer: 'Palletizing' };
    for (const m of f.machines.values()) {
      const t = m.tracker;
      const open = t.total(now) - t.time('closed', now);
      const fr = (s: Parameters<typeof t.time>[0]) => (open > 0 ? t.time(s, now) / open : 0);
      out.push({
        id: m.id,
        name: m.name,
        kind: m.kind,
        stage: stageOf[m.kind],
        utilization: fr('running'),
        blockedFrac: fr('blocked'),
        starvedFrac: fr('starved') + fr('idle'),
        failedFrac: fr('failed') + fr('maintenance'),
        avgQueue: m.queueTracker.average(now),
        produced: m.produced,
        failures: m.failures,
      });
    }
    for (const cv of f.conveyors.values()) {
      const t = cv.tracker;
      const open = t.total(now) - t.time('closed', now);
      out.push({
        id: cv.id,
        name: cv.name,
        kind: 'conveyor',
        stage: 'Conveyors',
        utilization: open > 0 ? cv.queue.average(now) / cv.capacity : 0,
        blockedFrac: open > 0 ? t.time('stopped', now) / open : 0,
        starvedFrac: 0,
        failedFrac: open > 0 ? t.time('failed', now) / open : 0,
        avgQueue: cv.queue.average(now),
        produced: 0,
        failures: cv.failures,
      });
    }
    const openT = f.openSeconds(now);
    for (const v of [...f.agvs.vehicles, ...f.forklifts.vehicles]) {
      const t = v.tracker;
      out.push({
        id: v.id,
        name: v.name,
        kind: v.kind,
        stage: v.kind === 'agv' ? 'AGV transport' : 'Forklift',
        utilization: v.utilization(now),
        blockedFrac: openT > 0 ? t.time('queued', now) / openT : 0,
        starvedFrac: 0,
        failedFrac: openT > 0 ? t.time('failed', now) / openT : 0,
        avgQueue: 0,
        produced: v.trips,
        failures: v.failures,
      });
    }
    return out;
  }

  stageUtilization(res: ResourceStats[]): Record<string, number> {
    const acc = new Map<string, { s: number; n: number }>();
    for (const r of res) {
      const a = acc.get(r.stage) ?? { s: 0, n: 0 };
      a.s += r.utilization;
      a.n++;
      acc.set(r.stage, a);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of acc) out[k] = v.s / v.n;
    return out;
  }

  current(now: number, res?: ResourceStats[]): MetricsSample {
    const f = this.f;
    const totals = this.totals(now);
    const inv = {} as Record<MaterialId, number>;
    for (const m of MATERIAL_IDS) inv[m] = f.inventory.onHand[m];
    return {
      t: now,
      unitsPerHour: this.packedLastHour(now),
      wip: totals.wip,
      activeOrders: totals.activeOrders,
      onTimeRate: totals.onTimeRate,
      operatingCost: totals.operatingCost,
      unitsPacked: totals.unitsPacked,
      inventory: inv,
      utilization: this.stageUtilization(res ?? this.resources(now)),
    };
  }

  onSample(): void {
    const now = this.f.engine.now;
    this.series.push(this.current(now));
    if (this.series.length > 3000) this.series.shift();
  }

  snapshot(now: number): MetricsSnapshot {
    const res = this.resources(now);
    return {
      time: now,
      totals: this.totals(now),
      current: this.current(now, res),
      series: this.series.slice(-400),
      resources: res,
      bottleneck: detectBottleneck(res, { Assembly: this.f.orders.backlogTracker.average(now) }),
      alerts: this.alerts.slice(-40),
      incidents: this.f.incidents.list(),
    };
  }
}
