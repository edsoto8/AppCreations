import { describe, expect, it } from 'vitest';
import { Factory } from '../production/factory';
import { exportScenario, importScenario } from '../scenarios/io';
import { presets } from '../scenarios/presets';
import { DAY, H, scenario } from './helpers';

describe('scenario replay', () => {
  it('JSON export/import round-trips', () => {
    const s = scenario(77, undefined, [{ at: 3 * H, kind: 'order-surge', params: { orders: 4 } }]);
    const back = importScenario(exportScenario(s));
    expect(back).toEqual(s);
  });

  it('live interventions are recorded and the exported scenario replays to the identical log', () => {
    const live = new Factory(scenario(31), { keepLog: true });
    // simulate a user clicking at arbitrary render times during playback
    live.engine.advanceTo(2.3 * H);
    live.inject({ at: 2.3 * H + 12.5, kind: 'machine-failure', target: 'cell-2', params: { repairMin: 50 } });
    live.engine.advanceTo(4 * H);
    live.inject({ at: live.engine.now, kind: 'inspection-spike', params: { rejectRate: 0.4, durationHours: 1 } });
    live.engine.advanceTo(5.5 * H);
    const failed = live.machines.get('cell-2')!;
    if (failed.failed) live.inject({ at: live.engine.now, kind: 'repair-now', target: 'cell-2', params: { minutes: 5 } });
    live.inject({ at: 6 * H, kind: 'order-surge', params: { orders: 5 } });
    live.engine.advanceTo(DAY);

    const exported = exportScenario(live.scenario);
    const replay = new Factory(importScenario(exported), { keepLog: true });
    replay.engine.advanceTo(DAY);
    expect(replay.scenario.injectedEvents.length).toBeGreaterThanOrEqual(3);
    expect(replay.log.digest()).toBe(live.log.digest());
    expect(replay.log.records).toEqual(live.log.records);
  });

  it('import fills missing config fields from defaults and rejects bad input', () => {
    const s = importScenario(JSON.stringify({ seed: 5, config: { assembly: { cells: 4 } } }));
    expect(s.config.assembly.cells).toBe(4);
    expect(s.config.inspection.stations).toBe(2);
    expect(() => importScenario('{"config":{}}')).toThrow();
  });

  it('the three one-click presets load and run', () => {
    for (const p of presets()) {
      const f = new Factory(p.scenario);
      f.engine.advanceTo(6 * H);
      expect(f.metrics.c.unitsPacked).toBeGreaterThan(0);
    }
  });
});
