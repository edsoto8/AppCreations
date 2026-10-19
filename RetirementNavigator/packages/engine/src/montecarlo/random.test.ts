/** Seeded streams, normals and the PSD check (docs/financial-model.md §11). */
import { describe, expect, it } from 'vitest';
import { Stream, cholesky, hash32, isPositiveSemiDefinite } from './random';

describe('seeded streams', () => {
  it('is deterministic per (seed, path) and independent across paths', () => {
    const a = new Stream(42, 7);
    const b = new Stream(42, 7);
    const c = new Stream(42, 8);
    const seqA = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.nextU32())).not.toEqual(seqA);
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
  });

  it('produces uniforms in (0,1) and standard normals with mean 0 and variance 1', () => {
    const s = new Stream(2026, 0);
    let sum = 0;
    let sq = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const z = s.normal();
      sum += z;
      sq += z * z;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
    expect(Math.abs(sq / n - 1)).toBeLessThan(0.01);
    const u = new Stream(1, 1);
    for (let i = 0; i < 10_000; i++) {
      const x = u.uniform();
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('positive semi-definite check (Cholesky)', () => {
  it('factors a valid correlation matrix: L·Lᵀ reproduces it', () => {
    const m = [
      [1, 0.1, 0],
      [0.1, 1, 0.2],
      [0, 0.2, 1],
    ];
    const L = cholesky(m)!;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let v = 0;
        for (let k = 0; k < 3; k++) v += L[i]![k]! * L[j]![k]!;
        expect(v).toBeCloseTo(m[i]![j]!, 12);
      }
    }
    expect(isPositiveSemiDefinite(m)).toBe(true);
  });

  it('accepts semi-definite (perfect correlation) and rejects indefinite or asymmetric matrices', () => {
    expect(
      isPositiveSemiDefinite([
        [1, 1, 0],
        [1, 1, 0],
        [0, 0, 1],
      ]),
    ).toBe(true);
    expect(
      isPositiveSemiDefinite([
        [1, 0.9, -0.9],
        [0.9, 1, 0.9],
        [-0.9, 0.9, 1],
      ]),
    ).toBe(false);
    expect(
      isPositiveSemiDefinite([
        [1, 0.5],
        [0.4, 1],
      ]),
    ).toBe(false);
  });
});
