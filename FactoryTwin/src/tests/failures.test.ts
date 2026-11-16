import { describe, expect, it } from 'vitest';
import { DAY, H, run, scenario } from './helpers';
import type { FactoryConfig, LogRecord } from '../simulation/types';

function downIntervals(recs: LogRecord[], id: string): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (const r of recs) {
    if (r.id !== id) continue;
    if (r.type === 'station.fail') start = r.t;
    if (r.type === 'station.repair' && start !== null) {
      out.push([start, r.t]);
      start = null;
    }
  }
  if (start !== null) out.push([start, Infinity]);
  return out;
}

describe('invariant 3: a failed machine produces nothing while down', () => {
  it('injected assembly failure: no output from the cell until repaired, repair takes at least the given time', () => {
    const f = run(scenario(2, undefined, [{ at: 2 * H, kind: 'machine-failure', target: 'cell-1', params: { repairMin: 120 } }]), 8 * H);
    const down = downIntervals(f.log.records, 'cell-1');
    expect(down.length).toBeGreaterThanOrEqual(1);
    const [s, e] = down[0];
    expect(s).toBe(2 * H);
    expect(e - s).toBeGreaterThanOrEqual(120 * 60);
    const during = f.log.records.filter((r) => r.type === 'unit.assembled' && r.ref === 'cell-1' && r.t > s && r.t < e);
    expect(during).toEqual([]);
    const after = f.log.records.filter((r) => r.type === 'unit.assembled' && r.ref === 'cell-1' && r.t > e);
    expect(after.length).toBeGreaterThan(0);
  });

  it('random failures over 5 days: no completions inside any down interval of any station', () => {
    const f = run(scenario(9, (c) => {
      c.assembly.failure.mtbfHours = 6;
      c.inspection.failure.mtbfHours = 8;
      c.packaging.failure.mtbfHours = 8;
    }), 5 * DAY);
    const finishes: Record<string, string[]> = {
      cell: ['unit.assembled'],
      insp: ['unit.inspect-pass', 'unit.inspect-reject'],
      pack: ['unit.packed'],
    };
    let failures = 0;
    for (const id of ['cell-0', 'cell-1', 'cell-2', 'insp-0', 'insp-1', 'pack']) {
      const iv = downIntervals(f.log.records, id);
      failures += iv.length;
      const types = finishes[id.split('-')[0]];
      for (const [s, e] of iv) {
        const bad = f.log.records.filter((r) => types.includes(r.type) && r.ref === id && r.t > s && r.t < e);
        expect(bad, `${id} produced while down ${s}-${e}`).toEqual([]);
      }
    }
    expect(failures).toBeGreaterThan(10);
  });

  it('a failed assembly cell grows its upstream queue and reduces output', () => {
    const busy = (c: FactoryConfig) => (c.orders.arrivalsPerDay = 60);
    const base = run(scenario(2, busy), 10 * H, false);
    const failed = run(scenario(2, busy, [{ at: 1 * H, kind: 'machine-failure', target: 'cell-0', params: { repairMin: 360 } }]), 10 * H, false);
    expect(failed.metrics.c.unitsPacked).toBeLessThan(base.metrics.c.unitsPacked * 0.9);
    expect(failed.orders.backlogUnits).toBeGreaterThan(base.orders.backlogUnits);
  });
});
