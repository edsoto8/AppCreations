import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NEW_GAME_OPTIONS, applyCommand, createGame, stepGame, validateGameState, type GameState } from '../../src/sim';
import { assertInvariants } from '../../src/sim/testSupport';

// Several tests here are heavy (many generations or thousands of ticks); allow for a loaded CI machine.
vi.setConfig({ testTimeout: 60_000 });

let base: GameState;

beforeAll(() => {
  base = createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed: 'validate-fuzz' });
  const town = base.buildings[0]!.origin;
  outer: for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      if (applyCommand(base, { type: 'placeBuilding', buildingType: 'house', x: town.x + dx, y: town.y + dy }).ok) break outer;
    }
  }
  expect(base.buildings.length).toBeGreaterThan(1);
  for (let i = 0; i < 2000; i++) stepGame(base);
});

const clone = (): GameState => JSON.parse(JSON.stringify(base)) as GameState;

/** Collect the path to every leaf (primitive) outside the four big tile layers. */
function leafPaths(value: unknown, path: (string | number)[], out: (string | number)[][]): void {
  if (typeof value === 'object' && value !== null) {
    const entries = Array.isArray(value) ? value.map((v, i) => [i, v] as const) : Object.entries(value);
    for (const [k, v] of entries) {
      if (path.length === 1 && path[0] === 'world' && ['terrain', 'elevation', 'resource', 'building'].includes(String(k))) continue;
      leafPaths(v, [...path, k], out);
    }
  } else {
    out.push(path);
  }
}

function getAt(root: unknown, path: (string | number)[]): { parent: Record<string | number, unknown>; key: string | number } {
  let node = root as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i] as string] as Record<string | number, unknown>;
  return { parent: node, key: path[path.length - 1] as string | number };
}

describe('validateGameState', () => {
  it('accepts a fresh game and a game after 2000 ticks, including invariants', () => {
    expect(validateGameState(createGame(DEFAULT_NEW_GAME_OPTIONS)).ok).toBe(true);
    const result = validateGameState(base);
    expect(result.ok).toBe(true);
    assertInvariants(base);
    expect(validateGameState(clone()).ok).toBe(true);
  });

  it('never throws on arbitrary input', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwing = {
      get meta(): never {
        throw new Error('boom');
      },
    };
    for (const input of [null, undefined, 0, 1, 'text', true, [], {}, [1, 2], cyclic, throwing, () => 1, Symbol('x'), NaN, { meta: null }, { world: 5 }]) {
      const result = validateGameState(input as unknown);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects wrong types, NaN and Infinity at every leaf (and never throws)', () => {
    const state = clone();
    const paths: (string | number)[][] = [];
    leafPaths(state, [], paths);
    expect(paths.length).toBeGreaterThan(500);
    let rejected = 0;
    for (const path of paths) {
      if (path.includes('damageLog')) continue;
      const { parent, key } = getAt(state, path);
      const original = parent[key];
      const bad: unknown[] = typeof original === 'number' ? [NaN, Infinity, -Infinity, 'x', {}, []] : typeof original === 'string' ? [42, {}, [], true] : typeof original === 'boolean' ? ['x', 2, {}] : original === null ? [{}, true, []] : [];
      for (const value of bad) {
        parent[key] = value;
        const result = validateGameState(state);
        if (result.ok) throw new Error(`mutation accepted at ${path.join('.')} -> ${String(value)}`);
        rejected++;
      }
      parent[key] = original;
    }
    expect(rejected).toBeGreaterThan(2000);
    expect(validateGameState(state).ok).toBe(true); // everything restored
  });

  it('rejects a missing field at every object key', () => {
    const state = clone();
    const paths: (string | number)[][] = [];
    leafPaths(state, [], paths);
    let rejected = 0;
    for (const path of paths) {
      if (path.includes('damageLog') || path.includes('payload') || typeof path[path.length - 1] === 'number') continue;
      const { parent, key } = getAt(state, path);
      const original = parent[key];
      delete parent[key];
      expect(validateGameState(state).ok, `missing ${path.join('.')}`).toBe(false);
      parent[key] = original;
      rejected++;
    }
    expect(rejected).toBeGreaterThan(300);
  });

  it('rejects out-of-range values', () => {
    const cases: [string, (s: GameState) => void][] = [
      ['terrain code 7', (s) => void (s.world.terrain[10] = 7)],
      ['negative terrain', (s) => void (s.world.terrain[10] = -1)],
      ['fractional terrain', (s) => void (s.world.terrain[10] = 2.5)],
      ['elevation above max', (s) => void (s.world.elevation[3] = 99)],
      ['negative resource', (s) => void (s.world.resource[3] = -5)],
      ['NaN resource', (s) => void (s.world.resource[3] = NaN)],
      ['short terrain layer', (s) => void s.world.terrain.pop()],
      ['long building layer', (s) => void s.world.building.push(0)],
      ['width mismatch', (s) => void (s.world.width += 1)],
      ['hunger 101', (s) => void (s.settlers[0]!.needs.hunger = 101)],
      ['health -1', (s) => void (s.settlers[0]!.needs.health = -1)],
      ['happiness NaN', (s) => void (s.settlers[1]!.needs.happiness = NaN)],
      ['skill 11', (s) => void (s.settlers[0]!.skills.farming = 11)],
      ['pos outside map', (s) => void (s.settlers[0]!.pos.x = -4)],
      ['path outside map', (s) => void (s.settlers[0]!.path = [{ x: 9999, y: 0 }])],
      ['negative stock', (s) => void (s.colony.stock.food = -50)],
      ['stock string', (s) => void ((s.colony.stock as unknown as Record<string, unknown>).wood = 'abc')],
      ['priority 9', (s) => void ((s.colony.priorities as unknown as Record<string, number>).farming = 9)],
      ['extra priority key', (s) => void ((s.colony.priorities as unknown as Record<string, number>).nonsense = 1)],
      ['unknown weather', (s) => void ((s.weather as unknown as Record<string, string>).current = 'meteor')],
      ['unknown season', (s) => void ((s.time as unknown as Record<string, string>).season = 'monsoon')],
      ['unknown difficulty', (s) => void ((s.meta as unknown as Record<string, string>).difficulty = 'nightmare')],
      ['unknown preset', (s) => void ((s.meta as unknown as Record<string, string>).preset = 'moon')],
      ['unknown trait', (s) => void s.settlers[0]!.traits.push('wizard' as never)],
      ['duplicate trait', (s) => void (s.settlers[0]!.traits = ['lazy', 'lazy'])],
      ['unknown task kind', (s) => void ((s.settlers[0]!.task as unknown as Record<string, string>).kind = 'teleport')],
      ['unknown activity kind', (s) => void ((s.settlers[0]!.activity as unknown as Record<string, string>).kind = 'flying')],
      ['timeOfDay 24', (s) => void (s.time.timeOfDay = 24)],
      ['day 0', (s) => void (s.time.day = 0)],
      ['nextId too low', (s) => void (s.nextId = 2)],
      ['rng with 3 numbers', (s) => void (s.rng = [1, 2, 3] as never)],
      ['rng not uint32', (s) => void (s.rng = [1, 2, 3, -4])],
      ['history sample without produced', (s) => void delete (s.stats.history[0] as unknown as Record<string, unknown>).produced],
      ['long eventLog', (s) => void (s.eventLog = Array.from({ length: 500 }, () => s.eventLog[0]!))],
      ['empty colony name', (s) => void (s.colony.name = '   ')],
      ['wrong schema version', (s) => void (s.meta.schemaVersion = 99)],
      ['victory flag not boolean', (s) => void ((s.progress as unknown as Record<string, unknown>).victoryAcknowledged = 1)],
      ['unknown unlocked building', (s) => void s.progress.unlocked.push('castle' as never)],
      ['outcome status', (s) => void ((s.outcome as unknown as Record<string, string>).status = 'draw')],
    ];
    for (const [name, mutate] of cases) {
      const state = clone();
      mutate(state);
      expect(validateGameState(state).ok, name).toBe(false);
    }
  });

  it('rejects dangling and inconsistent references', () => {
    const cases: [string, (s: GameState) => void][] = [
      ['homeId of nothing', (s) => void (s.settlers[0]!.homeId = 99999)],
      ['workplaceId of nothing', (s) => void (s.settlers[0]!.workplaceId = 99999)],
      ['homeId of a settler id', (s) => void (s.settlers[0]!.homeId = s.settlers[1]!.id)],
      ['eat task on a missing building', (s) => void (s.settlers[0]!.task = { kind: 'eat', buildingId: 4242, phase: 'moving', progress: 0 })],
      ['haul to a missing site', (s) => void (s.settlers[0]!.task = { kind: 'haul', resource: 'wood', amount: 1, fromBuildingId: null, toBuildingId: 4242, phase: 'moving', progress: 0 })],
      ['gather with a missing drop-off', (s) => void (s.settlers[0]!.task = { kind: 'gather', resource: 'wood', targetTile: { x: 1, y: 1 }, dropOffBuildingId: 4242, phase: 'moving', progress: 0 })],
      ['socialize with nobody', (s) => void (s.settlers[0]!.task = { kind: 'socialize', withSettlerId: 4242, phase: 'moving', progress: 0 })],
      ['duplicate settler id', (s) => void (s.settlers[1]!.id = s.settlers[0]!.id)],
      ['settler id equals a building id', (s) => void (s.settlers[1]!.id = s.buildings[0]!.id)],
      ['duplicate building id', (s) => void (s.buildings[1]!.id = s.buildings[0]!.id)],
      ['building layer cleared', (s) => void (s.world.building[s.buildings[0]!.origin.y * s.world.width + s.buildings[0]!.origin.x] = 0)],
      ['building layer with a ghost', (s) => void (s.world.building[0] = s.buildings[0]!.id)],
      ['building moved but layer not', (s) => void (s.buildings[0]!.origin.x += 1)],
      ['building footprint changed', (s) => void (s.buildings[0]!.footprint.w = 5)],
      ['building outside the map', (s) => void (s.buildings[0]!.origin = { x: s.world.width - 1, y: 0 })],
      ['construction without status', (s) => void (s.buildings[0]!.construction = { kind: 'new', progress: 0, workDone: 0, required: s.colony.stock, delivered: s.colony.stock })],
      ['too many residents', (s) => void s.settlers.forEach((x) => void (x.homeId = s.buildings[0]!.id))],
      ['active event with a missing target', (s) => void s.activeEvents.push({ id: 1, kind: 'cropBlight', startedTick: 0, hoursRemaining: 5, magnitude: 0.5, targetId: 31337, tile: null })],
      ['pending decision with a weird payload', (s) => void s.pendingDecisions.push({ eventId: 1, kind: 'traderVisit', payload: { a: {} as never }, hoursLeft: 2 })],
    ];
    for (const [name, mutate] of cases) {
      const state = clone();
      mutate(state);
      expect(validateGameState(state).ok, name).toBe(false);
    }
  });

  it('rejects prototype-polluting keys anywhere', () => {
    const text = JSON.stringify(base);
    const poisonedProto = JSON.parse(text.replace('"seedNumber"', '"__proto__":{"polluted":1},"seedNumber"')) as unknown;
    expect(validateGameState(poisonedProto).ok).toBe(false);
    const withConstructor = JSON.parse(text.replace('"hunger"', '"constructor":{"x":1},"hunger"')) as unknown;
    expect(validateGameState(withConstructor).ok).toBe(false);
    const nested = clone();
    (nested.settlers[0]!.status.damageLog as Record<string, number>).prototype = 1;
    expect(validateGameState(nested).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts legitimate variety: dead settlers, damaged buildings, a lost game', () => {
    const state = clone();
    state.settlers.pop();
    expect(validateGameState(state).ok).toBe(true);
    state.settlers = [];
    state.outcome = { status: 'lost', reason: 'x', endedTick: state.time.tick };
    for (const b of state.buildings) b.output.wood = 3;
    expect(validateGameState(state).ok).toBe(true);
  });
});

describe('applyCommand hardening', () => {
  it('never throws and returns a result for malformed commands', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'placeBuilding',
      {},
      { type: 'nope' },
      { type: 'placeBuilding' },
      { type: 'placeBuilding', buildingType: 'constructor', x: 1, y: 1 },
      { type: 'placeBuilding', buildingType: '__proto__', x: 1, y: 1 },
      { type: 'placeBuilding', buildingType: 'house', x: 1.5, y: 1 },
      { type: 'placeBuilding', buildingType: 'house', x: NaN, y: 1 },
      { type: 'placeBuilding', buildingType: 'house', x: '3', y: 1 },
      { type: 'placeBuilding', buildingType: 'house', x: Infinity, y: 1 },
      { type: 'cancelBuilding', buildingId: 'x' },
      { type: 'cancelBuilding' },
      { type: 'demolishBuilding', buildingId: NaN },
      { type: 'setPriority', category: 'constructor', level: 1 },
      { type: 'setPriority', category: 'farming', level: 9 },
      { type: 'setPriority', category: 'farming', level: 1.5 },
      { type: 'setPriority', category: 'farming', level: '2' },
      { type: 'renameColony', name: 5 },
      { type: 'renameColony', name: '   ' },
      { type: 'renameColony' },
      { type: 'resolveEvent', eventId: 'x', accept: true },
      { type: 'resolveEvent', eventId: 1, accept: 'yes' },
      { type: 'acknowledgeVictory' },
    ];
    for (const command of bad) {
      const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
      const before = JSON.stringify(state);
      const result = applyCommand(state, command as never);
      expect(result, JSON.stringify(command)).toBeDefined();
      expect(result.ok, JSON.stringify(command)).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
      expect(Object.keys(state.colony.priorities)).toHaveLength(7);
    }
  });

  it('caps the colony name and acknowledging victory returns to playing', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    expect(applyCommand(state, { type: 'renameColony', name: 'x'.repeat(500) }).ok).toBe(true);
    expect(state.colony.name).toHaveLength(40);
    state.outcome = { status: 'won', reason: 'Thriving', endedTick: 5 };
    expect(applyCommand(state, { type: 'acknowledgeVictory' }).ok).toBe(true);
    expect(state.outcome.status).toBe('playing');
    expect(state.progress.victoryAcknowledged).toBe(true);
    expect(applyCommand(state, { type: 'acknowledgeVictory' }).ok).toBe(false);
  });
});

describe('createGame hardening', () => {
  it('clamps and validates options', () => {
    const state = createGame({ seed: 's'.repeat(1000), preset: 'moon', mapSize: 'huge', colonyName: 'n'.repeat(1000), difficulty: 'nightmare' } as never);
    expect(state.meta.seed).toHaveLength(64);
    expect(state.colony.name).toHaveLength(40);
    expect(state.meta.preset).toBe(DEFAULT_NEW_GAME_OPTIONS.preset);
    expect(state.meta.mapSize).toBe(DEFAULT_NEW_GAME_OPTIONS.mapSize);
    expect(state.meta.difficulty).toBe(DEFAULT_NEW_GAME_OPTIONS.difficulty);
    expect(validateGameState(state).ok).toBe(true);
    const blank = createGame({ seed: '', preset: 'continent', mapSize: 'small', colonyName: '   ', difficulty: 'normal' });
    expect(blank.colony.name).toBe(DEFAULT_NEW_GAME_OPTIONS.colonyName);
    expect(blank.meta.seed).toBe(DEFAULT_NEW_GAME_OPTIONS.seed);
    for (const junk of [null, undefined, 5, 'x', []]) {
      expect(validateGameState(createGame(junk as never)).ok).toBe(true);
    }
  });
});

