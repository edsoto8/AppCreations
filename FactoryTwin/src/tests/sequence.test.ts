import { describe, expect, it } from 'vitest';
import { byProduct, DAY, run, scenario } from './helpers';

// Allowed transitions of the per-product event sequence.
const NEXT: Record<string, string[]> = {
  start: ['unit.release'],
  'unit.release': ['unit.kitted'],
  'unit.kitted': ['unit.assembly-start'],
  'unit.assembly-start': ['unit.assembled'],
  'unit.rework-start': ['unit.assembled'],
  'unit.assembled': ['unit.inspect-start'],
  'unit.inspect-start': ['unit.inspect-pass', 'unit.inspect-reject'],
  'unit.inspect-reject': ['unit.rework-start', 'unit.scrap'],
  'unit.inspect-pass': ['unit.pack-start'],
  'unit.pack-start': ['unit.packed'],
  'unit.packed': ['unit.palletized'],
  'unit.palletized': ['unit.ship'],
  'unit.ship': [],
  'unit.scrap': [],
};

describe('invariant 1: products follow the station sequence', () => {
  const f = run(scenario(3, (c) => (c.inspection.rejectRate = 0.15)), 2 * DAY);
  const products = byProduct(f.log.records);

  it('has a meaningful sample', () => {
    expect(products.size).toBeGreaterThan(1500);
  });

  it('every product history is a valid path through the process', () => {
    let shipped = 0;
    for (const [id, recs] of products) {
      let state = 'start';
      for (const r of recs) {
        expect(NEXT[state], `${id}: ${state} -> ${r.type}`).toContain(r.type);
        if (r.type === 'unit.assembly-start' || r.type === 'unit.rework-start') expect(r.ref).toMatch(/^cell-/);
        if (r.type === 'unit.inspect-start') expect(r.ref).toMatch(/^insp-/);
        if (r.type === 'unit.pack-start') expect(r.ref).toBe('pack');
        state = r.type;
      }
      if (state === 'unit.ship') shipped++;
    }
    expect(shipped).toBeGreaterThan(1000);
  });

  it('rework happens at most once and only after a reject', () => {
    for (const [id, recs] of products) {
      const reworks = recs.filter((r) => r.type === 'unit.rework-start').length;
      expect(reworks, id).toBeLessThanOrEqual(1);
    }
  });
});
