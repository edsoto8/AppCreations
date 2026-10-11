/**
 * Procedural world generation (M2).
 *
 * `generateWorld(seedNumber, preset, mapSize)` builds the tile layers deterministically from the
 * `deriveRng(seed, 'worldgen')` stream and picks a valid town-center site. Pipeline:
 *
 *   1. Preset layout: a water mask, a relief field (what becomes hills and mountains) and,
 *      for rivers and fords, forced shallow/deep water. Each preset has its own shape:
 *      continent (warped radial mask + lakes), archipelago (seeded islands + fords),
 *      highlands (ridged relief, lakes in the basins), riverValley (meandering river with
 *      fords, valley walls rising to mountains on both sides).
 *   2. Cleanup: drop specks of land, fill specks of water, keep one landmass on `continent`.
 *   3. Classification: water depth by distance to land, mountains/hills by relief quantiles,
 *      sand beaches, forest groves by clustered noise (tree density goes into `resource`),
 *      integer elevation.
 *   4. Start site: score every candidate with summed-area tables, then validate the best ones
 *      (reachability, lumber and mine sites). If every attempt fails, a hand-stamped pad
 *      guarantees a valid start.
 *
 * Only `+ - * /`, `floor`, `abs` and `sqrt` are used on floats, so a seed gives bit-identical
 * worlds on every engine (see noise.ts). Nothing here reads the clock or `Math.random`.
 */
import {
  BUILDING_DEFS,
  START_SITE,
  TILE_RESOURCE_START,
  WORLDGEN,
  WORLDGEN_PRESETS,
  type WorldgenPresetDef,
} from './balance';
import { MAP_DIMENSIONS, MAX_ELEVATION } from './constants';
import { getWalkRegions, labelRegions, TERRAIN_WALKABLE, type RegionLabels } from './grid';
import { clamp01, createNoise2D, fbm, quantile, ridged, smoothstep } from './noise';
import { chance, deriveRng, nextFloat, nextInt, nextRange } from './rng';
import { Terrain, type MapPreset, type MapSize, type RngState, type TilePos, type WorldState } from './types';

// =============================================================================================
// Public API
// =============================================================================================

export interface GeneratedWorld {
  world: WorldState;
  /** Minimum-x, minimum-y corner of the 3x3 town center footprint. */
  townCenter: TilePos;
  /** Generation passes used (1 = first try). */
  attempts: number;
  /** True when the hand-stamped start pad was needed. */
  usedFallback: boolean;
}

/** Same arguments ⇒ identical world. */
export function generateWorld(seedNumber: number, preset: MapPreset, mapSize: MapSize): GeneratedWorld {
  const size = MAP_DIMENSIONS[mapSize];
  const rng = deriveRng(seedNumber, 'worldgen');
  for (let attempt = 1; attempt <= WORLDGEN.maxAttempts; attempt++) {
    const world = buildTerrain(rng, preset, mapSize, size);
    const site = findStartSite(world, rng);
    if (site) return finish(world, site, attempt, false);
  }
  // Every pass failed: stamp a guaranteed start pad on a fresh world.
  const world = buildTerrain(rng, preset, mapSize, size);
  const cx = Math.floor(size / 2);
  stampStartPad(world, cx, cx);
  const site = findStartSite(world, rng) ?? { x: cx - 1, y: cx - 1 };
  return finish(world, site, WORLDGEN.maxAttempts + 1, true);
}

function finish(world: WorldState, site: TilePos, attempts: number, usedFallback: boolean): GeneratedWorld {
  prepareTownCenterArea(world, site);
  return { world, townCenter: site, attempts, usedFallback };
}

/** Report of the start-site guarantees (GAME_DESIGN Appendix A) for a town center at `origin`. */
export interface StartSiteReport {
  ok: boolean;
  /** Human-readable names of the failed guarantees. */
  failures: string[];
  /** The 5x5 area around the 3x3 footprint is all Grass or Sand. */
  footprintOk: boolean;
  /** Counts inside the Appendix A windows (tiles in the town center's walkable region). */
  forestNear: number;
  stoneNear: number;
  grassNear: number;
  waterNear: number;
  /** Counts of what walking from the town center reaches within the `START_SITE.reach` limits. */
  reachableForest: number;
  reachableStone: number;
  waterReachable: boolean;
  /** Land tiles (any land terrain) in the landmass containing the town center. */
  landTiles: number;
  /** Origin of a valid 2x2 lumber camp / mine footprint within `START_SITE.siteRadius`, or null. */
  lumberSite: TilePos | null;
  mineSite: TilePos | null;
}

/**
 * Check every start guarantee for a town center whose footprint origin is `origin`.
 * Straightforward counting (no summed-area tables), used by the generator for the final check
 * and by tests.
 */
export function evaluateStartSite(world: WorldState, origin: TilePos): StartSiteReport {
  return evaluate(world, origin.x, origin.y, makeContext(world));
}

/**
 * Overwrite a disc around (cx, cy) with a start layout that always passes `evaluateStartSite`
 * for a town center at (cx - 1, cy - 1): grass, a forest to the west, hills to the north, a pond
 * to the south-east. Last-resort fallback of `generateWorld`; exported for tests.
 */
export function stampStartPad(world: WorldState, cx: number, cy: number): void {
  const radius = 17;
  const set = (x: number, y: number, terrain: Terrain, elevation: number, resource: number) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    const i = y * world.width + x;
    world.terrain[i] = terrain;
    world.elevation[i] = elevation;
    world.resource[i] = resource;
  };
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      let terrain: Terrain = Terrain.Grass;
      let elevation = 0;
      let resource = 0;
      if (dx <= -7 && dx >= -14 && dy >= -5 && dy <= 5) {
        terrain = Terrain.Forest;
        resource = TILE_RESOURCE_START.forestWood;
      } else if (dx >= -4 && dx <= 4 && dy >= -9 && dy <= -6) {
        terrain = Terrain.Hills;
        elevation = 2;
        resource = TILE_RESOURCE_START.hillsStone;
      } else if (dx >= 4 && dx <= 8 && dy >= 4 && dy <= 7) {
        terrain = dx >= 5 && dx <= 7 && dy >= 5 && dy <= 6 ? Terrain.DeepWater : Terrain.ShallowWater;
      }
      set(cx + dx, cy + dy, terrain, elevation, resource);
    }
  }
  world.revision++;
}

// =============================================================================================
// Step 1-3: terrain
// =============================================================================================

/** What a preset hands to the shared pipeline. */
interface Layout {
  /** 1 = water. */
  water: Uint8Array;
  /** 0 = none, 1 = force shallow water, 2 = force deep water (river core, fords). */
  forced: Uint8Array;
  /** Higher = more rugged; the top shares of land become mountains and hills. */
  relief: Float64Array;
}

function buildTerrain(rng: RngState, preset: MapPreset, mapSize: MapSize, size: number): WorldState {
  const def = WORLDGEN_PRESETS[preset];
  let layout: Layout;
  switch (preset) {
    case 'continent':
      layout = continentLayout(rng, size, def);
      break;
    case 'archipelago':
      layout = archipelagoLayout(rng, size, mapSize, def);
      break;
    case 'highlands':
      layout = highlandsLayout(rng, size, def);
      break;
    case 'riverValley':
      layout = riverValleyLayout(rng, size, mapSize);
      break;
  }
  cleanup(layout, size, preset);
  if (preset === 'archipelago') carveFords(layout, size);
  return classify(rng, layout, size, def);
}

const EDGE = (x: number, y: number, size: number): number => Math.min(x, y, size - 1 - x, size - 1 - y);

function continentLayout(rng: RngState, size: number, def: WorldgenPresetDef): Layout {
  const warpX = createNoise2D(rng);
  const warpY = createNoise2D(rng);
  const shape = createNoise2D(rng);
  const lakes = createNoise2D(rng);
  const reliefNoise = createNoise2D(rng);
  const ridge = createNoise2D(rng);
  const n = size * size;
  const land = new Float64Array(n);
  const relief = new Float64Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const nx = ((x + 0.5) / size) * 2 - 1 + 0.2 * fbm(warpX, x * 0.04, y * 0.04, 3);
      const ny = ((y + 0.5) / size) * 2 - 1 + 0.2 * fbm(warpY, x * 0.04, y * 0.04, 3);
      const mask = 1 - smoothstep(0.4, 1.0, Math.sqrt(nx * nx + ny * ny));
      const lakeCut = smoothstep(0.25, 0.5, fbm(lakes, x * 0.06, y * 0.06, 3)) * smoothstep(0.35, 0.7, mask) * 0.5;
      land[i] = EDGE(x, y, size) < WORLDGEN.oceanBorder ? -1 : mask + 0.35 * fbm(shape, x * 0.05, y * 0.05, 4) - lakeCut;
      const r = 0.6 * ridged(ridge, x * 0.035, y * 0.035, 4) + 0.4 * (fbm(reliefNoise, x * 0.06, y * 0.06, 4) * 0.5 + 0.5);
      relief[i] = r * (0.45 + 0.55 * smoothstep(0.1, 0.6, mask));
    }
  }
  return { water: belowQuantile(land, def.waterShare), forced: new Uint8Array(n), relief };
}

interface Island {
  cx: number;
  cy: number;
  r: number;
}

function archipelagoLayout(rng: RngState, size: number, mapSize: MapSize, def: WorldgenPresetDef): Layout {
  const warpX = createNoise2D(rng);
  const warpY = createNoise2D(rng);
  const detail = createNoise2D(rng);
  const ridge = createNoise2D(rng);
  const [minIslands, maxIslands] = WORLDGEN.islandCount[mapSize];
  const count = nextInt(rng, minIslands, maxIslands);
  const totalLand = (1 - def.waterShare) * size * size * WORLDGEN.islandAreaBoost;
  const startArea = Math.max(WORLDGEN.startIslandMinTiles, totalLand * WORLDGEN.startIslandShare);

  // Island 0 is the start island, placed first within the middle third; the others are placed by
  // rejection sampling and shrink when the map is too crowded.
  const margin = WORLDGEN.oceanBorder + 3;
  const gap = WORLDGEN.islandGap;
  const r0 = Math.sqrt(startArea / Math.PI);
  const centreRange = (r: number): [number, number] => {
    const lo = Math.min(Math.max(margin + r, size * 0.35), size * 0.65);
    return [lo, Math.max(lo, Math.min(size - margin - r, size * 0.65))];
  };
  const [lo0, hi0] = centreRange(r0);
  const islands: Island[] = [{ cx: nextRange(rng, lo0, hi0), cy: nextRange(rng, lo0, hi0), r: r0 }];
  const weights = Array.from({ length: count - 1 }, () => nextRange(rng, 0.6, 1.4));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  for (const w of weights) {
    let r = Math.sqrt(((totalLand - startArea) * (w / weightSum)) / Math.PI);
    for (let shrink = 0; shrink < 14; shrink++) {
      const lo = margin + r;
      const hi = size - margin - r;
      let placed = false;
      if (hi > lo) {
        for (let tries = 0; tries < 80 && !placed; tries++) {
          const cx = nextRange(rng, lo, hi);
          const cy = nextRange(rng, lo, hi);
          if (islands.every((o) => Math.sqrt((o.cx - cx) * (o.cx - cx) + (o.cy - cy) * (o.cy - cy)) >= o.r + r + gap)) {
            islands.push({ cx, cy, r });
            placed = true;
          }
        }
      }
      if (placed) break;
      r *= 0.92;
    }
  }

  const n = size * size;
  const land = new Float64Array(n);
  const relief = new Float64Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const wx = x + 2.5 * fbm(warpX, x * 0.06, y * 0.06, 3);
      const wy = y + 2.5 * fbm(warpY, x * 0.06, y * 0.06, 3);
      let best = -2;
      for (const isl of islands) {
        const d = Math.sqrt((wx - isl.cx) * (wx - isl.cx) + (wy - isl.cy) * (wy - isl.cy)) / isl.r;
        if (1 - d > best) best = 1 - d;
      }
      land[i] = EDGE(x, y, size) < WORLDGEN.oceanBorder ? -1 : best + 0.1 * fbm(detail, x * 0.08, y * 0.08, 3);
      relief[i] = 0.55 * clamp01(best) + 0.45 * ridged(ridge, x * 0.05, y * 0.05, 3);
    }
  }
  // Fixed sea level: the islands keep their planned size instead of being rescaled to a share.
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) water[i] = (land[i] as number) < 0 ? 1 : 0;
  return { water, forced: new Uint8Array(n), relief };
}

function highlandsLayout(rng: RngState, size: number, def: WorldgenPresetDef): Layout {
  const warpX = createNoise2D(rng);
  const warpY = createNoise2D(rng);
  const base = createNoise2D(rng);
  const ridge = createNoise2D(rng);
  const n = size * size;
  const relief = new Float64Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = x + 6 * fbm(warpX, x * 0.03, y * 0.03, 2);
      const wy = y + 6 * fbm(warpY, x * 0.03, y * 0.03, 2);
      relief[y * size + x] = 0.5 * (fbm(base, wx * 0.035, wy * 0.035, 5) * 0.5 + 0.5) + 0.5 * ridged(ridge, wx * 0.03, wy * 0.03, 4);
    }
  }
  // Lakes sit in the lowest basins.
  return { water: belowQuantile(relief, def.waterShare), forced: new Uint8Array(n), relief };
}

function riverValleyLayout(rng: RngState, size: number, mapSize: MapSize): Layout {
  const meander = createNoise2D(rng);
  const widthNoise = createNoise2D(rng);
  const bankWarp = createNoise2D(rng);
  const detail = createNoise2D(rng);
  const ridge = createNoise2D(rng);
  const horizontal = chance(rng, 0.5);
  const halfWidthBase = Math.max(3, WORLDGEN.riverHalfWidth * size);
  const fordCount = WORLDGEN.riverFords[mapSize];
  const fords: number[] = [];
  for (let k = 0; k < fordCount; k++) fords.push(((k + 0.5) / fordCount + nextRange(rng, -0.08, 0.08)) * size);

  // Centre line and half width along the river axis.
  const centre = new Float64Array(size);
  const halfWidth = new Float64Array(size);
  for (let u = 0; u < size; u++) {
    centre[u] = size * (0.5 + 0.13 * fbm(meander, u * 0.03, 0.5, 2));
    halfWidth[u] = halfWidthBase * (0.85 + 0.3 * fbm(widthNoise, u * 0.05, 3.7, 2));
  }

  const n = size * size;
  const water = new Uint8Array(n);
  const forced = new Uint8Array(n);
  const relief = new Float64Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = horizontal ? x : y;
      const v = (horizontal ? y : x) + 2.5 * fbm(bankWarp, x * 0.07, y * 0.07, 2);
      const c = centre[u] as number;
      const d = Math.abs(v - c);
      const hw = halfWidth[u] as number;
      if (d < hw) {
        water[i] = 1;
        forced[i] = d < 0.5 * hw ? 2 : 1;
        for (const f of fords) if (Math.abs(u - f) <= 2.5) forced[i] = 1;
      }
      // Valley walls rise toward both map edges (normalised per side so both sides get mountains).
      const extent = Math.max(1, v < c ? c : size - c);
      const dn = clamp01(d / extent);
      // Rocky outcrops (ridged noise) also rise on the valley floor, so stone is never far from the river.
      const noise = 0.7 * ridged(ridge, x * 0.045, y * 0.045, 3) + 0.3 * (fbm(detail, x * 0.08, y * 0.08, 3) * 0.5 + 0.5);
      relief[i] = 0.5 * dn + 0.5 * noise;
    }
  }
  return { water, forced, relief };
}

/** 1 where `values` is below the `share` quantile. */
function belowQuantile(values: Float64Array, share: number): Uint8Array {
  const cut = quantile(values, share);
  const mask = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) mask[i] = (values[i] as number) < cut ? 1 : 0;
  return mask;
}

// ---------------------------------------------------------------------------------------------
// Cleanup, fords, distance fields
// ---------------------------------------------------------------------------------------------

function cleanup(layout: Layout, size: number, preset: MapPreset): void {
  const { water } = layout;
  const lands = labelRegions(size, size, (i) => water[i] === 0);
  let largest = 0;
  for (let c = 1; c < lands.sizes.length; c++) if ((lands.sizes[c] as number) > (lands.sizes[largest] as number)) largest = c;
  for (let i = 0; i < water.length; i++) {
    const c = lands.labels[i] as number;
    if (c === -1) continue;
    const tooSmall = (lands.sizes[c] as number) < WORLDGEN.minLandComponent;
    if (tooSmall || (preset === 'continent' && c !== largest)) water[i] = 1;
  }
  // Fill specks of water (never river tiles, which are forced).
  const waters = labelRegions(size, size, (i) => water[i] === 1);
  for (let i = 0; i < water.length; i++) {
    const c = waters.labels[i] as number;
    if (c !== -1 && (waters.sizes[c] as number) < WORLDGEN.minWaterComponent && layout.forced[i] === 0) water[i] = 0;
  }
}

/** Join the islands with shallow-water fords (minimum spanning tree over the closest coast pairs). */
function carveFords(layout: Layout, size: number): void {
  const { water, forced } = layout;
  const lands = labelRegions(size, size, (i) => water[i] === 0);
  const comps: number[] = [];
  for (let c = 0; c < lands.sizes.length; c++) if ((lands.sizes[c] as number) >= 30) comps.push(c);
  if (comps.length < 2) return;
  const coast = new Map<number, number[]>();
  for (const c of comps) coast.set(c, []);
  for (let i = 0; i < water.length; i++) {
    const c = lands.labels[i] as number;
    if (c === -1 || !coast.has(c)) continue;
    const x = i % size;
    const y = (i - x) / size;
    if (
      (x > 0 && water[i - 1] === 1) ||
      (x < size - 1 && water[i + 1] === 1) ||
      (y > 0 && water[i - size] === 1) ||
      (y < size - 1 && water[i + size] === 1)
    ) {
      (coast.get(c) as number[]).push(i);
    }
  }
  // Closest coast pair for every island pair.
  interface Link {
    a: number;
    b: number;
    d2: number;
    from: number;
    to: number;
  }
  const links: Link[] = [];
  for (let p = 0; p < comps.length; p++) {
    for (let q = p + 1; q < comps.length; q++) {
      let best: Link | null = null;
      for (const ia of coast.get(comps[p] as number) as number[]) {
        const ax = ia % size;
        const ay = (ia - ax) / size;
        for (const ib of coast.get(comps[q] as number) as number[]) {
          const bx = ib % size;
          const by = (ib - bx) / size;
          const d2 = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
          if (best === null || d2 < best.d2) best = { a: p, b: q, d2, from: ia, to: ib };
        }
      }
      if (best) links.push(best);
    }
  }
  // Kruskal with a tiny union-find.
  links.sort((l, m) => l.d2 - m.d2 || l.from - m.from || l.to - m.to);
  const parent = comps.map((_, k) => k);
  const find = (k: number): number => {
    let r = k;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  const mark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * size + x;
    if (water[i] === 1) forced[i] = 1;
  };
  for (const link of links) {
    const ra = find(link.a);
    const rb = find(link.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    // Bresenham line, two tiles wide.
    let x = link.from % size;
    let y = (link.from - x) / size;
    const x1 = link.to % size;
    const y1 = (link.to - x1) / size;
    const dx = Math.abs(x1 - x);
    const dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1;
    const sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      mark(x, y);
      if (dx > -dy) mark(x, y + 1);
      else mark(x + 1, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
}

/** 4-neighbour step distance from the nearest tile where `mask[i] === want`; 255 when none. */
function distanceFrom(mask: Uint8Array, want: number, size: number): Uint8Array {
  const n = size * size;
  const dist = new Uint8Array(n).fill(255);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] === want) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const cur = queue[head++] as number;
    const d = (dist[cur] as number) + 1;
    if (d >= 255) continue;
    const x = cur % size;
    if (x > 0 && dist[cur - 1] === 255) {
      dist[cur - 1] = d;
      queue[tail++] = cur - 1;
    }
    if (x < size - 1 && dist[cur + 1] === 255) {
      dist[cur + 1] = d;
      queue[tail++] = cur + 1;
    }
    if (cur >= size && dist[cur - size] === 255) {
      dist[cur - size] = d;
      queue[tail++] = cur - size;
    }
    if (cur < n - size && dist[cur + size] === 255) {
      dist[cur + size] = d;
      queue[tail++] = cur + size;
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

function classify(rng: RngState, layout: Layout, size: number, def: WorldgenPresetDef): WorldState {
  const { water, forced, relief } = layout;
  const n = size * size;
  const beachNoise = createNoise2D(rng);
  const depthNoise = createNoise2D(rng);
  const forestA = createNoise2D(rng);
  const forestB = createNoise2D(rng);

  const world: WorldState = {
    width: size,
    height: size,
    terrain: new Array<number>(n).fill(Terrain.DeepWater),
    elevation: new Array<number>(n).fill(0),
    resource: new Array<number>(n).fill(0),
    building: new Array<number>(n).fill(0),
    revision: 0,
  };

  // Relief quantiles over land tiles decide mountains and hills.
  let landCount = 0;
  for (let i = 0; i < n; i++) if (water[i] === 0) landCount++;
  const landRelief = new Float64Array(landCount);
  let k = 0;
  for (let i = 0; i < n; i++) if (water[i] === 0) landRelief[k++] = relief[i] as number;
  const mountainCut = quantile(landRelief, 1 - def.mountainShare);
  const hillsCut = quantile(landRelief, 1 - def.mountainShare - def.hillsShare);
  const minRelief = quantile(landRelief, 0);
  const maxRelief = quantile(landRelief, 1);

  const distLand = distanceFrom(water, 0, size);
  const distWater = distanceFrom(water, 1, size);

  // Pass 1: water depth, mountains, hills, sand. Flat grass candidates are marked Grass for now.
  const forestNoise = new Float64Array(n);
  const candidates: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (water[i] === 1) {
        const f = forced[i] as number;
        const dl = distLand[i] as number;
        const shallow =
          f === 1 ||
          (f === 0 &&
            (dl <= def.shallowRange || (dl === def.shallowRange + 1 && fbm(depthNoise, x * 0.12, y * 0.12, 2) > 0.05)));
        world.terrain[i] = shallow ? Terrain.ShallowWater : Terrain.DeepWater;
        continue;
      }
      const r = relief[i] as number;
      if (r >= mountainCut) {
        world.terrain[i] = Terrain.Mountain;
        const lvl = clamp01((r - mountainCut) / Math.max(1e-9, maxRelief - mountainCut));
        world.elevation[i] = Math.min(MAX_ELEVATION, 4 + Math.min(2, Math.floor(lvl * 3)));
        world.resource[i] = Math.round(TILE_RESOURCE_START.mountainStone * (1 - WORLDGEN.mountainVariation / 2 + WORLDGEN.mountainVariation * lvl));
        continue;
      }
      if (r >= hillsCut) {
        world.terrain[i] = Terrain.Hills;
        const lvl = clamp01((r - hillsCut) / Math.max(1e-9, mountainCut - hillsCut));
        world.elevation[i] = lvl >= 0.5 ? 3 : 2;
        world.resource[i] = Math.round(TILE_RESOURCE_START.hillsStone * (1 - WORLDGEN.hillsVariation / 2 + WORLDGEN.hillsVariation * lvl));
        continue;
      }
      // Flat land: beach, or a forest/grass candidate.
      const dw = distWater[i] as number;
      const bn = fbm(beachNoise, x * 0.12, y * 0.12, 3);
      if ((dw === 1 && bn > def.beachNoise.adjacent) || (dw === 2 && bn > def.beachNoise.second)) {
        world.terrain[i] = Terrain.Sand;
        continue;
      }
      world.terrain[i] = Terrain.Grass;
      forestNoise[i] = fbm(forestA, x * 0.085, y * 0.085, 4) + 0.35 * fbm(forestB, x * 0.025, y * 0.025, 2);
      candidates.push(i);
      const flat = clamp01((r - minRelief) / Math.max(1e-9, hillsCut - minRelief));
      world.elevation[i] = flat >= WORLDGEN.lowlandRiseAt && dw > WORLDGEN.coastFlatDistance ? 1 : 0;
    }
  }

  // Pass 2: forest groves are the highest clustered-noise values among the flat candidates.
  const wanted = Math.min(Math.round(def.forestShare * landCount), Math.floor(candidates.length * 0.8));
  if (wanted > 0) {
    const values = new Float64Array(candidates.length);
    for (let c = 0; c < candidates.length; c++) values[c] = forestNoise[candidates[c] as number] as number;
    const cut = quantile(values, 1 - wanted / candidates.length);
    for (const i of candidates) {
      const fn = forestNoise[i] as number;
      if (fn < cut) continue;
      world.terrain[i] = Terrain.Forest;
      const density = smoothstep(cut, cut + 0.25, fn);
      world.resource[i] = Math.round(TILE_RESOURCE_START.forestWood * (WORLDGEN.forestMinDensity + (1 - WORLDGEN.forestMinDensity) * density));
    }
  }
  return world;
}

// =============================================================================================
// Step 4: start site
// =============================================================================================

interface EvalContext {
  walk: RegionLabels;
  land: RegionLabels;
}

function makeContext(world: WorldState): EvalContext {
  return {
    walk: getWalkRegions(world),
    land: labelRegions(world.width, world.height, (i) => (world.terrain[i] as number) >= Terrain.Sand),
  };
}

const isBuildableLand = (t: number): boolean => t === Terrain.Grass || t === Terrain.Sand;

function evaluate(world: WorldState, ox: number, oy: number, ctx: EvalContext): StartSiteReport {
  const { width: W, height: H, terrain } = world;
  const failures: string[] = [];
  const report: StartSiteReport = {
    ok: false,
    failures,
    footprintOk: true,
    forestNear: 0,
    stoneNear: 0,
    grassNear: 0,
    waterNear: 0,
    reachableForest: 0,
    reachableStone: 0,
    waterReachable: false,
    landTiles: 0,
    lumberSite: null,
    mineSite: null,
  };
  if (ox < 2 || oy < 2 || ox + 3 + 2 > W || oy + 3 + 2 > H) {
    failures.push('outOfBounds');
    report.footprintOk = false;
    return report;
  }
  for (let y = oy - 1; y < oy + 4; y++) {
    for (let x = ox - 1; x < ox + 4; x++) {
      if (!isBuildableLand(terrain[y * W + x] as number)) report.footprintOk = false;
    }
  }
  if (!report.footprintOk) failures.push('footprint');
  const centre = (oy + 1) * W + ox + 1;
  const region = ctx.walk.labels[centre] as number;
  const landLabel = ctx.land.labels[centre] as number;
  report.landTiles = landLabel === -1 ? 0 : (ctx.land.sizes[landLabel] as number);
  if (region === -1) {
    failures.push('unwalkable');
    return report;
  }

  // Counts inside the Appendix A windows (Chebyshev radius measured from the footprint edge).
  const count = (radius: number, test: (i: number) => boolean): number => {
    let c = 0;
    for (let y = Math.max(0, oy - radius); y < Math.min(H, oy + 3 + radius); y++) {
      for (let x = Math.max(0, ox - radius); x < Math.min(W, ox + 3 + radius); x++) if (test(y * W + x)) c++;
    }
    return c;
  };
  const inRegion = (i: number) => ctx.walk.labels[i] === region;
  report.forestNear = count(START_SITE.forest.radius, (i) => terrain[i] === Terrain.Forest && inRegion(i));
  report.stoneNear = count(START_SITE.stone.radius, (i) => (terrain[i] === Terrain.Hills && inRegion(i)) || terrain[i] === Terrain.Mountain);
  report.grassNear = count(START_SITE.grass.radius, (i) => terrain[i] === Terrain.Grass && inRegion(i));
  report.waterNear = count(START_SITE.water.radius, (i) => (terrain[i] as number) <= Terrain.ShallowWater);
  if (report.forestNear < START_SITE.forest.min) failures.push('forest');
  if (report.stoneNear < START_SITE.stone.min) failures.push('stone');
  if (report.grassNear < START_SITE.grass.min) failures.push('grass');
  if (report.waterNear < START_SITE.water.min) failures.push('water');
  if (report.landTiles < START_SITE.minLandTiles) failures.push('landmass');

  // Walking reachability from the footprint.
  const dist = new Int16Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (let y = oy; y < oy + 3; y++) {
    for (let x = ox; x < ox + 3; x++) {
      dist[y * W + x] = 0;
      queue[tail++] = y * W + x;
    }
  }
  const reach = START_SITE.reach;
  const maxDepth = Math.max(reach.forest, reach.stone, reach.water);
  while (head < tail) {
    const cur = queue[head++] as number;
    const d = (dist[cur] as number) + 1;
    if (d > maxDepth) continue;
    const x = cur % W;
    for (let dir = 0; dir < 4; dir++) {
      if (dir === 0 && x === 0) continue;
      if (dir === 1 && x === W - 1) continue;
      if (dir === 2 && cur < W) continue;
      if (dir === 3 && cur >= W * (H - 1)) continue;
      const nb = dir === 0 ? cur - 1 : dir === 1 ? cur + 1 : dir === 2 ? cur - W : cur + W;
      if (dist[nb] !== -1) continue;
      dist[nb] = d;
      const t = terrain[nb] as number;
      if (t === Terrain.Forest && d <= reach.forest) report.reachableForest++;
      if ((t === Terrain.Hills || t === Terrain.Mountain) && d <= reach.stone) report.reachableStone++;
      if ((t === Terrain.ShallowWater || t === Terrain.DeepWater) && d <= reach.water) report.waterReachable = true;
      if (TERRAIN_WALKABLE[t] === true) queue[tail++] = nb;
    }
  }
  if (report.reachableForest < START_SITE.forest.min) failures.push('forestReach');
  if (report.reachableStone < START_SITE.stone.min) failures.push('stoneReach');
  if (!report.waterReachable) failures.push('waterReach');

  // Lumber camp and mine sites (the same rules as canPlaceBuilding, evaluated on the bare terrain).
  report.lumberSite = findSite(world, ctx, ox, oy, region, 'lumberCamp');
  report.mineSite = findSite(world, ctx, ox, oy, region, 'mine');
  if (!report.lumberSite) failures.push('lumberSite');
  if (!report.mineSite) failures.push('mineSite');

  report.ok = failures.length === 0;
  return report;
}

function findSite(world: WorldState, ctx: EvalContext, ox: number, oy: number, region: number, type: 'lumberCamp' | 'mine'): TilePos | null {
  const def = BUILDING_DEFS[type];
  const need = def.requiresNearby;
  if (!need) return null;
  const { width: W, height: H, terrain } = world;
  const r = START_SITE.siteRadius;
  const { w: fw, h: fh } = def.footprint;
  for (let sy = Math.max(0, oy - r - fh + 1); sy <= Math.min(H - fh, oy + 2 + r); sy++) {
    for (let sx = Math.max(0, ox - r - fw + 1); sx <= Math.min(W - fw, ox + 2 + r); sx++) {
      if (sx < ox + 3 + 1 && sx + fw > ox - 1 && sy < oy + 3 + 1 && sy + fh > oy - 1) continue; // keep the town center ring free
      let ok = true;
      for (let y = sy; y < sy + fh && ok; y++) {
        for (let x = sx; x < sx + fw && ok; x++) {
          const i = y * W + x;
          ok = def.allowedTerrain.includes(terrain[i] as Terrain) && ctx.walk.labels[i] === region;
        }
      }
      if (!ok) continue;
      let found = 0;
      for (let y = Math.max(0, sy - need.radius); y < Math.min(H, sy + fh + need.radius) && found < need.minCount; y++) {
        for (let x = Math.max(0, sx - need.radius); x < Math.min(W, sx + fw + need.radius); x++) {
          if (need.terrain.includes(terrain[y * W + x] as Terrain)) found++;
        }
      }
      if (found >= need.minCount) return { x: sx, y: sy };
    }
  }
  return null;
}

/** Summed-area table of a 0/1 predicate: `(w + 1) * (h + 1)` entries. */
function buildPrefix(w: number, h: number, test: (i: number) => boolean): Int32Array {
  const stride = w + 1;
  const p = new Int32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      if (test(y * w + x)) row++;
      p[(y + 1) * stride + x + 1] = (p[y * stride + x + 1] as number) + row;
    }
  }
  return p;
}

function rectSum(p: Int32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number {
  const stride = w + 1;
  const ax = Math.max(0, x0);
  const ay = Math.max(0, y0);
  const bx = Math.min(w, x1);
  const by = Math.min(h, y1);
  if (bx <= ax || by <= ay) return 0;
  return (p[by * stride + bx] as number) - (p[ay * stride + bx] as number) - (p[by * stride + ax] as number) + (p[ay * stride + ax] as number);
}

/**
 * Find a town-center origin that satisfies every start guarantee, preferring spacious, central,
 * resource-rich spots. Returns null when this world has none.
 */
function findStartSite(world: WorldState, rng: RngState): TilePos | null {
  const { width: W, height: H, terrain } = world;
  const ctx = makeContext(world);
  let main = 0;
  for (let c = 1; c < ctx.walk.sizes.length; c++) if ((ctx.walk.sizes[c] as number) > (ctx.walk.sizes[main] as number)) main = c;
  const inMain = (i: number) => ctx.walk.labels[i] === main;
  const forest = buildPrefix(W, H, (i) => terrain[i] === Terrain.Forest && inMain(i));
  const stone = buildPrefix(W, H, (i) => (terrain[i] === Terrain.Hills && inMain(i)) || terrain[i] === Terrain.Mountain);
  const grass = buildPrefix(W, H, (i) => terrain[i] === Terrain.Grass && inMain(i));
  const water = buildPrefix(W, H, (i) => (terrain[i] as number) <= Terrain.ShallowWater);
  const blocked = buildPrefix(W, H, (i) => !isBuildableLand(terrain[i] as number));

  const S = START_SITE;
  const margin = S.edgeMargin;
  const candidates: { x: number; y: number; score: number }[] = [];
  const half = W / 2;
  for (let oy = margin; oy <= H - 3 - margin; oy++) {
    for (let ox = margin; ox <= W - 3 - margin; ox++) {
      if (rectSum(blocked, W, H, ox - 1, oy - 1, ox + 4, oy + 4) !== 0) continue;
      const c = (oy + 1) * W + ox + 1;
      if (ctx.walk.labels[c] !== main) continue;
      const landLabel = ctx.land.labels[c] as number;
      if (landLabel === -1 || (ctx.land.sizes[landLabel] as number) < S.minLandTiles) continue;
      const win = (p: Int32Array, r: number) => rectSum(p, W, H, ox - r, oy - r, ox + 3 + r, oy + 3 + r);
      const nForest = win(forest, S.forest.radius);
      const nStone = win(stone, S.stone.radius);
      const nGrass = win(grass, S.grass.radius);
      if (nForest < S.forest.min || nStone < S.stone.min || nGrass < S.grass.min || win(water, S.water.radius) < S.water.min) continue;
      const nearWater = win(water, 10);
      const dx = ox + 1.5 - half;
      const dy = oy + 1.5 - half;
      const score =
        Math.min(nGrass, 150) / 150 +
        0.8 * (Math.min(nForest, 30) / 30) +
        0.5 * (Math.min(nStone, 12) / 12) +
        0.4 * (Math.min(nearWater, 20) / 20) -
        1.2 * (Math.sqrt(dx * dx + dy * dy) / half) +
        0.05 * nextFloat(rng);
      candidates.push({ x: ox, y: oy, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const limit = Math.min(candidates.length, S.maxCandidatesChecked);
  for (let k = 0; k < limit; k++) {
    const cand = candidates[k] as { x: number; y: number };
    if (evaluate(world, cand.x, cand.y, ctx).ok) return { x: cand.x, y: cand.y };
  }
  return null;
}

/** Level and clear the 5x5 area around the town center so the footprint and founders sit on flat, empty land. */
function prepareTownCenterArea(world: WorldState, origin: TilePos): void {
  const W = world.width;
  const level = world.elevation[(origin.y + 1) * W + origin.x + 1] as number;
  for (let y = origin.y - 1; y < origin.y + 4; y++) {
    for (let x = origin.x - 1; x < origin.x + 4; x++) {
      const i = y * W + x;
      world.elevation[i] = level;
      world.resource[i] = 0;
    }
  }
}
