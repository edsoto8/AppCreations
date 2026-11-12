/**
 * ATM drawing geometry in SVG user units (viewBox 0 0 720 1060).
 * The front of the machine is drawn face-on with an oblique side and top to suggest depth.
 * All mechanism positions are a simplified, generic layout for teaching — not a specific manufacturer's design.
 */
export const VIEW = { w: 720, h: 1060 } as const;

export const CAB = { x: 60, y: 90, w: 560, h: 930, depthX: 70, depthY: -40 } as const;

export const SCREEN = { x: 175, y: 212, w: 330, h: 206 } as const;
export const KEYPAD = { x: 250, y: 470, w: 180, h: 120 } as const;
export const CARD_SLOT = { x: 548, y: 470, w: 56, h: 14 } as const;
export const RECEIPT = { x: 540, y: 560, w: 70, h: 8 } as const;
export const CASH_SLOT = { x: 200, y: 660, w: 280, h: 40 } as const;
export const SAFE = { x: 80, y: 730, w: 520, h: 270 } as const;

/** Cassette boxes inside the safe (top to bottom). */
export const CASSETTES = [
  { id: 'A', denom: 20, x: 92, y: 812, w: 310, h: 54 },
  { id: 'B', denom: 50, x: 92, y: 875, w: 310, h: 54 },
  { id: 'C', denom: 100, x: 92, y: 938, w: 310, h: 54 },
] as const;

export const PICK_Y = (i: number) => CASSETTES[i].y + 14;


/** Vertical transport channel. */
export const TRANSPORT = { x: 470, top: 752, bottom: 990, width: 30 } as const;
export const SENSOR = { x: 470, y: 800 } as const;
export const DIVERTER = { x: 470, y: 772 } as const;
export const STACKER = { wheelX: 418, wheelY: 770, stackX: 340, stackY: 778 } as const;
export const REJECT_BIN = { x: 512, y: 830, w: 90, h: 160 } as const;
export const PRESENTER_TOP = { x: 340, y: 704 } as const;
export const SHUTTER = { x: CASH_SLOT.x + 20, y: CASH_SLOT.y + 4, w: CASH_SLOT.w - 40, h: CASH_SLOT.h - 8 } as const;

export type Pt = { x: number; y: number };

/** Stack position of the n-th note (0-based) gathered in the stacker. */
export const stackSlot = (n: number): Pt => ({ x: STACKER.stackX, y: STACKER.stackY - n * 4.2 });

/**
 * Path of a note from cassette A (the $20 cassette) to the stacker: the front note is pulled up and
 * turned by the pick rollers, fed into the vertical transport, past the sensor and the diverter,
 * then swept onto the stack. `n` is the note's place in the stack.
 */
export const billPathA = (n: number): Pt[] => {
  const c = CASSETTES[0];
  return [
    { x: 392, y: c.y + 30 },
    { x: 393, y: c.y + 16 },
    { x: 416, y: PICK_Y(0) - 4 },
    { x: TRANSPORT.x, y: PICK_Y(0) - 4 },
    { x: SENSOR.x, y: SENSOR.y },
    { x: DIVERTER.x, y: DIVERTER.y },
    { x: STACKER.wheelX, y: DIVERTER.y },
    { x: stackSlot(n).x + 10, y: stackSlot(n).y - 4 },
    stackSlot(n),
  ];
};

/** Path of a flagged note from the sensor to the reject area. */
export const REJECT_PATH: Pt[] = [
  { x: TRANSPORT.x, y: PICK_Y(0) },
  { x: SENSOR.x, y: SENSOR.y },
  { x: DIVERTER.x, y: DIVERTER.y },
  { x: REJECT_BIN.x + 20, y: DIVERTER.y },
  { x: REJECT_BIN.x + REJECT_BIN.w / 2, y: REJECT_BIN.y + 30 },
];

/** Presenter path: stacked bundle → shutter. */
export const PRESENT_PATH: Pt[] = [
  { x: STACKER.stackX, y: STACKER.stackY },
  { x: STACKER.stackX, y: 742 },
  { x: PRESENTER_TOP.x, y: PRESENTER_TOP.y },
];

/** Position + heading at fraction t (0..1) along a polyline, with headings blended near corners. */
export function along(path: Pt[], t: number): { x: number; y: number; angle: number } {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const l = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    segs.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const f = segs[i] === 0 ? 0 : Math.min(1, d / segs[i]);
      const a = path[i];
      const b = path[i + 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      let angle = ang;
      // Blend toward the next segment's heading over the last 14 units of this one.
      if (i < segs.length - 1) {
        const c = path[i + 2];
        const next = Math.atan2(c.y - b.y, c.x - b.x);
        const remain = segs[i] - d;
        if (remain < 14) angle = lerpAngle(ang, next, 1 - remain / 14);
      }
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: (angle * 180) / Math.PI };
    }
    d -= segs[i];
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function pathD(path: Pt[]): string {
  return path.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
}
