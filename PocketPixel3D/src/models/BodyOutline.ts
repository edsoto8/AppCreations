import { BODY, HALF_H, HALF_W } from './Layout';

/** Builds a CCW outline of the body, optionally inset and with the top cartridge notch. */
export function bodyOutline(inset: number, notch?: { halfWidth: number; bottom: number }): [number, number][] {
  const x0 = -HALF_W + inset;
  const x1 = HALF_W - inset;
  const y0 = -HALF_H + inset;
  const y1 = HALF_H - inset;
  const r = Math.max(0.5, BODY.cornerRadius - inset);
  const rbr = Math.max(0.5, BODY.bottomRightRadius - inset);
  const pts: [number, number][] = [];
  const arc = (cx: number, cy: number, rad: number, a0: number, a1: number): void => {
    const steps = Math.max(3, Math.ceil(rad * 1.6));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
  };
  arc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
  arc(x1 - rbr, y0 + rbr, rbr, Math.PI * 1.5, Math.PI * 2);
  arc(x1 - r, y1 - r, r, 0, Math.PI * 0.5);
  if (notch) {
    const hw = notch.halfWidth + inset;
    const nb = notch.bottom - inset;
    pts.push([hw, y1], [hw, nb], [-hw, nb], [-hw, y1]);
  }
  arc(x0 + r, y1 - r, r, Math.PI * 0.5, Math.PI);
  return pts;
}
