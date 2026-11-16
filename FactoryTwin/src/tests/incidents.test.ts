import { describe, expect, it } from 'vitest';
import type { InjectedEvent } from '../simulation/types';
import { Factory } from '../production/factory';
import { H, scenario } from './helpers';

function run(events: InjectedEvent[], hours = 14, busy = false) {
  const f = new Factory(scenario(5, busy ? (c) => (c.orders.arrivalsPerDay = 45) : undefined, events), { keepLog: true });
  f.engine.advanceTo(hours * H);
  return f;
}

describe('incidents visibly change behaviour', () => {
  const base = run([]);
  const busyBase = run([], 14, true);

  it('assembly machine failure: upstream queue grows, output drops', () => {
    const f = run([{ at: 2 * H, kind: 'machine-failure', target: 'cell-0', params: { repairMin: 300 } }], 14, true);
    expect(f.metrics.c.unitsPacked).toBeLessThan(busyBase.metrics.c.unitsPacked);
    expect(f.orders.backlogUnits).toBeGreaterThan(busyBase.orders.backlogUnits);
  });

  it('conveyor breakdown blocks upstream stations', () => {
    const f = new Factory(scenario(5, undefined, [{ at: 2 * H, kind: 'conveyor-breakdown', target: 'C2', params: { repairMin: 90 } }]));
    f.engine.advanceTo(2 * H + 50 * 60);
    expect(f.conveyors.get('C2')!.failed).toBe(true);
    expect(f.inspections.some((s) => s.state === 'blocked')).toBe(true);
    expect(f.packaging.state).not.toBe('running');
  });

  it('material shortage starves production', () => {
    const f = run([{ at: 1 * H, kind: 'material-shortage', target: 'PCB', params: { quarantinePct: 100, delayHours: 24 } }]);
    expect(f.log.records.some((r) => r.type === 'material.stockout' && r.id === 'PCB')).toBe(true);
    expect(f.metrics.c.unitsPacked).toBeLessThan(base.metrics.c.unitsPacked * 0.7);
  });

  it('worker absence leaves a station uncovered or covered by the floater', () => {
    const f = new Factory(scenario(5, undefined, [{ at: 1 * H, kind: 'worker-absence', target: 'pack', params: { durationHours: 3 } }]));
    f.engine.advanceTo(1 * H + 120);
    const absent = f.workforce.workers.filter((w) => w.absent && w.onShift);
    expect(absent.length).toBeGreaterThanOrEqual(1);
    f.engine.advanceTo(1.5 * H);
    const floater = f.workforce.workers.find((w) => w.role === 'floater' && w.onShift)!;
    expect(floater.coverTarget === 'pack' || f.workforce.staffedCount('pack') < 2).toBe(true);
  });

  it('inspection failure spike raises rejects and rework', () => {
    const f = run([{ at: 1 * H, kind: 'inspection-spike', params: { rejectRate: 0.4, durationHours: 3 } }]);
    expect(f.metrics.c.unitsRejected).toBeGreaterThan(base.metrics.c.unitsRejected * 3);
    expect(f.metrics.c.unitsReworked).toBeGreaterThan(base.metrics.c.unitsReworked);
  });

  it('order surge raises backlog and active orders', () => {
    const f = run([{ at: 1 * H, kind: 'order-surge', params: { orders: 12 } }]);
    expect(f.metrics.c.ordersArrived).toBe(base.metrics.c.ordersArrived + 12);
    expect(f.orders.backlogUnits).toBeGreaterThan(base.orders.backlogUnits);
  });

  it('shipping bottleneck delays shipments', () => {
    const f = run([{ at: 0.5 * H, kind: 'shipping-bottleneck', params: { durationHours: 12, carrierDelayFactor: 4, baysClosed: 1 } }]);
    expect(f.metrics.c.unitsShipped).toBeLessThan(base.metrics.c.unitsShipped);
  });

  it('packaging slowdown lowers packaging throughput during the window and blocks upstream', () => {
    const packedIn = (f: Factory, a: number, b: number) => f.log.records.filter((r) => r.type === 'unit.packed' && r.t >= a && r.t < b).length;
    const f = run([{ at: 1 * H, kind: 'packaging-slowdown', params: { factor: 0.4, durationHours: 6 } }], 14, true);
    expect(packedIn(f, 2 * H, 7 * H)).toBeLessThan(packedIn(busyBase, 2 * H, 7 * H) * 0.7);
    expect(f.cells.reduce((s, c) => s + c.tracker.time('blocked', f.engine.now), 0)).toBeGreaterThan(
      busyBase.cells.reduce((s, c) => s + c.tracker.time('blocked', busyBase.engine.now), 0) + 1800,
    );
  });

  it('recovery: repair-now shortens the outage and charges a fee', () => {
    const slow = run([{ at: 2 * H, kind: 'machine-failure', target: 'cell-0', params: { repairMin: 300 } }]);
    const fast = run([
      { at: 2 * H, kind: 'machine-failure', target: 'cell-0', params: { repairMin: 300 } },
      { at: 2.2 * H, kind: 'repair-now', target: 'cell-0', params: { minutes: 5 } },
    ]);
    const repairAt = (f: Factory) => f.log.records.find((r) => r.type === 'station.repair' && r.id === 'cell-0')!.t;
    expect(repairAt(fast)).toBeLessThan(repairAt(slow));
    expect(fast.metrics.c.otherCost).toBe(fast.cfg.costs.expediteFee);
  });

  it('recovery: reroute moves queued work off a failed cell; expedite brings material in 2 h', () => {
    const f = new Factory(scenario(5, (c) => (c.orders.arrivalsPerDay = 45), [
      { at: 2 * H, kind: 'machine-failure', target: 'cell-0', params: { repairMin: 300 } },
      { at: 2 * H + 1, kind: 'reroute', target: 'cell-0', params: { durationHours: 2 } },
      { at: 3 * H, kind: 'expedite-material', target: 'BATTERY', params: { qty: 500 } },
    ]));
    f.engine.advanceTo(2 * H + 2);
    expect(f.cells[0].kitRequests.length).toBe(0);
    expect(f.cells[0].rerouted).toBe(true);
    f.engine.advanceTo(6 * H);
    expect(f.inventory.received.BATTERY).toBeGreaterThanOrEqual(500);
  });

  it('recovery: reassigning a worker staffs the target station', () => {
    const f = new Factory(scenario(5));
    f.engine.advanceTo(1 * H);
    const inspector = f.workforce.workers.find((w) => w.role === 'inspector' && w.onShift && !w.absent)!;
    f.inject({ at: f.engine.now, kind: 'reassign-worker', target: inspector.id, params: { station: 'pack' } });
    f.engine.advanceTo(1.2 * H);
    expect(f.workforce.staffAt('pack').includes(inspector)).toBe(true);
  });
});
