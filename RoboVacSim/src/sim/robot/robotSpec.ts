/**
 * Physical dimensions of the robot and dock (meters). Shared by the simulation and the 3D models so
 * that what you see matches what is simulated.
 *
 * Robot model local frame: origin on the floor below the chassis center, +X forward, +Y up.
 * The robot's LEFT side (sim CCW side, +90 deg from heading) is local +Z, RIGHT side is local -Z.
 */
export const ROBOT = {
  radius: 0.175,
  /** Chassis top (without LiDAR turret). */
  bodyHeight: 0.082,
  /** Top of LiDAR turret = overall height used for "can it fit under furniture". */
  height: 0.1,
  groundClearance: 0.02,
  lidarHeight: 0.092,
  /** Turret center offset along +X. */
  lidarOffsetX: 0.035,
  lidarTurretRadius: 0.042,
  wheelRadius: 0.036,
  wheelWidth: 0.022,
  /** Distance between the two drive wheel contact points. */
  wheelBase: 0.235,
  casterOffsetX: 0.13,
  /** Main roller brush: centered at mainBrushX along X, spans mainBrushWidth along Z. */
  mainBrushX: -0.02,
  mainBrushWidth: 0.22,
  mainBrushLength: 0.055,
  /** Side brush on the front-right corner. */
  sideBrushX: 0.115,
  sideBrushZ: -0.105,
  sideBrushRadius: 0.075,
  /** Two rotating mop pads at the rear. */
  mopX: -0.1,
  mopZ: 0.068,
  mopRadius: 0.062,
  /** Front bumper arc: covers +-bumperArc radians around +X. */
  bumperArc: (Math.PI * 100) / 180,
  bumperTravel: 0.008,
  /** Cliff sensors (local XZ), 4 under the front half + 2 at the rear corners. */
  cliffSensors: [
    { x: 0.15, z: 0.07 },
    { x: 0.15, z: -0.07 },
    { x: 0.1, z: 0.13 },
    { x: 0.1, z: -0.13 },
    { x: -0.12, z: 0.12 },
    { x: -0.12, z: -0.12 },
  ],
  /** Charging contacts on the front underside. */
  chargeContactX: 0.145,
} as const;

/**
 * Dock local frame: origin = docked robot center on the floor, +X points from the robot toward the
 * dock tower (the docked robot faces +X), +Y up. Tower occupies x in [towerFrontX, towerBackX].
 */
export const DOCK = {
  towerFrontX: 0.2,
  towerBackX: 0.46,
  width: 0.42,
  towerHeight: 0.5,
  /** Base plate / ramp the robot sits on while docked. */
  baseFrontX: -0.24,
  baseHeight: 0.012,
  /** Approach pose distance in front of the docked pose (along -X). */
  approachDistance: 0.85,
} as const;
