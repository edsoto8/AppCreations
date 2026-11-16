import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../production/invariants';
import { Factory } from '../production/factory';
import { DAY, H, scenario } from './helpers';

describe('invariant 2: a machine never processes more than its capacity', () => {
  const f = new Factory(scenario(4), { keepLog: true });
  const violations: string[] = [];
  for (let t = 0.25 * H; t <= 2 * DAY; t += 0.25 * H) {
    f.engine.advanceTo(t);
    violations.push(...checkInvariants(f));
  }

  it('structural invariants hold every 15 minutes', () => {
    expect(violations).toEqual([]);
  });

  it('start/finish events alternate per station (never two jobs at once)', () => {
    const open = new Map<string, string | null>();
    const starts = new Set(['unit.assembly-start', 'unit.rework-start', 'unit.inspect-start', 'unit.pack-start']);
    const ends = new Set(['unit.assembled', 'unit.inspect-pass', 'unit.inspect-reject', 'unit.packed']);
    let n = 0;
    for (const r of f.log.records) {
      if (starts.has(r.type)) {
        const st = r.ref!;
        expect(open.get(st) ?? null, `${st} started ${r.id} while busy`).toBeNull();
        open.set(st, r.id);
        n++;
      } else if (ends.has(r.type)) {
        const st = r.ref!;
        expect(open.get(st), `${st} finished ${r.id}`).toBe(r.id);
        open.set(st, null);
      }
    }
    expect(n).toBeGreaterThan(3000);
  });
});
