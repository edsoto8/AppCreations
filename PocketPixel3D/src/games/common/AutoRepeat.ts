/**
 * Delayed auto-shift for held buttons, counted in ticks.
 *
 * Feed it the held state once per tick. It fires on the tick the hold starts, then once more after
 * `initialDelay` ticks of holding, then every `repeatInterval` ticks while still held.
 * Example (delay 10, interval 3): fires on held ticks 0, 10, 13, 16, ...
 */
export class AutoRepeat {
  private heldTicks = -1;

  constructor(
    readonly initialDelay: number,
    readonly repeatInterval: number,
  ) {
    if (initialDelay < 1 || repeatInterval < 1) throw new Error('AutoRepeat timings must be >= 1 tick');
  }

  /** Returns true on ticks where the held action should happen. */
  update(held: boolean): boolean {
    if (!held) {
      this.heldTicks = -1;
      return false;
    }
    this.heldTicks++;
    if (this.heldTicks === 0) return true;
    if (this.heldTicks < this.initialDelay) return false;
    return (this.heldTicks - this.initialDelay) % this.repeatInterval === 0;
  }

  /** Forget the current hold; the next held tick fires immediately. */
  reset(): void {
    this.heldTicks = -1;
  }

  /** True while a hold is being tracked. */
  get active(): boolean {
    return this.heldTicks >= 0;
  }
}

/**
 * Auto-repeat for an opposed pair of buttons (e.g. left/right). The most recently pressed of the
 * two wins while both are held; switching direction restarts the delay.
 */
export class DirectionalRepeat {
  private readonly repeat: AutoRepeat;
  private direction = 0;

  constructor(initialDelay: number, repeatInterval: number) {
    this.repeat = new AutoRepeat(initialDelay, repeatInterval);
  }

  /**
   * @param negHeld e.g. left held; @param posHeld e.g. right held
   * @param negPressed / @param posPressed true on the tick that button went down
   * @returns -1, 0 or +1: the step to apply this tick.
   */
  update(negHeld: boolean, posHeld: boolean, negPressed: boolean, posPressed: boolean): number {
    let dir = this.direction;
    if (negPressed && !posPressed) dir = -1;
    else if (posPressed && !negPressed) dir = 1;
    if (dir === -1 && !negHeld) dir = posHeld ? 1 : 0;
    else if (dir === 1 && !posHeld) dir = negHeld ? -1 : 0;
    else if (dir === 0) dir = negHeld && !posHeld ? -1 : posHeld && !negHeld ? 1 : 0;
    if (dir !== this.direction) {
      this.repeat.reset();
      this.direction = dir;
    }
    return this.repeat.update(dir !== 0) ? dir : 0;
  }

  reset(): void {
    this.repeat.reset();
    this.direction = 0;
  }
}
