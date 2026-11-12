import type { FurnitureItem, FurnitureKind } from '../../../sim/world/types';
import type { ModelBuilder } from '../geometry';
import { bathtub, toilet, vanity, washingMachine } from './bathroom';
import { bed, bookshelf, dresser, nightstand, wardrobe } from './bedroom';
import { makeCtx, type FurnitureBuilder } from './common';
import { floorLamp, plant } from './decor';
import { fridge, kitchenCounter, kitchenIsland, stove } from './kitchen';
import { armchair, barStool, chair, officeChair, sofa } from './seating';
import { coffeeTable, desk, diningTable, sideboard, tvStand } from './tables';

export const FURNITURE_BUILDERS: Record<FurnitureKind, FurnitureBuilder> = {
  sofa,
  armchair,
  coffeeTable,
  tvStand,
  diningTable,
  chair,
  bed,
  nightstand,
  wardrobe,
  dresser,
  desk,
  officeChair,
  bookshelf,
  kitchenCounter,
  kitchenIsland,
  barStool,
  fridge,
  stove,
  toilet,
  bathtub,
  vanity,
  washingMachine,
  plant,
  floorLamp,
  sideboard,
};

const SMALL: ReadonlySet<FurnitureKind> = new Set(['chair', 'barStool', 'nightstand', 'plant', 'floorLamp']);

export function buildFurniture(item: FurnitureItem, b: ModelBuilder, details: boolean): void {
  FURNITURE_BUILDERS[item.kind](makeCtx(b, item, details));
  b.small = SMALL.has(item.kind);
}

export { buildObstacle, obstacleColor } from './obstacles';
