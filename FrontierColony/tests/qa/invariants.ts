/**
 * Shared invariant checks for the QA soak and save tests. Test helper only (not a test file:
 * vitest picks up `tests/**\/*.test.ts`).
 */
import {
  BUILDING_DEFS,
  NEED_MAX,
  RESOURCE_TYPES,
  getOutstandingMaterials,
  getStorageCapacity,
  type GameState,
  type Task,
} from '../../src/sim';

/** Walk every value reachable from `root` and return the paths of NaN, Infinity or undefined leaves. */
export function findNonFinite(root: unknown, limit = 20): string[] {
  const bad: string[] = [];
  const stack: { value: unknown; path: string }[] = [{ value: root, path: '$' }];
  while (stack.length > 0 && bad.length < limit) {
    const { value, path } = stack.pop()!;
    if (value === undefined) {
      bad.push(`${path} is undefined`);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) bad.push(`${path} is ${String(value)}`);
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) stack.push({ value: value[i], path: `${path}[${i}]` });
      } else {
        for (const [k, v] of Object.entries(value)) stack.push({ value: v, path: `${path}.${k}` });
      }
    }
  }
  return bad;
}

/** Returns a list of violated resource bounds (empty when everything is within 0..capacity). */
export function resourceViolations(state: GameState): string[] {
  const cap = getStorageCapacity(state);
  const out: string[] = [];
  for (const r of RESOURCE_TYPES) {
    const v = state.colony.stock[r];
    if (!(v >= 0)) out.push(`stock.${r} = ${v} (negative)`);
    if (v > cap) out.push(`stock.${r} = ${v} exceeds capacity ${cap}`);
  }
  return out;
}

/** Returns a list of population violations (negative counts, mismatched counters). */
export function populationViolations(state: GameState): string[] {
  const out: string[] = [];
  if (state.settlers.length < 0) out.push('negative settler count');
  if (state.stats.deaths < 0 || state.stats.births < 0 || state.stats.arrivals < 0) out.push('negative lifetime counter');
  const ids = new Set(state.settlers.map((s) => s.id));
  if (ids.size !== state.settlers.length) out.push('duplicate settler ids');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Strict invariants (TEST-3 in docs/reviews/M5-review.md). No slack: stock <= capacity exactly.
// ---------------------------------------------------------------------------------------------

/** Ids that a task or event points at, checked against the entities that really exist. */
function taskRefs(task: Task): { building: (number | null)[]; settler: (number | null)[] } {
  switch (task.kind) {
    case 'gather':
      return { building: [task.dropOffBuildingId], settler: [] };
    case 'haul':
      return { building: [task.fromBuildingId, task.toBuildingId], settler: [] };
    case 'construct':
    case 'work':
    case 'eat':
    case 'drink':
      return { building: [task.buildingId], settler: [] };
    case 'sleep':
    case 'rest':
      return { building: [task.buildingId], settler: [] };
    case 'socialize':
      return { building: [], settler: [task.withSettlerId] };
    default:
      return { building: [], settler: [] };
  }
}

/** Returns every violated strict invariant (an empty list means the state is clean). */
export function strictViolations(state: GameState): string[] {
  const out: string[] = [];
  const cap = getStorageCapacity(state);
  const buildingIds = new Set(state.buildings.map((b) => b.id));
  const settlerIds = new Set(state.settlers.map((s) => s.id));

  // Ids: unique, positive, below the counter, and shared between settlers and buildings.
  const seen = new Set<number>();
  for (const id of [...buildingIds, ...settlerIds]) {
    if (!(id > 0) || id >= state.nextId) out.push(`id ${id} is outside 1..nextId-1`);
    if (seen.has(id)) out.push(`id ${id} is used twice`);
    seen.add(id);
  }

  // Stock: 0 <= stock <= capacity; reserved (outstanding construction) never exceeds stock.
  const reserved = getOutstandingMaterials(state);
  for (const r of RESOURCE_TYPES) {
    const v = state.colony.stock[r];
    if (!(v >= 0)) out.push(`stock.${r} = ${v} is negative`);
    if (v > cap) out.push(`stock.${r} = ${v} exceeds capacity ${cap}`);
    if (reserved[r] > v + 1e-9) out.push(`reserved.${r} = ${reserved[r]} exceeds stock ${v}`);
  }

  // Buildings: non-negative buffers and construction amounts; delivered never exceeds required.
  for (const b of state.buildings) {
    for (const r of RESOURCE_TYPES) {
      if (!(b.output[r] >= 0)) out.push(`building ${b.id} output.${r} = ${b.output[r]} is negative`);
      const c = b.construction;
      if (c === null) continue;
      if (!(c.delivered[r] >= 0)) out.push(`building ${b.id} delivered.${r} is negative`);
      if (c.delivered[r] > c.required[r] + 1e-9) out.push(`building ${b.id} delivered.${r} exceeds required`);
    }
  }

  // Settlers: needs in range, carried amounts positive, references resolve.
  const gatherTiles = new Map<string, number>();
  for (const s of state.settlers) {
    for (const k of ['hunger', 'energy', 'happiness', 'health'] as const) {
      const v = s.needs[k];
      if (!(v >= 0 && v <= NEED_MAX)) out.push(`settler ${s.id} ${k} = ${v} is outside 0..${NEED_MAX}`);
    }
    if (s.carrying !== null && !(s.carrying.amount > 0)) out.push(`settler ${s.id} carries ${s.carrying.amount}`);
    if (s.homeId !== null && !buildingIds.has(s.homeId)) out.push(`settler ${s.id} homeId ${s.homeId} does not exist`);
    if (s.workplaceId !== null && !buildingIds.has(s.workplaceId)) out.push(`settler ${s.id} workplaceId ${s.workplaceId} does not exist`);
    const refs = taskRefs(s.task);
    for (const b of refs.building) if (b !== null && !buildingIds.has(b)) out.push(`settler ${s.id} task ${s.task.kind} points at missing building ${b}`);
    for (const t of refs.settler) if (t !== null && !settlerIds.has(t)) out.push(`settler ${s.id} task ${s.task.kind} points at missing settler ${t}`);
    if (s.task.kind === 'gather') {
      const key = `${s.task.targetTile.x},${s.task.targetTile.y}`;
      gatherTiles.set(key, (gatherTiles.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of gatherTiles) if (n > 1) out.push(`${n} settlers gather from tile ${key}`);

  // Workers and builders per building stay within the caps. Gatherers and workers count against
  // maxWorkers; builders against maxBuilders (their workplaceId is the construction site).
  const workers = new Map<number, number>();
  const builders = new Map<number, number>();
  for (const s of state.settlers) {
    if (s.workplaceId === null) continue;
    if (s.task.kind === 'work') workers.set(s.workplaceId, (workers.get(s.workplaceId) ?? 0) + 1);
    if (s.task.kind === 'construct') builders.set(s.workplaceId, (builders.get(s.workplaceId) ?? 0) + 1);
  }
  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    const n = workers.get(b.id) ?? 0;
    if (b.status === 'complete' && n > def.maxWorkers) out.push(`building ${b.id} (${b.type}) has ${n} workers, max ${def.maxWorkers}`);
    const m = builders.get(b.id) ?? 0;
    if (m > def.maxBuilders) out.push(`building ${b.id} (${b.type}) has ${m} builders, max ${def.maxBuilders}`);
  }

  // Active events and pending decisions.
  for (const e of state.activeEvents) {
    if (e.targetId !== null && !settlerIds.has(e.targetId) && !buildingIds.has(e.targetId)) {
      out.push(`active event ${e.kind} targets missing entity ${e.targetId}`);
    }
  }
  const decisionIds = new Set<number>();
  for (const d of state.pendingDecisions) {
    if (decisionIds.has(d.eventId)) out.push(`decision ${d.eventId} appears twice`);
    decisionIds.add(d.eventId);
    if (d.eventId >= state.nextLogId) out.push(`decision ${d.eventId} is not below nextLogId`);
  }
  return out;
}

/** Total of every resource the colony holds: stock, building buffers, construction deliveries, goods in hand and tools held by settlers. */
export function totalHeld(state: GameState): number {
  let total = 0;
  for (const r of RESOURCE_TYPES) {
    total += state.colony.stock[r];
    for (const b of state.buildings) {
      total += b.output[r];
      if (b.construction !== null) total += b.construction.delivered[r];
    }
    for (const s of state.settlers) if (s.carrying !== null && s.carrying.resource === r) total += s.carrying.amount;
  }
  // A tool held by a settler is one tool: it returns to stock when the settler leaves or dies.
  for (const s of state.settlers) if (s.toolDurability !== null) total += 1;
  return total;
}
