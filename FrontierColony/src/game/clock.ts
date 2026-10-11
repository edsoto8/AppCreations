/**
 * Fixed-timestep accumulator (pure, unit-testable). Real frame time × speed accumulates; each
 * TICK_MS of accumulated time runs one `stepGame`. The remainder gives the render alpha.
 */
import { TICK_SECONDS } from '../sim';

export const TICK_MS = TICK_SECONDS * 1000;
/** Frames longer than this (tab switch, debugger) are clamped so the sim never "catches up" for minutes. */
export const MAX_FRAME_MS = 250;
/** Safety cap on ticks per frame; excess accumulated time is dropped. */
export const MAX_STEPS_PER_FRAME = 40;

export interface ClockAdvance {
  /** Ticks to run this frame. */
  steps: number;
  /** New accumulator value to carry into the next frame. */
  accumulatorMs: number;
  /** Interpolation factor in [0, 1) for rendering. */
  alpha: number;
}

export function advanceClock(accumulatorMs: number, frameMs: number, speed: number, paused: boolean): ClockAdvance {
  if (paused || speed <= 0) {
    return { steps: 0, accumulatorMs, alpha: Math.min(accumulatorMs / TICK_MS, 0.999) };
  }
  let acc = accumulatorMs + Math.min(Math.max(frameMs, 0), MAX_FRAME_MS) * speed;
  let steps = Math.floor(acc / TICK_MS);
  acc -= steps * TICK_MS;
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    acc = 0;
  }
  return { steps, accumulatorMs: acc, alpha: Math.min(acc / TICK_MS, 0.999) };
}
