import { clamp, legCenters, shade, squareLegs, type FurnitureCtx } from './common';

const WOOD_DARK = 'wood|#3b2a20';
const PILLOW_ACCENT = 'fabric|#c9a24a';

/** Sofa: plinth with small feet (solid base), arms, back, seat + back cushions, throw pillows. */
export function sofa(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const fab = `fabric|${c.color}`;
  const cl = c.spec.clearance;
  const armW = clamp(w * 0.075, 0.12, 0.2);
  const backD = clamp(d * 0.22, 0.16, 0.24);
  const baseTop = cl + 0.2;
  const seatTop = Math.min(0.46, h * 0.54);
  const armTop = Math.min(h * 0.74, 0.64);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(WOOD_DARK, 0.05, cl, 0.05, sx * (w / 2 - 0.06), cl / 2, sz * (d / 2 - 0.06));
  b.rbox(fab, w, baseTop - cl, d, 0.03, 0, (cl + baseTop) / 2, 0);
  for (const sx of [-1, 1]) b.rbox(fab, armW, armTop - cl, d, 0.05, sx * (w / 2 - armW / 2), (cl + armTop) / 2, 0);
  const innerW = w - 2 * armW;
  b.rbox(fab, innerW + 0.04, h - baseTop, backD, 0.05, 0, (baseTop + h) / 2, -d / 2 + backD / 2);
  const n = w > 1.5 ? 3 : w > 1.0 ? 2 : 1;
  const cw = innerW / n;
  const seatD = d - backD;
  const backH = h - seatTop - 0.05;
  for (let i = 0; i < n; i++) {
    const x = -innerW / 2 + cw * (i + 0.5);
    b.rbox(fab, cw - 0.012, seatTop - baseTop, seatD - 0.01, 0.05, x, (baseTop + seatTop) / 2, -d / 2 + backD + seatD / 2);
    b.rbox(fab, cw - 0.025, backH, 0.15, 0.065, x, seatTop + backH / 2, -d / 2 + backD + 0.07, { rx: -0.12 });
  }
  if (c.details && innerW > 0.9) {
    for (const sx of [-1, 1]) {
      b.rbox(PILLOW_ACCENT, 0.38, 0.38, 0.12, 0.06, sx * (innerW / 2 - 0.24), seatTop + 0.19, -d / 2 + backD + 0.2, { rx: -0.28, rz: sx * 0.12 });
    }
  }
}

/** Armchair: four short legs (legs4 per catalog), upholstered body. */
export function armchair(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const fab = `fabric|${c.color}`;
  const cl = c.spec.clearance;
  squareLegs(c, WOOD_DARK, cl + 0.01);
  const armW = clamp(w * 0.15, 0.1, 0.16);
  const baseTop = cl + 0.22;
  const seatTop = Math.min(0.46, h * 0.5);
  const armTop = Math.min(h * 0.7, 0.64);
  const backD = 0.17;
  b.rbox(fab, w, baseTop - cl, d, 0.03, 0, (cl + baseTop) / 2, 0);
  for (const sx of [-1, 1]) b.rbox(fab, armW, armTop - cl, d, 0.05, sx * (w / 2 - armW / 2), (cl + armTop) / 2, 0);
  b.rbox(fab, w - 2 * armW + 0.04, h - baseTop, backD, 0.05, 0, (baseTop + h) / 2, -d / 2 + backD / 2);
  b.rbox(fab, w - 2 * armW - 0.01, seatTop - baseTop, d - backD - 0.01, 0.05, 0, (baseTop + seatTop) / 2, backD / 2);
  b.rbox(fab, w - 2 * armW - 0.03, h - seatTop - 0.06, 0.14, 0.06, 0, (seatTop + h - 0.06) / 2, -d / 2 + backD + 0.065, { rx: -0.12 });
  if (c.details) b.rbox(PILLOW_ACCENT, 0.34, 0.32, 0.11, 0.05, 0, seatTop + 0.17, -d / 2 + backD + 0.18, { rx: -0.3, rz: 0.08 });
}

/** Dining / desk chair: 4 legs per catalog (rear legs continue as back posts), seat pad, slatted back. */
export function chair(c: FurnitureCtx): void {
  const { b, w, h } = c;
  const wood = `wood|${c.color}`;
  const cl = c.spec.clearance;
  const ls = c.spec.legSize;
  const seatT = 0.03;
  const legs = legCenters(c);
  for (const l of legs) {
    const top = l.z < 0 ? h : cl + seatT;
    b.box(wood, ls, top, ls, l.x, top / 2, l.z);
  }
  const seatY = cl + seatT / 2;
  b.box(wood, w, seatT, c.d, 0, seatY, 0);
  const rearZ = legs[0].z;
  const postX = Math.abs(legs[0].x);
  // Back rails + slats between the rear posts.
  const railW = postX * 2 - ls;
  b.box(wood, railW, 0.07, 0.022, 0, h - 0.06, rearZ);
  b.box(wood, railW, 0.04, 0.022, 0, cl + seatT + 0.18, rearZ);
  for (const sx of [-0.33, 0, 0.33]) b.box(wood, 0.03, h - 0.1 - (cl + seatT + 0.2), 0.016, sx * railW, (h - 0.095 + cl + seatT + 0.2) / 2, rearZ);
  // Upholstered seat pad.
  b.rbox(`fabric|${shade('#b8ab98', 1)}`, w - 0.05, 0.035, c.d - 0.08, 0.015, 0, cl + seatT + 0.0175, 0.015);
}

/** Office chair: pedestal (floor contact = disc of catalog legSize), raised 5-star, seat, back, arms. */
export function officeChair(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const fab = `fabric|${c.color}`;
  const cl = c.spec.clearance;
  const footR = c.spec.legSize / 2;
  b.cyl('chrome', footR * 0.92, footR, 0.022, 0, 0.011, 0, { seg: 28 });
  b.cyl('black', 0.055, 0.06, 0.06, 0, 0.052, 0);
  b.cyl('chrome', 0.024, 0.024, cl - 0.1, 0, 0.08 + (cl - 0.1) / 2, 0, { seg: 14 });
  b.cyl('black', 0.034, 0.034, 0.12, 0, 0.16, 0, { seg: 14 });
  // 5-star spider, kept above robot height (only the central pedestal touches the floor).
  const R = Math.min(w, d) / 2 - 0.04;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    b.box('black', R - 0.03, 0.032, 0.045, ca * (R / 2 + 0.02), 0.128, sa * (R / 2 + 0.02), { ry: -a, rz: 0.04 });
    b.cyl('black', 0.024, 0.02, 0.03, ca * R, 0.125, sa * R, { seg: 10 });
  }
  const sw = w * 0.8;
  const sd = d * 0.78;
  b.box('black', 0.22, 0.03, 0.22, 0, cl + 0.015, 0);
  b.rbox(fab, sw, 0.08, sd, 0.035, 0, cl + 0.07, 0.03);
  // Back + spine.
  const backBottom = cl + 0.17;
  const backH = h - backBottom;
  b.box('black', 0.05, 0.22, 0.03, 0, cl + 0.12, -sd / 2 + 0.01);
  b.rbox(fab, w * 0.72, backH, 0.07, 0.03, 0, backBottom + backH / 2, -d / 2 + 0.06, { rx: -0.1 });
  for (const sx of [-1, 1]) {
    b.box('black', 0.03, 0.2, 0.04, sx * (sw / 2 + 0.005), cl + 0.17, 0.0);
    b.rbox('black', 0.06, 0.025, 0.24, 0.01, sx * (sw / 2 + 0.005), cl + 0.28, 0.02);
  }
}

/** Bar stool: small round foot (catalog pedestal disc), column, footrest ring, padded seat. */
export function barStool(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const cl = c.spec.clearance;
  const footR = c.spec.legSize / 2;
  const seatR = Math.min(w, d) / 2 - 0.02;
  b.cyl('chrome', footR * 0.85, footR, 0.02, 0, 0.01, 0, { seg: 24 });
  b.cyl('chrome', 0.022, 0.026, cl - 0.02, 0, 0.02 + (cl - 0.02) / 2, 0, { seg: 14 });
  const ringR = seatR - 0.04;
  b.torus('chrome', ringR, 0.01, 0, 0.32, 0, { rx: Math.PI / 2 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    b.box('chrome', ringR, 0.012, 0.012, (Math.cos(a) * ringR) / 2, 0.32, (Math.sin(a) * ringR) / 2, { ry: -a });
  }
  b.cyl('black', 0.07, 0.05, 0.03, 0, cl + 0.015, 0);
  const t = h - cl - 0.03;
  b.lathe(
    `leather|${c.color === '#2b2b2b' ? '#3a2a22' : c.color}`,
    [
      [0, 0],
      [seatR - 0.02, 0],
      [seatR, 0.02],
      [seatR, t - 0.03],
      [seatR - 0.025, t],
      [0, t],
    ],
    0,
    cl + 0.03,
    0,
    { seg: 28 },
  );
}
