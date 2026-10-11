/** Boulder clusters for hills and the faceted, snow-capped mountain peaks. */
import { addGrain, createArt, softBlob, TEX_SCALE, type Art } from './canvas';
import { ROCK, SHADOW, SNOW } from './palette';
import { css, mixRgb, type RGB } from '../util/color';
import { clamp, fbm, mulberry32, smoothstep } from '../util/noise';

export const ROCK_LEVELS = 4;
export const ROCK_VARIANTS = 5;
export const ROCK_W = 64;
export const ROCK_H = 44;
export const ROCK_AX = 32;
export const ROCK_AY = 30;

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** One faceted boulder standing on (x, y). w/h are its half-width and height. */
function boulder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rng: () => number, tone: RGB = ROCK.mid): void {
  softBlob(ctx, x + w * 0.3, y + 0.8, w * 1.25, w * 0.5, css(SHADOW, 1), 0.42);
  const n = 7;
  const outline: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI; // upper half-ring from left to right
    const jx = 1 + (rng() - 0.5) * 0.22;
    const jy = 1 + (rng() - 0.5) * 0.3;
    outline.push([x + Math.cos(a) * w * jx, y + Math.sin(a) * h * jy]);
  }
  outline.unshift([x - w * 1.02, y + 0.2]);
  outline.push([x + w * 1.02, y + 0.2]);
  const apex = outline.reduce((m, p) => (p[1] < m[1] ? p : m), outline[0]!);
  // outline
  ctx.save();
  poly(ctx, outline);
  ctx.fillStyle = css(mixRgb(ROCK.dark, [20, 20, 30], 0.5), 1);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = css(mixRgb(ROCK.dark, [20, 20, 30], 0.5), 1);
  ctx.stroke();
  ctx.fill();
  ctx.clip();
  // lit top/left facet, mid body, dark right facet
  const lit = mixRgb(tone, ROCK.light, 0.7);
  const mid = tone;
  const dark = mixRgb(tone, ROCK.dark, 0.7);
  ctx.fillStyle = css(mid, 1);
  ctx.fillRect(x - w * 1.2, y - h * 1.3, w * 2.4, h * 1.5);
  const cutX = apex[0] + w * (0.05 + rng() * 0.3);
  poly(ctx, [
    [apex[0] - w * 0.8, apex[1] - 1],
    [apex[0] + w * 0.15, apex[1] - 2],
    [cutX, y - h * 0.35],
    [x - w * 1.1, y - h * 0.1],
  ]);
  ctx.fillStyle = css(lit, 1);
  ctx.fill();
  poly(ctx, [
    [cutX, y - h * 0.4],
    [apex[0] + w * 0.2, apex[1] - 2],
    [x + w * 1.2, y - h * 0.6],
    [x + w * 1.2, y + 2],
    [x + w * 0.1, y + 2],
  ]);
  ctx.fillStyle = css(dark, 1);
  ctx.fill();
  // bottom shade + cracks
  const g = ctx.createLinearGradient(0, y - h * 0.4, 0, y + 1);
  g.addColorStop(0, css(ROCK.dark, 0));
  g.addColorStop(1, css(ROCK.dark, 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(x - w * 1.2, y - h * 0.4, w * 2.4, h * 0.5);
  ctx.strokeStyle = css(ROCK.dark, 0.55);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cutX, y - h * 0.6);
  ctx.lineTo(cutX + (rng() - 0.5) * w * 0.6, y - h * 0.25);
  ctx.lineTo(cutX + (rng() - 0.5) * w * 0.8, y);
  ctx.stroke();
  ctx.restore();
}

export function makeRockCluster(level: number, variant: number): Art {
  const art = createArt(ROCK_W, ROCK_H, ROCK_AX, ROCK_AY);
  const { ctx } = art;
  const rng = mulberry32(variant * 7717 + level * 31 + 5);
  const slots: [number, number, number, number][] = [
    // x, y, halfW, h
    [-4, -3, 8.5, 11],
    [9, 2, 7, 8.5],
    [-12, 3, 5.5, 6.5],
    [3, 6, 4.8, 5.4],
    [15, -2, 4, 4.4],
    [-16, -1, 3.4, 3.4],
  ];
  const count = [1, 2, 3, 4][clamp(level, 1, 4) - 1]!;
  const order = slots.slice(0, count).sort((a, b) => a[1] - b[1]);
  const shift = rng() < 0.5 ? -1 : 1;
  for (const [sx, sy, w, h] of order) {
    const tone = mixRgb(ROCK.mid, [150, 134, 118], rng() * 0.45);
    boulder(ctx, ROCK_AX + sx * shift + (rng() - 0.5) * 2, ROCK_AY + sy, w * (0.9 + rng() * 0.2), h * (0.9 + rng() * 0.2), rng, tone);
  }
  return art;
}

/** Depleted hill: just pebbles and chips. */
export function makeRubble(variant: number): Art {
  const art = createArt(ROCK_W, ROCK_H, ROCK_AX, ROCK_AY);
  const rng = mulberry32(variant * 331 + 7);
  for (let i = 0; i < 4; i++) boulder(art.ctx, ROCK_AX - 14 + i * 9 + (rng() - 0.5) * 4, ROCK_AY + (rng() - 0.5) * 8, 2.6 + rng() * 1.4, 2.2 + rng() * 1.2, rng);
  return art;
}

// --- Mountains ----------------------------------------------------------------------------------

export const MOUNTAIN_W = 112;
export const MOUNTAIN_H = 118;
export const MOUNTAIN_AX = 56;
export const MOUNTAIN_AY = 92;
export const MOUNTAIN_VARIANTS = 4;
export const SNOW_LEVELS = 3; // 0 none, 1 cap, 2 deep snow

interface PeakSpec {
  w: number;
  h: number;
  apexDx: number;
  /** secondary shoulder peak: position relative to the centre and height fraction, or null */
  twin: { dx: number; hf: number } | null;
}

const PEAKS: PeakSpec[] = [
  { w: 92, h: 70, apexDx: -3, twin: { dx: 26, hf: 0.6 } },
  { w: 84, h: 76, apexDx: 4, twin: null },
  { w: 98, h: 64, apexDx: 0, twin: { dx: -28, hf: 0.64 } },
  { w: 88, h: 72, apexDx: -6, twin: { dx: 22, hf: 0.52 } },
];
/** Height multiplier per mountain class (0 foothill, 1 peak, 2 high summit with deep snow). */
const CLASS_HEIGHT = [0.52, 0.78, 1.0];

function peakOutline(spec: PeakSpec, rng: () => number): { pts: [number, number][]; apex: [number, number]; ridgeBottom: [number, number] } {
  const cx = MOUNTAIN_AX;
  const by = MOUNTAIN_AY;
  const { w, h } = spec;
  const apex: [number, number] = [cx + spec.apexDx, by - h];
  const j = () => (rng() - 0.5) * 3;
  const twinSide = spec.twin ? Math.sign(spec.twin.dx) : 0;
  const twinPts = (): [number, number][] => {
    const tw = spec.twin!;
    const tx = cx + tw.dx;
    const th = h * tw.hf;
    return [
      [tx - w * 0.1, by - th * 0.8 + j()],
      [tx, by - th],
      [tx + w * 0.1, by - th * 0.78 + j()],
    ];
  };
  const pts: [number, number][] = [];
  pts.push([cx - w / 2, by - 1]);
  pts.push([cx - w * 0.4 + j(), by - h * 0.26 + j()]);
  if (twinSide < 0) pts.push([cx - w * 0.36, by - h * 0.4 + j()], ...twinPts(), [cx - w * 0.1, by - h * 0.56 + j()]);
  else pts.push([cx - w * 0.27 + j(), by - h * 0.46 + j()]);
  pts.push([cx - w * 0.15 + j() + spec.apexDx * 0.4, by - h * 0.76 + j()]);
  pts.push(apex);
  pts.push([apex[0] + w * 0.12 + j(), by - h * 0.76 + j()]);
  if (twinSide > 0) pts.push([cx + w * 0.16, by - h * 0.44 + j()], ...twinPts(), [cx + w * 0.4, by - h * 0.26 + j()]);
  else pts.push([cx + w * 0.3 + j(), by - h * 0.3 + j()]);
  pts.push([cx + w * 0.42 + j(), by - h * 0.14 + j()]);
  pts.push([cx + w / 2, by - 1]);
  const ridgeBottom: [number, number] = [cx + spec.apexDx * 0.3 + 6, by + 3];
  return { pts, apex, ridgeBottom };
}

export function makeMountain(variant: number, cls: number, flip: boolean): Art {
  const snow = cls;
  const art = createArt(MOUNTAIN_W, MOUNTAIN_H, MOUNTAIN_AX, MOUNTAIN_AY);
  const { ctx, canvas } = art;
  const base = PEAKS[variant % PEAKS.length]!;
  const spec: PeakSpec = { ...base, h: base.h * CLASS_HEIGHT[cls]! };
  const rng = mulberry32(variant * 9173 + 41);
  const { pts: raw, apex, ridgeBottom } = peakOutline(spec, rng);
  const pts = flip ? raw.map(([x, y]) => [2 * MOUNTAIN_AX - x, y] as [number, number]) : raw;
  const apexP: [number, number] = flip ? [2 * MOUNTAIN_AX - apex[0], apex[1]] : apex;
  const rb: [number, number] = flip ? [2 * MOUNTAIN_AX - ridgeBottom[0], ridgeBottom[1]] : ridgeBottom;
  const by = MOUNTAIN_AY;
  const litSide = -1; // light always falls from the left

  softBlob(ctx, MOUNTAIN_AX + 8, by + 3, spec.w * 0.62, 11, css(SHADOW, 1), 0.5);

  // silhouette path with a rounded base
  const silhouette = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    const last = pts[pts.length - 1]!;
    const first = pts[0]!;
    ctx.quadraticCurveTo(MOUNTAIN_AX, by + 13, first[0], first[1]);
    void last;
    ctx.closePath();
  };

  ctx.save();
  silhouette();
  ctx.lineWidth = 2;
  ctx.strokeStyle = css(mixRgb(ROCK.dark, [18, 20, 36], 0.6), 1);
  ctx.stroke();
  ctx.clip();

  // Which face is lit: split by the ridge line apex → ridgeBottom.
  const left = new Path2D();
  const right = new Path2D();
  left.moveTo(apexP[0], apexP[1] - 4);
  left.lineTo(MOUNTAIN_AX - 80, by - 30);
  left.lineTo(MOUNTAIN_AX - 80, by + 20);
  left.lineTo(rb[0], rb[1]);
  left.closePath();
  right.moveTo(apexP[0], apexP[1] - 4);
  right.lineTo(MOUNTAIN_AX + 80, by - 30);
  right.lineTo(MOUNTAIN_AX + 80, by + 20);
  right.lineTo(rb[0], rb[1]);
  right.closePath();
  const litPath = litSide < 0 ? left : right;
  const shadePath = litSide < 0 ? right : left;

  const gLit = ctx.createLinearGradient(apexP[0], apexP[1], MOUNTAIN_AX, by + 6);
  gLit.addColorStop(0, css(mixRgb(ROCK.light, [220, 210, 196], 0.4), 1));
  gLit.addColorStop(0.55, css(ROCK.mid, 1));
  gLit.addColorStop(1, css(mixRgb(ROCK.mid, ROCK.dark, 0.5), 1));
  ctx.fillStyle = gLit;
  ctx.fill(litPath);
  const gSh = ctx.createLinearGradient(apexP[0], apexP[1], MOUNTAIN_AX, by + 6);
  gSh.addColorStop(0, css(mixRgb(ROCK.mid, ROCK.dark, 0.55), 1));
  gSh.addColorStop(1, css(mixRgb(ROCK.dark, [40, 40, 62], 0.5), 1));
  ctx.fillStyle = gSh;
  ctx.fill(shadePath);

  // facets / gullies: darker and lighter wedges running down from near the summit
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const sx = apexP[0] + (t - 0.5) * spec.w * 0.35 + (rng() - 0.5) * 5;
    const sy = apexP[1] + spec.h * (0.18 + rng() * 0.22);
    const ex = MOUNTAIN_AX + (t - 0.5) * spec.w * 1.05;
    const ey = by + 2;
    const wTop = 1 + rng() * 2;
    const wBot = 4 + rng() * 6;
    ctx.beginPath();
    ctx.moveTo(sx - wTop, sy);
    ctx.lineTo(sx + wTop, sy);
    ctx.lineTo(ex + wBot, ey);
    ctx.lineTo(ex - wBot, ey);
    ctx.closePath();
    const darkWedge = (i + (rng() < 0.3 ? 1 : 0)) % 2 === 0;
    ctx.fillStyle = darkWedge ? css(ROCK.dark, 0.2) : css(ROCK.light, 0.13);
    ctx.fill();
  }

  // snow
  if (snow > 0) {
    const frac = snow === 1 ? 0.3 : 0.5;
    const lineY = apexP[1] + spec.h * frac;
    const snowPath = new Path2D();
    snowPath.moveTo(MOUNTAIN_AX - 70, apexP[1] - 6);
    snowPath.lineTo(MOUNTAIN_AX + 70, apexP[1] - 6);
    const steps = 14;
    for (let i = steps; i >= 0; i--) {
      const x = MOUNTAIN_AX - 70 + (i / steps) * 140;
      const dist = Math.abs(x - apexP[0]);
      const zig = (i % 2 === 0 ? 0 : 1) * (4 + rng() * 5) + (rng() - 0.5) * 3;
      // lower snow line near the centre (drips along gullies), higher at the flanks
      snowPath.lineTo(x, lineY + zig - Math.max(0, dist - 12) * 0.62);
    }
    snowPath.closePath();
    ctx.save();
    ctx.clip(snowPath);
    ctx.fillStyle = css(SNOW.light, 1);
    ctx.fill(litPath);
    const sg = ctx.createLinearGradient(apexP[0], apexP[1], MOUNTAIN_AX, lineY + 10);
    sg.addColorStop(0, css(SNOW.mid, 1));
    sg.addColorStop(1, css(SNOW.shade, 1));
    ctx.fillStyle = sg;
    ctx.fill(shadePath);
    // soft blue underside near the snow line on the lit side
    const ug = ctx.createLinearGradient(0, lineY - 12, 0, lineY + 12);
    ug.addColorStop(0, css(SNOW.shade, 0));
    ug.addColorStop(1, css(SNOW.shade, 0.5));
    ctx.fillStyle = ug;
    ctx.fill(litPath);
    ctx.restore();
  }

  // rock grain
  ctx.restore();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const W = canvas.width;
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      if (d[i + 3] === 0) continue;
      const lx = px / TEX_SCALE;
      const ly = py / TEX_SCALE;
      const n = fbm(lx * 0.22 + variant * 7, ly * 0.34, 31, 3) - 0.5;
      const k = 1 + n * 0.34;
      // bottom of the mountain melts into the ground
      const fade = smoothstep(by + 5, by + 12, ly);
      const mix = 1 - fade * 0.4;
      d[i] = clamp(d[i]! * k * mix, 0, 255);
      d[i + 1] = clamp(d[i + 1]! * k * mix, 0, 255);
      d[i + 2] = clamp(d[i + 2]! * k * mix, 0, 255);
      if (fade > 0) d[i + 3] = d[i + 3]! * (1 - fade * 0.85);
    }
  }
  ctx.putImageData(img, 0, 0);
  addGrain(art, 5, variant + 99);
  return art;
}

/** A mined-out mountain: a low heap of broken rock. */
export function makeQuarriedMountain(variant: number): Art {
  const art = createArt(MOUNTAIN_W, MOUNTAIN_H, MOUNTAIN_AX, MOUNTAIN_AY);
  const rng = mulberry32(variant * 77 + 3);
  const slots: [number, number, number, number][] = [
    [-14, -4, 14, 20],
    [12, -2, 12, 16],
    [0, 2, 10, 12],
    [-24, 5, 7, 8],
    [24, 5, 6, 7],
  ];
  for (const [sx, sy, w, h] of slots.sort((a, b) => a[1] - b[1])) {
    boulder(art.ctx, MOUNTAIN_AX + sx, MOUNTAIN_AY + sy, w, h, rng, mixRgb(ROCK.mid, [120, 116, 112], 0.4));
  }
  return art;
}
