import { BUTTON_IDS, type ButtonId, type InputFrame } from '../games/GameInterface';

/** Where a press came from. Each source holds its own presses so one cannot release another's. */
export type InputSource = 'keyboard' | 'pointer' | 'ui' | 'test';

/**
 * Merges button presses from every input source and produces a per-tick {@link InputFrame}.
 *
 * A press that starts and ends between two ticks (a quick tap) is latched so the game still sees it
 * as down for one tick.
 */
export class ButtonSystem implements InputFrame {
  private readonly holders = new Map<ButtonId, Set<InputSource>>();
  private readonly latched = new Set<ButtonId>();
  private readonly current = new Set<ButtonId>();
  private readonly previous = new Set<ButtonId>();
  private readonly listeners = new Set<(button: ButtonId, down: boolean) => void>();

  constructor() {
    for (const id of BUTTON_IDS) this.holders.set(id, new Set());
  }

  /** Subscribe to physical up/down changes (for button animations and click sounds). */
  onChange(listener: (button: ButtonId, down: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  press(button: ButtonId, source: InputSource): void {
    const set = this.holders.get(button);
    if (!set || set.has(source)) return;
    const wasDown = set.size > 0;
    set.add(source);
    this.latched.add(button);
    if (!wasDown) this.notify(button, true);
  }

  release(button: ButtonId, source: InputSource): void {
    const set = this.holders.get(button);
    if (!set || !set.delete(source)) return;
    if (set.size === 0) this.notify(button, false);
  }

  releaseAll(source?: InputSource): void {
    for (const id of BUTTON_IDS) {
      if (source) this.release(id, source);
      else for (const s of [...(this.holders.get(id) ?? [])]) this.release(id, s);
    }
  }

  /** Physically held right now (any source). */
  isHeld(button: ButtonId): boolean {
    return (this.holders.get(button)?.size ?? 0) > 0;
  }

  /** Called once per fixed tick, before the game's tick, to compute this tick's frame. */
  latch(): void {
    this.previous.clear();
    for (const b of this.current) this.previous.add(b);
    this.current.clear();
    for (const id of BUTTON_IDS) {
      if (this.isHeld(id) || this.latched.has(id)) this.current.add(id);
    }
    this.latched.clear();
  }

  /** Clears tick history (used when a new game starts so held buttons don't count as fresh presses). */
  resetEdges(): void {
    this.previous.clear();
    for (const id of BUTTON_IDS) if (this.isHeld(id)) this.previous.add(id);
    this.current.clear();
    for (const b of this.previous) this.current.add(b);
    this.latched.clear();
  }

  isDown(button: ButtonId): boolean {
    return this.current.has(button);
  }

  wasPressed(button: ButtonId): boolean {
    return this.current.has(button) && !this.previous.has(button);
  }

  wasReleased(button: ButtonId): boolean {
    return !this.current.has(button) && this.previous.has(button);
  }

  private notify(button: ButtonId, down: boolean): void {
    for (const l of this.listeners) l(button, down);
  }
}
