/** The sliding power switch. Pure state; the console reacts through its listener. */
export class PowerSystem {
  private on = false;
  private readonly listeners = new Set<(on: boolean) => void>();

  get isOn(): boolean {
    return this.on;
  }

  onChange(listener: (on: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const l of this.listeners) l(on);
  }

  toggle(): void {
    this.set(!this.on);
  }
}
