/** Small ground decals and effect sprites (tufts, shells, reeds, stumps, water sparkles ...). */
import { css, type RGB } from '../util/color';
import { mulberry32 } from '../util/noise';
import { createArt, softBlob, type Art } from './canvas';
import { FLOWER_COLORS, SHADOW } from './palette';

function shadowEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.26): void {
  softBlob(ctx, x, y, rx, ry, css(SHADOW, 1), a);
}

export function makeTuft(seed: number): Art {
  const art = createArt(20, 16, 10, 13);
  const { ctx } = art;
  const rng = mulberry32(seed * 31 + 1);
  shadowEllipse(ctx, 10.5, 13.5, 6, 2.4, 0.3);
  const n = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const len = 6 + rng() * 5;
    const light = i % 2 === 0;
    ctx.strokeStyle = css(light ? [158, 208, 104] : [70, 128, 64], 1);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(10 + t * 4, 13.5);
    ctx.quadraticCurveTo(10 + t * 7, 13.5 - len * 0.6, 10 + t * 12 + (rng() - 0.5) * 2, 13.5 - len);
    ctx.stroke();
  }
  return art;
}

export function makeFlowerPatch(seed: number): Art {
  const art = createArt(22, 14, 11, 10);
  const { ctx } = art;
  const rng = mulberry32(seed * 57 + 9);
  shadowEllipse(ctx, 11.5, 10.5, 8, 2.8, 0.22);
  const color = FLOWER_COLORS[seed % FLOWER_COLORS.length]!;
  for (let i = 0; i < 6; i++) {
    const x = 5 + rng() * 12;
    const y = 6 + rng() * 5;
    ctx.strokeStyle = css([70, 128, 64], 1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = css(rng() < 0.75 ? color : FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]!, 1);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 1.3, y + Math.sin(a) * 1.0 - 0.5, 1.0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = css([250, 210, 80], 1);
    ctx.beginPath();
    ctx.arc(x, y - 0.5, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  return art;
}

export function makeBush(seed: number): Art {
  const art = createArt(26, 20, 13, 17);
  const { ctx } = art;
  const rng = mulberry32(seed * 91 + 3);
  shadowEllipse(ctx, 14, 17.5, 10, 3.2, 0.32);
  const blobs: [number, number, number][] = [
    [8.5, 12, 5.2],
    [17, 12.5, 5],
    [12.5, 9, 6],
  ];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0.5, x, y, r);
    g.addColorStop(0, css([128, 190, 90], 1));
    g.addColorStop(0.6, css([72, 142, 70], 1));
    g.addColorStop(1, css([44, 98, 60], 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = css(FLOWER_COLORS[(seed + i) % FLOWER_COLORS.length]!, 0.95);
    ctx.beginPath();
    ctx.arc(7 + rng() * 12, 8 + rng() * 6, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  return art;
}

export function makePebbles(seed: number): Art {
  const art = createArt(18, 10, 9, 7);
  const { ctx } = art;
  const rng = mulberry32(seed * 17 + 2);
  for (let i = 0; i < 3; i++) {
    const x = 4 + rng() * 10;
    const y = 4 + rng() * 3;
    const r = 1.5 + rng() * 1.5;
    ctx.fillStyle = css(SHADOW, 0.25);
    ctx.beginPath();
    ctx.ellipse(x + 0.8, y + 0.9, r + 0.5, r * 0.5 + 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css([164, 156, 142], 1);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css([210, 204, 188], 0.9);
    ctx.beginPath();
    ctx.ellipse(x - r * 0.25, y - r * 0.25, r * 0.5, r * 0.3, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return art;
}

export function makeShell(seed: number): Art {
  const art = createArt(10, 8, 5, 5);
  const { ctx } = art;
  ctx.fillStyle = css(SHADOW, 0.22);
  ctx.beginPath();
  ctx.ellipse(5.6, 5.5, 3, 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(seed % 2 ? [248, 226, 214] : [246, 204, 190], 1);
  ctx.beginPath();
  ctx.moveTo(1.5, 5);
  ctx.quadraticCurveTo(5, -1, 8.5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = css([200, 150, 140], 0.7);
  ctx.lineWidth = 0.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(5, 4.8);
    ctx.lineTo(5 + i * 1.8, 1.6);
    ctx.stroke();
  }
  return art;
}

export function makeReeds(seed: number): Art {
  const art = createArt(22, 30, 11, 27);
  const { ctx } = art;
  const rng = mulberry32(seed * 7 + 11);
  shadowEllipse(ctx, 11.5, 27, 7, 2.2, 0.28);
  for (let i = 0; i < 9; i++) {
    const x = 6 + rng() * 10;
    const h = 12 + rng() * 14;
    const lean = (rng() - 0.5) * 6;
    ctx.strokeStyle = css(rng() < 0.5 ? [88, 140, 74] : [122, 170, 88], 1);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, 27);
    ctx.quadraticCurveTo(x + lean * 0.4, 27 - h * 0.6, x + lean, 27 - h);
    ctx.stroke();
    if (i % 3 === 0) {
      ctx.strokeStyle = css([112, 76, 50], 1);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + lean, 27 - h);
      ctx.lineTo(x + lean + lean * 0.05, 27 - h - 3.4);
      ctx.stroke();
    }
  }
  return art;
}

export function makeLilyPad(seed: number): Art {
  const art = createArt(18, 10, 9, 5);
  const { ctx } = art;
  const rng = mulberry32(seed + 5);
  const pads = [
    [6, 5, 4.2],
    [12.5, 5.6, 3.2],
  ];
  for (const [x, y, r] of pads as [number, number, number][]) {
    ctx.fillStyle = css([40, 100, 90], 0.3);
    ctx.beginPath();
    ctx.ellipse(x + 0.6, y + 0.8, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css([84, 156, 90], 1);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.5, 0, 0.3, Math.PI * 2 - 0.1);
    ctx.lineTo(x, y);
    ctx.fill();
    ctx.fillStyle = css([124, 190, 106], 0.8);
    ctx.beginPath();
    ctx.ellipse(x - r * 0.2, y - r * 0.1, r * 0.55, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (rng() < 0.7) {
    ctx.fillStyle = css([248, 190, 214], 1);
    ctx.beginPath();
    ctx.arc(6.5, 4, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css([252, 226, 120], 1);
    ctx.beginPath();
    ctx.arc(6.5, 3.8, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return art;
}

export function makeStump(): Art {
  const art = createArt(16, 14, 8, 11);
  const { ctx } = art;
  shadowEllipse(ctx, 9, 11.5, 6, 2, 0.3);
  const g = ctx.createLinearGradient(2, 0, 14, 0);
  g.addColorStop(0, css([128, 94, 64], 1));
  g.addColorStop(1, css([86, 60, 44], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(3, 6);
  ctx.lineTo(3.5, 10.5);
  ctx.quadraticCurveTo(8, 12.6, 12.5, 10.5);
  ctx.lineTo(13, 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = css([212, 176, 126], 1);
  ctx.beginPath();
  ctx.ellipse(8, 6, 5, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = css([160, 120, 84], 0.8);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.ellipse(8, 6, 3, 1.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(8, 6, 1.2, 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
  return art;
}

/** Bright sparkle streak used for animated water shimmer. */
export function makeSparkle(): Art {
  const art = createArt(26, 8, 13, 4);
  const { ctx } = art;
  const g = ctx.createLinearGradient(0, 0, 26, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(1, 4.6);
  ctx.quadraticCurveTo(13, 2.2, 25, 4.6);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(5, 6.3);
  ctx.quadraticCurveTo(13, 4.8, 21, 6.3);
  ctx.stroke();
  return art;
}

/** Soft elliptical ground shadow (settlers, buildings). */
export function makeShadowBlob(): Art {
  const art = createArt(64, 32, 32, 16);
  softBlob(art.ctx, 32, 16, 30, 14, css(SHADOW, 1), 0.55);
  return art;
}

export type DecalRgb = RGB;
