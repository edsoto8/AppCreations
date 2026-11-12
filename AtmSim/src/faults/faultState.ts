import type { EventBus } from '../core/events';
import type { FaultId } from '../core/types';
import { faultById } from './catalog';

/**
 * Which training faults are currently armed.
 *
 * - One-shot faults (`latching: false`) fire once at their trigger point and are then consumed.
 * - Latching faults stay armed until the matching operator recovery action disarms them
 *   (e.g. `clearJam()`, `loadPaper()`, `resetDevice('host')`, `restorePower()`, `replenish()`).
 *
 * Side effects of arming (device status, moving notes to the vault for the cash faults) are applied by
 * listeners of the 'fault.armed' event (see AtmSystem), so this class stays a simple state holder.
 */
export class FaultState {
  private set = new Set<FaultId>();

  constructor(private readonly bus: EventBus) {}

  get armed(): FaultId[] {
    return [...this.set];
  }

  isArmed(id: FaultId): boolean {
    return this.set.has(id);
  }

  arm(id: FaultId): void {
    if (!faultById(id)) throw new Error(`Unknown fault ${id}`);
    if (this.set.has(id)) return;
    this.set.add(id);
    this.bus.emit('fault.armed', { id });
  }

  disarm(id: FaultId): void {
    if (!this.set.delete(id)) return;
    this.bus.emit('fault.cleared', { id });
  }

  /**
   * Trigger point helper: returns true if `id` is armed. One-shot faults are disarmed by this call;
   * latching faults stay armed until recovery.
   */
  consume(id: FaultId): boolean {
    if (!this.set.has(id)) return false;
    if (!faultById(id)!.latching) this.disarm(id);
    return true;
  }

  clearAll(): void {
    for (const id of [...this.set]) this.disarm(id);
  }
}
