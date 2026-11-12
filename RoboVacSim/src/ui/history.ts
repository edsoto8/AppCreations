/**
 * Fixed-capacity time series that keeps the whole run visible: samples are taken every `interval`
 * (sim seconds); when the buffer overflows it is decimated 2:1 and the interval doubles. Pure logic
 * (no DOM) so it can be unit tested; also usable as an external store for useSyncExternalStore.
 */
export class SeriesHistory<K extends string> {
  private data: Record<K, number[]>;
  private lastT = -Infinity;
  private interval: number;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly keys: readonly K[],
    private readonly capacity = 160,
    private readonly baseInterval = 1,
    /** 'decimate' keeps the whole run (coarser over time); 'rolling' keeps the latest `capacity` samples. */
    private readonly mode: 'decimate' | 'rolling' = 'decimate',
  ) {
    this.interval = baseInterval;
    this.data = this.empty();
  }

  private empty(): Record<K, number[]> {
    const d = {} as Record<K, number[]>;
    for (const k of this.keys) d[k] = [];
    return d;
  }

  /** Add a sample at time `t`. A time going backwards (sim reset) clears the history first. */
  push(t: number, values: Record<K, number>): void {
    if (t < this.lastT - 1e-6) this.reset();
    if (t - this.lastT < this.interval) return;
    this.lastT = t;
    for (const k of this.keys) this.data[k].push(values[k]);
    if (this.data[this.keys[0]].length > this.capacity) {
      if (this.mode === 'rolling') {
        for (const k of this.keys) this.data[k].shift();
        this.bump();
        return;
      }
      for (const k of this.keys) this.data[k] = this.data[k].filter((_, i) => i % 2 === 0);
      this.interval *= 2;
    }
    this.bump();
  }

  series(k: K): readonly number[] {
    return this.data[k];
  }

  get length(): number {
    return this.data[this.keys[0]].length;
  }

  get sampleInterval(): number {
    return this.interval;
  }

  clear(): void {
    this.reset();
    this.bump();
  }

  private reset(): void {
    this.data = this.empty();
    this.lastT = -Infinity;
    this.interval = this.baseInterval;
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;
}
