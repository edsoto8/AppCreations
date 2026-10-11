/**
 * Structural validation of untrusted data (e.g. a save read from localStorage) before it is
 * used as a GameState. It checks shape and invariants the engine relies on, not game balance.
 */
import { SAVE_SCHEMA_VERSION } from './constants';
import { BUILDING_TYPES, RESOURCE_TYPES, type GameState } from './types';

export type ValidationResult = { ok: true; state: GameState } | { ok: false; error: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

function isResourceAmounts(v: unknown): boolean {
  return isObj(v) && RESOURCE_TYPES.every((r) => isNum(v[r]));
}

function isNumberArray(v: unknown, length: number): boolean {
  if (!Array.isArray(v) || v.length !== length) return false;
  for (const n of v) if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  return true;
}

function isPos(v: unknown): boolean {
  return isObj(v) && isNum(v.x) && isNum(v.y);
}

export function validateGameState(value: unknown): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error });
  if (!isObj(value)) return fail('state is not an object');

  const { meta, time, world, colony, settlers, buildings, weather, activeEvents, eventLog, stats, outcome, rng } =
    value;

  if (!isObj(meta)) return fail('meta missing');
  if (meta.schemaVersion !== SAVE_SCHEMA_VERSION) return fail(`unsupported schemaVersion ${String(meta.schemaVersion)}`);
  if (typeof meta.seed !== 'string' || !isInt(meta.seedNumber)) return fail('meta seed invalid');

  if (!isObj(time) || !isInt(time.tick) || !isInt(time.day) || !isNum(time.timeOfDay)) return fail('time invalid');
  if (time.timeOfDay < 0 || time.timeOfDay >= 24) return fail('timeOfDay out of range');

  if (!isObj(world) || !isInt(world.width) || !isInt(world.height)) return fail('world size invalid');
  if (world.width <= 0 || world.height <= 0 || world.width > 1024 || world.height > 1024) return fail('world size out of range');
  const tiles = world.width * world.height;
  for (const key of ['terrain', 'elevation', 'resource', 'building'] as const) {
    if (!isNumberArray(world[key], tiles)) return fail(`world.${key} must be ${tiles} numbers`);
  }
  if (!isInt(world.revision)) return fail('world.revision invalid');

  if (!isObj(colony) || typeof colony.name !== 'string' || !isResourceAmounts(colony.stock) || !isObj(colony.priorities)) {
    return fail('colony invalid');
  }

  if (!Array.isArray(settlers)) return fail('settlers must be an array');
  for (const s of settlers) {
    if (!isObj(s) || !isInt(s.id) || s.id <= 0 || typeof s.name !== 'string') return fail('settler id/name invalid');
    if (!isPos(s.pos) || !isPos(s.prevPos) || !Array.isArray(s.path)) return fail(`settler ${s.id} position invalid`);
    if (!isObj(s.needs) || !isObj(s.skills) || !Array.isArray(s.traits)) return fail(`settler ${s.id} stats invalid`);
    if (!isObj(s.task) || !isObj(s.activity)) return fail(`settler ${s.id} task invalid`);
    if (!isObj(s.xp) || !Array.isArray(s.moodlets) || !isObj(s.status)) return fail(`settler ${s.id} status invalid`);
  }

  if (!Array.isArray(buildings)) return fail('buildings must be an array');
  for (const b of buildings) {
    if (!isObj(b) || !isInt(b.id) || b.id <= 0) return fail('building id invalid');
    if (!BUILDING_TYPES.includes(b.type as never)) return fail(`building ${b.id} has unknown type`);
    if (!isPos(b.origin) || !isObj(b.footprint)) return fail(`building ${b.id} position invalid`);
    if ((b.status === 'construction') !== isObj(b.construction)) return fail(`building ${b.id} construction state invalid`);
  }

  const ids = new Set<number>();
  for (const e of [...(settlers as Obj[]), ...(buildings as Obj[])]) {
    if (ids.has(e.id as number)) return fail(`duplicate entity id ${String(e.id)}`);
    ids.add(e.id as number);
  }
  if (!isInt(value.nextId) || [...ids].some((id) => id >= (value.nextId as number))) return fail('nextId invalid');
  if (!isInt(value.nextLogId)) return fail('nextLogId invalid');

  if (!isObj(weather) || typeof weather.current !== 'string') return fail('weather invalid');
  if (!Array.isArray(activeEvents) || !Array.isArray(eventLog)) return fail('events invalid');
  if (!isObj(stats) || !Array.isArray(stats.history)) return fail('stats invalid');
  if (!isObj(outcome) || !['playing', 'won', 'lost'].includes(outcome.status as string)) return fail('outcome invalid');
  if (!Array.isArray(rng) || rng.length !== 4 || !rng.every(isInt)) return fail('rng state invalid');
  if (!Array.isArray(value.pendingDecisions)) return fail('pendingDecisions invalid');
  const progress = value.progress;
  if (!isObj(progress) || !Array.isArray(progress.objectivesDone) || !Array.isArray(progress.unlocked)) {
    return fail('progress invalid');
  }

  return { ok: true, state: value as unknown as GameState };
}
