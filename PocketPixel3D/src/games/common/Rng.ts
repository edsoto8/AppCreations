/** Small deterministic random helpers. Games take their randomness from `services.random`. */

/** mulberry32: a fast seeded PRNG returning uniform values in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, n). Robust against a source that (wrongly) returns exactly 1. */
export function randomInt(random: () => number, n: number): number {
  const v = Math.floor(random() * n);
  return v >= n ? n - 1 : v < 0 ? 0 : v;
}

/** Float in [min, max). */
export function randomRange(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/** In-place Fisher-Yates shuffle of an indexable array. */
export function shuffleInPlace(random: () => number, items: { length: number; [index: number]: number }): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    const tmp = items[i] as number;
    items[i] = items[j] as number;
    items[j] = tmp;
  }
}
