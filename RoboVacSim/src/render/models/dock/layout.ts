import { DOCK } from '../../../sim/robot/robotSpec';

/** Derived dock layout (meters, dock local frame: docked robot centre at origin, tower toward +X). */
export const TX0 = DOCK.towerFrontX;
export const TX1 = DOCK.towerBackX;
export const TXC = (TX0 + TX1) / 2;
export const HW = DOCK.width / 2;
export const TOP = DOCK.towerHeight;
export const BASE_H = DOCK.baseHeight;
/** Radius of the circular well the robot sits in. */
export const WELL_R = 0.184;
/** Top of the lower body / underside of the tank deck. */
export const BODY_TOP = 0.33;
export const DECK_TOP = 0.338;
export const LID_Y0 = 0.488;
/** Corner trim size. */
export const TRIM = 0.03;
/** Panels sit between the corner trims. */
export const PANEL_Z = HW - TRIM;
export const PANEL_X0 = TX0 + TRIM;
export const PANEL_X1 = TX1 - TRIM;
/** Wash tray (under the mop pads). */
export const TRAY = { x0: -0.177, x1: -0.023, z: 0.139 } as const;
export const VENT_Z = 0.158;
export const DUCT_X = 0.3;
export const MOTOR = { x: 0.375, z: -0.075 } as const;
export const BLOWER = { x: 0.29, y: 0.045, z: -0.15 } as const;
