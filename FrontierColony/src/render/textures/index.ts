/**
 * Builds every procedural texture once, packs them into atlas pages and exposes them by role.
 * Variant arrays are indexed by a per-tile hash so the same tile always shows the same art.
 */
import type { Texture } from 'pixi.js';
import type { SeasonalSet } from './seasonal';
import { AtlasBuilder } from './atlas';
import type { Art } from './canvas';
import { makeBankStrip, makeCliffStrip, type CliffMaterial } from './cliffs';
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
import { makeSelectionRing, makeSoftShadow } from './entities';
import { bakeFarm, bakeHouse, bakeLumberCamp, bakeMine, bakeStorage, bakeTownCenter, bakeWell, bakeWorkshop, FARM_STAGES, HOUSE_VARIANTS } from './buildings';
import { makeAsh, makeCampfire, makeChip, makeCloud, makeFlame, makeGlow, makeLeaf, makePuff, makeResourceIcon, makeRing, makeSickBadge, makeSoftDot, makeSpark, makeStreak, makeTorchPost } from './fx';
import { makeCratePile, makeLogPile, makePlankPile, makeProducePile, makeSitePad, makeStonePile } from './piles';
import {
  makeAxe,
  makeBadge,
  makeBlanket,
  makeBucket,
  makeCrateSmall,
  makeHammer,
  makeHand,
  makeHair,
  makeHat,
  makeHead,
  makeHoe,
  makeLeg,
  makeLogBundle,
  makePick,
  makeRockCarry,
  makeSack,
  makeSleeve,
  makeSpeech,
  makeTorso,
  makeZ,
  type BadgeKind,
} from './settlerParts';
import { RESOURCE_TYPES, type ResourceType } from '../../sim';
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
  makeWaterBlend,
  type EdgeDir,
  type FringeMaterial,
} from './groundTiles';
import { makeMountain, makeOutcrop, makeQuarriedMountain, makeRubble, MOUNTAIN_VARIANTS, OUTCROP_KINDS, OUTCROP_TIERS, OUTCROP_VARIANTS, SNOW_LEVELS } from './rocks';
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
  waterBlend: EdgeSet;
  cliffs: Record<CliffMaterial, { lip: Texture[]; mid: Texture[] }>;
  bankGrass: Texture[];
  bankSand: Texture[];
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
  /** outcrops[kind][tier][variant] */
  outcrops: Texture[][][];
  rubble: Texture[];
  /** mountains[snow][variant][flip ? 1 : 0] */
  mountains: Texture[][][];
  quarried: Texture[];
  rig: {
    leg: Texture;
    torsoFront: Texture;
    torsoBack: Texture;
    sleeve: Texture;
    hand: Texture;
    headFront: Texture;
    headBack: Texture;
    hairFront: Texture[];
    hairBack: Texture[];
    hat: Texture;
  };
  tools: { axe: Texture; pick: Texture; hammer: Texture; hoe: Texture; bucket: Texture; bucketFull: Texture };
  carry: { logs: Texture; rock: Texture; sack: Texture; crate: Texture };
  badges: Record<BadgeKind, Texture>;
  fx: { z: Texture; dots: Texture; heart: Texture; note: Texture; blanket: Texture; dot: Texture; puff: Texture; chip: Texture; spark: Texture; leaf: Texture; streak: Texture; ring: Texture; cloud: Texture; flame: Texture; glow: Texture; campfire: Texture; torch: Texture; sick: Texture; ash: Texture[] };
  resIcons: Record<ResourceType, Texture>;
  buildings: {
    house: Texture[];
    townCenter: Texture;
    storage: Texture;
    workshop: Texture;
    farm: Texture[];
    lumberCamp: Texture;
    mine: Texture;
    well: Texture;
  };
  piles: { logs: Texture[]; stones: Texture[]; crates: Texture[]; produce: Texture[]; planks: Texture[] };
  pads: Record<1 | 2 | 3, Texture>;
  selectionRing: Texture;
  softShadow: Texture;
  /** Winter / autumn textures, baked in the background (null until ready). */
  seasonal: SeasonalSet | null;
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
  const hills = list('hills', 6, (i) => makeHillsGround(i + 1));
  const rockGround = list('rockGround', 4, (i) => makeRockGround(i + 1));
  const water = list('water', 4, (i) => makeWaterTile(i + 1));

  const fringeMats: FringeMaterial[] = ['grass', 'sand', 'forest', 'hills', 'rock'];
  const fringeKeys: Record<string, string> = {};
  for (const m of fringeMats) EDGE_DIRS.forEach((d, i) => (fringeKeys[`${m}.${d}`] = add(`fringe.${m}.${d}`, makeFringe(m, d, 100 + i * 17 + m.length))));
  const wetKeys = EDGE_DIRS.map((d, i) => add(`wet.${d}`, makeWetEdge(d, 200 + i)));
  const blendKeys = EDGE_DIRS.map((d) => add(`waterblend.${d}`, makeWaterBlend(d)));
  const foamKeys = EDGE_DIRS.map((d, i) => add(`foam.${d}`, makeFoamEdge(d, 300 + i)));

  const cliffMats: CliffMaterial[] = ['soil', 'rock', 'sand'];
  const cliffKeys: Record<string, { lip: string[]; mid: string[] }> = {};
  for (const m of cliffMats) {
    cliffKeys[m] = {
      lip: list(`cliff.${m}.lip`, 3, (i) => makeCliffStrip(m, 'lip', i + 1)),
      mid: list(`cliff.${m}.mid`, 3, (i) => makeCliffStrip(m, 'mid', i + 11)),
    };
  }

  const bankGrass = list('bank.grass', 3, (i) => makeBankStrip('grass', i + 1));
  const bankSand = list('bank.sand', 2, (i) => makeBankStrip('sand', i + 1));
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
  const outcropKeys = Array.from({ length: OUTCROP_KINDS }, (_, k) => Array.from({ length: OUTCROP_TIERS }, (_, t) => list(`outcrop.${k}.${t}.`, OUTCROP_VARIANTS, (v) => makeOutcrop(k, t, v))));
  const rubble = list('rubble', 3, (i) => makeRubble(i + 1));
  const mountainKeys = Array.from({ length: SNOW_LEVELS }, (_, s) =>
    Array.from({ length: MOUNTAIN_VARIANTS }, (_, v) => [add(`mtn.${s}.${v}.0`, makeMountain(v, s, false)), add(`mtn.${s}.${v}.1`, makeMountain(v, s, true))]),
  );
  const quarried = list('quarried', 2, (i) => makeQuarriedMountain(i + 1));

  const rigKeys = {
    leg: add('rig.leg', makeLeg()),
    torsoFront: add('rig.torsoF', makeTorso(false)),
    torsoBack: add('rig.torsoB', makeTorso(true)),
    sleeve: add('rig.sleeve', makeSleeve()),
    hand: add('rig.hand', makeHand()),
    headFront: add('rig.headF', makeHead(false)),
    headBack: add('rig.headB', makeHead(true)),
    hairFront: [0, 1, 2, 3].map((i) => add(`rig.hairF${i}`, makeHair(i, false))),
    hairBack: [0, 1, 2, 3].map((i) => add(`rig.hairB${i}`, makeHair(i, true))),
    hat: add('rig.hat', makeHat()),
  };
  const toolKeys = {
    axe: add('tool.axe', makeAxe()),
    pick: add('tool.pick', makePick()),
    hammer: add('tool.hammer', makeHammer()),
    hoe: add('tool.hoe', makeHoe()),
    bucket: add('tool.bucket', makeBucket(false)),
    bucketFull: add('tool.bucketFull', makeBucket(true)),
  };
  const carryKeys = {
    logs: add('carry.logs', makeLogBundle()),
    rock: add('carry.rock', makeRockCarry()),
    sack: add('carry.sack', makeSack()),
    crate: add('carry.crate', makeCrateSmall()),
  };
  const badgeKinds: BadgeKind[] = ['chop', 'mine', 'build', 'craft', 'farm', 'water', 'eat', 'sleep', 'chat', 'rest'];
  const badgeKeys = badgeKinds.map((k) => add(`badge.${k}`, makeBadge(k)));
  const fxKeys = {
    z: add('fx.z', makeZ()),
    dots: add('fx.dots', makeSpeech('dots')),
    heart: add('fx.heart', makeSpeech('heart')),
    note: add('fx.note', makeSpeech('note')),
    blanket: add('fx.blanket', makeBlanket()),
    dot: add('fx.dot', makeSoftDot()),
    puff: add('fx.puff', makePuff()),
    chip: add('fx.chip', makeChip()),
    spark: add('fx.spark', makeSpark()),
    leaf: add('fx.leaf', makeLeaf()),
    streak: add('fx.streak', makeStreak()),
    ring: add('fx.ring', makeRing()),
    cloud: add('fx.cloud', makeCloud()),
    flame: add('fx.flame', makeFlame()),
    glow: add('fx.glow', makeGlow()),
    campfire: add('fx.campfire', makeCampfire()),
    torch: add('fx.torch', makeTorchPost()),
    sick: add('fx.sick', makeSickBadge()),
  };
  const ashKeys = list('fx.ash', 3, (i) => makeAsh(i + 1));
  const resKeys = RESOURCE_TYPES.map((r) => add(`res.${r}`, makeResourceIcon(r)));
  const bKeys = {
    house: list('bld.house', HOUSE_VARIANTS, (i) => bakeHouse(i)),
    townCenter: add('bld.townCenter', bakeTownCenter()),
    storage: add('bld.storage', bakeStorage()),
    workshop: add('bld.workshop', bakeWorkshop()),
    farm: list('bld.farm', FARM_STAGES, (i) => bakeFarm(i)),
    lumberCamp: add('bld.lumberCamp', bakeLumberCamp()),
    mine: add('bld.mine', bakeMine()),
    well: add('bld.well', bakeWell()),
  };
  const pileKeys = {
    logs: [1, 2, 3, 4].map((l) => add(`pile.logs${l}`, makeLogPile(l))),
    stones: [1, 2, 3, 4].map((l) => add(`pile.stones${l}`, makeStonePile(l))),
    crates: [1, 2, 3].map((l) => add(`pile.crates${l}`, makeCratePile(l))),
    produce: [1, 2, 3].map((l) => add(`pile.produce${l}`, makeProducePile(l))),
    planks: [1, 2, 3].map((l) => add(`pile.planks${l}`, makePlankPile(l))),
  };
  const padKeys = [1, 2, 3].map((n) => add(`pad${n}`, makeSitePad(n, n)));
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
    waterBlend: edgeSet(blendKeys),
    cliffs,
    bankGrass: ts(bankGrass),
    bankSand: ts(bankSand),
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
    outcrops: outcropKeys.map((perKind) => perKind.map(ts)),
    rubble: ts(rubble),
    mountains: mountainKeys.map((perSnow) => perSnow.map(ts)),
    quarried: ts(quarried),
    rig: {
      leg: t(rigKeys.leg),
      torsoFront: t(rigKeys.torsoFront),
      torsoBack: t(rigKeys.torsoBack),
      sleeve: t(rigKeys.sleeve),
      hand: t(rigKeys.hand),
      headFront: t(rigKeys.headFront),
      headBack: t(rigKeys.headBack),
      hairFront: ts(rigKeys.hairFront),
      hairBack: ts(rigKeys.hairBack),
      hat: t(rigKeys.hat),
    },
    tools: { axe: t(toolKeys.axe), pick: t(toolKeys.pick), hammer: t(toolKeys.hammer), hoe: t(toolKeys.hoe), bucket: t(toolKeys.bucket), bucketFull: t(toolKeys.bucketFull) },
    carry: { logs: t(carryKeys.logs), rock: t(carryKeys.rock), sack: t(carryKeys.sack), crate: t(carryKeys.crate) },
    badges: Object.fromEntries(badgeKinds.map((k, i) => [k, t(badgeKeys[i]!)])) as Record<BadgeKind, Texture>,
    fx: { z: t(fxKeys.z), dots: t(fxKeys.dots), heart: t(fxKeys.heart), note: t(fxKeys.note), blanket: t(fxKeys.blanket), dot: t(fxKeys.dot), puff: t(fxKeys.puff), chip: t(fxKeys.chip), spark: t(fxKeys.spark), leaf: t(fxKeys.leaf), streak: t(fxKeys.streak), ring: t(fxKeys.ring), cloud: t(fxKeys.cloud), flame: t(fxKeys.flame), glow: t(fxKeys.glow), campfire: t(fxKeys.campfire), torch: t(fxKeys.torch), sick: t(fxKeys.sick), ash: ts(ashKeys) },
    resIcons: Object.fromEntries(RESOURCE_TYPES.map((r, i) => [r, t(resKeys[i]!)])) as Record<ResourceType, Texture>,
    buildings: {
      house: ts(bKeys.house),
      townCenter: t(bKeys.townCenter),
      storage: t(bKeys.storage),
      workshop: t(bKeys.workshop),
      farm: ts(bKeys.farm),
      lumberCamp: t(bKeys.lumberCamp),
      mine: t(bKeys.mine),
      well: t(bKeys.well),
    },
    piles: { logs: ts(pileKeys.logs), stones: ts(pileKeys.stones), crates: ts(pileKeys.crates), produce: ts(pileKeys.produce), planks: ts(pileKeys.planks) },
    pads: { 1: t(padKeys[0]!), 2: t(padKeys[1]!), 3: t(padKeys[2]!) },
    selectionRing: t(ring),
    softShadow: t(softShadow),
    seasonal: null,
    pages,
    destroy() {
      this.seasonal?.destroy();
      for (const tex of textures.values()) tex.destroy(false);
      for (const s of sources) s.destroy();
    },
  };
}
