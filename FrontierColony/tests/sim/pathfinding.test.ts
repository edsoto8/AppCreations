import { describe, expect, it, vi } from 'vitest';
import { TERRAIN_DEFS } from '../../src/sim/balance';
import { createRng, nextFloat, nextInt } from '../../src/sim/rng';
import { accessGoal, findPath, getLastPathStats, isPassable, tileGoal, type PathGoal } from '../../src/sim/pathfinding';
import { Terrain, type WorldState } from '../../src/sim/types';

// Several tests here are heavy (many generations or thousands of ticks); allow for a loaded CI machine.
vi.setConfig({ testTimeout: 60_000 });

const SQRT2 = Math.sqrt(2);

function makeWorld(width: number, height: number, fill: number = Terrain.Grass): WorldState {
  const n = width * height;
  return {
    width,
    height,
    terrain: new Array<number>(n).fill(fill),
    elevation: new Array<number>(n).fill(0),
    resource: new Array<number>(n).fill(0),
    building: new Array<number>(n).fill(0),
    revision: 0,
  };
}

/** Parse an ASCII map: '.' grass, '#' deep water, '^' mountain, 'f' forest, '~' shallow, 'B' building. */
function parse(rows: string[]): WorldState {
  const world = makeWorld(rows[0]!.length, rows.length);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = y * world.width + x;
      if (ch === '#') world.terrain[i] = Terrain.DeepWater;
      else if (ch === '^') world.terrain[i] = Terrain.Mountain;
      else if (ch === 'f') world.terrain[i] = Terrain.Forest;
      else if (ch === '~') world.terrain[i] = Terrain.ShallowWater;
      else if (ch === 'B') world.building[i] = 99;
    }),
  );
  return world;
}

/** Independent reference: Dijkstra with the same movement rules. Returns the optimal cost or null. */
function referenceCost(world: WorldState, sx: number, sy: number, goal: PathGoal): number | null {
  const W = world.width;
  const H = world.height;
  const dist = new Array<number>(W * H).fill(Infinity);
  const done = new Array<boolean>(W * H).fill(false);
  dist[sy * W + sx] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (best < 0 || dist[i]! < dist[best]!)) best = i;
    if (best < 0) return null;
    done[best] = true;
    const x = best % W;
    const y = (best - x) / W;
    if (x >= goal.x0 && x <= goal.x1 && y >= goal.y0 && y <= goal.y1) return dist[best]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !isPassable(world, ny * W + nx)) continue;
        if (dx !== 0 && dy !== 0 && (!isPassable(world, y * W + nx) || !isPassable(world, ny * W + x))) continue;
        const cost = TERRAIN_DEFS[world.terrain[ny * W + nx] as Terrain].moveCost * (dx !== 0 && dy !== 0 ? SQRT2 : 1);
        if (dist[best]! + cost < dist[ny * W + nx]!) dist[ny * W + nx] = dist[best]! + cost;
      }
    }
  }
}

function pathCost(world: WorldState, sx: number, sy: number, path: { x: number; y: number }[]): number {
  let cost = 0;
  let px = sx;
  let py = sy;
  for (const p of path) {
    const diagonal = p.x !== px && p.y !== py;
    cost += TERRAIN_DEFS[world.terrain[p.y * world.width + p.x] as Terrain].moveCost * (diagonal ? SQRT2 : 1);
    px = p.x;
    py = p.y;
  }
  return cost;
}

describe('A*', () => {
  it('finds straight and diagonal optimal paths', () => {
    const world = makeWorld(10, 10);
    const straight = findPath(world, 0, 0, tileGoal(5, 0))!;
    expect(straight.path).toHaveLength(5);
    expect(straight.cost).toBeCloseTo(5, 9);
    const diagonal = findPath(world, 0, 0, tileGoal(4, 4))!;
    expect(diagonal.cost).toBeCloseTo(4 * SQRT2, 9);
    expect(diagonal.path.at(-1)).toEqual({ x: 4, y: 4 });
    expect(findPath(world, 3, 3, tileGoal(3, 3))).toEqual({ path: [], cost: 0 });
  });

  it('matches an independent Dijkstra on 150 random maps with water, mountains, forest and buildings', () => {
    const rng = createRng(2024);
    let compared = 0;
    let unreachable = 0;
    for (let n = 0; n < 150; n++) {
      const world = makeWorld(14, 14);
      for (let i = 0; i < world.terrain.length; i++) {
        const r = nextFloat(rng);
        world.terrain[i] = r < 0.12 ? Terrain.DeepWater : r < 0.2 ? Terrain.Mountain : r < 0.3 ? Terrain.Forest : r < 0.36 ? Terrain.ShallowWater : r < 0.4 ? Terrain.Hills : Terrain.Grass;
        if (nextFloat(rng) < 0.08) world.building[i] = 7;
      }
      world.revision++;
      let sx = 0;
      let sy = 0;
      do {
        sx = nextInt(rng, 0, 13);
        sy = nextInt(rng, 0, 13);
      } while (!isPassable(world, sy * 14 + sx));
      const gx = nextInt(rng, 0, 13);
      const gy = nextInt(rng, 0, 13);
      const goal: PathGoal = nextFloat(rng) < 0.5 ? tileGoal(gx, gy) : { x0: gx, y0: gy, x1: Math.min(13, gx + 2), y1: Math.min(13, gy + 1) };
      const expected = referenceCost(world, sx, sy, goal);
      const result = findPath(world, sx, sy, goal, 100000);
      if (expected === null) {
        expect(result).toBeNull();
        unreachable++;
        continue;
      }
      expect(result).not.toBeNull();
      expect(result!.cost).toBeCloseTo(expected, 6);
      expect(pathCost(world, sx, sy, result!.path)).toBeCloseTo(expected, 6);
      // Every step is legal: passable, adjacent, and no corner cutting.
      let px = sx;
      let py = sy;
      for (const p of result!.path) {
        expect(Math.max(Math.abs(p.x - px), Math.abs(p.y - py))).toBe(1);
        expect(isPassable(world, p.y * 14 + p.x)).toBe(true);
        if (p.x !== px && p.y !== py) {
          expect(isPassable(world, py * 14 + p.x)).toBe(true);
          expect(isPassable(world, p.y * 14 + px)).toBe(true);
        }
        px = p.x;
        py = p.y;
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(60);
    expect(unreachable).toBeGreaterThan(5);
  });

  it('avoids deep water and mountains and walks through the gap', () => {
    const world = parse([
      '.....#....',
      '.....#....',
      '.....^....',
      '.....#....',
      '..........',
    ]);
    const result = findPath(world, 0, 0, tileGoal(9, 0))!;
    expect(result.path.some((p) => p.y === 4)).toBe(true);
    for (const p of result.path) expect([Terrain.DeepWater, Terrain.Mountain]).not.toContain(world.terrain[p.y * 10 + p.x]);
  });

  it('does not cut corners between two blocked tiles', () => {
    const world = parse(['.#', '#.']);
    expect(findPath(world, 0, 0, tileGoal(1, 1))).toBeNull();
    const open = parse(['.#.', '#..', '...']);
    const r = findPath(open, 0, 0, tileGoal(2, 0));
    expect(r).toBeNull(); // (0,0) is sealed in by the diagonal wall
  });

  it('prefers cheap terrain over a shorter path through forest or shallow water', () => {
    const world = parse(['.fffffff.', '.fffffff.', '.........']);
    const r = findPath(world, 0, 0, tileGoal(8, 0))!;
    expect(r.cost).toBeLessThan(7 * 1.4 + 2);
    expect(r.path.some((p) => p.y === 2)).toBe(true);
  });

  it('walks through shallow water when it is the only way', () => {
    const world = parse(['.~~.']);
    expect(findPath(world, 0, 0, tileGoal(3, 0))!.cost).toBeCloseTo(1 + 2.5 + 2.5, 9);
  });

  it('treats buildings as walls and reaches the tiles around them', () => {
    const world = parse(['.....', '.BBB.', '.BBB.', '.....']);
    expect(findPath(world, 0, 0, tileGoal(2, 1))).toBeNull();
    // (0,0) is on the access ring of the building, so there is nothing to walk.
    expect(findPath(world, 0, 0, accessGoal(1, 1, 3, 2))!.path).toHaveLength(0);
    const wide = parse(['.......', '..BBB..', '..BBB..', '.......']);
    const toRing = findPath(wide, 6, 3, accessGoal(2, 1, 3, 2))!;
    expect(toRing.path.length).toBeLessThanOrEqual(1);
    const inner = parse(['.......', '.......', '...B...', '.......']);
    const r = findPath(inner, 0, 0, tileGoal(6, 3))!;
    for (const p of r.path) expect(p.x === 3 && p.y === 2).toBe(false);
  });

  it('returns null for unreachable targets without expanding nodes (region reject)', () => {
    const world = parse(['..#..', '..#..', '..#..']);
    expect(findPath(world, 0, 0, tileGoal(4, 0))).toBeNull();
    expect(getLastPathStats().rejected).toBe(true);
    expect(getLastPathStats().iterations).toBe(0);
  });

  it('unreachable because of a building is found by search, not reject', () => {
    const world = parse(['..B..', '..B..', '..B..']);
    expect(findPath(world, 0, 0, tileGoal(4, 0))).toBeNull();
  });

  it('stays within the iteration cap', () => {
    const world = makeWorld(60, 60);
    const capped = findPath(world, 0, 0, tileGoal(59, 59), 50);
    expect(capped).toBeNull();
    expect(getLastPathStats().capped).toBe(true);
    expect(getLastPathStats().iterations).toBeLessThanOrEqual(51);
    const ok = findPath(world, 0, 0, tileGoal(59, 59))!;
    expect(ok.cost).toBeCloseTo(59 * SQRT2, 6);
    expect(getLastPathStats().iterations).toBeLessThan(20000);
  });

  it('is fast on a large open map', () => {
    const world = makeWorld(128, 128);
    findPath(world, 0, 0, tileGoal(127, 127));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) findPath(world, 3, 5, tileGoal(120, 100 + (i % 5)));
    expect((performance.now() - t0) / 20).toBeLessThan(15);
  });
});
