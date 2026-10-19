/**
 * Seeded random streams (docs/financial-model.md §11). Path i is seeded by
 * splitmix32(hash32(seed, i)), which fills the 128-bit xoshiro128** state; normals come from
 * Box–Muller, both outputs used in order. A path's stream depends only on (seed, i), so results do not
 * depend on chunking or worker count. No Math.random anywhere.
 */

/** 32-bit integer hash of (seed, i): murmur3-style finalizer over a mixed pair. */
export function hash32(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** splitmix32 step: returns [next state, output]. */
function splitmix32(state: number): [number, number] {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return [next, (z ^ (z >>> 15)) >>> 0];
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** xoshiro128** generator with a Box–Muller normal cache. */
export class Stream {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | null = null;

  constructor(seed: number, path: number) {
    const state: number[] = [];
    let st = hash32(seed >>> 0, path >>> 0);
    for (let k = 0; k < 4; k++) {
      const [next, out] = splitmix32(st);
      st = next;
      state.push(out);
    }
    [this.s0, this.s1, this.s2, this.s3] = state as [number, number, number, number];
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1; // all-zero state is invalid
  }

  /** Next 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in (0, 1): never 0, so the logarithm in Box–Muller is finite. */
  uniform(): number {
    return (this.nextU32() + 0.5) / 4294967296;
  }

  /** Standard normal (Box–Muller; the second output is cached and returned next). */
  normal(): number {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return z;
    }
    const u1 = this.uniform();
    const u2 = this.uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    this.spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  }
}

/**
 * Cholesky factor L (lower triangular, L·Lᵀ = M) of a symmetric matrix, with a tolerance for
 * semi-definite matrices (zero pivots allowed). Null when the matrix is not positive semi-definite.
 */
export function cholesky(matrix: readonly (readonly number[])[], tolerance = 1e-10): number[][] | null {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const at = (m: readonly (readonly number[])[], i: number, j: number) => m[i]?.[j] ?? NaN;
  for (let i = 0; i < n; i++) {
    if (matrix[i]?.length !== n) return null;
    for (let j = 0; j <= i; j++) {
      let sum = at(matrix, i, j);
      if (Math.abs(at(matrix, j, i) - sum) > tolerance) return null; // not symmetric
      for (let k = 0; k < j; k++) sum -= at(L, i, k) * at(L, j, k);
      const row = L[i] ?? [];
      if (i === j) {
        if (sum < -tolerance) return null;
        row[j] = sum > 0 ? Math.sqrt(sum) : 0;
      } else {
        const pivot = at(L, j, j);
        if (pivot === 0) {
          if (Math.abs(sum) > tolerance) return null;
          row[j] = 0;
        } else {
          row[j] = sum / pivot;
        }
      }
    }
  }
  return L;
}

/** Positive semi-definite check (Cholesky with tolerance). */
export function isPositiveSemiDefinite(matrix: number[][], tolerance = 1e-10): boolean {
  return cholesky(matrix, tolerance) !== null;
}
