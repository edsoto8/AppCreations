import type { FurnitureItem, FurnitureKind, ObstacleKind } from './types';

/**
 * How a piece of furniture touches the floor at robot height. This is the single source of truth
 * shared by the collision footprint (sim) and the 3D builder (render) so that legs line up.
 *
 * - solid:    the whole footprint blocks the robot (sofa base, cabinets, appliances).
 * - legs4:    four square legs inset at the corners; the robot can drive underneath if
 *             `clearance` > robot height (0.10 m), otherwise only legs block.
 * - pedestal: a single round pedestal/base at the center (`legSize` = pedestal diameter).
 * - ring:     a circular solid base (plants, lamps) of diameter min(w, d) * legSize.
 */
export type BaseStyle = 'solid' | 'legs4' | 'pedestal' | 'ring';

export interface FurnitureSpec {
  kind: FurnitureKind;
  label: string;
  base: BaseStyle;
  /** Leg side length (legs4), pedestal diameter (pedestal) or diameter fraction (ring). */
  legSize: number;
  /** Inset of leg centers from the item's edges (legs4). */
  legInset: number;
  /** Height of the underside above the floor. Robot passes underneath when > ROBOT.height. */
  clearance: number;
  defaults: { w: number; d: number; h: number };
  color: string;
  /** Whether users may move/rotate it in edit mode (large built-ins like counters are fixed). */
  movable: boolean;
}

export const FURNITURE_CATALOG: Record<FurnitureKind, FurnitureSpec> = {
  sofa: { kind: 'sofa', label: 'Sofa', base: 'solid', legSize: 0, legInset: 0, clearance: 0.04, defaults: { w: 2.1, d: 0.92, h: 0.85 }, color: '#5d6a78', movable: true },
  armchair: { kind: 'armchair', label: 'Armchair', base: 'legs4', legSize: 0.05, legInset: 0.06, clearance: 0.07, defaults: { w: 0.85, d: 0.85, h: 0.9 }, color: '#8a6f5a', movable: true },
  coffeeTable: { kind: 'coffeeTable', label: 'Coffee table', base: 'legs4', legSize: 0.05, legInset: 0.05, clearance: 0.32, defaults: { w: 1.1, d: 0.6, h: 0.42 }, color: '#a07850', movable: true },
  tvStand: { kind: 'tvStand', label: 'TV stand', base: 'solid', legSize: 0, legInset: 0, clearance: 0.02, defaults: { w: 1.8, d: 0.42, h: 0.5 }, color: '#3a3f46', movable: true },
  diningTable: { kind: 'diningTable', label: 'Dining table', base: 'legs4', legSize: 0.07, legInset: 0.08, clearance: 0.7, defaults: { w: 1.6, d: 0.9, h: 0.75 }, color: '#8b5e3c', movable: true },
  chair: { kind: 'chair', label: 'Chair', base: 'legs4', legSize: 0.035, legInset: 0.03, clearance: 0.44, defaults: { w: 0.45, d: 0.5, h: 0.9 }, color: '#8b5e3c', movable: true },
  bed: { kind: 'bed', label: 'Bed', base: 'legs4', legSize: 0.08, legInset: 0.08, clearance: 0.14, defaults: { w: 2.1, d: 1.6, h: 0.55 }, color: '#d8d2c8', movable: true },
  nightstand: { kind: 'nightstand', label: 'Nightstand', base: 'legs4', legSize: 0.04, legInset: 0.03, clearance: 0.12, defaults: { w: 0.48, d: 0.4, h: 0.55 }, color: '#7a5a3c', movable: true },
  wardrobe: { kind: 'wardrobe', label: 'Wardrobe', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 1.6, d: 0.6, h: 2.1 }, color: '#e4ded4', movable: true },
  dresser: { kind: 'dresser', label: 'Dresser', base: 'solid', legSize: 0, legInset: 0, clearance: 0.03, defaults: { w: 1.2, d: 0.5, h: 0.85 }, color: '#7a5a3c', movable: true },
  desk: { kind: 'desk', label: 'Desk', base: 'legs4', legSize: 0.05, legInset: 0.04, clearance: 0.7, defaults: { w: 1.4, d: 0.7, h: 0.75 }, color: '#c9b79c', movable: true },
  officeChair: { kind: 'officeChair', label: 'Office chair', base: 'pedestal', legSize: 0.16, legInset: 0, clearance: 0.4, defaults: { w: 0.62, d: 0.62, h: 1.05 }, color: '#2d3136', movable: true },
  bookshelf: { kind: 'bookshelf', label: 'Bookshelf', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 1.0, d: 0.35, h: 1.9 }, color: '#6e5038', movable: true },
  kitchenCounter: { kind: 'kitchenCounter', label: 'Kitchen counter', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 3.0, d: 0.62, h: 0.92 }, color: '#f1efe9', movable: false },
  kitchenIsland: { kind: 'kitchenIsland', label: 'Kitchen island', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 1.8, d: 0.9, h: 0.92 }, color: '#2f4b5c', movable: true },
  barStool: { kind: 'barStool', label: 'Bar stool', base: 'pedestal', legSize: 0.12, legInset: 0, clearance: 0.6, defaults: { w: 0.4, d: 0.4, h: 0.75 }, color: '#2b2b2b', movable: true },
  fridge: { kind: 'fridge', label: 'Refrigerator', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 0.8, d: 0.72, h: 1.85 }, color: '#c9ccd0', movable: false },
  stove: { kind: 'stove', label: 'Range / oven', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 0.76, d: 0.64, h: 0.92 }, color: '#2c2f33', movable: false },
  toilet: { kind: 'toilet', label: 'Toilet', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 0.4, d: 0.68, h: 0.78 }, color: '#f5f5f2', movable: false },
  bathtub: { kind: 'bathtub', label: 'Bathtub', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 1.7, d: 0.75, h: 0.58 }, color: '#f5f5f2', movable: false },
  vanity: { kind: 'vanity', label: 'Vanity', base: 'solid', legSize: 0, legInset: 0, clearance: 0.02, defaults: { w: 0.9, d: 0.5, h: 0.86 }, color: '#e8e4dc', movable: false },
  washingMachine: { kind: 'washingMachine', label: 'Washing machine', base: 'solid', legSize: 0, legInset: 0, clearance: 0, defaults: { w: 0.6, d: 0.6, h: 0.85 }, color: '#eceeef', movable: true },
  plant: { kind: 'plant', label: 'Potted plant', base: 'ring', legSize: 0.7, legInset: 0, clearance: 0, defaults: { w: 0.5, d: 0.5, h: 1.2 }, color: '#5c8a4e', movable: true },
  floorLamp: { kind: 'floorLamp', label: 'Floor lamp', base: 'ring', legSize: 0.65, legInset: 0, clearance: 0, defaults: { w: 0.36, d: 0.36, h: 1.6 }, color: '#2b2b2b', movable: true },
  sideboard: { kind: 'sideboard', label: 'Sideboard', base: 'legs4', legSize: 0.05, legInset: 0.05, clearance: 0.09, defaults: { w: 1.6, d: 0.45, h: 0.8 }, color: '#4a3a2c', movable: true },
};

export interface ObstacleSpec {
  kind: ObstacleKind;
  label: string;
  defaults: { w: number; d: number; h: number };
  color: string;
}

export const OBSTACLE_CATALOG: Record<ObstacleKind, ObstacleSpec> = {
  box: { kind: 'box', label: 'Cardboard box', defaults: { w: 0.4, d: 0.3, h: 0.3 }, color: '#b48a5a' },
  cylinder: { kind: 'cylinder', label: 'Trash can', defaults: { w: 0.3, d: 0.3, h: 0.45 }, color: '#7d8a96' },
  shoe: { kind: 'shoe', label: 'Shoe', defaults: { w: 0.28, d: 0.11, h: 0.1 }, color: '#e8e8e8' },
  toy: { kind: 'toy', label: 'Toy block', defaults: { w: 0.16, d: 0.16, h: 0.16 }, color: '#e05a47' },
  cable: { kind: 'cable', label: 'Cable bundle', defaults: { w: 0.5, d: 0.08, h: 0.03 }, color: '#202020' },
  sock: { kind: 'sock', label: 'Sock', defaults: { w: 0.2, d: 0.09, h: 0.03 }, color: '#4a6fa5' },
  petBowl: { kind: 'petBowl', label: 'Pet bowl', defaults: { w: 0.22, d: 0.22, h: 0.07 }, color: '#c0392b' },
};

/** Local-space leg centers (relative to the item center, before rotation) for a legs4 item. */
export function legOffsets(item: Pick<FurnitureItem, 'kind' | 'w' | 'd'>): Array<{ x: number; y: number }> {
  const spec = FURNITURE_CATALOG[item.kind];
  const hx = item.w / 2 - spec.legInset - spec.legSize / 2;
  const hy = item.d / 2 - spec.legInset - spec.legSize / 2;
  return [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
    { x: -hx, y: hy },
  ];
}
