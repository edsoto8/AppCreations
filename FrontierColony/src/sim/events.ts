/**
 * The colony-level clock of the game: the scheduled daily and hourly checks of GAME_DESIGN §2, the random
 * events of §10 (with the decision flow), population growth (§8), damage and repair (§6.6) and the
 * daily growth of the forests (§6.5).
 *
 * `stepSchedule` runs once per tick, before the settlers move. Everything random comes from `state.rng`.
 */
import {
  BUILDING_DEFS,
  DAMAGE_IMMUNE,
  DAMAGE_REPAIR_PROGRESS,
  DAYS_PER_YEAR,
  EVENTS,
  FOREST_REGROWTH,
  GROWTH,
  MOODLETS,
  POPULATION_CAP,
  SCHEDULE,
  SUPPLY_CACHE_REWARDS,
  TRADER_OFFERS,
  type TraderOffer,
} from './balance';
import { collectRain } from './weather';
import { getHousingCapacity, getAvailableStock, emptyResources } from './queries';
import { getWalkRegions } from './grid';
import { chance, nextFloat, pick, pickWeightedIndex, shuffle } from './rng';
import { addNewcomer } from './settlerGen';
import { assignHomes } from './settlerSim';
import { addStockOrLose, pushLog, recordConsumed, releaseBuildingUsers } from './stateOps';
import type { TickContext } from './needs';
import {
  RESOURCE_TYPES,
  Terrain,
  type ActiveRandomEvent,
  type Building,
  type CommandResult,
  type EntityId,
  type GameState,
  type LogSeverity,
  type PendingDecision,
  type RandomEventKind,
  type ResourceType,
  type Settler,
  type SimEvent,
} from './types';

// =============================================================================================
// Helpers
// =============================================================================================

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "a, b and c". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function amountsText(list: Partial<Record<ResourceType, number>>): string {
  const parts: string[] = [];
  for (const r of RESOURCE_TYPES) if ((list[r] ?? 0) > 0) parts.push(`${list[r]} ${r}`);
  return joinNames(parts);
}

const currentYear = (state: GameState): number => Math.floor((state.time.day - 1) / DAYS_PER_YEAR) + 1;

function announce(state: GameState, events: SimEvent[], kind: RandomEventKind, message: string, severity: LogSeverity, refs: Parameters<typeof pushLog>[3] = {}): void {
  pushLog(state, severity, message, refs);
  events.push({ type: 'randomEvent', kind, message, severity });
}

function addActive(state: GameState, kind: RandomEventKind, hours: number, magnitude: number, targetId: EntityId | null, tile: { x: number; y: number } | null): ActiveRandomEvent {
  const e: ActiveRandomEvent = { id: state.nextLogId++, kind, startedTick: state.time.tick, hoursRemaining: hours, magnitude, targetId, tile };
  state.activeEvents.push(e);
  return e;
}

const isActive = (state: GameState, kind: RandomEventKind): boolean => state.activeEvents.some((e) => e.kind === kind);
const completed = (state: GameState, type: Building['type']): Building[] => state.buildings.filter((b) => b.type === type && b.status === 'complete');

function townCentre(state: GameState): Building | null {
  return state.buildings.find((b) => b.type === 'townCenter') ?? null;
}

// =============================================================================================
// Damage and repair (GAME_DESIGN §6.6 step 6)
// =============================================================================================

/** Send a completed building back to construction as a repair at 70% (the town center and storage are immune). */
export function damageBuilding(state: GameState, events: SimEvent[], b: Building, cause: string): boolean {
  if (b.status !== 'complete' || DAMAGE_IMMUNE.includes(b.type)) return false;
  const def = BUILDING_DEFS[b.type];
  b.status = 'construction';
  b.construction = {
    kind: 'repair',
    progress: DAMAGE_REPAIR_PROGRESS,
    workDone: DAMAGE_REPAIR_PROGRESS * def.buildHours,
    required: emptyResources(),
    delivered: emptyResources(),
  };
  releaseBuildingUsers(state, b.id); // residents keep their bed claim; workers and haulers move on
  events.push({ type: 'buildingDamaged', buildingId: b.id, buildingType: b.type, cause });
  return true;
}

// =============================================================================================
// Population (GAME_DESIGN §8)
// =============================================================================================

/** A random walkable map-edge tile connected to the town center, or a tile beside the town center. */
function arrivalTile(state: GameState): { x: number; y: number } {
  const world = state.world;
  const W = world.width;
  const H = world.height;
  const town = townCentre(state);
  const { labels } = getWalkRegions(world);
  // The region of the free tiles around the town center (not its corner, which could be unwalkable).
  let home = -1;
  if (town) {
    for (let y = town.origin.y - 1; y <= town.origin.y + town.footprint.h && home < 0; y++) {
      for (let x = town.origin.x - 1; x <= town.origin.x + town.footprint.w; x++) {
        const inside = x >= town.origin.x && x < town.origin.x + town.footprint.w && y >= town.origin.y && y < town.origin.y + town.footprint.h;
        const i = y * W + x;
        if (!inside && x >= 0 && y >= 0 && x < W && y < H && world.building[i] === 0 && labels[i] !== -1) {
          home = labels[i] as number;
          break;
        }
      }
    }
  }
  const edge: number[] = [];
  const consider = (x: number, y: number) => {
    const i = y * W + x;
    if (labels[i] === home && world.building[i] === 0) edge.push(i);
  };
  for (let x = 0; x < W; x++) {
    consider(x, 0);
    consider(x, H - 1);
  }
  for (let y = 1; y < H - 1; y++) {
    consider(0, y);
    consider(W - 1, y);
  }
  if (edge.length > 0) {
    const i = pick(state.rng, edge);
    return { x: i % W, y: Math.floor(i / W) };
  }
  return town ? { x: town.origin.x - 1, y: town.origin.y - 1 } : { x: 1, y: 1 };
}

/** Welcome `count` newcomers at the edge of the map. Returns them. */
export function welcomeNewcomers(state: GameState, events: SimEvent[], count: number): Settler[] {
  const arrived: Settler[] = [];
  for (let i = 0; i < count && state.settlers.length < POPULATION_CAP; i++) {
    const tile = arrivalTile(state);
    const s = addNewcomer(state, { x: tile.x + 0.5, y: tile.y + 0.5 });
    arrived.push(s);
    events.push({ type: 'settlerArrived', settlerId: s.id });
  }
  assignHomes(state);
  return arrived;
}

/** Daily at 08:00: maybe 1-2 newcomers arrive when beds, food, water and mood allow (§8). */
export function populationCheck(ctx: TickContext): void {
  const state = ctx.state;
  const pop = state.settlers.length;
  if (pop === 0 || pop >= POPULATION_CAP) return;
  const freeBeds = getHousingCapacity(state) - pop;
  if (freeBeds < GROWTH.minFreeBeds) return;
  const stock = state.colony.stock;
  if (stock.food < pop * 2 * GROWTH.minFoodDays || stock.water < pop * 2 * GROWTH.minWaterDays) return;
  let happy = 0;
  for (const s of state.settlers) happy += s.needs.happiness;
  if (happy / pop < GROWTH.minAvgHappiness) return;
  const lastDeath = state.progress.lastDeathTick;
  if (lastDeath !== null && (state.time.tick - lastDeath) * ctx.dt < GROWTH.noDeathWithinHours) return;
  const p = (GROWTH.baseChance + GROWTH.perExtraBed * Math.min(freeBeds - 1, GROWTH.maxExtraBeds)) * ctx.diff.growthMult;
  if (!chance(state.rng, p)) return;
  let count = 1;
  if (freeBeds >= GROWTH.pairMinFreeBeds && chance(state.rng, GROWTH.pairChance)) count = 2;
  const arrived = welcomeNewcomers(state, ctx.events, count);
  for (const s of arrived) pushLog(state, 'good', `${s.name} has arrived and joined ${state.colony.name}.`, { settlerId: s.id });
}

// =============================================================================================
// Decisions
// =============================================================================================

function parseOffer(payload: PendingDecision['payload']): TraderOffer {
  const offer: TraderOffer = { give: {}, get: {} };
  const p = payload as Record<string, number | undefined>;
  for (const r of RESOURCE_TYPES) {
    const name = cap(r);
    const give = p[`give${name}`];
    const get = p[`get${name}`];
    if (typeof give === 'number' && give > 0) offer.give[r] = give;
    if (typeof get === 'number' && get > 0) offer.get[r] = get;
  }
  return offer;
}

function offerPayload(offer: TraderOffer): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const r of RESOURCE_TYPES) {
    if ((offer.give[r] ?? 0) > 0) payload[`give${cap(r)}`] = offer.give[r] as number;
    if ((offer.get[r] ?? 0) > 0) payload[`get${cap(r)}`] = offer.get[r] as number;
  }
  return payload;
}

function addDecision(state: GameState, events: SimEvent[], d: Omit<PendingDecision, 'eventId' | 'hoursLeft' | 'windowHours'> & { windowHours: number }, message: string): void {
  const eventId = state.nextLogId++;
  const decision = { ...d, eventId, hoursLeft: d.windowHours } as PendingDecision;
  state.pendingDecisions.push(decision);
  pushLog(state, 'info', message);
  events.push({ type: 'decisionPending', eventId, kind: d.kind, message });
}

/**
 * Answer (or time out) a pending decision. `auto` = the window expired: the default (decline) applies.
 * Returns the command result; a failed accept (the goods are gone) leaves the decision open.
 */
export function resolveDecision(state: GameState, eventId: number, accept: boolean, auto = false): CommandResult {
  const index = state.pendingDecisions.findIndex((d) => d.eventId === eventId);
  if (index < 0) return { ok: false, error: 'notFound', message: 'That decision is no longer open.' };
  const d = state.pendingDecisions[index] as PendingDecision;
  const events: SimEvent[] = [];
  const done = (): CommandResult => {
    state.pendingDecisions.splice(index, 1);
    return { ok: true, entityId: null, events };
  };

  switch (d.kind) {
    case 'traderVisit': {
      if (!accept) {
        pushLog(state, 'info', auto ? 'The trader moved on.' : "Declined the trader's offer.");
        return done();
      }
      const offer = parseOffer(d.payload);
      const avail = getAvailableStock(state);
      if (!RESOURCE_TYPES.every((r) => avail[r] >= (offer.give[r] ?? 0))) {
        return { ok: false, error: 'insufficientResources', message: 'You no longer have the goods for this trade.' };
      }
      for (const r of RESOURCE_TYPES) {
        const give = offer.give[r] ?? 0;
        if (give > 0) state.colony.stock[r] -= give;
        const get = offer.get[r] ?? 0;
        if (get > 0) addStockOrLose(state, r, get, 'a trade');
      }
      pushLog(state, 'good', `Traded ${amountsText(offer.give)} for ${amountsText(offer.get)}.`);
      return done();
    }
    case 'wanderer': {
      const count = d.payload.count;
      if (!accept) {
        pushLog(state, 'info', auto ? `The ${count === 1 ? 'wanderer' : 'wanderers'} moved on.` : `Turned the ${count === 1 ? 'wanderer' : 'wanderers'} away.`);
        return done();
      }
      const arrived = welcomeNewcomers(state, events, count);
      if (arrived.length === 0) {
        pushLog(state, 'warning', 'The colony is full: the wanderers could not stay.');
      } else {
        pushLog(state, 'good', `${joinNames(arrived.map((s) => s.name))} joined ${state.colony.name}.`);
      }
      return done();
    }
    case 'harvestFestival': {
      if (!accept) {
        pushLog(state, 'info', auto ? 'The moment for a harvest festival passed.' : 'Skipped the harvest festival this year.');
        return done();
      }
      const cost = d.payload.foodCost;
      if (state.colony.stock.food < cost) {
        return { ok: false, error: 'insufficientResources', message: 'There is not enough food for a festival.' };
      }
      state.colony.stock.food -= cost;
      recordConsumed(state, 'food', cost);
      events.push({ type: 'resourceConsumed', resource: 'food', amount: cost, reason: 'festival' });
      addActive(state, 'harvestFestival', EVENTS.harvestFestival.socializeHours, 1, null, null);
      announce(state, events, 'harvestFestival', 'The festival begins! Everyone gathers at the town center.', 'good');
      return done();
    }
    default:
      state.pendingDecisions.splice(index, 1);
      return { ok: true, entityId: null, events };
  }
}

// =============================================================================================
// Event effects
// =============================================================================================

const DAILY_KINDS = [
  'traderVisit',
  'wanderer',
  'harvestFestival',
  'bountifulHarvest',
  'richVein',
  'supplyCache',
  'wolves',
  'sickness',
  'cropBlight',
  'drought',
  'toolsBreak',
  'coldSnap',
] as const;
export type DailyKind = (typeof DAILY_KINDS)[number];

/** Probability of a daily event (before the difficulty multiplier), or null when its trigger does not hold. */
export function dailyChance(state: GameState, kind: DailyKind): number | null {
  const day = state.time.day;
  const season = state.time.season;
  const pop = state.settlers.length;
  switch (kind) {
    case 'traderVisit': {
      if (day < EVENTS.traderVisit.minDay) return null;
      const avail = getAvailableStock(state);
      return TRADER_OFFERS.some((o) => RESOURCE_TYPES.every((r) => avail[r] >= (o.give[r] ?? 0))) ? EVENTS.traderVisit.p : null;
    }
    case 'wanderer':
      return day >= EVENTS.wanderer.minDay && pop <= EVENTS.wanderer.maxPop ? EVENTS.wanderer.p : null;
    case 'harvestFestival':
      return season === 'autumn' && state.progress.festivalYear !== currentYear(state) && state.colony.stock.food >= pop * EVENTS.harvestFestival.minFoodPerPop
        ? EVENTS.harvestFestival.p
        : null;
    case 'bountifulHarvest':
      return season !== 'winter' && completed(state, 'farm').length > 0 ? EVENTS.bountifulHarvest.p : null;
    case 'richVein':
      return completed(state, 'mine').length > 0 ? EVENTS.richVein.p : null;
    case 'supplyCache':
      return day >= EVENTS.supplyCache.minDay ? EVENTS.supplyCache.p : null;
    case 'wolves':
      return day >= EVENTS.wolves.minDay ? EVENTS.wolves.p : null;
    case 'sickness': {
      if (day < EVENTS.sickness.minDay) return null;
      const exposed = state.settlers.some((s) => s.status.dehydrated || s.status.sleptOutdoorsLastNight);
      return EVENTS.sickness.p + (exposed ? EVENTS.sickness.extraPIfExposed : 0);
    }
    case 'cropBlight':
      return season !== 'winter' && completed(state, 'farm').length > 0 ? EVENTS.cropBlight.p : null;
    case 'drought':
      return season === 'summer' ? EVENTS.drought.p : null;
    case 'toolsBreak':
      return state.colony.stock.tools >= EVENTS.toolsBreak.minTools ? EVENTS.toolsBreak.p : null;
    case 'coldSnap':
      return season === 'winter' ? EVENTS.coldSnap.p : null;
  }
}

/** Fire a daily event right now, ignoring its trigger and probability (the caller checked them; tests use it directly). */
export function fireEvent(ctx: TickContext, kind: DailyKind): void {
  const state = ctx.state;
  const events = ctx.events;
  const rng = state.rng;
  const pop = state.settlers.length;
  switch (kind) {
    case 'traderVisit': {
      const avail = getAvailableStock(state);
      const offers = TRADER_OFFERS.filter((o) => RESOURCE_TYPES.every((r) => avail[r] >= (o.give[r] ?? 0)));
      const offer = pick(rng, offers);
      addDecision(
        state,
        events,
        { kind: 'traderVisit', payload: offerPayload(offer), windowHours: EVENTS.traderVisit.windowHours },
        `A traveling trader pulls up at the town center: ${amountsText(offer.give)} for ${amountsText(offer.get)}?`,
      );
      return;
    }
    case 'wanderer': {
      const count = chance(rng, EVENTS.wanderer.pairChance) ? 2 : 1;
      const freeBeds = Math.max(0, getHousingCapacity(state) - pop);
      const group = count === 1 ? '1 wanderer asks' : `${count} wanderers ask`;
      if (freeBeds >= count) {
        const arrived = welcomeNewcomers(state, events, count);
        announce(state, events, 'wanderer', `${cap(joinNames(arrived.map((s) => s.name)))} wandered in and joined ${state.colony.name}. There are beds for them.`, 'good');
        return;
      }
      addDecision(
        state,
        events,
        { kind: 'wanderer', payload: { count, freeBeds }, windowHours: EVENTS.wanderer.windowHours },
        `${cap(group)} to join. There are no free beds; they would sleep outdoors.`,
      );
      return;
    }
    case 'harvestFestival': {
      const foodCost = pop * EVENTS.harvestFestival.foodCostPerPop;
      state.progress.festivalYear = currentYear(state); // offered once per year, whatever the answer
      addDecision(
        state,
        events,
        { kind: 'harvestFestival', payload: { foodCost }, windowHours: EVENTS.harvestFestival.windowHours },
        `The harvest is in! Hold a festival? (costs ${foodCost} food)`,
      );
      return;
    }
    case 'bountifulHarvest':
      addActive(state, kind, EVENTS.bountifulHarvest.durationHours, 1, null, null);
      announce(state, events, kind, 'The crops are coming in thick and heavy. Farms +50% for 2 days.', 'good');
      return;
    case 'richVein': {
      const mine = pick(rng, completed(state, 'mine'));
      const world = state.world;
      const r = BUILDING_DEFS.mine.workRadius;
      for (let y = Math.max(0, mine.origin.y - r); y < Math.min(world.height, mine.origin.y + mine.footprint.h + r); y++) {
        for (let x = Math.max(0, mine.origin.x - r); x < Math.min(world.width, mine.origin.x + mine.footprint.w + r); x++) {
          const i = y * world.width + x;
          const t = world.terrain[i] as number;
          if (t !== Terrain.Hills && t !== Terrain.Mountain) continue;
          world.resource[i] = (world.resource[i] as number) + EVENTS.richVein.stonePerTile;
          events.push({ type: 'tileChanged', x, y });
        }
      }
      announce(state, events, kind, `Miners struck a rich seam at the ${BUILDING_DEFS.mine.name}!`, 'good', { buildingId: mine.id });
      return;
    }
    case 'supplyCache': {
      const reward = pick(rng, SUPPLY_CACHE_REWARDS);
      let text = '';
      for (const r of RESOURCE_TYPES) {
        const amount = reward[r] ?? 0;
        if (amount <= 0) continue;
        addStockOrLose(state, r, amount, 'the wagon');
        text = `Settlers found an abandoned wagon: +${amount} ${r}.`;
      }
      announce(state, events, kind, text, 'good');
      return;
    }
    case 'wolves': {
      const town = townCentre(state);
      let victim: Settler | null = null;
      if (town) {
        let far: number = EVENTS.wolves.attackMinDistance;
        const cx = town.origin.x + town.footprint.w / 2;
        const cy = town.origin.y + town.footprint.h / 2;
        for (const s of state.settlers) {
          const dx = s.pos.x - cx;
          const dy = s.pos.y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > far) {
            far = d;
            victim = s;
          }
        }
      }
      addActive(state, kind, EVENTS.wolves.durationHours, 1, victim ? victim.id : null, null);
      if (victim) {
        let mult = ctx.diff.healthDamageMult;
        if (victim.traits.includes('tough')) mult *= 0.7;
        else if (victim.traits.includes('frail')) mult *= 1.3;
        const damage = EVENTS.wolves.attackDamage * mult;
        victim.needs.health -= damage;
        victim.status.damageLog.wolves = (victim.status.damageLog.wolves ?? 0) + damage;
        announce(state, events, kind, `Wolves on the ridge! ${victim.name} was mauled.`, 'danger', { settlerId: victim.id });
      } else {
        announce(state, events, kind, 'Wolves have been sighted near the colony.', 'warning');
      }
      return;
    }
    case 'sickness': {
      const wanted = Math.min(pop, Math.ceil(pop * EVENTS.sickness.infectFraction));
      const pool = state.settlers.filter((s) => s.status.sickHoursLeft <= 0);
      const sick: Settler[] = [];
      while (sick.length < wanted && pool.length > 0) {
        const i = pickWeightedIndex(rng, pool.map((s) => (s.traits.includes('frail') ? 2 : 1)));
        sick.push(pool.splice(i, 1)[0] as Settler);
      }
      for (const s of sick) {
        s.status.sickHoursLeft = s.traits.includes('tough') ? EVENTS.sickness.toughDurationHours : EVENTS.sickness.durationHours;
      }
      addActive(state, kind, EVENTS.sickness.durationHours, 1, null, null);
      announce(state, events, kind, `A fever is going around. ${cap(joinNames(sick.map((s) => s.name)))} fell ill.`, 'warning');
      return;
    }
    case 'cropBlight': {
      const farm = pick(rng, completed(state, 'farm'));
      addActive(state, kind, EVENTS.cropBlight.durationHours, 1, farm.id, null);
      announce(state, events, kind, `Blight has struck the ${BUILDING_DEFS.farm.name}. It will yield nothing for 2 days.`, 'warning', { buildingId: farm.id });
      return;
    }
    case 'drought':
      addActive(state, kind, EVENTS.drought.durationHours, 1, null, null);
      announce(state, events, kind, 'Drought. The soil cracks and wells run low.', 'warning');
      return;
    case 'toolsBreak': {
      const lost = Math.max(1, Math.floor(EVENTS.toolsBreak.lossFraction * state.colony.stock.tools));
      state.colony.stock.tools -= lost;
      announce(state, events, kind, `Damp got into the tool crates. ${plural(lost, 'tool', 'tools')} rusted through.`, 'warning');
      return;
    }
    case 'coldSnap':
      addActive(state, kind, EVENTS.coldSnap.durationHours, 1, null, null);
      announce(state, events, kind, 'A bitter cold snap. Keep everyone indoors at night.', 'danger');
      return;
  }
}

/** Daily roll at 08:00: shuffle the eligible events, the first success fires and the roll stops. */
export function dailyEventRoll(ctx: TickContext): void {
  const state = ctx.state;
  const order = shuffle(state.rng, [...DAILY_KINDS]);
  for (const kind of order) {
    if (isActive(state, kind) || state.pendingDecisions.some((d) => d.kind === kind)) continue;
    const positive = EVENTS[kind].positive;
    if (!positive && state.time.day < ctx.diff.graceDays) continue;
    const p = dailyChance(state, kind);
    if (p === null) continue;
    if (nextFloat(state.rng) < p * (positive ? ctx.diff.posEventMult : ctx.diff.negEventMult)) {
      fireEvent(ctx, kind);
      return;
    }
  }
}

/** Each hour of storm: a small chance that a building loses its roof. */
export function stormDamageRoll(ctx: TickContext): void {
  const state = ctx.state;
  if (state.weather.current !== 'storm' || state.time.day < ctx.diff.graceDays) return;
  if (!chance(state.rng, EVENTS.stormDamage.pPerStormHour * ctx.diff.negEventMult)) return;
  const targets = state.buildings.filter((b) => b.status === 'complete' && !DAMAGE_IMMUNE.includes(b.type));
  if (targets.length === 0) return;
  const b = pick(state.rng, targets);
  damageBuilding(state, ctx.events, b, 'storm');
  announce(state, ctx.events, 'stormDamage', `The storm tore the roof off the ${BUILDING_DEFS[b.type].name}. It needs repairs.`, 'danger', { buildingId: b.id, tile: { ...b.origin } });
}

/** At 14:00 during a drought a wildfire may break out in a distant forest. */
export function wildfireRoll(ctx: TickContext): void {
  const state = ctx.state;
  if (!isActive(state, 'drought') || state.time.day < ctx.diff.graceDays) return;
  if (!chance(state.rng, EVENTS.wildfire.p * ctx.diff.negEventMult)) return;
  const world = state.world;
  const W = world.width;
  const town = townCentre(state);
  const cx = town ? town.origin.x + town.footprint.w / 2 : W / 2;
  const cy = town ? town.origin.y + town.footprint.h / 2 : world.height / 2;
  const min = EVENTS.wildfire.minDistanceFromTownCenter;
  const candidates: number[] = [];
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] !== Terrain.Forest || (world.resource[i] as number) <= 0) continue;
    const dx = (i % W) + 0.5 - cx;
    const dy = Math.floor(i / W) + 0.5 - cy;
    if (dx * dx + dy * dy >= min * min) candidates.push(i);
  }
  if (candidates.length === 0) return;
  const spot = pick(state.rng, candidates);
  const fx = spot % W;
  const fy = Math.floor(spot / W);
  const r = EVENTS.wildfire.radius;
  let changed = false;
  for (let y = Math.max(0, fy - r); y <= Math.min(world.height - 1, fy + r); y++) {
    for (let x = Math.max(0, fx - r); x <= Math.min(W - 1, fx + r); x++) {
      const i = y * W + x;
      if (world.terrain[i] !== Terrain.Forest) continue;
      world.terrain[i] = Terrain.Grass;
      world.resource[i] = 0;
      ctx.events.push({ type: 'tileChanged', x, y });
      changed = true;
    }
  }
  if (changed) world.revision++;
  for (const b of state.buildings) {
    const hit = b.origin.x - r <= fx && b.origin.x + b.footprint.w - 1 + r >= fx && b.origin.y - r <= fy && b.origin.y + b.footprint.h - 1 + r >= fy;
    if (hit) damageBuilding(state, ctx.events, b, 'wildfire');
  }
  announce(state, ctx.events, 'wildfire', `Wildfire! The forest near (${fx},${fy}) is burning.`, 'danger', { tile: { x: fx, y: fy } });
}

// =============================================================================================
// Forests (GAME_DESIGN §6.5)
// =============================================================================================

/** At 00:00 (not in winter) forests regrow and slowly spread onto neighbouring grass. */
function forestGrowth(ctx: TickContext): void {
  const state = ctx.state;
  if (ctx.season === 'winter') return;
  const world = state.world;
  const W = world.width;
  const H = world.height;
  const F = FOREST_REGROWTH;
  const forest = new Uint8Array(W * H);
  for (let i = 0; i < forest.length; i++) {
    if (world.terrain[i] !== Terrain.Forest) continue;
    forest[i] = 1;
    const left = world.resource[i] as number;
    if (left > 0 && left < F.max) world.resource[i] = Math.min(F.max, left + F.perDay);
  }
  const spread: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (world.terrain[i] !== Terrain.Grass || world.building[i] !== 0) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx !== 0 || dy !== 0) && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) n += forest[(y + dy) * W + x + dx] as number;
        }
      }
      if (n >= F.spreadMinForestNeighbours && chance(state.rng, F.spreadChance)) spread.push(i);
    }
  }
  for (const i of spread) {
    world.terrain[i] = Terrain.Forest;
    world.resource[i] = F.spreadStartWood;
    ctx.events.push({ type: 'tileChanged', x: i % W, y: Math.floor(i / W) });
  }
  if (spread.length > 0) world.revision++;
}

// =============================================================================================
// Per-tick entry point
// =============================================================================================

const END_MESSAGES: Partial<Record<RandomEventKind, string>> = {
  bountifulHarvest: 'The bumper harvest is over.',
  wolves: 'The wolves have moved on.',
  sickness: 'The fever has run its course.',
  cropBlight: 'The blight has passed.',
  drought: 'The drought has broken.',
  coldSnap: 'The cold snap has eased.',
  harvestFestival: 'The festival is over.',
};

function ageEvents(ctx: TickContext): void {
  const state = ctx.state;
  for (let i = state.activeEvents.length - 1; i >= 0; i--) {
    const e = state.activeEvents[i] as ActiveRandomEvent;
    e.hoursRemaining -= ctx.dt;
    if (e.hoursRemaining > 0) continue;
    state.activeEvents.splice(i, 1);
    if (e.kind === 'harvestFestival') {
      const mood = MOODLETS.festival as { value: number; hours: number };
      for (const s of state.settlers) {
        s.moodlets = s.moodlets.filter((m) => m.id !== 'festival');
        s.moodlets.push({ id: 'festival', value: mood.value, hoursLeft: EVENTS.harvestFestival.festivalHours });
      }
    }
    const text = END_MESSAGES[e.kind];
    if (text) pushLog(state, 'info', text);
  }
  for (let i = state.pendingDecisions.length - 1; i >= 0; i--) {
    const d = state.pendingDecisions[i] as PendingDecision;
    d.hoursLeft -= ctx.dt;
    if (d.hoursLeft <= 0) resolveDecision(state, d.eventId, false, true);
  }
}

/** Scheduled checks and event timers for one tick. Settlers are stepped after this. */
export function stepSchedule(ctx: TickContext): void {
  const state = ctx.state;
  ageEvents(ctx);
  if (!ctx.newHour) return;
  const hour = Math.floor(ctx.hour);
  collectRain(state);
  stormDamageRoll(ctx);
  if (hour === SCHEDULE.regrowthHour) forestGrowth(ctx);
  if (hour === SCHEDULE.growthCheckHour) {
    populationCheck(ctx);
    dailyEventRoll(ctx);
  }
  if (hour === SCHEDULE.wildfireRollHour) wildfireRoll(ctx);
}
