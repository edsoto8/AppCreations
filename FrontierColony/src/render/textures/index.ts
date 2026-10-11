/**
 * Builds every procedural texture once, packs them into atlas pages and exposes them by role.
 * Variant arrays are indexed by a per-tile hash so the same tile always shows the same art.
 */
import type { Texture } from 'pixi.js';
import { AtlasBuilder } from './atlas';
import type { Art } from './canvas';
import { makeCliffStrip, type CliffMaterial } from './cliffs';
import {
  makeBush,
  makeFlowerPatch,
  makeLilyPad,
  makePebbles,
  makeReeds,
  makeShell,
  makeSparkle,
  makeStump,
  makeTuft,
} from './decals';
import { makeSelectionRing, makeSettlerHair, makeSettlerHead, makeSettlerLegs, makeSettlerTorso, makeSoftShadow } from './entities';
import {
  EDGE_DIRS,
  makeFoamEdge,
  makeForestFloor,
  makeFringe,
  makeGrassTile,
  makeHillsGround,
  makeRockGround,
  makeSandTile,
  makeWaterTile,
  makeWetEdge,
  type EdgeDir,
  type FringeMaterial,
} from './groundTiles';
import { makeMountain, makeQuarriedMountain, makeRockCluster, makeRubble, MOUNTAIN_VARIANTS, ROCK_LEVELS, ROCK_VARIANTS, SNOW_LEVELS } from './rocks';
import { makeTreeCluster, TREE_LEVELS, TREE_SPECIES, TREE_VARIANTS, type TreeSpecies } from './trees';

export type EdgeSet = Record<EdgeDir, Texture>;

export interface TextureSet {
  grassPlain: Texture[];
  grassTuft: Texture[];
  grassFlower: Texture[];
  forestFloor: Texture[];
  sandPlain: Texture[];
  sandPebbles: Texture[];
  hills: Texture[];
  rockGround: Texture[];
  water: Texture[];
  fringe: Record<FringeMaterial, EdgeSet>;
  wet: EdgeSet;
  foam: EdgeSet;
  cliffs: Record<CliffMaterial, { lip: Texture[]; mid: Texture[] }>;
  tuft: Texture[];
  flowerPatch: Texture[];
  bush: Texture[];
  pebbles: Texture[];
  shell: Texture[];
  reeds: Texture[];
  lily: Texture[];
  stump: Texture;
  sparkle: Texture;
  /** trees[species][level - 1][variant] */
  trees: Record<TreeSpecies, Texture[][]>;
  /** rocks[level - 1][variant] */
  rocks: Texture[][];
  rubble: Texture[];
  /** mountains[snow][variant][flip ? 1 : 0] */
  mountains: Texture[][][];
  quarried: Texture[];
  settler: { legs: Texture; torso: Texture; head: Texture; hair: Texture };
  selectionRing: Texture;
  softShadow: Texture;
  /** Atlas page canvases, for debugging only. */
  pages: HTMLCanvasElement[];
  destroy(): void;
}

export function buildTextureSet(): TextureSet {
  const atlas = new AtlasBuilder();
  const keys: string[] = [];
  const add = (key: string, art: Art): string => {
    atlas.add(key, art);
    keys.push(key);
    return key;
  };
  const list = (prefix: string, n: number, make: (i: number) => Art): string[] => Array.from({ length: n }, (_, i) => add(`${prefix}${i}`, make(i)));

  const grassPlain = list('grassPlain', 6, (i) => makeGrassTile(i + 1));
  const grassTuft = list('grassTuft', 4, (i) => makeGrassTile(i + 20, { tufts: 2 + (i % 2) }));
  const grassFlower = list('grassFlower', 4, (i) => makeGrassTile(i + 40, { tufts: 1, flowers: i === 3 ? 2 : 1 }));
  const forestFloor = list('forestFloor', 4, (i) => makeForestFloor(i + 1));
  const sandPlain = list('sandPlain', 4, (i) => makeSandTile(i + 1));
  const sandPebbles = list('sandPebbles', 2, (i) => makeSandTile(i + 30, { pebbles: true }));
  const hills = list('hills', 5, (i) => makeHillsGround(i + 1));
  const rockGround = list('rockGround', 4, (i) => makeRockGround(i + 1));
  const water = list('water', 4, (i) => makeWaterTile(i + 1));

  const fringeMats: FringeMaterial[] = ['grass', 'sand', 'forest', 'hills', 'rock'];
  const fringeKeys: Record<string, string> = {};
  for (const m of fringeMats) EDGE_DIRS.forEach((d, i) => (fringeKeys[`${m}.${d}`] = add(`fringe.${m}.${d}`, makeFringe(m, d, 100 + i * 17 + m.length))));
  const wetKeys = EDGE_DIRS.map((d, i) => add(`wet.${d}`, makeWetEdge(d, 200 + i)));
  const foamKeys = EDGE_DIRS.map((d, i) => add(`foam.${d}`, makeFoamEdge(d, 300 + i)));

  const cliffMats: CliffMaterial[] = ['soil', 'rock', 'sand'];
  const cliffKeys: Record<string, { lip: string[]; mid: string[] }> = {};
  for (const m of cliffMats) {
    cliffKeys[m] = {
      lip: list(`cliff.${m}.lip`, 3, (i) => makeCliffStrip(m, 'lip', i + 1)),
      mid: list(`cliff.${m}.mid`, 3, (i) => makeCliffStrip(m, 'mid', i + 11)),
    };
  }

  const tuft = list('tuft', 3, (i) => makeTuft(i + 1));
  const flowerPatch = list('flowerPatch', 5, (i) => makeFlowerPatch(i));
  const bush = list('bush', 2, (i) => makeBush(i + 1));
  const pebbles = list('pebbles', 3, (i) => makePebbles(i + 1));
  const shell = list('shell', 2, (i) => makeShell(i));
  const reeds = list('reeds', 3, (i) => makeReeds(i + 1));
  const lily = list('lily', 2, (i) => makeLilyPad(i + 1));
  const stump = add('stump', makeStump());
  const sparkle = add('sparkle', makeSparkle());

  const treeKeys: Record<string, string[][]> = {};
  for (const sp of TREE_SPECIES) {
    treeKeys[sp] = Array.from({ length: TREE_LEVELS }, (_, l) => list(`tree.${sp}.${l + 1}.`, TREE_VARIANTS, (v) => makeTreeCluster(sp, l + 1, v)));
  }
  const rockKeys = Array.from({ length: ROCK_LEVELS }, (_, l) => list(`rock.${l + 1}.`, ROCK_VARIANTS, (v) => makeRockCluster(l + 1, v)));
  const rubble = list('rubble', 3, (i) => makeRubble(i + 1));
  const mountainKeys = Array.from({ length: SNOW_LEVELS }, (_, s) =>
    Array.from({ length: MOUNTAIN_VARIANTS }, (_, v) => [add(`mtn.${s}.${v}.0`, makeMountain(v, s, false)), add(`mtn.${s}.${v}.1`, makeMountain(v, s, true))]),
  );
  const quarried = list('quarried', 2, (i) => makeQuarriedMountain(i + 1));

  const sKeys = {
    legs: add('settler.legs', makeSettlerLegs()),
    torso: add('settler.torso', makeSettlerTorso()),
    head: add('settler.head', makeSettlerHead()),
    hair: add('settler.hair', makeSettlerHair()),
  };
  const ring = add('ui.ring', makeSelectionRing());
  const softShadow = add('ui.shadow', makeSoftShadow());

  const { textures, pages, sources } = atlas.build();
  const t = (k: string): Texture => {
    const tex = textures.get(k);
    if (!tex) throw new Error(`missing texture ${k}`);
    return tex;
  };
  const ts = (ks: string[]): Texture[] => ks.map(t);
  const edgeSet = (ks: string[]): EdgeSet => ({ ne: t(ks[0]!), se: t(ks[1]!), sw: t(ks[2]!), nw: t(ks[3]!) });
  const fringe = {} as Record<FringeMaterial, EdgeSet>;
  for (const m of fringeMats) fringe[m] = { ne: t(fringeKeys[`${m}.ne`]!), se: t(fringeKeys[`${m}.se`]!), sw: t(fringeKeys[`${m}.sw`]!), nw: t(fringeKeys[`${m}.nw`]!) };
  const cliffs = {} as TextureSet['cliffs'];
  for (const m of cliffMats) cliffs[m] = { lip: ts(cliffKeys[m]!.lip), mid: ts(cliffKeys[m]!.mid) };
  const trees = {} as TextureSet['trees'];
  for (const sp of TREE_SPECIES) trees[sp] = treeKeys[sp]!.map(ts);

  return {
    grassPlain: ts(grassPlain),
    grassTuft: ts(grassTuft),
    grassFlower: ts(grassFlower),
    forestFloor: ts(forestFloor),
    sandPlain: ts(sandPlain),
    sandPebbles: ts(sandPebbles),
    hills: ts(hills),
    rockGround: ts(rockGround),
    water: ts(water),
    fringe,
    wet: edgeSet(wetKeys),
    foam: edgeSet(foamKeys),
    cliffs,
    tuft: ts(tuft),
    flowerPatch: ts(flowerPatch),
    bush: ts(bush),
    pebbles: ts(pebbles),
    shell: ts(shell),
    reeds: ts(reeds),
    lily: ts(lily),
    stump: t(stump),
    sparkle: t(sparkle),
    trees,
    rocks: rockKeys.map(ts),
    rubble: ts(rubble),
    mountains: mountainKeys.map((perSnow) => perSnow.map(ts)),
    quarried: ts(quarried),
    settler: { legs: t(sKeys.legs), torso: t(sKeys.torso), head: t(sKeys.head), hair: t(sKeys.hair) },
    selectionRing: t(ring),
    softShadow: t(softShadow),
    pages,
    destroy() {
      for (const tex of textures.values()) tex.destroy(false);
      for (const s of sources) s.destroy();
    },
  };
}
