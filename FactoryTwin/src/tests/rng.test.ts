import { describe, expect, it } from 'vitest';
import { RngStreams } from '../simulation/rng';

describe('rng streams', () => {
  it('is deterministic per seed and stream', () => {
    const a = new RngStreams(42).stream('quality');
    const b = new RngStreams(42).stream('quality');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('streams are independent: draws in one do not shift another', () => {
    const r1 = new RngStreams(7);
    const r2 = new RngStreams(7);
    for (let i = 0; i < 1000; i++) r1.stream('failures').next();
    const x = Array.from({ length: 20 }, () => r1.stream('arrivals').next());
    const y = Array.from({ length: 20 }, () => r2.stream('arrivals').next());
    expect(x).toEqual(y);
  });

  it('different seeds differ', () => {
    expect(new RngStreams(1).stream('a').next()).not.toBe(new RngStreams(2).stream('a').next());
  });

  it('distributions have the requested means', () => {
    const s = new RngStreams(3).stream('d');
    const n = 40000;
    const mean = (f: () => number) => Array.from({ length: n }, f).reduce((a, b) => a + b, 0) / n;
    expect(mean(() => s.exp(10))).toBeCloseTo(10, 0);
    expect(mean(() => s.around(90))).toBeCloseTo(90, 0);
    expect(mean(() => s.lognormal(20, 0.5))).toBeCloseTo(20, 0);
    expect(mean(() => s.weibull(100, 1.5)) / 100).toBeCloseTo(1, 1);
    const tri = Array.from({ length: n }, () => s.tri(1, 2, 6));
    expect(Math.min(...tri)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...tri)).toBeLessThanOrEqual(6);
  });
});
