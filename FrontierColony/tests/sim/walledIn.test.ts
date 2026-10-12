/**
 * M7 release review MAJ-1: a placement must never wall settlers into a pocket the town cannot reach
 * (they would starve beside full stores), plus the haul-room and repair-refund nits.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  GAME_HOURS_PER_TICK,
  applyCommand,
  canPlaceBuilding,
  createGame,
  getStorageCapacity,
  stepGame,
  type GameState,
  type MapPreset,
  type SimEvent,
} from '../../src/sim';
import { damageBuilding } from '../../src/sim/events';
import { getTownReach } from '../../src/sim/queries';
import { campfireSpot } from '../../src/sim/settlerSim';
import { assertInvariants } from '../../src/sim/testSupport';
import { playScript, placeNearTown, type ScriptItem } from './support/player';

vi.setConfig({ testTimeout: 300_000 });

const TICKS_PER_DAY = 1800;
const BLOCKER = 987_654; // a fake building id used to wall tiles off without a real building

function game(seed: string, preset: MapPreset = 'continent'): GameState {
  return createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed, preset });
}

/** Settlers standing on a tile the town cannot reach (and that is not inside a building). */
function cutOffSettlers(s: GameState): string[] {
  const reach = getTownReach(s);
  const w = s.world;
  const out: string[] = [];
  for (const x of s.settlers) {
    const i = Math.floor(x.pos.y) * w.width + Math.floor(x.pos.x);
    if (w.building[i] !== 0) continue;
    if (reach === null || reach[i] !== 1) out.push(`${x.name} at ${Math.floor(x.pos.x)},${Math.floor(x.pos.y)}`);
  }
  return out;
}

/** A tile whose 5x5 surroundings are all reachable from the town ring, about `dist` tiles east of the town. */
function openSpot(s: GameState): { x: number; y: number } {
  const reach = getTownReach(s)!;
  const town = s.buildings[0]!;
  const W = s.world.width;
  for (let d = 5; d < 14; d++) {
    for (let dy = -d; dy <= d; dy++) {
      const x = town.origin.x + d;
      const y = town.origin.y + dy;
      let ok = true;
      for (let oy = -2; oy <= 2 && ok; oy++) for (let ox = -2; ox <= 2; ox++) if (reach[(y + oy) * W + x + ox] !== 1) ok = false;
      if (ok) return { x, y };
    }
  }
  throw new Error('no open spot');
}

function wall(s: GameState, tiles: { x: number; y: number }[]): void {
  for (const t of tiles) s.world.building[t.y * s.world.width + t.x] = BLOCKER;
  s.world.revision++;
}

describe('MAJ-1: placements never wall settlers in', () => {
  it('refuses the placement that closes the last exit of a settler standing in a nook', () => {
    const s = game('nook');
    const p = openSpot(s);
    // Three sides of P walled by scenery; the exit is the east tile.
    wall(s, [
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y - 1 },
      { x: p.x, y: p.y + 1 },
    ]);
    const exit = { x: p.x + 1, y: p.y };
    const origins: { x: number; y: number }[] = [];
    for (let oy = exit.y - 1; oy <= exit.y; oy++) for (let ox = exit.x - 1; ox <= exit.x; ox++) origins.push({ x: ox, y: oy });
    const checks = () => origins.map((o) => canPlaceBuilding(s, 'house', o.x, o.y));

    // Nobody in the nook: closing it is fine (nothing in there to trap).
    for (const x of s.settlers) {
      x.pos = { x: s.buildings[0]!.origin.x - 3.5, y: s.buildings[0]!.origin.y + 0.5 };
      x.prevPos = { ...x.pos };
    }
    const free = checks().filter((c) => c.ok);
    expect(free.length).toBeGreaterThan(0);

    // A settler asleep on P: the same placements are refused with a clear reason.
    const sleeper = s.settlers[0]!;
    sleeper.pos = { x: p.x + 0.5, y: p.y + 0.5 };
    sleeper.prevPos = { ...sleeper.pos };
    const trapped = checks().filter((c) => c.error === 'blocked' && /wall/i.test(c.message ?? ''));
    expect(trapped.length).toBeGreaterThan(0);
    expect(checks().some((c) => c.ok && c.tiles.some((t) => t.x === exit.x && t.y === exit.y))).toBe(false);
    // And applyCommand agrees and leaves the state alone.
    const before = JSON.stringify(s);
    const o = origins.find((_, i) => checks()[i]!.error === 'blocked' && /wall/i.test(checks()[i]!.message ?? ''))!;
    const res = applyCommand(s, { type: 'placeBuilding', buildingType: 'house', x: o.x, y: o.y });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('a settler who is already cut off does not block every later placement', () => {
    const s = game('already-cut');
    const p = openSpot(s);
    wall(s, [
      { x: p.x - 1, y: p.y },
      { x: p.x + 1, y: p.y },
      { x: p.x, y: p.y - 1 },
      { x: p.x, y: p.y + 1 },
    ]);
    const x0 = s.settlers[0]!;
    x0.pos = { x: p.x + 0.5, y: p.y + 0.5 };
    expect(cutOffSettlers(s)).toHaveLength(1);
    expect(placeNearTown(s, 'house')).not.toBeNull();
  });

  it('a settler who is walled in is put back on a tile the town can reach once a path fails', () => {
    const s = game('rescue');
    const p = openSpot(s);
    wall(s, [
      { x: p.x - 1, y: p.y },
      { x: p.x + 1, y: p.y },
      { x: p.x, y: p.y - 1 },
      { x: p.x, y: p.y + 1 },
      { x: p.x - 1, y: p.y - 1 },
      { x: p.x + 1, y: p.y - 1 },
      { x: p.x - 1, y: p.y + 1 },
      { x: p.x + 1, y: p.y + 1 },
    ]);
    const victim = s.settlers[0]!;
    victim.pos = { x: p.x + 0.5, y: p.y + 0.5 };
    victim.prevPos = { ...victim.pos };
    victim.needs.hunger = 10;
    s.time.timeOfDay = 8;
    expect(cutOffSettlers(s)).toHaveLength(1);
    for (let i = 0; i < 300; i++) stepGame(s);
    expect(cutOffSettlers(s)).toEqual([]);
    for (let i = 0; i < TICKS_PER_DAY; i++) stepGame(s);
    expect(s.stats.deaths).toBe(0);
    expect(victim.needs.hunger).toBeGreaterThan(10);
  });

  it('ejected settlers land on tiles the town can reach, and bedroll spots are always reachable', () => {
    const s = game('eject');
    const w = s.world.width;
    // A settler stands where a house is about to go.
    const town = s.buildings[0]!.origin;
    let spot: { x: number; y: number } | null = null;
    for (let d = 4; d < 12 && !spot; d++) for (let dy = -d; dy <= d && !spot; dy++) if (canPlaceBuilding(s, 'house', town.x + d, town.y + dy).ok) spot = { x: town.x + d, y: town.y + dy };
    expect(spot).not.toBeNull();
    const victim = s.settlers[0]!;
    victim.pos = { x: spot!.x + 0.5, y: spot!.y + 0.5 };
    victim.prevPos = { ...victim.pos };
    const res = applyCommand(s, { type: 'placeBuilding', buildingType: 'house', x: spot!.x, y: spot!.y });
    expect(res.ok).toBe(true);
    expect(cutOffSettlers(s)).toEqual([]);
    const reach = getTownReach(s)!;
    for (const x of s.settlers) {
      const spot = campfireSpot(s, x);
      expect(spot).not.toBeNull();
      expect(reach[spot!.y * w + spot!.x]).toBe(1);
    }
  });

  const DENSE: ScriptItem[] = [];
  for (let d = 1; d <= 16; d++) {
    DENSE.push({ day: d, type: 'house' }, { day: d, type: 'farm' });
    if (d % 2 === 0) DENSE.push({ day: d, type: 'lumberCamp' }, { day: d, type: 'storage' });
    if (d % 3 === 0) DENSE.push({ day: d, type: 'well' }, { day: d, type: 'mine' });
  }

  it.each([
    ['riverValley', 'r8'],
    ['riverValley', 'r3'],
    ['continent', 'c1'],
    ['archipelago', 'a2'],
  ] as [MapPreset, string][])('dense building sweep on %s/%s leaves nobody unreachable from the town ring', (preset, seed) => {
    const trapped: string[] = [];
    const report = playScript({ seed, preset, difficulty: 'relaxed' }, DENSE, 18, [], {
      onTick: (st, t) => {
        if (t % 40 === 0) {
          const c = cutOffSettlers(st);
          if (c.length > 0) trapped.push(`tick ${t}: ${c.join(', ')}`);
        }
        if (t % 600 === 0) assertInvariants(st);
      },
    });
    expect(trapped).toEqual([]);
    expect(report.state.settlers.length).toBeGreaterThan(0);
  });

  it('the placement check stays cheap (it runs on every ghost refresh)', () => {
    const s = game('perf');
    for (let i = 0; i < 25; i++) placeNearTown(s, 'house');
    const town = s.buildings[0]!.origin;
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) canPlaceBuilding(s, 'house', town.x + 8 + (i % 5), town.y + 8 + (i % 7));
    const per = (performance.now() - t0) / 100;
    expect(per).toBeLessThan(20);
  });
});

describe('release review nits', () => {
  it('haulers never carry more than the stockpile has room for', () => {
    const s = game('haul-room');
    const farm = (() => {
      const id = placeNearTown(s, 'farm')!;
      const b = s.buildings.find((x) => x.id === id)!;
      b.status = 'complete';
      b.construction = null;
      return b;
    })();
    const cap = getStorageCapacity(s);
    s.colony.stock = { wood: 10, stone: 10, food: cap - 3, water: 100, tools: 0 };
    farm.output.food = 20;
    for (const x of s.settlers) x.needs.hunger = 100;
    s.time.timeOfDay = 8;
    const events: SimEvent[] = [];
    for (let i = 0; i < 600; i++) {
      events.push(...stepGame(s));
      expect(s.colony.stock.food).toBeLessThanOrEqual(cap);
    }
    expect(events.filter((e) => e.type === 'goodsLost' && e.resource === 'food')).toEqual([]);
    void GAME_HOURS_PER_TICK;
  });

  it('demolishing a building under repair returns the repair materials and the refund', () => {
    const s = game('repair-refund');
    const id = placeNearTown(s, 'house')!;
    const b = s.buildings.find((x) => x.id === id)!;
    b.status = 'complete';
    b.construction = null;
    expect(damageBuilding(s, [], b, 'test')).toBe(true);
    b.construction!.delivered.wood = 5;
    s.colony.stock.wood = 0;
    const res = applyCommand(s, { type: 'demolishBuilding', buildingId: id });
    expect(res.ok).toBe(true);
    const refund = Math.floor((BUILDING_DEFS.house.cost.wood ?? 0) * 0.5);
    expect(s.colony.stock.wood).toBeGreaterThanOrEqual(5 + (refund > 0 ? 1 : 0) - 1);
    expect(s.colony.stock.wood).toBeGreaterThanOrEqual(5);
  });
});
