import type { ConveyorState, MachineState } from '../../simulation/types';

/**
 * Animation state objects. The sync layer creates one per model instance (with the factories
 * below) and MUTATES its fields every frame; the model reads them inside its own `useFrame`.
 * Models never run on their own clock: every motion is a function of these fields.
 */

/** Robot joint angles in radians (see robotKinematics.ts for conventions). */
export interface RobotAnim {
  /** Turntable yaw about +y; 0 = arm reaching along local +x. */
  base: number;
  /** Upper-arm elevation from horizontal (rotation about the joint's z axis). */
  shoulder: number;
  /** Forearm angle relative to the upper arm (0 = straight, negative = bent down). */
  elbow: number;
  /** Tool angle relative to the forearm. Gripper points straight down when shoulder+elbow+wrist = -PI/2. */
  wrist: number;
  /** 0 = closed .. 1 = fully open. */
  grip: number;
  /** 0 none, 1 kit tote, 2 product A, 3 product B. */
  carry: 0 | 1 | 2 | 3;
}

export interface AssemblyMachineAnim {
  running: boolean;
  /** 0..1 of the current process. */
  progress: number;
  /** 0 none, 1 product A, 2 product B (shown on the fixture). */
  product: 0 | 1 | 2;
}

export interface StackLightAnim {
  state: MachineState;
  /** Seconds (sim render time) used for blinking. */
  clock: number;
}

export interface ConveyorAnim {
  /** Belt odometer in metres; the belt texture scrolls by exactly this amount. */
  beltPos: number;
  state: ConveyorState;
}

export interface GantryAnim {
  scanning: boolean;
  /** 0..1 sweep of the camera carriage along local x. */
  progress: number;
  /** 0 none, 1 pass (green), 2 reject (red). */
  result: 0 | 1 | 2;
  clock: number;
}

export interface PackagingAnim {
  running: boolean;
  /** 0..1 of the current carton cycle (carton travels infeed -> outfeed). */
  progress: number;
  hasCarton: boolean;
}

export interface PalletizerAnim {
  /** Gripper pad (bottom face) position in palletizer-local metres. */
  target: [number, number, number];
  grip: boolean;
  carrying: boolean;
}

export interface AGVAnim {
  /** 0..4 totes on the deck. */
  cargo: number;
  /** 0 kit totes (blue), 1 rework units (orange totes). */
  cargoKind: 0 | 1;
  moving: boolean;
  failed: boolean;
  clock: number;
}

export interface ForkliftAnim {
  /** Fork height above floor, 0..3 m. */
  forkHeight: number;
  /** 0 none, 1..24 cartons on a pallet, -1 raw-material lot. */
  pallet: number;
  moving: boolean;
  failed: boolean;
  clock: number;
}

export interface WorkerAnim {
  walking: boolean;
  working: boolean;
  /** Metres walked (odometer); drives the gait. */
  stride: number;
  clock: number;
}

export interface TruckAnim {
  /** Rear roll-up door, 0 closed .. 1 open. */
  doorOpen: number;
  /** Pallets inside the trailer (max 14 shown). */
  pallets: number;
}

export interface KitTableAnim {
  /** Totes on the table, 0..4. */
  totes: number;
}

export const createRobotAnim = (): RobotAnim => ({ base: 0, shoulder: 1.2, elbow: -1.75, wrist: -1.02, grip: 1, carry: 0 });
export const createAssemblyMachineAnim = (): AssemblyMachineAnim => ({ running: false, progress: 0, product: 0 });
export const createStackLightAnim = (): StackLightAnim => ({ state: 'idle', clock: 0 });
export const createConveyorAnim = (): ConveyorAnim => ({ beltPos: 0, state: 'stopped' });
export const createGantryAnim = (): GantryAnim => ({ scanning: false, progress: 0, result: 0, clock: 0 });
export const createPackagingAnim = (): PackagingAnim => ({ running: false, progress: 0, hasCarton: false });
export const createPalletizerAnim = (): PalletizerAnim => ({ target: [-1.6, 1.6, 0], grip: false, carrying: false });
export const createAGVAnim = (): AGVAnim => ({ cargo: 0, cargoKind: 0, moving: false, failed: false, clock: 0 });
export const createForkliftAnim = (): ForkliftAnim => ({ forkHeight: 0.1, pallet: 0, moving: false, failed: false, clock: 0 });
export const createWorkerAnim = (): WorkerAnim => ({ walking: false, working: false, stride: 0, clock: 0 });
export const createTruckAnim = (): TruckAnim => ({ doorOpen: 0, pallets: 0 });
export const createKitTableAnim = (): KitTableAnim => ({ totes: 0 });

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth01 = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/** Blink helper: true for the first half of each period. */
export const blink = (clock: number, hz: number): boolean => clock * hz - Math.floor(clock * hz) < 0.5;
