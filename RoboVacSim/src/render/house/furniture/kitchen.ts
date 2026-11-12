import { clamp, shade, type FurnitureCtx } from './common';

const TOP_T = 0.04;

/** Cabinet fronts: a drawer row on top and doors below, with steel bar handles. */
function cabinetFronts(c: FurnitureCtx, mat: string, x0: number, x1: number, y0: number, y1: number, zFront: number): void {
  const { b } = c;
  const width = x1 - x0;
  const n = Math.max(1, Math.round(width / 0.6));
  const fw = width / n;
  const drawerH = Math.min(0.17, (y1 - y0) * 0.25);
  for (let i = 0; i < n; i++) {
    const x = x0 + fw * (i + 0.5);
    b.box(mat, fw - 0.005, drawerH - 0.005, 0.018, x, y1 - drawerH / 2, zFront - 0.009);
    b.box(mat, fw - 0.005, y1 - y0 - drawerH - 0.005, 0.018, x, (y0 + y1 - drawerH) / 2, zFront - 0.009);
    b.box('steel', Math.min(0.32, fw * 0.55), 0.012, 0.018, x, y1 - drawerH / 2, zFront + 0.009);
    const hx = x + (i % 2 === 0 ? fw / 2 - 0.05 : -fw / 2 + 0.05);
    b.box('steel', 0.012, 0.14, 0.018, hx, y1 - drawerH - 0.1, zFront + 0.009);
  }
}

export function kitchenCounter(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const body = `paint|${c.color}`;
  const top = 'stone|#34363a';
  const toe = 0.1;
  const doorFront = d / 2 - 0.028; // handles reach d/2 - 0.01
  b.box(`paint|${shade(c.color, 0.45)}`, w, toe, d - 0.06, 0, toe / 2, -0.03);
  b.box(body, w, h - TOP_T - toe, doorFront - 0.018 + d / 2, 0, (toe + h - TOP_T) / 2, (doorFront - 0.018 - d / 2) / 2);
  cabinetFronts(c, body, -w / 2, w / 2, toe + 0.003, h - TOP_T - 0.003, doorFront);
  // Backsplash tiles against the wall.
  b.box('stone|#34363a', w, 0.08, 0.015, 0, h + 0.04, -d / 2 + 0.0075);
  b.wallMounted(() => b.box('gloss|#e9e5de', w, 0.42, 0.01, 0, h + 0.08 + 0.21, -d / 2 + 0.005));
  if (w >= 2.0) {
    // Countertop around an undermount sink, basin, faucet.
    const sw = 0.62;
    const sd = 0.4;
    const sx = clamp(-w * 0.12, -w / 2 + sw / 2 + 0.1, w / 2 - sw / 2 - 0.1);
    const sz = 0.02;
    const yT = h - TOP_T / 2;
    b.box(top, sx - sw / 2 + w / 2, TOP_T, d, (-w / 2 + sx - sw / 2) / 2, yT, 0);
    b.box(top, w / 2 - (sx + sw / 2), TOP_T, d, (w / 2 + sx + sw / 2) / 2, yT, 0);
    b.box(top, sw, TOP_T, d / 2 - (sz + sd / 2), sx, yT, (d / 2 + sz + sd / 2) / 2);
    b.box(top, sw, TOP_T, sz - sd / 2 + d / 2, sx, yT, (-d / 2 + sz - sd / 2) / 2);
    const depth = 0.18;
    const yb = h - TOP_T - depth;
    b.box('steel', sw, 0.01, sd, sx, yb, sz);
    b.box('steel', sw, depth, 0.01, sx, yb + depth / 2, sz - sd / 2 + 0.005);
    b.box('steel', sw, depth, 0.01, sx, yb + depth / 2, sz + sd / 2 - 0.005);
    b.box('steel', 0.01, depth, sd, sx - sw / 2 + 0.005, yb + depth / 2, sz);
    b.box('steel', 0.01, depth, sd, sx + sw / 2 - 0.005, yb + depth / 2, sz);
    b.box('steel', 0.08, depth * 0.5, sd - 0.02, sx, yb + depth * 0.25, sz);
    // Faucet behind the basin.
    const fz = sz - sd / 2 - 0.05;
    b.cyl('chrome', 0.025, 0.03, 0.03, sx, h + 0.015, fz);
    b.cyl('chrome', 0.014, 0.014, 0.28, sx, h + 0.16, fz, { seg: 12 });
    b.torus('chrome', 0.08, 0.014, sx, h + 0.3, fz + 0.08, { arc: Math.PI, ry: Math.PI / 2, seg: 16 });
    b.cyl('chrome', 0.016, 0.014, 0.06, sx, h + 0.27, fz + 0.16, { seg: 12 });
  } else {
    b.box(top, w, TOP_T, d, 0, h - TOP_T / 2, 0);
    if (c.details) {
      // Small appliances: kettle, cutting board, and a coffee machine on longer runs.
      if (w < 1.8) b.cyl('steel', 0.07, 0.08, 0.2, -w * 0.18, h + 0.1, -d * 0.1);
      b.box('wood|#c49a6c', Math.min(0.35, w * 0.4), 0.02, 0.24, w * 0.08, h + 0.01, 0.0, { ry: 0.2 });
      if (w >= 1.8) {
        b.rbox('paint|#2b2d31', 0.24, 0.34, 0.3, 0.02, w * 0.32, h + 0.17, -d / 2 + 0.2);
        b.box('steel', 0.1, 0.02, 0.12, w * 0.32, h + 0.04, -d / 2 + 0.37);
      }
    }
  }
}

/** Kitchen island: cabinets on the working side (-z), seating overhang on +z with a kick plinth. */
export function kitchenIsland(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const body = `paint|${c.color}`;
  const top = 'stone|#ece8e1';
  const ov = d >= 0.75 ? clamp(d * 0.25, 0.18, 0.3) : 0.12;
  const toe = 0.1;
  const baseZ1 = d / 2 - ov;
  const backFront = -d / 2 + 0.028;
  // Plinth under the full footprint at floor level (solid base per catalog).
  b.box(`paint|${shade(c.color, 0.55)}`, w - 0.02, toe, d - 0.02, 0, toe / 2, 0);
  b.box(body, w, h - TOP_T - toe, baseZ1 - (backFront + 0.018), 0, (toe + h - TOP_T) / 2, (baseZ1 + backFront + 0.018) / 2);
  // Fronts face -z: build with mirrored z.
  const n = Math.max(1, Math.round(w / 0.6));
  const fw = w / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + fw * (i + 0.5);
    const rowH = (h - TOP_T - toe) / 3;
    for (let r = 0; r < 3; r++) {
      const y = toe + rowH * (r + 0.5);
      b.box(body, fw - 0.005, rowH - 0.005, 0.018, x, y, backFront + 0.009);
      b.box('steel', Math.min(0.3, fw * 0.5), 0.012, 0.018, x, y + rowH * 0.3, backFront - 0.009);
    }
  }
  b.box(top, w, 0.05, d, 0, h - 0.025, 0);
  if (c.details) {
    b.lathe(
      'ceramic',
      [
        [0, 0],
        [0.07, 0],
        [0.13, 0.05],
        [0.15, 0.09],
        [0.143, 0.092],
        [0.12, 0.055],
        [0.065, 0.01],
        [0, 0.01],
      ],
      w * 0.2,
      h,
      -d * 0.05,
    );
    for (const [x, z] of [
      [0.03, 0.02],
      [-0.04, 0.03],
      [0.0, -0.05],
      [0.05, -0.03],
    ]) b.sphere('paint|#8fbf3a', 0.036, w * 0.2 + x, h + 0.055, -d * 0.05 + z, { seg: 12 });
  }
}

export function fridge(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const door = `steel|${c.color}`;
  const doorT = 0.05;
  const zDoor = d / 2 - 0.03 - doorT / 2;
  b.box(door, w, h - 0.005, d - 0.03 - doorT, 0, h / 2, -(0.03 + doorT) / 2);
  b.box('black', 0.006, h * 0.6, 0.004, 0, h - h * 0.3, d / 2 - 0.03 - doorT + 0.002);
  b.box('black', w - 0.01, 0.006, 0.004, 0, h - h * 0.6, d / 2 - 0.03 - doorT + 0.002);
  b.box('black', w - 0.04, 0.07, 0.02, 0, 0.035, d / 2 - 0.04);
  const split = h * 0.6;
  const fy0 = 0.08;
  // Freezer drawer + two french doors.
  b.rbox(door, w - 0.008, h - split - fy0 - 0.008, doorT, 0.008, 0, (fy0 + h - split) / 2, zDoor);
  for (const s of [-1, 1]) b.rbox(door, w / 2 - 0.006, split - 0.008, doorT, 0.008, (s * w) / 4, h - split / 2, zDoor);
  // Handles.
  const hz = d / 2 - 0.012;
  for (const s of [-1, 1]) {
    b.box('chrome', 0.02, 0.62, 0.016, s * 0.035, h - split / 2, hz);
    b.box('chrome', 0.02, 0.016, 0.03, s * 0.035, h - split / 2 + 0.3, hz - 0.012);
    b.box('chrome', 0.02, 0.016, 0.03, s * 0.035, h - split / 2 - 0.3, hz - 0.012);
  }
  b.box('chrome', w * 0.6, 0.02, 0.016, 0, h - split - 0.06, hz);
  // Water dispenser.
  b.box('glassDark', 0.16, 0.26, 0.006, -w / 4, h - split * 0.55, d / 2 - 0.03 + 0.003);
}

export function stove(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const body = `metal|${c.color}`;
  b.box(body, w, h - 0.03, d - 0.02, 0, (h - 0.03) / 2, -0.01);
  b.box('glassDark', w, 0.03, d, 0, h - 0.015, 0);
  // Back control panel with knobs.
  b.box(body, w, 0.12, 0.06, 0, h + 0.06, -d / 2 + 0.03);
  for (let k = 0; k < 5; k++) b.cyl('chrome', 0.018, 0.018, 0.02, -w * 0.32 + k * w * 0.16, h + 0.07, -d / 2 + 0.07, { rx: Math.PI / 2, seg: 12 });
  // Burners + grates.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = (sx * w) / 4;
      const z = (sz * d) / 4 + 0.03;
      const r = sx * sz > 0 ? 0.075 : 0.06;
      b.torus('black', r, 0.009, x, h + 0.008, z, { rx: Math.PI / 2, seg: 20 });
      b.cyl('black', 0.035, 0.035, 0.016, x, h + 0.008, z, { seg: 14 });
      b.box('black', r * 2.4, 0.012, 0.012, x, h + 0.022, z);
      b.box('black', 0.012, 0.012, r * 2.4, x, h + 0.022, z);
    }
  }
  // Oven door with window and bar handle.
  const doorH = h * 0.58;
  b.box('glassDark', w - 0.06, doorH, 0.012, 0, 0.12 + doorH / 2, d / 2 - 0.016);
  b.box('chrome', w - 0.14, 0.022, 0.022, 0, 0.12 + doorH - 0.04, d / 2 - 0.011);
  b.box('black', w - 0.06, 0.08, 0.012, 0, 0.06, d / 2 - 0.016);
}
