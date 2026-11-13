import type { SimSpeed } from '../sim/core/clock';
import type { CleanMode, SuctionLevel, WaterLevel } from '../sim/config';
import type { Command, CommandResult, MissionKind } from '../sim/mission/types';
import type { Simulation } from '../sim/Simulation';
import type { DirtKind, FloorType, FurnitureKind, ObstacleKind, Rect } from '../sim/world/types';

export type PresetId = 'apartment' | 'family' | 'challenge';

export type CameraMode =
  | 'orbit'
  | 'follow'
  | 'topDown'
  | 'isometric'
  | 'firstPerson'
  | 'lidar'
  | 'dock'
  | 'exploded'
  | 'cutaway';

export const CAMERA_LABEL: Record<CameraMode, string> = {
  orbit: 'Orbit robot',
  follow: 'Follow',
  topDown: 'Top-down plan',
  isometric: 'Isometric home',
  firstPerson: 'Robot camera',
  lidar: 'LiDAR view',
  dock: 'Dock close-up',
  exploded: 'Exploded robot',
  cutaway: 'Cutaway',
};

export type WallMode = 'full' | 'cutaway' | 'hidden';
export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Editor tools. 'none' = normal camera interaction. */
export type Tool =
  | 'none'
  | 'select'
  | 'addObstacle'
  | 'addFurniture'
  | 'remove'
  | 'spill'
  | 'noGo'
  | 'noMop'
  | 'spot'
  | 'inspect';

export type DirtView = 'off' | 'realistic' | 'heatmap';

export interface Overlays {
  dirt: DirtView;
  coverage: boolean;
  lidarRays: boolean;
  pointCloud: boolean;
  path: boolean;
  trail: boolean;
  costmap: boolean;
  zones: boolean;
  roomLabels: boolean;
  sensors: boolean;
  perf: boolean;
}

export interface Selection {
  kind: 'furniture' | 'obstacle' | 'zone';
  id: string;
}

export interface InspectedPart {
  owner: 'robot' | 'dock';
  id: string;
  name: string;
  description: string;
}

export type EduTopic =
  | 'differentialDrive'
  | 'lidar'
  | 'occupancy'
  | 'astar'
  | 'coverage'
  | 'cliff'
  | 'docking'
  | 'suction'
  | 'mopWash';

export interface MissionDraft {
  kind: MissionKind;
  cleanMode: CleanMode;
  suction: SuctionLevel;
  water: WaterLevel;
  passes: 1 | 2 | 3;
  rooms: string[];
  spot: { x: number; y: number } | null;
}

export interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  simStepMs: number;
  stepsPerFrame: number;
  adaptiveLevel: number;
}

/**
 * The imperative API the dashboard uses (provided via React context, see src/app/context.ts).
 * All methods are safe to call at any time; invalid commands return { ok: false, reason }.
 */
export interface AppApi {
  /** Current simulation (replaced on reset — never cache it across renders; read inside rAF loops). */
  readonly sim: Simulation;
  command(c: Command): CommandResult;
  /** Start a mission from the store's mission draft. */
  startMission(): CommandResult;
  setSpeed(s: SimSpeed): void;
  setSuction(s: SuctionLevel): void;
  setWater(w: WaterLevel): void;
  reset(preset?: PresetId, seed?: number): void;
  /** Manual drive axes in [-1, 1]; call on key changes. */
  setManualInput(forward: number, turn: number, vacuum: boolean): void;
  setFloorType(roomId: string, floor: FloorType): void;
  removeSelected(): void;
  rotateSelected(deltaRad: number): void;
  clearMap(): void;
  /** Debug/demo: set battery state of charge (0..1). */
  setBattery(soc: number): void;
  dockService(action: 'refill' | 'emptyDirty' | 'replaceBag'): void;
  /** Spill at a world point (used by map clicks); the 3D tool calls this too. */
  spill(kind: DirtKind, x: number, y: number): void;
  addObstacleAt(kind: ObstacleKind, x: number, y: number): void;
  addFurnitureAt(kind: FurnitureKind, x: number, y: number): void;
  /** Add a no-go / no-mop zone (ignored if smaller than 0.15 m on a side). */
  addZone(kind: 'noGo' | 'noMop', rect: Rect): void;
  /** Move a furniture item or obstacle to a new centre. */
  moveItem(kind: 'furniture' | 'obstacle', id: string, x: number, y: number): void;
  /** Drop a random obstacle onto the robot's current planned path (dynamic obstacle demo). */
  dropObstacleOnPath(): void;
  /** Focus camera to a world point (map clicks). */
  focus(x: number, y: number): void;
  /** Capture a PNG data URL of the 3D view. */
  screenshot(): string;
}
