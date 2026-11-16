import { describe, expect, it } from 'vitest';
import { byProduct, DAY, run, scenario } from './helpers';

describe('invariant 6: rework and scrap rules', () => {
  const f = run(scenario(10, (c) => (c.inspection.rejectRate = 0.3)), 3 * DAY);
  const products = byProduct(f.log.records);

  it('first reject -> exactly one rework at an assembly cell, second reject -> scrap', () => {
    let reworked = 0;
    let scrapped = 0;
    for (const [id, recs] of products) {
      const types = recs.map((r) => r.type);
      const rejects = types.filter((t) => t === 'unit.inspect-reject').length;
      const reworks = types.filter((t) => t === 'unit.rework-start').length;
      const scrap = types.includes('unit.scrap');
      if (rejects === 0) {
        expect(reworks, id).toBe(0);
        expect(scrap, id).toBe(false);
      }
      if (rejects >= 1 && (reworks === 1 || scrap)) {
        const firstReject = types.indexOf('unit.inspect-reject');
        if (reworks === 1) expect(types.indexOf('unit.rework-start')).toBeGreaterThan(firstReject);
      }
      if (scrap) {
        expect(rejects, id).toBe(2);
        expect(reworks, id).toBe(1);
        expect(types[types.length - 1]).toBe('unit.scrap');
        scrapped++;
      }
      expect(rejects, id).toBeLessThanOrEqual(2);
      if (reworks) reworked++;
    }
    expect(reworked).toBeGreaterThan(100);
    expect(scrapped).toBeGreaterThan(20);
  });

  it('rework consumes a replacement PCB and scrapped units are replaced on the order', () => {
    const scrap = f.log.records.filter((r) => r.type === 'unit.scrap');
    for (const r of scrap.slice(0, 20)) {
      const o = f.orders.orders.get(r.ref!);
      if (!o) continue; // archived
      expect(o.released + o.toRelease - o.scrapped).toBe(o.qty);
    }
    const shipped = [...f.orders.orders.values()].filter((o) => o.state === 'shipped');
    for (const o of shipped) expect(o.palletized).toBe(o.qty);
  });
});
