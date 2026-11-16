import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  CanvasTexture,
  Color,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
} from 'three';
import type { FactoryLayout } from '../../logistics/layout';
import { Parts, lazy, type V3 } from '../models/geometries';
import { PALETTE, glassMat, lampMats, paintMat, screenMat } from '../models/materials';
import { FONT, canvasTexture, hazardTexture } from '../models/textures';
import { GROUND, paintFloor } from './floorTexture';

/**
 * Factory building and floor. Walls: full height (6.5 m) on the north and west sides, low
 * (1.2 m) on the south and east sides so an orbit camera from the south/east sees inside.
 * Everything static is merged; repeated parts (columns, trusses, lamps, bollards, rails) are
 * instanced. ~22 draw calls including shadows.
 */

const WALL_H = 6.5;
const LOW_H = 1.2;
const WALL_T = 0.3;
const DOOR_W = 3.6;
const DOOR_H = 4.2;
const TRUSS_Y = 7.0;
const COL_H = 7.25;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const LAYERS: [number, number, string][] = [
  [0, 1.0, '#a3a8ab'],
  [1.0, 4.3, '#dde2e6'],
  [4.3, 5.3, '#4f6a80'],
  [5.3, 6.35, '#dde2e6'],
  [6.35, 6.5, '#59626b'],
];

/** Wall run between a and b along `axis` at fixed coordinate c, spanning y0..y1 with layered colours. */
function wallRun(p: Parts, axis: 'x' | 'z', a: number, b: number, c: number, y0: number, y1: number) {
  if (b - a < 0.01) return;
  for (const [l0, l1, col] of LAYERS) {
    const lo = Math.max(l0, y0);
    const hi = Math.min(l1, y1);
    if (hi - lo < 0.005) continue;
    const t = col === '#4f6a80' ? WALL_T + 0.02 : WALL_T;
    if (axis === 'x') p.box(b - a, hi - lo, t, col, [(a + b) / 2, (lo + hi) / 2, c], undefined, 0);
    else p.box(t, hi - lo, b - a, col, [c, (lo + hi) / 2, (a + b) / 2], undefined, 0);
  }
}

/** Splits [a, b] around gaps (centre +- half). */
function runsAround(a: number, b: number, gaps: number[], half: number): [number, number][] {
  const out: [number, number][] = [];
  let cur = a;
  for (const g of [...gaps].sort((x, y) => x - y)) {
    if (g - half > cur) out.push([cur, g - half]);
    cur = Math.max(cur, g + half);
  }
  if (b > cur) out.push([cur, b]);
  return out;
}

interface SignSpec {
  text: string;
  bg: string;
  fg: string;
  pos: V3;
  /** Rotation about y (0 = faces +z). */
  rotY: number;
  width: number;
  double: boolean;
  hanging: boolean;
}

const SIGN_ASPECT = 8;

function buildSigns(signs: SignSpec[]): { geo: BufferGeometry; tex: CanvasTexture; frames: Parts } {
  const rowW = 1024;
  const rowH = rowW / SIGN_ASPECT;
  const n = signs.length;
  const tex = canvasTexture(rowW, rowH * n, (ctx) => {
    signs.forEach((s, i) => {
      const y = i * rowH;
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, y, rowW, rowH);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 6;
      ctx.strokeRect(8, y + 8, rowW - 16, rowH - 16);
      ctx.fillStyle = s.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = Math.round(rowH * 0.58);
      ctx.font = `bold ${size}px ${FONT}`;
      while (ctx.measureText(s.text).width > rowW * 0.88 && size > 10) {
        size -= 2;
        ctx.font = `bold ${size}px ${FONT}`;
      }
      ctx.fillText(s.text, rowW / 2, y + rowH / 2 + size * 0.04);
    });
  });
  const p = new Parts();
  const frames = new Parts();
  signs.forEach((s, i) => {
    const w = s.width;
    const h = w / SIGN_ASPECT;
    const faces = s.double ? [0, Math.PI] : [0];
    for (const f of faces) {
      const g = new PlaneGeometry(w, h);
      const uv = g.attributes.uv as BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1) / n + uv.getY(k) / n);
      const off = 0.03;
      const dx = Math.sin(s.rotY + f) * off;
      const dz = Math.cos(s.rotY + f) * off;
      p.add(g, '#fff', [s.pos[0] + dx, s.pos[1], s.pos[2] + dz], [0, s.rotY + f, 0]);
    }
    frames.box(w + 0.08, h + 0.08, 0.05, '#2b2f34', s.pos, [0, s.rotY, 0], 0.01);
    if (s.hanging) {
      const ax = Math.cos(s.rotY) * (w / 2 - 0.2);
      const az = -Math.sin(s.rotY) * (w / 2 - 0.2);
      for (const k of [-1, 1]) frames.box(0.015, TRUSS_Y - s.pos[1] - h / 2, 0.015, '#3d4349', [s.pos[0] + k * ax, (TRUSS_Y + s.pos[1] + h / 2) / 2, s.pos[2] + k * az], undefined, 0);
    }
  });
  return { geo: p.build(), tex, frames };
}

const videoWallTexture = lazy(() =>
  canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#071423';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0d2238';
    for (let i = 0; i < 4; i++) ctx.fillRect(8 + i * 254, 8, 246, h - 16);
    ctx.fillStyle = '#7fb8ff';
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText('LINE OVERVIEW', 20, 30);
    ctx.fillText('THROUGHPUT', 274, 30);
    ctx.fillText('UTILISATION', 528, 30);
    ctx.fillText('ALERTS', 782, 30);
    const st = ['#25e05a', '#25e05a', '#ffae00', '#25e05a', '#ff3b30', '#25e05a', '#25e05a'];
    st.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(20 + (i % 4) * 56, 60 + Math.floor(i / 4) * 80, 44, 56);
    });
    ctx.strokeStyle = '#38d0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const x = 274 + i * 5.5;
      const y = 200 - 60 - Math.sin(i * 0.4) * 30 - i * 1.2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    [0.88, 0.55, 0.65, 0.4, 0.7].forEach((v, i) => {
      ctx.fillStyle = v > 0.8 ? '#ffae00' : '#2f8fff';
      ctx.fillRect(540 + i * 42, 220 - v * 170, 30, v * 170);
    });
    ['C2 BELT STOP', 'LOW STOCK: BATTERY', 'CELL 2 REPAIR'].forEach((t, i) => {
      ctx.fillStyle = i === 0 ? '#ff3b30' : '#ffae00';
      ctx.fillRect(790, 52 + i * 46, 10, 30);
      ctx.fillStyle = '#d8e6f5';
      ctx.font = `16px ${FONT}`;
      ctx.fillText(t, 810, 73 + i * 46);
    });
  }),
);

// ---------------------------------------------------------------------------------------------
// static building geometry
// ---------------------------------------------------------------------------------------------

function buildBuilding(layout: FactoryLayout) {
  const b = layout.bounds;
  const p = new Parts();
  const hz = new Parts();
  const glass = new Parts();
  const screens = new Parts();
  const signs: SignSpec[] = [];

  // --- north wall (full) ---------------------------------------------------------------------
  wallRun(p, 'x', b.x0 - WALL_T, b.x1, b.z0 - WALL_T / 2, 0, WALL_H);
  for (let x = b.x0 + 1.2; x < b.x1; x += 1.2) p.box(0.04, WALL_H - 1.15, 0.02, '#c3c9cf', [x, 1.0 + (WALL_H - 1.15) / 2, b.z0 + 0.01], undefined, 0);

  // --- west wall (full) with receiving dock openings ---------------------------------------
  const recvZ = layout.receivingBays.map((r) => r.door[1]);
  for (const [a, c] of runsAround(b.z0, b.z1, recvZ, DOOR_W / 2)) wallRun(p, 'z', a, c, b.x0 - WALL_T / 2, 0, WALL_H);
  for (const z of recvZ) wallRun(p, 'z', z - DOOR_W / 2, z + DOOR_W / 2, b.x0 - WALL_T / 2, DOOR_H, WALL_H);
  for (let z = b.z0 + 1.2; z < b.z1; z += 1.2) {
    if (recvZ.some((d) => Math.abs(d - z) < DOOR_W / 2 + 0.1)) continue;
    p.box(0.02, WALL_H - 1.15, 0.04, '#c3c9cf', [b.x0 + 0.01, 1.0 + (WALL_H - 1.15) / 2, z], undefined, 0);
  }

  // --- south wall (low) with entrance ---------------------------------------------------------
  const ent = layout.entrance.pos;
  for (const [a, c] of runsAround(b.x0 - WALL_T, b.x1 + WALL_T, [ent[0]], 1.6)) {
    p.box(c - a, LOW_H, WALL_T, '#a3a8ab', [(a + c) / 2, LOW_H / 2, b.z1 + WALL_T / 2], undefined, 0);
    p.box(c - a, 0.08, WALL_T + 0.06, '#59626b', [(a + c) / 2, LOW_H + 0.04, b.z1 + WALL_T / 2], undefined, 0);
  }

  // --- east wall (low) with shipping dock openings ------------------------------------------------
  const shipZ = layout.shippingBays.map((s) => s.door[1]);
  for (const [a, c] of runsAround(b.z0 - WALL_T, b.z1 + WALL_T, shipZ, DOOR_W / 2)) {
    p.box(WALL_T, LOW_H, c - a, '#a3a8ab', [b.x1 + WALL_T / 2, LOW_H / 2, (a + c) / 2], undefined, 0);
    p.box(WALL_T + 0.06, 0.08, c - a, '#59626b', [b.x1 + WALL_T / 2, LOW_H + 0.04, (a + c) / 2], undefined, 0);
  }
  // full-height cut ends of the north and west walls
  p.box(0.5, WALL_H + 0.1, 0.5, '#59626b', [b.x1 + 0.1, (WALL_H + 0.1) / 2, b.z0 - 0.15], undefined, 0.02);
  p.box(0.5, WALL_H + 0.1, 0.5, '#59626b', [b.x0 - 0.15, (WALL_H + 0.1) / 2, b.z1 + 0.1], undefined, 0.02);

  // --- dock doors --------------------------------------------------------------------------------
  const dock = (x: number, z: number, out: 1 | -1, label: string, portal: boolean) => {
    // hazard jambs on the inside face
    for (const s of [-1, 1]) {
      const jz = z + s * (DOOR_W / 2 + 0.14);
      if (portal) hz.box(0.3, DOOR_H + 0.4, 0.28, '#fff', [x, (DOOR_H + 0.4) / 2, jz], undefined, 0.02);
      else hz.box(0.12, DOOR_H, 0.28, '#fff', [x - out * (WALL_T / 2 + 0.06), DOOR_H / 2, jz], undefined, 0.01);
      // dock seal pads outside
      p.box(0.35, DOOR_H + 0.3, 0.3, '#1d1f22', [x + out * (WALL_T / 2 + 0.18), (DOOR_H + 0.3) / 2, z + s * (DOOR_W / 2 + 0.05)], undefined, 0.06);
      // bumpers
      p.box(0.18, 0.3, 0.3, '#151618', [x + out * (WALL_T / 2 + 0.1), 0.95, z + s * 1.2], undefined, 0.03);
    }
    p.box(0.35, 0.4, DOOR_W + 0.6, '#1d1f22', [x + out * (WALL_T / 2 + 0.18), DOOR_H + 0.25, z], undefined, 0.06);
    if (portal) p.box(0.4, 0.5, DOOR_W + 0.9, '#59626b', [x, DOOR_H + 0.65, z], undefined, 0.02);
    // rolled-up door + coil box
    p.box(0.4, 0.42, DOOR_W + 0.2, '#8d949b', [x - out * 0.35, DOOR_H + 0.2, z], undefined, 0.04);
    p.box(0.05, 0.35, DOOR_W, '#c9ced3', [x - out * 0.1, DOOR_H - 0.18, z], undefined, 0);
    // dock leveller plate inside
    p.box(2.2, 0.04, 2.3, '#7d868f', [x - out * 1.15, 0.02, z], undefined, 0.005);
    p.box(0.1, 0.045, 2.3, PALETTE.safetyYellow, [x - out * 0.08, 0.025, z], undefined, 0.005);
    // dock light arm
    p.box(0.08, 0.08, 1.0, '#3d4349', [x - out * 0.3, 3.2, z + DOOR_W / 2 + 0.6], undefined, 0.01);
    signs.push({
      text: label,
      bg: '#1f2937',
      fg: '#ffd400',
      pos: [x - out * (portal ? 0.3 : WALL_T / 2 + 0.05), DOOR_H + (portal ? 1.2 : 0.95), z],
      rotY: out === 1 ? -Math.PI / 2 : Math.PI / 2,
      width: 2.4,
      double: portal,
      hanging: false,
    });
  };
  layout.receivingBays.forEach((r, i) => dock(b.x0, r.door[1], -1, `RECEIVING DOCK R${i + 1}`, false));
  layout.shippingBays.forEach((s, i) => dock(b.x1, s.door[1], 1, `SHIPPING DOCK S${i + 1}`, true));

  // --- entrance -------------------------------------------------------------------------------------
  {
    const [ex] = ent;
    const ez = b.z1;
    for (const s of [-1, 1]) {
      p.box(0.16, 2.7, 0.3, '#3d4349', [ex + s * 1.6, 1.35, ez + 0.15], undefined, 0.02);
      glass.box(1.3, 2.5, 0.03, '#fff', [ex + s * 2.3, 1.25, ez + 0.4], undefined, 0);
      p.box(0.14, 3.2, 0.14, '#3d4349', [ex + s * 2.1, 1.6, ez + 3.2], undefined, 0.02);
    }
    p.box(3.36, 0.2, 0.3, '#3d4349', [ex, 2.8, ez + 0.15], undefined, 0.02);
    p.box(4.8, 0.22, 3.6, '#59626b', [ex, 3.25, ez + 1.7], undefined, 0.03);
    p.box(4.84, 0.08, 3.64, PALETTE.machineBlue, [ex, 3.4, ez + 1.7], undefined, 0.01);
    signs.push({ text: 'MAIN ENTRANCE', bg: PALETTE.machineBlue, fg: '#ffffff', pos: [ex, 3.0, ez + 3.55], rotY: 0, width: 3.6, double: false, hanging: false });
    // PPE board inside on a stand
    p.box(0.06, 1.7, 0.06, '#3d4349', [ex + 2.6, 0.85, ez - 2.2], undefined, 0.01);
    signs.push({ text: 'SAFETY FIRST · PPE REQUIRED', bg: '#1b7f3a', fg: '#ffffff', pos: [ex + 2.6, 1.85, ez - 2.2], rotY: 0, width: 2.4, double: true, hanging: false });
  }

  // --- control room (elevated glass box) ------------------------------------------------------
  {
    const [cx, cz] = layout.controlRoom.center;
    const [sx, sz] = layout.controlRoom.size;
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = Math.max(cz - sz / 2, b.z0);
    const z1 = cz + sz / 2;
    const FL = 3.0;
    const top = 5.6;
    const SG = '#4b5563';
    for (const x of [x0 + 0.15, cx, x1 - 0.15]) p.box(0.26, FL - 0.3, 0.26, SG, [x, (FL - 0.3) / 2, z1 - 0.15], undefined, 0.02);
    for (const x of [x0 + 0.15, x1 - 0.15]) p.box(0.26, FL - 0.3, 0.26, SG, [x, (FL - 0.3) / 2, z0 + 0.2], undefined, 0.02);
    p.box(sx, 0.3, sz, '#7b848d', [cx, FL - 0.15, cz], undefined, 0.02);
    p.box(sx + 0.04, 0.34, 0.05, PALETTE.machineBlue, [cx, FL - 0.15, z1 + 0.01], undefined, 0);
    // glass walls + mullions + rails
    glass.box(sx - 0.1, top - FL, 0.03, '#fff', [cx, (FL + top) / 2, z1 - 0.05], undefined, 0);
    glass.box(0.03, top - FL, sz - 0.1, '#fff', [x0 + 0.05, (FL + top) / 2, cz], undefined, 0);
    glass.box(0.03, top - FL, sz - 0.1, '#fff', [x1 - 0.05, (FL + top) / 2, cz], undefined, 0);
    for (let x = x0 + 0.05; x <= x1 - 0.04; x += sx / 8) p.box(0.07, top - FL, 0.08, '#2b2f34', [x, (FL + top) / 2, z1 - 0.05], undefined, 0.01);
    for (const x of [x0 + 0.05, x1 - 0.05]) for (let z = z0; z <= z1; z += sz / 3) p.box(0.08, top - FL, 0.07, '#2b2f34', [x, (FL + top) / 2, Math.min(z, z1 - 0.05)], undefined, 0.01);
    p.box(sx, 0.1, 0.1, '#2b2f34', [cx, FL + 0.05, z1 - 0.05], undefined, 0.01);
    p.box(sx, 1.0, 0.04, '#c9ced3', [cx, FL + 0.5, z1 - 0.12], undefined, 0);
    p.box(sx + 0.2, 0.24, sz + 0.2, '#5d656d', [cx, top + 0.12, cz], undefined, 0.03);
    p.box(sx + 0.24, 0.12, 0.06, PALETTE.machineBlue, [cx, top + 0.2, z1 + 0.1], undefined, 0.01);
    // consoles facing the front window, monitors face the operators (-z)
    for (const dx of [-3.6, 0, 3.6]) {
      p.box(3.2, 0.72, 0.8, '#30353b', [cx + dx, FL + 0.36, z1 - 0.95], undefined, 0.04);
      p.box(3.3, 0.04, 0.9, '#aab2ba', [cx + dx, FL + 0.74, z1 - 0.95], undefined, 0.01);
      for (const m of [-1, 0, 1]) {
        p.box(0.66, 0.42, 0.05, '#1a1c1f', [cx + dx + m * 0.95, FL + 1.1, z1 - 0.7], [0.12, 0, 0], 0.01);
        screens.box(0.6, 0.36, 0.01, '#fff', [cx + dx + m * 0.95, FL + 1.1, z1 - 0.735], [0.12, 0, 0], 0);
      }
      p.box(0.5, 0.5, 0.5, '#202326', [cx + dx, FL + 0.45, z1 - 1.9], undefined, 0.08);
    }
    // video wall frame on the back (north) wall
    p.box(8.3, 2.2, 0.08, '#15171a', [cx, FL + 1.45, z0 + 0.08], undefined, 0.02);
    // landing + stairs on the east side
    const sxw = x1 + 0.05;
    p.box(1.25, 0.1, 1.7, '#7d868f', [sxw + 0.62, FL - 0.05, z0 + 0.95], undefined, 0.01);
    p.box(0.14, FL, 0.14, SG, [sxw + 1.2, FL / 2, z0 + 0.2], undefined, 0.01);
    const steps = 16;
    const run = 0.25;
    const sTop = z0 + 1.8;
    for (let i = 0; i < steps; i++) {
      const y = FL - (i + 1) * (FL / steps);
      p.box(1.1, 0.04, run + 0.03, '#8d949b', [sxw + 0.62, y, sTop + (i + 0.5) * run], undefined, 0.005);
    }
    const sBot = sTop + steps * run;
    for (const xx of [sxw + 0.04, sxw + 1.2]) {
      p.bar([xx, FL, sTop], [xx, 0, sBot], 0.06, '#3d4349');
      p.bar([xx, FL + 0.95, sTop], [xx, 0.95, sBot], 0.04, PALETTE.safetyYellow);
      p.bar([xx, FL, sTop], [xx, FL + 0.95, sTop], 0.04, PALETTE.safetyYellow);
      p.bar([xx, 0, sBot], [xx, 0.95, sBot], 0.04, PALETTE.safetyYellow);
    }
    p.bar([sxw + 1.2, FL + 0.95, z0 + 0.1], [sxw + 1.2, FL + 0.95, sTop], 0.04, PALETTE.safetyYellow);
    signs.push({ text: 'CONTROL ROOM', bg: '#334155', fg: '#ffffff', pos: [cx, FL - 0.62, z1 + 0.05], rotY: 0, width: 3.6, double: false, hanging: false });
    // under-slab: technician workbench + cabinets
    p.box(2.4, 0.9, 0.7, '#59626b', [cx - 3, 0.45, z0 + 0.6], undefined, 0.02);
    p.box(2.5, 0.05, 0.8, '#9aa3ab', [cx - 3, 0.92, z0 + 0.6], undefined, 0.01);
    p.box(1.0, 1.9, 0.6, '#c62828', [cx + 3, 0.95, z0 + 0.5], undefined, 0.02);
    p.box(1.2, 1.9, 0.6, '#5d656d', [cx + 4.3, 0.95, z0 + 0.5], undefined, 0.02);
  }

  // --- break room ----------------------------------------------------------------------------------
  {
    const [cx, cz] = layout.breakRoom.center;
    const [sx, sz] = layout.breakRoom.size;
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = Math.max(cz - sz / 2, b.z0);
    const z1 = cz + sz / 2;
    const PH = 1.2;
    const part = (a: V3, c: V3) => {
      p.boxSpan([a[0], 0, a[2]], [c[0], PH, c[2]], '#c9ced3', 0.01);
      p.boxSpan([a[0] - 0.01, PH, a[2] - 0.01], [c[0] + 0.01, PH + 0.05, c[2] + 0.01], PALETTE.machineBlue, 0.005);
    };
    part([x0, 0, z1 - 0.08], [cx - 1.0, 0, z1]);
    part([cx + 1.0, 0, z1 - 0.08], [x1, 0, z1]);
    part([x0, 0, z0], [x0 + 0.08, 0, z1]);
    part([x1 - 0.08, 0, z0], [x1, 0, z1]);
    for (const tx of [cx - 1.9, cx + 1.6]) {
      const tz = cz - 0.2;
      p.box(1.8, 0.05, 0.85, '#f1f3f4', [tx, 0.75, tz], undefined, 0.01);
      for (const sxx of [-1, 1]) for (const szz of [-1, 1]) p.box(0.05, 0.73, 0.05, '#5d656d', [tx + sxx * 0.8, 0.365, tz + szz * 0.35], undefined, 0.005);
      for (const s of [-1, 1]) {
        p.box(1.8, 0.06, 0.32, '#b07a45', [tx, 0.45, tz + s * 0.72], undefined, 0.01);
        p.box(0.05, 0.42, 0.25, '#5d656d', [tx, 0.21, tz + s * 0.72], undefined, 0.005);
      }
    }
    p.box(0.9, 1.85, 0.75, '#c62828', [x0 + 0.8, 0.925, z0 + 0.5], undefined, 0.03);
    p.box(0.6, 1.1, 0.02, '#9fd3ff', [x0 + 0.7, 1.15, z0 + 0.88], undefined, 0);
    p.box(0.9, 1.85, 0.75, '#1f3b73', [x0 + 1.8, 0.925, z0 + 0.5], undefined, 0.03);
    p.box(0.6, 1.1, 0.02, '#ffe7a3', [x0 + 1.7, 1.15, z0 + 0.88], undefined, 0);
    for (let i = 0; i < 6; i++) p.box(0.42, 1.85, 0.5, i % 2 ? '#7d868f' : '#8d969f', [x1 - 0.4, 0.925, z0 + 0.5 + i * 0.44], [0, Math.PI / 2, 0], 0.01);
    p.cyl(0.22, 0.17, 0.4, '#7a4a2a', [x1 - 0.5, 0.2, z1 - 0.5], undefined, 14);
    p.sphere(0.4, '#2f7d32', [x1 - 0.5, 0.75, z1 - 0.5], [1, 1.2, 1]);
    signs.push({ text: 'BREAK ROOM', bg: '#334155', fg: '#ffffff', pos: [x0 + 1.6, 0.75, z1 + 0.03], rotY: 0, width: 2.4, double: false, hanging: false });
  }

  // --- hanging zone signs ------------------------------------------------------------------------
  for (const zn of layout.zones) {
    if (zn.id === 'control' || zn.id === 'break') continue;
    const cx = (zn.rect.x0 + zn.rect.x1) / 2;
    signs.push({ text: zn.label, bg: zn.color, fg: '#ffffff', pos: [cx, 5.5, zn.rect.z0 + 0.6], rotY: 0, width: 4.0, double: true, hanging: true });
  }

  const s = buildSigns(signs);
  p.merge(s.frames);

  // world-space diagonal hazard UVs
  const hazard = hz.build();
  const pos = hazard.attributes.position as BufferAttribute;
  const uv = hazard.attributes.uv as BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + pos.getY(i) + pos.getZ(i)) / 0.5, 0.5);

  return {
    paint: p.build(),
    hazard,
    glass: glass.build(),
    screens: screens.build(),
    signs: s.geo,
    signTex: s.tex,
  };
}

// ---------------------------------------------------------------------------------------------
// instanced structure
// ---------------------------------------------------------------------------------------------

const columnGeo = lazy(() => {
  const st = '#5f7183';
  const p = new Parts()
    .box(0.3, COL_H, 0.025, st, [0, COL_H / 2, 0.14], undefined, 0)
    .box(0.3, COL_H, 0.025, st, [0, COL_H / 2, -0.14], undefined, 0)
    .box(0.02, COL_H, 0.26, st, [0, COL_H / 2, 0], undefined, 0)
    .box(0.5, 0.03, 0.5, '#4b5563', [0, 0.015, 0], undefined, 0)
    .box(0.4, 1.2, 0.4, PALETTE.safetyYellow, [0, 0.6, 0], undefined, 0.04);
  for (const y of [0.25, 0.65, 1.05]) p.box(0.41, 0.14, 0.41, '#1a1a1a', [0, y, 0], undefined, 0.04);
  return p.build();
});
const beamGeo = lazy(() =>
  new Parts()
    .box(1, 0.03, 0.2, '#6b7c8f', [0, 0.21, 0], undefined, 0)
    .box(1, 0.03, 0.2, '#6b7c8f', [0, -0.21, 0], undefined, 0)
    .box(1, 0.42, 0.015, '#6b7c8f', [0, 0, 0], undefined, 0)
    .build(),
);
const lampHousingGeo = lazy(() =>
  new Parts()
    .cyl(0.08, 0.36, 0.3, '#3d4349', [0, 0.15, 0], undefined, 16)
    .cyl(0.012, 0.012, 0.45, '#2b2f34', [0, 0.52, 0], undefined, 6)
    .build(),
);
const lampLensGeo = lazy(() => new Parts().cyl(0.33, 0.33, 0.02, '#fff', [0, -0.005, 0], undefined, 16).build());
const bollardGeo = lazy(() =>
  new Parts()
    .cyl(0.1, 0.1, 1.05, PALETTE.safetyYellow, [0, 0.525, 0], undefined, 14)
    .sphere(0.1, PALETTE.safetyYellow, [0, 1.05, 0], [1, 0.4, 1], 14)
    .cyl(0.102, 0.102, 0.08, '#151515', [0, 0.75, 0], undefined, 14)
    .cyl(0.102, 0.102, 0.08, '#151515', [0, 0.95, 0], undefined, 14)
    .cyl(0.16, 0.16, 0.02, '#4b5563', [0, 0.01, 0], undefined, 14)
    .build(),
);
/** 2 m guard-rail section along x, origin at its start. */
const RAIL_LEN = 2;
const railGeo = lazy(() => {
  const p = new Parts();
  for (const x of [0.06, RAIL_LEN - 0.06]) {
    p.box(0.08, 1.0, 0.08, PALETTE.safetyYellow, [x, 0.5, 0], undefined, 0.01);
    p.box(0.18, 0.02, 0.18, '#4b5563', [x, 0.01, 0], undefined, 0);
  }
  p.box(RAIL_LEN, 0.12, 0.05, PALETTE.safetyYellow, [RAIL_LEN / 2, 0.95, 0], undefined, 0.02);
  p.box(RAIL_LEN, 0.12, 0.05, PALETTE.safetyYellow, [RAIL_LEN / 2, 0.45, 0], undefined, 0.02);
  p.box(RAIL_LEN, 0.08, 0.051, '#151515', [RAIL_LEN / 2, 0.95, 0], undefined, 0);
  return p.build();
});

const _q = new Quaternion();
const _e = new Euler();
const _v = new Vector3();
const _s = new Vector3();

function mat(x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  _e.set(0, rotY, 0);
  _q.setFromEuler(_e);
  return new Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

function layoutInstances(layout: FactoryLayout) {
  const b = layout.bounds;
  const columns: Matrix4[] = [];
  const beams: Matrix4[] = [];
  const lamps: Matrix4[] = [];
  const bollards: Matrix4[] = [];
  const rails: Matrix4[] = [];

  const colX = [-42, -26, -10, 6, 22, 38];
  const rowZ = [-18.5, 18.5];
  for (const x of colX) for (const z of rowZ) columns.push(mat(x, 0, z));
  for (let x = b.x0 + 5; x < b.x1; x += 10) columns.push(mat(x, 0, b.z0 + 0.2));
  const recvZ = layout.receivingBays.map((r) => r.door[1]);
  for (let z = b.z0 + 5; z < b.z1; z += 10) if (!recvZ.some((d) => Math.abs(d - z) < DOOR_W / 2 + 0.5)) columns.push(mat(b.x0 + 0.2, 0, z));

  // roof steel: girders along x over the north wall and the north column row; high-bay lamps
  // hang from them (the south half is left open so an orbit camera sees in)
  for (const z of [b.z0 + 0.2, rowZ[0]]) beams.push(mat(0, TRUSS_Y, z, 0, b.x1 - b.x0));
  for (const x of colX) beams.push(mat(x, TRUSS_Y, (b.z0 + rowZ[0]) / 2, Math.PI / 2, rowZ[0] - b.z0));
  for (let x = b.x0 + 6; x < b.x1 - 2; x += 8) lamps.push(mat(x, TRUSS_Y - 0.9, rowZ[0]));
  for (const x of colX) for (const z of [-24.5]) lamps.push(mat(x, TRUSS_Y - 0.9, z));

  // bollards: dock doors, rack ends, palletizer corners, office fronts, entrance
  for (const r of layout.receivingBays) for (const s of [-1, 1]) bollards.push(mat(b.x0 + 0.6, 0, r.door[1] + s * (DOOR_W / 2 + 0.35)));
  for (const r of layout.shippingBays) for (const s of [-1, 1]) bollards.push(mat(b.x1 - 0.6, 0, r.door[1] + s * (DOOR_W / 2 + 0.35)));
  for (const rk of [...layout.rawRacks, ...layout.fgRacks])
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bollards.push(mat(rk.center[0] + sx * (rk.length / 2 + 0.35), 0, rk.center[1] + sz * (rk.depth / 2 - 0.1)));
  {
    const [px, pz] = layout.palletizer.center;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bollards.push(mat(px - 0.7 + sx * 2.3, 0, pz + sz * 3.3));
  }
  for (const s of [-1, 1]) bollards.push(mat(layout.entrance.pos[0] + s * 1.9, 0, b.z1 - 0.6));
  for (const [x, z] of [
    [layout.controlRoom.center[0] - layout.controlRoom.size[0] / 2 - 0.4, layout.controlRoom.center[1] + layout.controlRoom.size[1] / 2 + 0.4],
    [layout.controlRoom.center[0] + layout.controlRoom.size[0] / 2 + 1.6, layout.controlRoom.center[1] + layout.controlRoom.size[1] / 2 + 0.4],
  ])
    bollards.push(mat(x, 0, z));

  // guard rails: assembly cell boundary (gaps at AGV drop points), office walkway
  const railRun = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const n = Math.max(1, Math.round(len / RAIL_LEN));
    const sl = len / n / RAIL_LEN;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      rails.push(mat(ax + (bx - ax) * t, 0, az + (bz - az) * t, rot, sl));
    }
  };
  const asm = layout.zones.find((z) => z.id === 'assembly');
  if (asm) {
    const x = asm.rect.x0 - 0.4;
    for (const [a, c] of runsAround(asm.rect.z0, asm.rect.z1, layout.cells.map((c) => c.z), 1.8)) railRun(x, a, x, c);
  }
  {
    const cr = layout.controlRoom;
    const br = layout.breakRoom;
    const z = cr.center[1] + cr.size[1] / 2 + 1.55;
    const gaps = [br.center[0], cr.center[0] + cr.size[0] / 2 + 0.6];
    for (const [a, c] of runsAround(br.center[0] - br.size[0] / 2 - 1, cr.center[0] + cr.size[0] / 2 + 2, gaps, 1.3)) railRun(a, z, c, z);
  }
  return { columns, beams, lamps, bollards, rails };
}

function Instanced({ geometry, material, matrices, shadow = true }: { geometry: BufferGeometry; material: MeshStandardMaterial; matrices: Matrix4[]; shadow?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [matrices]);
  if (matrices.length === 0) return null;
  return <instancedMesh key={matrices.length} ref={ref} args={[geometry, material, matrices.length]} castShadow={shadow} receiveShadow />;
}

// ---------------------------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------------------------

export interface FactoryEnvironmentProps {
  layout: FactoryLayout;
}

/**
 * Floor (one painted CanvasTexture: concrete, zones, aisles, walkways, dock hatching, apron),
 * walls with dock doors and entrance, columns/trusses/high-bay lamps, bollards and guard rails,
 * hanging zone signs, control room (elevated glass box with consoles and a video wall) and
 * break room.
 */
export function FactoryEnvironment({ layout }: FactoryEnvironmentProps) {
  const floor = useMemo(() => {
    const tex = paintFloor(layout);
    const m = new MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.0 });
    const g = new PlaneGeometry(GROUND.x1 - GROUND.x0, GROUND.z1 - GROUND.z0);
    g.rotateX(-Math.PI / 2);
    g.translate((GROUND.x0 + GROUND.x1) / 2, 0, (GROUND.z0 + GROUND.z1) / 2);
    return { tex, m, g };
  }, [layout]);
  const bld = useMemo(() => buildBuilding(layout), [layout]);
  const inst = useMemo(() => layoutInstances(layout), [layout]);
  const mats = useMemo(() => {
    const hazard = new MeshStandardMaterial({ map: hazardTexture(), roughness: 0.55 });
    const signs = new MeshStandardMaterial({ map: bld.signTex, roughness: 0.5, emissive: new Color('#ffffff'), emissiveMap: bld.signTex, emissiveIntensity: 0.25 });
    const video = new MeshStandardMaterial({ color: '#000000', emissive: new Color('#ffffff'), emissiveMap: videoWallTexture(), emissiveIntensity: 1.2 });
    return { hazard, signs, video };
  }, [bld]);
  useEffect(
    () => () => {
      floor.tex.dispose();
      floor.m.dispose();
      floor.g.dispose();
    },
    [floor],
  );
  useEffect(
    () => () => {
      bld.paint.dispose();
      bld.hazard.dispose();
      bld.glass.dispose();
      bld.screens.dispose();
      bld.signs.dispose();
      bld.signTex.dispose();
      mats.hazard.dispose();
      mats.signs.dispose();
      mats.video.dispose();
    },
    [bld, mats],
  );
  const cr = layout.controlRoom;
  return (
    <group>
      <mesh geometry={floor.g} material={floor.m} receiveShadow />
      <mesh geometry={bld.paint} material={paintMat} castShadow receiveShadow />
      <mesh geometry={bld.hazard} material={mats.hazard} castShadow receiveShadow />
      <mesh geometry={bld.glass} material={glassMat} />
      <mesh geometry={bld.screens} material={screenMat} />
      <mesh geometry={bld.signs} material={mats.signs} />
      <mesh position={[cr.center[0], 4.45, Math.max(cr.center[1] - cr.size[1] / 2, layout.bounds.z0) + 0.13]} material={mats.video}>
        <planeGeometry args={[8, 2]} />
      </mesh>
      <Instanced geometry={columnGeo()} material={paintMat} matrices={inst.columns} />
      <Instanced geometry={beamGeo()} material={paintMat} matrices={inst.beams} />
      <Instanced geometry={lampHousingGeo()} material={paintMat} matrices={inst.lamps} shadow={false} />
      <Instanced geometry={lampLensGeo()} material={lampMats.white} matrices={inst.lamps} shadow={false} />
      <Instanced geometry={bollardGeo()} material={paintMat} matrices={inst.bollards} />
      <Instanced geometry={railGeo()} material={paintMat} matrices={inst.rails} />
    </group>
  );
}
