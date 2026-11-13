/** Easing curves: map linear progress t in [0, 1] to eased progress. */
export type Easing = (t: number) => number;

export const Ease = {
  linear: (t: number): number => t,
  outCubic: (t: number): number => 1 - (1 - t) ** 3,
  inCubic: (t: number): number => t * t * t,
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} as const;

/**
 * A scalar that animates toward a target over a fixed duration.
 *
 * Deterministic: progress depends only on the dt values passed to {@link update}.
 * Interruptible: calling {@link animateTo} mid-flight restarts from the current value, so reversing
 * an animation never jumps.
 */
export class AnimatedValue {
  private from: number;
  private to: number;
  private elapsed = 0;
  private duration = 0;
  private easing: Easing = Ease.inOutCubic;
  value: number;

  constructor(initial: number) {
    this.value = initial;
    this.from = initial;
    this.to = initial;
  }

  get target(): number {
    return this.to;
  }

  get active(): boolean {
    return this.elapsed < this.duration;
  }

  animateTo(target: number, duration: number, easing: Easing = Ease.inOutCubic): void {
    if (target === this.to && this.active) return;
    this.from = this.value;
    this.to = target;
    this.elapsed = 0;
    this.duration = Math.max(0, duration);
    this.easing = easing;
    if (this.duration === 0) this.value = target;
  }

  snap(value: number): void {
    this.value = this.from = this.to = value;
    this.elapsed = this.duration = 0;
  }

  /** Advances the animation; returns true while it is still moving. */
  update(dt: number): boolean {
    if (!this.active) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    const t = this.duration === 0 ? 1 : this.elapsed / this.duration;
    this.value = this.from + (this.to - this.from) * this.easing(t);
    return this.active;
  }
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Remaps v from [a, b] to [0, 1], clamped. */
export function progressBetween(v: number, a: number, b: number): number {
  return clamp((v - a) / (b - a), 0, 1);
}
