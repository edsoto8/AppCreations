/**
 * Shared world/layout data model.
 *
 * COORDINATE CONVENTION (used everywhere in the project):
 * - The simulation works in a 2D plane with coordinates (x, y) in METERS.
 * - Three.js maps sim (x, y) -> world (x, height, y). i.e. sim y == three z.
 * - A heading `theta` (radians) means forward direction (cos theta, sin theta) in the sim plane.
 *   In Three.js a group with local forward +X is oriented with `rotation.y = -theta`.
 * - Rectangles are axis-aligned with (x, y) at the MIN corner and positive w (along x), h (along y).
 * - Oriented items (furniture/obstacles) use a CENTER (x, y), `rotation` (radians, same sense as
 *   theta), `w` = size along the item's local x axis, `d` = size along its local y axis, `h` = height.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose2 {
  x: number;
  y: number;
  theta: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Floor surface. `rug` = low-pile area rug on top of another floor, `carpet` = wall-to-wall high pile. */
export type FloorType = 'hardwood' | 'tile' | 'carpet' | 'rug';

export type RoomKind =
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'bathroom'
  | 'hallway'
  | 'office'
  | 'laundry';

export interface RoomDef {
  id: string;
  name: string;
  kind: RoomKind;
  /** One or more axis-aligned rectangles that together form the room's floor area. */
  rects: Rect[];
  floor: FloorType;
}

/** Axis-aligned wall segment from a to b (a.x === b.x or a.y === b.y). Openings are already cut out. */
export interface WallDef {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
  /** Exterior walls are never hidden completely by the "walls hidden" view mode (rendered as a low curb). */
  exterior: boolean;
}

/** A doorway opening (no door leaf - always open). Purely informational for rendering + thresholds. */
export interface DoorDef {
  id: string;
  center: Vec2;
  width: number;
  /** 'x' when the wall containing the door runs along the x axis, 'y' when along the y axis. */
  axis: 'x' | 'y';
  /** Threshold strip height in meters (robot can climb up to ~0.02 m). */
  threshold: number;
  wallThickness: number;
}

export type FurnitureKind =
  | 'sofa'
  | 'armchair'
  | 'coffeeTable'
  | 'tvStand'
  | 'diningTable'
  | 'chair'
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'dresser'
  | 'desk'
  | 'officeChair'
  | 'bookshelf'
  | 'kitchenCounter'
  | 'kitchenIsland'
  | 'barStool'
  | 'fridge'
  | 'stove'
  | 'toilet'
  | 'bathtub'
  | 'vanity'
  | 'washingMachine'
  | 'plant'
  | 'floorLamp'
  | 'sideboard';

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  rotation: number;
  w: number;
  d: number;
  h: number;
  /** Optional hex color override for the main body material, e.g. '#6b7b8c'. */
  color?: string;
}

export type ObstacleKind = 'box' | 'cylinder' | 'shoe' | 'toy' | 'cable' | 'sock' | 'petBowl';

/** User-placed / dynamic obstacles. Always block the robot with their full footprint. */
export interface ObstacleItem {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number;
  rotation: number;
  w: number;
  d: number;
  h: number;
}

export type ZoneKind = 'noGo' | 'noMop';

export interface ZoneDef {
  id: string;
  kind: ZoneKind;
  rect: Rect;
}

export interface RugDef {
  id: string;
  rect: Rect;
  floor: 'rug' | 'carpet';
  color: string;
}

/** A floor drop-off (e.g. a stairwell going down). Invisible to LiDAR, detected only by cliff sensors. */
export interface CliffDef {
  id: string;
  rect: Rect;
}

export type DirtKind = 'dust' | 'crumbs' | 'hair' | 'liquid' | 'stain';

export interface DirtPatch {
  kind: DirtKind;
  x: number;
  y: number;
  radius: number;
  /** Peak amount (units: grams per m^2 for solids, ml per m^2 for liquid, 0..1 intensity for stains). */
  amount: number;
}

export interface HouseLayout {
  id: string;
  name: string;
  description: string;
  /** Outer bounds of the whole house (used to size grids). */
  bounds: Rect;
  rooms: RoomDef[];
  walls: WallDef[];
  doors: DoorDef[];
  furniture: FurnitureItem[];
  obstacles: ObstacleItem[];
  zones: ZoneDef[];
  rugs: RugDef[];
  cliffs: CliffDef[];
  /** Explicit dirt hotspots. A uniform base dust layer + traffic patches are added procedurally. */
  dirtPatches: DirtPatch[];
  /** Docked robot pose: robot center when docked, theta = heading the robot faces (toward the dock tower). */
  dock: Pose2;
}

export const CELL_UNKNOWN = 0;
export const CELL_FREE = 1;
export const CELL_OCCUPIED = 2;
export type CellState = typeof CELL_UNKNOWN | typeof CELL_FREE | typeof CELL_OCCUPIED;
