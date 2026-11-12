import type { SimClock } from '../core/types';
import type { EventBus } from '../core/events';

export type Ease = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - (1 - t) * (1 - t),
  in: (t: number) => t * t,
  /** Slight overshoot, for mechanical parts snapping into place. */
  backOut: (t: number) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
} satisfies Record<string, Ease>;

interface Timer {
  at: number;
  resolve: () => void;
}

interface Tween {
  start: number;
  duration: number;
  ease: Ease;
  onUpdate: (p: number) => void;
  resolve: () => void;
}

export const SPEEDS = [0.25, 0.5, 1, 2] as const;

/**
 * Simulation clock driven by the render loop. Everything the mechanism does (waits, tweens,
 * host latency, customer timeouts) runs on simulated time, so speed, pause and step apply to
 * the whole simulation consistently. Camera moves and UI transitions use real time instead.
 *
 * Step semantics: `step()` un-pauses until the next `stage()` boundary, then pauses again,
 * so each major stage can be watched on its own.
 */
export class AnimClock implements SimClock {
  private t = 0;
  private timers: Timer[] = [];
  private tweens: Tween[] = [];
  private stepping = false;
  speed = 1;
  paused = false;
  /** Label of the most recent stage. */
  currentStage = '';
  private listeners = new Set<() => void>();

  constructor(private bus?: EventBus) {}

  now(): number {
    return this.t;
  }

  wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.timers.push({ at: this.t + ms, resolve }));
  }

  /** Animate `onUpdate(progress 0..1)` over `duration` sim-ms. */
  tween(duration: number, onUpdate: (p: number) => void, ease: Ease = Easing.inOut): Promise<void> {
    if (duration <= 0) {
      onUpdate(1);
      return Promise.resolve();
    }
    onUpdate(0);
    return new Promise((resolve) => this.tweens.push({ start: this.t, duration, ease, onUpdate, resolve }));
  }

  async stage(label: string): Promise<void> {
    this.currentStage = label;
    this.bus?.emit('mech.stage', { label });
    if (this.stepping) {
      this.stepping = false;
      this.paused = true;
      this.notify();
    }
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.notify();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.stepping = false;
    this.notify();
  }

  /** Run until the next stage boundary, then pause. */
  step(): void {
    this.stepping = true;
    this.paused = false;
    this.notify();
  }

  get isStepping(): boolean {
    return this.stepping;
  }

  /** True while anything is animating or waiting on sim time. */
  get busy(): boolean {
    return this.timers.length > 0 || this.tweens.length > 0;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** Advance by real elapsed milliseconds (called once per frame). */
  update(realDtMs: number): void {
    if (this.paused) return;
    // Clamp huge frame gaps (tab switch) so animations don't jump.
    const dt = Math.min(realDtMs, 100) * this.speed;
    this.advance(dt);
  }

  /** Advance sim time directly (also used by tests and fast-forward). */
  advance(dt: number): void {
    this.t += dt;
    if (this.tweens.length) {
      const done: Tween[] = [];
      for (const tw of this.tweens) {
        const p = Math.min(1, (this.t - tw.start) / tw.duration);
        tw.onUpdate(tw.ease(p));
        if (p >= 1) done.push(tw);
      }
      if (done.length) {
        this.tweens = this.tweens.filter((x) => !done.includes(x));
        for (const d of done) d.resolve();
      }
    }
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= this.t);
      if (due.length) {
        this.timers = this.timers.filter((x) => x.at > this.t);
        for (const d of due) d.resolve();
      }
    }
  }

  /** Drop all pending waits/tweens (simulator reset). Pending promises never resolve and are garbage collected. */
  cancelAll(): void {
    this.timers = [];
    this.tweens = [];
    this.stepping = false;
  }
}
