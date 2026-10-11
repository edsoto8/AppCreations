/**
 * Baked tree clusters. A forest tile is one sprite showing 1..5 trees (the count follows the tile's
 * remaining wood), drawn back-to-front with soft shadows. Two species give forests regional character.
 */
import { createArt, softBlob, type Art } from './canvas';
import { SHADOW, TREE } from './palette';
import { css, mixRgb, type RGB } from '../util/color';
import { mulberry32 } from '../util/noise';

export type TreeSpecies = 'oak' | 'pine' | 'birch';
export const TREE_SPECIES: readonly TreeSpecies[] = ['oak', 'pine', 'birch'];
export const TREE_LEVELS = 5;
export const TREE_VARIANTS = 4;

export const CLUSTER_W = 92;
export const CLUSTER_H = 96;
export const CLUSTER_AX = 46;
export const CLUSTER_AY = 74;

function circlePath(ctx: CanvasRenderingContext2D, blobs: { x: number; y: number; r: number }[]): void {
  ctx.beginPath();
  for (const b of blobs) {
    ctx.moveTo(b.x + b.r, b.y);
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  }
}

function trunk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, light: RGB, dark: RGB): void {
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, css(light, 1));
  g.addColorStop(1, css(dark, 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - w * 0.35, y);
  ctx.quadraticCurveTo(x - w / 2, y - h * 0.25, x - w / 2, y - h);
  ctx.lineTo(x + w / 2, y - h);
  ctx.quadraticCurveTo(x + w / 2, y - h * 0.25, x + w / 2 + w * 0.35, y);
  ctx.closePath();
  ctx.fill();
}

function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, a: number): void {
  softBlob(ctx, x + rx * 0.28, y + 0.5, rx, rx * 0.42, css(SHADOW, 1), a);
}

interface CanopyOpts {
  dark: RGB;
  mid: RGB;
  light: RGB;
  hi: RGB;
}

const OAK: CanopyOpts = { dark: TREE.oakDark, mid: TREE.oakMid, light: TREE.oakLight, hi: TREE.oakHi };
const BIRCH: CanopyOpts = { dark: [70, 118, 60], mid: [112, 162, 70], light: [160, 202, 88], hi: [214, 232, 120] };

function drawRound(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rng: () => number, pal: CanopyOpts, birch: boolean): void {
  groundShadow(ctx, x, y, 13 * s, 0.4);
  const th = (birch ? 17 : 12) * s;
  if (birch) {
    trunk(ctx, x, y, 2.6 * s, th, [238, 234, 224], [150, 144, 134]);
    ctx.fillStyle = css([60, 56, 54], 0.8);
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 1 * s, y - th * (0.2 + i * 0.2), 1.6 * s, 0.9 * s);
  } else {
    trunk(ctx, x, y, 3.6 * s, th, TREE.trunk, TREE.trunkDark);
  }
  const cy = y - th - (birch ? 8 : 9) * s;
  const j = () => (rng() - 0.5) * 2.4 * s;
  const R = birch ? 0.86 : 1;
  const blobs = [
    { x: x - 7 * s + j(), y: cy + 4 * s + j(), r: 8.2 * s * R },
    { x: x + 7.4 * s + j(), y: cy + 4.6 * s + j(), r: 7.8 * s * R },
    { x: x + j(), y: cy - 3.6 * s + j(), r: 10.4 * s * R },
    { x: x - 5.6 * s + j(), y: cy - 6.4 * s + j(), r: 7.2 * s * R },
    { x: x + 6 * s + j(), y: cy - 7.4 * s + j(), r: 6.8 * s * R },
    { x: x + j() * 0.5, y: cy + 7 * s, r: 7 * s * R },
  ];
  // outline
  ctx.save();
  circlePath(ctx, blobs.map((b) => ({ ...b, r: b.r + 0.9 })));
  ctx.fillStyle = css(mixRgb(pal.dark, [10, 30, 20], 0.55), 0.95);
  ctx.fill();
  ctx.restore();
  // base fill
  ctx.save();
  circlePath(ctx, blobs);
  ctx.clip();
  const topY = cy - 18 * s;
  const botY = cy + 14 * s;
  const base = ctx.createLinearGradient(x - 12 * s, topY, x + 12 * s, botY);
  base.addColorStop(0, css(pal.mid, 1));
  base.addColorStop(0.55, css(mixRgb(pal.mid, pal.dark, 0.55), 1));
  base.addColorStop(1, css(pal.dark, 1));
  ctx.fillStyle = base;
  ctx.fillRect(x - 24 * s, topY - 4, 48 * s, botY - topY + 8);
  // lit clumps (upper-left of each blob)
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x - b.r * 0.38, b.y - b.r * 0.42, 0, b.x - b.r * 0.2, b.y - b.r * 0.25, b.r * 0.95);
    g.addColorStop(0, css(pal.hi, 0.85));
    g.addColorStop(0.45, css(pal.light, 0.7));
    g.addColorStop(1, css(pal.light, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // dark undersides
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x + b.r * 0.2, b.y + b.r * 0.55, 0, b.x + b.r * 0.2, b.y + b.r * 0.5, b.r * 0.75);
    g.addColorStop(0, css(pal.dark, 0.7));
    g.addColorStop(1, css(pal.dark, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // leaf speckle
  for (let i = 0; i < 46; i++) {
    const b = blobs[Math.floor(rng() * blobs.length)]!;
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * b.r * 0.9;
    const px = b.x + Math.cos(a) * rr;
    const py = b.y + Math.sin(a) * rr;
    const lit = px - x + (py - cy) * 0.3 < 0;
    ctx.fillStyle = css(lit ? pal.hi : pal.dark, lit ? 0.5 : 0.4);
    ctx.beginPath();
    ctx.ellipse(px, py, (0.9 + rng() * 1.2) * s, (0.6 + rng() * 0.8) * s, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPine(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rng: () => number): void {
  groundShadow(ctx, x, y, 12 * s, 0.4);
  trunk(ctx, x, y, 3 * s, 8 * s, TREE.trunk, TREE.trunkDark);
  const tiers = 4;
  const total = 40 * s;
  const baseY = y - 4 * s;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1); // 0 bottom .. 1 top
    const w = (13.5 - f * 8.5) * s;
    const h = (14 - f * 3.2) * s;
    const yb = baseY - f * (total - h * 0.8);
    const yt = yb - h;
    // zig-zag skirt
    const pts: [number, number][] = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const px = x - w + u * 2 * w;
      const py = yb + (i % 2 === 0 ? 0 : -1.8 * s) + (rng() - 0.5) * 0.8 * s;
      pts.push([px, py]);
    }
    const outline = (inflate: number) => {
      ctx.beginPath();
      ctx.moveTo(x, yt - inflate);
      ctx.lineTo(pts[pts.length - 1]![0] + inflate, pts[pts.length - 1]![1] + inflate * 0.6);
      for (let i = pts.length - 2; i >= 0; i--) ctx.lineTo(pts[i]![0] - (i === 0 ? inflate : 0), pts[i]![1] + inflate * 0.6);
      ctx.closePath();
    };
    outline(0.9);
    ctx.fillStyle = css(mixRgb(TREE.pineDark, [8, 28, 24], 0.5), 0.95);
    ctx.fill();
    // left (lit) and right (shade) halves
    ctx.save();
    outline(0);
    ctx.clip();
    const gl = ctx.createLinearGradient(x - w, yt, x, yb);
    gl.addColorStop(0, css(TREE.pineLight, 1));
    gl.addColorStop(1, css(TREE.pineMid, 1));
    ctx.fillStyle = gl;
    ctx.fillRect(x - w - 1, yt - 1, w + 1, h + 4);
    const gr = ctx.createLinearGradient(x, yt, x + w, yb);
    gr.addColorStop(0, css(TREE.pineMid, 1));
    gr.addColorStop(1, css(TREE.pineDark, 1));
    ctx.fillStyle = gr;
    ctx.fillRect(x, yt - 1, w + 1, h + 4);
    // under-tier shadow
    const sh = ctx.createLinearGradient(0, yb - 5 * s, 0, yb);
    sh.addColorStop(0, css(TREE.pineDark, 0));
    sh.addColorStop(1, css(TREE.pineDark, 0.55));
    ctx.fillStyle = sh;
    ctx.fillRect(x - w - 1, yb - 5 * s, 2 * w + 2, 6 * s);
    // needle strokes
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 10; i++) {
      const px = x + (rng() - 0.5) * w * 1.5;
      const py = yt + h * (0.25 + rng() * 0.7);
      const lit = px < x;
      ctx.strokeStyle = css(lit ? [150, 206, 140] : TREE.pineDark, lit ? 0.5 : 0.5);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (lit ? -1 : 1) * 2.2 * s, py + 1.8 * s);
      ctx.stroke();
    }
    ctx.restore();
  }
}

const SLOTS: Record<number, [number, number][]> = {
  1: [[0, 2]],
  2: [
    [-9, 1],
    [9, 4],
  ],
  3: [
    [-11, 2],
    [10, 3],
    [0, -5],
  ],
  4: [
    [-12, 2],
    [11, 3],
    [-2, -6],
    [1, 8],
  ],
  5: [
    [-14, 1],
    [13, 2],
    [-5, -6],
    [7, -5],
    [0, 8],
  ],
};

export function makeTreeCluster(species: TreeSpecies, level: number, variant: number): Art {
  const art = createArt(CLUSTER_W, CLUSTER_H, CLUSTER_AX, CLUSTER_AY);
  const { ctx } = art;
  const rng = mulberry32((variant + 1) * 7919 + level * 131 + (species === 'oak' ? 1 : species === 'pine' ? 2 : 3) * 17);
  const slots = [...SLOTS[level]!].map(([sx, sy]) => [sx + (rng() - 0.5) * 4, sy + (rng() - 0.5) * 2.4] as [number, number]);
  slots.sort((a, b) => a[1] - b[1]);
  const baseScale = level === 1 ? 0.78 : level === 2 ? 0.92 : 1;
  for (const [sx, sy] of slots) {
    const s = baseScale * (0.88 + rng() * 0.26);
    const x = CLUSTER_AX + sx;
    const y = CLUSTER_AY + sy;
    // mixed stands: a tile of 'oak' may carry the odd pine, and vice versa
    let sp: TreeSpecies = species;
    if (level >= 3 && rng() < 0.22) sp = species === 'pine' ? 'oak' : 'pine';
    if (sp === 'pine') drawPine(ctx, x, y, s * 0.96, rng);
    else drawRound(ctx, x, y, s, rng, sp === 'birch' ? BIRCH : OAK, sp === 'birch');
  }
  return art;
}
