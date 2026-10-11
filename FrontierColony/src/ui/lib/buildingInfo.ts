/** Building status wording and demolish refunds (docs/GAME_DESIGN.md §15). Pure, so it is unit tested. */
import { BUILDING_DEFS, DEMOLISH_REFUND, RESOURCE_TYPES, type ResourceAmounts, type Season } from '../../sim';
import type { BuildingDetail } from '../../store';

export interface BuildingStatusLine {
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

/** Status wording from GAME_DESIGN §15. Pure so it can be tested. */
export function buildingStatus(b: BuildingDetail, outputCap: number, season: Season | null): BuildingStatusLine {
  const def = BUILDING_DEFS[b.type];
  if (b.status === 'construction' && b.construction) {
    if (b.construction.kind === 'repair') return { text: 'Being repaired', tone: 'warn' };
    const missing = RESOURCE_TYPES.some((r) => b.construction!.delivered[r] < b.construction!.required[r]);
    return { text: missing ? 'Under construction: waiting for materials' : 'Under construction', tone: missing ? 'warn' : 'neutral' };
  }
  if (def.production?.output === 'food' && season === 'winter') return { text: 'Fallow (winter)', tone: 'warn' };
  if (def.maxWorkers > 0) {
    if (outputCap > 0 && RESOURCE_TYPES.some((r) => b.output[r] >= outputCap)) return { text: 'Output full: needs hauling', tone: 'warn' };
    if (b.workers.length === 0) return { text: 'No workers', tone: 'warn' };
    return { text: `Working (${b.workers.length}/${def.maxWorkers})`, tone: 'good' };
  }
  if (def.housing > 0) return { text: `Housing ${b.residents.length}/${def.housing}`, tone: 'good' };
  return { text: 'Active', tone: 'good' };
}

/** Refund for demolishing a completed building (floored per resource, like the sim). */
export function demolishRefund(cost: Partial<ResourceAmounts>): Partial<ResourceAmounts> {
  const out: Partial<ResourceAmounts> = {};
  for (const r of RESOURCE_TYPES) {
    const n = Math.floor((cost[r] ?? 0) * DEMOLISH_REFUND);
    if (n > 0) out[r] = n;
  }
  return out;
}

