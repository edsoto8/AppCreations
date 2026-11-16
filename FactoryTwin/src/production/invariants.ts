import { MATERIAL_IDS } from '../simulation/types';
import type { Factory } from './factory';

/**
 * Structural invariants checked by tests (and optionally during long runs).
 * Returns a list of violations (empty = OK).
 */
export function checkInvariants(f: Factory): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  const note = (id: string, where: string) => {
    const prev = seen.get(id);
    if (prev) out.push(`product ${id} in two places: ${prev} and ${where}`);
    seen.set(id, where);
  };
  for (const c of f.cells) {
    c.kitRequests.forEach((p) => note(p.id, `${c.id}.kitRequests`));
    c.buffer.forEach((p) => note(p.id, `${c.id}.buffer`));
    if (c.committed < 0) out.push(`${c.id} committed < 0`);
  }
  for (const m of f.machines.values()) {
    if (m.job?.product) note(m.job.product.id, `${m.id}.job`);
    if (m.blocked) note(m.blocked.id, `${m.id}.blocked`);
    if (m.job && m.blocked) out.push(`${m.id} has a job while blocked (capacity exceeded)`);
    if (m.failed && m.state !== 'failed') out.push(`${m.id} failed but state ${m.state}`);
    if (m.state === 'running' && (m.failed || !m.job)) out.push(`${m.id} running without a job or while failed`);
  }
  for (const c of f.conveyors.values()) {
    c.items.forEach((it) => note(it.product.id, c.id));
    if (c.items.length > c.capacity) out.push(`${c.id} over capacity ${c.items.length}/${c.capacity}`);
    const pos = c.positions();
    for (let i = 1; i < pos.length; i++) {
      if (pos[i - 1] - pos[i] < c.pitch - 1e-6) out.push(`${c.id} items ${i - 1}/${i} closer than one pitch (${(pos[i - 1] - pos[i]).toFixed(3)} m)`);
    }
    if (pos.length && (pos[pos.length - 1] < -1e-6 || pos[0] > c.length + 1e-6)) out.push(`${c.id} item off the belt`);
  }
  f.infeed.forEach((p) => note(p.id, 'infeed'));
  if (f.infeed.length > f.cfg.inspection.infeedCapacity) out.push('infeed over capacity');
  f.rejectBin.forEach((p) => note(p.id, 'reject'));
  for (const v of f.agvs.vehicles) {
    const t = v.task;
    if (t?.products) t.products.forEach((p) => (f.rejectBin.includes(p) ? null : note(p.id, `${v.id}.cargo`)));
  }
  for (const pal of f.pallets.values()) pal.productIds.forEach((id) => note(id, `pallet ${pal.id}`));

  for (const id of f.products.keys()) if (!seen.has(id)) out.push(`product ${id} is live but in no container`);
  for (const id of seen.keys()) if (!f.products.has(id)) out.push(`product ${id} in a container but not live`);

  const c = f.metrics.c;
  if (c.unitsReleased !== f.products.size + c.unitsShipped + c.unitsScrapped) {
    out.push(`unit conservation: released ${c.unitsReleased} != live ${f.products.size} + shipped ${c.unitsShipped} + scrapped ${c.unitsScrapped}`);
  }
  const inv = f.inventory;
  for (const m of MATERIAL_IDS) {
    if (inv.onHand[m] < 0) out.push(`${m} on hand negative: ${inv.onHand[m]}`);
    const lhs = inv.initial[m] + inv.received[m];
    const rhs = inv.onHand[m] + inv.consumed[m] + inv.quarantined[m];
    if (lhs !== rhs) out.push(`${m} conservation: initial+received ${lhs} != onHand+consumed+quarantined ${rhs}`);
  }
  return out;
}
