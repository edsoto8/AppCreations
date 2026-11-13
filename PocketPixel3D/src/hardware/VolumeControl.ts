import { clamp } from '../animation/Tween';

/** A thumb wheel with a 0..1 value (volume and contrast both use this). */
export class DialControl {
  private v: number;
  private readonly listeners = new Set<(value: number) => void>();

  constructor(
    readonly name: string,
    initial: number,
    /** Amount one detent (scroll notch / key press) moves the wheel. */
    readonly detent = 0.05,
  ) {
    this.v = clamp(initial, 0, 1);
  }

  get value(): number {
    return this.v;
  }

  onChange(listener: (value: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: number): void {
    const next = clamp(value, 0, 1);
    if (Math.abs(next - this.v) < 1e-6) return;
    this.v = next;
    for (const l of this.listeners) l(next);
  }

  step(detents: number): void {
    this.set(Math.round((this.v + detents * this.detent) / this.detent) * this.detent);
  }
}

export class VolumeControl extends DialControl {
  constructor(initial = 0.6) {
    super('volume', initial);
  }
}

export class ContrastControl extends DialControl {
  constructor(initial = 0.5) {
    super('contrast', initial);
  }
}
