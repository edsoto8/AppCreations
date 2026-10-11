/** UI-level types shared by store, renderer, game controller and React UI. */
import type { BuildingType, EntityId, TilePos } from '../sim';

/** What the player has selected. */
export type Selection =
  | { kind: 'settler'; id: EntityId }
  | { kind: 'building'; id: EntityId }
  | { kind: 'tile'; x: number; y: number };

/** Simulation speed multipliers offered to the player (pause is a separate flag). */
export const GAME_SPEEDS = [1, 2, 4] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

/** Optional map overlays. */
export type OverlayMode = 'none' | 'resources' | 'buildable';

/** Placement preview drawn by the renderer while in build mode. */
export interface PlacementGhost {
  buildingType: BuildingType;
  origin: TilePos;
  ok: boolean;
  /** Per-tile validity (from canPlaceBuilding). */
  tiles: { x: number; y: number; ok: boolean }[];
}
