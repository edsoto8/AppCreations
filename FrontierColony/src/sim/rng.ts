/**
 * Seeded PRNG for the simulation. The generator state is a plain 4-number tuple (`RngState`)
 * that lives inside GameState, so saving/loading resumes the exact same random sequence.
 *
 * Algorithm: sfc32 (Chris Doty-Humphrey's Small Fast Counting generator, 128-bit state),
 * seeded through splitmix32. Strings are hashed to a uint32 seed with xmur3-style mixing.
 *
 * All functions that take an `RngState` advance it **in place**.
 * Never use Math.random in src/sim — use these.
 */
import type { RngState } from './types';

/** Hash any string to an unsigned 32-bit seed (deterministic across platforms). */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Create a fresh generator state from a uint32 seed. */
export function createRng(seed: number): RngState {
  const next = splitmix32(seed);
  const state: RngState = [next(), next(), next(), next()];
  // Warm up so that nearby seeds diverge immediately.
  for (let i = 0; i < 12; i++) nextU32(state);
  return state;
}

/**
 * Independent generator for a named sub-stream (e.g. `deriveRng(seed, 'worldgen')`), so that
 * world generation and the running simulation never consume each other's numbers.
 */
export function deriveRng(seed: number, stream: string): RngState {
  return createRng((hashSeed(stream) ^ Math.imul(seed >>> 0, 0x27d4eb2d)) >>> 0);
}

/** Copy a state (e.g. to peek ahead without advancing the original). */
export function cloneRng(state: RngState): RngState {
  return [state[0], state[1], state[2], state[3]];
}

/** Next unsigned 32-bit integer. */
export function nextU32(state: RngState): number {
  let [a, b, c, d] = state;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  state[0] = a >>> 0;
  state[1] = b;
  state[2] = c;
  state[3] = d;
  return t;
}

/** Float in [0, 1). */
export function nextFloat(state: RngState): number {
  return nextU32(state) / 4294967296;
}

/** Float in [min, max). */
export function nextRange(state: RngState, min: number, max: number): number {
  return min + nextFloat(state) * (max - min);
}

/** Integer in [min, max] (both inclusive). */
export function nextInt(state: RngState, min: number, max: number): number {
  if (max < min) throw new RangeError(`nextInt: max (${max}) < min (${min})`);
  return min + Math.floor(nextFloat(state) * (max - min + 1));
}

/** True with probability p (p <= 0 never, p >= 1 always). */
export function chance(state: RngState, p: number): boolean {
  return nextFloat(state) < p;
}

/** Uniformly pick an element. Throws on an empty array. */
export function pick<T>(state: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: empty array');
  return items[nextInt(state, 0, items.length - 1)] as T;
}

/** Pick an index with probability proportional to its (non-negative) weight. */
export function pickWeightedIndex(state: RngState, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) throw new RangeError('pickWeightedIndex: weights sum to 0');
  let r = nextFloat(state) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i] as number);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Fisher–Yates shuffle in place; returns the same array. */
export function shuffle<T>(state: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(state, 0, i);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
