import { describe, expect, it } from 'vitest';
import { niceTicks } from './ticks';

describe('niceTicks', () => {
  it('produces round steps from zero that tightly cover the maximum', () => {
    expect(niceTicks(21480.55)).toEqual([0, 5000, 10000, 15000, 20000, 25000]);
    expect(niceTicks(12178.73)).toEqual([0, 2500, 5000, 7500, 10000, 12500]);
    expect(niceTicks(537.77)).toEqual([0, 200, 400, 600]);
    expect(niceTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(48)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});
