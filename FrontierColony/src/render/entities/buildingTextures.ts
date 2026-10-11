/** Maps building types (and their visual state) onto baked textures. */
import type { Texture } from 'pixi.js';
import type { BuildingType, Season } from '../../sim';
import type { TextureSet } from '../textures';

export function farmStage(productionProgress: number, season: Season): number {
  if (season === 'winter') return 5;
  const p = productionProgress;
  return p < 0.12 ? 0 : p < 0.35 ? 1 : p < 0.6 ? 2 : p < 0.85 ? 3 : 4;
}

export function buildingTexture(tex: TextureSet, type: BuildingType, id: number, farm = 4): Texture {
  const b = tex.buildings;
  switch (type) {
    case 'house':
      return b.house[id % b.house.length]!;
    case 'townCenter':
      return b.townCenter;
    case 'storage':
      return b.storage;
    case 'workshop':
      return b.workshop;
    case 'farm':
      return b.farm[Math.min(farm, b.farm.length - 1)]!;
    case 'lumberCamp':
      return b.lumberCamp;
    case 'mine':
      return b.mine;
    case 'well':
      return b.well;
  }
}

/** Approximate height in px of each building (hit-testing and scaffold sizing). */
export function buildingHeight(type: BuildingType): number {
  switch (type) {
    case 'townCenter':
      return 100;
    case 'house':
      return 54;
    case 'farm':
      return 14;
    case 'lumberCamp':
      return 36;
    case 'mine':
      return 46;
    case 'well':
      return 52;
    case 'storage':
      return 46;
    case 'workshop':
      return 62;
  }
}

/** Pile level (0..max) from an amount, on a gentle curve. */
export function pileLevel(amount: number, steps: readonly number[]): number {
  let l = 0;
  for (let i = 0; i < steps.length; i++) if (amount >= steps[i]!) l = i + 1;
  return l;
}
