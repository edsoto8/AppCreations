import type { CameraMode, EduTopic, Overlays, PresetId, Quality, Tool, WallMode } from '../app/types';
import type { CleanMode, SuctionLevel, WaterLevel } from '../sim/config';
import type { DockPhase } from '../sim/dock/DockStation';
import type { MissionKind, MissionPhase, RobotMode } from '../sim/mission/types';
import type { DirtKind, FloorType } from '../sim/world/types';
import type { IconName } from './icons';
import type { Tone } from './primitives';

export const MODE_TONE: Record<RobotMode, Tone> = {
  idle: 'muted',
  undocking: 'accent',
  mapping: 'info',
  cleaning: 'accent',
  returning: 'violet',
  docking: 'violet',
  maintenance: 'info',
  charging: 'ok',
  manual: 'warn',
  paused: 'warn',
  recovering: 'warn',
  diagnostic: 'info',
  error: 'error',
};

/** Modes in which the robot is visibly busy (badge pulses). */
export const MODE_ACTIVE = new Set<RobotMode>(['undocking', 'mapping', 'cleaning', 'returning', 'docking', 'recovering', 'diagnostic', 'maintenance', 'manual']);

export const PHASE_LABEL: Record<MissionPhase, string> = {
  starting: 'Starting',
  exploring: 'Exploring',
  edges: 'Edge cleaning',
  coverage: 'Lane coverage',
  touchup: 'Touch-up',
  rechargeReturn: 'Returning to recharge',
  recharging: 'Recharging mid-mission',
  homeReturn: 'Heading home',
  completed: 'Completed',
  aborted: 'Aborted',
  failed: 'Failed',
};

export const RESUME_LABEL: Record<string, string> = {
  battery: 'Low battery',
  dustbin: 'Dustbin full',
  water: 'Clean water low',
  dirtyWater: 'Dirty water tank full',
};

export const DOCK_PHASE_LABEL: Record<DockPhase, string> = {
  idle: 'Idle',
  charging: 'Charging',
  dustExtraction: 'Auto-empty (dust extraction)',
  mopWash: 'Washing mop pads',
  waterTransfer: 'Refilling robot water',
  drying: 'Hot-air drying',
  ready: 'Ready',
};

export const MISSION_KINDS: Array<{ value: MissionKind; label: string; short: string }> = [
  { value: 'whole', label: 'Whole house', short: 'Whole' },
  { value: 'rooms', label: 'Selected rooms', short: 'Rooms' },
  { value: 'spot', label: 'Spot clean', short: 'Spot' },
  { value: 'edge', label: 'Edge clean', short: 'Edge' },
  { value: 'mapping', label: 'Initial mapping', short: 'Map' },
];

export const CLEAN_MODES: Array<{ value: CleanMode; label: string }> = [
  { value: 'vacuum', label: 'Vacuum' },
  { value: 'mop', label: 'Mop' },
  { value: 'vacuumMop', label: 'Vac + Mop' },
];

export const SUCTION_LEVELS: Array<{ value: SuctionLevel; label: string }> = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'standard', label: 'Standard' },
  { value: 'turbo', label: 'Turbo' },
  { value: 'max', label: 'Max' },
];

export const WATER_LEVELS: Array<{ value: WaterLevel; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
];

export const PRESET_OPTIONS: Array<{ value: PresetId; label: string }> = [
  { value: 'apartment', label: 'Simple apartment' },
  { value: 'family', label: 'Family home' },
  { value: 'challenge', label: 'Obstacle challenge' },
];

export const CAMERA_ORDER: CameraMode[] = ['orbit', 'follow', 'topDown', 'isometric', 'firstPerson', 'lidar', 'dock', 'exploded', 'cutaway'];

export const CAMERA_ICON: Record<CameraMode, IconName> = {
  orbit: 'robot',
  follow: 'move',
  topDown: 'map',
  isometric: 'box',
  firstPerson: 'camera',
  lidar: 'scan',
  dock: 'dock',
  exploded: 'spark',
  cutaway: 'layers',
};

export const QUALITY_OPTIONS: Array<{ value: Quality; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

export const WALL_OPTIONS: Array<{ value: WallMode; label: string }> = [
  { value: 'full', label: 'Full' },
  { value: 'cutaway', label: 'Cutaway' },
  { value: 'hidden', label: 'Hidden' },
];

export const FLOOR_OPTIONS: Array<{ value: FloorType; label: string }> = [
  { value: 'hardwood', label: 'Hardwood' },
  { value: 'tile', label: 'Tile' },
  { value: 'rug', label: 'Rug' },
  { value: 'carpet', label: 'Carpet' },
];

export const SPILL_OPTIONS: Array<{ value: DirtKind; label: string }> = [
  { value: 'dust', label: 'Dust' },
  { value: 'crumbs', label: 'Crumbs' },
  { value: 'hair', label: 'Hair' },
  { value: 'liquid', label: 'Liquid' },
  { value: 'stain', label: 'Stain' },
];

export interface ToolDef {
  id: Tool;
  label: string;
  icon: IconName;
  hint: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'none', label: 'Navigate', icon: 'hand', hint: 'Drag to orbit, scroll to zoom. Click the 2D map to select rooms when the mission is "Selected rooms".' },
  { id: 'select', label: 'Select / Move', icon: 'cursor', hint: 'Click furniture or an obstacle to select it, drag it to move. R / Shift+R rotates, Delete removes.' },
  { id: 'addObstacle', label: 'Add obstacle', icon: 'box', hint: 'Click the floor (3D view or 2D map) to drop the chosen obstacle.' },
  { id: 'addFurniture', label: 'Add furniture', icon: 'sofa', hint: 'Click the floor (3D view or 2D map) to place the chosen furniture piece.' },
  { id: 'remove', label: 'Remove', icon: 'trash', hint: 'Click an item or zone to delete it.' },
  { id: 'spill', label: 'Spill dirt', icon: 'drop', hint: 'Click the floor to spill the chosen dirt type. The robot only learns about it by cleaning there.' },
  { id: 'noGo', label: 'No-go zone', icon: 'ban', hint: 'Drag on the floor to draw a no-go zone. The robot footprint will never enter it.' },
  { id: 'noMop', label: 'No-mop zone', icon: 'nomop', hint: 'Drag on the floor to draw a no-mop zone (e.g. over a rug). Applies to mop-only missions.' },
  { id: 'spot', label: 'Pick spot', icon: 'target', hint: 'Click the floor to choose the spot-clean location (switches the mission to Spot).' },
  { id: 'inspect', label: 'Inspect parts', icon: 'search', hint: 'Click a robot or dock part to see what it does. Combine with the explode slider in View.' },
];

export const OVERLAY_TOGGLES: Array<{ key: Exclude<keyof Overlays, 'dirt'>; label: string; hint: string }> = [
  { key: 'coverage', label: 'Coverage', hint: 'Tint cells the cleaning footprint has passed over' },
  { key: 'lidarRays', label: 'LiDAR rays', hint: 'Current LiDAR scan rays' },
  { key: 'pointCloud', label: 'Point cloud', hint: 'Recent LiDAR hit points' },
  { key: 'path', label: 'Planned path', hint: 'A* path the robot is following' },
  { key: 'trail', label: 'Trail', hint: 'Past trajectory' },
  { key: 'costmap', label: 'Costmap', hint: 'Inflated planning costmap' },
  { key: 'zones', label: 'Zones', hint: 'No-go / no-mop zones' },
  { key: 'roomLabels', label: 'Room labels', hint: 'Room names in the 3D view' },
  { key: 'sensors', label: 'Sensors', hint: 'Cliff, bumper and front-sensor visualisation' },
  { key: 'perf', label: 'Perf stats', hint: 'Frame rate and renderer statistics' },
];

export const EDU_ORDER: EduTopic[] = ['differentialDrive', 'lidar', 'occupancy', 'astar', 'coverage', 'cliff', 'docking', 'suction', 'mopWash'];
