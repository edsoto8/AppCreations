/**
 * Where each building emits light at night, in building-local space (u, v in tiles from the footprint
 * centre, h in px above the ground). Positions follow the baked art (windows, doors, forges, torches).
 */
import type { BuildingType } from '../../sim';

export type LightKind = 'window' | 'pool' | 'fire' | 'forge';

export interface LightPoint {
  u: number;
  v: number;
  h: number;
  kind: LightKind;
  /** Relative size (1 = a window glow). */
  size: number;
  /** Only lit when someone lives or works here. */
  needsOccupant: boolean;
}

const W = (u: number, v: number, h: number, size = 1, needsOccupant = false): LightPoint => ({ u, v, h, kind: 'window', size, needsOccupant });

export function lightPointsFor(type: BuildingType): readonly LightPoint[] {
  switch (type) {
    case 'house':
      return [
        W(-0.53, 0.78, 18, 1, true),
        W(0.44, 0.78, 18, 1, true),
        W(0.78, 0.4, 18, 0.8, true),
        W(0.78, -0.28, 18, 0.8, true),
        { u: 0.1, v: 1.28, h: 0, kind: 'pool', size: 1.3, needsOccupant: true },
      ];
    case 'townCenter':
      return [
        W(-0.75, 0.98, 21, 1.1),
        W(-0.4, 0.98, 21, 1.1),
        W(0.45, 0.98, 21, 1.1),
        W(0.77, 0.98, 21, 1.1),
        W(1.12, 0.57, 21, 0.9),
        W(1.12, 0.06, 21, 0.9),
        W(1.12, -0.45, 21, 0.9),
        { u: 0, v: 1.55, h: 0, kind: 'pool', size: 2.2, needsOccupant: false },
        { u: 1.95, v: 0.6, h: 8, kind: 'fire', size: 2.2, needsOccupant: false },
      ];
    case 'workshop':
      return [
        { u: -0.18, v: 0.82, h: 9, kind: 'forge', size: 1.5, needsOccupant: false },
        { u: -0.95, v: 0.95, h: 28, kind: 'fire', size: 1.2, needsOccupant: false },
        { u: 0.62, v: 1.0, h: 28, kind: 'fire', size: 1.2, needsOccupant: false },
        { u: 0, v: 1.35, h: 0, kind: 'pool', size: 1.6, needsOccupant: false },
      ];
    case 'storage':
      return [W(0, 0.85, 17, 0.9), { u: 0, v: 1.3, h: 0, kind: 'pool', size: 1.2, needsOccupant: false }];
    case 'lumberCamp':
      return [W(0.15, -0.3, 10, 1.2)];
    case 'mine':
      return [W(0.4, 0.5, 16, 1.1)];
    default:
      return [];
  }
}

/** Torch posts and the campfire are physical sprites that belong to the building art. */
export interface Fixture {
  kind: 'campfire' | 'torch';
  u: number;
  v: number;
}

export function fixturesFor(type: BuildingType): readonly Fixture[] {
  switch (type) {
    case 'townCenter':
      return [{ kind: 'campfire', u: 1.95, v: 0.6 }];
    case 'workshop':
      return [
        { kind: 'torch', u: -0.95, v: 0.95 },
        { kind: 'torch', u: 0.62, v: 1.0 },
      ];
    default:
      return [];
  }
}
