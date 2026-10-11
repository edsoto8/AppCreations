/**
 * Read-only query helpers over GameState. Pure functions: safe to call from the renderer, the UI
 * and tests. They never mutate state and never use randomness.
 */
import { BUILDING_DEFS, GAME_HOURS_PER_TICK, TERRAIN_DEFS } from './balance';
import { getWalkRegions } from './grid';
import {
  RESOURCE_TYPES,
  type Building,
  type BuildingDef,
  type BuildingType,
  type EntityId,
  type GameState,
  type PlacementCheck,
  type ResourceAmounts,
  type ResourceCost,
  type Settler,
  type Terrain,
  type TileInfo,
  type WorldState,
} from './types';

export function emptyResources(): ResourceAmounts {
  return { wood: 0, stone: 0, food: 0, water: 0, tools: 0 };
}

/** Full amount table from a sparse cost (missing entries = 0). */
export function costToAmounts(cost: ResourceCost): ResourceAmounts {
  const out = emptyResources();
  for (const r of RESOURCE_TYPES) out[r] = cost[r] ?? 0;
  return out;
}

export function canAfford(stock: ResourceAmounts, cost: ResourceCost): boolean {
  return RESOURCE_TYPES.every((r) => stock[r] >= (cost[r] ?? 0));
}

export function inBounds(world: WorldState, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.width && y < world.height;
}

/** Row-major index of an in-bounds tile. */
export function tileIndex(world: WorldState, x: number, y: number): number {
  return y * world.width + x;
}

export function terrainAt(world: WorldState, x: number, y: number): Terrain {
  return world.terrain[tileIndex(world, x, y)] as Terrain;
}

export function getTile(state: GameState, x: number, y: number): TileInfo | null {
  const w = state.world;
  if (!inBounds(w, x, y)) return null;
  const i = tileIndex(w, x, y);
  const buildingId = w.building[i] ?? 0;
  return {
    x,
    y,
    terrain: w.terrain[i] as Terrain,
    elevation: w.elevation[i] ?? 0,
    resource: w.resource[i] ?? 0,
    buildingId: buildingId === 0 ? null : buildingId,
  };
}

/** Terrain-only walkability (buildings are not considered; the sim decides building passability). */
export function isTerrainWalkable(world: WorldState, x: number, y: number): boolean {
  return inBounds(world, x, y) && TERRAIN_DEFS[terrainAt(world, x, y)].walkable;
}

export function getBuildingDef(type: BuildingType): BuildingDef {
  return BUILDING_DEFS[type];
}

export function getSettler(state: GameState, id: EntityId): Settler | null {
  return state.settlers.find((s) => s.id === id) ?? null;
}

export function getBuilding(state: GameState, id: EntityId): Building | null {
  return state.buildings.find((b) => b.id === id) ?? null;
}

export function getBuildingAt(state: GameState, x: number, y: number): Building | null {
  const w = state.world;
  if (!inBounds(w, x, y)) return null;
  const id = w.building[tileIndex(w, x, y)] ?? 0;
  return id === 0 ? null : getBuilding(state, id);
}

/** Settlers whose workplace (or construction site) is the given building. Derived from `Settler.workplaceId`. */
export function getWorkers(state: GameState, buildingId: EntityId): Settler[] {
  return state.settlers.filter((s) => s.workplaceId === buildingId);
}

/** Settlers living in the given building. Derived from `Settler.homeId`. */
export function getResidents(state: GameState, buildingId: EntityId): Settler[] {
  return state.settlers.filter((s) => s.homeId === buildingId);
}

export function getPopulation(state: GameState): number {
  return state.settlers.length;
}

/** Per-resource storage capacity from completed buildings. */
export function getStorageCapacity(state: GameState): number {
  let total = 0;
  for (const b of state.buildings) if (b.status === 'complete') total += BUILDING_DEFS[b.type].storage;
  return total;
}

/** Number of settlers that completed housing can hold. */
export function getHousingCapacity(state: GameState): number {
  let total = 0;
  for (const b of state.buildings) if (b.status === 'complete') total += BUILDING_DEFS[b.type].housing;
  return total;
}

/**
 * Net change of each stock per in-game day, measured over the last (up to) 24 hourly samples
 * plus the current stock. Zero until at least one sample exists.
 */
export function getResourceRates(state: GameState): ResourceAmounts {
  const rates = emptyResources();
  const history = state.stats.history;
  if (history.length === 0) return rates;
  const from = history[Math.max(0, history.length - 24)];
  if (!from) return rates;
  const hours = (state.time.tick - from.tick) * GAME_HOURS_PER_TICK;
  if (hours <= 0) return rates;
  for (const r of RESOURCE_TYPES) rates[r] = ((state.colony.stock[r] - from.stock[r]) / hours) * 24;
  return rates;
}

/** Tiles covered by a footprint placed at origin (x, y). */
export function footprintTiles(type: BuildingType, x: number, y: number): { x: number; y: number }[] {
  const { w, h } = BUILDING_DEFS[type].footprint;
  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push({ x: x + dx, y: y + dy });
  return tiles;
}

/**
 * Full placement validation (bounds, terrain, overlap, nearby-terrain requirement, cost).
 * `tiles` reports per-tile validity for the placement ghost even when `ok` is false.
 */
export function canPlaceBuilding(state: GameState, type: BuildingType, x: number, y: number): PlacementCheck {
  const def = BUILDING_DEFS[type];
  const w = state.world;
  let error: PlacementCheck['error'] = null;
  let message: string | null = null;
  const fail = (e: NonNullable<PlacementCheck['error']>, m: string) => {
    if (error === null) {
      error = e;
      message = m;
    }
  };

  const tiles = footprintTiles(type, x, y).map((t) => {
    if (!inBounds(w, t.x, t.y)) {
      fail('outOfBounds', 'Outside the map.');
      return { ...t, ok: false };
    }
    const i = tileIndex(w, t.x, t.y);
    if ((w.building[i] ?? 0) !== 0) {
      fail('blocked', 'Something is already built here.');
      return { ...t, ok: false };
    }
    const terrain = w.terrain[i] as Terrain;
    if (!TERRAIN_DEFS[terrain].buildable || !def.allowedTerrain.includes(terrain)) {
      fail('invalidTerrain', `Cannot build a ${def.name} on ${TERRAIN_DEFS[terrain].name.toLowerCase()}.`);
      return { ...t, ok: false };
    }
    return { ...t, ok: true };
  });

  if (state.outcome.status === 'lost') fail('gameOver', 'The colony has fallen.');
  if (!def.placeable) fail('notPlaceable', `${def.name} cannot be placed.`);
  if (error === null && !state.progress.unlocked.includes(type)) fail('locked', `${def.name} is not unlocked yet.`);

  if (error === null && def.requiresNearby) {
    const { terrain, radius, minCount } = def.requiresNearby;
    let found = 0;
    for (let ty = y - radius; ty < y + def.footprint.h + radius; ty++) {
      for (let tx = x - radius; tx < x + def.footprint.w + radius; tx++) {
        if (inBounds(w, tx, ty) && terrain.includes(terrainAt(w, tx, ty))) found++;
      }
    }
    if (found < minCount) {
      const names = terrain.map((t) => TERRAIN_DEFS[t].name.toLowerCase()).join(' or ');
      fail('missingNearbyResource', `Needs ${minCount} ${names} tiles nearby (found ${found}).`);
    }
  }

  if (error === null && !hasAccess(state, type, x, y)) {
    fail('blocked', 'Settlers could not reach this spot.');
  }

  if (error === null && !canAfford(state.colony.stock, def.cost)) {
    fail('insufficientResources', `Not enough resources for a ${def.name}.`);
  }

  return { ok: error === null, error, message, tiles };
}

/**
 * True when a footprint at (x, y) has at least one free walkable neighbour tile that lies in the
 * same walkable region as the town center (so settlers can reach it).
 */
function hasAccess(state: GameState, type: BuildingType, x: number, y: number): boolean {
  const w = state.world;
  const town = state.buildings.find((b) => b.type === 'townCenter');
  if (!town) return true;
  const { labels } = getWalkRegions(w);
  const region = labels[(town.origin.y - 1) * w.width + town.origin.x - 1] as number;
  const { w: fw, h: fh } = BUILDING_DEFS[type].footprint;
  for (let ty = y - 1; ty <= y + fh; ty++) {
    for (let tx = x - 1; tx <= x + fw; tx++) {
      const inside = tx >= x && tx < x + fw && ty >= y && ty < y + fh;
      if (inside || !inBounds(w, tx, ty)) continue;
      const i = ty * w.width + tx;
      if (w.building[i] === 0 && labels[i] === region && region !== -1) return true;
    }
  }
  return false;
}
