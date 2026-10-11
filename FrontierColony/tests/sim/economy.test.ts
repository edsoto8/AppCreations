import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  MAP_PRESETS,
  TOOLS,
  applyCommand,
  canPlaceBuilding,
  createGame,
  getAvailableStock,
  getStorageCapacity,
  getWorkers,
  stepGame,
  type BuildingType,
  type GameState,
  type SimEvent,
} from '../../src/sim';
import { makeContext, workSpeedMult } from '../../src/sim/needs';
import { accessGoal, findPath } from '../../src/sim/pathfinding';
import { createRng } from '../../src/sim/rng';
import { createNameRegistry, createSettler } from '../../src/sim/settlerGen';
import { assertInvariants } from '../../src/sim/testSupport';
import { placeNearTown, playScript, type ScriptItem } from './support/player';

vi.setConfig({ testTimeout: 120_000 });

const TICKS_PER_DAY = 1800;

/** The scripted "sensible player" of GAME_DESIGN §1: the four essentials on day 1, the rest a few days later. */
const SENSIBLE: ScriptItem[] = [
  { day: 1, type: 'farm' },
  { day: 1, type: 'well' },
  { day: 1, type: 'house' },
  { day: 1, type: 'lumberCamp' },
  { day: 3, type: 'mine' },
  { day: 4, type: 'storage' },
  { day: 4, type: 'workshop' },
  { day: 5, type: 'house' },
];

function game(seed = 'economy-x'): GameState {
  return createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed });
}

/** Force a building straight to 'complete' (test shortcut), returns it. */
function instantBuild(state: GameState, type: BuildingType): GameState['buildings'][number] {
  const id = placeNearTown(state, type);
  expect(id, `could not place ${type}`).not.toBeNull();
  const b = state.buildings.find((x) => x.id === id)!;
  b.status = 'complete';
  b.construction = null;
  return b;
}

describe('balance check: a sensible player on normal difficulty', () => {
  it('builds everything and the colony is alive and stable after 16 days', () => {
    const report = playScript({ seed: 'economy-1', preset: 'continent' }, SENSIBLE, 16, [1, 3, 5, 8, 12, 16], {
      onTick: (s, t) => {
        if (t % 120 === 0) {
          assertInvariants(s);
          for (const r of ['wood', 'stone', 'food', 'water'] as const) expect(s.colony.stock[r]).toBeLessThanOrEqual(getStorageCapacity(s));
        }
      },
    });
    const s = report.state;
    expect(s.settlers.length).toBeGreaterThanOrEqual(5); // newcomers join when there are beds and food
    expect(s.outcome.status).toBe('playing');
    expect(report.minFood).toBeGreaterThan(0);
    expect(report.minWater).toBeGreaterThan(0);
    // Every building completes, within a sensible time of being ordered (hauling + building).
    expect(report.completed.map((c) => c.type).sort()).toEqual(['farm', 'house', 'house', 'lumberCamp', 'mine', 'storage', 'well', 'workshop']);
    for (const c of report.completed) {
      const days = c.doneDay - c.placedDay;
      expect(days, `${c.type} took ${days.toFixed(2)} days`).toBeGreaterThan(0.05);
      expect(days, `${c.type} took ${days.toFixed(2)} days`).toBeLessThan(2);
    }
    // The economy runs: food and water pile up past the first-house stage, tools get crafted.
    const day16 = report.checkpoints.find((c) => c.day === 16)!;
    expect(day16.stock.food).toBeGreaterThan(100);
    expect(day16.stock.water).toBeGreaterThan(40);
    expect(s.progress.toolsCrafted).toBeGreaterThan(5);
    expect(s.stats.totalProduced.food).toBeGreaterThan(s.stats.totalConsumed.food);
    for (const id of ['roof', 'bread', 'water', 'foundations', 'timber', 'toolmaker']) expect(s.progress.objectivesDone).toContain(id);
    expect(s.progress.unlocked).toEqual(expect.arrayContaining(['storage', 'workshop']));
  });

  it.each(MAP_PRESETS)('%s: the same plan also keeps a colony alive for 12 days', (preset) => {
    const report = playScript({ seed: 'economy-2', preset }, SENSIBLE, 12, []);
    expect(report.state.settlers.length).toBeGreaterThanOrEqual(5);
    expect(report.minFood).toBeGreaterThan(0);
    expect(report.minWater).toBeGreaterThan(0);
    expect(report.completed.length).toBe(8);
  });

  it('neglect (no farm) loses settlers on the design timeline', () => {
    let foodOut = -1;
    const deaths: number[] = [];
    const report = playScript(
      { seed: 'economy-1', preset: 'continent' },
      [
        { day: 1, type: 'well' },
        { day: 1, type: 'house' },
        { day: 1, type: 'lumberCamp' },
      ],
      14,
      [],
      {
        onTick: (s) => {
          const now = s.time.day + s.time.timeOfDay / 24;
          if (foodOut < 0 && s.colony.stock.food === 0) foodOut = now;
          if (deaths.length < s.stats.deaths) deaths.push(now);
        },
      },
    );
    // GAME_DESIGN §6.7 (C): food runs out around day 6-7, the first death follows ~2.7 days later (day 9-10).
    expect(foodOut).toBeGreaterThan(5); // newcomers join during the first days, so the larder empties a little sooner
    expect(foodOut).toBeLessThan(9);
    expect(deaths.length).toBeGreaterThan(0);
    expect(deaths[0]!).toBeGreaterThan(7); // newcomers join during the first days, so the larder empties a little sooner
    expect(deaths[0]!).toBeLessThan(11.5);
    expect(deaths[0]! - foodOut).toBeGreaterThan(1.5);
    expect(deaths[0]! - foodOut).toBeLessThan(4);
    expect(report.state.colony.graveyard[0]!.cause).toBe('starvation');
  });
});

describe('construction flow (GAME_DESIGN §6.6)', () => {
  it('placing reserves materials without deducting them, and refuses what the stock cannot cover', () => {
    const state = game();
    expect(state.colony.stock.wood).toBe(80);
    expect(placeNearTown(state, 'house')).not.toBeNull();
    expect(placeNearTown(state, 'house')).not.toBeNull();
    expect(state.colony.stock.wood).toBe(80); // nothing deducted yet
    expect(getAvailableStock(state).wood).toBe(20);
    expect(getAvailableStock(state).stone).toBe(10);
    // A third house needs 30 wood but only 20 are unreserved.
    const town = state.buildings[0]!.origin;
    let rejected = false;
    for (let r = 3; r < 12 && !rejected; r++) {
      const check = canPlaceBuilding(state, 'house', town.x + r, town.y + 5);
      if (check.error === 'insufficientResources') rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('the normal opening affords exactly farm + well + house + lumber camp', () => {
    const state = game();
    for (const t of ['farm', 'well', 'house', 'lumberCamp'] as const) expect(placeNearTown(state, t), t).not.toBeNull();
    expect(getAvailableStock(state)).toMatchObject({ wood: 0, stone: 5 });
  });

  it('haulers deliver materials, builders only work with delivered materials, and cancelling refunds exactly', () => {
    const state = game('cancel-refund');
    // No one gathers: the stock can only change through the build.
    applyCommand(state, { type: 'setPriority', category: 'woodcutting', level: 0 });
    applyCommand(state, { type: 'setPriority', category: 'mining', level: 0 });
    const before = { ...state.colony.stock };
    const id = placeNearTown(state, 'farm')!;
    const site = state.buildings.find((b) => b.id === id)!;
    let sawCarrying = false;
    let maxWorkAheadOfDelivery = 0;
    for (let i = 0; i < 1500 && site.construction!.delivered.wood < 20; i++) {
      stepGame(state);
      const c = site.construction!;
      if (state.settlers.some((s) => s.task.kind === 'haul' && s.carrying !== null)) sawCarrying = true;
      // Progress never runs ahead of the delivered share of the materials.
      maxWorkAheadOfDelivery = Math.max(maxWorkAheadOfDelivery, c.workDone / BUILDING_DEFS.farm.buildHours - c.delivered.wood / 20);
      expect(state.colony.stock.wood + c.delivered.wood + state.settlers.reduce((a, s) => a + (s.carrying?.amount ?? 0), 0)).toBe(before.wood);
    }
    expect(sawCarrying).toBe(true);
    expect(maxWorkAheadOfDelivery).toBeLessThanOrEqual(1e-6);
    // Cancel part-way through.
    const stopAt = state.time.tick + 60;
    while (state.time.tick < stopAt && site.status === 'construction') stepGame(state);
    if (site.status === 'construction') {
      expect(applyCommand(state, { type: 'cancelBuilding', buildingId: id }).ok).toBe(true);
      expect(state.colony.stock.wood).toBe(before.wood);
      assertInvariants(state);
    }
  });

  it('respects maxBuilders and maxWorkers while a full colony works', () => {
    const state = game('slots');
    for (const t of ['farm', 'well', 'house', 'lumberCamp', 'mine'] as const) placeNearTown(state, t);
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
      stepGame(state);
      if (i % 10 !== 0) continue;
      for (const b of state.buildings) {
        const def = BUILDING_DEFS[b.type];
        const n = getWorkers(state, b.id).length;
        if (b.status === 'construction') expect(n).toBeLessThanOrEqual(def.maxBuilders);
        else if (def.forage) expect(n).toBeLessThanOrEqual(def.forage.wood + def.forage.stone);
        else expect(n).toBeLessThanOrEqual(def.maxWorkers);
      }
    }
  });

  it('two settlers never gather from the same tile at the same time', () => {
    const state = game('reservation');
    instantBuild(state, 'lumberCamp');
    instantBuild(state, 'mine');
    let checked = 0;
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
      stepGame(state);
      if (i % 5 !== 0) continue;
      const tiles = state.settlers.flatMap((s) => (s.task.kind === 'gather' ? [`${s.task.targetTile.x},${s.task.targetTile.y}`] : []));
      expect(new Set(tiles).size).toBe(tiles.length);
      checked += tiles.length;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('production buildings', () => {
  it('a farm fills its output buffer and workers stop at the cap; hauling empties it into the stock', () => {
    const state = game('farm');
    const farm = instantBuild(state, 'farm');
    applyCommand(state, { type: 'setPriority', category: 'hauling', level: 0 });
    let maxOut = 0;
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
      stepGame(state);
      maxOut = Math.max(maxOut, farm.output.food);
    }
    expect(maxOut).toBeGreaterThan(20);
    expect(maxOut).toBeLessThanOrEqual(BUILDING_DEFS.farm.outputCap);
    expect(farm.output.food).toBe(BUILDING_DEFS.farm.outputCap);
    expect(getWorkers(state, farm.id)).toHaveLength(0); // buffer full: nothing to do here
    // With hauling on again the pile moves into the stock.
    applyCommand(state, { type: 'setPriority', category: 'hauling', level: 2 });
    const stockBefore = state.colony.stock.food;
    for (let i = 0; i < 600; i++) stepGame(state);
    expect(farm.output.food).toBeLessThan(BUILDING_DEFS.farm.outputCap);
    expect(state.colony.stock.food).toBeGreaterThan(stockBefore - 8);
    assertInvariants(state);
  });

  it('farming stops in winter and resumes in spring', () => {
    const state = game('winter');
    const farm = instantBuild(state, 'farm');
    state.time.tick = 15 * TICKS_PER_DAY - 1; // the next tick is 06:00 on day 16, the first day of winter
    stepGame(state);
    expect(state.time.season).toBe('winter');
    for (let i = 0; i < 400; i++) stepGame(state);
    expect(farm.output.food).toBe(0);
    expect(state.settlers.every((s) => s.task.kind !== 'work')).toBe(true);
    state.time.tick = 20 * TICKS_PER_DAY - 1; // day 21: spring again
    stepGame(state);
    expect(state.time.season).toBe('spring');
    for (let i = 0; i < 900; i++) stepGame(state);
    expect(farm.output.food + state.stats.totalProduced.food).toBeGreaterThan(0);
  });

  it('a well produces water, faster beside a lake', () => {
    const state = game('well');
    const well = instantBuild(state, 'well');
    for (let i = 0; i < TICKS_PER_DAY; i++) stepGame(state);
    expect(state.stats.totalProduced.water).toBeGreaterThan(5);
    expect(well.output.water + state.colony.stock.water).toBeGreaterThan(0);
  });

  it('a workshop turns 3 wood + 2 stone into a tool, and tools are only made while stock is below target', () => {
    const state = game('workshop');
    state.colony.stock.tools = 0;
    state.progress.unlocked.push('workshop');
    const shop = instantBuild(state, 'workshop');
    const events: SimEvent[] = [];
    for (let i = 0; i < TICKS_PER_DAY; i++) events.push(...stepGame(state));
    expect(state.progress.toolsCrafted).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'resourceConsumed' && e.reason === 'crafting')).toBe(true);
    // Inputs are taken when a cycle starts: 3 wood + 2 stone per tool (the cycle in progress may have paid already).
    expect(state.stats.totalConsumed.wood).toBeGreaterThanOrEqual(state.progress.toolsCrafted * 3);
    expect(state.stats.totalConsumed.wood).toBeLessThanOrEqual(state.progress.toolsCrafted * 3 + 3);
    expect(state.stats.totalConsumed.stone).toBeGreaterThanOrEqual(state.progress.toolsCrafted * 2);
    expect(shop.output.tools + state.colony.stock.tools + state.settlers.filter((s) => s.toolDurability !== null).length).toBeGreaterThan(0);
    // Stock target reached: no more crafting.
    state.colony.stock.tools = 50;
    const crafted = state.progress.toolsCrafted;
    for (let i = 0; i < 600; i++) stepGame(state);
    expect(state.progress.toolsCrafted - crafted).toBeLessThanOrEqual(1);
  });

  it('lumber camps and mines deplete nearby tiles, buffer the goods, and haulers move them to storage', () => {
    const state = game('camp');
    const camp = instantBuild(state, 'lumberCamp');
    let gathered = 0;
    let sawBuffer = false;
    let delivered = 0;
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
      for (const e of stepGame(state)) {
        if (e.type === 'resourceDelivered' && e.buildingId === state.buildings[0]!.id && e.resource === 'wood') delivered += e.amount;
        if (e.type === 'resourceGathered' && e.resource === 'wood') gathered++;
      }
      if (camp.output.wood > 0) sawBuffer = true;
    }
    expect(gathered).toBeGreaterThan(20);
    expect(sawBuffer).toBe(true);
    expect(delivered).toBeGreaterThan(5);
    expect(camp.output.wood).toBeLessThanOrEqual(BUILDING_DEFS.lumberCamp.outputCap);
  });

  it('producers go idle at the storage cap: nothing is produced beyond capacity', () => {
    const state = game('cap');
    instantBuild(state, 'lumberCamp');
    state.colony.stock.wood = getStorageCapacity(state);
    const cap = getStorageCapacity(state);
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepGame(state);
      expect(state.colony.stock.wood).toBeLessThanOrEqual(cap);
    }
    // Only the camp buffer fills; the colony stops cutting once it is full.
    const camp = state.buildings.find((b) => b.type === 'lumberCamp')!;
    expect(camp.output.wood).toBeLessThanOrEqual(30);
    const gathering = state.settlers.filter((s) => s.task.kind === 'gather' && s.task.resource === 'wood');
    expect(gathering.length).toBeLessThanOrEqual(3);
  });
});

describe('tools (GAME_DESIGN §6.4)', () => {
  it('workers take a tool from the stock, work 1.4x faster with it, and the tool wears out', () => {
    const state = game('tools');
    const first = state.colony.stock.tools;
    expect(first).toBe(5);
    for (let i = 0; i < 600; i++) stepGame(state);
    const holders = state.settlers.filter((s) => s.toolDurability !== null);
    expect(holders.length).toBeGreaterThan(0);
    expect(state.colony.stock.tools + holders.length).toBe(first);
    for (const h of holders) expect(h.toolDurability).toBeLessThanOrEqual(TOOLS.durabilityHours);

    const s = holders[0]!;
    const ctx = makeContext(state, [], 0.01, false);
    const withTool = workSpeedMult(ctx, s, 'woodcutting', 'woodcutting');
    const durability = s.toolDurability;
    s.toolDurability = null;
    const bare = workSpeedMult(ctx, s, 'woodcutting', 'woodcutting');
    expect(withTool / bare).toBeCloseTo(TOOLS.productivityMult, 9);
    s.toolDurability = durability;
  });

  it('a nearly worn tool breaks, is logged and discarded', () => {
    const state = game('tool-break');
    for (let i = 0; i < 600; i++) stepGame(state);
    const s = state.settlers.find((x) => x.toolDurability !== null && x.task.phase === 'working' && (x.task.kind === 'gather' || x.task.kind === 'construct'))!;
    expect(s).toBeDefined();
    s.toolDurability = 0.005;
    for (let i = 0; i < 20 && s.toolDurability !== null; i++) stepGame(state);
    expect(state.eventLog.some((e) => e.message === `${s.name}'s tools broke.`)).toBe(true);
  });
});

describe('progression (GAME_DESIGN §11)', () => {
  it('storage and workshop start locked, and unlock when their objectives complete', () => {
    const state = game('unlocks');
    expect(state.progress.unlocked).not.toContain('storage');
    expect(state.progress.unlocked).not.toContain('workshop');
    expect(canPlaceBuilding(state, 'storage', state.buildings[0]!.origin.x + 5, state.buildings[0]!.origin.y).error).toBe('locked');
    const events: SimEvent[] = [];
    state.colony.stock.wood = 150;
    state.colony.stock.stone = 100;
    for (const t of ['house', 'farm', 'well', 'lumberCamp', 'mine'] as const) expect(placeNearTown(state, t), t).not.toBeNull();
    for (let i = 0; i < TICKS_PER_DAY * 4; i++) events.push(...stepGame(state));
    const done = events.filter((e) => e.type === 'objectiveCompleted').map((e) => (e as Extract<SimEvent, { type: 'objectiveCompleted' }>).objectiveId);
    expect(new Set(done).size).toBe(done.length); // each only once
    expect(done).toEqual(expect.arrayContaining(['roof', 'bread', 'water', 'foundations', 'timber']));
    const unlocks = events.filter((e) => e.type === 'buildingUnlocked').map((e) => (e as Extract<SimEvent, { type: 'buildingUnlocked' }>).buildingType);
    expect(unlocks).toEqual(expect.arrayContaining(['storage', 'workshop']));
    expect(state.progress.unlocked).toEqual(expect.arrayContaining(['storage', 'workshop']));
    expect(placeNearTown(state, 'storage')).not.toBeNull();
  });
});

describe('statistics and housing', () => {
  it('hourly produced / consumed samples add up to the totals', () => {
    const state = game('stats');
    for (const t of ['farm', 'well', 'lumberCamp', 'house'] as const) placeNearTown(state, t);
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) stepGame(state);
    for (const r of ['wood', 'stone', 'food', 'water', 'tools'] as const) {
      const produced = state.stats.history.reduce((a, h) => a + h.produced[r], 0) + state.stats.producedThisHour[r];
      const consumed = state.stats.history.reduce((a, h) => a + h.consumed[r], 0) + state.stats.consumedThisHour[r];
      expect(produced).toBeCloseTo(state.stats.totalProduced[r], 6);
      expect(consumed).toBeCloseTo(state.stats.totalConsumed[r], 6);
    }
    // Meals are consumption: roughly 2 food and 2 water per settler per day.
    expect(state.stats.totalConsumed.food).toBeGreaterThan(10);
    expect(state.stats.totalConsumed.food).toBeLessThan(25);
    expect(state.stats.totalProduced.food).toBeGreaterThan(5);
  });

  it('houses give beds to the homeless, and homeless settlers sleep outdoors with a mood penalty', () => {
    const state = game('beds');
    const homeless = state.settlers.find((s) => s.homeId === null)!;
    expect(homeless).toBeDefined();
    for (let i = 0; i < TICKS_PER_DAY * 0.9; i++) stepGame(state); // until ~ 22:00 of day 1 and the first night
    for (let i = 0; i < TICKS_PER_DAY * 0.45; i++) stepGame(state);
    expect(homeless.moodlets.map((m) => m.id)).toContain('sleptOutdoors');
    const housed = state.settlers.find((s) => s.homeId !== null)!;
    expect(housed.moodlets.map((m) => m.id)).toContain('sleptInHouse');
    expect(homeless.needs.happiness).toBeLessThan(housed.needs.happiness + 0.001);
    // A house changes that.
    const id = placeNearTown(state, 'house')!;
    for (let i = 0; i < TICKS_PER_DAY && state.buildings.find((b) => b.id === id)!.status !== 'complete'; i++) stepGame(state);
    expect(homeless.homeId).toBe(id);
  });
});

describe('dense colonies', () => {
  it('placement never walls in the town center or another building, so nobody starves behind a wall', () => {
    const state = game('dense');
    state.progress.unlocked.push('storage', 'workshop');
    for (let i = 0; i < 4; i++) instantBuild(state, 'storage'); // room for a big stockpile
    state.colony.stock.wood = 600;
    state.colony.stock.stone = 300;
    const order: BuildingType[] = ['farm', 'farm', 'well', 'well', 'lumberCamp', 'mine', 'house', 'house', 'house', 'house', 'house', 'house', 'storage', 'workshop', 'lumberCamp', 'mine'];
    for (const t of order) placeNearTown(state, t, 2, 14);
    expect(state.buildings.length).toBeGreaterThan(12);
    const start = { x: Math.floor(state.settlers[0]!.pos.x), y: Math.floor(state.settlers[0]!.pos.y) };
    for (const b of state.buildings) {
      const goal = accessGoal(b.origin.x, b.origin.y, b.footprint.w, b.footprint.h);
      expect(findPath(state.world, start.x, start.y, goal, 100000), `${b.type} #${b.id} must be reachable`).not.toBeNull();
    }
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
      stepGame(state);
      if (i % 100 === 0) {
        state.colony.stock.food = Math.max(state.colony.stock.food, 100);
        state.colony.stock.water = Math.max(state.colony.stock.water, 100);
        assertInvariants(state);
      }
    }
    expect(state.settlers.length).toBeGreaterThanOrEqual(5);
    expect(state.buildings.filter((b) => b.status === 'complete').length).toBeGreaterThan(12);
  });

  it('30 settlers in a developed colony on a large map step in under 0.5 ms per tick', () => {
    const state = createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed: 'perf-econ', mapSize: 'large' });
    state.progress.unlocked.push('storage', 'workshop');
    for (let i = 0; i < 3; i++) instantBuild(state, 'storage');
    state.colony.stock.wood = 400;
    state.colony.stock.stone = 300;
    const names = createNameRegistry(state.colony.usedNames);
    const rng = createRng(5);
    const town = state.buildings[0]!;
    while (state.settlers.length < 30) {
      const x = town.origin.x + (state.settlers.length % 5) - 1;
      const y = town.origin.y + (state.settlers.length > 14 ? -1 : 3);
      const s = createSettler(state, rng, { x: x + 0.5, y: y + 0.5 }, { difficulty: 'normal', names, specialty: null, bannedTraits: new Set(), newcomerDays: 3 });
      state.colony.usedNames.push(s.name);
      state.settlers.push(s);
    }
    for (const t of ['farm', 'farm', 'well', 'well', 'lumberCamp', 'mine', 'house', 'house', 'house', 'house', 'house', 'house', 'storage', 'workshop', 'lumberCamp', 'mine'] as const) placeNearTown(state, t);
    const feed = (i: number) => {
      if (i % 300 === 0) {
        state.colony.stock.food = 140;
        state.colony.stock.water = 140;
      }
    };
    for (let i = 0; i < 3600; i++) {
      feed(i);
      stepGame(state);
    }
    const t0 = performance.now();
    const ticks = 3600;
    for (let i = 0; i < ticks; i++) {
      feed(i);
      stepGame(state);
    }
    const perTick = (performance.now() - t0) / ticks;
    expect(perTick, `${perTick.toFixed(3)} ms per tick`).toBeLessThan(0.5);
    expect(state.settlers).toHaveLength(30);
    assertInvariants(state);
  });
});
