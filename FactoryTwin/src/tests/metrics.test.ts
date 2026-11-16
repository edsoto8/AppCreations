import { describe, expect, it } from 'vitest';
import type { LogRecord, MaterialId } from '../simulation/types';
import { DAY, run, scenario } from './helpers';
import { defaultConfig } from '../scenarios/default';

/** Independent recomputation of dashboard metrics from the raw event log. */
function recompute(records: LogRecord[]) {
  const cfg = defaultConfig();
  const arrive = new Map<string, number>();
  const release = new Map<string, number>();
  const o = { arrived: 0, shipped: 0, onTime: 0, released: 0, packed: 0, rejected: 0, scrapped: 0, unitsShipped: 0, revenue: 0, material: 0, cycle: 0, lead: 0 };
  for (const r of records) {
    if (r.type === 'order.arrive') {
      o.arrived++;
      arrive.set(r.id, r.t);
    } else if (r.type === 'order.ship') {
      o.shipped++;
      if ((r.v ?? 0) <= 0) o.onTime++;
      o.lead += r.t - arrive.get(r.id)!;
    } else if (r.type === 'unit.release') {
      o.released++;
      release.set(r.id, r.t);
    } else if (r.type === 'unit.packed') {
      o.packed++;
      o.cycle += r.t - release.get(r.id)!;
    } else if (r.type === 'unit.inspect-reject') o.rejected++;
    else if (r.type === 'unit.scrap') o.scrapped++;
    else if (r.type === 'unit.ship') {
      o.unitsShipped++;
      o.revenue += r.v!;
    } else if (r.type === 'material.consume') o.material += r.v! * cfg.materials[r.id as MaterialId].unitCost;
  }
  return o;
}

describe('invariant 9: dashboard metrics equal values recomputed from the event log', () => {
  const f = run(scenario(21), 3 * DAY);
  const m = f.metrics.snapshot(f.engine.now).totals;
  const x = recompute(f.log.records);

  it('counts', () => {
    expect(m.ordersArrived).toBe(x.arrived);
    expect(m.ordersShipped).toBe(x.shipped);
    expect(m.ordersOnTime).toBe(x.onTime);
    expect(m.unitsReleased).toBe(x.released);
    expect(m.unitsPacked).toBe(x.packed);
    expect(m.unitsRejected).toBe(x.rejected);
    expect(m.unitsScrapped).toBe(x.scrapped);
    expect(m.unitsShipped).toBe(x.unitsShipped);
    expect(m.activeOrders).toBe(x.arrived - x.shipped);
    expect(m.wip).toBe(x.released - x.packed - x.scrapped);
  });

  it('money and times', () => {
    expect(m.revenue).toBeCloseTo(x.revenue, 6);
    expect(m.materialCost).toBeCloseTo(x.material, 6);
    expect(m.avgCycleTimeSec).toBeCloseTo(x.cycle / x.packed, 6);
    expect(m.avgOrderLeadTimeSec).toBeCloseTo(x.lead / x.shipped, 6);
    expect(m.onTimeRate).toBeCloseTo(x.onTime / x.shipped, 9);
  });

  it('live state agrees with the log (WIP equals units in production)', () => {
    let inProduction = 0;
    for (const p of f.products.values()) if (!['palletizing', 'finished', 'shipped'].includes(p.stage) && p.location.kind !== 'pallet') inProduction++;
    // packed units on C3 / in the palletizer are past "packed" but not yet on a pallet
    const packedNotPalletized = f.c3.items.length + (f.palletizer.job?.product ? 1 : 0) + (f.packaging.blocked ? 1 : 0);
    expect(inProduction - packedNotPalletized).toBe(m.wip);
  });

  it('time series is sampled on sim time every 15 minutes', () => {
    const s = f.metrics.series;
    expect(s.length).toBe(Math.floor(f.engine.now / 900));
    for (let i = 1; i < s.length; i++) expect(s[i].t - s[i - 1].t).toBe(900);
  });
});
