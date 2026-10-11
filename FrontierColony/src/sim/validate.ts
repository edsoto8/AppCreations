/**
 * Validation of untrusted data (a save read from localStorage) before it is used as a GameState.
 *
 * It checks shapes AND values: enums, ranges, finite numbers, array lengths, the building layer
 * against the building list, and that every id points at an entity that exists. A state that
 * passes can be stepped, rendered and summarised without crashing. The function never throws:
 * anything unexpected is reported as `ok: false`.
 */
import { BUILDING_DEFS } from './balance';
import {
  EVENT_LOG_LIMIT,
  MAX_ELEVATION,
  NEED_MAX,
  SAVE_SCHEMA_VERSION,
  SKILL_MAX,
  STATS_HISTORY_LENGTH,
  APPEARANCE_VARIANTS,
} from './constants';
import {
  BUILDING_TYPES,
  DIFFICULTIES,
  JOB_CATEGORIES,
  MAP_PRESETS,
  MAP_SIZES,
  NEED_TYPES,
  RESOURCE_TYPES,
  SEASONS,
  SKILL_TYPES,
  Terrain,
  WEATHER_KINDS,
  type ActivityKind,
  type Facing,
  type GameStatus,
  type LogSeverity,
  type RandomEventKind,
  type TaskKind,
  type TaskPhase,
  type TraitId,
} from './types';

export type ValidationResult = { ok: true; state: import('./types').GameState } | { ok: false; error: string };

type Obj = Record<string, unknown>;

class Invalid extends Error {}

const exhaustive = <T extends string>(r: Record<T, true>): readonly string[] => Object.keys(r);

const ACTIVITY_KINDS = exhaustive<ActivityKind>({
  idle: true,
  walking: true,
  carrying: true,
  chopping: true,
  mining: true,
  farming: true,
  building: true,
  crafting: true,
  fetchingWater: true,
  eating: true,
  sleeping: true,
  resting: true,
  socializing: true,
  wandering: true,
});
const TASK_KINDS = exhaustive<TaskKind>({
  idle: true,
  wander: true,
  gather: true,
  haul: true,
  construct: true,
  work: true,
  eat: true,
  drink: true,
  sleep: true,
  rest: true,
  socialize: true,
  depart: true,
});
const TASK_PHASES = exhaustive<TaskPhase>({ moving: true, working: true, returning: true });
const FACINGS = exhaustive<Facing>({ ne: true, nw: true, se: true, sw: true });
const SEVERITIES = exhaustive<LogSeverity>({ info: true, good: true, warning: true, danger: true });
const GAME_STATUSES = exhaustive<GameStatus>({ playing: true, won: true, lost: true });
const EVENT_KINDS = exhaustive<RandomEventKind>({
  wanderer: true,
  bountifulHarvest: true,
  cropBlight: true,
  drought: true,
  sickness: true,
  wildfire: true,
  toolsBreak: true,
  coldSnap: true,
  traderVisit: true,
  wolves: true,
  stormDamage: true,
  richVein: true,
  supplyCache: true,
  harvestFestival: true,
});
const TRAITS = exhaustive<TraitId>({
  hardworking: true,
  lazy: true,
  cheerful: true,
  gloomy: true,
  glutton: true,
  frugal: true,
  tough: true,
  frail: true,
  nightOwl: true,
  earlyBird: true,
  sociable: true,
  loner: true,
  nimble: true,
  clumsy: true,
});

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const MAX_DEPTH = 14;

/** True if any object in the tree has a prototype-polluting key, or the tree is suspiciously deep. */
function hasForbiddenKeys(value: unknown, depth: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v: unknown = value[i];
      if (typeof v === 'object' && v !== null && hasForbiddenKeys(v, depth + 1)) return true;
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) return true;
    if (hasForbiddenKeys((value as Obj)[key], depth + 1)) return true;
  }
  return false;
}

function bad(message: string): never {
  throw new Invalid(message);
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function obj(v: unknown, what: string): Obj {
  if (!isObj(v)) bad(`${what} must be an object`);
  return v;
}
function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) bad(`${what} must be an array`);
  return v;
}
function num(v: unknown, what: string, min = -Infinity, max = Infinity): number {
  if (!isNum(v) || v < min || v > max) bad(`${what} must be a number in [${min}, ${max}]`);
  return v;
}
function int(v: unknown, what: string, min = -Infinity, max = Infinity): number {
  if (!isInt(v) || v < min || v > max) bad(`${what} must be an integer in [${min}, ${max}]`);
  return v;
}
function str(v: unknown, what: string, maxLength = 2000): string {
  if (typeof v !== 'string' || v.length > maxLength) bad(`${what} must be a string`);
  return v;
}
function oneOf(v: unknown, allowed: readonly string[], what: string): string {
  if (typeof v !== 'string' || !allowed.includes(v)) bad(`${what} has an unknown value`);
  return v;
}
function nullOr<T>(v: unknown, check: (x: unknown) => T): T | null {
  return v === null ? null : check(v);
}

function amounts(v: unknown, what: string): void {
  const o = obj(v, what);
  for (const r of RESOURCE_TYPES) num(o[r], `${what}.${r}`, 0);
}

interface Dims {
  w: number;
  h: number;
}

function tile(v: unknown, what: string, dims: Dims): void {
  const o = obj(v, what);
  int(o.x, `${what}.x`, 0, dims.w - 1);
  int(o.y, `${what}.y`, 0, dims.h - 1);
}

function point(v: unknown, what: string, dims: Dims): void {
  const o = obj(v, what);
  num(o.x, `${what}.x`, 0, dims.w);
  num(o.y, `${what}.y`, 0, dims.h);
}

/** Entity ids that exist in the state being validated. */
interface Ids {
  buildings: Set<number>;
  settlers: Set<number>;
}

function buildingRef(v: unknown, what: string, ids: Ids): void {
  if (!isInt(v) || !ids.buildings.has(v)) bad(`${what} does not reference an existing building`);
}

function validateTask(v: unknown, what: string, dims: Dims, ids: Ids): void {
  const t = obj(v, what);
  const kind = oneOf(t.kind, TASK_KINDS, `${what}.kind`) as TaskKind;
  oneOf(t.phase, TASK_PHASES, `${what}.phase`);
  num(t.progress, `${what}.progress`);
  switch (kind) {
    case 'idle':
      return;
    case 'wander':
      return tile(t.targetTile, `${what}.targetTile`, dims);
    case 'gather':
      oneOf(t.resource, RESOURCE_TYPES, `${what}.resource`);
      tile(t.targetTile, `${what}.targetTile`, dims);
      return void nullOr(t.dropOffBuildingId, (x) => buildingRef(x, `${what}.dropOffBuildingId`, ids));
    case 'haul':
      oneOf(t.resource, RESOURCE_TYPES, `${what}.resource`);
      num(t.amount, `${what}.amount`, 0);
      nullOr(t.fromBuildingId, (x) => buildingRef(x, `${what}.fromBuildingId`, ids));
      return buildingRef(t.toBuildingId, `${what}.toBuildingId`, ids);
    case 'construct':
    case 'work':
    case 'eat':
    case 'drink':
      return buildingRef(t.buildingId, `${what}.buildingId`, ids);
    case 'sleep':
    case 'rest':
      return void nullOr(t.buildingId, (x) => buildingRef(x, `${what}.buildingId`, ids));
    case 'socialize':
      return void nullOr(t.withSettlerId, (x) => {
        if (!isInt(x) || !ids.settlers.has(x)) bad(`${what}.withSettlerId does not reference a settler`);
      });
    case 'depart':
      return tile(t.edgeTile, `${what}.edgeTile`, dims);
  }
}

function validateSettler(v: unknown, what: string, dims: Dims, ids: Ids): void {
  const s = obj(v, what);
  int(s.id, `${what}.id`, 1);
  str(s.name, `${what}.name`, 80);
  int(s.joinedDay, `${what}.joinedDay`, 1);
  const traits = arr(s.traits, `${what}.traits`);
  if (traits.length > 4) bad(`${what}.traits is too long`);
  traits.forEach((t, i) => oneOf(t, TRAITS, `${what}.traits[${i}]`));
  if (new Set(traits).size !== traits.length) bad(`${what}.traits has duplicates`);
  const skills = obj(s.skills, `${what}.skills`);
  const xp = obj(s.xp, `${what}.xp`);
  for (const k of SKILL_TYPES) {
    int(skills[k], `${what}.skills.${k}`, 0, SKILL_MAX);
    num(xp[k], `${what}.xp.${k}`, 0);
  }
  const needs = obj(s.needs, `${what}.needs`);
  for (const k of NEED_TYPES) num(needs[k], `${what}.needs.${k}`, 0, NEED_MAX);
  const look = obj(s.appearance, `${what}.appearance`);
  for (const k of ['skin', 'hair', 'shirt']) int(look[k], `${what}.appearance.${k}`, 0, APPEARANCE_VARIANTS - 1);
  point(s.pos, `${what}.pos`, dims);
  point(s.prevPos, `${what}.prevPos`, dims);
  oneOf(s.facing, FACINGS, `${what}.facing`);
  const path = arr(s.path, `${what}.path`);
  if (path.length > dims.w * dims.h) bad(`${what}.path is too long`);
  path.forEach((p, i) => tile(p, `${what}.path[${i}]`, dims));
  validateTask(s.task, `${what}.task`, dims, ids);
  const a = obj(s.activity, `${what}.activity`);
  oneOf(a.kind, ACTIVITY_KINDS, `${what}.activity.kind`);
  str(a.label, `${what}.activity.label`, 200);
  nullOr(a.progress, (x) => num(x, `${what}.activity.progress`, 0, 1));
  nullOr(a.targetTile, (x) => tile(x, `${what}.activity.targetTile`, dims));
  nullOr(s.carrying, (c) => {
    const o = obj(c, `${what}.carrying`);
    oneOf(o.resource, RESOURCE_TYPES, `${what}.carrying.resource`);
    num(o.amount, `${what}.carrying.amount`, 0);
  });
  nullOr(s.homeId, (x) => buildingRef(x, `${what}.homeId`, ids));
  nullOr(s.workplaceId, (x) => buildingRef(x, `${what}.workplaceId`, ids));
  arr(s.moodlets, `${what}.moodlets`).forEach((m, i) => {
    const o = obj(m, `${what}.moodlets[${i}]`);
    str(o.id, `${what}.moodlets[${i}].id`, 60);
    num(o.value, `${what}.moodlets[${i}].value`, -1000, 1000);
    nullOr(o.hoursLeft, (x) => num(x, `${what}.moodlets[${i}].hoursLeft`));
  });
  const st = obj(s.status, `${what}.status`);
  if (typeof st.dehydrated !== 'boolean') bad(`${what}.status.dehydrated must be a boolean`);
  if (typeof st.sleptOutdoorsLastNight !== 'boolean') bad(`${what}.status.sleptOutdoorsLastNight must be a boolean`);
  for (const k of ['sickHoursLeft', 'drinkCooldownHours', 'breakingHours', 'hoursWorkedSinceWake', 'sulkHoursLeft']) {
    num(st[k], `${what}.status.${k}`, 0);
  }
  nullOr(st.lastSocializedTick, (x) => int(x, `${what}.status.lastSocializedTick`, 0));
  const log = obj(st.damageLog, `${what}.status.damageLog`);
  for (const k of Object.keys(log)) num(log[k], `${what}.status.damageLog.${k}`, 0);
  const alerts = obj(st.needAlerts, `${what}.status.needAlerts`);
  for (const k of NEED_TYPES) if (typeof alerts[k] !== 'boolean') bad(`${what}.status.needAlerts.${k} must be a boolean`);
  nullOr(s.toolDurability, (x) => num(x, `${what}.toolDurability`, 0));
  num(s.hoursSinceDecision, `${what}.hoursSinceDecision`, 0);
}

function validateBuilding(v: unknown, what: string, dims: Dims): void {
  const b = obj(v, what);
  int(b.id, `${what}.id`, 1);
  const type = oneOf(b.type, BUILDING_TYPES, `${what}.type`) as (typeof BUILDING_TYPES)[number];
  const def = BUILDING_DEFS[type];
  tile(b.origin, `${what}.origin`, dims);
  const fp = obj(b.footprint, `${what}.footprint`);
  if (fp.w !== def.footprint.w || fp.h !== def.footprint.h) bad(`${what}.footprint does not match its type`);
  const origin = b.origin as { x: number; y: number };
  if (origin.x + def.footprint.w > dims.w || origin.y + def.footprint.h > dims.h) bad(`${what} extends past the map`);
  const status = oneOf(b.status, ['construction', 'complete'], `${what}.status`);
  if (status === 'complete' && b.construction !== null) bad(`${what}.construction must be null when complete`);
  if (status === 'construction') {
    const c = obj(b.construction, `${what}.construction`);
    oneOf(c.kind, ['new', 'repair'], `${what}.construction.kind`);
    num(c.progress, `${what}.construction.progress`, 0, 1);
    num(c.workDone, `${what}.construction.workDone`, 0);
    amounts(c.required, `${what}.construction.required`);
    amounts(c.delivered, `${what}.construction.delivered`);
  }
  amounts(b.output, `${what}.output`);
  num(b.productionProgress, `${what}.productionProgress`, 0, 1);
  int(b.placedTick, `${what}.placedTick`, 0);
}

function validate(value: unknown): import('./types').GameState {
  const root = obj(value, 'state');
  if (hasForbiddenKeys(root, 0)) bad('state contains forbidden keys');

  const meta = obj(root.meta, 'meta');
  if (meta.schemaVersion !== SAVE_SCHEMA_VERSION) bad(`unsupported schemaVersion ${String(meta.schemaVersion)}`);
  str(meta.seed, 'meta.seed', 200);
  int(meta.seedNumber, 'meta.seedNumber', 0, 4294967295);
  oneOf(meta.preset, MAP_PRESETS, 'meta.preset');
  oneOf(meta.mapSize, MAP_SIZES, 'meta.mapSize');
  oneOf(meta.difficulty, DIFFICULTIES, 'meta.difficulty');

  const time = obj(root.time, 'time');
  int(time.tick, 'time.tick', 0);
  int(time.day, 'time.day', 1);
  num(time.timeOfDay, 'time.timeOfDay', 0, 24);
  if ((time.timeOfDay as number) >= 24) bad('time.timeOfDay must be below 24');
  oneOf(time.season, SEASONS, 'time.season');

  const world = obj(root.world, 'world');
  const W = int(world.width, 'world.width', 1, 1024);
  const H = int(world.height, 'world.height', 1, 1024);
  const dims: Dims = { w: W, h: H };
  const n = W * H;
  for (const key of ['terrain', 'elevation', 'resource', 'building'] as const) {
    const layer = arr(world[key], `world.${key}`);
    if (layer.length !== n) bad(`world.${key} must have ${n} entries`);
    const lo = 0;
    const hi = key === 'terrain' ? Terrain.Mountain : key === 'elevation' ? MAX_ELEVATION : Infinity;
    const integer = key !== 'resource';
    for (let i = 0; i < n; i++) {
      const t = layer[i];
      if (typeof t !== 'number' || !Number.isFinite(t) || t < lo || t > hi || (integer && !Number.isInteger(t))) {
        bad(`world.${key}[${i}] is out of range`);
      }
    }
  }
  int(world.revision, 'world.revision', 0);

  const colony = obj(root.colony, 'colony');
  const name = str(colony.name, 'colony.name', 200);
  if (name.trim() === '') bad('colony.name is empty');
  arr(colony.usedNames, 'colony.usedNames').forEach((x, i) => str(x, `colony.usedNames[${i}]`, 80));
  arr(colony.graveyard, 'colony.graveyard').forEach((g, i) => {
    const o = obj(g, `colony.graveyard[${i}]`);
    int(o.id, `colony.graveyard[${i}].id`, 1);
    str(o.name, `colony.graveyard[${i}].name`, 80);
    int(o.diedDay, `colony.graveyard[${i}].diedDay`, 1);
    str(o.cause, `colony.graveyard[${i}].cause`, 80);
  });
  amounts(colony.stock, 'colony.stock');
  const priorities = obj(colony.priorities, 'colony.priorities');
  if (Object.keys(priorities).length !== JOB_CATEGORIES.length) bad('colony.priorities has unknown categories');
  for (const c of JOB_CATEGORIES) int(priorities[c], `colony.priorities.${c}`, 0, 3);

  // Collect entity ids first so cross-references can be checked.
  const buildingList = arr(root.buildings, 'buildings');
  const settlerList = arr(root.settlers, 'settlers');
  const ids: Ids = { buildings: new Set(), settlers: new Set() };
  for (const b of buildingList) {
    const id = isObj(b) ? b.id : undefined;
    if (!isInt(id) || id <= 0 || ids.buildings.has(id) || ids.settlers.has(id)) bad('building id invalid or duplicated');
    ids.buildings.add(id);
  }
  for (const s of settlerList) {
    const id = isObj(s) ? s.id : undefined;
    if (!isInt(id) || id <= 0 || ids.buildings.has(id) || ids.settlers.has(id)) bad('settler id invalid or duplicated');
    ids.settlers.add(id);
  }
  const nextId = int(root.nextId, 'nextId', 1);
  for (const id of ids.buildings) if (id >= nextId) bad('nextId is not above every building id');
  for (const id of ids.settlers) if (id >= nextId) bad('nextId is not above every settler id');
  int(root.nextLogId, 'nextLogId', 1);

  buildingList.forEach((b, i) => validateBuilding(b, `buildings[${i}]`, dims));
  settlerList.forEach((s, i) => validateSettler(s, `settlers[${i}]`, dims, ids));

  // The building layer must be exactly the union of the building footprints.
  const expected = new Array<number>(n).fill(0);
  for (const raw of buildingList) {
    const b = raw as { id: number; origin: { x: number; y: number }; footprint: { w: number; h: number } };
    for (let dy = 0; dy < b.footprint.h; dy++) {
      for (let dx = 0; dx < b.footprint.w; dx++) {
        const i = (b.origin.y + dy) * W + b.origin.x + dx;
        if (expected[i] !== 0) bad('buildings overlap');
        expected[i] = b.id;
      }
    }
  }
  const layer = world.building as number[];
  for (let i = 0; i < n; i++) if (layer[i] !== expected[i]) bad('world.building does not match the buildings');

  // Housing never exceeds capacity.
  const residents = new Map<number, number>();
  for (const raw of settlerList) {
    const home = (raw as { homeId: number | null }).homeId;
    if (home !== null) residents.set(home, (residents.get(home) ?? 0) + 1);
  }
  for (const raw of buildingList) {
    const b = raw as { id: number; type: (typeof BUILDING_TYPES)[number] };
    if ((residents.get(b.id) ?? 0) > BUILDING_DEFS[b.type].housing) bad(`building ${b.id} houses more settlers than it holds`);
  }

  const weather = obj(root.weather, 'weather');
  oneOf(weather.current, WEATHER_KINDS, 'weather.current');
  num(weather.intensity, 'weather.intensity', 0, 1);
  num(weather.hoursRemaining, 'weather.hoursRemaining', 0);

  arr(root.activeEvents, 'activeEvents').forEach((e, i) => {
    const o = obj(e, `activeEvents[${i}]`);
    int(o.id, `activeEvents[${i}].id`, 1);
    oneOf(o.kind, EVENT_KINDS, `activeEvents[${i}].kind`);
    int(o.startedTick, `activeEvents[${i}].startedTick`, 0);
    num(o.hoursRemaining, `activeEvents[${i}].hoursRemaining`, 0);
    num(o.magnitude, `activeEvents[${i}].magnitude`, 0, 1);
    nullOr(o.targetId, (x) => {
      if (!isInt(x) || (!ids.buildings.has(x) && !ids.settlers.has(x))) bad(`activeEvents[${i}].targetId does not reference an entity`);
    });
    nullOr(o.tile, (x) => tile(x, `activeEvents[${i}].tile`, dims));
  });

  const log = arr(root.eventLog, 'eventLog');
  if (log.length > EVENT_LOG_LIMIT) bad('eventLog is too long');
  log.forEach((e, i) => {
    const o = obj(e, `eventLog[${i}]`);
    int(o.id, `eventLog[${i}].id`, 1);
    int(o.tick, `eventLog[${i}].tick`, 0);
    int(o.day, `eventLog[${i}].day`, 1);
    num(o.timeOfDay, `eventLog[${i}].timeOfDay`, 0, 24);
    oneOf(o.severity, SEVERITIES, `eventLog[${i}].severity`);
    str(o.message, `eventLog[${i}].message`, 500);
    nullOr(o.settlerId, (x) => int(x, `eventLog[${i}].settlerId`, 1));
    nullOr(o.buildingId, (x) => int(x, `eventLog[${i}].buildingId`, 1));
    nullOr(o.tile, (x) => tile(x, `eventLog[${i}].tile`, dims));
  });

  const stats = obj(root.stats, 'stats');
  const history = arr(stats.history, 'stats.history');
  if (history.length > STATS_HISTORY_LENGTH) bad('stats.history is too long');
  history.forEach((h, i) => {
    const o = obj(h, `stats.history[${i}]`);
    int(o.tick, `stats.history[${i}].tick`, 0);
    int(o.day, `stats.history[${i}].day`, 1);
    num(o.timeOfDay, `stats.history[${i}].timeOfDay`, 0, 24);
    amounts(o.stock, `stats.history[${i}].stock`);
    amounts(o.produced, `stats.history[${i}].produced`);
    amounts(o.consumed, `stats.history[${i}].consumed`);
    int(o.population, `stats.history[${i}].population`, 0);
  });
  for (const k of ['producedThisHour', 'consumedThisHour', 'totalProduced', 'totalConsumed']) amounts(stats[k], `stats.${k}`);
  for (const k of ['births', 'arrivals', 'deaths', 'peakPopulation', 'buildingsCompleted']) int(stats[k], `stats.${k}`, 0);

  const outcome = obj(root.outcome, 'outcome');
  oneOf(outcome.status, GAME_STATUSES, 'outcome.status');
  nullOr(outcome.reason, (x) => str(x, 'outcome.reason', 500));
  nullOr(outcome.endedTick, (x) => int(x, 'outcome.endedTick', 0));

  const rng = arr(root.rng, 'rng');
  if (rng.length !== 4) bad('rng must have 4 numbers');
  rng.forEach((x, i) => int(x, `rng[${i}]`, 0, 4294967295));

  arr(root.pendingDecisions, 'pendingDecisions').forEach((d, i) => {
    const o = obj(d, `pendingDecisions[${i}]`);
    int(o.eventId, `pendingDecisions[${i}].eventId`, 1);
    oneOf(o.kind, EVENT_KINDS, `pendingDecisions[${i}].kind`);
    num(o.hoursLeft, `pendingDecisions[${i}].hoursLeft`, 0);
    const payload = obj(o.payload, `pendingDecisions[${i}].payload`);
    for (const k of Object.keys(payload)) {
      const p = payload[k];
      if (p !== null && typeof p !== 'string' && typeof p !== 'boolean' && !isNum(p)) bad(`pendingDecisions[${i}].payload.${k} is invalid`);
    }
  });

  const progress = obj(root.progress, 'progress');
  arr(progress.objectivesDone, 'progress.objectivesDone').forEach((x, i) => str(x, `progress.objectivesDone[${i}]`, 80));
  arr(progress.unlocked, 'progress.unlocked').forEach((x, i) => oneOf(x, BUILDING_TYPES, `progress.unlocked[${i}]`));
  int(progress.toolsCrafted, 'progress.toolsCrafted', 0);
  nullOr(progress.festivalYear, (x) => int(x, 'progress.festivalYear', 1));
  nullOr(progress.lastDeathTick, (x) => int(x, 'progress.lastDeathTick', 0));
  if (typeof progress.victoryAcknowledged !== 'boolean') bad('progress.victoryAcknowledged must be a boolean');

  return value as import('./types').GameState;
}

/** Validate unknown data as a GameState. Never throws. */
export function validateGameState(value: unknown): ValidationResult {
  try {
    return { ok: true, state: validate(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Invalid ? error.message : 'state could not be validated' };
  }
}
