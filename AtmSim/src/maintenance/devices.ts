import type { EventBus } from '../core/events';
import type { DeviceHealth, DeviceId, DeviceStatus } from '../core/types';
import type { Journal } from '../transactions/journal';

const DEVICE_NAMES: Record<DeviceId, string> = {
  cardReader: 'Motorised card reader',
  contactless: 'Contactless reader',
  dispenser: 'Cash dispenser',
  printer: 'Receipt printer',
  depositModule: 'Deposit module',
  network: 'Network link',
  host: 'Bank host link',
  power: 'Power supply',
  keypad: 'PIN pad (simulated EPP)',
  display: 'Display',
};

const DEFAULT_METRICS: Record<DeviceId, Record<string, number>> = {
  cardReader: { reads: 0, retained: 0 },
  contactless: { taps: 0 },
  dispenser: { picks: 0, rejects: 0, dispenses: 0, retracts: 0 },
  printer: { paperPct: 100, receipts: 0 },
  depositModule: { notesAccepted: 0, notesReturned: 0 },
  network: { messages: 0 },
  host: { declines91: 0 },
  power: { outages: 0 },
  keypad: { keyPresses: 0 },
  display: {},
};

/**
 * Device health monitor. Real ATMs talk to each device through an XFS-style "service provider" that
 * reports status (OK / WARNING / FAULT / OFFLINE) and counters; the ATM application uses this to decide
 * which services to offer (e.g. "Receipts unavailable").
 */
export class DeviceManager {
  private devices = new Map<DeviceId, DeviceHealth>();

  constructor(
    private readonly bus: EventBus,
    private readonly journal: Journal,
  ) {
    for (const id of Object.keys(DEVICE_NAMES) as DeviceId[]) {
      this.devices.set(id, { id, name: DEVICE_NAMES[id], status: 'OK', detail: 'Operational', metrics: { ...DEFAULT_METRICS[id] } });
    }
  }

  get(id: DeviceId): DeviceHealth {
    return this.devices.get(id)!;
  }

  all(): DeviceHealth[] {
    return [...this.devices.values()];
  }

  isOk(id: DeviceId): boolean {
    const s = this.get(id).status;
    return s === 'OK' || s === 'WARNING';
  }

  /** Change status; journals and emits only when something actually changed. */
  set(id: DeviceId, status: DeviceStatus, detail: string): void {
    const d = this.get(id);
    if (d.status === status && d.detail === detail) return;
    const prev = d.status;
    d.status = status;
    d.detail = detail;
    this.journal.log('DEVICE', `${d.name}: ${prev} → ${status} (${detail})`);
    this.bus.emit('device.changed', { device: d });
  }

  /** Increment / set a metric and notify listeners. */
  metric(id: DeviceId, key: string, delta: number, absolute = false): void {
    const d = this.get(id);
    d.metrics[key] = absolute ? delta : (d.metrics[key] ?? 0) + delta;
    this.bus.emit('device.changed', { device: d });
  }
}
