/**
 * Public API of the simulation. Everything outside src/sim imports from this file only.
 *
 *   createGame(options)            -> new GameState (deterministic for the same options)
 *   stepGame(state)                -> advances exactly ONE fixed tick (TICK_SECONDS), mutating state
 *   applyCommand(state, command)   -> applies a player command between ticks, mutating state
 *   canPlaceBuilding / getTile / ... read-only queries (queries.ts)
 *   validateGameState(unknown)     -> structural check for loaded saves (validate.ts)
 *
 * Determinism: same createGame options + same sequence of (tick, command) pairs ⇒ identical
 * state. Randomness comes only from `state.rng` (rng.ts). No Math.random, Date, timers or DOM.
 *
 * Functions marked "M1 stub" are functional placeholders that keep the app alive; the
 * Simulation Engineer replaces them (world generation, AI, economy) without changing signatures.
 */
import {
  BUILDING_DEFS,
  DAYS_PER_SEASON,
  DEFAULT_PRIORITIES,
  DEMOLISH_REFUND,
  GAME_HOURS_PER_TICK,
  SETTLER_WALK_SPEED,
  START_HOUR,
  STARTING_SETTLERS,
  STARTING_STOCK,
  TERRAIN_DEFS,
  TILE_RESOURCE_START,
  TRAIT_DEFS,
} from './balance';
import {
  APPEARANCE_VARIANTS,
  EVENT_LOG_LIMIT,
  MAP_DIMENSIONS,
  NEED_MAX,
  SAVE_SCHEMA_VERSION,
  SKILL_MAX,
  STATS_HISTORY_LENGTH,
  TICK_SECONDS,
} from './constants';
import { SETTLER_FIRST_NAMES, SETTLER_LAST_NAMES } from './names';
import {
  canPlaceBuilding,
  costToAmounts,
  emptyResources,
  getBuilding,
  getStorageCapacity,
  inBounds,
  isTerrainWalkable,
  terrainAt,
  tileIndex,
} from './queries';
import { chance, createRng, deriveRng, hashSeed, nextInt, pick, shuffle } from './rng';
import {
  BUILDING_TYPES,
  RESOURCE_TYPES,
  SEASONS,
  SKILL_TYPES,
  Terrain,
  type Building,
  type BuildingType,
  type CommandResult,
  type EntityId,
  type Facing,
  type GameState,
  type LogEntry,
  type LogSeverity,
  type NewGameOptions,
  type PlayerCommand,
  type ResourceAmounts,
  type RngState,
  type Settler,
  type SimEvent,
  type TilePos,
  type TraitId,
  type WorldState,
} from './types';

export * from './types';
export * from './constants';
export * from './queries';
export { validateGameState, type ValidationResult } from './validate';
export { BUILDING_DEFS, TERRAIN_DEFS, TRAIT_DEFS, GAME_HOURS_PER_TICK, DAYLIGHT_HOURS, REAL_SECONDS_PER_GAME_DAY } from './balance';
export { hashSeed } from './rng';

export const DEFAULT_NEW_GAME_OPTIONS: NewGameOptions = {
  seed: 'frontier',
  preset: 'continent',
  mapSize: 'small',
  colonyName: 'New Hope',
  difficulty: 'normal',
};

// =============================================================================================
// createGame
// =============================================================================================

/** Build a new game. Deterministic: identical options ⇒ identical (deep-equal) state. */
export function createGame(options: NewGameOptions): GameState {
  const seedNumber = hashSeed(options.seed);
  const size = MAP_DIMENSIONS[options.mapSize];
  const world = generateWorld(seedNumber, size, size);

  const state: GameState = {
    meta: {
      schemaVersion: SAVE_SCHEMA_VERSION,
      seed: options.seed,
      seedNumber,
      preset: options.preset,
      mapSize: options.mapSize,
      difficulty: options.difficulty,
    },
    time: { tick: 0, day: 1, timeOfDay: START_HOUR, season: 'spring' },
    world,
    colony: {
      name: options.colonyName.trim() || DEFAULT_NEW_GAME_OPTIONS.colonyName,
      stock: { ...STARTING_STOCK[options.difficulty] },
      priorities: { ...DEFAULT_PRIORITIES },
    },
    settlers: [],
    buildings: [],
    weather: { current: 'clear', intensity: 0, hoursRemaining: 12 },
    activeEvents: [],
    eventLog: [],
    stats: {
      history: [],
      producedThisHour: emptyResources(),
      consumedThisHour: emptyResources(),
      totalProduced: emptyResources(),
      totalConsumed: emptyResources(),
      births: 0,
      arrivals: 0,
      deaths: 0,
      peakPopulation: 0,
      buildingsCompleted: 0,
    },
    outcome: { status: 'playing', reason: null, endedTick: null },
    rng: createRng(seedNumber),
    nextId: 1,
    nextLogId: 1,
    pendingDecisions: [],
    progress: {
      objectivesDone: [],
      unlocked: BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].placeable && BUILDING_DEFS[t].unlockedBy === null),
      toolsCrafted: 0,
      festivalYear: null,
      lastDeathTick: null,
      victoryAcknowledged: false,
    },
  };

  // Town center in the middle of the map, on cleared flat land.
  const tcDef = BUILDING_DEFS.townCenter;
  const ox = Math.floor((size - tcDef.footprint.w) / 2);
  const oy = Math.floor((size - tcDef.footprint.h) / 2);
  clearLand(world, ox - 2, oy - 2, tcDef.footprint.w + 4, tcDef.footprint.h + 4);
  const townCenter = addBuilding(state, 'townCenter', ox, oy, 'complete');

  // Founders stand around the town center.
  const spawnRng = deriveRng(seedNumber, 'founders');
  const usedNames = new Set<string>();
  for (let i = 0; i < STARTING_SETTLERS; i++) {
    const x = ox - 1 + (i % 5);
    const y = oy + tcDef.footprint.h + 1 + Math.floor(i / 5);
    const settler = createSettler(state, spawnRng, x + 0.5, y + 0.5, usedNames);
    if (townCenter.residentIds.length < tcDef.housing) {
      settler.homeId = townCenter.id;
      townCenter.residentIds.push(settler.id);
    }
    state.settlers.push(settler);
  }
  state.stats.peakPopulation = state.settlers.length;
  pushLog(state, 'good', `The founders of ${state.colony.name} arrive at the frontier.`, {
    buildingId: townCenter.id,
  });
  return state;
}

/**
 * M1 stub — replaced by Simulation Engineer (M2 world generation per preset).
 * Grass plains with seeded forest groves, rocky hills, a lake and a mountain ridge.
 */
function generateWorld(seedNumber: number, width: number, height: number): WorldState {
  const rng = deriveRng(seedNumber, 'worldgen');
  const n = width * height;
  const world: WorldState = {
    width,
    height,
    terrain: new Array<number>(n).fill(Terrain.Grass),
    elevation: new Array<number>(n).fill(0),
    resource: new Array<number>(n).fill(0),
    building: new Array<number>(n).fill(0),
    revision: 0,
  };
  const set = (x: number, y: number, terrain: Terrain, elevation: number) => {
    if (!inBounds(world, x, y)) return;
    const i = tileIndex(world, x, y);
    world.terrain[i] = terrain;
    world.elevation[i] = elevation;
    world.resource[i] =
      terrain === Terrain.Forest
        ? TILE_RESOURCE_START.forestWood
        : terrain === Terrain.Hills
          ? TILE_RESOURCE_START.hillsStone
          : terrain === Terrain.Mountain
            ? TILE_RESOURCE_START.mountainStone
            : 0;
  };
  const blob = (cx: number, cy: number, radius: number, paint: (x: number, y: number, d: number) => void) => {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        if (d <= 1 && (d < 0.7 || chance(rng, 0.6))) paint(x, y, d);
      }
    }
  };

  // Lake with a sandy shore.
  const lx = nextInt(rng, 6, Math.floor(width / 3));
  const ly = nextInt(rng, 6, height - 7);
  blob(lx, ly, 6, (x, y, d) => set(x, y, d < 0.55 ? Terrain.DeepWater : d < 0.8 ? Terrain.ShallowWater : Terrain.Sand, 0));
  // Mountain ridge with hills around it.
  const mx = nextInt(rng, Math.floor((width * 2) / 3), width - 6);
  const my = nextInt(rng, 6, height - 7);
  blob(mx, my, 5, (x, y, d) => set(x, y, d < 0.45 ? Terrain.Mountain : Terrain.Hills, d < 0.45 ? 3 : d < 0.75 ? 2 : 1));
  // Forest groves.
  const groves = Math.max(4, Math.floor((width * height) / 500));
  for (let g = 0; g < groves; g++) {
    const gx = nextInt(rng, 0, width - 1);
    const gy = nextInt(rng, 0, height - 1);
    blob(gx, gy, nextInt(rng, 2, 5), (x, y) => {
      if (inBounds(world, x, y) && terrainAt(world, x, y) === Terrain.Grass) set(x, y, Terrain.Forest, 0);
    });
  }
  return world;
}

function clearLand(world: WorldState, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!inBounds(world, x, y)) continue;
      const i = tileIndex(world, x, y);
      world.terrain[i] = Terrain.Grass;
      world.elevation[i] = 0;
      world.resource[i] = 0;
    }
  }
}

function createSettler(state: GameState, rng: RngState, x: number, y: number, usedNames: Set<string>): Settler {
  let name = '';
  for (let attempt = 0; attempt < 20 && (name === '' || usedNames.has(name)); attempt++) {
    name = `${pick(rng, SETTLER_FIRST_NAMES)} ${pick(rng, SETTLER_LAST_NAMES)}`;
  }
  usedNames.add(name);
  const traits = shuffle(rng, Object.keys(TRAIT_DEFS) as TraitId[]).slice(0, 2);
  const skills = Object.fromEntries(SKILL_TYPES.map((s) => [s, nextInt(rng, 0, Math.floor(SKILL_MAX / 2))])) as Settler['skills'];
  const favourite = pick(rng, SKILL_TYPES);
  skills[favourite] = nextInt(rng, Math.ceil(SKILL_MAX / 2), SKILL_MAX);
  return {
    id: state.nextId++,
    name,
    joinedDay: state.time.day,
    traits,
    skills,
    needs: { hunger: 80, energy: 90, happiness: 70, health: NEED_MAX },
    appearance: {
      skin: nextInt(rng, 0, APPEARANCE_VARIANTS - 1),
      hair: nextInt(rng, 0, APPEARANCE_VARIANTS - 1),
      shirt: nextInt(rng, 0, APPEARANCE_VARIANTS - 1),
    },
    pos: { x, y },
    prevPos: { x, y },
    facing: 'se',
    path: [],
    task: { kind: 'idle', phase: 'working', progress: 0 },
    activity: { kind: 'idle', label: 'Idle', progress: null, targetTile: null },
    carrying: null,
    homeId: null,
    workplaceId: null,
    xp: Object.fromEntries(SKILL_TYPES.map((s) => [s, 0])) as Settler['xp'],
    moodlets: [],
    status: {
      dehydrated: false,
      sickHoursLeft: 0,
      drinkCooldownHours: 0,
      breakingHours: 0,
      hoursWorkedSinceWake: 0,
      sulkHoursLeft: 0,
      lastSocializedTick: null,
      damageLog: {},
    },
    toolDurability: null,
    hoursSinceDecision: 0,
  };
}

function addBuilding(
  state: GameState,
  type: BuildingType,
  x: number,
  y: number,
  status: Building['status'],
): Building {
  const def = BUILDING_DEFS[type];
  const building: Building = {
    id: state.nextId++,
    type,
    origin: { x, y },
    footprint: { ...def.footprint },
    status,
    construction:
      status === 'construction'
        ? { progress: 0, workDone: 0, required: costToAmounts(def.cost), delivered: emptyResources() }
        : null,
    workerIds: [],
    residentIds: [],
    output: emptyResources(),
    productionProgress: 0,
    placedTick: state.time.tick,
  };
  state.buildings.push(building);
  setFootprint(state.world, building, building.id);
  return building;
}

function setFootprint(world: WorldState, b: Building, id: EntityId): void {
  for (let dy = 0; dy < b.footprint.h; dy++) {
    for (let dx = 0; dx < b.footprint.w; dx++) {
      const x = b.origin.x + dx;
      const y = b.origin.y + dy;
      if (inBounds(world, x, y)) world.building[tileIndex(world, x, y)] = id;
    }
  }
  world.revision++;
}

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

/** Add to the colony stock, clamped to storage capacity. Returns the amount actually stored. */
function addStock(state: GameState, amounts: ResourceAmounts): ResourceAmounts {
  const cap = getStorageCapacity(state);
  const stored = emptyResources();
  for (const r of RESOURCE_TYPES) {
    const next = Math.min(cap, state.colony.stock[r] + amounts[r]);
    stored[r] = Math.max(0, next - state.colony.stock[r]);
    state.colony.stock[r] += stored[r];
  }
  return stored;
}

// =============================================================================================
// stepGame
// =============================================================================================

/**
 * Advance the simulation by exactly one fixed tick (TICK_SECONDS sim seconds,
 * GAME_HOURS_PER_TICK game hours). Mutates `state`; returns the events that happened.
 * Does nothing once the game is lost ('won' continues as a sandbox).
 *
 * M1 stub — replaced by Simulation Engineer: settlers wander randomly, construction sites
 * progress on their own; no needs, economy, weather or events yet.
 */
export function stepGame(state: GameState): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.outcome.status === 'lost') return events;

  advanceClock(state, events);
  for (const settler of state.settlers) stepSettlerStub(state, settler);
  stepConstructionStub(state, events);
  return events;
}

function advanceClock(state: GameState, events: SimEvent[]): void {
  const t = state.time;
  const prevHour = Math.floor(t.timeOfDay);
  t.tick++;
  t.timeOfDay += GAME_HOURS_PER_TICK;
  if (t.timeOfDay >= 24) {
    t.timeOfDay -= 24;
    t.day++;
    events.push({ type: 'dayStarted', day: t.day });
    const season = SEASONS[Math.floor((t.day - 1) / DAYS_PER_SEASON) % SEASONS.length] ?? 'spring';
    if (season !== t.season) {
      t.season = season;
      events.push({ type: 'seasonChanged', season });
    }
  }
  if (Math.floor(t.timeOfDay) !== prevHour) sampleStats(state);
}

function sampleStats(state: GameState): void {
  const s = state.stats;
  s.history.push({
    tick: state.time.tick,
    day: state.time.day,
    timeOfDay: state.time.timeOfDay,
    stock: { ...state.colony.stock },
    population: state.settlers.length,
  });
  if (s.history.length > STATS_HISTORY_LENGTH) s.history.splice(0, s.history.length - STATS_HISTORY_LENGTH);
  s.producedThisHour = emptyResources();
  s.consumedThisHour = emptyResources();
}

function stepSettlerStub(state: GameState, s: Settler): void {
  s.prevPos.x = s.pos.x;
  s.prevPos.y = s.pos.y;
  const world = state.world;

  if (s.path.length === 0) {
    if (s.activity.kind !== 'idle') s.activity = { kind: 'idle', label: 'Idle', progress: null, targetTile: null };
    if (s.task.kind !== 'idle') s.task = { kind: 'idle', phase: 'working', progress: 0 };
    if (!chance(state.rng, 0.02)) return;
    const tx = Math.floor(s.pos.x) + nextInt(state.rng, -5, 5);
    const ty = Math.floor(s.pos.y) + nextInt(state.rng, -5, 5);
    if (!isTerrainWalkable(world, tx, ty) || world.building[tileIndex(world, tx, ty)] !== 0) return;
    s.path = [{ x: tx, y: ty }];
    s.task = { kind: 'wander', targetTile: { x: tx, y: ty }, phase: 'moving', progress: 0 };
    s.activity = { kind: 'wandering', label: 'Exploring the area', progress: null, targetTile: { x: tx, y: ty } };
    return;
  }

  const target = s.path[0] as TilePos;
  const gx = target.x + 0.5;
  const gy = target.y + 0.5;
  const dx = gx - s.pos.x;
  const dy = gy - s.pos.y;
  const dist = Math.hypot(dx, dy);
  const here = inBounds(world, Math.floor(s.pos.x), Math.floor(s.pos.y))
    ? TERRAIN_DEFS[terrainAt(world, Math.floor(s.pos.x), Math.floor(s.pos.y))].moveCost || 1
    : 1;
  const step = (SETTLER_WALK_SPEED * TICK_SECONDS) / here;
  s.facing = facingFor(dx, dy);
  if (dist <= step) {
    s.pos.x = gx;
    s.pos.y = gy;
    s.path.shift();
  } else {
    s.pos.x += (dx / dist) * step;
    s.pos.y += (dy / dist) * step;
  }
}

/** Iso facing: +x runs screen right-down (se), +y runs screen left-down (sw). */
export function facingFor(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'se' : 'nw';
  return dy >= 0 ? 'sw' : 'ne';
}

function stepConstructionStub(state: GameState, events: SimEvent[]): void {
  for (const b of state.buildings) {
    if (b.status !== 'construction' || !b.construction) continue;
    const def = BUILDING_DEFS[b.type];
    b.construction.workDone += GAME_HOURS_PER_TICK;
    b.construction.progress = def.buildHours > 0 ? Math.min(1, b.construction.workDone / def.buildHours) : 1;
    if (b.construction.progress >= 1) {
      b.status = 'complete';
      b.construction = null;
      state.stats.buildingsCompleted++;
      events.push({ type: 'buildingCompleted', buildingId: b.id, buildingType: b.type });
      pushLog(state, 'good', `${def.name} completed.`, { buildingId: b.id, tile: { ...b.origin } });
    }
  }
}

// =============================================================================================
// applyCommand
// =============================================================================================

/** Apply a player command between ticks. Never throws for invalid input: returns `ok: false`. */
export function applyCommand(state: GameState, command: PlayerCommand): CommandResult {
  if (state.outcome.status === 'lost') {
    return { ok: false, error: 'gameOver', message: 'The colony has fallen.' };
  }
  switch (command.type) {
    case 'placeBuilding':
      return placeBuilding(state, command.buildingType, command.x, command.y);
    case 'cancelBuilding':
      return removeBuilding(state, command.buildingId, 'cancelled');
    case 'demolishBuilding':
      return removeBuilding(state, command.buildingId, 'demolished');
    case 'setPriority': {
      if (!(command.category in state.colony.priorities) || ![0, 1, 2, 3].includes(command.level)) {
        return { ok: false, error: 'invalidArgument', message: 'Unknown job category or priority level.' };
      }
      state.colony.priorities[command.category] = command.level;
      return { ok: true, entityId: null, events: [{ type: 'priorityChanged', category: command.category, level: command.level }] };
    }
    case 'renameColony': {
      const name = command.name.trim().slice(0, 40);
      if (!name) return { ok: false, error: 'invalidArgument', message: 'The colony needs a name.' };
      state.colony.name = name;
      return { ok: true, entityId: null, events: [] };
    }
    case 'resolveEvent':
      return resolveEventStub(state, command.eventId, command.accept);
    case 'acknowledgeVictory': {
      if (state.outcome.status !== 'won') return { ok: false, error: 'invalidState', message: 'The colony has not won yet.' };
      state.progress.victoryAcknowledged = true;
      return { ok: true, entityId: null, events: [] };
    }
  }
}

/** M1 stub — replaced by Simulation Engineer: removes the decision without applying its effects. */
function resolveEventStub(state: GameState, eventId: number, accept: boolean): CommandResult {
  const index = state.pendingDecisions.findIndex((d) => d.eventId === eventId);
  if (index < 0) return { ok: false, error: 'notFound', message: 'That decision is no longer open.' };
  const [decision] = state.pendingDecisions.splice(index, 1);
  pushLog(state, 'info', `${accept ? 'Accepted' : 'Declined'}: ${decision?.kind ?? 'event'}.`);
  return { ok: true, entityId: null, events: [] };
}

/**
 * M1 stub — replaced by Simulation Engineer: the cost is taken from the stock and counted as
 * delivered at once (no hauling yet).
 */
function placeBuilding(state: GameState, type: BuildingType, x: number, y: number): CommandResult {
  if (!(type in BUILDING_DEFS)) return { ok: false, error: 'invalidArgument', message: `Unknown building type.` };
  const check = canPlaceBuilding(state, type, x, y);
  if (!check.ok) return { ok: false, error: check.error ?? 'invalidState', message: check.message ?? 'Cannot build here.' };
  const def = BUILDING_DEFS[type];
  const building = addBuilding(state, type, x, y, def.buildHours > 0 ? 'construction' : 'complete');
  const cost = costToAmounts(def.cost);
  for (const r of RESOURCE_TYPES) state.colony.stock[r] -= cost[r];
  if (building.construction) building.construction.delivered = { ...cost };
  pushLog(state, 'info', `Construction of a ${def.name} was ordered.`, { buildingId: building.id, tile: { x, y } });
  return { ok: true, entityId: building.id, events: [{ type: 'buildingPlaced', buildingId: building.id, buildingType: type }] };
}

function removeBuilding(state: GameState, id: EntityId, reason: 'cancelled' | 'demolished'): CommandResult {
  const b = getBuilding(state, id);
  if (!b) return { ok: false, error: 'notFound', message: 'That building no longer exists.' };
  const def = BUILDING_DEFS[b.type];
  if (b.type === 'townCenter') return { ok: false, error: 'invalidState', message: 'The town center cannot be removed.' };
  if (reason === 'cancelled' && b.status !== 'construction') {
    return { ok: false, error: 'invalidState', message: 'Only construction sites can be cancelled.' };
  }
  if (reason === 'demolished' && b.status !== 'complete') {
    return { ok: false, error: 'invalidState', message: 'Cancel the construction site instead.' };
  }

  const refund = emptyResources();
  if (b.construction) Object.assign(refund, b.construction.delivered);
  else for (const r of RESOURCE_TYPES) refund[r] = Math.floor((def.cost[r] ?? 0) * DEMOLISH_REFUND);

  state.buildings.splice(state.buildings.indexOf(b), 1);
  setFootprint(state.world, b, 0);
  addStock(state, refund);
  for (const s of state.settlers) {
    if (s.homeId === id) s.homeId = null;
    if (s.workplaceId === id) s.workplaceId = null;
    if ('buildingId' in s.task && s.task.buildingId === id) {
      s.task = { kind: 'idle', phase: 'working', progress: 0 };
      s.activity = { kind: 'idle', label: 'Idle', progress: null, targetTile: null };
      s.path = [];
    }
  }
  pushLog(state, 'info', `${def.name} ${reason === 'cancelled' ? 'construction cancelled' : 'demolished'}.`, {
    tile: { ...b.origin },
  });
  return { ok: true, entityId: null, events: [{ type: 'buildingRemoved', buildingId: id, buildingType: b.type, reason }] };
}
