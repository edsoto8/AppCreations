import { describe, expect, it } from 'vitest';
import { planDispense, type DispenseLimits } from '../../src/cash/dispense';
import { denomCents, type CassetteState, type DispenseStrategy } from '../../src/core/types';

const LIMITS: DispenseLimits = { minCents: 2_000, maxCents: 80_000, multipleCents: 1_000, maxNotes: 40 };
const STRATEGIES: DispenseStrategy[] = ['min-notes', 'balanced', 'small-notes'];

function cassettes(a = 2000, b = 1000, c = 500): CassetteState[] {
  return [
    { id: 'A', denom: 20, capacity: 2500, counter: a, installed: true, status: 'OK', lowThreshold: 200 },
    { id: 'B', denom: 50, capacity: 2000, counter: b, installed: true, status: 'OK', lowThreshold: 100 },
    { id: 'C', denom: 100, capacity: 2000, counter: c, installed: true, status: 'OK', lowThreshold: 50 },
  ];
}

const sum = (r: ReturnType<typeof planDispense>) => (r.ok ? r.plan.picks.reduce((s, p) => s + p.count * denomCents(p.denom), 0) : -1);

describe('planDispense', () => {
  it('plans exact amounts with fewest notes', () => {
    const r = planDispense(6_000, cassettes(), 'min-notes', LIMITS);
    expect(r.ok && r.plan.picks).toEqual([{ cassette: 'A', denom: 20, count: 3 }]);
    const r2 = planDispense(37_000, cassettes(), 'min-notes', LIMITS);
    expect(r2.ok).toBe(true);
    expect(sum(r2)).toBe(37_000);
    expect(r2.ok && r2.plan.totalNotes).toBe(5); // 3×$100 + 1×$50 + 1×$20
  });

  it('$30 is infeasible with $20/$50/$100', () => {
    const r = planDispense(3_000, cassettes(), 'min-notes', LIMITS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('NO_FEASIBLE_COMBINATION');
  });

  it('rejects unsupported amounts', () => {
    for (const amt of [0, -2_000, 1_000, 3_500, 80_010, 90_000, 2_050]) {
      const r = planDispense(amt, cassettes(), 'min-notes', LIMITS);
      expect(!r.ok && r.reason).toBe('UNSUPPORTED_AMOUNT');
    }
  });

  it('detects insufficient ATM cash', () => {
    const r = planDispense(20_000, cassettes(2, 1, 0), 'min-notes', LIMITS);
    expect(!r.ok && r.reason).toBe('INSUFFICIENT_ATM_CASH');
  });

  it('ignores faulted and removed cassettes', () => {
    const cs = cassettes();
    cs[2].status = 'FAULT';
    cs[1].installed = false;
    const r = planDispense(10_000, cs, 'min-notes', LIMITS);
    expect(r.ok && r.plan.picks).toEqual([{ cassette: 'A', denom: 20, count: 5 }]);
  });

  it('respects the note limit (TOO_MANY_NOTES)', () => {
    // Only $20 notes: $800 needs 40 notes (OK), but with max 30 → too many.
    const r = planDispense(80_000, cassettes(2000, 0, 0), 'min-notes', { ...LIMITS, maxNotes: 30 });
    expect(!r.ok && r.reason).toBe('TOO_MANY_NOTES');
  });

  it('strategies differ but all sum correctly', () => {
    const plans = STRATEGIES.map((s) => planDispense(20_000, cassettes(), s, LIMITS));
    for (const p of plans) expect(sum(p)).toBe(20_000);
    const notes = plans.map((p) => (p.ok ? p.plan.totalNotes : 0));
    expect(notes[0]).toBe(2); // 2 × $100
    expect(notes[2]).toBe(10); // 10 × $20
    expect(notes[2]).toBeGreaterThanOrEqual(notes[1]);
  });

  it('balanced prefers the fuller cassette', () => {
    const cs = cassettes(300, 1900, 500); // A 12% full, B 95% full
    const r = planDispense(10_000, cs, 'balanced', LIMITS);
    expect(r.ok && r.plan.picks).toEqual([{ cassette: 'B', denom: 50, count: 2 }]);
  });

  it('property: never exceeds counters, sums exactly, within note limit', () => {
    const shapes = [cassettes(), cassettes(3, 2, 1), cassettes(0, 7, 2), cassettes(25, 0, 3), cassettes(1, 1, 1)];
    let ok = 0;
    for (const cs of shapes) {
      for (const strategy of STRATEGIES) {
        for (let amt = 0; amt <= 90_000; amt += 1_000) {
          const r = planDispense(amt, cs, strategy, LIMITS);
          if (!r.ok) continue;
          ok++;
          expect(sum(r)).toBe(amt);
          expect(r.plan.totalNotes).toBeLessThanOrEqual(LIMITS.maxNotes);
          for (const p of r.plan.picks) {
            const c = cs.find((x) => x.id === p.cassette)!;
            expect(p.count).toBeGreaterThan(0);
            expect(p.count).toBeLessThanOrEqual(c.counter);
            expect(p.denom).toBe(c.denom);
          }
        }
      }
    }
    expect(ok).toBeGreaterThan(100);
  });

  it('property: exact search finds a plan whenever one exists (brute-force cross-check)', () => {
    const cs = cassettes(4, 3, 2);
    for (let amt = 2_000; amt <= 80_000; amt += 1_000) {
      let exists = false;
      for (let a = 0; a <= 4 && !exists; a++) for (let b = 0; b <= 3 && !exists; b++) for (let c = 0; c <= 2; c++) if (a * 2000 + b * 5000 + c * 10000 === amt) exists = true;
      expect(planDispense(amt, cs, 'min-notes', LIMITS).ok).toBe(exists);
    }
  });
});
