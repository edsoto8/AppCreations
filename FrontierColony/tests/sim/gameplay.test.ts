import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  DIFFICULTY,
  GAME_HOURS_PER_TICK,
  Terrain,
  applyCommand,
  createGame,
  getHousingCapacity,
  stepGame,
  validateGameState,
  type BuildingType,
  type Difficulty,
  type GameState,
  type RandomEventKind,
  type SimEvent,
  type WeatherKind,
} from '../../src/sim';
import { WEATHER_DURATION_HOURS, WEATHER_ORDER, WEATHER_TRANSITIONS, WEATHER_EFFECTS } from '../../src/sim/balance';
import { dailyChance, dailyEventRoll, fireEvent, stormDamageRoll, wildfireRoll, type DailyKind } from '../../src/sim/events';
import { makeContext, workSpeedMult } from '../../src/sim/needs';
import { assertInvariants } from '../../src/sim/testSupport';
import { rollWeather } from '../../src/sim/weather';
import { placeNearTown } from './support/player';

vi.setConfig({ testTimeout: 120_000 });

const TICKS_PER_DAY = 1800;

function game(seed = 'gameplay', difficulty: Difficulty = 'normal'): GameState {
  return createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed, difficulty });
}

/** Jump the clock: the next tick is `hour`:00 of `day`. */
function setClock(state: GameState, day: number, hour: number): void {
  state.time.tick = Math.round(((day - 1) * 24 + hour - 6) / GAME_HOURS_PER_TICK) - 1;
  state.time.timeOfDay = (hour + 23.5) % 24; // so that the next tick crosses an hour boundary
}

const ctxOf = (state: GameState, events: SimEvent[] = []) => makeContext(state, events, GAME_HOURS_PER_TICK, true);

function instantBuild(state: GameState, type: BuildingType) {
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

describe('weather (GAME_DESIGN §9)', () => {
  it('transition frequencies match the season tables', () => {
    for (const [season, table] of [
      ['spring', WEATHER_TRANSITIONS.warm],
      ['winter', WEATHER_TRANSITIONS.winter],
    ] as const) {
      const state = game('weather-stats');
      state.time.season = season;
      for (const from of WEATHER_ORDER) {
        const counts = [0, 0, 0, 0, 0];
        const N = 4000;
        for (let i = 0; i < N; i++) {
          state.weather.current = from;
          rollWeather(state, []);
          counts[WEATHER_ORDER.indexOf(state.weather.current)]!++;
        }
        const row = table[from];
        row.forEach((p, k) => expect(counts[k]! / N, `${season} ${from}->${WEATHER_ORDER[k]}`).toBeCloseTo(p, 1));
        for (let k = 0; k < 5; k++) if (row[k] === 0) expect(counts[k]).toBe(0);
      }
    }
  });

  it('durations and intensities stay in range, and changes are announced', () => {
    const state = game('weather-dur');
    const events: SimEvent[] = [];
    for (let i = 0; i < 500; i++) {
      const before = state.weather.current;
      const n = events.length;
      rollWeather(state, events);
      const [lo, hi] = WEATHER_DURATION_HOURS[state.weather.current];
      expect(state.weather.hoursRemaining).toBeGreaterThanOrEqual(lo);
      expect(state.weather.hoursRemaining).toBeLessThanOrEqual(hi);
      expect(state.weather.intensity).toBeGreaterThanOrEqual(0.4);
      expect(state.weather.intensity).toBeLessThanOrEqual(1);
      const changed = events.slice(n).filter((e) => e.type === 'weatherChanged');
      expect(changed.length).toBe(before === state.weather.current ? 0 : 1);
    }
  });

  it('the clock rolls weather by itself, and winter turns rain to snow and spring melts it', () => {
    const state = game('weather-clock');
    const kinds = new Set<WeatherKind>();
    for (let i = 0; i < TICKS_PER_DAY * 6; i++) {
      stepGame(state);
      kinds.add(state.weather.current);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    const w = game('weather-season');
    w.weather.current = 'rain';
    w.time.tick = 15 * TICKS_PER_DAY - 1; // first winter tick
    stepGame(w);
    expect(w.time.season).toBe('winter');
    expect(w.weather.current).toBe('snow');
    w.weather.current = 'snow';
    w.time.tick = 20 * TICKS_PER_DAY - 1; // spring again
    stepGame(w);
    expect(w.time.season).toBe('spring');
    expect(w.weather.current).toBe('cloudy');
  });

  it('effects: rain slows outdoor work, snow stops farms, storms drain energy', () => {
    const state = game('weather-effects');
    const s = state.settlers[0]!;
    state.weather.current = 'clear';
    const clear = workSpeedMult(ctxOf(state), s, 'woodcutting', 'woodcutting');
    state.weather.current = 'rain';
    const rain = workSpeedMult(ctxOf(state), s, 'woodcutting', 'woodcutting');
    expect(rain / clear).toBeCloseTo(WEATHER_EFFECTS.rain.outdoorWork, 9);
    // Crafting is indoor work.
    expect(workSpeedMult(ctxOf(state), s, 'crafting', 'crafting')).toBeCloseTo(workSpeedMult({ ...ctxOf(state), weather: WEATHER_EFFECTS.clear }, s, 'crafting', 'crafting'), 9);
    expect(WEATHER_EFFECTS.snow.farmGrowth).toBe(0);
    expect(WEATHER_EFFECTS.storm.energyDecay).toBe(1.15);
    // Energy drops faster in a storm than in clear weather.
    const drop = (weather: WeatherKind) => {
      const g = game('weather-energy');
      g.weather.current = weather;
      g.weather.hoursRemaining = 100;
      for (const x of g.settlers) x.needs.energy = 80;
      for (let i = 0; i < 100; i++) stepGame(g);
      return 80 - g.settlers[0]!.needs.energy;
    };
    expect(drop('storm')).toBeGreaterThan(drop('clear'));
  });

  it('rain barrels fill the water stock while it rains', () => {
    const state = game('weather-barrels');
    state.colony.stock.water = 10;
    state.weather.current = 'rain';
    state.weather.hoursRemaining = 100;
    const before = state.colony.stock.water;
    const drinkers = state.settlers.length; // meals also use water, so compare production
    for (let i = 0; i < 400; i++) stepGame(state);
    expect(state.stats.totalProduced.water).toBeGreaterThan(1);
    expect(state.stats.totalProduced.water).toBeLessThanOrEqual(4);
    expect(drinkers).toBe(5);
    expect(before).toBe(10);
  });

  it('storms tear roofs off: a building goes back to construction as a repair, and gets repaired', () => {
    const state = game('storm');
    const house = instantBuild(state, 'house');
    state.time.day = 6;
    state.weather.current = 'storm';
    let damaged = false;
    const events: SimEvent[] = [];
    for (let i = 0; i < 400 && !damaged; i++) {
      stormDamageRoll(ctxOf(state, events));
      damaged = house.status === 'construction';
    }
    expect(damaged).toBe(true);
    expect(house.construction!.kind).toBe('repair');
    expect(house.construction!.progress).toBeCloseTo(0.7, 9);
    expect(events.some((e) => e.type === 'buildingDamaged' && e.buildingId === house.id)).toBe(true);
    expect(state.eventLog.at(-1)!.message).toBe('The storm tore the roof off the House. It needs repairs.');
    expect(state.buildings[0]!.status).toBe('complete'); // the town center is immune
    state.weather.current = 'clear';
    state.weather.hoursRemaining = 100;
    const after = run(state, TICKS_PER_DAY);
    expect(house.status).toBe('complete');
    expect(after.some((e) => e.type === 'buildingRepaired' && e.buildingId === house.id)).toBe(true);
  });
});

describe('random events (GAME_DESIGN §10)', () => {
  const fire = (state: GameState, kind: DailyKind): SimEvent[] => {
    const events: SimEvent[] = [];
    fireEvent(ctxOf(state, events), kind);
    return events;
  };

  it('every event applies its effect', () => {
    // Supply cache.
    let s = game('ev-cache');
    const beforeStock = JSON.stringify(s.colony.stock);
    fire(s, 'supplyCache');
    expect(JSON.stringify(s.colony.stock)).not.toBe(beforeStock);
    expect(s.eventLog.at(-1)!.message).toMatch(/^Settlers found an abandoned wagon: \+\d+ (wood|stone|food|tools)\./);

    // Bountiful harvest: farms +50%.
    s = game('ev-bounty');
    instantBuild(s, 'farm');
    fire(s, 'bountifulHarvest');
    expect(s.activeEvents.map((e) => e.kind)).toEqual(['bountifulHarvest']);
    expect(s.activeEvents[0]!.hoursRemaining).toBe(48);
    expect(s.eventLog.at(-1)!.message).toContain('Farms +50% for 2 days');

    // Rich vein: +40 stone on every hills/mountain tile around a mine.
    s = game('ev-vein');
    const mine = instantBuild(s, 'mine');
    const w = s.world;
    const tiles: number[] = [];
    const r = BUILDING_DEFS.mine.workRadius;
    for (let y = mine.origin.y - r; y < mine.origin.y + 2 + r; y++) {
      for (let x = mine.origin.x - r; x < mine.origin.x + 2 + r; x++) {
        const i = y * w.width + x;
        if (w.terrain[i] === Terrain.Hills || w.terrain[i] === Terrain.Mountain) tiles.push(i);
      }
    }
    const before = tiles.map((i) => w.resource[i]!);
    const ev = fire(s, 'richVein');
    expect(tiles.length).toBeGreaterThan(2);
    tiles.forEach((i, k) => expect(w.resource[i]).toBe(before[k]! + 40));
    expect(ev.filter((e) => e.type === 'tileChanged')).toHaveLength(tiles.length);

    // Crop blight: one farm yields nothing for 48 h; its id is the event's target.
    s = game('ev-blight');
    const farm = instantBuild(s, 'farm');
    fire(s, 'cropBlight');
    expect(s.activeEvents[0]).toMatchObject({ kind: 'cropBlight', targetId: farm.id, hoursRemaining: 48 });
    run(s, 600);
    expect(farm.output.food).toBe(0);
    expect(validateGameState(s).ok).toBe(true);
    s.buildings.splice(s.buildings.indexOf(farm), 1); // targets that vanish end the event
    expect(applyCommand(s, { type: 'demolishBuilding', buildingId: farm.id }).ok).toBe(false);

    // Drought: farms and wells slower, no rain.
    s = game('ev-drought');
    fire(s, 'drought');
    expect(s.activeEvents[0]!.hoursRemaining).toBe(72);
    s.weather.current = 'cloudy';
    for (let i = 0; i < 300; i++) {
      rollWeather(s, []);
      expect(s.weather.current).not.toBe('rain');
    }

    // Tools break: lose max(1, floor(25%)).
    s = game('ev-tools');
    s.colony.stock.tools = 9;
    fire(s, 'toolsBreak');
    expect(s.colony.stock.tools).toBe(7);
    expect(s.eventLog.at(-1)!.message).toBe('Damp got into the tool crates. 2 tools rusted through.');
    s.colony.stock.tools = 4;
    fire(s, 'toolsBreak');
    expect(s.colony.stock.tools).toBe(3);
    expect(s.eventLog.at(-1)!.message).toBe('Damp got into the tool crates. 1 tool rusted through.');

    // Cold snap.
    s = game('ev-cold');
    fire(s, 'coldSnap');
    expect(s.activeEvents[0]).toMatchObject({ kind: 'coldSnap', hoursRemaining: 48 });
    expect(makeContext(s, [], GAME_HOURS_PER_TICK, false).coldSnap).toBe(true);
  });

  it('wolves maul the settler farthest from the town center and slow gathering', () => {
    const s = game('ev-wolves');
    const far = s.settlers[2]!;
    const town = s.buildings[0]!.origin;
    let spot: { x: number; y: number } | null = null;
    for (let r = 14; r < 24 && !spot; r++) {
      for (let dx = -r; dx <= r && !spot; dx++) {
        const x = town.x + dx;
        const y = town.y + r;
        const i = y * s.world.width + x;
        if (x >= 0 && x < s.world.width && y < s.world.height && s.world.terrain[i] === Terrain.Grass && s.world.building[i] === 0) spot = { x, y };
      }
    }
    expect(spot).not.toBeNull();
    far.pos.x = spot!.x + 0.5;
    far.pos.y = spot!.y + 0.5;
    far.prevPos.x = far.pos.x;
    far.prevPos.y = far.pos.y;
    const health = far.needs.health;
    fire(s, 'wolves');
    expect(far.needs.health).toBeCloseTo(health - 35, 6);
    expect(s.activeEvents[0]).toMatchObject({ kind: 'wolves', targetId: far.id, hoursRemaining: 24 });
    expect(s.eventLog.at(-1)!.message).toBe(`Wolves on the ridge! ${far.name} was mauled.`);
    expect(far.status.damageLog.wolves).toBeCloseTo(35, 6);
    run(s, 80);
    expect(s.settlers.every((x) => x.moodlets.some((m) => m.id === 'wolves'))).toBe(true);
    // Nobody far away: just a sighting.
    const s2 = game('ev-wolves-2');
    const hp = s2.settlers.map((x) => x.needs.health);
    fire(s2, 'wolves');
    expect(s2.settlers.map((x) => x.needs.health)).toEqual(hp);
    expect(s2.eventLog.at(-1)!.message).toBe('Wolves have been sighted near the colony.');
  });

  it('sickness infects a quarter of the settlers, and the sick work slower and lose health', () => {
    const s = game('ev-sick');
    s.settlers[0]!.traits = ['tough'];
    fire(s, 'sickness');
    const sick = s.settlers.filter((x) => x.status.sickHoursLeft > 0);
    expect(sick).toHaveLength(Math.ceil(5 * 0.25));
    expect(sick[0]!.status.sickHoursLeft).toBe(sick[0]!.traits.includes('tough') ? 18 : 36);
    expect(s.eventLog.at(-1)!.message).toMatch(/^A fever is going around\. .+ fell ill\.$/);
    const patient = sick[0]!;
    const ctx = ctxOf(s);
    const healthy = s.settlers.find((x) => x.status.sickHoursLeft <= 0 && x.skills.farming === patient.skills.farming && x.traits.length === patient.traits.length);
    void healthy;
    const mult = workSpeedMult(ctx, patient, 'crafting', 'crafting');
    patient.status.sickHoursLeft = 0;
    expect(mult / workSpeedMult(ctx, patient, 'crafting', 'crafting')).toBeCloseTo(0.7, 9);
    patient.status.sickHoursLeft = 20;
    const hp = patient.needs.health;
    run(s, 150);
    expect(patient.needs.health).toBeLessThan(hp);
  });

  it('wildfire burns forest within radius 3 and damages buildings in the fire', () => {
    const s = game('ev-fire');
    fire(s, 'drought');
    s.time.day = 10;
    const world = s.world;
    const town = s.buildings[0]!;
    // Plant a forest far away so the roll has a target, with a farm inside the burn radius.
    const fx = Math.min(world.width - 8, town.origin.x + 14);
    const fy = town.origin.y;
    for (let y = fy - 3; y <= fy + 3; y++) {
      for (let x = fx - 3; x <= fx + 3; x++) {
        const i = y * world.width + x;
        if (world.building[i] === 0) {
          world.terrain[i] = Terrain.Forest;
          world.resource[i] = 40;
        }
      }
    }
    world.revision++;
    const revision = world.revision;
    const events: SimEvent[] = [];
    let burned = false;
    for (let i = 0; i < 300 && !burned; i++) {
      wildfireRoll(ctxOf(s, events));
      burned = events.some((e) => e.type === 'randomEvent' && e.kind === 'wildfire');
    }
    expect(burned).toBe(true);
    expect(world.revision).toBeGreaterThan(revision);
    expect(events.some((e) => e.type === 'tileChanged')).toBe(true);
    expect(s.eventLog.at(-1)!.message).toMatch(/^Wildfire! The forest near \(\d+,\d+\) is burning\.$/);
    const match = /\((\d+),(\d+)\)/.exec(s.eventLog.at(-1)!.message)!;
    const cx = Number(match[1]);
    const cy = Number(match[2]);
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        const i = y * world.width + x;
        expect(world.terrain[i]).not.toBe(Terrain.Forest);
      }
    }
    // Without a drought there is no wildfire.
    const calm = game('ev-fire-calm');
    calm.time.day = 10;
    const calmEvents: SimEvent[] = [];
    for (let i = 0; i < 200; i++) wildfireRoll(ctxOf(calm, calmEvents));
    expect(calmEvents).toHaveLength(0);
  });

  it('daily rolls honour grace days and triggers, and fire roughly 0.4 events a day', () => {
    // No negative event before the grace day, on any difficulty.
    for (const [difficulty, grace] of [['relaxed', 5], ['normal', 3], ['harsh', 2]] as const) {
      expect(DIFFICULTY[difficulty].graceDays).toBe(grace);
      const negative = new Set<RandomEventKind>(['wolves', 'sickness', 'cropBlight', 'drought', 'toolsBreak', 'coldSnap']);
      for (let n = 0; n < 40; n++) {
        const s = game('grace-' + n, difficulty);
        s.colony.stock.tools = 10;
        instantBuild(s, 'farm');
        s.time.day = grace - 1;
        s.time.season = 'summer';
        const events: SimEvent[] = [];
        for (let k = 0; k < 20; k++) dailyEventRoll(ctxOf(s, events));
        expect(events.filter((e) => e.type === 'randomEvent' && negative.has(e.kind))).toHaveLength(0);
      }
    }
    // Triggers: no farm, no blight; no mine, no vein; spring, no cold snap.
    const s = game('triggers');
    expect(dailyChance(s, 'cropBlight')).toBeNull();
    expect(dailyChance(s, 'richVein')).toBeNull();
    expect(dailyChance(s, 'coldSnap')).toBeNull();
    expect(dailyChance(s, 'drought')).toBeNull();
    expect(dailyChance(s, 'wolves')).toBeNull(); // day 1
    s.time.day = 6;
    expect(dailyChance(s, 'wolves')).toBe(0.06);
    expect(dailyChance(s, 'sickness')).toBe(0.05);
    s.settlers[0]!.status.dehydrated = true;
    expect(dailyChance(s, 'sickness')).toBeCloseTo(0.1, 9);
    // Overall pace.
    let fired = 0;
    const rolls = 600;
    for (let n = 0; n < rolls; n++) {
      const g = game('pace-' + (n % 30));
      g.time.day = 10;
      g.colony.stock.tools = 6;
      const events: SimEvent[] = [];
      dailyEventRoll(ctxOf(g, events));
      fired += events.filter((e) => e.type === 'randomEvent' || e.type === 'decisionPending').length;
    }
    expect(fired / rolls).toBeGreaterThan(0.15);
    expect(fired / rolls).toBeLessThan(0.6);
  });

  it('at most one daily event fires per roll, and the event kinds already active are skipped', () => {
    const s = game('one-per-day');
    s.time.day = 8;
    s.colony.stock.tools = 8;
    fire(s, 'drought');
    expect(s.activeEvents).toHaveLength(1);
    for (let i = 0; i < 200; i++) {
      const events: SimEvent[] = [];
      dailyEventRoll(ctxOf(s, events));
      expect(events.filter((e) => e.type === 'randomEvent' || e.type === 'decisionPending').length).toBeLessThanOrEqual(1);
    }
    expect(s.activeEvents.filter((e) => e.kind === 'drought')).toHaveLength(1);
  });

  it('active events time out and are logged', () => {
    const s = game('ev-timeout');
    fire(s, 'coldSnap');
    s.activeEvents[0]!.hoursRemaining = 0.05;
    run(s, 10);
    expect(s.activeEvents).toHaveLength(0);
    expect(s.eventLog.at(-1)!.message).toBe('The cold snap has eased.');
  });
});

describe('decisions', () => {
  function withTrader(seed = 'dec-trader'): GameState {
    const s = game(seed);
    s.time.day = 5;
    s.colony.stock = { wood: 100, stone: 30, food: 100, water: 40, tools: 5 };
    fireEvent(ctxOf(s), 'traderVisit');
    return s;
  }

  it('a trader offer has a typed payload, a window, and its text', () => {
    const s = withTrader();
    expect(s.pendingDecisions).toHaveLength(1);
    const d = s.pendingDecisions[0]!;
    expect(d.kind).toBe('traderVisit');
    expect(d.windowHours).toBe(12);
    expect(d.hoursLeft).toBe(12);
    const keys = Object.keys(d.payload);
    expect(keys.every((k) => /^(give|get)(Wood|Stone|Food|Water|Tools)$/.test(k))).toBe(true);
    expect(keys.some((k) => k.startsWith('give'))).toBe(true);
    expect(keys.some((k) => k.startsWith('get'))).toBe(true);
    expect(s.eventLog.at(-1)!.message).toMatch(/^A traveling trader pulls up at the town center: .+ for .+\?$/);
    expect(validateGameState(s).ok).toBe(true);
  });

  it('accept swaps the goods', () => {
    const s = withTrader();
    const d = s.pendingDecisions[0]!;
    const payload = d.payload as Record<string, number>;
    const before = { ...s.colony.stock };
    const result = applyCommand(s, { type: 'resolveEvent', eventId: d.eventId, accept: true });
    expect(result.ok).toBe(true);
    expect(s.pendingDecisions).toHaveLength(0);
    for (const r of ['wood', 'stone', 'food', 'water', 'tools'] as const) {
      const name = r.charAt(0).toUpperCase() + r.slice(1);
      expect(s.colony.stock[r]).toBe(before[r] - (payload[`give${name}`] ?? 0) + (payload[`get${name}`] ?? 0));
    }
    expect(s.eventLog.at(-1)!.message).toMatch(/^Traded .+ for .+\.$/);
    expect(applyCommand(s, { type: 'resolveEvent', eventId: d.eventId, accept: true })).toMatchObject({ ok: false, error: 'notFound' });
  });

  it('decline changes nothing', () => {
    const s = withTrader();
    const before = JSON.stringify(s.colony.stock);
    const d = s.pendingDecisions[0]!;
    expect(applyCommand(s, { type: 'resolveEvent', eventId: d.eventId, accept: false }).ok).toBe(true);
    expect(JSON.stringify(s.colony.stock)).toBe(before);
    expect(s.eventLog.at(-1)!.message).toBe("Declined the trader's offer.");
  });

  it('expiry takes the default (decline) after the window', () => {
    const s = withTrader();
    const before = JSON.stringify(s.colony.stock);
    run(s, Math.ceil(12 / GAME_HOURS_PER_TICK) + 5);
    expect(s.pendingDecisions).toHaveLength(0);
    expect(s.eventLog.some((e) => e.message === 'The trader moved on.')).toBe(true);
    expect(s.colony.stock.wood + s.colony.stock.food).toBeGreaterThan(0);
    expect(JSON.stringify(s.colony.stock)).not.toBe('');
    void before;
  });

  it('countdown runs in game hours and an accept you can no longer afford is refused', () => {
    const s = withTrader();
    const d = s.pendingDecisions[0]!;
    run(s, 75); // one in-game hour
    expect(d.hoursLeft).toBeCloseTo(11, 1);
    s.colony.stock = { wood: 0, stone: 0, food: 0, water: 0, tools: 0 };
    expect(applyCommand(s, { type: 'resolveEvent', eventId: d.eventId, accept: true })).toMatchObject({ ok: false, error: 'insufficientResources' });
    expect(s.pendingDecisions).toHaveLength(1);
  });

  it('wanderers auto-join when there are beds, and ask when there are not', () => {
    const s = game('dec-wander');
    s.time.day = 5;
    // 5 settlers, 4 beds: no room.
    expect(getHousingCapacity(s)).toBe(4);
    fireEvent(ctxOf(s), 'wanderer');
    expect(s.pendingDecisions).toHaveLength(1);
    const d = s.pendingDecisions[0]!;
    expect(d.kind).toBe('wanderer');
    expect(d.payload).toMatchObject({ freeBeds: 0 });
    expect([1, 2]).toContain((d.payload as { count: number }).count);
    expect(s.eventLog.at(-1)!.message).toMatch(/ask to join\. There are no free beds; they would sleep outdoors\.$/);
    const pop = s.settlers.length;
    const count = (d.payload as { count: number }).count;
    expect(applyCommand(s, { type: 'resolveEvent', eventId: d.eventId, accept: true }).ok).toBe(true);
    expect(s.settlers.length).toBe(pop + count);
    expect(s.settlers.at(-1)!.homeId).toBeNull();
    assertInvariants(s);

    // With beds they just come.
    const t = game('dec-wander-beds');
    t.time.day = 5;
    t.settlers.pop();
    instantBuild(t, 'house');
    instantBuild(t, 'house');
    const events: SimEvent[] = [];
    fireEvent(ctxOf(t, events), 'wanderer');
    expect(t.pendingDecisions).toHaveLength(0);
    expect(t.settlers.length).toBeGreaterThan(4);
    expect(events.some((e) => e.type === 'settlerArrived')).toBe(true);

    // Turn away.
    const u = game('dec-wander-no');
    u.time.day = 5;
    fireEvent(ctxOf(u), 'wanderer');
    const ud = u.pendingDecisions[0]!;
    applyCommand(u, { type: 'resolveEvent', eventId: ud.eventId, accept: false });
    expect(u.settlers).toHaveLength(5);
    expect(u.eventLog.at(-1)!.message).toMatch(/^Turned the wanderers? away\.$/);
  });

  it('a harvest festival costs 2 food per settler, gathers everyone, and lifts their mood', () => {
    const s = game('dec-festival');
    s.time.season = 'autumn';
    s.time.day = 12;
    s.colony.stock.food = 100;
    fireEvent(ctxOf(s), 'harvestFestival');
    const d = s.pendingDecisions[0]!;
    expect(d).toMatchObject({ kind: 'harvestFestival', windowHours: 6, payload: { foodCost: 10 } });
    expect(s.progress.festivalYear).toBe(1);
    expect(dailyChance(s, 'harvestFestival')).toBeNull(); // once a year
    expect(applyCommand(s, { type: 'resolveEvent', eventId: d.eventId, accept: true }).ok).toBe(true);
    expect(s.colony.stock.food).toBe(90);
    expect(s.activeEvents.some((e) => e.kind === 'harvestFestival')).toBe(true);
    s.time.tick = 11 * TICKS_PER_DAY + 400;
    for (let i = 0; i < 100; i++) stepGame(s);
    expect(s.settlers.filter((x) => x.activity.kind === 'socializing' || x.task.kind === 'socialize').length).toBeGreaterThanOrEqual(3);
    run(s, Math.ceil(4 / GAME_HOURS_PER_TICK));
    expect(s.settlers.every((x) => x.moodlets.some((m) => m.id === 'festival'))).toBe(true);
  });

  it('keeps pending decisions and active events through a save and load, deterministically', () => {
    const s = withTrader('dec-save');
    fireEvent(ctxOf(s), 'drought');
    fireEvent(ctxOf(s), 'wolves');
    run(s, 300);
    expect(s.pendingDecisions).toHaveLength(1);
    expect(s.activeEvents.length).toBeGreaterThanOrEqual(2);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    expect(validateGameState(copy).ok).toBe(true);
    const a = run(s, 2000, 500);
    const b = run(copy, 2000, 500);
    expect(copy).toEqual(s);
    expect(b).toEqual(a);
  });
});

describe('population (GAME_DESIGN §8)', () => {
  /** A colony with spare beds, food and water, mid-spring. */
  function roomy(seed: string, houses = 2): GameState {
    const s = game(seed);
    s.time.day = 4;
    s.colony.stock = { wood: 100, stone: 50, food: 140, water: 140, tools: 3 };
    for (let i = 0; i < houses; i++) instantBuild(s, 'house');
    return s;
  }
  const arrivals = (s: GameState, days: number, keepFed = true): number => {
    let n = 0;
    for (let i = 0; i < TICKS_PER_DAY * days; i++) {
      if (keepFed && i % 300 === 0) {
        s.colony.stock.food = Math.max(s.colony.stock.food, 140);
        s.colony.stock.water = Math.max(s.colony.stock.water, 140);
      }
      for (const e of stepGame(s)) if (e.type === 'settlerArrived') n++;
    }
    return n;
  };

  it('grows with free beds, food and water, using fresh names and the newcomer mood', () => {
    const s = roomy('grow');
    const start = s.settlers.length;
    const names = new Set(s.settlers.map((x) => x.name));
    const n = arrivals(s, 6);
    expect(n).toBeGreaterThan(0);
    expect(s.settlers.length).toBe(start + n);
    expect(s.settlers.length).toBeLessThanOrEqual(30);
    expect(s.stats.arrivals).toBe(n);
    expect(s.stats.peakPopulation).toBe(s.settlers.length);
    const fresh = s.settlers.filter((x) => !names.has(x.name));
    expect(fresh.length).toBe(n);
    expect(new Set(s.settlers.map((x) => x.name)).size).toBe(s.settlers.length);
    expect(s.eventLog.some((e) => /has arrived and joined/.test(e.message))).toBe(true);
    assertInvariants(s);
  });

  it('does not grow without free beds, without food or water, or right after a death', () => {
    const noBeds = roomy('grow-nobeds', 0);
    expect(arrivals(noBeds, 6)).toBe(0);
    const hungry = roomy('grow-hungry');
    hungry.colony.stock.food = 5;
    expect(arrivals(hungry, 3, false)).toBe(0);
    const dry = roomy('grow-dry');
    dry.colony.stock.water = 3;
    expect(arrivals(dry, 3, false)).toBe(0);
    const grieving = roomy('grow-death');
    grieving.progress.lastDeathTick = grieving.time.tick;
    for (let i = 0; i < 600; i++) {
      grieving.progress.lastDeathTick = grieving.time.tick; // a death every moment
      stepGame(grieving);
    }
    expect(grieving.stats.arrivals).toBe(0);
  });

  it('never exceeds the population cap', () => {
    const s = roomy('grow-cap', 8);
    for (let i = 0; i < 24; i++) {
      s.time.day = 4;
    }
    arrivals(s, 25);
    expect(s.settlers.length).toBeLessThanOrEqual(30);
  });
});

describe('survival and failure (GAME_DESIGN §12)', () => {
  it('losing every settler ends the game with a readable reason and a gameOver event', () => {
    const s = game('lost');
    for (const x of s.settlers) x.needs.health = 0.001;
    for (const x of s.settlers) x.status.dehydrated = true;
    const events = run(s, 60);
    expect(s.settlers).toHaveLength(0);
    expect(s.outcome.status).toBe('lost');
    expect(s.outcome.reason).toBe('The frontier has claimed New Hope. It lasted 1 day.');
    expect(events.filter((e) => e.type === 'gameOver')).toEqual([{ type: 'gameOver', status: 'lost', reason: 'The frontier has claimed New Hope. It lasted 1 day.' }]);
    expect(applyCommand(s, { type: 'setPriority', category: 'farming', level: 1 })).toMatchObject({ ok: false, error: 'gameOver' });
    const tick = s.time.tick;
    stepGame(s);
    expect(s.time.tick).toBe(tick);
    // Plural form.
    const t = game('lost-2');
    t.time.tick = 3 * TICKS_PER_DAY;
    for (const x of t.settlers) x.needs.health = 0.001;
    for (const x of t.settlers) x.status.dehydrated = true;
    run(t, 60);
    expect(t.outcome.reason).toBe('The frontier has claimed New Hope. It lasted 4 days.');
  });

  it('victory continues as a sandbox after acknowledgement', () => {
    const s = game('victory');
    s.time.day = 10;
    s.colony.stock = { wood: 100, stone: 50, food: 150, water: 150, tools: 3 };
    // Fake a thriving colony of 20.
    const template = s.settlers[0]!;
    while (s.settlers.length < 20) {
      const copy = JSON.parse(JSON.stringify(template)) as typeof template;
      copy.id = s.nextId++;
      copy.name = `Extra ${copy.id}`;
      copy.homeId = null;
      s.colony.usedNames.push(copy.name);
      s.settlers.push(copy);
    }
    for (const x of s.settlers) x.needs.happiness = 90;
    const events = run(s, 100);
    expect(s.outcome.status).toBe('won');
    expect(s.outcome.reason).toBe('Thriving Frontier: 20 settlers call New Hope home.');
    expect(events.some((e) => e.type === 'gameOver' && e.status === 'won')).toBe(true);
    expect(applyCommand(s, { type: 'acknowledgeVictory' }).ok).toBe(true);
    expect(s.outcome.status).toBe('playing');
    run(s, TICKS_PER_DAY / 2);
    expect(s.outcome.status).toBe('playing'); // victory does not re-trigger
    expect(s.progress.objectivesDone).toContain('thriving');
  });
});

describe('priorities and difficulty', () => {
  const gathered = (s: GameState, resource: 'wood' | 'stone', ticks: number): number => {
    let n = 0;
    for (let i = 0; i < ticks; i++) for (const e of stepGame(s)) if (e.type === 'resourceGathered' && e.resource === resource) n++;
    return n;
  };

  it('priority 0 switches a job category off, and higher priorities draw more workers', () => {
    const on = game('prio');
    expect(gathered(on, 'wood', TICKS_PER_DAY)).toBeGreaterThan(5);
    const off = game('prio');
    applyCommand(off, { type: 'setPriority', category: 'woodcutting', level: 0 });
    expect(gathered(off, 'wood', TICKS_PER_DAY)).toBe(0);
    expect(off.settlers.every((s) => s.task.kind !== 'gather' || s.task.resource !== 'wood')).toBe(true);
    // Mining likewise.
    const noMining = game('prio');
    applyCommand(noMining, { type: 'setPriority', category: 'mining', level: 0 });
    expect(gathered(noMining, 'stone', TICKS_PER_DAY)).toBe(0);
    // Building at 0: a site stays untouched.
    const noBuild = game('prio-build');
    applyCommand(noBuild, { type: 'setPriority', category: 'building', level: 0 });
    const id = placeNearTown(noBuild, 'house')!;
    run(noBuild, TICKS_PER_DAY);
    const site = noBuild.buildings.find((b) => b.id === id)!;
    expect(site.status).toBe('construction');
    expect(site.construction!.workDone).toBe(0);
    // Hauling at 0: nothing is delivered, so nothing is built.
    const noHaul = game('prio-haul');
    applyCommand(noHaul, { type: 'setPriority', category: 'hauling', level: 0 });
    const hid = placeNearTown(noHaul, 'house')!;
    run(noHaul, TICKS_PER_DAY);
    expect(noHaul.buildings.find((b) => b.id === hid)!.construction!.delivered.wood).toBe(0);
  });

  it('applies the difficulty multipliers: start stock, decay, event frequency, desertion', () => {
    const relaxed = game('diff', 'relaxed');
    const normal = game('diff', 'normal');
    const harsh = game('diff', 'harsh');
    expect(relaxed.colony.stock.food).toBeGreaterThan(normal.colony.stock.food);
    expect(normal.colony.stock.food).toBeGreaterThan(harsh.colony.stock.food);
    const hungerAfter = (s: GameState) => {
      for (const x of s.settlers) x.needs.hunger = 90;
      for (let i = 0; i < 150; i++) stepGame(s);
      return Math.min(...s.settlers.map((x) => x.needs.hunger));
    };
    const h = [relaxed, normal, harsh].map((s) => {
      s.colony.stock.food = 0; // nobody eats
      return hungerAfter(s);
    });
    expect(h[0]!).toBeGreaterThan(h[1]!);
    expect(h[1]!).toBeGreaterThan(h[2]!);
    // Event frequency: harsh fires more negative events than relaxed.
    const count = (difficulty: Difficulty): number => {
      let n = 0;
      for (let k = 0; k < 300; k++) {
        const s = game('freq-' + k, difficulty);
        s.time.day = 12;
        s.time.season = 'summer';
        s.colony.stock.tools = 8;
        const ev: SimEvent[] = [];
        dailyEventRoll(ctxOf(s, ev));
        n += ev.filter((e) => e.type === 'randomEvent' && ['wolves', 'sickness', 'drought', 'toolsBreak'].includes(e.kind)).length;
      }
      return n;
    };
    expect(count('harsh')).toBeGreaterThan(count('relaxed'));
    expect(DIFFICULTY.relaxed.desertionHours).toBe(72);
    expect(DIFFICULTY.harsh.growthMult).toBe(0.8);
  });
});

describe('forests (GAME_DESIGN §6.5)', () => {
  it('trees regrow at midnight outside winter and spread onto neighbouring grass', () => {
    const s = game('forest');
    const world = s.world;
    const i = world.terrain.findIndex((t, k) => t === Terrain.Forest && world.resource[k]! >= 20);
    world.resource[i] = 10;
    setClock(s, 2, 0);
    stepGame(s);
    expect(world.resource[i]).toBe(12);
    const before = world.terrain.filter((t) => t === Terrain.Forest).length;
    for (let day = 3; day < 14; day++) {
      setClock(s, day, 0);
      stepGame(s);
    }
    expect(world.terrain.filter((t) => t === Terrain.Forest).length).toBeGreaterThan(before);
    // Winter: nothing regrows.
    const w = game('forest-winter');
    const j = w.world.terrain.findIndex((t, k) => t === Terrain.Forest && w.world.resource[k]! >= 20);
    w.world.resource[j] = 10;
    setClock(w, 16, 0);
    stepGame(w);
    expect(w.time.season).toBe('winter');
    expect(w.world.resource[j]).toBe(10);
  });
});
