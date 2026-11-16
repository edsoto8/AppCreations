import { describe, expect, it } from 'vitest';
import { DAY, H, run, scenario } from './helpers';

describe('workforce: breaks, floater coverage, technicians', () => {
  const f = run(scenario(23), 5 * DAY);
  const now = f.engine.now;

  it('the floater covers breaks: stations are almost never unstaffed during open hours', () => {
    for (const m of f.machines.values()) {
      if (m.staffRequired === 0) continue;
      const open = m.tracker.total(now) - m.tracker.time('closed', now);
      const unstaffed = m.tracker.time('unstaffed', now) / open;
      expect(unstaffed, m.id).toBeLessThan(0.03);
    }
  });

  it('every on-shift worker takes one break per shift', () => {
    const breaks = f.log.records.filter((r) => r.type === 'worker.break');
    const absent = f.log.records.filter((r) => r.type === 'worker.absent').length;
    const shifts = 5 * 2;
    const perShift = f.workforce.workers.length / 2;
    expect(breaks.length).toBeGreaterThanOrEqual(shifts * perShift - absent - 2);
  });

  it('the floater is never stranded with a stale cover target after its break', () => {
    const g = run(scenario(23, (c) => (c.staffing.absenceProbability = 0), [{ at: 1 * H, kind: 'worker-absence', target: 'cell-1', params: { durationHours: 6.9 } }]), 9 * H);
    const cell = g.machines.get('cell-1')!;
    // the floater covers cell-1 (absence beats breaks); during its own 30-min break cell-1 is
    // uncovered, and afterwards it must return to cell-1 instead of idling with a stale target
    const unstaffed = cell.tracker.time('unstaffed', g.engine.now);
    expect(unstaffed).toBeLessThan(0.75 * H);
    const floater = g.workforce.workers.find((w) => w.role === 'floater' && w.shift === 0)!;
    expect(floater.history.some((h) => h.t > 6.9 * H && h.text === 'Working at cell-1')).toBe(true);
  });

  it('technicians repair failures during shifts', () => {
    const fails = f.log.records.filter((r) => r.type === 'station.fail' || r.type === 'conveyor.fail');
    const repairs = f.log.records.filter((r) => r.type === 'station.repair' || r.type === 'conveyor.repair');
    expect(fails.length).toBeGreaterThan(0);
    expect(repairs.length).toBeGreaterThanOrEqual(fails.length - 2);
  });

  it('operating cost components are positive and add up', () => {
    const t = f.metrics.totals(now);
    expect(t.laborCost).toBeGreaterThan(0);
    expect(t.machineCost).toBeGreaterThan(0);
    expect(t.vehicleCost).toBeGreaterThan(0);
    expect(t.operatingCost).toBeCloseTo(t.materialCost + t.machineCost + t.vehicleCost + t.laborCost + t.otherCost, 6);
    // machine cost = open hours x hourly rates (5 days x 16 h)
    const k = f.cfg.costs;
    const rates = 3 * k.machineCostPerHour.assembly + 2 * k.machineCostPerHour.inspection + k.machineCostPerHour.packaging + k.machineCostPerHour.palletizer + 5 * k.conveyorCostPerHour;
    expect(t.machineCost).toBeCloseTo((f.openSeconds(now) / 3600) * rates, 6);
    expect(f.openSeconds(now)).toBeCloseTo(5 * 16 * H, 0);
  });
});
