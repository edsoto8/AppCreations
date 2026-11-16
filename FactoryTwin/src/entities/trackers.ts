import { RandomStream } from '../simulation/rng';
import type { FailureSpec } from '../simulation/types';

/** Accumulates time spent in each state. */
export class StateTracker<S extends string> {
  state: S;
  since: number;
  readonly totals = new Map<S, number>();

  constructor(initial: S, now = 0) {
    this.state = initial;
    this.since = now;
  }

  set(state: S, now: number): void {
    if (state === this.state) return;
    this.totals.set(this.state, (this.totals.get(this.state) ?? 0) + (now - this.since));
    this.state = state;
    this.since = now;
  }

  /** Time in `state` up to `now` (includes the running interval). */
  time(state: S, now: number): number {
    const base = this.totals.get(state) ?? 0;
    return state === this.state ? base + (now - this.since) : base;
  }

  total(now: number): number {
    let s = now - this.since;
    for (const v of this.totals.values()) s += v;
    return s;
  }
}

/** Time-weighted average of a queue length. */
export class QueueTracker {
  private area = 0;
  private last = 0;
  private len = 0;
  max = 0;

  update(len: number, now: number): void {
    this.area += this.len * (now - this.last);
    this.last = now;
    this.len = len;
    if (len > this.max) this.max = len;
  }

  average(now: number): number {
    const area = this.area + this.len * (now - this.last);
    return now > 0 ? area / now : 0;
  }

  get current(): number {
    return this.len;
  }
}

/**
 * Wear clock for failures on operating time. `failAt` is the age at which the next failure
 * happens (Weibull sample at renewal); age only increases while the resource operates.
 */
export class WearClock {
  age = 0;
  failAt = Infinity;
  /** Operating time since last preventive maintenance. */
  sincePm = 0;

  constructor(
    private readonly spec: FailureSpec,
    private readonly stream: RandomStream,
  ) {
    this.renew();
  }

  renew(): void {
    this.age = 0;
    this.failAt = this.spec.mtbfHours > 0 ? this.stream.weibull(this.spec.mtbfHours * 3600, this.spec.weibullShape) : Infinity;
  }

  get remaining(): number {
    return this.failAt - this.age;
  }

  addAge(dt: number): void {
    this.age += dt;
    this.sincePm += dt;
  }

  repairDuration(): number {
    return this.stream.lognormal(this.spec.mttrMin * 60, 0.5);
  }
}
