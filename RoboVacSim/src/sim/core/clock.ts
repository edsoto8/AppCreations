/**
 * Fixed-step simulation clock. Rendering calls `advance(realDt)`; the clock converts wall time into a
 * whole number of fixed simulation steps scaled by the speed multiplier. All simulation systems use
 * `stepDt` (simulated seconds) — never wall-clock time — so speed changes affect everything equally
 * and pausing freezes the entire simulation state.
 */
export const SPEED_OPTIONS = [0.5, 1, 2, 5, 10, 20] as const;
export type SimSpeed = (typeof SPEED_OPTIONS)[number];

export class SimClock {
  /** Simulated seconds per fixed step. */
  readonly stepDt: number;
  /** Total simulated time (s). */
  time = 0;
  steps = 0;
  speed: number = 1;
  paused = false;
  private accumulator = 0;
  /** Upper bound on steps per advance() to avoid a spiral of death after a stall. */
  maxStepsPerFrame: number;

  constructor(stepDt = 1 / 50, maxStepsPerFrame = 600) {
    this.stepDt = stepDt;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  /** Returns how many fixed steps to run for this frame. Call `tick()` once per executed step. */
  advance(realDt: number): number {
    if (this.paused) return 0;
    const clamped = Math.min(Math.max(realDt, 0), 0.1);
    this.accumulator += clamped * this.speed;
    let n = Math.floor(this.accumulator / this.stepDt + 1e-9);
    if (n > this.maxStepsPerFrame) {
      n = this.maxStepsPerFrame;
      this.accumulator = 0;
    } else {
      this.accumulator -= n * this.stepDt;
    }
    return n;
  }

  tick(): void {
    this.time += this.stepDt;
    this.steps++;
  }

  /** Fraction of a step left in the accumulator (for render interpolation). */
  get alpha(): number {
    return this.accumulator / this.stepDt;
  }

  reset(): void {
    this.time = 0;
    this.steps = 0;
    this.accumulator = 0;
  }
}
