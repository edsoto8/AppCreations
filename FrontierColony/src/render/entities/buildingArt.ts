/**
 * Procedural building art (Pixi Graphics). Each building is drawn once into a Graphics (and redrawn
 * when its construction progress changes) in local iso space centred on its footprint.
 * M4 expands this (animated details, richer construction), the structure stays.
 */
import type { Graphics } from 'pixi.js';
import type { BuildingType } from '../../sim';
import { shadeHex } from '../util/color';
import { P, box, fillPoly, gable, groundQuad, leftFaceRect, rightFaceRect, tones } from './isoDraw';

const WOOD = 0x9c6f45;
const WOOD_DARK = 0x6e4b31;
const STONE = 0xb4aa9e;
const PLASTER = 0xebdcb9;
const GLASS = 0x86bad2;

function stakes(g: Graphics, u0: number, v0: number, u1: number, v1: number, height: number): void {
  for (const [u, v] of [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ] as const) {
    const a = P(u, v, 0);
    const b = P(u, v, height);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: WOOD_DARK });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: WOOD, alpha: 0.9 });
  }
}

function crate(g: Graphics, u: number, v: number, s = 0.16, h = 7): void {
  box(g, u - s, v - s, u + s, v + s, 0, h, tones(0xb98a58), 0.5);
}

function logPile(g: Graphics, u: number, v: number): void {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j <= 2 - i; j++) {
      const p = P(u + 0.05 * j, v - 0.12 + i * 0.0 + j * 0.14 - (2 - i) * 0.07, 3.2 + i * 4.2);
      g.ellipse(p.x, p.y, 4.4, 2.4).fill(0xa97b4e).stroke({ width: 1, color: 0x5d3f29, alpha: 0.8 });
      g.ellipse(p.x + 0.3, p.y, 1.8, 1).fill(0xe0b982);
    }
  }
}

function drawHouse(g: Graphics): void {
  box(g, -0.8, -0.8, 0.8, 0.8, 0, 22, tones(PLASTER));
  // timber frame accents
  leftFaceRect(g, 0.8, -0.8, 0.8, 0, 22, WOOD_DARK, 0);
  leftFaceRect(g, 0.8, -0.18, 0.26, 0, 14, WOOD_DARK);
  leftFaceRect(g, 0.8, -0.1, 0.18, 0.5, 12.5, 0x8d6240);
  leftFaceRect(g, 0.8, -0.7, -0.36, 9, 16.5, GLASS);
  leftFaceRect(g, 0.8, 0.42, 0.7, 9, 16.5, GLASS);
  rightFaceRect(g, 0.8, -0.5, -0.1, 9, 16.5, GLASS);
  rightFaceRect(g, 0.8, 0.15, 0.55, 9, 16.5, GLASS);
  box(g, -0.55, -0.55, -0.33, -0.33, 20, 40, tones(0x9a8b80), 0.5);
  gable(g, -0.8, -0.8, 0.8, 0.8, 22, 17, 'u', 0xb95b3e, PLASTER);
}

function drawTownCenter(g: Graphics): void {
  // stone plinth
  box(g, -1.35, -1.35, 1.35, 1.35, 0, 7, tones(0xa39a90));
  // main hall
  box(g, -1.05, -0.95, 1.05, 0.95, 7, 30, tones(0xe3d2ae));
  for (const [a, b] of [
    [-0.85, -0.5],
    [-0.15, 0.2],
    [0.5, 0.85],
  ] as const) {
    leftFaceRect(g, 0.95, a, b, 14, 24, GLASS);
  }
  leftFaceRect(g, 0.95, -0.2, 0.2, 7, 21, WOOD_DARK);
  rightFaceRect(g, 1.05, -0.65, -0.25, 14, 24, GLASS);
  rightFaceRect(g, 1.05, 0.25, 0.65, 14, 24, GLASS);
  gable(g, -1.05, -0.95, 1.05, 0.95, 30, 22, 'u', 0x9c4a3a, 0xe3d2ae, 0.12);
  // tower with a hip roof
  box(g, -0.62, -0.62, 0.0, 0.0, 30, 56, tones(0xd9c9a6));
  leftFaceRect(g, 0.0, -0.4, -0.15, 40, 50, 0x3b3035);
  const t = (u: number, v: number, h: number) => P(u, v, h);
  fillPoly(g, [t(-0.7, 0.08, 56), t(0.08, 0.08, 56), t(-0.31, -0.31, 76)], 0x7e3a30);
  fillPoly(g, [t(0.08, 0.08, 56), t(0.08, -0.7, 56), t(-0.31, -0.31, 76)], 0x5f2c26);
  // banner
  const top = P(-0.31, -0.31, 76);
  g.moveTo(top.x, top.y).lineTo(top.x, top.y - 16).stroke({ width: 1.6, color: 0x4a3426 });
  g.poly([top.x, top.y - 16, top.x + 13, top.y - 12, top.x, top.y - 8]).fill(0xe0a53a).stroke({ width: 1, color: 0x7a5418, alpha: 0.8 });
  crate(g, 1.0, 1.15);
  crate(g, 0.75, 1.2, 0.14, 6);
}

function drawStorage(g: Graphics): void {
  box(g, -0.85, -0.85, 0.85, 0.85, 0, 18, tones(WOOD));
  // plank lines
  for (let i = 1; i < 6; i++) {
    const u = -0.85 + (1.7 * i) / 6;
    const a = P(u, 0.85, 0);
    const b = P(u, 0.85, 18);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: WOOD_DARK, alpha: 0.35 });
  }
  leftFaceRect(g, 0.85, -0.4, 0.4, 0, 14, 0x5d4129);
  leftFaceRect(g, 0.85, -0.02, 0.02, 0, 14, 0x3a281a);
  gable(g, -0.85, -0.85, 0.85, 0.85, 18, 14, 'v', 0x5d6e74, WOOD);
  crate(g, 1.05, 0.9);
  crate(g, 0.95, 1.1, 0.14, 6);
}

function drawWorkshop(g: Graphics): void {
  box(g, -0.85, -0.85, 0.85, 0.85, 0, 20, tones(STONE));
  leftFaceRect(g, 0.85, -0.5, -0.12, 0, 13, 0x5b4331);
  leftFaceRect(g, 0.85, 0.2, 0.55, 8, 15, 0xf2b457);
  rightFaceRect(g, 0.85, -0.45, -0.05, 8, 15, 0xf2b457, 0.9);
  box(g, 0.28, -0.7, 0.55, -0.42, 18, 46, tones(0x80746b), 0.5);
  gable(g, -0.85, -0.85, 0.85, 0.85, 20, 12, 'u', 0x7a5a46, STONE);
  // anvil outside
  box(g, 0.97, 0.12, 1.2, 0.34, 0, 5, tones(0x56565e), 0.5);
  box(g, 0.93, 0.06, 1.24, 0.4, 5, 7.4, tones(0x6d6d76), 0.5);
}

function drawLumberCamp(g: Graphics): void {
  groundQuad(g, -0.95, -0.95, 0.95, 0.95, 0, 0x8a6a48, 0.5);
  // open shed: four posts and a lean-to roof
  for (const [u, v] of [
    [-0.8, -0.7],
    [0.2, -0.7],
    [-0.8, 0.3],
    [0.2, 0.3],
  ] as const) {
    const a = P(u, v, 0);
    const b = P(u, v, 20);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: WOOD_DARK });
  }
  box(g, -0.85, -0.75, 0.25, 0.35, 19, 23, tones(0x6a8a5a), 0.5);
  logPile(g, 0.55, 0.65);
  logPile(g, 0.7, -0.4);
  // chopping block with axe
  box(g, -0.4, 0.62, -0.1, 0.9, 0, 6, tones(0xb08354), 0.5);
  const a = P(-0.25, 0.76, 6);
  g.moveTo(a.x, a.y).lineTo(a.x + 5, a.y - 9).stroke({ width: 1.6, color: 0x5d3f29 });
  g.poly([a.x + 3, a.y - 9, a.x + 9, a.y - 8, a.x + 7, a.y - 3]).fill(0xb5b8be);
}

function drawMine(g: Graphics): void {
  groundQuad(g, -0.95, -0.95, 0.95, 0.95, 0, 0x7d7468, 0.55);
  // rock mound
  box(g, -0.9, -0.9, 0.9, 0.5, 0, 24, tones(0x8b8782));
  box(g, -0.6, -0.8, 0.7, 0.2, 24, 34, tones(0x9a968f));
  // timber-framed entrance on the +v face
  const dark = 0x1f1a1c;
  leftFaceRect(g, 0.5, -0.38, 0.38, 0, 17, dark);
  for (const u of [-0.42, 0.42]) {
    const a = P(u, 0.52, 0);
    const b = P(u, 0.52, 19);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: WOOD });
  }
  const l = P(-0.5, 0.52, 19);
  const r = P(0.5, 0.52, 19);
  g.moveTo(l.x, l.y).lineTo(r.x, r.y).stroke({ width: 3.4, color: WOOD });
  // cart and ore
  box(g, 0.2, 0.75, 0.62, 1.05, 3, 9, tones(0x6b5441), 0.5);
  for (let i = 0; i < 3; i++) {
    const p = P(0.3 + i * 0.12, 0.9, 11);
    g.circle(p.x, p.y, 2.4).fill(i === 1 ? 0xc9c4b8 : 0x9b958a);
  }
}

function drawWell(g: Graphics): void {
  // octagon-ish stone ring
  const ring = [
    [-0.34, -0.14],
    [-0.14, -0.34],
    [0.14, -0.34],
    [0.34, -0.14],
    [0.34, 0.14],
    [0.14, 0.34],
    [-0.14, 0.34],
    [-0.34, 0.14],
  ] as const;
  const topPts = ring.map(([u, v]) => P(u, v, 12));
  // visible lower walls
  for (let i = 3; i < 8; i++) {
    const [u1, v1] = ring[i]!;
    const [u2, v2] = ring[(i + 1) % 8]!;
    if (i === 7) continue;
    fillPoly(g, [P(u1, v1, 0), P(u2, v2, 0), P(u2, v2, 12), P(u1, v1, 12)], i % 2 ? 0x8f877d : 0xa59c90, 1, 0.5);
  }
  g.poly(topPts.flatMap((p) => [p.x, p.y])).fill(0xc3baad).stroke({ width: 1, color: 0x6e665c, alpha: 0.6 });
  const inner = ring.map(([u, v]) => P(u * 0.7, v * 0.7, 12));
  g.poly(inner.flatMap((p) => [p.x, p.y])).fill(0x3d6f9a);
  g.ellipse(P(0, 0, 12).x - 2, P(0, 0, 12).y - 1, 4, 1.6).fill({ color: 0xbfe0f0, alpha: 0.6 });
  // posts, beam and little roof
  for (const [u, v] of [
    [-0.3, 0.3],
    [0.3, -0.3],
  ] as const) {
    const a = P(u, v, 12);
    const b = P(u, v, 34);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2.6, color: WOOD_DARK });
  }
  const l = P(-0.3, 0.3, 34);
  const r = P(0.3, -0.3, 34);
  fillPoly(g, [{ x: l.x - 6, y: l.y + 2 }, { x: (l.x + r.x) / 2, y: l.y - 12 }, { x: r.x + 6, y: r.y + 2 }, { x: (l.x + r.x) / 2, y: r.y + 6 }], 0xb95b3e, 1, 0.5);
  const rope = P(0, 0, 30);
  g.moveTo(rope.x, rope.y).lineTo(rope.x, rope.y + 8).stroke({ width: 1, color: 0x4a3426 });
}

function drawFarm(g: Graphics, ripe: number): void {
  groundQuad(g, -1.45, -1.45, 1.45, 1.45, 0, 0x6e4e34, 1, 0.4);
  // tilled rows
  for (let i = 0; i < 4; i++) {
    const v0 = -1.3 + i * 0.68;
    groundQuad(g, -1.3, v0, 1.3, v0 + 0.36, 1.2, 0x5a3d29, 1, 0.3);
    groundQuad(g, -1.3, v0 + 0.36, 1.3, v0 + 0.5, 0.2, 0x7e5a3d, 1, 0);
    // crops growing along the row
    const n = 9;
    for (let k = 0; k < n; k++) {
      const u = -1.2 + (2.4 * k) / (n - 1);
      const p = P(u, v0 + 0.18, 1.2);
      const s = 2 + ripe * 4.5;
      g.moveTo(p.x, p.y).lineTo(p.x - 1.6, p.y - s).stroke({ width: 1.4, color: 0x5fa349 });
      g.moveTo(p.x, p.y).lineTo(p.x + 1.8, p.y - s * 0.9).stroke({ width: 1.4, color: 0x7cc060 });
      if (ripe > 0.7) g.circle(p.x, p.y - s, 1.2).fill(0xf0cf58);
    }
  }
  // fence on the two near sides
  for (let i = 0; i <= 6; i++) {
    const t = -1.45 + (2.9 * i) / 6;
    for (const [u, v] of [
      [t, 1.5],
      [1.5, t],
    ] as const) {
      const a = P(u, v, 0);
      const b = P(u, v, 8);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.6, color: WOOD });
    }
  }
  const a1 = P(-1.45, 1.5, 6);
  const a2 = P(1.5, 1.5, 6);
  const a3 = P(1.5, -1.45, 6);
  g.moveTo(a1.x, a1.y).lineTo(a2.x, a2.y).lineTo(a3.x, a3.y).stroke({ width: 1.6, color: WOOD, alpha: 0.95 });
}

/** Scaffolding and a partly raised shell for a site under construction. */
function drawConstruction(g: Graphics, w: number, h: number, progress: number, wall: number, flatSite = false): void {
  const hu = w / 2 - 0.1;
  const hv = h / 2 - 0.1;
  groundQuad(g, -hu - 0.1, -hv - 0.1, hu + 0.1, hv + 0.1, 0, 0x9a8466, 0.9);
  groundQuad(g, -hu + 0.1, -hv + 0.1, hu - 0.1, hv - 0.1, 1.5, 0xb9ac94, 0.9);
  const maxH = flatSite ? 6 : 14 + Math.min(w, h) * 6;
  const built = Math.max(0, progress - 0.12) / 0.88;
  if (flatSite) {
    const tilled = Math.min(1, built * 1.2);
    groundQuad(g, -hu + 0.1, -hv + 0.1, hu - 0.1, hv - 0.1, 1.6, 0x6e4e34, 0.4 + tilled * 0.6);
  } else if (built > 0.02) box(g, -hu + 0.15, -hv + 0.15, hu - 0.15, hv - 0.15, 1.5, 1.5 + built * maxH, tones(wall));
  const scaffoldH = Math.max(12, maxH * (0.5 + built * 0.55));
  stakes(g, -hu - 0.05, -hv - 0.05, hu + 0.05, hv + 0.05, scaffoldH);
  // cross planks on the near faces
  for (const f of [0.35, 0.7]) {
    const a = P(-hu, hv + 0.05, scaffoldH * f);
    const b = P(hu, hv + 0.05, scaffoldH * f);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: WOOD });
    const c = P(hu + 0.05, -hv, scaffoldH * f);
    const d = P(hu + 0.05, hv, scaffoldH * f);
    g.moveTo(c.x, c.y).lineTo(d.x, d.y).stroke({ width: 2, color: WOOD, alpha: 0.9 });
  }
  crate(g, hu + 0.25, hv + 0.2);
  box(g, -hu - 0.35, hv - 0.15, -hu - 0.1, hv + 0.15, 0, 4, tones(0xa7875f), 0.5);
}

const WALL_COLORS: Record<BuildingType, number> = {
  townCenter: 0xe3d2ae,
  house: PLASTER,
  farm: 0x7a5a3d,
  lumberCamp: WOOD,
  mine: 0x8b8782,
  well: 0xa59c90,
  storage: WOOD,
  workshop: STONE,
};

export function drawBuilding(g: Graphics, type: BuildingType, w: number, h: number, underConstruction: boolean, progress: number, ripe = 1): void {
  if (underConstruction) {
    drawConstruction(g, w, h, progress, WALL_COLORS[type], type === 'farm');
    return;
  }
  // soft contact shadow
  groundQuad(g, -w / 2 + 0.05, -h / 2 + 0.05, w / 2 + 0.25, h / 2 + 0.25, 0, 0x1c2438, 0.16, 0);
  switch (type) {
    case 'townCenter':
      return drawTownCenter(g);
    case 'house':
      return drawHouse(g);
    case 'farm':
      return drawFarm(g, ripe);
    case 'lumberCamp':
      return drawLumberCamp(g);
    case 'mine':
      return drawMine(g);
    case 'well':
      return drawWell(g);
    case 'storage':
      return drawStorage(g);
    case 'workshop':
      return drawWorkshop(g);
  }
}

/** Approximate height (px) of the tallest point, for click hit-testing. */
export function buildingHeight(type: BuildingType): number {
  switch (type) {
    case 'townCenter':
      return 90;
    case 'house':
      return 42;
    case 'farm':
      return 10;
    case 'lumberCamp':
      return 26;
    case 'mine':
      return 36;
    case 'well':
      return 36;
    case 'storage':
      return 34;
    case 'workshop':
      return 48;
  }
}

export { shadeHex };
