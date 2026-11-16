import { describe, expect, it } from 'vitest';
import { Factory } from '../production/factory';
import { DAY, H, scenario } from './helpers';
import type { InjectedEvent } from '../simulation/types';

function hashWithSteps(seed: number, horizon: number, step: number): string {
  const f = new Factory(scenario(seed));
  for (let t = step; t < horizon; t += step) f.engine.advanceTo(t);
  f.engine.advanceTo(horizon);
  return f.log.digest();
}

describe('determinism', () => {
  it('same seed and config give an identical event log (hash and records)', () => {
    const a = new Factory(scenario(11), { keepLog: true });
    const b = new Factory(scenario(11), { keepLog: true });
    a.engine.advanceTo(DAY);
    b.engine.advanceTo(DAY);
    expect(a.log.count).toBeGreaterThan(5000);
    expect(a.log.digest()).toBe(b.log.digest());
    expect(a.log.records).toEqual(b.log.records);
  });

  it('a different seed gives a different result', () => {
    const a = new Factory(scenario(11));
    const b = new Factory(scenario(12));
    a.engine.advanceTo(DAY);
    b.engine.advanceTo(DAY);
    expect(a.log.digest()).not.toBe(b.log.digest());
  });

  it('playback speed does not change outcomes (1x, 10x frame steps and one jump)', () => {
    const horizon = 3 * H;
    const frame = 1 / 60;
    const oneX = hashWithSteps(5, horizon, frame * 1);
    const tenX = hashWithSteps(5, horizon, frame * 10);
    const jump = hashWithSteps(5, horizon, horizon);
    expect(tenX).toBe(oneX);
    expect(jump).toBe(oneX);
  });

  it('capped advancing (max events per frame) does not change outcomes', () => {
    const a = new Factory(scenario(8));
    const b = new Factory(scenario(8));
    a.engine.advanceTo(6 * H);
    while (b.engine.advanceTo(6 * H, 7).complete === false) {
      /* keep stepping */
    }
    expect(b.log.digest()).toBe(a.log.digest());
  });
});

describe('determinism through the host API (invariant 7, extended)', () => {
  it('30 h of playback-like stepping with reads and injected events matches a single jump', async () => {
    const { LocalSimHost } = await import('../simulation/host');
    const events: InjectedEvent[] = [
      { at: 2 * H + 13, kind: 'machine-failure', target: 'cell-0', params: { repairMin: 70 } },
      { at: 9 * H, kind: 'inspection-spike', params: { rejectRate: 0.3, durationHours: 2 } },
      { at: 10 * H, kind: 'packaging-slowdown', params: { factor: 0.6, durationHours: 1 } },
      { at: 15 * H, kind: 'order-surge', params: { orders: 6 } },
    ];
    const s = scenario(17, (c) => (c.assembly.failure.mtbfHours = 10), events);
    const a = new LocalSimHost();
    await a.load(s);
    for (let t = 7.3; t < 30 * H; t += 7.3) {
      a.advanceTo(t, 37);
      void a.snapshot;
      void a.metrics;
    }
    a.advanceTo(30 * H);
    const b = new LocalSimHost();
    await b.load(s);
    b.advanceTo(30 * H);
    expect(await a.getLogHash()).toBe(await b.getLogHash());
  });
});
