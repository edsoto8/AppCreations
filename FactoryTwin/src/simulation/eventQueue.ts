/** A scheduled simulation event. Plain data: handlers are looked up by `type`. */
export interface SimEvent {
  id: number;
  time: number;
  type: string;
  /** Entity key (station id, vehicle id, ...). */
  k: string;
  /** Numeric payload. */
  n: number;
  /** Ordering class at equal time: 0 = model events, 1 = injected user events (run last). */
  cls: number;
  /** Set when cancelled; dead events are skipped when popped. */
  dead: boolean;
}

/** Binary min-heap ordered by (time, cls, id). `id` is a global sequence so ties are stable. */
export class EventQueue {
  private heap: SimEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(ev: SimEvent): void {
    const h = this.heap;
    h.push(ev);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  peek(): SimEvent | undefined {
    return this.heap[0];
  }

  pop(): SimEvent | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }

  clear(): void {
    this.heap = [];
  }
}

function less(a: SimEvent, b: SimEvent): boolean {
  if (a.time !== b.time) return a.time < b.time;
  if (a.cls !== b.cls) return a.cls < b.cls;
  return a.id < b.id;
}
