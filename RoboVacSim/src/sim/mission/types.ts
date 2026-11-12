import type { CleanMode, SuctionLevel, WaterLevel } from '../config';
import type { Vec2 } from '../world/types';

export type RobotMode =
  | 'idle'
  | 'undocking'
  | 'mapping'
  | 'cleaning'
  | 'returning'
  | 'docking'
  | 'maintenance'
  | 'charging'
  | 'manual'
  | 'paused'
  | 'recovering'
  | 'diagnostic'
  | 'error';

export const MODE_LABEL: Record<RobotMode, string> = {
  idle: 'Idle',
  undocking: 'Leaving dock',
  mapping: 'Mapping',
  cleaning: 'Cleaning',
  returning: 'Returning to dock',
  docking: 'Docking',
  maintenance: 'Dock maintenance',
  charging: 'Charging',
  manual: 'Manual drive',
  paused: 'Paused',
  recovering: 'Recovering from obstruction',
  diagnostic: 'Diagnostics',
  error: 'Error',
};

export type MissionKind = 'mapping' | 'whole' | 'rooms' | 'spot' | 'edge';

export const MISSION_LABEL: Record<MissionKind, string> = {
  mapping: 'Initial mapping',
  whole: 'Whole-house cleaning',
  rooms: 'Selected-room cleaning',
  spot: 'Spot cleaning',
  edge: 'Edge cleaning',
};

export interface MissionSettings {
  kind: MissionKind;
  cleanMode: CleanMode;
  suction: SuctionLevel;
  water: WaterLevel;
  passes: 1 | 2 | 3;
  rooms: string[];
  spot?: Vec2;
}

export type MissionPhase =
  | 'starting'
  | 'exploring'
  | 'edges'
  | 'coverage'
  | 'touchup'
  | 'rechargeReturn'
  | 'recharging'
  | 'homeReturn'
  | 'completed'
  | 'aborted'
  | 'failed';

/** Why the robot went back to the dock mid-mission. */
export type ResumeReason = 'battery' | 'dustbin' | 'water' | 'dirtyWater' | null;

export type TaskKind = 'lane' | 'edge' | 'spot';

export interface CleanTask {
  id: number;
  kind: TaskKind;
  pass: number;
  points: Vec2[];
  length: number;
}

export interface MissionState {
  id: number;
  settings: MissionSettings;
  phase: MissionPhase;
  pass: number;
  /** Ordered remaining cleaning tasks (the "remaining coverage plan"). */
  tasks: CleanTask[];
  /** Total tasks planned (all passes so far), for progress. */
  tasksPlanned: number;
  tasksDone: number;
  tasksSkipped: number;
  touchups: number;
  startedAt: number;
  endedAt: number | null;
  resumeReason: ResumeReason;
  rechargeCount: number;
  /** Cells to clean (1 = in target region). */
  region: Uint8Array;
  regionArea: number;
  /** Frontier targets that failed (blacklist). */
  badFrontiers: Vec2[];
  result: string | null;
}

export type Command =
  | { type: 'start'; settings: MissionSettings }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'dock' }
  | { type: 'manual'; enable: boolean }
  | { type: 'diagnostic' }
  | { type: 'clearError' };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export interface ManualInput {
  forward: number;
  turn: number;
  vacuum: boolean;
}
