import type { Group, Object3D } from 'three';

/** A clickable component in inspection mode. */
export interface InspectablePart {
  id: string;
  name: string;
  /** 1-3 sentences describing what the component does (shown in the inspector panel). */
  description: string;
  /** Root object of the part. Every mesh beneath it must have userData.partId === id. */
  object: Object3D;
}

export type LedMode =
  | 'off'
  | 'idle'
  | 'mapping'
  | 'cleaning'
  | 'returning'
  | 'charging'
  | 'maintenance'
  | 'manual'
  | 'paused'
  | 'recovering'
  | 'error';

/** Per-frame animation inputs for the robot (all angles in radians, accumulated - not wrapped). */
export interface RobotAnimState {
  leftWheelAngle: number;
  rightWheelAngle: number;
  /** Caster swivel (radians, local yaw). */
  casterYaw: number;
  mainBrushAngle: number;
  sideBrushAngle: number;
  lidarAngle: number;
  mopAngle: number;
  /** 0 = mop pads lifted, 1 = fully lowered. */
  mopLowered: number;
  /** 0 = bumper rest, 1 = fully compressed. */
  bumperCompression: number;
  /** Direction of the bumper hit in robot local frame (radians, 0 = straight ahead). */
  bumperHitAngle: number;
  ledMode: LedMode;
  /** 0..1 battery for LED ring charging animation. */
  battery: number;
  /** 0 = closed, 1 = dustbin lid fully open. */
  dustbinOpen: number;
  /** 0..1 dustbin fill level (visible in x-ray / open bin). */
  dustbinFill: number;
  /** 0..1 clean water tank level. */
  waterLevel: number;
  /** 0 = normal ride height, 1 = suspension fully raised (e.g. climbing threshold/carpet). */
  suspensionLift: number;
  /** Suction intensity 0..1 (0 = off). Drives intake particles + vent glow. */
  suction: number;
}

export interface RobotModel {
  root: Group;
  parts: InspectablePart[];
  /** Apply animation state. `time` = simulation time in seconds (for LED pulses etc.), `dt` = frame dt. */
  update(state: RobotAnimState, time: number, dt: number): void;
  /** 0 = assembled, 1 = fully exploded view. Interpolate smoothly. */
  setExplode(amount: number): void;
  /** Transparent shell revealing internals. */
  setXray(on: boolean): void;
  /** Highlight (emissive outline/tint) a part by id, or clear with null. */
  highlight(partId: string | null): void;
  dispose(): void;
}

export type DockPhase =
  | 'idle'
  | 'charging'
  | 'dustExtraction'
  | 'mopWash'
  | 'waterTransfer'
  | 'drying'
  | 'ready';

export interface DockAnimState {
  phase: DockPhase;
  /** 0..1 progress within the current phase. */
  phaseProgress: number;
  robotDocked: boolean;
  /** 0..1 levels. */
  cleanWater: number;
  dirtyWater: number;
  dustBag: number;
  /** Robot battery 0..1 for the status display. */
  robotBattery: number;
  /** Short text for the status display, e.g. "CHARGING 64%". */
  statusText: string;
}

export interface DockModel {
  root: Group;
  parts: InspectablePart[];
  update(state: DockAnimState, time: number, dt: number): void;
  /** 0 = panels closed, 1 = side/front service panels removed & lifted away. */
  setPanelsOpen(amount: number): void;
  /** Cutaway: hide the near half of the housing to reveal internal ducts, pumps and tanks. */
  setCutaway(on: boolean): void;
  highlight(partId: string | null): void;
  dispose(): void;
}
