/**
 * Seasonal texture sets (autumn and winter trees, snowy ground, snow-roofed buildings). They are drawn
 * a few at a time in idle frames after start-up (see SeasonalBaker) and packed into their own atlas, so
 * they cost nothing at launch and are ready long before the first leaf turns.
 */
import type { Texture } from 'pixi.js';
import { AtlasBuilder } from './atlas';
import type { Art } from './canvas';
import { bakeHouse, bakeLumberCamp, bakeMine, bakeStorage, bakeTownCenter, bakeWell, bakeWorkshop, HOUSE_VARIANTS } from './buildings';
import { makeBankStrip } from './cliffs';
import { applySnow, makeForestFloor, makeGrassTile, makeHillsGround, makeRockGround, makeSandTile } from './groundTiles';
import { makeTreeCluster, TREE_LEVELS } from './trees';

export const SEASON_TREE_VARIANTS = 3;

type Deciduous = 'oak' | 'birch';

export interface SeasonalSet {
  treesAutumn: Record<Deciduous, Texture[][]>;
  treesBare: Record<Deciduous, Texture[][]>;
  pineSnow: Texture[][];
  grassSnow: Texture[];
  bankSnow: Texture[];
  forestSnow: Texture[];
  hillsSnow: Texture[];
  rockSnow: Texture[];
  sandFrost: Texture[];
  buildingsSnow: {
    house: Texture[];
    townCenter: Texture;
    storage: Texture;
    workshop: Texture;
    lumberCamp: Texture;
    mine: Texture;
    well: Texture;
  };
  destroy(): void;
}

interface Job {
  key: string;
  make: () => Art;
}

export class SeasonalBaker {
  private readonly jobs: Job[] = [];
  private cursor = 0;
  private readonly atlas = new AtlasBuilder();
  private result: SeasonalSet | null = null;
  private destroyers: (() => void)[] = [];

  constructor() {
    const add = (key: string, make: () => Art): void => {
      this.jobs.push({ key, make });
    };
    const tree = (sp: 'oak' | 'birch' | 'pine', season: 'autumn' | 'winter'): void => {
      for (let l = 1; l <= TREE_LEVELS; l++) for (let v = 0; v < SEASON_TREE_VARIANTS; v++) add(`${season}.${sp}.${l}.${v}`, () => makeTreeCluster(sp, l, v, season));
    };
    tree('oak', 'autumn');
    tree('birch', 'autumn');
    tree('oak', 'winter');
    tree('birch', 'winter');
    tree('pine', 'winter');
    for (let i = 0; i < 4; i++) add(`snow.grass.${i}`, () => applySnow(makeGrassTile(i + 1), 100 + i));
    for (let i = 0; i < 3; i++) add(`snow.bank.${i}`, () => applySnow(makeBankStrip('grass', i + 1), 600 + i, 0.9));
    for (let i = 0; i < 3; i++) add(`snow.forest.${i}`, () => applySnow(makeForestFloor(i + 1), 200 + i, 0.8));
    for (let i = 0; i < 3; i++) add(`snow.hills.${i}`, () => applySnow(makeHillsGround(i + 1), 300 + i, 0.85));
    for (let i = 0; i < 2; i++) add(`snow.rock.${i}`, () => applySnow(makeRockGround(i + 1), 400 + i, 0.9));
    for (let i = 0; i < 2; i++) add(`snow.sand.${i}`, () => applySnow(makeSandTile(i + 1), 500 + i, 0.4));
    for (let i = 0; i < HOUSE_VARIANTS; i++) add(`snow.house.${i}`, () => bakeHouse(i, true));
    add('snow.townCenter', () => bakeTownCenter(true));
    add('snow.storage', () => bakeStorage(true));
    add('snow.workshop', () => bakeWorkshop(true));
    add('snow.lumberCamp', () => bakeLumberCamp(true));
    add('snow.mine', () => bakeMine(true));
    add('snow.well', () => bakeWell(true));
  }

  get total(): number {
    return this.jobs.length;
  }

  get done(): boolean {
    return this.result !== null;
  }

  /** Draw jobs for up to `budgetMs`; returns the finished set once everything is packed. */
  step(budgetMs: number): SeasonalSet | null {
    if (this.result) return null;
    const t0 = performance.now();
    while (this.cursor < this.jobs.length && performance.now() - t0 < budgetMs) {
      const j = this.jobs[this.cursor++]!;
      this.atlas.add(j.key, j.make());
    }
    if (this.cursor < this.jobs.length) return null;
    this.result = this.pack();
    return this.result;
  }

  private pack(): SeasonalSet {
    const { textures, sources } = this.atlas.build();
    const t = (k: string): Texture => {
      const tex = textures.get(k);
      if (!tex) throw new Error(`missing seasonal texture ${k}`);
      return tex;
    };
    const grid = (prefix: string): Texture[][] =>
      Array.from({ length: TREE_LEVELS }, (_, l) => Array.from({ length: SEASON_TREE_VARIANTS }, (_, v) => t(`${prefix}.${l + 1}.${v}`)));
    const range = (prefix: string, n: number): Texture[] => Array.from({ length: n }, (_, i) => t(`${prefix}.${i}`));
    return {
      treesAutumn: { oak: grid('autumn.oak'), birch: grid('autumn.birch') },
      treesBare: { oak: grid('winter.oak'), birch: grid('winter.birch') },
      pineSnow: grid('winter.pine'),
      grassSnow: range('snow.grass', 4),
      bankSnow: range('snow.bank', 3),
      forestSnow: range('snow.forest', 3),
      hillsSnow: range('snow.hills', 3),
      rockSnow: range('snow.rock', 2),
      sandFrost: range('snow.sand', 2),
      buildingsSnow: {
        house: range('snow.house', HOUSE_VARIANTS),
        townCenter: t('snow.townCenter'),
        storage: t('snow.storage'),
        workshop: t('snow.workshop'),
        lumberCamp: t('snow.lumberCamp'),
        mine: t('snow.mine'),
        well: t('snow.well'),
      },
      destroy: () => {
        for (const tex of textures.values()) tex.destroy(false);
        for (const s of sources) s.destroy();
        for (const d of this.destroyers) d();
      },
    };
  }
}
