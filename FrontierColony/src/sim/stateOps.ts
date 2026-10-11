/**
 * Small mutating helpers shared by the sim modules: event log, stock, statistics, building
 * footprints and removing entities with full reference cleanup.
 */
import { BUILDING_DEFS } from './balance';
import { EVENT_LOG_LIMIT } from './constants';
import { getStorageCapacity } from './queries';
import {
  RESOURCE_TYPES,
  type Building,
  type EntityId,
  type GameState,
  type LogEntry,
  type LogSeverity,
  type ResourceType,
  type Settler,
  type SimEvent,
  type Task,
  type TilePos,
} from './types';

/** Append to the persisted event log (capped). */
export function pushLog(
  state: GameState,
  severity: LogSeverity,
  message: string,
  refs: { settlerId?: EntityId; buildingId?: EntityId; tile?: TilePos } = {},
): LogEntry {
  const entry: LogEntry = {
    id: state.nextLogId++,
    tick: state.time.tick,
    day: state.time.day,
    timeOfDay: state.time.timeOfDay,
    severity,
    message,
    settlerId: refs.settlerId ?? null,
    buildingId: refs.buildingId ?? null,
    tile: refs.tile ?? null,
  };
  state.eventLog.push(entry);
  if (state.eventLog.length > EVENT_LOG_LIMIT) state.eventLog.splice(0, state.eventLog.length - EVENT_LOG_LIMIT);
  return entry;
}

/** Add one resource to the colony stock, clamped to storage capacity. Returns the amount stored. */
export function addStockOf(state: GameState, resource: ResourceType, amount: number): number {
  const cap = getStorageCapacity(state);
  const next = Math.min(cap, state.colony.stock[resource] + amount);
  const stored = Math.max(0, next - state.colony.stock[resource]);
  state.colony.stock[resource] += stored;
  return stored;
}

// Goods that could not be stored are queued here during a tick and announced (event + log) when the tick ends.
const lossQueue = new WeakMap<GameState, { resource: ResourceType; amount: number; reason: string }[]>();

/** Record goods destroyed because the storage was full. Announced by `drainLosses`. */
export function reportLoss(state: GameState, resource: ResourceType, amount: number, reason: string): void {
  if (amount <= 0) return;
  let list = lossQueue.get(state);
  if (!list) {
    list = [];
    lossQueue.set(state, list);
  }
  list.push({ resource, amount, reason });
}

/** Emit a `goodsLost` event and one log line per loss recorded since the last call. */
export function drainLosses(state: GameState, events: SimEvent[]): void {
  const list = lossQueue.get(state);
  if (!list || list.length === 0) return;
  for (const l of list) {
    events.push({ type: 'goodsLost', resource: l.resource, amount: l.amount, reason: l.reason });
    pushLog(state, 'warning', `Storage full: ${Math.round(l.amount * 10) / 10} ${l.resource} lost (${l.reason}).`);
  }
  list.length = 0;
}

/** Add to the stock; whatever does not fit is lost and announced. Returns the amount stored. */
export function addStockOrLose(state: GameState, resource: ResourceType, amount: number, reason: string): number {
  const stored = addStockOf(state, resource, amount);
  reportLoss(state, resource, amount - stored, reason);
  return stored;
}

/** Add to the colony stock, clamped to storage capacity. Returns the amounts actually stored. */
export function addStock(state: GameState, amounts: Record<ResourceType, number>): Record<ResourceType, number> {
  const stored = { wood: 0, stone: 0, food: 0, water: 0, tools: 0 };
  for (const r of RESOURCE_TYPES) stored[r] = addStockOf(state, r, amounts[r]);
  return stored;
}

export function recordProduced(state: GameState, resource: ResourceType, amount: number): void {
  state.stats.producedThisHour[resource] += amount;
  state.stats.totalProduced[resource] += amount;
}

export function recordConsumed(state: GameState, resource: ResourceType, amount: number): void {
  state.stats.consumedThisHour[resource] += amount;
  state.stats.totalConsumed[resource] += amount;
}

/** Write `id` into the building layer for every footprint tile and bump the world revision. */
export function setFootprint(state: GameState, b: Building, id: EntityId): void {
  const world = state.world;
  for (let dy = 0; dy < b.footprint.h; dy++) {
    for (let dx = 0; dx < b.footprint.w; dx++) {
      const x = b.origin.x + dx;
      const y = b.origin.y + dy;
      if (x >= 0 && y >= 0 && x < world.width && y < world.height) world.building[y * world.width + x] = id;
    }
  }
  world.revision++;
}

export const IDLE_TASK = (): Task => ({ kind: 'idle', phase: 'working', progress: 0 });

/** True when the task refers to the building (as target, source, drop-off or bed). */
export function taskReferencesBuilding(task: Task, id: EntityId): boolean {
  switch (task.kind) {
    case 'gather':
      return task.dropOffBuildingId === id;
    case 'haul':
      return task.toBuildingId === id || task.fromBuildingId === id;
    case 'construct':
    case 'work':
    case 'eat':
    case 'drink':
      return task.buildingId === id;
    case 'sleep':
    case 'rest':
      return task.buildingId === id;
    case 'idle':
    case 'wander':
    case 'socialize':
    case 'depart':
      return false;
  }
}

/**
 * Put a settler's carried goods back into the stock (clamped to capacity), release the work slot
 * and clear the path and task. Used when a task is aborted or its target disappears.
 */
export function abortSettlerTask(state: GameState, s: Settler): void {
  if (s.carrying) {
    // Back into the stockpile; if that is full, into the workplace's own buffer; only then is it lost.
    const load = s.carrying;
    let rest = load.amount - addStockOf(state, load.resource, load.amount);
    const work = rest > 0 && s.workplaceId !== null ? findBuilding(state, s.workplaceId) : null;
    if (work !== null && rest > 0) {
      const room = Math.max(0, BUILDING_DEFS[work.type].outputCap - work.output[load.resource]);
      const moved = Math.min(rest, room);
      work.output[load.resource] += moved;
      rest -= moved;
    }
    reportLoss(state, load.resource, rest, 'a task was cancelled');
    s.carrying = null;
  }
  s.workplaceId = null;
  s.path = [];
  s.task = IDLE_TASK();
}

/**
 * Remove a settler from the colony (death or departure) and clear every reference to them.
 * The caller logs and emits the relevant event.
 */
export function removeSettler(state: GameState, id: EntityId): Settler | null {
  const index = state.settlers.findIndex((s) => s.id === id);
  if (index < 0) return null;
  const settler = state.settlers[index] as Settler;
  if (settler.toolDurability !== null) {
    addStockOrLose(state, 'tools', 1, 'a tool was returned');
    settler.toolDurability = null;
  }
  abortSettlerTask(state, settler);
  state.settlers.splice(index, 1);
  // Events that targeted this settler (the wolves' victim) keep running without a target.
  for (const e of state.activeEvents) if (e.targetId === id) e.targetId = null;
  for (const other of state.settlers) {
    if (other.task.kind === 'socialize' && other.task.withSettlerId === id) other.task.withSettlerId = null;
  }
  return settler;
}

/** Abort every task that uses the building (as workplace, source, destination, drop-off or bed). Homes are kept. */
export function releaseBuildingUsers(state: GameState, id: EntityId): void {
  for (const s of state.settlers) {
    if (s.workplaceId === id || taskReferencesBuilding(s.task, id)) abortSettlerTask(state, s);
  }
}

/**
 * Remove a building and clear every reference to it: residents become homeless, workers lose
 * their workplace, any task that points at it is aborted, and events that target it end.
 * Does not touch the stock.
 */
export function clearBuildingReferences(state: GameState, id: EntityId): void {
  for (const s of state.settlers) if (s.homeId === id) s.homeId = null;
  releaseBuildingUsers(state, id);
  state.activeEvents = state.activeEvents.filter((e) => e.targetId !== id);
}

/** Mood events are queued as moodlets; this keeps the cap on stacking ones. */
export function addTimedMoodlet(s: Settler, id: string, value: number, hours: number, maxStacks: number): void {
  let stacks = 0;
  let oldest = -1;
  for (let i = 0; i < s.moodlets.length; i++) {
    const m = s.moodlets[i] as Settler['moodlets'][number];
    if (m.id !== id) continue;
    stacks++;
    if (oldest < 0 || (m.hoursLeft ?? 0) < ((s.moodlets[oldest] as Settler['moodlets'][number]).hoursLeft ?? 0)) oldest = i;
  }
  if (stacks >= maxStacks && oldest >= 0) s.moodlets.splice(oldest, 1);
  s.moodlets.push({ id, value, hoursLeft: hours });
}

/** Find a building by id. */
export function findBuilding(state: GameState, id: EntityId): Building | null {
  const list = state.buildings;
  for (let i = 0; i < list.length; i++) if ((list[i] as Building).id === id) return list[i] as Building;
  return null;
}

export function buildingName(b: Building): string {
  return BUILDING_DEFS[b.type].name;
}

export function pushEvent(events: SimEvent[], event: SimEvent): void {
  events.push(event);
}
