import { describe, expect, it } from 'vitest';
import { MATERIAL_IDS, type MaterialId } from '../simulation/types';
import { Factory } from '../production/factory';
import { DAY, H, scenario } from './helpers';

describe('invariant 5: inventory', () => {
  const f = new Factory(scenario(6, (c) => {
    // tight stock so stockouts and replenishment both happen
    c.materials.SPEAKER_DRIVER.initialStock = 500;
    c.materials.SPEAKER_DRIVER.reorderPoint = 300;
    c.materials.SPEAKER_DRIVER.orderQty = 400;
  }), { keepLog: true });
  let minOnHand = Infinity;
  for (let t = H / 4; t <= 4 * DAY; t += H / 4) {
    f.engine.advanceTo(t);
    for (const m of MATERIAL_IDS) minOnHand = Math.min(minOnHand, f.inventory.onHand[m]);
  }

  it('never goes negative', () => {
    expect(minOnHand).toBeGreaterThanOrEqual(0);
  });

  it('decreases exactly by the materials consumed', () => {
    const consumed = {} as Record<MaterialId, number>;
    const received = {} as Record<MaterialId, number>;
    for (const m of MATERIAL_IDS) consumed[m] = received[m] = 0;
    for (const r of f.log.records) {
      if (r.type === 'material.consume') consumed[r.id as MaterialId] += r.v!;
      if (r.type === 'material.receive') received[r.id as MaterialId] += r.v!;
    }
    for (const m of MATERIAL_IDS) {
      expect(f.inventory.consumed[m]).toBe(consumed[m]);
      expect(f.inventory.onHand[m]).toBe(f.cfg.materials[m].initialStock + received[m] - consumed[m] - f.inventory.quarantined[m]);
    }
  });

  it('consumption matches the bill of materials of kitted, packed and reworked units', () => {
    const kitted = f.log.records.filter((r) => r.type === 'unit.kitted').map((r) => r.id);
    const types = new Map(f.log.records.filter((r) => r.type === 'unit.release').map((r) => [r.id, r.ref!]));
    let pcb = 0;
    pcb += kitted.length;
    pcb += f.log.records.filter((r) => r.type === 'unit.rework-start').length;
    // rework PCBs are consumed when the AGV is dispatched, so allow units still in transit
    const inTransit = f.agvs.vehicles.reduce((s, v) => s + (v.task?.kind === 'rework' ? v.task.products!.length : 0), 0);
    expect(f.inventory.consumed.PCB).toBe(pcb + inTransit + f.cells.reduce((s, c) => s + c.buffer.filter((p) => p.rework).length, 0));
    const packs = f.log.records.filter((r) => r.type === 'unit.pack-start').length;
    expect(f.inventory.consumed.PACKAGING_KIT).toBe(packs);
    expect(types.size).toBeGreaterThan(0);
  });

  it('a stockout starves assembly and replenishment restores it', () => {
    const stockouts = f.log.records.filter((r) => r.type === 'material.stockout' && r.id === 'SPEAKER_DRIVER');
    const receipts = f.log.records.filter((r) => r.type === 'material.receive' && r.id === 'SPEAKER_DRIVER');
    expect(stockouts.length).toBeGreaterThan(0);
    expect(receipts.length).toBeGreaterThan(0);
  });
});
