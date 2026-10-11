import { describe, expect, it } from 'vitest';
import { Terrain, type WorldState } from '../../src/sim';
import { FOREST_REF_RESOURCE, HILLS_REF_RESOURCE, TerrainModel, isWaterTerrain, rockLevel, treeLevel } from '../../src/render/terrain/model';

function makeWorld(w: number, h: number, fill: number = Terrain.Grass): WorldState {
  const n = w * h;
  return {
    width: w,
    height: h,
    terrain: new Array<number>(n).fill(fill),
    elevation: new Array<number>(n).fill(0),
    resource: new Array<number>(n).fill(0),
    building: new Array<number>(n).fill(0),
    revision: 0,
  };
}

describe('treeLevel', () => {
  it('is 0 for a depleted tile and 1..5 as wood grows', () => {
    expect(treeLevel(0, FOREST_REF_RESOURCE)).toBe(0);
    expect(treeLevel(-3, FOREST_REF_RESOURCE)).toBe(0);
    expect(treeLevel(1, FOREST_REF_RESOURCE)).toBe(1);
    expect(treeLevel(8, FOREST_REF_RESOURCE)).toBe(1);
    expect(treeLevel(12, FOREST_REF_RESOURCE)).toBe(2);
    expect(treeLevel(20, FOREST_REF_RESOURCE)).toBe(3);
    expect(treeLevel(28, FOREST_REF_RESOURCE)).toBe(4);
    expect(treeLevel(40, FOREST_REF_RESOURCE)).toBe(5);
  });

  it('never decreases as the resource grows', () => {
    let prev = 0;
    for (let r = 0; r <= 60; r++) {
      const l = treeLevel(r, FOREST_REF_RESOURCE);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });
});

describe('rockLevel', () => {
  it('maps stone left to 0..4 boulders', () => {
    expect(rockLevel(0, HILLS_REF_RESOURCE)).toBe(0);
    expect(rockLevel(5, HILLS_REF_RESOURCE)).toBe(1);
    expect(rockLevel(30, HILLS_REF_RESOURCE)).toBe(3);
    expect(rockLevel(60, HILLS_REF_RESOURCE)).toBe(4);
  });
});

describe('TerrainModel', () => {
  it('reads terrain, forces water to sea level and derives density levels', () => {
    const w = makeWorld(8, 8);
    w.terrain[1] = Terrain.DeepWater;
    w.elevation[1] = 3;
    w.terrain[2] = Terrain.Forest;
    w.resource[2] = 40;
    w.elevation[2] = 2;
    const m = new TerrainModel(w);
    expect(m.elev[1]).toBe(0);
    expect(isWaterTerrain(m.terrain[1]!)).toBe(true);
    expect(m.elev[2]).toBe(2);
    expect(m.level[2]).toBe(5);
  });

  it('computes the distance from the shore for water tiles', () => {
    const w = makeWorld(9, 1, Terrain.DeepWater);
    w.terrain[0] = Terrain.Sand;
    const m = new TerrainModel(w);
    expect(m.shore[0]).toBe(0);
    expect(m.shore[1]).toBe(1);
    expect(m.shore[2]).toBe(2);
    expect(m.shore[5]).toBe(5);
  });

  it('reports exactly the tiles that changed, flagging structural changes', () => {
    const w = makeWorld(8, 8);
    w.terrain[10] = Terrain.Forest;
    w.resource[10] = 40;
    const m = new TerrainModel(w);
    const seen: { i: number; structural: boolean; prevT: number; prevL: number }[] = [];
    const cb = (i: number, structural: boolean, prevT: number, prevL: number) => seen.push({ i, structural, prevT, prevL });

    // resource-only change: not structural
    w.resource[10] = 10;
    m.syncTile(w, 2, 1, cb);
    expect(seen).toEqual([{ i: 10, structural: false, prevT: Terrain.Forest, prevL: 5 }]);

    // nothing changed: no callback
    seen.length = 0;
    m.syncTile(w, 2, 1, cb);
    expect(seen).toHaveLength(0);

    // elevation change: structural, found by a full sync
    w.elevation[20] = 1;
    w.revision++;
    m.sync(w, cb);
    expect(seen.map((s) => s.i)).toEqual([20]);
    expect(seen[0]!.structural).toBe(true);
    expect(m.revision).toBe(w.revision);
  });

  it('remembers a stump when a forest is cut down to grass', () => {
    const w = makeWorld(4, 4);
    w.terrain[5] = Terrain.Forest;
    w.resource[5] = 3;
    const m = new TerrainModel(w);
    expect(m.stump[5]).toBe(0);
    w.terrain[5] = Terrain.Grass;
    w.resource[5] = 0;
    m.syncTile(w, 1, 1, () => {});
    expect(m.stump[5]).toBe(1);
    // and forgets it when the tile becomes something else
    w.terrain[5] = Terrain.Sand;
    m.syncTile(w, 1, 1, () => {});
    expect(m.stump[5]).toBe(0);
  });

  it('clamps elevation lookups to the map', () => {
    const w = makeWorld(4, 4);
    w.elevation[0] = 2;
    const m = new TerrainModel(w);
    expect(m.elevAt(-5, -5)).toBe(2);
    expect(m.elevAt(99, 99)).toBe(m.elev[15]);
  });
});
