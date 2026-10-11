/**
 * Public API of the simulation. Everything outside src/sim imports from this file only.
 *
 *   createGame(options)            -> new GameState (deterministic for the same options)
 *   stepGame(state)                -> advances exactly ONE fixed tick (TICK_SECONDS), mutating state
 *   applyCommand(state, command)   -> applies a player command between ticks, mutating state
 *   canPlaceBuilding / getTile / ... read-only queries (queries.ts)
 *   validateGameState(unknown)     -> structural and value check for loaded saves (validate.ts)
 *
 * Determinism: same createGame options + same sequence of (tick, command) pairs ⇒ identical
 * state. Randomness comes only from `state.rng` (rng.ts). No Math.random, Date, timers or DOM.
 *
 * Functions marked "M1 stub" are functional placeholders that keep the app alive; the
 * Simulation Engineer replaces them (economy, events, weather) without changing signatures.
 */
import {
  BUILDING_DEFS,
  DAYS_PER_SEASON,
  DEFAULT_PRIORITIES,
  DEMOLISH_REFUND,
  GAME_HOURS_PER_TICK,
  START_HOUR,
  STARTING_STOCK,
} from './balance';
import { SAVE_SCHEMA_VERSION, STATS_HISTORY_LENGTH } from './constants';
import { makeContext } from './needs';
import { resolveDecision, stepSchedule } from './events';
import { adjustWeatherForSeason, stepWeather } from './weather';
import { canPlaceBuilding, costToAmounts, emptyResources, getBuilding, getStorageCapacity, isTerrainWalkable } from './queries';
import { createRng, deriveRng, hashSeed, shuffle } from './rng';
import { assignHomes, ejectSettlers, stepSettlers } from './settlerSim';
import { createFounders } from './settlerGen';
import { addStockOrLose, clearBuildingReferences, drainLosses, pushLog, setFootprint } from './stateOps';
import {
  BUILDING_TYPES,
  DIFFICULTIES,
  JOB_CATEGORIES,
  MAP_PRESETS,
  MAP_SIZES,
  RESOURCE_TYPES,
  SEASONS,
  type Building,
  type BuildingType,
  type CommandResult,
  type EntityId,
  type GameState,
  type NewGameOptions,
  type PlayerCommand,
  type ResourceAmounts,
  type SimEvent,
  type TilePos,
} from './types';
import { generateWorld } from './worldgen';

export * from './types';
export * from './constants';
export * from './queries';
export { validateGameState, type ValidationResult } from './validate';
export {
  BUILDING_DEFS,
  TERRAIN_DEFS,
  TRAIT_DEFS,
  GAME_HOURS_PER_TICK,
  DAYLIGHT_HOURS,
  REAL_SECONDS_PER_GAME_DAY,
  DAYS_PER_SEASON,
  DEMOLISH_REFUND,
  XP_TO_NEXT_LEVEL_PER_LEVEL,
  TOOLS,
  TOOL_DURABILITY_HOURS,
  MOODLETS,
  OBJECTIVES,
  VICTORY,
  OBJECTIVE_TARGETS,
  FOOD_PER_SETTLER_DAY,
  WATER_PER_SETTLER_DAY,
  POPULATION_CAP,
  DIFFICULTY,
  DAY_PHASES,
  MOOD_BANDS,
  type ObjectiveDef,
  type MoodletDef,
  type MoodBandDef,
} from './balance';
export { hashSeed } from './rng';
export * from './grid';
export { evaluateStartSite, type StartSiteReport } from './worldgen';
export { findPath, accessGoal, tileGoal, getLastPathStats, type PathGoal, type PathResult } from './pathfinding';

export const DEFAULT_NEW_GAME_OPTIONS: NewGameOptions = {
  seed: 'frontier',
  preset: 'continent',
  mapSize: 'small',
  colonyName: 'New Hope',
  difficulty: 'normal',
};

/** Longest accepted seed and colony name (characters). */
export const MAX_SEED_LENGTH = 64;
export const MAX_COLONY_NAME_LENGTH = 40;

// =============================================================================================
// createGame
// =============================================================================================

/** Clamp and validate options: unknown enum values fall back to the defaults, strings are length-capped. */
function sanitizeOptions(options: NewGameOptions): NewGameOptions {
  const o = (typeof options === 'object' && options !== null ? options : {}) as Partial<Record<keyof NewGameOptions, unknown>>;
  const text = (v: unknown, max: number, fallback: string): string => {
    const trimmed = typeof v === 'string' ? v.trim().slice(0, max).trim() : '';
    return trimmed === '' ? fallback : trimmed;
  };
  const pickOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  return {
    seed: text(o.seed, MAX_SEED_LENGTH, DEFAULT_NEW_GAME_OPTIONS.seed),
    preset: pickOf(o.preset, MAP_PRESETS, DEFAULT_NEW_GAME_OPTIONS.preset),
    mapSize: pickOf(o.mapSize, MAP_SIZES, DEFAULT_NEW_GAME_OPTIONS.mapSize),
    colonyName: text(o.colonyName, MAX_COLONY_NAME_LENGTH, DEFAULT_NEW_GAME_OPTIONS.colonyName),
    difficulty: pickOf(o.difficulty, DIFFICULTIES, DEFAULT_NEW_GAME_OPTIONS.difficulty),
  };
}

/** Build a new game. Deterministic: identical options ⇒ identical (deep-equal) state. Never throws. */
export function createGame(rawOptions: NewGameOptions): GameState {
  const options = sanitizeOptions(rawOptions);
  const seedNumber = hashSeed(options.seed);
  const generated = generateWorld(seedNumber, options.preset, options.mapSize);
  const world = generated.world;

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
      name: options.colonyName,
      usedNames: [],
      graveyard: [],
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

  // Town center on the start site chosen by the world generator, founders on the ring around it.
  const tcDef = BUILDING_DEFS.townCenter;
  const { x: ox, y: oy } = generated.townCenter;
  const townCenter = addBuilding(state, 'townCenter', ox, oy, 'complete');

  const spawnRng = deriveRng(seedNumber, 'founders');
  const ring: TilePos[] = [];
  for (let y = oy - 1; y <= oy + tcDef.footprint.h; y++) {
    for (let x = ox - 1; x <= ox + tcDef.footprint.w; x++) {
      const inside = x >= ox && x < ox + tcDef.footprint.w && y >= oy && y < oy + tcDef.footprint.h;
      if (!inside && isTerrainWalkable(world, x, y)) ring.push({ x, y });
    }
  }
  shuffle(spawnRng, ring);
  for (const settler of createFounders(state, spawnRng, ring)) state.settlers.push(settler);
  assignHomes(state);
  state.stats.peakPopulation = state.settlers.length;
  pushLog(state, 'good', `The founders of ${state.colony.name} arrive at the frontier.`, {
    buildingId: townCenter.id,
  });
  return state;
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
        ? { kind: 'new', progress: 0, workDone: 0, required: costToAmounts(def.cost), delivered: emptyResources() }
        : null,
    output: emptyResources(),
    productionProgress: 0,
    placedTick: state.time.tick,
  };
  state.buildings.push(building);
  setFootprint(state, building, building.id);
  return building;
}

// =============================================================================================
// stepGame
// =============================================================================================

/**
 * Advance the simulation by exactly one fixed tick (TICK_SECONDS sim seconds,
 * GAME_HOURS_PER_TICK game hours). Mutates `state`; returns the events that happened.
 * Does nothing once the game is lost ('won' continues until acknowledged, then as a sandbox).
 *
 * M3: settlers have needs, A* movement and a utility AI. M4/M5 add the economy, weather and events.
 */
export function stepGame(state: GameState): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.outcome.status === 'lost') return events;

  const newHour = advanceClock(state, events);
  stepWeather(state, events, GAME_HOURS_PER_TICK);
  const ctx = makeContext(state, events, GAME_HOURS_PER_TICK, newHour || state.time.tick === 1);
  stepSchedule(ctx);
  stepSettlers(ctx);
  drainLosses(state, events);
  return events;
}

/** Advance the clock by one tick. Returns true when the tick crossed an in-game hour boundary. */
function advanceClock(state: GameState, events: SimEvent[]): boolean {
  const t = state.time;
  const prevHour = Math.floor(t.timeOfDay);
  t.tick++;
  // Derived from the tick count (not accumulated), so the clock never drifts.
  const total = START_HOUR + t.tick * GAME_HOURS_PER_TICK;
  let day = 1 + Math.floor(total / 24);
  let tod = total - (day - 1) * 24;
  if (tod >= 24) {
    tod -= 24;
    day++;
  }
  if (tod < 0) tod = 0;
  t.timeOfDay = tod;
  if (day !== t.day) {
    t.day = day;
    events.push({ type: 'dayStarted', day });
    const season = SEASONS[Math.floor((day - 1) / DAYS_PER_SEASON) % SEASONS.length] ?? 'spring';
    if (season !== t.season) {
      t.season = season;
      events.push({ type: 'seasonChanged', season });
      adjustWeatherForSeason(state, events);
    }
  }
  const newHour = Math.floor(tod) !== prevHour;
  if (newHour) sampleStats(state);
  return newHour;
}

function sampleStats(state: GameState): void {
  const s = state.stats;
  s.history.push({
    tick: state.time.tick,
    day: state.time.day,
    timeOfDay: state.time.timeOfDay,
    stock: { ...state.colony.stock },
    population: state.settlers.length,
    produced: { ...s.producedThisHour },
    consumed: { ...s.consumedThisHour },
  });
  if (s.history.length > STATS_HISTORY_LENGTH) s.history.splice(0, s.history.length - STATS_HISTORY_LENGTH);
  s.producedThisHour = emptyResources();
  s.consumedThisHour = emptyResources();
}

// =============================================================================================
// applyCommand
// =============================================================================================

const fail = (error: Extract<CommandResult, { ok: false }>['error'], message: string): CommandResult => ({ ok: false, error, message });

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Apply a player command between ticks. Never throws: malformed input returns
 * `ok: false` with `invalidArgument` and leaves the state unchanged.
 */
export function applyCommand(state: GameState, command: PlayerCommand): CommandResult {
  if (state.outcome.status === 'lost') return fail('gameOver', 'The colony has fallen.');
  if (typeof command !== 'object' || command === null) return fail('invalidArgument', 'Malformed command.');
  try {
    const result = runCommand(state, command);
    if (result.ok) drainLosses(state, result.events);
    return result;
  } catch {
    return fail('invalidArgument', 'The command could not be applied.');
  }
}

function runCommand(state: GameState, command: PlayerCommand): CommandResult {
  const c = command as Record<string, unknown>;
  switch (command.type) {
    case 'placeBuilding':
      if (typeof c.buildingType !== 'string' || !Object.hasOwn(BUILDING_DEFS, c.buildingType) || !isInt(c.x) || !isInt(c.y)) {
        return fail('invalidArgument', 'Unknown building type or position.');
      }
      return placeBuilding(state, c.buildingType as BuildingType, c.x, c.y);
    case 'cancelBuilding':
      if (!isInt(c.buildingId)) return fail('invalidArgument', 'Invalid building id.');
      return removeBuilding(state, c.buildingId, 'cancelled');
    case 'demolishBuilding':
      if (!isInt(c.buildingId)) return fail('invalidArgument', 'Invalid building id.');
      return removeBuilding(state, c.buildingId, 'demolished');
    case 'setPriority': {
      const category = c.category;
      const level = c.level;
      if (
        typeof category !== 'string' ||
        !(JOB_CATEGORIES as readonly string[]).includes(category) ||
        !isInt(level) ||
        level < 0 ||
        level > 3
      ) {
        return fail('invalidArgument', 'Unknown job category or priority level.');
      }
      const cat = category as (typeof JOB_CATEGORIES)[number];
      const lvl = level as 0 | 1 | 2 | 3;
      state.colony.priorities[cat] = lvl;
      return { ok: true, entityId: null, events: [{ type: 'priorityChanged', category: cat, level: lvl }] };
    }
    case 'renameColony': {
      if (typeof c.name !== 'string') return fail('invalidArgument', 'The colony name must be text.');
      const name = c.name.trim().slice(0, MAX_COLONY_NAME_LENGTH).trim();
      if (!name) return fail('invalidArgument', 'The colony needs a name.');
      state.colony.name = name;
      return { ok: true, entityId: null, events: [] };
    }
    case 'resolveEvent':
      if (!isInt(c.eventId) || typeof c.accept !== 'boolean') return fail('invalidArgument', 'Invalid decision.');
      return resolveDecision(state, c.eventId, c.accept);
    case 'acknowledgeVictory': {
      if (state.outcome.status !== 'won') return fail('invalidState', 'The colony has not won yet.');
      // The colony keeps playing as a sandbox: the status returns to 'playing' and victory never re-triggers.
      state.progress.victoryAcknowledged = true;
      state.outcome = { status: 'playing', reason: null, endedTick: null };
      return { ok: true, entityId: null, events: [] };
    }
    default:
      return fail('invalidArgument', 'Unknown command.');
  }
}

/**
 * Place a blueprint (GAME_DESIGN §6.6). Nothing is deducted: the cost is reserved (see
 * `getAvailableStock`), haulers carry the materials to the site, and builders can only work with
 * what has been delivered.
 */
function placeBuilding(state: GameState, type: BuildingType, x: number, y: number): CommandResult {
  const check = canPlaceBuilding(state, type, x, y);
  if (!check.ok) return fail(check.error ?? 'invalidState', check.message ?? 'Cannot build here.');
  const def = BUILDING_DEFS[type];
  const building = addBuilding(state, type, x, y, def.buildHours > 0 ? 'construction' : 'complete');
  ejectSettlers(state, building);
  pushLog(state, 'info', `Construction of a ${def.name} was ordered.`, { buildingId: building.id, tile: { x, y } });
  return { ok: true, entityId: building.id, events: [{ type: 'buildingPlaced', buildingId: building.id, buildingType: type }] };
}

function removeBuilding(state: GameState, id: EntityId, reason: 'cancelled' | 'demolished'): CommandResult {
  const b = getBuilding(state, id);
  if (!b) return fail('notFound', 'That building no longer exists.');
  const def = BUILDING_DEFS[b.type];
  if (b.type === 'townCenter') return fail('invalidState', 'The town center cannot be removed.');
  if (reason === 'cancelled') {
    if (b.status !== 'construction' || b.construction === null) return fail('invalidState', 'Only construction sites can be cancelled.');
    if (b.construction.kind === 'repair') return fail('invalidState', 'A repair cannot be cancelled. Demolish the building instead.');
  }
  if (reason === 'demolished' && b.status !== 'complete' && b.construction?.kind !== 'repair') {
    return fail('invalidState', 'Cancel the construction site instead.');
  }

  // Taking storage away must not leave more in the stockpile than it can hold: refuse instead of destroying goods.
  if (b.status === 'complete' && def.storage > 0) {
    const newCap = getStorageCapacity(state) - def.storage;
    const over = RESOURCE_TYPES.find((r) => state.colony.stock[r] > newCap);
    if (over) {
      return fail('invalidState', `Demolishing the ${def.name} would overflow the stockpile (${Math.floor(state.colony.stock[over])} ${over} but room for ${newCap}). Use some up first.`);
    }
  }

  const refund: ResourceAmounts = emptyResources();
  if (b.construction && b.construction.kind === 'new') {
    for (const r of RESOURCE_TYPES) refund[r] = b.construction.delivered[r];
  } else {
    for (const r of RESOURCE_TYPES) refund[r] = Math.floor((def.cost[r] ?? 0) * DEMOLISH_REFUND);
  }
  // Goods waiting in the building's output buffer go back to the stock.
  for (const r of RESOURCE_TYPES) refund[r] += b.output[r];

  state.buildings.splice(state.buildings.indexOf(b), 1);
  setFootprint(state, b, 0);
  clearBuildingReferences(state, id);
  for (const r of RESOURCE_TYPES) addStockOrLose(state, r, refund[r], reason === 'cancelled' ? 'a cancelled order' : 'a refund');
  assignHomes(state);
  pushLog(state, 'info', `${def.name} ${reason === 'cancelled' ? 'construction cancelled' : 'demolished'}.`, {
    tile: { ...b.origin },
  });
  return { ok: true, entityId: null, events: [{ type: 'buildingRemoved', buildingId: id, buildingType: b.type, reason }] };
}
