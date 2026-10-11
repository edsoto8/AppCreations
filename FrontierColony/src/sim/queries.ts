/**
 * Read-only query helpers over GameState. Pure functions: safe to call from the renderer, the UI
 * and tests. They never mutate state and never use randomness.
 */
import { BUILDING_DEFS, TERRAIN_DEFS } from './balance';
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

/**
 * Materials construction sites still need, per resource: `required - delivered - carried`
 * (goods a hauler has already picked up are no longer in the stock, so they are not owed twice).
 * GAME_DESIGN §6.6 step 1.
 */
export function getOutstandingMaterials(state: GameState): ResourceAmounts {
  const out = emptyResources();
  for (const b of state.buildings) {
    const c = b.construction;
    if (c === null || c.kind !== 'new') continue;
    for (const r of RESOURCE_TYPES) {
      let carried = 0;
      for (const s of state.settlers) {
        if (s.task.kind === 'haul' && s.task.toBuildingId === b.id && s.task.resource === r && s.carrying) carried += s.carrying.amount;
      }
      out[r] += Math.max(0, c.required[r] - c.delivered[r] - carried);
    }
  }
  return out;
}

/** Stock minus what construction sites have reserved: what the player can still spend on new orders. */
export function getAvailableStock(state: GameState): ResourceAmounts {
  const out = getOutstandingMaterials(state);
  const avail = emptyResources();
  for (const r of RESOURCE_TYPES) avail[r] = state.colony.stock[r] - out[r];
  return avail;
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
 * Net change (produced - consumed) of each resource per in-game day, over the last (up to) 24 hourly
 * samples plus the current partial hour. One-off spending on construction is not counted.
 */
export function getResourceRates(state: GameState): ResourceAmounts {
  const rates = emptyResources();
  const history = state.stats.history.slice(-24);
  const partial = state.time.timeOfDay - Math.floor(state.time.timeOfDay);
  const elapsed = history.length + partial;
  if (elapsed < 1) return rates;
  for (const r of RESOURCE_TYPES) {
    let net = state.stats.producedThisHour[r] - state.stats.consumedThisHour[r];
    for (const h of history) net += h.produced[r] - h.consumed[r];
    rates[r] = (net / elapsed) * 24;
  }
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

  if (error === null && !canAfford(getAvailableStock(state), def.cost)) {
    fail('insufficientResources', `Not enough resources for a ${def.name}.`);
  }

  // The most expensive check (a flood fill over the map) comes last.
  if (error === null && !hasAccess(state, type, x, y)) {
    fail('blocked', 'Settlers could not reach this spot.');
  }

  return { ok: error === null, error, message, tiles };
}

/**
 * True when, with the new footprint in place, settlers can still walk from the town center to a tile
 * next to every building (the new one included). This stops a placement from walling in the town center
 * or another building, which would leave settlers unable to eat or work.
 */
function hasAccess(state: GameState, type: BuildingType, x: number, y: number): boolean {
  const w = state.world;
  const W = w.width;
  const H = w.height;
  const town = state.buildings.find((b) => b.type === 'townCenter');
  if (!town) return true;
  const { w: fw, h: fh } = BUILDING_DEFS[type].footprint;
  const inNew = (tx: number, ty: number) => tx >= x && tx < x + fw && ty >= y && ty < y + fh;
  const passable = (tx: number, ty: number) =>
    tx >= 0 && ty >= 0 && tx < W && ty < H && TERRAIN_DEFS[w.terrain[ty * W + tx] as Terrain].walkable && w.building[ty * W + tx] === 0 && !inNew(tx, ty);

  // Flood fill (4-connected is enough: a legal diagonal step implies a 4-connected route) from the tiles around the town center.
  const seen = new Uint8Array(W * H);
  const queue: number[] = [];
  const ring: number[] = [];
  for (let ty = town.origin.y - 1; ty <= town.origin.y + town.footprint.h; ty++) {
    for (let tx = town.origin.x - 1; tx <= town.origin.x + town.footprint.w; tx++) {
      if (passable(tx, ty)) ring.push(ty * W + tx);
    }
  }
  if (ring.length === 0) return false;
  seen[ring[0] as number] = 1;
  queue.push(ring[0] as number);
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as number;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (let d = 0; d < 4; d++) {
      const nx = d === 0 ? cx - 1 : d === 1 ? cx + 1 : cx;
      const ny = d === 2 ? cy - 1 : d === 3 ? cy + 1 : cy;
      if (!passable(nx, ny) || seen[ny * W + nx]) continue;
      seen[ny * W + nx] = 1;
      queue.push(ny * W + nx);
    }
  }
  const touches = (ox: number, oy: number, bw: number, bh: number): boolean => {
    for (let ty = oy - 1; ty <= oy + bh; ty++) {
      for (let tx = ox - 1; tx <= ox + bw; tx++) {
        if (tx >= ox && tx < ox + bw && ty >= oy && ty < oy + bh) continue;
        if (tx >= 0 && ty >= 0 && tx < W && ty < H && seen[ty * W + tx]) return true;
      }
    }
    return false;
  };
  // The tiles around the town center must stay one connected area (founders and newcomers arrive there).
  for (const i of ring) if (!seen[i]) return false;
  if (!touches(x, y, fw, fh)) return false;
  for (const b of state.buildings) if (!touches(b.origin.x, b.origin.y, b.footprint.w, b.footprint.h)) return false;
  return true;
}
