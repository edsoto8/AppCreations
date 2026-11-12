/**
 * Min binary heap of integer values (cell indices) keyed by (primary, secondary) numbers.
 * Ties on both keys are broken by the smaller value, so pop order is fully deterministic.
 * Backed by growable typed arrays that are reused between searches (call `clear()`).
 * Duplicate values are allowed (lazy decrease-key: callers skip stale entries).
 */
export class BinaryHeap {
  private k1: Float64Array;
  private k2: Float64Array;
  private vals: Int32Array;
  private n = 0;

  constructor(initialCapacity = 1024) {
    const cap = Math.max(16, initialCapacity | 0);
    this.k1 = new Float64Array(cap);
    this.k2 = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }

  get length(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  /** Primary key of the top element (Infinity when empty). */
  peekKey(): number {
    return this.n > 0 ? this.k1[0] : Infinity;
  }

  push(value: number, key: number, key2 = 0): void {
    if (this.n === this.vals.length) this.grow();
    let pos = this.n++;
    const k1 = this.k1;
    const k2 = this.k2;
    const vals = this.vals;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (!this.less(key, key2, value, k1[parent], k2[parent], vals[parent])) break;
      k1[pos] = k1[parent];
      k2[pos] = k2[parent];
      vals[pos] = vals[parent];
      pos = parent;
    }
    k1[pos] = key;
    k2[pos] = key2;
    vals[pos] = value;
  }

  /** Removes and returns the smallest value. Undefined behaviour when empty (check `length`). */
  pop(): number {
    const k1 = this.k1;
    const k2 = this.k2;
    const vals = this.vals;
    const top = vals[0];
    const last = --this.n;
    if (last > 0) {
      const lk1 = k1[last];
      const lk2 = k2[last];
      const lv = vals[last];
      let pos = 0;
      for (;;) {
        const l = 2 * pos + 1;
        if (l >= last) break;
        const r = l + 1;
        let c = l;
        if (r < last && this.less(k1[r], k2[r], vals[r], k1[l], k2[l], vals[l])) c = r;
        if (!this.less(k1[c], k2[c], vals[c], lk1, lk2, lv)) break;
        k1[pos] = k1[c];
        k2[pos] = k2[c];
        vals[pos] = vals[c];
        pos = c;
      }
      k1[pos] = lk1;
      k2[pos] = lk2;
      vals[pos] = lv;
    }
    return top;
  }

  private less(a1: number, a2: number, av: number, b1: number, b2: number, bv: number): boolean {
    if (a1 !== b1) return a1 < b1;
    if (a2 !== b2) return a2 < b2;
    return av < bv;
  }

  private grow(): void {
    const cap = this.vals.length * 2;
    const k1 = new Float64Array(cap);
    const k2 = new Float64Array(cap);
    const vals = new Int32Array(cap);
    k1.set(this.k1);
    k2.set(this.k2);
    vals.set(this.vals);
    this.k1 = k1;
    this.k2 = k2;
    this.vals = vals;
  }
}
