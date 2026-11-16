import type { SimHost } from '../simulation/types';
import { hourOfDay } from '../simulation/clock';

/**
 * Decides how many sim-seconds to advance per animation frame. Sim time itself only moves by
 * processing events inside the host; `renderTime` is the time the renderer evaluates motion at.
 */
export class PlaybackController {
  renderTime = 0;
  speed = 5;
  paused = false;
  skipNight = true;
  /** Hard caps so the UI stays responsive at any speed. */
  maxSimSecPerFrame = 600;
  maxEventsPerFrame = 5000;
  lastFrameEvents = 0;

  frame(dtWall: number, host: SimHost & { now?: number }): void {
    if (this.paused) return;
    const dt = Math.min(Math.max(dtWall, 0), 0.1);
    let speed = this.speed;
    if (this.skipNight) {
      const h = hourOfDay(this.renderTime);
      if (h >= 22 || h < 5.9) speed = Math.max(speed, 1800);
    }
    const advance = Math.min(dt * speed, this.maxSimSecPerFrame);
    const target = this.renderTime + advance;
    host.advanceTo(target, this.maxEventsPerFrame);
    // when the per-frame event cap stopped the engine early, never render ahead of it
    const capped = (host as { lastComplete?: boolean }).lastComplete === false;
    this.renderTime = capped && typeof host.now === 'number' ? Math.max(this.renderTime, host.now) : target;
  }

  reset(): void {
    this.renderTime = 0;
  }
}
