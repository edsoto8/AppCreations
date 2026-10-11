/** Small ground piles (output buffers, delivered construction materials) and construction pads. */
import { css, type RGB } from '../util/color';
import { mulberry32 } from '../util/noise';
import type { Art } from './canvas';
import { createArt } from './canvas';
import { Kit, compose, planks, solid } from './isoKit';
import { SHADOW } from './palette';

const SW = 52;
const SH = 40;
const AX = 26;
const AY = 28;

function newPile(): Art {
  return createArt(SW, SH, AX, AY);
}

function shadow(c: CanvasRenderingContext2D, rx: number): void {
  c.fillStyle = css(SHADOW, 0.22);
  c.beginPath();
  c.ellipse(AX + 2, AY + 1, rx, rx * 0.42, 0, 0, Math.PI * 2);
  c.fill();
}

function log(c: CanvasRenderingContext2D, x: number, y: number, len = 20): void {
  // a log running along the iso u axis (screen direction 2:1 down-right)
  const dx = len * 0.894;
  const dy = len * 0.447;
  c.lineCap = 'round';
  c.strokeStyle = css([52, 36, 28], 1);
  c.lineWidth = 6.6;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + dx, y + dy);
  c.stroke();
  c.strokeStyle = css([164, 120, 78], 1);
  c.lineWidth = 5.2;
  c.stroke();
  c.strokeStyle = css([204, 160, 110], 1);
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(x + 0.6, y - 1.6);
  c.lineTo(x + dx - 0.6, y + dy - 1.6);
  c.stroke();
  c.fillStyle = css([236, 202, 150], 1);
  c.beginPath();
  c.ellipse(x + dx, y + dy, 2.2, 2.9, -0.45, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = css([150, 104, 66], 1);
  c.lineWidth = 0.6;
  c.beginPath();
  c.ellipse(x + dx, y + dy, 1.1, 1.5, -0.45, 0, Math.PI * 2);
  c.stroke();
}

/** Log stack, level 1..4. */
export function makeLogPile(level: number): Art {
  const art = newPile();
  const c = art.ctx;
  shadow(c, 18);
  const rows = [
    [2, 0],
    [3, 0],
    [3, 2],
    [4, 3],
  ][level - 1]!;
  const [bottom, upper] = rows;
  const place = (n: number, row: number): void => {
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 5.6;
      log(c, AX - 10 + off * -0.894 + row * 0.2, AY - 6 + off * 0.447 - row * 5.2, 17);
    }
  };
  place(bottom!, 0);
  if (upper) place(upper, 1);
  if (level === 4) place(2, 2);
  return art;
}

function rock(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  const rng = mulberry32(seed);
  c.fillStyle = css(SHADOW, 0.25);
  c.beginPath();
  c.ellipse(x + 1, y + 1, r + 1, r * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = css([46, 44, 50], 1);
  c.beginPath();
  c.moveTo(x - r, y);
  c.lineTo(x - r * 0.7, y - r * (0.7 + rng() * 0.2));
  c.lineTo(x + r * 0.2, y - r * 1.05);
  c.lineTo(x + r, y - r * 0.5);
  c.lineTo(x + r * 0.9, y);
  c.lineTo(x, y + r * 0.35);
  c.fill();
  c.fillStyle = css([158, 154, 152], 1);
  c.beginPath();
  c.moveTo(x - r * 0.84, y - 0.2);
  c.lineTo(x - r * 0.6, y - r * 0.62);
  c.lineTo(x + r * 0.2, y - r * 0.9);
  c.lineTo(x + r * 0.84, y - r * 0.44);
  c.lineTo(x + r * 0.76, y - 0.2);
  c.lineTo(x, y + r * 0.2);
  c.fill();
  c.fillStyle = css([214, 210, 202], 1);
  c.beginPath();
  c.moveTo(x - r * 0.6, y - r * 0.62);
  c.lineTo(x + r * 0.2, y - r * 0.9);
  c.lineTo(x + r * 0.5, y - r * 0.5);
  c.lineTo(x - r * 0.2, y - r * 0.3);
  c.fill();
}

export function makeStonePile(level: number): Art {
  const art = newPile();
  const c = art.ctx;
  shadow(c, 16);
  const spots: [number, number, number][] = [
    [-6, -2, 5.4],
    [6, 0, 5],
    [0, 3, 4.6],
    [-1, -7, 4.6],
    [10, -5, 3.6],
    [-12, 2, 3.4],
    [4, -10, 3.4],
  ];
  const n = [2, 3, 5, 7][level - 1]!;
  spots
    .slice(0, n)
    .sort((a, b) => a[1] - b[1])
    .forEach(([dx, dy, r], i) => rock(c, AX + dx, AY + dy, r, i + 3));
  return art;
}

export function makeCratePile(level: number): Art {
  const k = new Kit(1, 1, 30, 8);
  const crate = (u: number, v: number, h0: number, s = 0.17): void => {
    const hh = 10;
    k.box(u - s, u + s, v - s, v + s, h0, h0 + hh, { left: compose(solid([176, 128, 84], 1), planks(3, 0.3, 3), (cc, w, h) => { cc.fillStyle = css([90, 60, 40], 0.5); cc.fillRect(0, h / 2 - 0.4, w, 0.8); }), right: compose(solid([176, 128, 84], 0.72), planks(3, 0.3, 4)), top: solid([210, 168, 118], 1) }, 0.55);
  };
  k.groundShadow(-0.3, 0.3, -0.3, 0.3, 0.7);
  crate(-0.12, -0.12, 0);
  if (level >= 2) crate(0.22, 0.0, 0);
  if (level >= 2) crate(-0.14, 0.24, 0);
  if (level >= 3) crate(0.04, -0.06, 10, 0.15);
  return k.art;
}

export function makeProducePile(level: number): Art {
  const art = newPile();
  const c = art.ctx;
  shadow(c, 16);
  const basket = (x: number, y: number, r: number, fruit: RGB): void => {
    c.fillStyle = css([60, 40, 26], 1);
    c.beginPath();
    c.ellipse(x, y, r + 1, r * 0.5 + 1, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = css([186, 138, 84], 1);
    c.beginPath();
    c.moveTo(x - r, y - 2);
    c.lineTo(x - r * 0.8, y + 3.4);
    c.lineTo(x + r * 0.8, y + 3.4);
    c.lineTo(x + r, y - 2);
    c.fill();
    c.strokeStyle = css([120, 84, 52], 0.8);
    c.lineWidth = 0.7;
    c.beginPath();
    c.moveTo(x - r * 0.9, y + 0.6);
    c.lineTo(x + r * 0.9, y + 0.6);
    c.stroke();
    c.fillStyle = css([186, 138, 84], 1);
    c.beginPath();
    c.ellipse(x, y - 2, r, r * 0.45, 0, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 6; i++) {
      c.fillStyle = css(fruit, 1);
      c.beginPath();
      c.arc(x - r * 0.6 + i * (r * 0.25), y - 3.4 - (i % 2) * 1.2, 1.9, 0, Math.PI * 2);
      c.fill();
    }
  };
  basket(AX - 8, AY - 2, 7, [236, 196, 80]);
  if (level >= 2) basket(AX + 8, AY, 7, [210, 90, 70]);
  if (level >= 3) basket(AX, AY - 8, 6.4, [236, 196, 80]);
  return art;
}

export function makePlankPile(level: number): Art {
  const k = new Kit(1, 1, 24, 8);
  const slab = (h0: number, u: number): void => {
    k.box(u - 0.3, u + 0.3, -0.12, 0.12, h0, h0 + 3, { left: compose(solid([208, 170, 120], 1), planks(4, 0.2, 7)), right: compose(solid([208, 170, 120], 0.74)), top: compose(solid([226, 190, 140], 1), planks(2, 0.18, 8)) }, 0.5);
  };
  k.groundShadow(-0.34, 0.34, -0.14, 0.14, 0.6);
  for (let i = 0; i < level + 1; i++) slab(i * 3, i % 2 ? 0.04 : -0.02);
  return k.art;
}

/** Staked-out building site: trampled earth, corner stakes and rope. */
export function makeSitePad(w: number, h: number): Art {
  const k = new Kit(w, h, 22, 10);
  const c = k.ctx;
  const hu = w / 2 - 0.04;
  const hv = h / 2 - 0.04;
  const rng = mulberry32(w * 10 + h);
  k.top(-hu, hu, -hv, hv, 0, compose(solid([164, 136, 98], 1, 0.02), (cc, ww, hh) => {
    for (let i = 0; i < 80 * w * h * 0.5; i++) {
      cc.fillStyle = css(rng() < 0.5 ? [112, 88, 62] : [206, 182, 142], 0.5);
      cc.beginPath();
      cc.ellipse(rng() * ww, rng() * hh, 1 + rng() * 1.6, 0.6 + rng() * 0.8, rng() * 3, 0, Math.PI * 2);
      cc.fill();
    }
    cc.strokeStyle = 'rgba(80,60,40,0.55)';
    cc.lineWidth = 1.2;
    cc.setLineDash([4, 3]);
    cc.strokeRect(5, 5, ww - 10, hh - 10);
  }), 0);
  const corners: [number, number][] = [
    [-hu, -hv],
    [hu, -hv],
    [hu, hv],
    [-hu, hv],
  ];
  const tops = corners.map(([u, v]) => k.P(u, v, 12));
  c.strokeStyle = css([226, 214, 180], 0.9);
  c.lineWidth = 0.9;
  c.beginPath();
  tops.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
  c.closePath();
  c.stroke();
  corners.forEach(([u, v], i) => {
    const a = k.P(u, v, 0);
    const b = tops[i]!;
    c.strokeStyle = css([52, 36, 28], 1);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.strokeStyle = css([176, 128, 82], 1);
    c.lineWidth = 1.7;
    c.stroke();
    if (i === 2 || i === 0) {
      c.fillStyle = css([226, 160, 52], 1);
      c.beginPath();
      c.moveTo(b.x, b.y);
      c.lineTo(b.x + 7, b.y + 2);
      c.lineTo(b.x, b.y + 4.4);
      c.fill();
    }
  });
  return k.art;
}
