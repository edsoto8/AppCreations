import { describe, expect, it } from 'vitest';
import {
  chance,
  cloneRng,
  createRng,
  deriveRng,
  hashSeed,
  nextFloat,
  nextInt,
  nextU32,
  pick,
  pickWeightedIndex,
  shuffle,
} from '../../src/sim/rng';

const take = (seed: number, n: number) => {
  const s = createRng(seed);
  return Array.from({ length: n }, () => nextU32(s));
};

describe('hashSeed', () => {
  it('is deterministic and produces uint32 values', () => {
    expect(hashSeed('frontier')).toBe(hashSeed('frontier'));
    for (const text of ['', 'a', 'frontier', 'Frontier', 'a much longer seed string with spaces']) {
      const h = hashSeed(text);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('distinguishes similar strings', () => {
    const hashes = new Set(['seed1', 'seed2', 'Seed1', '1seed', 'seed10'].map(hashSeed));
    expect(hashes.size).toBe(5);
  });
});

describe('sfc32 generator', () => {
  it('repeats the same sequence for the same seed', () => {
    expect(take(42, 100)).toEqual(take(42, 100));
  });

  it('produces different sequences for neighbouring seeds', () => {
    expect(take(1, 10)).not.toEqual(take(2, 10));
  });

  it('keeps all state as JSON-safe uint32 numbers and resumes after a JSON round-trip', () => {
    const a = createRng(7);
    for (let i = 0; i < 25; i++) nextU32(a);
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    for (const v of a) expect(v >>> 0).toBe(v);
    expect(Array.from({ length: 50 }, () => nextU32(a))).toEqual(Array.from({ length: 50 }, () => nextU32(b)));
  });

  it('cloneRng peeks without advancing the original', () => {
    const a = createRng(99);
    const peek = cloneRng(a);
    const peeked = nextU32(peek);
    expect(nextU32(a)).toBe(peeked);
  });

  it('nextFloat stays in [0, 1) with a sane mean', () => {
    const s = createRng(123);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const f = nextFloat(s);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      sum += f;
    }
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
  });

  it('nextInt covers the inclusive range uniformly enough', () => {
    const s = createRng(5);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 6000; i++) {
      const v = nextInt(s, 1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      counts[v - 1]!++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(850);
    expect(() => nextInt(s, 3, 2)).toThrow(RangeError);
  });

  it('derived streams are independent of each other and deterministic', () => {
    const w1 = deriveRng(10, 'worldgen');
    const w2 = deriveRng(10, 'worldgen');
    const ai = deriveRng(10, 'ai');
    expect(nextU32(w1)).toBe(nextU32(w2));
    expect(take(10, 1)).not.toEqual([nextU32(ai)]);
  });

  it('helpers are deterministic', () => {
    const run = () => {
      const s = createRng(2024);
      return {
        picked: pick(s, ['a', 'b', 'c', 'd']),
        weighted: pickWeightedIndex(s, [0, 5, 1, 0]),
        shuffled: shuffle(s, [1, 2, 3, 4, 5, 6]),
        flips: Array.from({ length: 8 }, () => chance(s, 0.5)),
      };
    };
    const a = run();
    expect(run()).toEqual(a);
    expect([...a.shuffled].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect([1, 2]).toContain(a.weighted);
    expect(() => pick(createRng(1), [])).toThrow(RangeError);
  });
});
