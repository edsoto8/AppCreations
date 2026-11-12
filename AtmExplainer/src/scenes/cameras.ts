import type { Cam } from '../components/ATMCamera';

/** Camera presets shared across scenes so consecutive scenes join seamlessly. */
export const CAM_INSIDE: Cam = { fx: 370, fy: 770, sx: 1320, sy: 560, z: 1.4, yaw: -4 };
/** Close-up on the safe: cassettes, pick module, transport, sensor, stacker. */
export const CAM_SAFE: Cam = { fx: 370, fy: 865, sx: 1200, sy: 500, z: 2.05, yaw: 0 };
/** Stacker + presenter + cash slot. */
export const CAM_PRESENT: Cam = { fx: 360, fy: 735, sx: 1200, sy: 470, z: 1.75, yaw: 0 };
/** Front of the machine around the cash slot. */
export const CAM_SLOT: Cam = { fx: 360, fy: 690, sx: 1270, sy: 500, z: 1.95, yaw: -3 };
/** Upper safe incl. sensor, diverter and reject area. */
export const CAM_REJECT: Cam = { fx: 460, fy: 840, sx: 1430, sy: 520, z: 1.9, yaw: 0 };
/** Closing hero shot. */
export const CAM_CLOSE: Cam = { fx: 360, fy: 580, sx: 1320, sy: 520, z: 0.92, yaw: -8 };
