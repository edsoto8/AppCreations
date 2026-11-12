/**
 * Layout of the generic lobby ATM, in metres. Front faces +Z, base at y = 0, centred on x = 0.
 *
 *  Side section (z → front)                    Front view
 *  y 1.90 ┌──────── topper sign ────────┐
 *  y 1.65 ├─ top ───────────────────────┤      speakers · camera · status
 *         │ upper module  │  service    │      screen (15" 4:3) + hood
 *         │ PC/PSU/comms  │  door       │      card reader · contactless · receipt
 *  y 0.99 │ card rdr/prtr │  (fascia)   │      keypad deck + wallet shelf
 *  y 0.845├─ fascia band: cash slot, deposit slot, escrow ─┤
 *         │ SAFE: transport│ cassettes  │ vault door
 *  y 0.06 └── plinth ───────────────────┘
 */
export const D = {
  W: 0.72,
  halfW: 0.36,
  H: 1.65,
  front: 0.425,
  back: -0.425,
  plinthH: 0.06,
  /** inner faces of the side skins */
  skinIn: 0.335,
  // safe
  safeWallIn: 0.29,
  safeFloorTop: 0.1,
  safeCeilBottom: 0.8,
  safeTop: 0.845,
  safeBackIn: -0.375,
  safeFrontIn: 0.36,
  vaultDoor: { x0: -0.331, x1: 0.331, y0: 0.07, y1: 0.838, z0: 0.362, z1: 0.425 },
  // fascia band (fixed)
  band: { y0: 0.845, y1: 0.99 },
  // service door
  door: { x0: -0.329, x1: 0.329, y0: 0.992, y1: 1.622, face: 0.3, faceT: 0.012 },
  // top
  topY: 1.625,
  // dispenser column (right) and deposit column (left)
  dispX: 0.135,
  depX: -0.16,
  cash: { y: 0.92 },
  // customer interface (on the service door face)
  rightCol: 0.255,
  leftCol: -0.255,
  receipt: { y: 1.085 },
  card: { y: 1.175 },
  contactless: { y: 1.29 },
  speakerY: 1.425,
  screen: { cx: 0, cy: 1.315, w: 0.304, h: 0.228, tilt: (-9 * Math.PI) / 180 },
  keypad: { x: -0.035 },
  /** keypad deck profile: front lip z, bottom y, slope front/back */
  deck: { zFront: 0.515, yBottom: 0.996, yFrontTop: 1.03, zBack: 0.306, yBackTop: 1.097, shelfX: 0.15, shelfTop: 1.038 },
  // cassettes (y bottom of each)
  cassette: {
    x0: 0.025,
    x1: 0.245,
    z0: -0.255,
    z1: 0.3,
    h: 0.095,
    y: { reject: 0.105, C: 0.23, B: 0.355, A: 0.48 } as Record<'reject' | 'A' | 'B' | 'C', number>,
  },
  retract: { y0: 0.605, y1: 0.668, z0: -0.04, z1: 0.3 },
  transportZ: -0.278,
  rejectChannelZ: -0.31,
  sensorY: 0.625,
  diverterY: 0.668,
  stacker: { y: 0.703, z: -0.13 },
} as const;
