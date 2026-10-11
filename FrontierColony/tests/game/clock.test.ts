import { describe, expect, it } from 'vitest';
import { MAX_FRAME_MS, MAX_STEPS_PER_FRAME, TICK_MS, advanceClock } from '../../src/game/clock';

describe('advanceClock', () => {
  it('runs one tick per TICK_MS at 1x and carries the remainder', () => {
    const r = advanceClock(0, TICK_MS * 2.5, 1, false);
    expect(r.steps).toBe(2);
    expect(r.accumulatorMs).toBeCloseTo(TICK_MS * 0.5);
    expect(r.alpha).toBeCloseTo(0.5);
  });

  it('scales with speed', () => {
    expect(advanceClock(0, TICK_MS, 4, false).steps).toBe(4);
  });

  it('does not advance while paused', () => {
    const r = advanceClock(10, 1000, 2, true);
    expect(r.steps).toBe(0);
    expect(r.accumulatorMs).toBe(10);
  });

  it('clamps long frames and caps steps', () => {
    expect(advanceClock(0, 60_000, 1, false).steps).toBe(Math.floor(MAX_FRAME_MS / TICK_MS));
    const r = advanceClock(TICK_MS * 1000, 16, 1, false);
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.accumulatorMs).toBe(0);
  });
});
