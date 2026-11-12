import * as THREE from 'three';
import { seeded, shade, squareLegs, type FurnitureCtx } from './common';

/** Bed: long along local x, headboard at -x. Legs per catalog, frame underside at clearance. */
export function bed(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const cl = c.spec.clearance;
  const frame = 'fabric|#6f7279';
  const frameTop = cl + 0.16;
  const matTop = h - 0.04;
  squareLegs(c, 'wood|#3b2a20', cl + 0.01);
  b.rbox(frame, w, frameTop - cl, d, 0.02, 0, (cl + frameTop) / 2, 0);
  // Headboard.
  const hbT = 0.08;
  const hbTop = Math.max(h + 0.45, 1.0);
  b.rbox(frame, hbT, hbTop - cl, d, 0.03, -w / 2 + hbT / 2, (cl + hbTop) / 2, 0);
  // Mattress.
  const mL = w - hbT - 0.03;
  const mx = -w / 2 + hbT + 0.01 + mL / 2;
  b.rbox('linen|#f4f2ee', mL, matTop - frameTop, d - 0.06, 0.05, mx, (frameTop + matTop) / 2, 0);
  // Duvet draped over the foot part of the mattress (full width so it hangs down the sides).
  const duvL = mL * 0.72;
  const duvX = w / 2 - 0.005 - duvL / 2;
  const duv = `linen|${c.color}`;
  b.rbox(duv, duvL, matTop + 0.035 - (frameTop + 0.03), d, 0.04, duvX, (matTop + 0.035 + frameTop + 0.03) / 2, 0);
  // Folded-back top edge.
  b.rbox('linen|#f4f2ee', 0.16, 0.05, d - 0.01, 0.025, duvX - duvL / 2 + 0.06, matTop + 0.04, 0);
  // Pillows.
  const n = d >= 1.25 ? 2 : 1;
  const pw = (d - 0.12) / n;
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + 0.06 + pw * (i + 0.5);
    b.rbox('linen|#fbfaf7', 0.42, 0.13, pw - 0.05, 0.06, -w / 2 + hbT + 0.27, matTop + 0.05, z, { rz: 0.18 });
  }
  if (c.details) {
    // Throw blanket across the foot, hanging down both sides.
    const tx = w / 2 - 0.3;
    const acc = `fabric|${shade(c.color, 0.62)}`;
    b.box(acc, 0.42, 0.02, d - 0.005, tx, matTop + 0.045, 0);
    for (const s of [-1, 1]) b.box(acc, 0.42, 0.22, 0.012, tx, matTop + 0.045 - 0.11, s * (d / 2 - 0.006));
  }
}

export function nightstand(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const wood = `wood|${c.color}`;
  const cl = c.spec.clearance;
  squareLegs(c, wood, cl + 0.005);
  b.box(wood, w, h - cl, d - 0.012, 0, (cl + h) / 2, -0.006);
  const dh = (h - cl - 0.04) / 2;
  for (let i = 0; i < 2; i++) {
    const y = cl + 0.02 + dh * (i + 0.5);
    b.box(wood, w - 0.03, dh - 0.012, 0.012, 0, y, d / 2 - 0.006);
    b.sphere('brass', 0.013, 0, y, d / 2 - 0.002, { seg: 10 });
  }
  if (c.details) {
    // Table lamp with a softly glowing shade.
    const lx = -w * 0.18;
    const lz = -d * 0.12;
    b.cyl('brass', 0.05, 0.06, 0.015, lx, h + 0.0075, lz);
    b.cyl('brass', 0.008, 0.008, 0.26, lx, h + 0.14, lz, { seg: 8 });
    b.cyl('shade', 0.075, 0.1, 0.16, lx, h + 0.31, lz, { open: true, seg: 24 });
    b.sphere('bulb', 0.025, lx, h + 0.27, lz, { seg: 10 });
  }
}

export function wardrobe(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const body = `paint|${c.color}`;
  b.box(body, w - 0.02, 0.08, d - 0.05, 0, 0.04, -0.025);
  b.box(body, w, h - 0.08, d - 0.022, 0, (0.08 + h) / 2, -0.011);
  const n = w > 1.3 ? 3 : 2;
  const dw = w / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    b.box(body, dw - 0.006, h - 0.12, 0.02, x, (0.1 + h - 0.02) / 2, d / 2 - 0.012);
    const hx = x + (i % 2 === 0 ? dw / 2 - 0.05 : -dw / 2 + 0.05);
    b.box('metal|#8c8f93', 0.012, 0.32, 0.02, hx, 1.05, d / 2 - 0.006);
  }
  b.box(body, w, 0.025, d, 0, h - 0.0125, 0);
}

export function dresser(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const wood = `wood|${c.color}`;
  const cl = c.spec.clearance;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(wood, 0.05, cl, 0.05, sx * (w / 2 - 0.04), cl / 2, sz * (d / 2 - 0.04));
  b.box(wood, w, h - cl, d - 0.012, 0, (cl + h) / 2, -0.006);
  const rows = 3;
  const cols = w > 0.9 ? 2 : 1;
  const rh = (h - cl - 0.05) / rows;
  const cw = (w - 0.03) / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = -w / 2 + 0.015 + cw * (k + 0.5);
      const y = cl + 0.02 + rh * (r + 0.5);
      b.box(wood, cw - 0.01, rh - 0.012, 0.012, x, y, d / 2 - 0.006);
      b.box('brass', Math.min(0.14, cw * 0.3), 0.012, 0.012, x, y + rh * 0.2, d / 2 - 0.001);
    }
  }
  b.box(wood, w + 0.0, 0.02, d, 0, h - 0.01, 0);
}

const BOOK_COLORS = ['#7a2e2e', '#2f4858', '#33658a', '#86bbd8', '#f6ae2d', '#f26419', '#55828b', '#3b6064', '#c9c5ba', '#2d2a32', '#8c5e58', '#5b8e7d', '#bc4b51', '#e8d7c1'];

/** Bookshelf with books as one InstancedMesh. */
export function bookshelf(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const wood = `wood|${c.color}`;
  const side = 0.022;
  const plinth = 0.07;
  b.box(wood, side, h, d, -w / 2 + side / 2, h / 2, 0);
  b.box(wood, side, h, d, w / 2 - side / 2, h / 2, 0);
  b.box(wood, w - 2 * side, side, d, 0, h - side / 2, 0);
  b.box(wood, w - 2 * side, plinth, d - 0.02, 0, plinth / 2, -0.01);
  b.box(wood, w - 2 * side, h - plinth - side, 0.008, 0, (plinth + h - side) / 2, -d / 2 + 0.004);
  const shelves = Math.max(2, Math.floor((h - plinth - side) / 0.34));
  const gap = (h - plinth - side) / shelves;
  const shelfT = 0.02;
  const r = seeded(w, d, h, 7);
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const q = new THREE.Quaternion();
  const innerW = w - 2 * side;
  for (let s = 0; s < shelves; s++) {
    const y0 = plinth + s * gap + (s === 0 ? 0 : shelfT / 2);
    if (s > 0) b.box(wood, innerW, shelfT, d - 0.01, 0, plinth + s * gap, -0.005);
    const maxH = Math.min(0.3, gap - shelfT - 0.03);
    if (!c.details || maxH < 0.1) continue;
    let x = -innerW / 2 + 0.01;
    const end = innerW / 2 - 0.01;
    while (x < end - 0.03) {
      if (r() < 0.12) {
        x += 0.04 + r() * 0.12; // gap
        continue;
      }
      if (r() < 0.07 && end - x > 0.25) {
        // A small stack of books lying flat.
        const sw = 0.18 + r() * 0.05;
        let yy = y0;
        const cnt = 2 + Math.floor(r() * 3);
        for (let k = 0; k < cnt; k++) {
          const th = 0.025 + r() * 0.02;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.2);
          matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x + sw / 2, yy + th / 2, 0.01), q.clone(), new THREE.Vector3(sw, th, Math.min(d - 0.06, 0.2 + r() * 0.04))));
          colors.push(new THREE.Color(BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]));
          yy += th;
        }
        x += sw + 0.02;
        continue;
      }
      const bw = 0.018 + r() * 0.035;
      const bh = maxH * (0.62 + r() * 0.38);
      const bd = Math.min(d - 0.05, 0.16 + r() * 0.08);
      matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x + bw / 2, y0 + bh / 2, -d / 2 + 0.012 + bd / 2), new THREE.Quaternion(), new THREE.Vector3(bw, bh, bd)));
      colors.push(new THREE.Color(BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]).multiplyScalar(0.8 + r() * 0.3));
      x += bw + 0.002;
    }
  }
  if (matrices.length) b.instances('book', new THREE.BoxGeometry(1, 1, 1), matrices, colors);
}
