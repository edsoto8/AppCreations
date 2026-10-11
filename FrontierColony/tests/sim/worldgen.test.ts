import { describe, expect, it, vi } from 'vitest';
import {
  MAP_DIMENSIONS,
  MAP_PRESETS,
  MAP_SIZES,
  MAX_ELEVATION,
  Terrain,
  createGame,
  getWalkRegions,
  sameWalkRegion,
  type GameState,
  type MapPreset,
  type MapSize,
  type WorldState,
} from '../../src/sim';
import { START_SITE, TILE_RESOURCE_START, TRAIT_EXCLUSIVE_PAIRS } from '../../src/sim/balance';
import { labelRegions } from '../../src/sim/grid';
import { createNoise2D, fbm } from '../../src/sim/noise';
import { createRng, hashSeed } from '../../src/sim/rng';
import { evaluateStartSite, generateWorld, stampStartPad } from '../../src/sim/worldgen';

// Several tests here are heavy (many generations or thousands of ticks); allow for a loaded CI machine.
vi.setConfig({ testTimeout: 60_000 });

const seeds = (n: number, prefix = 'wg') => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

function share(world: WorldState, ...terrains: number[]): number {
  let c = 0;
  for (const t of world.terrain) if (terrains.includes(t)) c++;
  return c / world.terrain.length;
}

function landShare(world: WorldState, ...terrains: number[]): number {
  const land = 1 - share(world, Terrain.DeepWater, Terrain.ShallowWater);
  return share(world, ...terrains) / land;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function landComponents(world: WorldState) {
  return labelRegions(world.width, world.height, (i) => (world.terrain[i] as number) >= Terrain.Sand);
}

function gen(seed: string, preset: MapPreset, size: MapSize = 'small') {
  return generateWorld(hashSeed(seed), preset, size);
}

describe('noise', () => {
  it('is deterministic and stays in [-1, 1]', () => {
    const a = createNoise2D(createRng(1));
    const b = createNoise2D(createRng(1));
    const c = createNoise2D(createRng(2));
    let differs = false;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37;
      const y = i * 0.91;
      const v = a(x, y);
      expect(v).toBe(b(x, y));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(fbm(a, x, y, 4))).toBeLessThanOrEqual(1);
      if (v !== c(x, y)) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('is continuous (neighbouring samples are close)', () => {
    const n = createNoise2D(createRng(3));
    for (let i = 0; i < 200; i++) expect(Math.abs(n(i * 0.1, 5) - n(i * 0.1 + 0.001, 5))).toBeLessThan(0.02);
  });
});

describe('determinism', () => {
  it.each(MAP_PRESETS)('%s: same seed gives a bit-identical world, other seeds differ', (preset) => {
    const a = gen('same', preset, 'medium');
    const b = gen('same', preset, 'medium');
    expect(b).toEqual(a);
    expect(JSON.stringify(b.world)).toBe(JSON.stringify(a.world));
    const c = gen('other', preset, 'medium');
    expect(c.world.terrain).not.toEqual(a.world.terrain);
  });

  it('createGame is identical for identical options and differs between presets', () => {
    const base = { seed: 'determinism', preset: 'continent' as MapPreset, mapSize: 'small' as MapSize, colonyName: 'X', difficulty: 'normal' as const };
    expect(createGame(base)).toEqual(createGame(base));
    expect(createGame({ ...base, preset: 'highlands' }).world.terrain).not.toEqual(createGame(base).world.terrain);
  });
});

describe('tile layers', () => {
  it.each(MAP_SIZES)('%s map: arrays, elevation and resources follow the contract', (mapSize) => {
    for (const preset of MAP_PRESETS) {
      const { world } = gen('layers', preset, mapSize);
      const n = MAP_DIMENSIONS[mapSize] ** 2;
      expect(world.width * world.height).toBe(n);
      for (const arr of [world.terrain, world.elevation, world.resource, world.building]) expect(arr).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        const t = world.terrain[i]!;
        const e = world.elevation[i]!;
        const r = world.resource[i]!;
        expect(Number.isInteger(e) && e >= 0 && e <= MAX_ELEVATION).toBe(true);
        expect(world.building[i]).toBe(0);
        if (t <= Terrain.ShallowWater || t === Terrain.Sand) expect(e).toBe(0);
        if (t === Terrain.Forest) {
          expect(r).toBeGreaterThanOrEqual(Math.floor(TILE_RESOURCE_START.forestWood * 0.55));
          expect(r).toBeLessThanOrEqual(TILE_RESOURCE_START.forestWood);
        } else if (t === Terrain.Hills) {
          expect(e).toBeGreaterThanOrEqual(2);
          expect(r).toBeGreaterThan(0);
        } else if (t === Terrain.Mountain) {
          expect(e).toBeGreaterThanOrEqual(4);
          expect(r).toBeGreaterThan(0);
        } else {
          expect(r).toBe(0);
        }
      }
    }
  });

  it('has varied terrain: every terrain appears and forests have a spread of tree densities', () => {
    for (const preset of MAP_PRESETS) {
      const { world } = gen('variety', preset, 'medium');
      for (const t of Object.values(Terrain)) expect(world.terrain).toContain(t);
      const woods = new Set<number>();
      world.terrain.forEach((t, i) => t === Terrain.Forest && woods.add(world.resource[i]!));
      expect(woods.size).toBeGreaterThan(5);
    }
  });

  it('forests are clustered rather than scattered', () => {
    const { world } = gen('cluster', 'continent', 'medium');
    let forest = 0;
    let withForestNeighbour = 0;
    for (let y = 1; y < world.height - 1; y++) {
      for (let x = 1; x < world.width - 1; x++) {
        if (world.terrain[y * world.width + x] !== Terrain.Forest) continue;
        forest++;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (world.terrain[(y + dy) * world.width + x + dx] === Terrain.Forest) n++;
        if (n >= 4) withForestNeighbour++;
      }
    }
    expect(withForestNeighbour / forest).toBeGreaterThan(0.8);
  });

  it('terrain shares are near the Appendix A targets', () => {
    const targets: Record<MapPreset, { forest: number; hills: number; mountain: number }> = {
      continent: { forest: 0.25, hills: 0.12, mountain: 0.05 },
      archipelago: { forest: 0.25, hills: 0.08, mountain: 0.02 },
      highlands: { forest: 0.2, hills: 0.3, mountain: 0.15 },
      riverValley: { forest: 0.25, hills: 0.12, mountain: 0.1 },
    };
    for (const preset of MAP_PRESETS) {
      const worlds = seeds(4, 'share').map((s) => gen(s, preset, 'medium').world);
      const t = targets[preset];
      expect(Math.abs(mean(worlds.map((w) => landShare(w, Terrain.Forest))) - t.forest)).toBeLessThan(0.05);
      expect(Math.abs(mean(worlds.map((w) => landShare(w, Terrain.Hills))) - t.hills)).toBeLessThan(0.04);
      expect(Math.abs(mean(worlds.map((w) => landShare(w, Terrain.Mountain))) - t.mountain)).toBeLessThan(0.04);
    }
  });
});

describe('preset character', () => {
  const sample = (preset: MapPreset) => seeds(6, 'char').map((s) => gen(s, preset, 'medium').world);

  it('archipelago has far more water than continent, and highlands the least', () => {
    const water = (preset: MapPreset) => mean(sample(preset).map((w) => share(w, Terrain.DeepWater, Terrain.ShallowWater)));
    expect(water('archipelago')).toBeGreaterThan(0.5);
    expect(water('archipelago')).toBeGreaterThan(water('continent') + 0.15);
    expect(water('continent')).toBeGreaterThan(0.2);
    expect(water('continent')).toBeLessThan(0.4);
    expect(water('highlands')).toBeLessThan(0.15);
  });

  it('continent is a single landmass ringed by ocean', () => {
    for (const world of sample('continent')) {
      const lands = landComponents(world);
      expect(Math.max(...lands.sizes) / lands.sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.99);
      for (let k = 0; k < world.width; k++) {
        expect(world.terrain[k]).toBeLessThanOrEqual(Terrain.ShallowWater);
        expect(world.terrain[(world.height - 1) * world.width + k]).toBeLessThanOrEqual(Terrain.ShallowWater);
        expect(world.terrain[k * world.width]).toBeLessThanOrEqual(Terrain.ShallowWater);
        expect(world.terrain[k * world.width + world.width - 1]).toBeLessThanOrEqual(Terrain.ShallowWater);
      }
    }
  });

  it('archipelago has several islands joined by walkable fords, and a big start island', () => {
    for (const s of seeds(6, 'isl')) {
      const { world, townCenter } = gen(s, 'archipelago', 'medium');
      const lands = landComponents(world);
      expect(lands.sizes.filter((n) => n >= 30).length).toBeGreaterThanOrEqual(4);
      // Every island of a real size is in the same walkable region as the start (fords).
      const walk = getWalkRegions(world);
      const startRegion = walk.labels[(townCenter.y + 1) * world.width + townCenter.x + 1]!;
      lands.sizes.forEach((size, c) => {
        if (size < 30) return;
        const i = lands.labels.findIndex((l) => l === c);
        expect(walk.labels[i]).toBe(startRegion);
      });
      expect(evaluateStartSite(world, townCenter).landTiles).toBeGreaterThanOrEqual(START_SITE.minLandTiles);
    }
  });

  it('highlands has more hills and mountains than the other presets, plus lakes', () => {
    const rugged = (preset: MapPreset) => mean(sample(preset).map((w) => landShare(w, Terrain.Hills, Terrain.Mountain)));
    const h = rugged('highlands');
    expect(h).toBeGreaterThan(0.35);
    for (const other of ['continent', 'archipelago', 'riverValley'] as const) expect(h).toBeGreaterThan(rugged(other) + 0.1);
    for (const w of sample('highlands')) expect(share(w, Terrain.ShallowWater)).toBeGreaterThan(0.01);
  });

  it('riverValley has a connected river across the map and mountains on both sides', () => {
    for (const world of seeds(8, 'river').map((s) => gen(s, 'riverValley', 'medium').world)) {
      const { width: W, height: H } = world;
      const water = labelRegions(W, H, (i) => (world.terrain[i] as number) <= Terrain.ShallowWater);
      const touches = (c: number, test: (x: number, y: number) => boolean) => {
        for (let i = 0; i < W * H; i++) if (water.labels[i] === c && test(i % W, Math.floor(i / W))) return true;
        return false;
      };
      let horizontal = false;
      let vertical = false;
      for (let c = 0; c < water.sizes.length; c++) {
        if (touches(c, (x) => x === 0) && touches(c, (x) => x === W - 1)) horizontal = true;
        if (touches(c, (_, y) => y === 0) && touches(c, (_, y) => y === H - 1)) vertical = true;
      }
      expect(horizontal || vertical).toBe(true);
      expect(share(world, Terrain.DeepWater)).toBeGreaterThan(0.02);
      // Mountains in both outer quarters across the river.
      const across = (i: number) => (horizontal ? Math.floor(i / W) / H : (i % W) / W);
      let low = 0;
      let high = 0;
      world.terrain.forEach((t, i) => {
        if (t !== Terrain.Mountain) return;
        if (across(i) < 0.25) low++;
        if (across(i) > 0.75) high++;
      });
      expect(low).toBeGreaterThan(20);
      expect(high).toBeGreaterThan(20);
      // Fords: the river can be crossed on foot, so both banks are one walkable region.
      const walk = getWalkRegions(world);
      expect(Math.max(...walk.sizes) / walk.sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.95);
    }
  });
});

describe('start site', () => {
  const cases = MAP_PRESETS.flatMap((preset) => seeds(50, `start-${preset}`).map((seed, i) => ({ preset, seed, size: MAP_SIZES[i % 3] as MapSize })));

  it('is valid on every preset for 50 seeds each (sizes rotate)', () => {
    let fallbacks = 0;
    for (const { preset, seed, size } of cases) {
      const generated = gen(seed, preset, size);
      if (generated.usedFallback) fallbacks++;
      const report = evaluateStartSite(generated.world, generated.townCenter);
      expect(report.failures, `${preset} ${seed} ${size}`).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.forestNear).toBeGreaterThanOrEqual(10);
      expect(report.stoneNear).toBeGreaterThanOrEqual(3);
      expect(report.grassNear).toBeGreaterThanOrEqual(40);
      expect(report.waterNear).toBeGreaterThanOrEqual(1);
      expect(report.lumberSite).not.toBeNull();
      expect(report.mineSite).not.toBeNull();
    }
    // The fallback stamp is a safety net, not the normal path.
    expect(fallbacks).toBeLessThanOrEqual(2);
  });

  it('createGame puts the town center and five founders on the start site', () => {
    for (const { preset, seed, size } of cases.filter((_, i) => i % 5 === 0)) {
      const state = createGame({ seed, preset, mapSize: size, colonyName: 'T', difficulty: 'normal' });
      const tc = state.buildings[0]!;
      expect(tc.type).toBe('townCenter');
      const { world } = state;
      for (let y = tc.origin.y; y < tc.origin.y + 3; y++) {
        for (let x = tc.origin.x; x < tc.origin.x + 3; x++) {
          expect([Terrain.Grass, Terrain.Sand]).toContain(world.terrain[y * world.width + x]);
          expect(world.building[y * world.width + x]).toBe(tc.id);
        }
      }
      expect(state.settlers).toHaveLength(5);
      const keys = new Set<string>();
      for (const s of state.settlers) {
        const tx = Math.floor(s.pos.x);
        const ty = Math.floor(s.pos.y);
        keys.add(`${tx},${ty}`);
        const adjacent = tx >= tc.origin.x - 1 && tx <= tc.origin.x + 3 && ty >= tc.origin.y - 1 && ty <= tc.origin.y + 3;
        expect(adjacent).toBe(true);
        expect(world.building[ty * world.width + tx]).toBe(0);
        expect(sameWalkRegion(world, ty * world.width + tx, (tc.origin.y + 1) * world.width + tc.origin.x + 1)).toBe(true);
      }
      expect(keys.size).toBe(5);
    }
  });

  it('the hand-stamped fallback pad is always valid, even in open ocean', () => {
    const size = MAP_DIMENSIONS.small;
    const n = size * size;
    const world: WorldState = {
      width: size,
      height: size,
      terrain: new Array<number>(n).fill(Terrain.DeepWater),
      elevation: new Array<number>(n).fill(0),
      resource: new Array<number>(n).fill(0),
      building: new Array<number>(n).fill(0),
      revision: 0,
    };
    stampStartPad(world, size / 2, size / 2);
    expect(evaluateStartSite(world, { x: size / 2 - 1, y: size / 2 - 1 }).failures).toEqual([]);
  });

  it('evaluateStartSite rejects bad sites', () => {
    const { world } = gen('reject', 'continent', 'small');
    expect(evaluateStartSite(world, { x: 0, y: 0 }).ok).toBe(false);
    expect(evaluateStartSite(world, { x: 3, y: 3 }).ok).toBe(false);
  });
});

describe('founders', () => {
  it('follow the GAME_DESIGN §3 spawn rules across many seeds', () => {
    const founderSpecialties = ['farming', 'construction', 'woodcutting'] as const;
    for (const seed of seeds(40, 'founders')) {
      const state: GameState = createGame({ seed, preset: 'continent', mapSize: 'small', colonyName: 'F', difficulty: 'normal' });
      expect(new Set(state.settlers.map((s) => s.name)).size).toBe(5);
      expect(new Set(state.settlers.map((s) => s.name.split(' ')[0])).size).toBe(5);
      state.settlers.forEach((s, i) => {
        expect(s.traits.length).toBeGreaterThanOrEqual(1);
        expect(s.traits.length).toBeLessThanOrEqual(2);
        for (const [a, b] of TRAIT_EXCLUSIVE_PAIRS) expect(s.traits.includes(a) && s.traits.includes(b)).toBe(false);
        expect(new Set(s.traits).size).toBe(s.traits.length);
        expect(s.needs.hunger).toBeGreaterThanOrEqual(70);
        expect(s.needs.hunger).toBeLessThanOrEqual(90);
        expect(s.needs.energy).toBeGreaterThanOrEqual(80);
        expect(s.needs.energy).toBeLessThanOrEqual(100);
        expect(s.needs.happiness).toBe(65);
        expect(s.needs.health).toBe(100);
        const levels = Object.values(s.skills);
        expect(Math.min(...levels)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...levels)).toBeGreaterThanOrEqual(5);
        expect(Math.max(...levels)).toBeLessThanOrEqual(10);
        const specialty = founderSpecialties[i];
        if (specialty) expect(s.skills[specialty]).toBeGreaterThanOrEqual(5);
        if (specialty) expect(s.skills[specialty]).toBeLessThanOrEqual(7);
      });
      expect(state.settlers.filter((s) => s.traits.includes('lazy')).length).toBeLessThanOrEqual(1);
      expect(state.settlers.filter((s) => s.traits.includes('gloomy')).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('walk grid', () => {
  it('caches regions per world revision', () => {
    const { world } = gen('regions', 'continent', 'small');
    const a = getWalkRegions(world);
    expect(getWalkRegions(world)).toBe(a);
    world.revision++;
    expect(getWalkRegions(world)).not.toBe(a);
  });
});

describe('performance', () => {
  it('generates the largest map well under 300 ms', () => {
    for (const preset of MAP_PRESETS) {
      generateWorld(hashSeed('warm'), preset, 'large');
      const times: number[] = [];
      for (const s of seeds(5, 'perf')) {
        const t0 = performance.now();
        generateWorld(hashSeed(s), preset, 'large');
        times.push(performance.now() - t0);
      }
      expect(Math.max(...times), `${preset} ${times.map((t) => t.toFixed(0)).join(',')}`).toBeLessThan(300);
    }
  });
});
