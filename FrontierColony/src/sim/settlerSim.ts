/**
 * Settler simulation: per-tick needs, movement along A* paths, task execution and the utility-AI
 * decision loop (GAME_DESIGN §3-§5).
 *
 * Layout of this file:
 *   1. helpers (geometry, activity labels)
 *   2. movement (path following, repath)
 *   3. task start functions + the candidate list used by `decide`
 *   4. task execution (`stepTask`)
 *   5. `stepSettlers`, the per-tick entry point called by `stepGame`
 *
 * Work activities wired so far: build (construction sites), gather wood and mine stone (from
 * lumber camps, mines and the town center's forage slots, delivered straight to the stockpile).
 * Farming, wells, workshops and hauling are M4; `workCandidates` is the seam where they plug in.
 */
import {
  AI,
  BUILDING_DEFS,
  BUILD_RATE,
  CARRY_CAPACITY,
  CARRY_PER_HAULING_LEVEL,
  COLLAPSE_ENERGY,
  DRINK,
  EVENTS,
  GATHER_RATE,
  HEALTH,
  MEAL,
  MOODLETS,
  OUTDOOR_SLEEP_RADIUS_FROM_TOWN_CENTER,
  SEASON_FARM_MULT,
  WELL_NEAR_WATER,
  SLEEP_WAKE,
  TOOLS,
  TRAIT_EFFECTS,
  XP_TO_NEXT_LEVEL_PER_LEVEL,
} from './balance';
import { NEED_MAX, SKILL_MAX } from './constants';
import {
  evaluateStateMoodlets,
  hasTrait,
  inNightWindow,
  isSleepTask,
  moodBand,
  updateNeeds,
  walkSpeedPerTick,
  workSpeedMult,
  type TickContext,
} from './needs';
import { accessGoal, findPath, isPassable, tileGoal, type PathGoal } from './pathfinding';
import { getWalkRegions, TERRAIN_MOVE_COST } from './grid';
import { checkObjectives } from './progression';
import { getAvailableStock, getStorageCapacity } from './queries';
import { chance, nextFloat, nextInt } from './rng';
import {
  IDLE_TASK,
  abortSettlerTask,
  addStockOf,
  addTimedMoodlet,
  findBuilding,
  pushLog,
  recordConsumed,
  recordProduced,
  removeSettler,
  reportLoss,
} from './stateOps';
import {
  RESOURCE_TYPES,
  Terrain,
  type ActivityKind,
  type ResourceAmounts,
  type ResourceType,
  type Building,
  type GameState,
  type JobCategory,
  type NeedType,
  type Settler,
  type SkillType,
  type Task,
  type TilePos,
} from './types';

const SQRT2 = 1.4142135623730951;

// =============================================================================================
// 1. Helpers
// =============================================================================================

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax < bx ? bx - ax : ax - bx;
  const dy = ay < by ? by - ay : ay - by;
  return dx + dy + (SQRT2 - 2) * (dx < dy ? dx : dy);
}

/** Iso facing: +x runs screen right-down (se), +y runs screen left-down (sw). */
export function facingFor(dx: number, dy: number): Settler['facing'] {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'se' : 'nw';
  return dy >= 0 ? 'sw' : 'ne';
}

/** Name used in activity labels: houses carry their id ("House #12"). */
export function buildingLabel(b: Building): string {
  const name = BUILDING_DEFS[b.type].name;
  return b.type === 'house' ? `${name} #${b.id}` : name;
}

function setActivity(s: Settler, kind: ActivityKind, label: string, progress: number | null, target: TilePos | null, indoors: number | null = null): void {
  const a = s.activity;
  a.kind = kind;
  a.label = label;
  a.progress = progress;
  a.indoorsBuildingId = indoors;
  if (target === null) a.targetTile = null;
  else if (a.targetTile === null || a.targetTile.x !== target.x || a.targetTile.y !== target.y) {
    a.targetTile = { x: target.x, y: target.y };
  }
}

function skillOf(category: JobCategory): SkillType {
  switch (category) {
    case 'building':
      return 'construction';
    case 'farming':
      return 'farming';
    case 'woodcutting':
      return 'woodcutting';
    case 'mining':
      return 'mining';
    case 'hauling':
    case 'water':
      return 'hauling';
    case 'crafting':
      return 'crafting';
  }
}

function grantXp(s: Settler, skill: SkillType, hours: number): void {
  s.xp[skill] += hours * 1;
  const level = s.skills[skill];
  if (level < SKILL_MAX && s.xp[skill] >= XP_TO_NEXT_LEVEL_PER_LEVEL * (level + 1)) {
    s.xp[skill] -= XP_TO_NEXT_LEVEL_PER_LEVEL * (level + 1);
    s.skills[skill] = level + 1;
  }
}

/** Take a tool from the stock when starting tool-using work with none in hand (GAME_DESIGN §6.4). */
function ensureTool(state: GameState, s: Settler, category: JobCategory): void {
  if (s.toolDurability !== null || !TOOLS.usedBy.includes(category) || state.colony.stock.tools < 1) return;
  state.colony.stock.tools -= 1;
  s.toolDurability = TOOLS.durabilityHours;
}

function wearTool(state: GameState, s: Settler, hours: number): void {
  if (s.toolDurability === null) return;
  s.toolDurability -= hours;
  if (s.toolDurability <= 0) {
    s.toolDurability = null;
    pushLog(state, 'info', `${s.name}'s tools broke.`, { settlerId: s.id });
  }
}

function isAsleep(s: Settler): boolean {
  return isSleepTask(s.task.kind) && s.task.phase === 'working';
}

function carryCapacity(s: Settler): number {
  return CARRY_CAPACITY + CARRY_PER_HAULING_LEVEL * s.skills.hauling;
}

/** The completed building the settler lives in, or null (homeless, or the home is damaged). */
function bedOf(state: GameState, s: Settler): Building | null {
  if (s.homeId === null) return null;
  const b = findBuilding(state, s.homeId);
  return b !== null && b.status === 'complete' && BUILDING_DEFS[b.type].housing > 0 ? b : null;
}

/** Walk region of the tiles around the town center (the first free tile of its ring), or -1. */
function townRegion(state: GameState, town: Building): number {
  const world = state.world;
  const { labels } = getWalkRegions(world);
  for (let y = town.origin.y - 1; y <= town.origin.y + town.footprint.h; y++) {
    for (let x = town.origin.x - 1; x <= town.origin.x + town.footprint.w; x++) {
      const inside = x >= town.origin.x && x < town.origin.x + town.footprint.w && y >= town.origin.y && y < town.origin.y + town.footprint.h;
      if (!inside && x >= 0 && y >= 0 && x < world.width && y < world.height && isPassable(world, y * world.width + x)) {
        return labels[y * world.width + x] as number;
      }
    }
  }
  return -1;
}

/** A free walkable tile within a few tiles of the town center, one per settler id (the campfire bedroll). */
export function campfireSpot(state: GameState, s: Settler): TilePos | null {
  const town = state.buildings.find((b) => b.type === 'townCenter');
  if (!town) return null;
  const world = state.world;
  const r = OUTDOOR_SLEEP_RADIUS_FROM_TOWN_CENTER;
  const { labels } = getWalkRegions(world);
  const home = townRegion(state, town);
  const spots: TilePos[] = [];
  for (let y = town.origin.y - r; y < town.origin.y + town.footprint.h + r; y++) {
    for (let x = town.origin.x - r; x < town.origin.x + town.footprint.w + r; x++) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      if (isPassable(world, y * world.width + x) && labels[y * world.width + x] === home) spots.push({ x, y });
    }
  }
  return spots.length === 0 ? null : (spots[s.id % spots.length] as TilePos);
}

/** Give homeless settlers free beds in completed buildings (lowest settler id first). */
export function assignHomes(state: GameState): void {
  let anyHomeless = false;
  for (const s of state.settlers) if (s.homeId === null) anyHomeless = true;
  if (!anyHomeless) return;
  const used = new Map<number, number>();
  for (const s of state.settlers) if (s.homeId !== null) used.set(s.homeId, (used.get(s.homeId) ?? 0) + 1);
  const homeless = state.settlers.filter((s) => s.homeId === null);
  let next = 0;
  for (const b of state.buildings) {
    if (next >= homeless.length) break;
    if (b.status !== 'complete') continue;
    let free = BUILDING_DEFS[b.type].housing - (used.get(b.id) ?? 0);
    while (free > 0 && next < homeless.length) {
      (homeless[next] as Settler).homeId = b.id;
      next++;
      free--;
    }
  }
}

/** Move settlers standing on a freshly placed footprint to the nearest free tile (they stop what they were doing). */
export function ejectSettlers(state: GameState, b: Building): void {
  const world = state.world;
  for (const s of state.settlers) {
    const tx = Math.floor(s.pos.x);
    const ty = Math.floor(s.pos.y);
    if (tx < b.origin.x || ty < b.origin.y || tx >= b.origin.x + b.footprint.w || ty >= b.origin.y + b.footprint.h) continue;
    let placed = false;
    for (let r = 1; r <= 6 && !placed; r++) {
      for (let dy = -r; dy <= r && !placed; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
          if (!isPassable(world, y * world.width + x)) continue;
          s.pos.x = x + 0.5;
          s.pos.y = y + 0.5;
          s.prevPos.x = s.pos.x;
          s.prevPos.y = s.pos.y;
          placed = true;
          break;
        }
      }
    }
    abortSettlerTask(state, s);
  }
}

// =============================================================================================
// 2. Movement
// =============================================================================================

type PlanResult = 'ok' | 'arrived' | 'fail';

/** Compute an A* path from the settler's tile to the goal and store it in `s.path`. */
function planMove(state: GameState, s: Settler, goal: PathGoal): PlanResult {
  const result = findPath(state.world, Math.floor(s.pos.x), Math.floor(s.pos.y), goal);
  if (result === null) {
    s.path = [];
    return 'fail';
  }
  s.path = result.path;
  return result.path.length === 0 ? 'arrived' : 'ok';
}

type WalkResult = 'moving' | 'arrived' | 'blocked';

/** Advance along `s.path` by one tick of walking. Repaths once if the next tile became blocked. */
function walk(ctx: TickContext, s: Settler): WalkResult {
  const path = s.path;
  if (path.length === 0) return 'arrived';
  const world = ctx.state.world;
  const W = world.width;
  let budget = walkSpeedPerTick(ctx, s);
  let repaths = 0;
  while (budget > 0 && s.path.length > 0) {
    const wp = s.path[0] as TilePos;
    const wi = wp.y * W + wp.x;
    if (!isPassable(world, wi)) {
      const last = s.path[s.path.length - 1] as TilePos;
      if (repaths++ > 0 || planMove(ctx.state, s, tileGoal(last.x, last.y)) === 'fail') {
        s.path = [];
        return 'blocked';
      }
      continue;
    }
    const dx = wp.x + 0.5 - s.pos.x;
    const dy = wp.y + 0.5 - s.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const cost = dist * (TERRAIN_MOVE_COST[world.terrain[wi] as number] as number);
    if (dist > 1e-9) s.facing = facingFor(dx, dy);
    if (cost <= budget) {
      s.pos.x = wp.x + 0.5;
      s.pos.y = wp.y + 0.5;
      budget -= cost;
      s.path.shift();
    } else {
      const f = budget / cost;
      s.pos.x += dx * f;
      s.pos.y += dy * f;
      budget = 0;
    }
  }
  return s.path.length > 0 ? 'moving' : 'arrived';
}

// =============================================================================================
// 3. Starting tasks and the candidate list
// =============================================================================================

/** A path failed or the target vanished: wait a little before deciding again. */
function failTask(state: GameState, s: Settler): void {
  abortSettlerTask(state, s);
  s.task.progress = AI.pathFailCooldownHours;
}

/** Begin a task: plan the walk to `goal` (null = already in place). Returns false when the path failed. */
function beginTask(state: GameState, s: Settler, task: Task, goal: PathGoal | null): boolean {
  s.task = task;
  if (goal === null) {
    task.phase = 'working';
    s.path = [];
    return true;
  }
  const r = planMove(state, s, goal);
  if (r === 'fail') {
    failTask(state, s);
    return false;
  }
  task.phase = r === 'arrived' ? 'working' : 'moving';
  return true;
}

interface Candidate {
  sig: string;
  score: number;
  run: () => void;
}

/** Signature of the settler's current task, comparable with `Candidate.sig` (for the commitment bonus). */
function taskSig(s: Settler): string {
  const t = s.task;
  switch (t.kind) {
    case 'idle':
      return 'idle';
    case 'wander':
      return 'wander';
    case 'gather':
      return `gather:${t.resource}:${s.workplaceId ?? 0}`;
    case 'construct':
      return `construct:${t.buildingId}`;
    case 'eat':
      return 'eat';
    case 'drink':
      return 'drink';
    case 'sleep':
      return 'sleep';
    case 'rest':
      return 'rest';
    case 'socialize':
      return 'socialize';
    case 'haul':
      return `haul:${t.fromBuildingId}:${t.toBuildingId}:${t.resource}`;
    case 'work':
      return `work:${t.buildingId}`;
    case 'depart':
      return 'depart';
  }
}

function priorityOf(state: GameState, category: JobCategory): number {
  return state.colony.priorities[category];
}

export function shortageBonus(state: GameState, kind: 'food' | 'water' | 'wood' | 'stone', avail?: ResourceAmounts): number {
  const stock = state.colony.stock;
  const pop = Math.max(1, state.settlers.length);
  const sh = AI.shortage;
  switch (kind) {
    case 'food': {
      const target = state.time.season === 'autumn' ? sh.food.autumnTargetDays : sh.food.targetDays;
      return sh.food.max * clamp01(1 - stock.food / (pop * 2) / target);
    }
    case 'water':
      return sh.water.max * clamp01(1 - stock.water / (pop * 2) / sh.water.targetDays);
    case 'wood':
      // Wood and stone count what is not already promised to construction sites (GAME_DESIGN §5.3).
      return sh.wood.max * clamp01(1 - (avail ?? getAvailableStock(state)).wood / sh.wood.target);
    case 'stone':
      return sh.stone.max * clamp01(1 - (avail ?? getAvailableStock(state)).stone / sh.stone.target);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Nearest completed building (by octile distance from the settler) satisfying the test. */
function nearestBuilding(state: GameState, s: Settler, test: (b: Building) => boolean): { b: Building; dist: number } | null {
  let best: Building | null = null;
  let bestDist = Infinity;
  for (const b of state.buildings) {
    if (b.status !== 'complete' || !test(b)) continue;
    const d = octile(s.pos.x, s.pos.y, b.origin.x + b.footprint.w / 2, b.origin.y + b.footprint.h / 2);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best === null ? null : { b: best, dist: bestDist };
}

const isEatingPoint = (b: Building): boolean => BUILDING_DEFS[b.type].eatingPoint;
const isDrinkingPoint = (b: Building): boolean => BUILDING_DEFS[b.type].drinkingPoint;

function buildingGoal(b: Building): PathGoal {
  return accessGoal(b.origin.x, b.origin.y, b.footprint.w, b.footprint.h);
}

/**
 * Where a hungry settler can get a meal: the nearest eating point while the stockpile has food, otherwise
 * the nearest building whose output buffer holds food (a farm: an emergency meal; GAME_DESIGN §5.5).
 */
function foodSource(state: GameState, s: Settler): { b: Building; dist: number } | null {
  if (state.colony.stock.food >= 1) {
    const store = nearestBuilding(state, s, isEatingPoint);
    if (store) return store;
  }
  return nearestBuilding(state, s, (b) => b.output.food >= 1);
}

/** Can resting still heal this settler? Health only regenerates when fed and not parched. */
function canRegenerate(state: GameState, s: Settler): boolean {
  return s.needs.hunger >= HEALTH.regenMinHunger && !(s.status.dehydrated && state.colony.stock.water < 1);
}

// --- start functions -------------------------------------------------------------------------

function startEat(state: GameState, s: Settler, b: Building): void {
  beginTask(state, s, { kind: 'eat', buildingId: b.id, phase: 'moving', progress: 0 }, buildingGoal(b));
}

function startDrink(state: GameState, s: Settler, b: Building): void {
  beginTask(state, s, { kind: 'drink', buildingId: b.id, phase: 'moving', progress: 0 }, buildingGoal(b));
}

/** Sleep (or rest) in the home bed when there is one, otherwise by the campfire. `progress` 1 = nap. */
function startSleep(state: GameState, s: Settler, kind: 'sleep' | 'rest', nap: boolean): void {
  const bed = bedOf(state, s);
  const task: Task = { kind, buildingId: bed ? bed.id : null, phase: 'moving', progress: nap ? 1 : 0 };
  if (bed) {
    beginTask(state, s, task, buildingGoal(bed));
    return;
  }
  const spot = campfireSpot(state, s);
  beginTask(state, s, task, spot ? tileGoal(spot.x, spot.y) : null);
}

/** Collapse on the spot (exhaustion): sleep outdoors where the settler stands. */
function startCollapse(state: GameState, s: Settler): void {
  abortSettlerTask(state, s);
  s.task = { kind: 'sleep', buildingId: null, phase: 'working', progress: 0 };
}

function startSocialize(state: GameState, s: Settler, town: Building): void {
  beginTask(state, s, { kind: 'socialize', withSettlerId: null, phase: 'moving', progress: 0 }, buildingGoal(town));
}

function startWander(state: GameState, s: Settler): void {
  const world = state.world;
  const { labels } = getWalkRegions(world);
  const sx = Math.floor(s.pos.x);
  const sy = Math.floor(s.pos.y);
  const region = labels[sy * world.width + sx];
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = sx + nextInt(state.rng, -AI.wander.radius, AI.wander.radius);
    const y = sy + nextInt(state.rng, -AI.wander.radius, AI.wander.radius);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    const i = y * world.width + x;
    if (!isPassable(world, i) || labels[i] !== region || (x === sx && y === sy)) continue;
    if (beginTask(state, s, { kind: 'wander', targetTile: { x, y }, phase: 'moving', progress: 0 }, tileGoal(x, y))) return;
    return;
  }
  failTask(state, s);
}

function startConstruct(state: GameState, s: Settler, site: Building): void {
  ensureTool(state, s, 'building');
  s.workplaceId = site.id;
  beginTask(state, s, { kind: 'construct', buildingId: site.id, phase: 'moving', progress: 0 }, buildingGoal(site));
}

/** Tiles other settlers are already gathering from (tile reservation). */
function reservedTiles(state: GameState, self: Settler): Set<number> {
  const W = state.world.width;
  const taken = new Set<number>();
  for (const o of state.settlers) {
    if (o !== self && o.task.kind === 'gather') taken.add(o.task.targetTile.y * W + o.task.targetTile.x);
  }
  return taken;
}

/** Units of `resource` other haulers have already claimed for a construction site (picked up or not). */
function plannedToSite(state: GameState, self: Settler, siteId: number, resource: ResourceType): number {
  let sum = 0;
  for (const o of state.settlers) {
    if (o !== self && o.task.kind === 'haul' && o.task.toBuildingId === siteId && o.task.resource === resource) sum += o.task.amount;
  }
  return sum;
}

/** Units of `resource` other haulers are on their way to pick up from a building's output buffer. */
function claimedFromOutput(state: GameState, self: Settler, buildingId: number, resource: ResourceType): number {
  let sum = 0;
  for (const o of state.settlers) {
    if (o !== self && o.task.kind === 'haul' && o.task.fromBuildingId === buildingId && o.task.resource === resource && o.carrying === null) {
      sum += o.task.amount;
    }
  }
  return sum;
}

/**
 * Where a gatherer drops a load: the nearer of the source building's own output buffer (when the whole
 * load fits) and the nearest town center / storage (GAME_DESIGN §6.3).
 */
function chooseDropOff(state: GameState, s: Settler, source: Building, resource: ResourceType, amount: number): Building | null {
  const sdef = BUILDING_DEFS[source.type];
  const store = nearestBuilding(state, s, isEatingPoint);
  if (sdef.outputCap > 0 && source.output[resource] + Math.max(1, amount) <= sdef.outputCap) {
    const d = octile(s.pos.x, s.pos.y, source.origin.x + source.footprint.w / 2, source.origin.y + source.footprint.h / 2);
    if (store === null || d <= store.dist) return source;
  }
  return store ? store.b : null;
}

/** Units of `resource` other gatherers are carrying towards the stock. */
function carriedByOthers(state: GameState, self: Settler, resource: ResourceType): number {
  let sum = 0;
  for (const o of state.settlers) if (o !== self && o.task.kind === 'gather' && o.carrying && o.carrying.resource === resource) sum += o.carrying.amount;
  return sum;
}

/**
 * Is there room for one more unit on top of what the settler already carries: in the source building's
 * buffer or in the stockpile (counting loads other gatherers are bringing)? Gathering stops when not,
 * so goods are never harvested just to be thrown away.
 */
function hasRoomFor(state: GameState, s: Settler, source: Building, resource: ResourceType): boolean {
  const carried = s.carrying && s.carrying.resource === resource ? s.carrying.amount : 0;
  const others = carriedByOthers(state, s, resource); // loads other gatherers are about to put down
  const cap = BUILDING_DEFS[source.type].outputCap;
  if (cap > 0 && cap - source.output[resource] - others >= carried + 1) return true;
  return getStorageCapacity(state) - state.colony.stock[resource] - others >= carried + 1;
}

interface GatherTarget {
  x: number;
  y: number;
  goal: PathGoal;
}

/**
 * The best tile to gather from around a building: maximises `resource - 2 * dist` (GAME_DESIGN §6.5)
 * among tiles with resource left that the settler can reach.
 */
function findGatherTarget(state: GameState, s: Settler, b: Building, resource: 'wood' | 'stone'): GatherTarget | null {
  const world = state.world;
  const W = world.width;
  const def = BUILDING_DEFS[b.type];
  const r = def.workRadius;
  const { labels } = getWalkRegions(world);
  const myRegion = labels[Math.floor(s.pos.y) * W + Math.floor(s.pos.x)] as number;
  const cx = b.origin.x + b.footprint.w / 2;
  const cy = b.origin.y + b.footprint.h / 2;
  const taken = reservedTiles(state, s);
  let best: GatherTarget | null = null;
  let bestScore = -Infinity;
  for (let y = Math.max(0, b.origin.y - r); y < Math.min(world.height, b.origin.y + b.footprint.h + r); y++) {
    for (let x = Math.max(0, b.origin.x - r); x < Math.min(W, b.origin.x + b.footprint.w + r); x++) {
      const i = y * W + x;
      const res = world.resource[i] as number;
      if (res < 1 || world.building[i] !== 0 || taken.has(i)) continue;
      const t = world.terrain[i] as number;
      let standable = false;
      if (resource === 'wood') {
        if (t !== Terrain.Forest) continue;
        standable = labels[i] === myRegion;
      } else if (t === Terrain.Hills) {
        standable = labels[i] === myRegion;
      } else if (t === Terrain.Mountain) {
        for (let dy = -1; dy <= 1 && !standable; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= world.height) continue;
            const ni = ny * W + nx;
            if (labels[ni] === myRegion && world.building[ni] === 0) {
              standable = true;
              break;
            }
          }
        }
      } else continue;
      if (!standable) continue;
      const score = res - 2 * octile(cx, cy, x + 0.5, y + 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = {
          x,
          y,
          goal: t === Terrain.Mountain ? { x0: x - 1, y0: y - 1, x1: x + 1, y1: y + 1 } : tileGoal(x, y),
        };
      }
    }
  }
  return best;
}

function startGather(state: GameState, s: Settler, source: Building, resource: 'wood' | 'stone', target: GatherTarget): void {
  const category: JobCategory = resource === 'wood' ? 'woodcutting' : 'mining';
  ensureTool(state, s, category);
  const drop = chooseDropOff(state, s, source, resource, 0);
  s.workplaceId = source.id;
  beginTask(
    state,
    s,
    {
      kind: 'gather',
      resource,
      targetTile: { x: target.x, y: target.y },
      dropOffBuildingId: drop ? drop.id : null,
      phase: 'moving',
      progress: 0,
    },
    target.goal,
  );
}

/** Count settlers per workplace (and per gathered resource for forage slots) without allocating objects per settler. */
function countWorkers(state: GameState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of state.settlers) {
    if (w.workplaceId === null) continue;
    const key = w.task.kind === 'gather' ? `${w.workplaceId}:${w.task.resource}` : `${w.workplaceId}:${w.task.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function workScore(state: GameState, s: Settler, category: JobCategory, extra: number, dist: number): number | null {
  const p = priorityOf(state, category);
  const band = moodBand(s.needs.happiness);
  if (p === 0 || band.refusesWork) return null;
  let score =
    (AI.priorityBase[p] as number) +
    AI.skillScorePerLevel * s.skills[skillOf(category)] +
    extra -
    AI.distPenaltyPerTile * Math.min(dist, AI.distPenaltyMaxTiles);
  if (hasTrait(s, 'hardworking')) score += AI.traitWorkBonus.hardworking;
  else if (hasTrait(s, 'lazy')) score += AI.traitWorkBonus.lazy;
  return score * band.workScoreMult;
}

function startWork(state: GameState, s: Settler, b: Building): void {
  const def = BUILDING_DEFS[b.type];
  if (def.jobCategory !== null) ensureTool(state, s, def.jobCategory);
  s.workplaceId = b.id;
  beginTask(state, s, { kind: 'work', buildingId: b.id, phase: 'moving', progress: 0 }, buildingGoal(b));
}

function startHaul(state: GameState, s: Settler, from: Building, to: Building, resource: ResourceType, amount: number): void {
  beginTask(
    state,
    s,
    { kind: 'haul', resource, amount, fromBuildingId: from.id, toBuildingId: to.id, phase: 'moving', progress: 0 },
    buildingGoal(from),
  );
}

/** Tools the colony wants to have in stock (GAME_DESIGN §5.3). */
function toolTarget(pop: number): number {
  return Math.max(AI.shortage.tools.min, Math.ceil(pop * AI.shortage.tools.perPop));
}

/** Total tools the colony has: the stockpile plus finished tools waiting in workshop buffers. */
function toolsOnHand(state: GameState): number {
  let n = state.colony.stock.tools;
  for (const b of state.buildings) n += b.output.tools;
  return n;
}

/**
 * Smallest buffer worth a hauling trip. During a food or water shortage anything is worth carrying
 * to the larder, and tools are always carried one by one (they are made one at a time).
 */
function minLoadFor(state: GameState, resource: ResourceType): number {
  if (resource === 'tools') return 1;
  if ((resource === 'food' || resource === 'water') && shortageBonus(state, resource) > 0) return 1;
  return AI.haul.minLoad;
}

/** Production multiplier of the building itself (season, weather, water nearby). 0 = cannot produce now. */
function buildingMult(ctx: TickContext, b: Building): number {
  switch (b.type) {
    case 'farm': {
      let m = SEASON_FARM_MULT[ctx.season] * ctx.weather.farmGrowth;
      if (ctx.drought) m *= EVENTS.drought.farmMult;
      if (ctx.bountiful) m *= EVENTS.bountifulHarvest.farmMult;
      if (ctx.state.activeEvents.some((e) => e.kind === 'cropBlight' && e.targetId === b.id)) m = 0;
      return m;
    }
    case 'well': {
      let m = (nearWater(ctx.state, b) ? WELL_NEAR_WATER.mult : 1) * ctx.weather.wellMult;
      if (ctx.drought) m *= EVENTS.drought.wellMult;
      if (ctx.coldSnap) m *= EVENTS.coldSnap.wellMult;
      return m;
    }
    default:
      return 1;
  }
}

const nearWaterCache = new WeakMap<GameState, Map<number, boolean>>();

/** Whether deep or shallow water lies within the well bonus radius of the building (terrain never changes to or from water). */
function nearWater(state: GameState, b: Building): boolean {
  let cache = nearWaterCache.get(state);
  if (!cache) {
    cache = new Map();
    nearWaterCache.set(state, cache);
  }
  const known = cache.get(b.id);
  if (known !== undefined) return known;
  const world = state.world;
  const r = WELL_NEAR_WATER.radius;
  let found = false;
  for (let y = Math.max(0, b.origin.y - r); y < Math.min(world.height, b.origin.y + b.footprint.h + r) && !found; y++) {
    for (let x = Math.max(0, b.origin.x - r); x < Math.min(world.width, b.origin.x + b.footprint.w + r); x++) {
      if ((world.terrain[y * world.width + x] as number) <= Terrain.ShallowWater) {
        found = true;
        break;
      }
    }
  }
  cache.set(b.id, found);
  return found;
}

/** Work candidates (GAME_DESIGN §5.3-§5.4): build, production buildings, gathering and hauling. */
function workCandidates(ctx: TickContext, s: Settler, out: Candidate[]): void {
  const state = ctx.state;
  const counts = countWorkers(state);
  const sx = s.pos.x;
  const sy = s.pos.y;
  const homeless = state.settlers.some((o) => o.homeId === null);
  const capacity = getStorageCapacity(state);
  const available = getAvailableStock(state);
  const pop = state.settlers.length;
  const centre = (b: Building) => octile(sx, sy, b.origin.x + b.footprint.w / 2, b.origin.y + b.footprint.h / 2);

  // Build: only while the delivered materials allow more progress.
  for (const b of state.buildings) {
    if (b.status !== 'construction' || b.construction === null) continue;
    const def = BUILDING_DEFS[b.type];
    if ((counts.get(`${b.id}:construct`) ?? 0) - (s.task.kind === 'construct' && s.task.buildingId === b.id ? 1 : 0) >= def.maxBuilders) continue;
    if (b.construction.progress >= deliveredFraction(b) - 1e-9) continue;
    let bonus: number = AI.buildTaskBonus.any;
    if (b.type === 'house' && homeless) bonus += AI.buildTaskBonus.houseWhileHomeless;
    if (b.type === 'farm' && shortageBonus(state, 'food') > AI.buildTaskBonus.shortageThreshold) bonus += AI.buildTaskBonus.farmOrWellInShortage;
    if (b.type === 'well' && shortageBonus(state, 'water') > AI.buildTaskBonus.shortageThreshold) bonus += AI.buildTaskBonus.farmOrWellInShortage;
    const score = workScore(state, s, 'building', bonus, centre(b));
    if (score === null) continue;
    out.push({ sig: `construct:${b.id}`, score, run: () => startConstruct(state, s, b) });
  }

  // Production buildings with a recipe: farm, well, workshop.
  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (b.status !== 'complete' || def.production === null || def.jobCategory === null) continue;
    const recipe = def.production;
    const taken = (counts.get(`${b.id}:work`) ?? 0) - (s.task.kind === 'work' && s.task.buildingId === b.id ? 1 : 0);
    if (taken >= def.maxWorkers) continue;
    if (b.output[recipe.output] >= def.outputCap) continue;
    if (buildingMult(ctx, b) <= 0) continue;
    // Famine: food or water already waiting in the buffer must reach the larder before more is made.
    if ((recipe.output === 'food' || recipe.output === 'water') && state.colony.stock[recipe.output] < pop && b.output[recipe.output] >= 1) continue;
    let shortage = 0;
    if (recipe.output === 'food') shortage = shortageBonus(state, 'food');
    else if (recipe.output === 'water') shortage = shortageBonus(state, 'water');
    else if (recipe.output === 'tools') {
      const target = toolTarget(pop);
      if (toolsOnHand(state) >= target) continue;
      if (b.productionProgress <= 0) {
        const avail = getAvailableStock(state);
        if (!RESOURCE_TYPES.every((r) => avail[r] >= (recipe.inputs[r] ?? 0))) continue;
      }
      shortage = AI.shortage.tools.max * clamp01(1 - toolsOnHand(state) / target);
    }
    const full = state.colony.stock[recipe.output] >= capacity ? AI.storageFullPenalty : 0;
    const score = workScore(state, s, def.jobCategory, shortage - full, centre(b));
    if (score === null) continue;
    out.push({ sig: `work:${b.id}`, score, run: () => startWork(state, s, b) });
  }

  // Gather wood and mine stone: best source building per resource.
  const sources: { resource: 'wood' | 'stone'; category: JobCategory; slotCount: (b: Building) => number }[] = [
    { resource: 'wood', category: 'woodcutting', slotCount: (b) => (b.type === 'lumberCamp' ? BUILDING_DEFS.lumberCamp.maxWorkers : BUILDING_DEFS[b.type].forage?.wood ?? 0) },
    { resource: 'stone', category: 'mining', slotCount: (b) => (b.type === 'mine' ? BUILDING_DEFS.mine.maxWorkers : BUILDING_DEFS[b.type].forage?.stone ?? 0) },
  ];
  for (const src of sources) {
    let best: { b: Building; target: GatherTarget; score: number } | null = null;
    for (const b of state.buildings) {
      if (b.status !== 'complete') continue;
      const slots = src.slotCount(b);
      if (slots <= 0) continue;
      const taken = (counts.get(`${b.id}:${src.resource}`) ?? 0) - (s.task.kind === 'gather' && s.workplaceId === b.id && s.task.resource === src.resource ? 1 : 0);
      if (taken >= slots) continue;
      if (!hasRoomFor(state, s, b, src.resource)) continue; // storage full: nothing to do with more goods
      const stockFull = state.colony.stock[src.resource] >= capacity ? AI.storageFullPenalty : 0;
      const score = workScore(state, s, src.category, shortageBonus(state, src.resource, available) - stockFull, centre(b));
      if (score === null || (best !== null && score <= best.score)) continue;
      const target = findGatherTarget(state, s, b, src.resource);
      if (target === null) continue;
      best = { b, target, score };
    }
    if (best !== null) {
      const chosen = best;
      out.push({
        sig: `gather:${src.resource}:${chosen.b.id}`,
        score: chosen.score,
        run: () => startGather(state, s, chosen.b, src.resource, chosen.target),
      });
    }
  }

  haulCandidates(ctx, s, out, capacity);
}

/** Hauling (GAME_DESIGN §5.4): supply construction sites, and empty full output buffers into the stock. */
function haulCandidates(ctx: TickContext, s: Settler, out: Candidate[], capacity: number): void {
  const state = ctx.state;
  const carry = carryCapacity(s);
  const stores = (b: Building) => b.status === 'complete' && isEatingPoint(b);

  // Supply a site.
  for (const site of state.buildings) {
    const c = site.construction;
    if (site.status !== 'construction' || c === null || c.kind !== 'new') continue;
    let bestRes: ResourceType | null = null;
    let bestNeed = 0;
    for (const r of RESOURCE_TYPES) {
      const need = c.required[r] - c.delivered[r] - plannedToSite(state, s, site.id, r);
      if (need >= 1 && state.colony.stock[r] >= 1 && need > bestNeed) {
        bestRes = r;
        bestNeed = need;
      }
    }
    if (bestRes === null) continue;
    const from = nearestBuilding(state, s, stores);
    if (!from) continue;
    const amount = Math.min(carry, Math.floor(bestNeed), Math.floor(state.colony.stock[bestRes]));
    if (amount < 1) continue;
    const score = workScore(state, s, 'hauling', AI.haul.supplySiteBonus, octile(s.pos.x, s.pos.y, site.origin.x + site.footprint.w / 2, site.origin.y + site.footprint.h / 2));
    if (score === null) continue;
    const resource = bestRes;
    out.push({
      sig: `haul:${from.b.id}:${site.id}:${resource}`,
      score,
      run: () => startHaul(state, s, from.b, site, resource, amount),
    });
  }

  // Empty an output buffer.
  let best: { b: Building; r: ResourceType; avail: number; bonus: number } | null = null;
  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (b.status !== 'complete' || def.outputCap <= 0) continue;
    for (const r of RESOURCE_TYPES) {
      const avail = b.output[r] - claimedFromOutput(state, s, b.id, r);
      if (avail < minLoadFor(state, r) || state.colony.stock[r] >= capacity) continue;
      const fill = b.output[r] / def.outputCap;
      // Food and water short in the larder: moving them there is as urgent as making them (§5.3 shortage bonus).
      const urgency = r === 'food' || r === 'water' ? shortageBonus(state, r) : 0;
      const bonus = AI.haul.fillBonus * fill + (fill >= 1 ? AI.haul.fullBonus : 0) + urgency;
      if (best === null || bonus > best.bonus) best = { b, r, avail, bonus };
    }
  }
  if (best !== null) {
    const chosen = best;
    const dest = nearestBuilding(state, s, stores);
    const score = dest
      ? workScore(state, s, 'hauling', chosen.bonus, octile(s.pos.x, s.pos.y, chosen.b.origin.x + chosen.b.footprint.w / 2, chosen.b.origin.y + chosen.b.footprint.h / 2))
      : null;
    if (dest && score !== null) {
      const amount = Math.min(carry, Math.floor(chosen.avail));
      out.push({
        sig: `haul:${chosen.b.id}:${dest.b.id}:${chosen.r}`,
        score,
        run: () => startHaul(state, s, chosen.b, dest.b, chosen.r, amount),
      });
    }
  }
}

/** Fraction of the site's materials delivered (1 when nothing is required): caps the buildable progress. */
function deliveredFraction(b: Building): number {
  const c = b.construction;
  if (c === null) return 1;
  let req = 0;
  let del = 0;
  for (const r of RESOURCE_TYPES) {
    req += c.required[r];
    del += Math.min(c.delivered[r], c.required[r]);
  }
  return req <= 0 ? 1 : del / req;
}

/** Whether another settler is awake and free to chat. */
function hasSocialPartner(state: GameState, s: Settler): boolean {
  for (const o of state.settlers) {
    if (o === s) continue;
    const k = o.task.kind;
    if (k === 'idle' || k === 'wander' || k === 'socialize' || k === 'eat' || k === 'drink') return true;
  }
  return false;
}

function buildCandidates(ctx: TickContext, s: Settler): Candidate[] {
  const state = ctx.state;
  const out: Candidate[] = [];
  const n = s.needs;
  const stock = state.colony.stock;
  const rng = state.rng;
  const sulking = s.status.sulkHoursLeft > 0;

  if (!sulking) {
    // 1. eat
    if (n.hunger < AI.eat.maxHunger) {
      const point = foodSource(state, s);
      if (point) {
        const b = point.b;
        out.push({
          sig: 'eat',
          score: AI.eat.base + AI.eat.slope * (AI.eat.maxHunger - n.hunger) - AI.eat.distPenaltyPerTile * Math.min(point.dist, AI.eat.distMaxTiles),
          run: () => startEat(state, s, b),
        });
      }
    }
    // 2. drink
    const starvingFallback = stock.food === 0 && n.hunger < DRINK.starvingMaxHunger && s.status.drinkCooldownHours <= 0;
    if (stock.water >= 1 && (s.status.dehydrated || starvingFallback)) {
      const point = nearestBuilding(state, s, isDrinkingPoint);
      if (point) {
        const b = point.b;
        out.push({
          sig: 'drink',
          score: s.status.dehydrated
            ? AI.drink.dehydratedScore
            : AI.eat.base + AI.eat.slope * (AI.eat.maxHunger - n.hunger) - AI.eat.distPenaltyPerTile * Math.min(point.dist, AI.eat.distMaxTiles),
          run: () => startDrink(state, s, b),
        });
      }
    }
    // 3. sleep
    if (n.energy < AI.sleep.maxEnergy) {
      const bed = bedOf(state, s);
      const spot = bed ? null : campfireSpot(state, s);
      const tx = bed ? bed.origin.x + bed.footprint.w / 2 : spot ? spot.x + 0.5 : s.pos.x;
      const ty = bed ? bed.origin.y + bed.footprint.h / 2 : spot ? spot.y + 0.5 : s.pos.y;
      const night = inNightWindow(s, ctx.hour);
      out.push({
        sig: 'sleep',
        score:
          AI.sleep.slope * (AI.sleep.maxEnergy - n.energy) +
          (night ? AI.sleep.nightBonus : 0) +
          (s.status.sickHoursLeft > 0 ? EVENTS.sickness.sleepScoreBonus : 0) -
          AI.sleep.distPenaltyPerTile * Math.min(octile(s.pos.x, s.pos.y, tx, ty), AI.sleep.distMaxTiles),
        run: () => startSleep(state, s, 'sleep', ctx.phase !== 'night' && !night),
      });
    }
    // 4. socialize
    const town = state.buildings.find((b) => b.type === 'townCenter' && b.status === 'complete');
    if (town && ctx.festival) {
      // Harvest festival: everyone gathers at the town center (critical needs still interrupt).
      out.push({ sig: 'socialize', score: 150, run: () => startSocialize(state, s, town) });
    } else if (town && !hasTrait(s, 'loner') && n.happiness < AI.socialize.maxHappiness && hasSocialPartner(state, s)) {
      const sociable = hasTrait(s, 'sociable');
      const recentlySocialized = s.moodlets.some((m) => m.id === 'socialized');
      out.push({
        sig: 'socialize',
        score:
          AI.socialize.base +
          AI.socialize.slope * Math.max(0, AI.socialize.slopeBelow - n.happiness) +
          (ctx.phase === 'dusk' ? AI.socialize.duskBonus : 0) +
          (sociable ? AI.socialize.sociableBonus : 0) -
          (recentlySocialized ? AI.socialize.cooldownPenalty : 0),
        run: () => startSocialize(state, s, town),
      });
    }
    // 5/6. work and haul
    workCandidates(ctx, s, out);
  }
  // 7. wander (always available; the only choice while sulking)
  out.push({
    sig: 'wander',
    score: AI.wander.score + (hasTrait(s, 'lazy') ? AI.wander.lazyBonus : 0),
    run: () => startWander(state, s),
  });

  // Jitter, in candidate order, so the RNG stream is deterministic.
  for (const c of out) c.score += nextFloat(rng) * AI.jitterMax;
  return out;
}

/** The decision loop (GAME_DESIGN §5.1): score all candidates, keep the best, with a bonus for the current task. */
function decide(ctx: TickContext, s: Settler): void {
  const state = ctx.state;
  s.hoursSinceDecision = 0;
  const candidates = buildCandidates(ctx, s);
  const currentSig = taskSig(s);
  let best: Candidate | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const score = c.score + (c.sig === currentSig ? AI.commitmentBonus : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best === null) return;
  // Keeping the current task: nothing to restart.
  if (best.sig === currentSig && s.task.kind !== 'idle') return;
  abortSettlerTask(state, s);
  best.run();
}

// =============================================================================================
// 4. Task execution
// =============================================================================================

/** The critical response to apply right now, or null (GAME_DESIGN §5.5). */
function criticalResponse(ctx: TickContext, s: Settler): 'eat' | 'drink' | 'rest' | null {
  const n = s.needs;
  const stock = ctx.state.colony.stock;
  if (n.hunger < AI.critical.hungerBelow) {
    if (stock.food >= 1 || ctx.state.buildings.some((b) => b.status === 'complete' && b.output.food >= 1)) return 'eat';
    if (stock.water >= 1 && s.status.drinkCooldownHours <= 0) return 'drink';
  }
  // Resting only helps while health can regenerate (fed, not parched); otherwise the settler goes looking for food.
  if (n.health < AI.critical.healthRestBelow && canRegenerate(ctx.state, s)) return 'rest';
  return null;
}

function applyCritical(ctx: TickContext, s: Settler, response: 'eat' | 'drink' | 'rest'): void {
  const state = ctx.state;
  abortSettlerTask(state, s);
  switch (response) {
    case 'eat': {
      const p = foodSource(state, s);
      if (p) startEat(state, s, p.b);
      else failTask(state, s);
      return;
    }
    case 'drink': {
      const p = nearestBuilding(state, s, isDrinkingPoint);
      if (p) startDrink(state, s, p.b);
      else failTask(state, s);
      return;
    }
    case 'rest':
      startSleep(state, s, 'rest', false);
      return;
  }
}

function isResponseTask(s: Settler, response: 'eat' | 'drink' | 'rest'): boolean {
  switch (response) {
    case 'eat':
      return s.task.kind === 'eat';
    case 'drink':
      return s.task.kind === 'drink';
    case 'rest':
      return s.task.kind === 'rest' || isAsleep(s);
  }
}

function completeConstruction(ctx: TickContext, b: Building): void {
  const state = ctx.state;
  const c = b.construction;
  if (c === null) return;
  const repair = c.kind === 'repair';
  b.status = 'complete';
  b.construction = null;
  // Release every builder; their tasks end next tick.
  for (const w of state.settlers) {
    if (w.workplaceId === b.id) {
      w.workplaceId = null;
      if (w.task.kind === 'construct' && w.task.buildingId === b.id) {
        w.path = [];
        w.task = IDLE_TASK();
      }
    }
  }
  const def = BUILDING_DEFS[b.type];
  if (repair) {
    ctx.events.push({ type: 'buildingRepaired', buildingId: b.id, buildingType: b.type });
    pushLog(state, 'good', `${def.name} repaired.`, { buildingId: b.id, tile: { ...b.origin } });
  } else {
    state.stats.buildingsCompleted++;
    ctx.events.push({ type: 'buildingCompleted', buildingId: b.id, buildingType: b.type });
    pushLog(state, 'good', `${def.name} completed.`, { buildingId: b.id, tile: { ...b.origin } });
  }
  assignHomes(state);
  if (!repair) checkObjectives(state, ctx.events);
}

function wakeUp(ctx: TickContext, s: Settler): void {
  const t = s.task;
  const outdoors = (t.kind === 'sleep' || t.kind === 'rest') && t.buildingId === null;
  if (t.kind === 'sleep') {
    // The mood effect of the night: bed vs. bedroll (cold in winter), replacing the previous one.
    const id = !outdoors ? 'sleptInHouse' : ctx.season === 'winter' ? 'sleptOutdoorsCold' : 'sleptOutdoors';
    s.moodlets = s.moodlets.filter((m) => m.id !== 'sleptInHouse' && m.id !== 'sleptOutdoors' && m.id !== 'sleptOutdoorsCold');
    const def = MOODLETS[id] as { value: number; hours: number };
    s.moodlets.push({ id, value: def.value, hoursLeft: def.hours });
    s.status.sleptOutdoorsLastNight = outdoors;
  }
  s.status.hoursWorkedSinceWake = 0;
  s.task = IDLE_TASK();
}

function stepTask(ctx: TickContext, s: Settler): void {
  const state = ctx.state;
  const t = s.task;
  const dt = ctx.dt;
  switch (t.kind) {
    case 'idle': {
      if (t.progress > 0) t.progress = Math.max(0, t.progress - dt);
      return;
    }
    case 'wander': {
      if (t.phase === 'moving') {
        const r = walk(ctx, s);
        if (r === 'blocked') return failTask(state, s);
        if (r === 'arrived') {
          t.phase = 'working';
          t.progress = 0;
        }
        return;
      }
      t.progress += dt;
      if (t.progress >= AI.wander.hours) {
        s.task = IDLE_TASK();
        // While sulking, keep wandering.
        if (s.status.sulkHoursLeft > 0) startWander(state, s);
      }
      return;
    }
    case 'eat':
    case 'drink': {
      const b = findBuilding(state, t.buildingId);
      const ok =
        b !== null &&
        b.status === 'complete' &&
        (t.kind === 'eat' ? isEatingPoint(b) || b.output.food >= 1 : isDrinkingPoint(b));
      if (!ok) return failTask(state, s);
      if (t.phase === 'moving') {
        const r = walk(ctx, s);
        if (r === 'blocked') return failTask(state, s);
        if (r === 'arrived') t.phase = 'working';
        return;
      }
      t.progress += dt;
      const duration = t.kind === 'eat' ? MEAL.hours : DRINK.hours;
      if (t.progress < duration) return;
      const stock = state.colony.stock;
      if (t.kind === 'eat') {
        // The meal comes from the stockpile at an eating point, or straight from the buffer of a farm.
        const fromStock = stock.food >= 1 && isEatingPoint(b as Building);
        const fromBuffer = !fromStock && (b as Building).output.food >= 1;
        if (fromStock || fromBuffer || stock.food >= 1) {
          if (fromBuffer) (b as Building).output.food -= MEAL.food;
          else stock.food -= MEAL.food;
          recordConsumed(state, 'food', MEAL.food);
          ctx.events.push({ type: 'resourceConsumed', resource: 'food', amount: MEAL.food, reason: 'meal' });
          s.needs.hunger = Math.min(NEED_MAX, s.needs.hunger + MEAL.hungerRestore);
          if (stock.water >= MEAL.water) {
            stock.water -= MEAL.water;
            recordConsumed(state, 'water', MEAL.water);
            ctx.events.push({ type: 'resourceConsumed', resource: 'water', amount: MEAL.water, reason: 'meal' });
            s.status.dehydrated = false;
          } else {
            s.status.dehydrated = true;
          }
        }
      } else if (stock.water >= DRINK.water) {
        const hadFood = stock.food > 0;
        stock.water -= DRINK.water;
        recordConsumed(state, 'water', DRINK.water);
        ctx.events.push({ type: 'resourceConsumed', resource: 'water', amount: DRINK.water, reason: 'drink' });
        s.status.dehydrated = false;
        if (!hadFood) {
          s.needs.hunger = Math.min(NEED_MAX, s.needs.hunger + DRINK.starvingHungerRestore);
          s.status.drinkCooldownHours = DRINK.starvingCooldownHours;
        }
      }
      s.task = IDLE_TASK();
      return;
    }
    case 'sleep':
    case 'rest': {
      if (t.buildingId !== null) {
        const bed = findBuilding(state, t.buildingId);
        if (bed === null || bed.status !== 'complete') return failTask(state, s);
      }
      if (t.phase === 'moving') {
        const r = walk(ctx, s);
        if (r === 'blocked') return failTask(state, s);
        if (r === 'arrived') t.phase = 'working';
        return;
      }
      if (t.kind === 'rest') {
        // Rest until recovered, or give up when it cannot heal (hungry or parched): go and find food instead.
        if (s.needs.health >= HEALTH.restUntil || !canRegenerate(state, s)) wakeUp(ctx, s);
        return;
      }
      const wakeAt = t.progress === 1 ? SLEEP_WAKE.nap : SLEEP_WAKE.full;
      if (s.needs.energy >= wakeAt && (t.progress === 1 || !inNightWindow(s, ctx.hour))) wakeUp(ctx, s);
      return;
    }
    case 'socialize': {
      const town = nearestBuilding(state, s, (b) => b.type === 'townCenter');
      if (!town) return failTask(state, s);
      if (t.phase === 'moving') {
        const r = walk(ctx, s);
        if (r === 'blocked') return failTask(state, s);
        if (r === 'arrived') t.phase = 'working';
        return;
      }
      t.progress += dt;
      if (t.progress < AI.socialize.hours) return;
      grantSocialized(ctx, s);
      s.task = IDLE_TASK();
      return;
    }
    case 'gather':
      return stepGather(ctx, s, t);
    case 'construct':
      return stepConstruct(ctx, s, t);
    case 'haul':
      return stepHaul(ctx, s, t);
    case 'work':
      return stepWork(ctx, s, t);
    case 'depart': {
      const r = walk(ctx, s);
      if (r === 'blocked') return failTask(state, s);
      if (r === 'arrived') departQueue.push(s.id);
      return;
    }
  }
}

/** Settlers that finished walking away this tick; removed once the settler loop is done. */
const departQueue: number[] = [];

function grantSocialized(ctx: TickContext, s: Settler): void {
  const state = ctx.state;
  if (hasTrait(s, 'loner')) return;
  let partner = false;
  for (const o of state.settlers) {
    if (o === s) continue;
    const dx = o.pos.x - s.pos.x;
    const dy = o.pos.y - s.pos.y;
    if (dx * dx + dy * dy > AI.socialize.partnerRadius * AI.socialize.partnerRadius) continue;
    const chatting = o.task.kind === 'socialize' && o.task.phase === 'working';
    const justFinished = o.moodlets.some(
      (m) => m.id === 'socialized' && m.hoursLeft !== null && m.hoursLeft >= (MOODLETS.socialized as { hours: number }).hours - AI.socialize.partnerOverlapHours,
    );
    if (chatting || justFinished) {
      partner = true;
      break;
    }
  }
  if (!partner) return;
  const base = MOODLETS.socialized as { value: number; hours: number };
  const value = hasTrait(s, 'sociable') ? TRAIT_EFFECTS.sociable.socializedMoodlet : base.value;
  s.moodlets = s.moodlets.filter((m) => m.id !== 'socialized');
  s.moodlets.push({ id: 'socialized', value, hoursLeft: base.hours });
  s.status.lastSocializedTick = ctx.tick;
}

function stepConstruct(ctx: TickContext, s: Settler, t: Extract<Task, { kind: 'construct' }>): void {
  const state = ctx.state;
  const site = findBuilding(state, t.buildingId);
  if (site === null || site.status !== 'construction' || site.construction === null) return failTaskQuiet(state, s);
  if (t.phase === 'moving') {
    const r = walk(ctx, s);
    if (r === 'blocked') return failTask(state, s);
    if (r === 'arrived') t.phase = 'working';
    return;
  }
  const def = BUILDING_DEFS[site.type];
  const c = site.construction;
  const mult = workSpeedMult(ctx, s, 'building', 'construction');
  const cap = deliveredFraction(site) * def.buildHours;
  if (c.workDone >= cap && c.workDone < def.buildHours) return; // waiting for materials
  c.workDone = Math.min(def.buildHours, c.workDone + BUILD_RATE * mult * ctx.dt);
  c.progress = def.buildHours > 0 ? Math.min(1, c.workDone / def.buildHours) : 1;
  grantXp(s, 'construction', ctx.dt);
  wearTool(state, s, ctx.dt);
  if (c.progress >= 1) completeConstruction(ctx, site);
}

/** Hauling: pick up (0.1 h), walk, drop (0.1 h). Supplies construction sites or empties output buffers into the stock. */
function stepHaul(ctx: TickContext, s: Settler, t: Extract<Task, { kind: 'haul' }>): void {
  const state = ctx.state;
  const from = t.fromBuildingId === null ? null : findBuilding(state, t.fromBuildingId);
  const to = findBuilding(state, t.toBuildingId);
  if (from === null || from.status !== 'complete' || to === null) return failTaskQuiet(state, s);
  const supply = to.status === 'construction';
  if (supply && (to.construction === null || to.construction.kind !== 'new')) return failTaskQuiet(state, s);
  if (!supply && to.status !== 'complete') return failTaskQuiet(state, s);

  if (t.phase === 'moving') {
    const r = walk(ctx, s);
    if (r === 'blocked') return failTask(state, s);
    if (r === 'arrived') {
      t.phase = 'working';
      t.progress = 0;
    }
    return;
  }
  if (t.phase === 'returning') {
    const r = walk(ctx, s);
    if (r === 'blocked') return failTask(state, s);
    if (r === 'arrived') {
      t.phase = 'working';
      t.progress = 0;
    }
    return;
  }

  t.progress += ctx.dt;
  if (s.carrying === null) {
    // Pick up.
    if (t.progress < AI.haul.pickupHours) return;
    const available = supply ? state.colony.stock[t.resource] : from.output[t.resource];
    const amount = Math.min(t.amount, Math.floor(available));
    if (amount < 1) return failTaskQuiet(state, s);
    if (supply) state.colony.stock[t.resource] -= amount;
    else from.output[t.resource] -= amount;
    s.carrying = { resource: t.resource, amount };
    t.amount = amount;
    t.phase = 'returning';
    t.progress = 0;
    if (planMove(state, s, buildingGoal(to)) === 'fail') failTask(state, s);
    return;
  }
  // Drop.
  if (t.progress < AI.haul.dropHours) return;
  const load = s.carrying;
  let delivered = 0;
  if (supply) {
    const c = to.construction as NonNullable<Building['construction']>;
    delivered = Math.max(0, Math.min(load.amount, c.required[load.resource] - c.delivered[load.resource]));
    c.delivered[load.resource] += delivered;
  } else {
    delivered = addStockOf(state, load.resource, load.amount);
  }
  const leftover = load.amount - delivered;
  if (leftover > 0) {
    // Whatever did not fit goes back to where it came from (or the stock); a little may be lost at the cap.
    const back = supply ? addStockOf(state, load.resource, leftover) : Math.min(leftover, Math.max(0, BUILDING_DEFS[from.type].outputCap - from.output[load.resource]));
    if (!supply) from.output[load.resource] += back;
    reportLoss(state, load.resource, leftover - back, 'storage full');
  }
  ctx.events.push({ type: 'resourceDelivered', settlerId: s.id, buildingId: to.id, resource: load.resource, amount: delivered });
  grantXp(s, 'hauling', AI.haul.pickupHours + AI.haul.dropHours);
  s.carrying = null;
  s.task = IDLE_TASK();
}

/** Working at a production building (farm, well, workshop): advance the recipe, fill the output buffer. */
function stepWork(ctx: TickContext, s: Settler, t: Extract<Task, { kind: 'work' }>): void {
  const state = ctx.state;
  const b = findBuilding(state, t.buildingId);
  const def = b === null ? null : BUILDING_DEFS[b.type];
  if (b === null || def === null || b.status !== 'complete' || def.production === null || def.jobCategory === null) return failTaskQuiet(state, s);
  if (t.phase === 'moving') {
    const r = walk(ctx, s);
    if (r === 'blocked') return failTask(state, s);
    if (r === 'arrived') t.phase = 'working';
    return;
  }
  const recipe = def.production;
  const bmult = buildingMult(ctx, b);
  if (bmult <= 0 || b.output[recipe.output] >= def.outputCap) return failTaskQuiet(state, s);
  if ((recipe.output === 'food' || recipe.output === 'water') && state.colony.stock[recipe.output] < state.settlers.length && b.output[recipe.output] >= 1) {
    return failTaskQuiet(state, s); // famine: the waiting goods go to the larder first
  }

  // A cycle takes its inputs from the stock when it starts.
  if (b.productionProgress <= 0) {
    const need = recipe.inputs;
    const avail = getAvailableStock(state);
    if (!RESOURCE_TYPES.every((r) => avail[r] >= (need[r] ?? 0))) return failTaskQuiet(state, s);
    for (const r of RESOURCE_TYPES) {
      const n = need[r] ?? 0;
      if (n <= 0) continue;
      state.colony.stock[r] -= n;
      recordConsumed(state, r, n);
      ctx.events.push({ type: 'resourceConsumed', resource: r, amount: n, reason: 'crafting' });
    }
  }
  const rate = workSpeedMult(ctx, s, def.jobCategory, recipe.skill) * bmult;
  b.productionProgress += (rate * ctx.dt) / recipe.cycleHours;
  grantXp(s, recipe.skill, ctx.dt);
  wearTool(state, s, ctx.dt);
  if (b.productionProgress < 1) return;
  b.productionProgress = 0;
  const amount = Math.min(recipe.amount, def.outputCap - b.output[recipe.output]);
  b.output[recipe.output] += amount;
  recordProduced(state, recipe.output, amount);
  if (recipe.output === 'tools') state.progress.toolsCrafted += amount;
  ctx.events.push({ type: 'resourceProduced', buildingId: b.id, resource: recipe.output, amount });
  if (recipe.output === 'tools') checkObjectives(state, ctx.events);
}

/** A task ended because its target is gone: no cooldown is needed. */
function failTaskQuiet(state: GameState, s: Settler): void {
  abortSettlerTask(state, s);
}

function stepGather(ctx: TickContext, s: Settler, t: Extract<Task, { kind: 'gather' }>): void {
  const state = ctx.state;
  const world = state.world;
  const W = world.width;
  const source = s.workplaceId === null ? null : findBuilding(state, s.workplaceId);
  if (source === null || source.status !== 'complete') return failTaskQuiet(state, s);
  const resource = t.resource as 'wood' | 'stone';
  const category: JobCategory = resource === 'wood' ? 'woodcutting' : 'mining';

  if (t.phase === 'moving') {
    const r = walk(ctx, s);
    if (r === 'blocked') return failTask(state, s);
    if (r === 'arrived') {
      t.phase = 'working';
      t.progress = 0;
    }
    return;
  }

  if (t.phase === 'returning') {
    const drop = t.dropOffBuildingId === null ? null : findBuilding(state, t.dropOffBuildingId);
    if (drop === null || drop.status !== 'complete') {
      // Drop-off vanished: pick the nearest eating point/storage, or give the goods back to the stock.
      const alt = nearestBuilding(state, s, isEatingPoint);
      if (!alt) return failTask(state, s);
      t.dropOffBuildingId = alt.b.id;
      if (planMove(state, s, buildingGoal(alt.b)) === 'fail') return failTask(state, s);
      return;
    }
    const r = walk(ctx, s);
    if (r === 'blocked') return failTask(state, s);
    if (r === 'moving') return;
    // Arrived: deliver the load into a building buffer or the stockpile.
    if (s.carrying) {
      const load = s.carrying;
      const dcap = BUILDING_DEFS[drop.type].outputCap;
      let stored = 0;
      if (dcap > 0) {
        stored = Math.min(load.amount, Math.max(0, dcap - drop.output[load.resource]));
        drop.output[load.resource] += stored;
      } else {
        stored = addStockOf(state, load.resource, load.amount);
      }
      // What did not fit goes to the source building's buffer; only a remainder with no room anywhere is lost.
      let rest = load.amount - stored;
      if (rest > 0 && source.id !== drop.id) {
        const room = Math.max(0, BUILDING_DEFS[source.type].outputCap - source.output[load.resource]);
        const moved = Math.min(rest, room);
        source.output[load.resource] += moved;
        rest -= moved;
      }
      if (rest > 0) reportLoss(state, load.resource, rest, 'nowhere to put the load');
      ctx.events.push({ type: 'resourceDelivered', settlerId: s.id, buildingId: drop.id, resource: load.resource, amount: stored });
      s.carrying = null;
    }
    if (!hasRoomFor(state, s, source, resource)) return failTaskQuiet(state, s); // storage is full
    // Continue the loop with the next tile.
    const next = findGatherTarget(state, s, source, resource);
    if (next === null) return failTaskQuiet(state, s);
    t.targetTile = { x: next.x, y: next.y };
    t.progress = 0;
    if (planMove(state, s, next.goal) === 'fail') return failTask(state, s);
    t.phase = s.path.length === 0 ? 'working' : 'moving';
    return;
  }

  // Working: take units from the tile.
  const tile = t.targetTile;
  const ti = tile.y * W + tile.x;
  if ((world.resource[ti] as number) < 1) {
    // Tile exhausted: next tile, or take the load home.
    const next = findGatherTarget(state, s, source, resource);
    if (next !== null && (s.carrying === null || s.carrying.amount < carryCapacity(s))) {
      t.targetTile = { x: next.x, y: next.y };
      if (planMove(state, s, next.goal) === 'fail') return failTask(state, s);
      t.phase = s.path.length === 0 ? 'working' : 'moving';
    } else if (s.carrying !== null) {
      startReturn(ctx, s, t);
    } else {
      failTaskQuiet(state, s);
    }
    return;
  }
  const def = BUILDING_DEFS[source.type];
  const rateMult = def.forage ? def.forage.rateMult : 1;
  const rate = GATHER_RATE[resource] * workSpeedMult(ctx, s, category, category) * rateMult * (ctx.wolves ? EVENTS.wolves.gatherMult : 1);
  t.progress += rate * ctx.dt;
  grantXp(s, category, ctx.dt);
  wearTool(state, s, ctx.dt);
  const cap = carryCapacity(s);
  while (t.progress >= 1) {
    t.progress -= 1;
    const left = world.resource[ti] as number;
    if (left < 1) break;
    if (!hasRoomFor(state, s, source, resource)) {
      t.progress = 0;
      break; // no room for more: take what is in hand home
    }
    world.resource[ti] = left - 1;
    if (s.carrying === null) s.carrying = { resource: t.resource, amount: 0 };
    s.carrying.amount += 1;
    recordProduced(state, t.resource, 1);
    ctx.events.push({ type: 'resourceGathered', settlerId: s.id, resource: t.resource, amount: 1, x: tile.x, y: tile.y });
    if (left - 1 < 1 && t.resource === 'wood' && world.terrain[ti] === Terrain.Forest) {
      world.terrain[ti] = Terrain.Grass; // felled: structural change
      world.revision++;
    }
    ctx.events.push({ type: 'tileChanged', x: tile.x, y: tile.y });
    if (s.carrying.amount >= cap) break;
  }
  if (s.carrying !== null && (s.carrying.amount >= cap || !hasRoomFor(state, s, source, resource))) startReturn(ctx, s, t);
  else if (s.carrying === null && !hasRoomFor(state, s, source, resource)) failTaskQuiet(state, s);
}

function startReturn(ctx: TickContext, s: Settler, t: Extract<Task, { kind: 'gather' }>): void {
  const state = ctx.state;
  const source = s.workplaceId === null ? null : findBuilding(state, s.workplaceId);
  const drop = source === null || s.carrying === null ? null : chooseDropOff(state, s, source, s.carrying.resource, s.carrying.amount);
  if (!drop) return failTask(state, s);
  t.dropOffBuildingId = drop.id;
  t.phase = 'returning';
  t.progress = 0;
  const r = planMove(state, s, buildingGoal(drop));
  if (r === 'fail') failTask(state, s);
}

// =============================================================================================
// 5. Per-tick entry point
// =============================================================================================

const CRITICAL_THRESHOLDS: { need: NeedType; below: number; recoverAt: number }[] = [
  { need: 'hunger', below: AI.critical.hungerBelow, recoverAt: 25 },
  { need: 'energy', below: AI.critical.energyCollapseBelow, recoverAt: 20 },
  { need: 'health', below: AI.critical.healthRestBelow, recoverAt: 50 },
  { need: 'happiness', below: 15, recoverAt: 30 },
];

function updateAlerts(ctx: TickContext, s: Settler): void {
  for (const c of CRITICAL_THRESHOLDS) {
    const value = s.needs[c.need];
    const flagged = s.status.needAlerts[c.need];
    if (!flagged && value < c.below) {
      s.status.needAlerts[c.need] = true;
      ctx.events.push({ type: 'needCritical', settlerId: s.id, need: c.need });
    } else if (flagged && value >= c.recoverAt) {
      s.status.needAlerts[c.need] = false;
    }
  }
}

/** Derive the public `activity` from the task so the label always matches what the settler does. */
function refreshActivity(ctx: TickContext, s: Settler): void {
  const state = ctx.state;
  const t = s.task;
  const moving = t.phase === 'moving';
  switch (t.kind) {
    case 'idle':
      setActivity(s, 'idle', 'Idle', null, null);
      return;
    case 'wander':
      setActivity(s, 'wandering', s.status.sulkHoursLeft > 0 ? 'Sulking' : 'Wandering', null, t.targetTile);
      return;
    case 'eat':
    case 'drink': {
      const b = findBuilding(state, t.buildingId);
      const name = b ? buildingLabel(b) : 'Town Center';
      const target = b ? b.origin : null;
      if (moving) setActivity(s, 'walking', `Walking to ${name}`, null, target);
      else setActivity(s, 'eating', `${t.kind === 'eat' ? 'Eating' : 'Drinking'} at ${name}`, clamp01(t.progress / (t.kind === 'eat' ? MEAL.hours : DRINK.hours)), target);
      return;
    }
    case 'sleep':
    case 'rest': {
      const b = t.buildingId === null ? null : findBuilding(state, t.buildingId);
      const place = b ? buildingLabel(b) : null;
      if (moving) {
        setActivity(s, 'walking', place ? `Walking to ${place}` : 'Walking to the campfire', null, b ? b.origin : null);
      } else if (t.kind === 'rest') {
        setActivity(s, 'resting', s.status.sickHoursLeft > 0 ? 'Resting (sick)' : 'Resting (hurt)', clamp01(s.needs.health / HEALTH.restUntil), null, b ? b.id : null);
      } else {
        setActivity(s, 'sleeping', place ? `Sleeping in ${place}` : 'Sleeping by the campfire', clamp01(s.needs.energy / NEED_MAX), null, b ? b.id : null);
      }
      return;
    }
    case 'socialize':
      if (moving) setActivity(s, 'walking', 'Walking to Town Center', null, null);
      else setActivity(s, 'socializing', 'Chatting at the campfire', clamp01(t.progress / AI.socialize.hours), null);
      return;
    case 'gather': {
      const mining = t.resource === 'stone';
      if (s.carrying && (t.phase === 'returning' || moving)) {
        setActivity(s, 'carrying', `Hauling ${s.carrying.amount} ${s.carrying.resource}`, null, null);
      } else if (moving) {
        setActivity(s, 'walking', mining ? 'Walking to the hills' : 'Walking to the forest', null, t.targetTile);
      } else {
        const cap = carryCapacity(s);
        setActivity(s, mining ? 'mining' : 'chopping', mining ? 'Quarrying stone' : 'Chopping wood', clamp01((s.carrying ? s.carrying.amount : 0) / cap), t.targetTile);
      }
      return;
    }
    case 'construct': {
      const b = findBuilding(state, t.buildingId);
      const name = b ? buildingLabel(b) : 'site';
      if (moving) setActivity(s, 'walking', `Walking to ${name}`, null, b ? b.origin : null);
      else {
        const repair = b?.construction?.kind === 'repair';
        setActivity(s, 'building', `${repair ? 'Repairing' : 'Building'} ${name}`, b?.construction ? b.construction.progress : null, b ? b.origin : null);
      }
      return;
    }
    case 'haul': {
      const from = t.fromBuildingId === null ? null : findBuilding(state, t.fromBuildingId);
      const to = findBuilding(state, t.toBuildingId);
      if (!s.carrying && moving) {
        setActivity(s, 'walking', `Walking to ${from ? buildingLabel(from) : 'storage'}`, null, from ? from.origin : null);
      } else if (to && to.status === 'construction' && s.carrying) {
        setActivity(s, 'carrying', `Supplying ${buildingLabel(to)}`, null, to.origin);
      } else {
        setActivity(s, 'carrying', `Hauling ${s.carrying ? s.carrying.amount : t.amount} ${t.resource}`, null, to ? to.origin : null);
      }
      return;
    }
    case 'work': {
      const b = findBuilding(state, t.buildingId);
      const name = b ? buildingLabel(b) : 'workplace';
      if (moving) {
        setActivity(s, 'walking', `Walking to ${name}`, null, b ? b.origin : null);
        return;
      }
      const cat = b ? BUILDING_DEFS[b.type].jobCategory : null;
      if (cat === 'farming') setActivity(s, 'farming', 'Tending crops', null, b ? b.origin : null);
      else if (cat === 'water') setActivity(s, 'fetchingWater', 'Drawing water', null, b ? b.origin : null);
      else if (cat === 'crafting') setActivity(s, 'crafting', 'Crafting tools', null, b ? b.origin : null);
      else if (cat === 'mining') setActivity(s, 'mining', 'Quarrying stone', null, b ? b.origin : null);
      else if (cat === 'woodcutting') setActivity(s, 'chopping', 'Chopping wood', null, b ? b.origin : null);
      else setActivity(s, 'idle', 'Idle', null, null);
      return;
    }
    case 'depart':
      setActivity(s, 'walking', 'Leaving the colony', null, t.edgeTile);
      return;
  }
}

/** Nearest walkable map-edge tile in the settler's region, or null. */
function findEdgeTile(state: GameState, s: Settler): TilePos | null {
  const world = state.world;
  const { labels } = getWalkRegions(world);
  const region = labels[Math.floor(s.pos.y) * world.width + Math.floor(s.pos.x)];
  let best: TilePos | null = null;
  let bestDist = Infinity;
  const consider = (x: number, y: number) => {
    const i = y * world.width + x;
    if (labels[i] !== region || !isPassable(world, i)) return;
    const d = octile(s.pos.x, s.pos.y, x + 0.5, y + 0.5);
    if (d < bestDist) {
      bestDist = d;
      best = { x, y };
    }
  };
  for (let x = 0; x < world.width; x++) {
    consider(x, 0);
    consider(x, world.height - 1);
  }
  for (let y = 1; y < world.height - 1; y++) {
    consider(0, y);
    consider(world.width - 1, y);
  }
  return best;
}

function killSettler(ctx: TickContext, s: Settler): void {
  const state = ctx.state;
  let cause = 'unknown causes';
  let worst = -1;
  for (const key of Object.keys(s.status.damageLog)) {
    const v = s.status.damageLog[key] as number;
    if (v > worst) {
      worst = v;
      cause = key;
    }
  }
  const x = s.pos.x;
  const y = s.pos.y;
  const name = s.name;
  const id = s.id;
  removeSettler(state, id);
  state.stats.deaths++;
  state.progress.lastDeathTick = state.time.tick;
  state.colony.graveyard.push({ id, name, diedDay: state.time.day, cause });
  ctx.events.push({ type: 'settlerDied', settlerId: id, name, cause, x, y });
  pushLog(state, 'danger', `${name} died of ${cause}.`, { tile: { x: Math.floor(x), y: Math.floor(y) } });
  for (const o of state.settlers) addTimedMoodlet(o, 'colonistDied', (MOODLETS.colonistDied as { value: number }).value, (MOODLETS.colonistDied as { hours: number }).hours, 3);
  assignHomes(state);
}

function departSettler(ctx: TickContext, id: number): void {
  const state = ctx.state;
  const s = state.settlers.find((o) => o.id === id);
  if (!s) return;
  const name = s.name;
  removeSettler(state, id);
  ctx.events.push({ type: 'settlerLeft', settlerId: id, name, reason: 'gave up on the frontier' });
  pushLog(state, 'warning', `${name} has given up on the frontier and left.`);
  for (const o of state.settlers) addTimedMoodlet(o, 'colonistLeft', (MOODLETS.colonistLeft as { value: number }).value, (MOODLETS.colonistLeft as { hours: number }).hours, 2);
  assignHomes(state);
}

function isInterruptible(s: Settler): boolean {
  const t = s.task;
  switch (t.kind) {
    case 'idle':
    case 'wander':
    case 'socialize':
      return true;
    case 'construct':
      return true;
    case 'gather':
      // A gatherer may be called away mid-load (the load is put into the stock); only the walk home is protected.
      return t.phase !== 'returning';
    case 'haul':
    case 'work':
      return s.carrying === null;
    case 'eat':
    case 'drink':
    case 'sleep':
    case 'rest':
    case 'depart':
      return false;
  }
}

function stepSettler(ctx: TickContext, s: Settler): boolean {
  const state = ctx.state;
  s.prevPos.x = s.pos.x;
  s.prevPos.y = s.pos.y;

  // 1. Needs, statuses, timers.
  const asleep = isAsleep(s);
  const inBed = asleep && (s.task.kind === 'sleep' || s.task.kind === 'rest') && s.task.buildingId !== null;
  updateNeeds(ctx, s, asleep, inBed);
  s.hoursSinceDecision += ctx.dt;
  if (s.needs.health <= 0) return false;
  updateAlerts(ctx, s);

  // 2. Hourly: moods, sulking, damage log decay.
  if (ctx.newHour) {
    evaluateStateMoodlets(ctx, s);
    for (const key of Object.keys(s.status.damageLog)) {
      const v = (s.status.damageLog[key] as number) * (1 - 1 / HEALTH.damageLogHours);
      if (v < 0.01) delete s.status.damageLog[key];
      else s.status.damageLog[key] = v;
    }
    const band = moodBand(s.needs.happiness);
    if (band.sulkChancePerHour > 0 && s.status.sulkHoursLeft <= 0 && chance(state.rng, band.sulkChancePerHour)) {
      s.status.sulkHoursLeft = band.sulkHours;
      if (isInterruptible(s)) {
        abortSettlerTask(state, s);
        startWander(state, s);
      }
    }
  }

  // 3. Desertion.
  if (s.status.breakingHours >= ctx.diff.desertionHours && s.task.kind !== 'depart' && !(s.task.kind === 'idle' && s.task.progress > 0)) {
    const edge = findEdgeTile(state, s);
    abortSettlerTask(state, s);
    if (edge === null) {
      departQueue.push(s.id);
      return true;
    }
    if (beginTask(state, s, { kind: 'depart', edgeTile: edge, phase: 'moving', progress: 0 }, tileGoal(edge.x, edge.y)) === false) {
      departQueue.push(s.id);
      return true;
    }
  }

  // 4. Critical interrupts.
  if (s.task.kind !== 'depart') {
    // A meal or drink in progress finishes first (otherwise critical hunger and collapse would swap places every tick).
    if (s.needs.energy < COLLAPSE_ENERGY && !isAsleep(s) && s.task.kind !== 'eat' && s.task.kind !== 'drink') {
      startCollapse(state, s);
    } else if (!(s.task.kind === 'idle' && s.task.progress > 0)) {
      // (A settler waiting out a failed path is skipped, so an unreachable meal cannot cause a search every tick.)
      const response = criticalResponse(ctx, s);
      if (response !== null && !isResponseTask(s, response)) applyCritical(ctx, s, response);
    }
  }

  // 5. Run the task.
  stepTask(ctx, s);

  // 6. Decide.
  const t = s.task;
  if (t.kind === 'idle') {
    if (t.progress <= 0 && ctx.tick % AI.decisionStaggerTicks === s.id % AI.decisionStaggerTicks) decide(ctx, s);
  } else if (isInterruptible(s)) {
    const cadence = t.kind === 'wander' ? AI.reevalHours.wander : AI.reevalHours.work;
    if (s.hoursSinceDecision >= cadence && s.status.sulkHoursLeft <= 0) decide(ctx, s);
  }

  refreshActivity(ctx, s);
  return true;
}

/** Advance every settler by one tick. Deaths and departures are processed after the loop. */
export function stepSettlers(ctx: TickContext): void {
  const state = ctx.state;
  departQueue.length = 0;
  const dead: number[] = [];
  const list = state.settlers;
  for (let i = 0; i < list.length; i++) {
    const s = list[i] as Settler;
    if (!stepSettler(ctx, s)) dead.push(s.id);
  }
  for (const id of dead) {
    const s = state.settlers.find((o) => o.id === id);
    if (s) killSettler(ctx, s);
  }
  for (const id of departQueue) departSettler(ctx, id);
  departQueue.length = 0;
  if (ctx.newHour) {
    assignHomes(state);
    checkObjectives(state, ctx.events, Math.floor(ctx.hour) === 0);
  }
  if (state.settlers.length === 0 && state.outcome.status !== 'lost') {
    state.outcome = {
      status: 'lost',
      reason: `The frontier has claimed ${state.colony.name}. It lasted ${state.time.day} ${state.time.day === 1 ? 'day' : 'days'}.`,
      endedTick: state.time.tick,
    };
    ctx.events.push({ type: 'gameOver', status: 'lost', reason: state.outcome.reason as string });
    pushLog(state, 'danger', state.outcome.reason as string);
  }
}

