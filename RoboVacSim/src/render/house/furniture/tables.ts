import { legCenters, shade, squareLegs, type FurnitureCtx } from './common';

/** Apron boards between the legs (on the leg center lines), bottom exactly at the catalog clearance. */
function apron(c: FurnitureCtx, mat: string, y0: number, y1: number): void {
  const legs = legCenters(c);
  const hx = Math.abs(legs[0].x);
  const hz = Math.abs(legs[0].z);
  const ls = c.spec.legSize;
  const t = Math.min(0.022, ls * 0.6);
  const ym = (y0 + y1) / 2;
  const hg = y1 - y0;
  for (const s of [-1, 1]) {
    c.b.box(mat, hx * 2 - ls, hg, t, 0, ym, s * hz);
    c.b.box(mat, t, hg, hz * 2 - ls, s * hx, ym, 0);
  }
}

export function coffeeTable(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const wood = `wood|${c.color}`;
  const cl = c.spec.clearance;
  const topT = 0.04;
  squareLegs(c, wood, h - topT);
  apron(c, wood, cl, h - topT);
  b.rbox(wood, w, topT, d, 0.008, 0, h - topT / 2, 0);
  if (c.details) {
    b.box('paint|#2f4858', 0.25, 0.03, 0.18, -w * 0.22, h + 0.015, -d * 0.1, { ry: 0.15 });
    b.box('paint|#2f4858', 0.21, 0.025, 0.15, -w * 0.22, h + 0.0425, -d * 0.1, { ry: -0.1 });
    b.lathe(
      'ceramic',
      [
        [0, 0],
        [0.05, 0],
        [0.085, 0.03],
        [0.1, 0.06],
        [0.094, 0.062],
        [0.078, 0.034],
        [0.045, 0.008],
        [0, 0.008],
      ],
      w * 0.2,
      h,
      d * 0.05,
    );
  }
}

export function diningTable(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const wood = `wood|${c.color}`;
  const cl = c.spec.clearance;
  const topT = 0.03;
  squareLegs(c, wood, h - topT);
  apron(c, wood, cl, h - topT);
  b.rbox(wood, w, topT, d, 0.006, 0, h - topT / 2, 0);
  if (c.details) {
    const long = w >= d;
    b.box('linen|#d8cbb5', long ? w * 0.8 : 0.32, 0.003, long ? 0.32 : d * 0.8, 0, h + 0.0015, 0);
    b.lathe(
      'ceramic',
      [
        [0, 0],
        [0.06, 0],
        [0.11, 0.04],
        [0.13, 0.08],
        [0.124, 0.082],
        [0.1, 0.045],
        [0.055, 0.01],
        [0, 0.01],
      ],
      0,
      h + 0.003,
      0,
    );
    for (const [x, z] of [
      [0.03, 0.02],
      [-0.04, 0.03],
      [0.0, -0.045],
    ]) b.sphere('paint|#e08a2c', 0.038, x, h + 0.05, z, { seg: 12 });
  }
}

export function desk(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const wood = `wood|${c.color}`;
  const cl = c.spec.clearance;
  const topT = 0.03;
  squareLegs(c, 'black', h - topT);
  apron(c, 'black', cl, h - topT);
  b.rbox(wood, w, topT, d, 0.005, 0, h - topT / 2, 0);
  if (!c.details) return;
  // Monitor on a stand near the back edge, keyboard + mouse in front.
  const mw = Math.min(0.62, w * 0.5);
  const mh = mw * 0.58;
  const mz = -d / 2 + 0.14;
  b.box('black', 0.22, 0.012, 0.16, 0, h + 0.006, mz);
  b.box('black', 0.045, 0.18, 0.025, 0, h + 0.1, mz - 0.03);
  b.box('black', mw, mh, 0.028, 0, h + 0.13 + mh / 2, mz - 0.01, { rx: -0.06 });
  b.box('screen', mw - 0.024, mh - 0.03, 0.003, 0, h + 0.13 + mh / 2 + 0.006, mz + 0.0045, { rx: -0.06 });
  b.rbox('black', Math.min(0.44, w * 0.36), 0.02, 0.14, 0.006, 0, h + 0.01, Math.min(d / 2 - 0.1, mz + 0.3));
  b.rbox('black', 0.06, 0.025, 0.1, 0.012, Math.min(0.3, w * 0.3), h + 0.0125, Math.min(d / 2 - 0.1, mz + 0.3));
}

export function tvStand(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const body = `paint|${c.color}`;
  const front = 'wood|#a57c55';
  const cl = c.spec.clearance;
  b.box(body, w - 0.06, cl, d - 0.05, 0, cl / 2, -0.01);
  b.box(body, w, h - cl, d - 0.015, 0, (cl + h) / 2, -0.0075);
  const n = 3;
  const fw = (w - 0.04) / n;
  for (let i = 0; i < n; i++) b.box(front, fw - 0.008, h - cl - 0.05, 0.015, -w / 2 + 0.02 + fw * (i + 0.5), (cl + h) / 2, d / 2 - 0.0075);
  // TV on a pedestal foot.
  const tw = Math.min(1.45, w * 0.82);
  const th = (tw * 9) / 16;
  b.box('black', 0.34, 0.012, 0.2, 0, h + 0.006, -0.02);
  b.box('black', 0.07, 0.09, 0.03, 0, h + 0.055, -0.05);
  b.box('black', tw, th, 0.035, 0, h + 0.09 + th / 2, -0.04);
  b.box('screen', tw - 0.016, th - 0.016, 0.003, 0, h + 0.09 + th / 2, -0.0215);
  if (c.details) b.rbox('black', Math.min(0.9, tw * 0.6), 0.06, 0.08, 0.02, 0, h + 0.03, d / 2 - 0.08);
}

export function sideboard(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const wood = `wood|${c.color}`;
  const cl = c.spec.clearance;
  squareLegs(c, 'black', cl + 0.005);
  b.box(wood, w, h - cl, d - 0.015, 0, (cl + h) / 2, -0.0075);
  const n = w > 1.3 ? 4 : 2;
  const fw = (w - 0.03) / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.015 + fw * (i + 0.5);
    b.box(`wood|${shade(c.color, 1.15)}`, fw - 0.008, h - cl - 0.05, 0.015, x, (cl + h) / 2, d / 2 - 0.0075);
    b.box('brass', 0.012, 0.12, 0.012, x + (i % 2 === 0 ? fw / 2 - 0.04 : -fw / 2 + 0.04), (cl + h) / 2 + 0.05, d / 2 - 0.006);
  }
  if (c.details) {
    b.lathe(
      'ceramic',
      [
        [0, 0],
        [0.06, 0],
        [0.075, 0.1],
        [0.04, 0.22],
        [0.03, 0.28],
        [0.036, 0.3],
        [0, 0.3],
      ],
      w * 0.28,
      h,
      -d * 0.1,
    );
    b.box('paint|#3d5a80', 0.3, 0.035, 0.22, -w * 0.25, h + 0.0175, 0, { ry: 0.1 });
  }
}
