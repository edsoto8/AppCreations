import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  GAME_HOURS_PER_TICK,
  MAP_PRESETS,
  applyCommand,
  createGame,
  getStorageCapacity,
  sameWalkRegion,
  stepGame,
  validateGameState,
  type GameState,
  type SimEvent,
} from '../../src/sim';
import { fireEvent } from '../../src/sim/events';
import { makeContext } from '../../src/sim/needs';
import { campfireSpot, shortageBonus } from '../../src/sim/settlerSim';
import { removeSettler } from '../../src/sim/stateOps';
import { assertInvariants } from '../../src/sim/testSupport';
import { placeNearTown } from './support/player';

vi.setConfig({ testTimeout: 120_000 });

const TICKS_PER_DAY = 1800;

function game(seed = 'review'): GameState {
  return createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed });
}

function instantBuild(state: GameState, type: Parameters<typeof placeNearTown>[1]) {
  const id = placeNearTown(state, type);
  expect(id, type).not.toBeNull();
  const b = state.buildings.find((x) => x.id === id)!;
  b.status = 'complete';
  b.construction = null;
  return b;
}

function run(state: GameState, ticks: number, every = 100): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    events.push(...stepGame(state));
    if (i % every === 0) assertInvariants(state);
  }
  return events;
}

describe('CRIT-1: a starving, hurt settler does not rest to death', () => {
  function famine(farms: number, buffer: number, hunger: number, health: number): GameState {
    const s = game('probe');
    s.colony.stock = { wood: 100, stone: 50, food: 0, water: 40, tools: 3 };
    for (let i = 0; i < farms; i++) instantBuild(s, 'farm').output.food = buffer;
    for (const x of s.settlers) {
      x.needs.hunger = hunger;
      x.needs.health = health;
    }
    s.time.timeOfDay = 8;
    return s;
  }

  it('critical hunger eats straight from a farm buffer (probe 1: everyone survives)', () => {
    const s = famine(1, 24, 5, 20);
    run(s, TICKS_PER_DAY * 2);
    expect(s.settlers).toHaveLength(5);
    expect(s.stats.deaths).toBe(0);
    expect(s.settlers.every((x) => x.needs.hunger > 0)).toBe(true);
  });

  it.each([
    [30, 100],
    [8, 45],
    [5, 35],
    [3, 30],
    [10, 26],
  ])('starting hunger %i and health %i with farms and food in the buffers: nobody dies', (hunger, health) => {
    for (const farms of [1, 2, 3]) {
      const s = famine(farms, 24, hunger, health);
      run(s, TICKS_PER_DAY * 2, 300);
      expect(s.stats.deaths, `${farms} farms`).toBe(0);
    }
  });

  it('even with empty buffers, working farms keep a starving colony alive', () => {
    for (const farms of [2, 3]) {
      const s = famine(farms, 0, 5, 35);
      run(s, TICKS_PER_DAY * 2, 300);
      expect(s.stats.deaths, `${farms} farms`).toBe(0);
    }
  });

  it('a hungry settler does not start resting, and a resting one gets up when it can no longer heal', () => {
    const s = game('rest-skip');
    s.colony.stock.food = 0;
    s.colony.stock.water = 0; // no drink to fall back on
    const a = s.settlers[0]!;
    a.needs.health = 20;
    a.needs.hunger = 20;
    run(s, 40);
    expect(a.task.kind).not.toBe('rest');

    const t = game('rest-wake');
    const b = t.settlers[1]!;
    b.needs.health = 20;
    b.needs.hunger = 80;
    run(t, 60);
    expect(b.task.kind).toBe('rest');
    expect(b.activity.kind).toBe('resting');
    expect(b.activity.indoorsBuildingId === null || typeof b.activity.indoorsBuildingId === 'number').toBe(true);
    b.needs.hunger = 10; // starving: resting cannot heal
    run(t, 5);
    expect(b.task.kind).not.toBe('rest');
  });
});

describe('MAJ-1: removed settlers leave no dangling references', () => {
  it('a wolves victim who dies keeps the event running without a target, and saves stay valid', () => {
    const s = game('wolves-death');
    const victim = s.settlers[2]!;
    victim.pos.x += 0; // keep in place
    s.activeEvents.push({ id: s.nextLogId++, kind: 'wolves', startedTick: 0, hoursRemaining: 24, magnitude: 1, targetId: victim.id, tile: null });
    expect(validateGameState(s).ok).toBe(true);
    victim.needs.health = 0.001;
    victim.status.dehydrated = true;
    run(s, 60);
    expect(s.settlers.find((x) => x.id === victim.id)).toBeUndefined();
    const wolves = s.activeEvents.find((e) => e.kind === 'wolves')!;
    expect(wolves.targetId).toBeNull();
    expect(validateGameState(JSON.parse(JSON.stringify(s))).ok).toBe(true);
  });

  it('a real wolf attack that kills the farthest settler leaves a valid state', () => {
    const s = game('wolves-attack');
    const far = s.settlers[1]!;
    // Move far from the town center on walkable ground.
    const town = s.buildings[0]!.origin;
    outer: for (let r = 14; r < 30; r++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = town.x + dx;
        const y = town.y + r;
        const i = y * s.world.width + x;
        if (x >= 0 && x < s.world.width && y < s.world.height && s.world.terrain[i] === 3 && s.world.building[i] === 0) {
          far.pos.x = far.prevPos.x = x + 0.5;
          far.pos.y = far.prevPos.y = y + 0.5;
          break outer;
        }
      }
    }
    far.needs.health = 30; // the 35-point bite is fatal
    fireEvent(makeContext(s, [], GAME_HOURS_PER_TICK, true), 'wolves');
    run(s, 20, 1);
    expect(s.stats.deaths).toBe(1);
    expect(validateGameState(JSON.parse(JSON.stringify(s))).ok).toBe(true);
  });

  it('removing a settler never leaves a dangling id anywhere (death, departure, many states)', () => {
    for (let n = 0; n < 6; n++) {
      const s = game('audit-' + n);
      instantBuild(s, 'house');
      s.activeEvents.push({ id: s.nextLogId++, kind: 'sickness', startedTick: 0, hoursRemaining: 20, magnitude: 1, targetId: s.settlers[n % 5]!.id, tile: null });
      run(s, 400 + n * 50);
      removeSettler(s, s.settlers[n % s.settlers.length]!.id);
      expect(validateGameState(JSON.parse(JSON.stringify(s))).ok).toBe(true);
      run(s, 200);
    }
  });
});

describe('MAJ-2: food waiting in buffers reaches the larder during a shortage', () => {
  it('settlers haul farm food to the stockpile instead of farming on', () => {
    const s = game('famine-haul');
    s.colony.stock = { wood: 50, stone: 20, food: 0, water: 60, tools: 3 };
    const farms = [instantBuild(s, 'farm'), instantBuild(s, 'farm'), instantBuild(s, 'farm')];
    farms[0]!.output.food = 24;
    farms[1]!.output.food = 18;
    farms[2]!.output.food = 8;
    for (const x of s.settlers) x.needs.hunger = 45;
    const events = run(s, TICKS_PER_DAY / 2);
    const delivered = events.filter((e) => e.type === 'resourceDelivered' && e.resource === 'food').reduce((a, e) => a + (e as Extract<SimEvent, { type: 'resourceDelivered' }>).amount, 0);
    expect(delivered).toBeGreaterThan(15);
    expect(s.stats.deaths).toBe(0);
  });

  it('small piles are worth carrying during a shortage, and tools are carried one by one', () => {
    const s = game('small-piles');
    s.colony.stock = { wood: 50, stone: 40, food: 2, water: 60, tools: 0 };
    const farm = instantBuild(s, 'farm');
    farm.output.food = 3; // below the normal minimum load of 6
    s.progress.unlocked.push('workshop');
    const shop = instantBuild(s, 'workshop');
    shop.output.tools = 2;
    for (const x of s.settlers) x.needs.hunger = 90;
    const events = run(s, TICKS_PER_DAY / 2);
    expect(events.some((e) => e.type === 'resourceDelivered' && e.resource === 'food')).toBe(true);
    expect(shop.output.tools).toBe(0);
    expect(s.colony.stock.tools + s.settlers.filter((x) => x.toolDurability !== null).length).toBeGreaterThan(0);
  });
});

describe('MIN-1 / MIN-2: nothing is destroyed silently at the storage cap', () => {
  it('gathering stops at the cap instead of throwing the goods away', () => {
    const s = game('cap-gather');
    s.colony.stock.wood = getStorageCapacity(s) - 4;
    instantBuild(s, 'lumberCamp');
    let lost = 0;
    const reasons: string[] = [];
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      for (const e of stepGame(s)) if (e.type === 'goodsLost') {
        lost += e.amount;
        reasons.push(`${e.amount} ${e.resource}: ${e.reason}`);
      }
      expect(s.colony.stock.wood).toBeLessThanOrEqual(getStorageCapacity(s));
    }
    expect(lost, reasons.join('; ')).toBeLessThanOrEqual(2);
  });

  it('cancelling a site at the cap reports the goods that no longer fit', () => {
    const s = game('cap-cancel');
    s.colony.stock.wood = 80;
    const id = placeNearTown(s, 'house')!;
    const site = s.buildings.find((b) => b.id === id)!;
    site.construction!.delivered.wood = 30; // materials already on site
    s.colony.stock.wood = getStorageCapacity(s);
    const result = applyCommand(s, { type: 'cancelBuilding', buildingId: id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events.some((e) => e.type === 'goodsLost' && e.resource === 'wood' && e.amount === 30)).toBe(true);
    expect(s.colony.stock.wood).toBe(getStorageCapacity(s));
    expect(s.eventLog.at(-1)!.message).toMatch(/lost|cancelled/);
    assertInvariants(s);
  });

  it('demolishing a storage that would overflow the stockpile is refused; with room it works', () => {
    const s = game('cap-demolish');
    s.progress.unlocked.push('storage');
    const store = instantBuild(s, 'storage');
    expect(getStorageCapacity(s)).toBe(150 + BUILDING_DEFS.storage.storage);
    s.colony.stock.wood = 250;
    const refused = applyCommand(s, { type: 'demolishBuilding', buildingId: store.id });
    expect(refused).toMatchObject({ ok: false, error: 'invalidState' });
    if (!refused.ok) expect(refused.message).toMatch(/overflow/);
    expect(s.buildings.some((b) => b.id === store.id)).toBe(true);
    expect(s.colony.stock.wood).toBe(250);
    s.colony.stock.wood = 100;
    expect(applyCommand(s, { type: 'demolishBuilding', buildingId: store.id }).ok).toBe(true);
    expect(s.colony.stock.wood).toBeLessThanOrEqual(getStorageCapacity(s));
    assertInvariants(s);
  });

  it('events that bring goods at the cap announce what was lost', () => {
    const s = game('cap-cache');
    s.colony.stock = { wood: 150, stone: 150, food: 150, water: 150, tools: 150 };
    const events: SimEvent[] = [];
    fireEvent(makeContext(s, events, GAME_HOURS_PER_TICK, true), 'supplyCache');
    const lost = events.filter((e) => e.type === 'goodsLost');
    expect(s.colony.stock.wood + s.colony.stock.stone + s.colony.stock.food + s.colony.stock.tools).toBe(600);
    // The loss is queued and announced when the tick ends.
    const after = stepGame(s);
    expect([...lost, ...after].some((e) => e.type === 'goodsLost')).toBe(true);
  });
});

describe('MIN-3 .. MIN-6', () => {
  it('the wood shortage bonus counts what construction sites have not already reserved', () => {
    const s = game('shortage');
    s.colony.stock.wood = 90;
    s.colony.stock.stone = 90;
    expect(shortageBonus(s, 'wood')).toBe(0); // 90 >= 50
    s.colony.stock.wood = 100;
    for (let i = 0; i < 3; i++) placeNearTown(s, 'house'); // three houses reserve 90 wood
    expect(shortageBonus(s, 'wood')).toBeGreaterThan(10);
  });

  it('finished tools in a workshop buffer count towards the tool target', () => {
    const s = game('tools-buffer');
    s.progress.unlocked.push('workshop');
    s.colony.stock = { wood: 100, stone: 50, food: 100, water: 100, tools: 0 };
    const shop = instantBuild(s, 'workshop');
    shop.output.tools = 4;
    for (const x of s.settlers) x.toolDurability = 40; // everyone already holds a tool
    run(s, 300);
    expect(s.progress.toolsCrafted).toBe(0); // 4 on hand >= the target of 3: no more crafting
  });

  it.each(MAP_PRESETS)('%s: bedroll spots are reachable from the town center', (preset) => {
    for (let n = 0; n < 12; n++) {
      const s = createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed: 'bedroll-' + n, preset });
      const town = s.buildings[0]!;
      const home = (town.origin.y - 1) * s.world.width + town.origin.x - 1;
      for (const x of s.settlers) {
        const spot = campfireSpot(s, x);
        expect(spot).not.toBeNull();
        expect(sameWalkRegion(s.world, spot!.y * s.world.width + spot!.x, home)).toBe(true);
      }
    }
  });

  it('a settler waiting out a failed path does not start the desertion walk again', () => {
    const s = game('desert-cooldown');
    const x = s.settlers[0]!;
    x.status.breakingHours = 1000;
    x.task = { kind: 'idle', phase: 'working', progress: 0.25 };
    stepGame(s);
    expect(x.task.kind).toBe('idle');
  });
});

describe('Activity.indoorsBuildingId', () => {
  it('is the bed while sleeping or resting indoors and null otherwise, every tick', () => {
    const s = game('indoors');
    s.time.timeOfDay = 21;
    for (const x of s.settlers) x.needs.energy = 30;
    let sawIndoors = false;
    let sawOutdoors = false;
    for (let i = 0; i < 900; i++) {
      stepGame(s);
      for (const x of s.settlers) {
        if (x.activity.indoorsBuildingId !== null) {
          sawIndoors = true;
          expect(['sleeping', 'resting']).toContain(x.activity.kind);
          expect(x.activity.indoorsBuildingId).toBe(x.homeId);
        } else if (x.activity.kind === 'sleeping') {
          sawOutdoors = true; // the homeless founder by the campfire
        }
      }
      if (i % 30 === 0) assertInvariants(s);
    }
    expect(sawIndoors).toBe(true);
    expect(sawOutdoors).toBe(true);
  });
});
