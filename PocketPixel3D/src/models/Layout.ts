/**
 * Physical layout of the console in millimetres. Origin = centre of the body, +x right, +y up,
 * +z toward the viewer (front face). Proportions follow the classic 90 × 148 × 32 mm handheld.
 */
export const BODY = {
  width: 90,
  height: 148,
  depth: 32,
  cornerRadius: 5,
  /** The signature large radius on the bottom-right corner. */
  bottomRightRadius: 24,
  wall: 2.2,
  bevel: 1.3,
  plate: 1.6,
  /** Half the gap of the moulding seam between the front and back shells. */
  seam: 0.3,
} as const;

export const HALF_W = BODY.width / 2;
export const HALF_H = BODY.height / 2;
export const FRONT_Z = BODY.depth / 2;
export const BACK_Z = -BODY.depth / 2;

export const LENS = { cx: 0, cy: 34.5, width: 76, height: 57, radius: 3, bottomRightRadius: 14 } as const;
/** Visible LCD window inside the lens, and the active pixel area (160:144). */
export const LCD_WINDOW = { cx: 0, cy: 32, width: 49.5, height: 44.5 } as const;
export const LCD_ACTIVE = { width: 47.2, height: 42.5 } as const;
export const LED = { x: -31, y: 39 } as const;

export const DPAD = { x: -24, y: -27, span: 24, arm: 8.2, height: 5 } as const;
export const BUTTON_A = { x: 31, y: -23.5, radius: 5 } as const;
export const BUTTON_B = { x: 15.5, y: -31, radius: 5 } as const;
export const AB_ANGLE = Math.atan2(BUTTON_A.y - BUTTON_B.y, BUTTON_A.x - BUTTON_B.x);

export const PILL = { length: 10.5, width: 3.4, angle: 0.44 } as const;
export const SELECT = { x: -9, y: -50 } as const;
export const START = { x: 7, y: -50 } as const;

export const SPEAKER = { x: 25.5, y: -58, slots: 6, slotLength: 14, slotWidth: 1.35, spacing: 3.7, angle: -1.05 } as const;

export const POWER_SWITCH = { offX: -32.5, onX: -24.5, z: 9, trackMinX: -36.5, trackMaxX: -20.5 } as const;

export const VOLUME_WHEEL = { y: -26, z: 7, radius: 7.5, thickness: 3.4 } as const;
export const CONTRAST_WHEEL = { y: 30, z: 7, radius: 7.5, thickness: 3.4 } as const;
export const LINK_PORT = { y: -4, z: 7, height: 11, depth: 6 } as const;
export const DC_JACK = { y: -58, z: 7, radius: 2.6 } as const;
export const PHONES_JACK = { x: 4, z: 7, radius: 2.2 } as const;

/** Cartridge bay in the back shell (open at the top). */
export const BAY = { halfWidth: 29.4, bottom: 11, floorZ: -6.6 } as const;

export const CART = { width: 57, height: 65, depth: 8 } as const;
/** Cartridge centre when fully inserted (its label faces -z, out of the back). */
export const CART_INSERTED = { x: 0, y: HALF_H + 3 - CART.height / 2, z: BACK_Z + 0.6 + CART.depth / 2 } as const;

export const BATTERY_BAY = { cx: 0, cy: -37, width: 58, height: 58, depth: 14.6 } as const;
