import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  applyCommand,
  canPlaceBuilding,
  createGame,
  getResidents,
  getWorkers,
  stepGame,
  validateGameState,
  type GameState,
  type MapPreset,
  type SimEvent,
} from '../../src/sim';
import { createRng } from '../../src/sim/rng';
import { createNameRegistry, createSettler } from '../../src/sim/settlerGen';
import { assertInvariants } from '../../src/sim/testSupport';
import { TICKS_PER_SECOND } from '../../src/sim';
import { REAL_SECONDS_PER_GAME_DAY } from '../../src/sim/balance';

// Several tests here are heavy (many generations or thousands of ticks); allow for a loaded CI machine.
vi.setConfig({ testTimeout: 60_000 });

const TICKS_PER_DAY = REAL_SECONDS_PER_GAME_DAY * TICKS_PER_SECOND;

function game(seed = 'settlers', preset: MapPreset = 'continent'): GameState {
  return createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed, preset });
}

/** Run ticks, checking invariants every `every` ticks; returns every event. */
function run(state: GameState, ticks: number, every = 50): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    events.push(...stepGame(state));
    if (i % every === 0) assertInvariants(state);
  }
  assertInvariants(state);
  return events;
}

function spotNearTown(state: GameState, w: number, minDist = 3): { x: number; y: number } {
  const town = state.buildings[0]!;
  for (let r = minDist; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = town.origin.x + dx;
        const y = town.origin.y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const ok = canPlaceBuilding({ ...state, colony: { ...state.colony, stock: { wood: 999, stone: 999, food: 0, water: 0, tools: 0 } } }, w === 2 ? 'house' : 'farm', x, y);
        if (ok.ok) return { x, y };
      }
    }
  }
  throw new Error('no spot');
}

describe('settlers left alone for two days', () => {
  it('eat, sleep at night, gather, and keep their needs sane', () => {
    const state = game();
    const foodStart = state.colony.stock.food;
    const woodStart = state.colony.stock.wood;
    let sleepersAtNight = 0;
    let nightSamples = 0;
    let minHealth = 100;
    let minHunger = 100;
    const kindsSeen = new Set<string>();
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
      stepGame(state);
      if (i % 25 === 0) assertInvariants(state);
      for (const s of state.settlers) {
        kindsSeen.add(s.activity.kind);
        minHealth = Math.min(minHealth, s.needs.health);
        minHunger = Math.min(minHunger, s.needs.hunger);
      }
      const h = state.time.timeOfDay;
      if (i % 50 === 0 && (h >= 23 || h < 3)) {
        nightSamples += state.settlers.length;
        sleepersAtNight += state.settlers.filter((s) => s.activity.kind === 'sleeping').length;
      }
    }
    expect(state.settlers).toHaveLength(5);
    expect(state.colony.stock.food).toBeLessThan(foodStart); // they ate
    expect(state.stats.totalConsumed.food).toBeGreaterThan(5);
    expect(state.stats.totalProduced.wood + state.stats.totalProduced.stone).toBeGreaterThan(20); // they gathered
    expect(state.colony.stock.wood).toBeGreaterThan(woodStart);
    expect(sleepersAtNight / nightSamples).toBeGreaterThan(0.6); // they sleep at night
    expect(minHealth).toBeGreaterThan(90);
    expect(minHunger).toBeGreaterThan(0);
    for (const kind of ['walking', 'eating', 'sleeping', 'chopping', 'carrying']) expect(kindsSeen).toContain(kind);
    for (const s of state.settlers) {
      expect(s.needs.energy).toBeGreaterThan(10);
      expect(s.needs.happiness).toBeGreaterThan(30);
    }
  });

  it('gather wood by depleting forest tiles and report events', () => {
    const state = game('wood-events');
    const woodTiles = () => state.world.resource.reduce((a, r, i) => a + (state.world.terrain[i] === 4 ? r : 0), 0);
    const before = woodTiles();
    const events = run(state, TICKS_PER_DAY, 100);
    expect(woodTiles()).toBeLessThan(before);
    expect(events.some((e) => e.type === 'resourceGathered' && e.resource === 'wood')).toBe(true);
    expect(events.some((e) => e.type === 'tileChanged')).toBe(true);
    expect(events.some((e) => e.type === 'resourceDelivered')).toBe(true);
  });

  it('labels always match the activity kind (checked every 5 ticks for a day on all presets)', () => {
    for (const preset of ['continent', 'archipelago', 'highlands', 'riverValley'] as const) {
      const state = game('labels-' + preset, preset);
      run(state, TICKS_PER_DAY, 5);
    }
  });
});

describe('survival', () => {
  it('starvation kills when there is no food', () => {
    const state = game('starve');
    state.colony.stock.food = 0;
    const events: SimEvent[] = [];
    let firstDeath = -1;
    for (let i = 0; i < TICKS_PER_DAY * 8 && state.settlers.length > 0; i++) {
      events.push(...stepGame(state));
      if (firstDeath < 0 && state.stats.deaths > 0) firstDeath = i;
      if (i % 100 === 0) assertInvariants(state);
    }
    expect(state.stats.deaths).toBeGreaterThan(0);
    const days = firstDeath / TICKS_PER_DAY;
    expect(days).toBeGreaterThan(1.5); // design: about 2.7 days after food runs out
    expect(days).toBeLessThan(4.5);
    const died = events.filter((e) => e.type === 'settlerDied');
    expect(died.length).toBeGreaterThan(0);
    expect(['starvation', 'thirst']).toContain((died[0] as Extract<SimEvent, { type: 'settlerDied' }>).cause);
    expect(state.colony.graveyard).toHaveLength(state.stats.deaths);
    expect(events.some((e) => e.type === 'needCritical' && e.need === 'hunger')).toBe(true);
    // Colony eventually lost when nobody is left.
    expect(state.settlers.length === 0 ? state.outcome.status : 'lost').toBe('lost');
    assertInvariants(state);
  });

  it('thirst also kills, and being lost freezes the simulation', () => {
    const state = game('thirst');
    state.colony.stock.food = 150;
    state.colony.stock.water = 0;
    run(state, TICKS_PER_DAY * 8, 200);
    expect(state.settlers).toHaveLength(0);
    expect(state.outcome.status).toBe('lost');
    expect(state.outcome.reason).toContain('lasted');
    const tick = state.time.tick;
    stepGame(state);
    expect(state.time.tick).toBe(tick);
    expect(state.colony.graveyard.map((g) => g.cause)).toContain('thirst');
  });

  it('critical hunger interrupts sleep', () => {
    const state = game('wake');
    state.time.timeOfDay = 2;
    for (const s of state.settlers) {
      s.needs.energy = 30;
    }
    run(state, 400);
    expect(state.settlers.some((s) => s.activity.kind === 'sleeping')).toBe(true);
    const sleeper = state.settlers.find((s) => s.activity.kind === 'sleeping')!;
    sleeper.needs.hunger = 10;
    let woke = false;
    for (let i = 0; i < 200 && !woke; i++) {
      stepGame(state);
      woke = sleeper.task.kind === 'eat';
    }
    expect(woke).toBe(true);
    expect(sleeper.activity.kind).not.toBe('sleeping');
    run(state, 150);
    expect(sleeper.needs.hunger).toBeGreaterThan(20);
  });

  it('exhausted settlers collapse and sleep on the spot', () => {
    const state = game('collapse');
    const s = state.settlers[0]!;
    s.needs.energy = 3;
    run(state, 30);
    expect(s.activity.kind).toBe('sleeping');
    expect(s.activity.label).toBe('Sleeping by the campfire');
    expect(s.needs.energy).toBeGreaterThan(3);
  });

  it('badly hurt settlers rest until health recovers', () => {
    const state = game('rest');
    const s = state.settlers[1]!;
    s.needs.health = 20;
    run(state, 60);
    expect(s.activity.kind).toBe('resting');
    run(state, TICKS_PER_DAY / 2);
    expect(s.needs.health).toBeGreaterThanOrEqual(50);
  });

  it('desperately unhappy settlers eventually leave', () => {
    const state = game('desert');
    state.settlers[0]!.moodlets.push({ id: 'testDespair', value: -100, hoursLeft: 2000 });
    const name = state.settlers[0]!.name;
    const events = run(state, TICKS_PER_DAY * 4, 200);
    expect(events.some((e) => e.type === 'settlerLeft' && e.name === name)).toBe(true);
    expect(state.settlers.some((s) => s.name === name)).toBe(false);
    expect(state.colony.usedNames).toContain(name);
    assertInvariants(state);
  });
});

describe('soak', () => {
  it.each(['continent', 'archipelago', 'highlands', 'riverValley'] as const)('%s: a developing colony stays valid for 3 days', (preset) => {
    const state = createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed: 'soak-' + preset, preset, difficulty: 'relaxed' });
    const town = state.buildings[0]!.origin;
    const order = ['house', 'lumberCamp', 'mine', 'farm', 'well', 'house'] as const;
    let next = 0;
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
      if (i % 200 === 0 && next < order.length) {
        let placed = false;
        for (let r = 3; r < 14 && !placed; r++) {
          for (let dy = -r; dy <= r && !placed; dy++) {
            for (let dx = -r; dx <= r && !placed; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              placed = applyCommand(state, { type: 'placeBuilding', buildingType: order[next]!, x: town.x + dx, y: town.y + dy }).ok;
            }
          }
        }
        next++;
      }
      stepGame(state);
      if (i % 40 === 0) assertInvariants(state);
    }
    expect(state.buildings.filter((b) => b.status === 'complete').length).toBeGreaterThanOrEqual(5);
    expect(state.settlers).toHaveLength(5);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('construction and references', () => {
  it('builds a house: builders walk over, finish it, and a homeless founder moves in', () => {
    const state = game('build-house');
    const homeless = state.settlers.filter((s) => s.homeId === null);
    expect(homeless).toHaveLength(1);
    const spot = spotNearTown(state, 2);
    const placed = applyCommand(state, { type: 'placeBuilding', buildingType: 'house', ...spot });
    expect(placed.ok).toBe(true);
    const id = placed.ok ? placed.entityId! : 0;
    let sawBuilders = 0;
    const events: SimEvent[] = [];
    for (let i = 0; i < TICKS_PER_DAY && state.buildings.find((b) => b.id === id)?.status !== 'complete'; i++) {
      events.push(...stepGame(state));
      sawBuilders = Math.max(sawBuilders, getWorkers(state, id).length);
      if (i % 25 === 0) assertInvariants(state);
    }
    const house = state.buildings.find((b) => b.id === id)!;
    expect(house.status).toBe('complete');
    expect(house.construction).toBeNull();
    expect(sawBuilders).toBeGreaterThan(0);
    expect(sawBuilders).toBeLessThanOrEqual(BUILDING_DEFS.house.maxBuilders);
    expect(events.filter((e) => e.type === 'buildingCompleted')).toHaveLength(1);
    expect(state.stats.buildingsCompleted).toBe(1);
    expect(getResidents(state, id).map((s) => s.id)).toEqual([homeless[0]!.id]);
    expect(getWorkers(state, id)).toHaveLength(0);
    // The new resident sleeps in the house at night.
    state.time.timeOfDay = 22;
    const sleeper = homeless[0]!;
    sleeper.task = { kind: 'idle', phase: 'working', progress: 0 };
    sleeper.path = [];
    sleeper.workplaceId = null;
    sleeper.needs.energy = 20;
    run(state, 600);
    expect(sleeper.activity.label).toBe(`Sleeping in House #${id}`);
  });

  it('a repair completes with buildingRepaired, is not cancellable, and does not count as a new building', () => {
    const state = game('repair');
    const spot = spotNearTown(state, 2);
    const placed = applyCommand(state, { type: 'placeBuilding', buildingType: 'house', ...spot });
    const id = placed.ok ? placed.entityId! : 0;
    run(state, TICKS_PER_DAY);
    const house = state.buildings.find((b) => b.id === id)!;
    expect(house.status).toBe('complete');
    const completedBefore = state.stats.buildingsCompleted;
    // What a storm will do in M5: back to construction, 70% built, nothing required.
    house.status = 'construction';
    house.construction = {
      kind: 'repair',
      progress: 0.7,
      workDone: 0.7 * BUILDING_DEFS.house.buildHours,
      required: { wood: 0, stone: 0, food: 0, water: 0, tools: 0 },
      delivered: { wood: 0, stone: 0, food: 0, water: 0, tools: 0 },
    };
    expect(applyCommand(state, { type: 'cancelBuilding', buildingId: id })).toMatchObject({ ok: false, error: 'invalidState' });
    const events = run(state, TICKS_PER_DAY / 2);
    expect(house.status).toBe('complete');
    expect(events.some((e) => e.type === 'buildingRepaired' && e.buildingId === id)).toBe(true);
    expect(events.some((e) => e.type === 'buildingCompleted')).toBe(false);
    expect(state.stats.buildingsCompleted).toBe(completedBefore);
  });

  it('cancelling a site mid-build frees its builders and leaves no dangling references', () => {
    const state = game('cancel');
    const spot = spotNearTown(state, 3);
    const placed = applyCommand(state, { type: 'placeBuilding', buildingType: 'farm', ...spot });
    const id = placed.ok ? placed.entityId! : 0;
    for (let i = 0; i < 2000 && getWorkers(state, id).length === 0; i++) stepGame(state);
    expect(getWorkers(state, id).length).toBeGreaterThan(0);
    const wood = state.colony.stock.wood;
    expect(applyCommand(state, { type: 'cancelBuilding', buildingId: id }).ok).toBe(true);
    expect(state.colony.stock.wood).toBe(wood + (BUILDING_DEFS.farm.cost.wood ?? 0)); // delivered materials refunded
    expect(state.settlers.every((s) => s.workplaceId !== id && s.task.kind !== 'construct')).toBe(true);
    assertInvariants(state);
    run(state, 400);
  });

  it('demolishing a house makes residents homeless again and clears their tasks', () => {
    const state = game('demolish');
    const spot = spotNearTown(state, 2);
    const placed = applyCommand(state, { type: 'placeBuilding', buildingType: 'house', ...spot });
    const id = placed.ok ? placed.entityId! : 0;
    run(state, TICKS_PER_DAY);
    expect(getResidents(state, id)).toHaveLength(1);
    expect(applyCommand(state, { type: 'demolishBuilding', buildingId: id }).ok).toBe(true);
    expect(getResidents(state, id)).toHaveLength(0);
    expect(state.settlers.filter((s) => s.homeId === null)).toHaveLength(1);
    assertInvariants(state);
  });

  it('placing a building on a settler or on a walking path makes them step aside and repath', () => {
    const state = game('block');
    run(state, 200);
    const town = state.buildings[0]!;
    // Build right next to the town center, on a tile where a settler currently stands if possible.
    let placedCount = 0;
    for (const s of state.settlers) {
      const x = Math.floor(s.pos.x);
      const y = Math.floor(s.pos.y);
      const r = applyCommand(state, { type: 'placeBuilding', buildingType: 'well', x, y });
      if (r.ok) placedCount++;
      assertInvariants(state);
    }
    expect(placedCount).toBeGreaterThan(0);
    expect(town.id).toBeGreaterThan(0);
    run(state, TICKS_PER_DAY / 2);
    expect(state.settlers.every((s) => Number.isFinite(s.pos.x))).toBe(true);
  });

  it('workers and residents are derived from the settlers, not stored on buildings', () => {
    const state = game('derived');
    const tc = state.buildings[0]!;
    expect('workerIds' in tc).toBe(false);
    expect('residentIds' in tc).toBe(false);
    expect(getResidents(state, tc.id)).toHaveLength(4);
  });
});

describe('determinism and saves', () => {
  it('a state saved and reloaded mid-path and mid-task evolves identically', () => {
    const state = game('saveload');
    let midPath = false;
    let midTask = false;
    for (let i = 0; i < 1200; i++) {
      stepGame(state);
      if (state.settlers.some((s) => s.path.length > 0)) midPath = true;
      if (state.settlers.some((s) => s.task.kind === 'gather' && s.task.phase === 'working' && s.carrying !== null)) midTask = true;
    }
    expect(midPath).toBe(true);
    expect(midTask).toBe(true);
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(copy).toEqual(state);
    expect(validateGameState(copy).ok).toBe(true);
    const a: SimEvent[] = [];
    const b: SimEvent[] = [];
    for (let i = 0; i < 2500; i++) {
      a.push(...stepGame(state));
      b.push(...stepGame(copy));
    }
    expect(copy).toEqual(state);
    expect(b).toEqual(a);
  });

  it('is deterministic across fresh games, with commands in the mix', () => {
    const make = () => {
      const state = game('det-cmd');
      const spot = spotNearTown(state, 2);
      for (let i = 0; i < 1500; i++) {
        if (i === 200) applyCommand(state, { type: 'placeBuilding', buildingType: 'house', ...spot });
        if (i === 900) applyCommand(state, { type: 'setPriority', category: 'woodcutting', level: 3 });
        stepGame(state);
      }
      return state;
    };
    expect(make()).toEqual(make());
  });

  it('the clock does not drift: after 60 days it reads exactly 06:00', () => {
    const state = game('clock');
    state.time.tick = TICKS_PER_DAY * 60 - 1;
    stepGame(state);
    expect(state.time.day).toBe(61);
    expect(state.time.timeOfDay).toBeCloseTo(6, 6);
  });
});

describe('performance', () => {
  it('30 settlers on a large map step in well under 0.5 ms per tick', () => {
    const state = createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed: 'perf30', mapSize: 'large' });
    const town = state.buildings[0]!;
    const names = createNameRegistry(state.colony.usedNames);
    const rng = createRng(77);
    const ring: { x: number; y: number }[] = [];
    for (let dx = -1; dx <= 3; dx++) for (const dy of [-1, 3]) ring.push({ x: town.origin.x + dx, y: town.origin.y + dy });
    while (state.settlers.length < 30) {
      const p = ring[state.settlers.length % ring.length]!;
      const s = createSettler(state, rng, { x: p.x + 0.5, y: p.y + 0.5 }, {
        difficulty: 'normal',
        names,
        specialty: null,
        bannedTraits: new Set(),
        newcomerDays: 3,
      });
      state.colony.usedNames.push(s.name);
      state.settlers.push(s);
    }
    state.colony.stock.food = 150;
    state.colony.stock.water = 150;
    for (let i = 0; i < 300; i++) stepGame(state); // warm-up
    const t0 = performance.now();
    const ticks = TICKS_PER_DAY;
    for (let i = 0; i < ticks; i++) {
      if (i % 600 === 0) {
        state.colony.stock.food = 150;
        state.colony.stock.water = 150;
      }
      stepGame(state);
    }
    const perTick = (performance.now() - t0) / ticks;
    console.info(`30 settlers, large map: ${perTick.toFixed(3)} ms/tick`);
    expect(perTick).toBeLessThan(0.5);
    assertInvariants(state);
  });
});
