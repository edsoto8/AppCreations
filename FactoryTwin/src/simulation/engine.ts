import type { AdvanceResult, LogRecord, LogType } from './types';
import { EventQueue, type SimEvent } from './eventQueue';
import { RollingHash } from './hash';

export type Handler = (ev: SimEvent) => void;
export type LogListener = (r: LogRecord) => void;

/**
 * Discrete-event engine. Simulation time advances ONLY by popping the next scheduled event.
 */
export class Engine {
  now = 0;
  /** Bumped on every processed event; consumers use it for change detection. */
  version = 0;
  processed = 0;
  private readonly queue = new EventQueue();
  private readonly handlers = new Map<string, Handler>();
  /** Live (scheduled, not yet processed or cancelled) events by id. */
  private readonly live = new Map<number, SimEvent>();
  private nextId = 1;
  readonly log: EventLog;

  constructor(keepLog = false) {
    this.log = new EventLog(this, keepLog);
  }

  on(type: string, handler: Handler): void {
    if (this.handlers.has(type)) throw new Error(`Duplicate handler for ${type}`);
    this.handlers.set(type, handler);
  }

  /** Schedule at an absolute time (>= now). Returns an id usable with cancel(). */
  at(time: number, type: string, k = '', n = 0, cls = 0): number {
    if (!(time >= this.now)) throw new Error(`Cannot schedule ${type} at ${time} before now ${this.now}`);
    const id = this.nextId++;
    const ev: SimEvent = { id, time, type, k, n, cls, dead: false };
    this.queue.push(ev);
    this.live.set(id, ev);
    return id;
  }

  /** Schedule after a delay (>= 0). */
  in(delay: number, type: string, k = '', n = 0): number {
    return this.at(this.now + Math.max(0, delay), type, k, n);
  }

  /** Cancel a scheduled event. Safe to call with ids that already fired. */
  cancel(id: number | null | undefined): void {
    if (!id) return;
    const ev = this.live.get(id);
    if (ev) {
      ev.dead = true;
      this.live.delete(id);
    }
  }

  /** Time of the next live event, or Infinity. */
  peekTime(): number {
    for (;;) {
      const ev = this.queue.peek();
      if (!ev) return Infinity;
      if (ev.dead) {
        this.queue.pop();
        continue;
      }
      return ev.time;
    }
  }

  /** Process the next event. Returns false when the queue is empty. */
  step(): boolean {
    for (;;) {
      const ev = this.queue.pop();
      if (!ev) return false;
      if (ev.dead) continue;
      this.live.delete(ev.id);
      this.now = ev.time;
      const h = this.handlers.get(ev.type);
      if (!h) throw new Error(`No handler for event ${ev.type}`);
      h(ev);
      this.processed++;
      this.version++;
      return true;
    }
  }

  /** Process every event with time <= target, at most maxEvents of them. */
  advanceTo(target: number, maxEvents = Infinity): AdvanceResult {
    let events = 0;
    while (events < maxEvents) {
      const t = this.peekTime();
      if (t > target) return { time: this.now, events, complete: true };
      this.step();
      events++;
    }
    return { time: this.now, events, complete: this.peekTime() > target };
  }

  get pending(): number {
    return this.live.size;
  }
}

/** Domain event log with a rolling hash. */
export class EventLog {
  readonly records: LogRecord[] = [];
  private readonly hash = new RollingHash();
  private readonly listeners: LogListener[] = [];

  constructor(
    private readonly engine: Engine,
    readonly keep: boolean,
  ) {}

  subscribe(l: LogListener): void {
    this.listeners.push(l);
  }

  write(type: LogType, id: string, ref?: string, v?: number): void {
    const r: LogRecord = { t: this.engine.now, type, id };
    if (ref !== undefined) r.ref = ref;
    if (v !== undefined) r.v = v;
    this.hash.update(`${r.t}|${type}|${id}|${ref ?? ''}|${v ?? ''}`);
    if (this.keep) this.records.push(r);
    for (const l of this.listeners) l(r);
  }

  get count(): number {
    return this.hash.count;
  }

  digest(): string {
    return this.hash.digest();
  }
}
