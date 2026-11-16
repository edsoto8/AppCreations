import { describe, expect, it } from 'vitest';
import { Factory } from '../production/factory';
import { H, scenario } from './helpers';

function findBad(v: unknown, path: string, out: string[]): void {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) && !(path.endsWith('.end') && v === null)) out.push(`${path}=${v}`);
  } else if (Array.isArray(v)) v.forEach((x, i) => findBad(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) findBad(x, `${path}.${k}`, out);
}

describe('snapshots', () => {
  it('never contain NaN or Infinity (sampled over 30 hours, with incidents)', () => {
    const f = new Factory(
      scenario(13, undefined, [
        { at: 2 * H, kind: 'machine-failure', target: 'cell-0', params: { repairMin: 60 } },
        { at: 3 * H, kind: 'conveyor-breakdown', target: 'C2', params: { repairMin: 30 } },
      ]),
    );
    const bad: string[] = [];
    for (let t = 600; t <= 30 * H; t += 600) {
      f.engine.advanceTo(t);
      findBad(f.snapshot(), 'snap', bad);
      if (t % (3 * H) === 0) findBad(f.metrics.snapshot(f.engine.now), 'metrics', bad);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('motion segments are well formed', () => {
    const f = new Factory(scenario(14));
    for (let t = 300; t <= 4 * H; t += 300) {
      f.engine.advanceTo(t);
      const s = f.snapshot();
      for (const m of [...s.vehicles.map((v) => v.motion), ...s.workers.map((w) => w.motion)]) {
        if (!m) continue;
        expect(m.t1).toBeGreaterThanOrEqual(m.t0);
        expect(m.points.length).toBeGreaterThan(0);
        expect(m.d1).toBeGreaterThanOrEqual(m.d0);
      }
    }
  });
});
