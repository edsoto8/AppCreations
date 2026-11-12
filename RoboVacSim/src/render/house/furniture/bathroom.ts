import type { FurnitureCtx } from './common';

/** Toilet: tank at -z, bowl toward +z, lid closed. */
export function toilet(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const bz = 0.06;
  const oval = Math.min(1.4, (d / 2 - 0.04 - bz) / 0.18 + 0.35);
  b.cyl('ceramic', 0.11, 0.13, 0.3, 0, 0.15, bz, { sz: 1.35 });
  b.cyl('ceramic', 0.18, 0.135, 0.12, 0, 0.34, bz, { sz: oval, seg: 28 });
  b.torus('plastic|#fbfbfa', 0.15, 0.024, 0, 0.41, bz, { rx: Math.PI / 2, sy: oval, seg: 28 });
  b.cyl('plastic|#fbfbfa', 0.172, 0.172, 0.022, 0, 0.443, bz, { sz: oval, seg: 28 });
  const tankD = 0.18;
  const tz = -d / 2 + 0.01 + tankD / 2;
  b.cyl('ceramic', 0.06, 0.07, 0.2, 0, 0.42, tz + 0.08, { sz: 1.2 });
  b.rbox('ceramic', Math.min(w - 0.02, 0.38), h - 0.42 - 0.03, tankD, 0.025, 0, (0.42 + h - 0.03) / 2, tz);
  b.rbox('ceramic', Math.min(w, 0.4), 0.03, tankD + 0.015, 0.012, 0, h - 0.015, tz + 0.005);
  b.cyl('chrome', 0.025, 0.025, 0.008, 0, h + 0.004, tz);
}

/** Bathtub (long along x): hollow shell, rim, faucet + drain at -x end. */
export function bathtub(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const t = 0.075;
  for (const s of [-1, 1]) {
    b.box('ceramic', w, h - 0.03, t, 0, (h - 0.03) / 2, s * (d / 2 - t / 2));
    b.box('ceramic', t, h - 0.03, d - 2 * t, s * (w / 2 - t / 2), (h - 0.03) / 2, 0);
    b.rbox('ceramic', w, 0.03, t + 0.01, 0.012, 0, h - 0.015, s * (d / 2 - (t + 0.01) / 2));
    b.rbox('ceramic', t + 0.01, 0.03, d, 0.012, s * (w / 2 - (t + 0.01) / 2), h - 0.015, 0);
  }
  b.box('ceramic', w - 2 * t, 0.14, d - 2 * t, 0, 0.07, 0);
  b.rbox('ceramic', w - 2 * t - 0.04, 0.04, d - 2 * t - 0.04, 0.02, 0, 0.15, 0);
  b.cyl('chrome', 0.03, 0.03, 0.006, -w / 2 + t + 0.12, 0.173, 0, { seg: 16 });
  // Wall-side faucet at the -x end.
  const fx = -w / 2 + t / 2;
  b.cyl('chrome', 0.022, 0.025, 0.05, fx, h + 0.025, 0);
  b.box('chrome', 0.14, 0.022, 0.03, fx + 0.07, h + 0.05, 0);
  b.cyl('chrome', 0.022, 0.022, 0.03, fx, h + 0.015, -0.1, { seg: 12 });
  b.cyl('chrome', 0.022, 0.022, 0.03, fx, h + 0.015, 0.1, { seg: 12 });
}

/** Vanity: cabinet with doors, ceramic top, vessel basin, faucet, wall mirror (on the -z side). */
export function vanity(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const body = `paint|${c.color}`;
  const cl = c.spec.clearance;
  const topT = 0.03;
  b.box(body, w - 0.04, cl + 0.01, d - 0.05, 0, (cl + 0.01) / 2, -0.02);
  b.box(body, w, h - topT - cl, d - 0.02, 0, (cl + h - topT) / 2, -0.01);
  for (const s of [-1, 1]) {
    b.box(body, w / 2 - 0.008, h - topT - cl - 0.02, 0.016, (s * w) / 4, (cl + h - topT) / 2, d / 2 - 0.012);
    b.box('chrome', 0.012, 0.14, 0.012, s * 0.035, h - topT - 0.12, d / 2 - 0.002);
  }
  b.box('ceramic', w, topT, d, 0, h - topT / 2, 0);
  const br = Math.min(0.2, Math.min(w, d) * 0.4);
  b.lathe(
    'ceramic',
    [
      [0, 0],
      [br * 0.55, 0],
      [br * 0.9, 0.05],
      [br, 0.12],
      [br * 0.94, 0.122],
      [br * 0.84, 0.06],
      [br * 0.5, 0.016],
      [0, 0.016],
    ],
    0,
    h,
    0.03,
    { seg: 32 },
  );
  const fz = 0.03 - br - 0.06;
  b.cyl('chrome', 0.018, 0.022, 0.22, 0, h + 0.11, fz, { seg: 12 });
  b.box('chrome', 0.022, 0.022, 0.12, 0, h + 0.21, fz + 0.06);
  // Mirror with a slim frame, hung on the wall behind.
  const mw = Math.min(w * 0.85, 0.9);
  b.wallMounted(() => {
    b.box('chrome', mw + 0.03, 0.78, 0.008, 0, 1.52, -d / 2 + 0.004);
    b.box('mirror', mw, 0.75, 0.006, 0, 1.52, -d / 2 + 0.011);
  });
}

export function washingMachine(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const body = `gloss|${c.color}`;
  b.rbox(body, w, h - 0.02, d - 0.01, 0.02, 0, (h + 0.02) / 2, -0.005);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('rubber', 0.05, 0.02, 0.05, sx * (w / 2 - 0.06), 0.01, sz * (d / 2 - 0.06));
  b.box('black', w - 0.06, 0.1, 0.008, 0.0, h - 0.08, d / 2 - 0.004);
  b.box(body, 0.18, 0.07, 0.01, -w / 2 + 0.13, h - 0.08, d / 2 - 0.002);
  b.cyl('chrome', 0.025, 0.025, 0.02, w / 2 - 0.1, h - 0.08, d / 2, { rx: Math.PI / 2, seg: 14 });
  const dr = Math.min(0.18, w * 0.3);
  const dy = (h - 0.14) * 0.48;
  b.torus('chrome', dr, 0.022, 0, dy, d / 2 - 0.02, { seg: 32 });
  b.cyl('glassDark', dr - 0.01, dr - 0.01, 0.02, 0, dy, d / 2 - 0.025, { rx: Math.PI / 2, seg: 32 });
}
