/**
 * Small seeded gradient-noise toolkit for world generation (no dependencies).
 *
 * Determinism notes: the permutation table comes from the seeded RNG (rng.ts), and the code
 * below only uses `+ - * /`, `Math.floor`, `Math.abs` and `Math.sqrt`. Those are exactly
 * specified by IEEE-754, unlike `sin`/`cos`/`pow`/`exp`, so the same seed gives bit-identical
 * fields on every JavaScript engine.
 */
import { shuffle } from './rng';
import type { RngState } from './types';

/** A 2D noise function returning values in [-1, 1]. */
export type Noise2D = (x: number, y: number) => number;

// 16 unit gradient directions (22.5 degree steps) written as literals, so no trig is needed.
const A = 0.9238795325112867; // cos 22.5
const B = 0.3826834323650898; // sin 22.5
const C = 0.7071067811865476; // cos 45
const GRAD_X = [1, A, C, B, 0, -B, -C, -A, -1, -A, -C, -B, 0, B, C, A];
const GRAD_Y = [0, B, C, A, 1, A, C, B, 0, -B, -C, -A, -1, -A, -C, -B];
/** Scales the raw Perlin output (max about 0.707 for unit gradients) to roughly [-1, 1]. */
const PERLIN_SCALE = 1.4142135623730951;

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Create an independent Perlin-style gradient noise; consumes 256 shuffle draws from `rng`. */
export function createNoise2D(rng: RngState): Noise2D {
  const base = shuffle(
    rng,
    Array.from({ length: 256 }, (_, i) => i),
  );
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255] as number;

  return (x: number, y: number): number => {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const xi = fx & 255;
    const yi = fy & 255;
    const dx = x - fx;
    const dy = y - fy;
    const u = fade(dx);
    const v = fade(dy);
    const p0 = perm[xi] + yi;
    const p1 = perm[xi + 1] + yi;
    const g00 = perm[p0] & 15;
    const g01 = perm[p0 + 1] & 15;
    const g10 = perm[p1] & 15;
    const g11 = perm[p1 + 1] & 15;
    const n00 = GRAD_X[g00] * dx + GRAD_Y[g00] * dy;
    const n10 = GRAD_X[g10] * (dx - 1) + GRAD_Y[g10] * dy;
    const n01 = GRAD_X[g01] * dx + GRAD_Y[g01] * (dy - 1);
    const n11 = GRAD_X[g11] * (dx - 1) + GRAD_Y[g11] * (dy - 1);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    const r = (a + (b - a) * v) * PERLIN_SCALE;
    return r > 1 ? 1 : r < -1 ? -1 : r;
  };
}

/**
 * Fractal Brownian motion: `octaves` layers of noise at doubling frequency and halving
 * amplitude. Normalised to roughly [-1, 1].
 */
export function fbm(noise: Noise2D, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 31.7, y * freq - o * 17.3);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise in [0, 1]: sharp crests where the underlying noise crosses zero. */
export function ridged(noise: Noise2D, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * freq + o * 13.1, y * freq + o * 7.9));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hermite smoothstep from 0 (at `a`) to 1 (at `b`). */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Value below which a fraction `q` (0..1) of `values` fall. Sorts a copy. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(values as ArrayLike<number>);
  sorted.sort();
  const i = Math.min(n - 1, Math.max(0, Math.floor(q * n)));
  return sorted[i] as number;
}
