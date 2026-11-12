import type { SimClock } from './types';

/**
 * Clock that never really waits: simulated time jumps forward instantly. Used by unit tests
 * so domain logic can be exercised deterministically and fast.
 */
export class InstantClock implements SimClock {
  private t = 0;
  readonly stages: string[] = [];
  now(): number {
    return this.t;
  }
  async wait(ms: number): Promise<void> {
    this.t += Math.max(0, ms);
  }
  async stage(label: string): Promise<void> {
    this.stages.push(label);
  }
}
