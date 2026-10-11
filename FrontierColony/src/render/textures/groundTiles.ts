/** Procedural flat tile tops (the 64×32 diamonds) for every terrain, plus feathered edge overlays. */
import { addGrain, clipTileDiamond, createArt, paintTilePixels, TILE_CX, TILE_CY, TILE_FRAME_H, TILE_FRAME_W, TILE_HH, TILE_HW, type Art } from './canvas';
import { css, mixRgb, type RGB } from '../util/color';
import { fbm, mulberry32, smoothstep, valueNoise } from '../util/noise';
import {
  FLOWER_COLORS,
  FOREST_FLOOR,
  GRASS,
  GRASS_BLADE_DARK,
  GRASS_BLADE_LIGHT,
  HILL_GROUND,
  ROCK_GROUND,
  SAND,
  SAND_RIPPLE,
  type Ramp,
} from './palette';

export type EdgeDir = 'ne' | 'se' | 'sw' | 'nw';
export const EDGE_DIRS: readonly EdgeDir[] = ['ne', 'se', 'sw', 'nw'];

function rampColor(r: Ramp, t: number, out: [number, number, number, number]): void {
  const c = t < 0.5 ? mixRgb(r.dark, r.mid, t * 2) : mixRgb(r.mid, r.light, (t - 0.5) * 2);
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
}

interface BaseOpts {
  seed: number;
  ramp: Ramp;
  /** Noise frequency (per logical px). */
  freq?: number;
  contrast?: number;
  grain?: number;
  bias?: number;
}

/** Paints the soft colour-blotch ground of a tile. Contrast fades towards the border so tiles blend. */
function paintBase(art: Art, o: BaseOpts): void {
  const freq = o.freq ?? 0.07;
  const contrast = o.contrast ?? 1.5;
  const grain = o.grain ?? 0.05;
  const bias = o.bias ?? 0;
  paintTilePixels(art, (p, out) => {
    const n = fbm(p.lx * freq, p.ly * freq * 1.9, o.seed, 3);
    const fade = 1 - smoothstep(0.55, 1.0, p.d) * 0.75;
    let t = (n - 0.5) * contrast * fade + 0.5 + bias;
    const g = valueNoise(p.lx * 0.9, p.ly * 1.4, o.seed + 77);
    t += (g - 0.5) * grain;
    t = Math.min(1, Math.max(0, t));
    rampColor(o.ramp, t, out);
  });
}

function randInDiamond(rng: () => number, margin = 0.9): [number, number] {
  for (let i = 0; i < 12; i++) {
    const nx = rng() * 2 - 1;
    const ny = rng() * 2 - 1;
    if (Math.abs(nx) + Math.abs(ny) <= margin) return [TILE_CX + nx * TILE_HW, TILE_CY + ny * TILE_HH];
  }
  return [TILE_CX, TILE_CY];
}

function blade(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, lean: number, color: string, w: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + lean * 0.3, y - len * 0.6, x + lean, y - len);
  ctx.stroke();
}

function scatterBlades(art: Art, rng: () => number, count: number, dark: RGB, light: RGB, len = 3.2): void {
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  for (let i = 0; i < count; i++) {
    const [x, y] = randInDiamond(rng, 0.97);
    const l = len * (0.6 + rng() * 0.8);
    const lean = (rng() - 0.5) * 2.4;
    const isLight = rng() < 0.45;
    blade(ctx, x, y, l, lean, css(isLight ? light : dark, isLight ? 0.55 : 0.5), 0.8 + rng() * 0.5);
  }
  ctx.restore();
}

function dappled(art: Art, rng: () => number, count: number, color: RGB, alpha: number): void {
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  for (let i = 0; i < count; i++) {
    const [x, y] = randInDiamond(rng, 0.8);
    const r = 3 + rng() * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(color, alpha));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.5);
    ctx.translate(-x, -y);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, color: RGB, size: number): void {
  ctx.fillStyle = css([40, 70, 40], 0.35);
  ctx.beginPath();
  ctx.ellipse(x + 0.5, y + 0.9, size * 0.9, size * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(color, 1);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * size * 0.7, y + Math.sin(a) * size * 0.45 - 0.4, size * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = css([252, 214, 90], 1);
  ctx.beginPath();
  ctx.arc(x, y - 0.4, size * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function tuftShape(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, rng: () => number): void {
  ctx.fillStyle = css([30, 60, 36], 0.22);
  ctx.beginPath();
  ctx.ellipse(x + 0.6, y + 0.6, 3.4 * scale, 1.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  const blades = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < blades; i++) {
    const t = i / (blades - 1) - 0.5;
    const len = (4.5 + rng() * 2.5) * scale;
    const light = i % 2 === 0;
    blade(ctx, x + t * 2.2 * scale, y, len, t * 5 * scale, css(light ? [150, 200, 100] : [74, 128, 64], 1), 1.0);
  }
}

// --- Grass --------------------------------------------------------------------------------------

export interface GrassOpts {
  flowers?: 0 | 1 | 2;
  tufts?: number;
  dry?: boolean;
}

export function makeGrassTile(seed: number, o: GrassOpts = {}): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  const rng = mulberry32(seed * 7919 + 13);
  const ramp: Ramp = o.dry
    ? { dark: [128, 160, 80], mid: [160, 188, 92], light: [188, 208, 108] }
    : GRASS;
  paintBase(art, { seed, ramp, freq: 0.06, contrast: 1.7 });
  dappled(art, rng, 4, [196, 226, 130], 0.18);
  dappled(art, rng, 3, [60, 110, 70], 0.16);
  scatterBlades(art, rng, 70, GRASS_BLADE_DARK, GRASS_BLADE_LIGHT);
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  for (let i = 0; i < (o.tufts ?? 0); i++) {
    const [x, y] = randInDiamond(rng, 0.8);
    tuftShape(ctx, x, y, 0.8 + rng() * 0.5, rng);
  }
  if (o.flowers) {
    const n = o.flowers === 2 ? 9 : 4;
    const main = FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]!;
    for (let i = 0; i < n; i++) {
      const [x, y] = randInDiamond(rng, 0.78);
      const c = rng() < 0.7 ? main : FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]!;
      flower(ctx, x, y, c, 0.9 + rng() * 0.4);
    }
  }
  ctx.restore();
  addGrain(art, 5, seed);
  return art;
}

export function makeForestFloor(seed: number): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  const rng = mulberry32(seed * 6151 + 5);
  paintBase(art, { seed: seed + 900, ramp: FOREST_FLOOR, freq: 0.07, contrast: 1.6 });
  dappled(art, rng, 5, [24, 50, 40], 0.22);
  dappled(art, rng, 3, [150, 190, 100], 0.12);
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  // leaf litter
  for (let i = 0; i < 26; i++) {
    const [x, y] = randInDiamond(rng, 0.95);
    ctx.fillStyle = css(rng() < 0.5 ? [128, 98, 60] : [152, 122, 70], 0.55);
    ctx.beginPath();
    ctx.ellipse(x, y, 0.9 + rng() * 0.9, 0.5 + rng() * 0.4, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  scatterBlades(art, rng, 38, [44, 86, 54], [120, 170, 96], 2.8);
  addGrain(art, 5, seed + 3);
  return art;
}

// --- Sand ---------------------------------------------------------------------------------------

export function makeSandTile(seed: number, o: { rippled?: boolean; pebbles?: boolean } = {}): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  const rng = mulberry32(seed * 4421 + 9);
  paintBase(art, { seed: seed + 300, ramp: SAND, freq: 0.05, contrast: 1.3, grain: 0.1 });
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  if (o.rippled !== false) {
    // Wind ripples: faint curved lines following the tile's x-axis.
    const lines = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < lines; i++) {
      const [x, y] = randInDiamond(rng, 0.7);
      const len = 8 + rng() * 10;
      ctx.strokeStyle = css(SAND_RIPPLE, 0.3);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x - len / 2, y + len / 4);
      ctx.bezierCurveTo(x - len / 4, y + len / 4 - 2, x + len / 4, y - len / 4 + 2, x + len / 2, y - len / 4);
      ctx.stroke();
      ctx.strokeStyle = css([255, 248, 220], 0.35);
      ctx.beginPath();
      ctx.moveTo(x - len / 2, y + len / 4 - 1.2);
      ctx.bezierCurveTo(x - len / 4, y + len / 4 - 3.2, x + len / 4, y - len / 4 + 0.8, x + len / 2, y - len / 4 - 1.2);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 40; i++) {
    const [x, y] = randInDiamond(rng, 0.95);
    ctx.fillStyle = css(rng() < 0.5 ? [186, 160, 112] : [252, 244, 214], 0.5);
    ctx.fillRect(x, y, 0.8, 0.8);
  }
  if (o.pebbles) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = randInDiamond(rng, 0.75);
      ctx.fillStyle = css([90, 78, 60], 0.28);
      ctx.beginPath();
      ctx.ellipse(x + 0.7, y + 0.8, 2, 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css([186, 176, 156], 1);
      ctx.beginPath();
      ctx.ellipse(x, y, 1.8, 1.1, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css([222, 214, 196], 0.9);
      ctx.beginPath();
      ctx.ellipse(x - 0.4, y - 0.3, 0.9, 0.5, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  addGrain(art, 6, seed + 11);
  return art;
}

// --- Hills / rock -------------------------------------------------------------------------------

/** Grassy, dry-grass rolling hill ground with the odd bare rock patch. */
export function makeHillsGround(seed: number): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  const rng = mulberry32(seed * 3571 + 21);
  const rockiness = 0.1 + (seed % 4) * 0.07;
  const dryRamp: Ramp = { dark: [118, 144, 78], mid: [150, 166, 90], light: [182, 188, 108] };
  paintTilePixels(art, (p, out) => {
    const n = fbm(p.lx * 0.055, p.ly * 0.1, seed + 500, 3);
    const m = fbm(p.lx * 0.1 + 9, p.ly * 0.18, seed + 640, 3);
    const fade = 1 - smoothstep(0.55, 1.0, p.d) * 0.7;
    rampColor(dryRamp, Math.min(1, Math.max(0, (n - 0.5) * 1.8 * fade + 0.5)), out);
    const rock = smoothstep(0.62 - rockiness, 0.72 - rockiness, m) * fade;
    if (rock > 0) {
      const g = valueNoise(p.lx * 0.9, p.ly * 1.4, seed + 77);
      const rc: RGB = [128 + g * 40, 120 + g * 36, 104 + g * 30];
      out[0] = out[0] * (1 - rock) + rc[0] * rock;
      out[1] = out[1] * (1 - rock) + rc[1] * rock;
      out[2] = out[2] * (1 - rock) + rc[2] * rock;
    }
  });
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  for (let i = 0; i < 9; i++) {
    const [x, y] = randInDiamond(rng, 0.9);
    ctx.fillStyle = css(rng() < 0.5 ? [96, 86, 72] : [196, 186, 164], 0.5);
    ctx.beginPath();
    ctx.ellipse(x, y, 0.8 + rng() * 1.2, 0.5 + rng() * 0.6, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  scatterBlades(art, rng, 46, [96, 120, 60], [190, 200, 120], 3);
  addGrain(art, 6, seed + 17);
  return art;
}

export function makeRockGround(seed: number): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  const rng = mulberry32(seed * 2713 + 33);
  paintBase(art, { seed: seed + 700, ramp: ROCK_GROUND, freq: 0.09, contrast: 1.8, grain: 0.16 });
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  for (let i = 0; i < 5; i++) {
    const [x, y] = randInDiamond(rng, 0.8);
    ctx.strokeStyle = css([60, 58, 62], 0.35);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 9, y + (rng() - 0.5) * 4);
    ctx.lineTo(x + (rng() - 0.5) * 12, y + (rng() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.restore();
  addGrain(art, 8, seed + 19);
  return art;
}

// --- Water --------------------------------------------------------------------------------------

/** Near-white water texture, tinted per tile with the depth colour. */
export function makeWaterTile(seed: number): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  const rng = mulberry32(seed * 977 + 3);
  paintTilePixels(art, (p, out) => {
    const n = fbm(p.lx * 0.045, p.ly * 0.1, seed + 40, 3);
    const w = valueNoise(p.lx * 0.16 + Math.sin(p.ly * 0.35) * 0.9, p.ly * 0.55, seed + 90);
    const v = 236 + (n - 0.5) * 6 + (w > 0.66 ? (w - 0.66) * 30 : 0) - (w < 0.3 ? (0.3 - w) * 20 : 0);
    out[0] = v;
    out[1] = v + 2;
    out[2] = v + 4;
  });
  const { ctx } = art;
  ctx.save();
  clipTileDiamond(ctx);
  for (let i = 0; i < 4; i++) {
    const [x, y] = randInDiamond(rng, 0.7);
    const len = 6 + rng() * 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y);
    ctx.quadraticCurveTo(x, y - 1.6, x + len / 2, y);
    ctx.stroke();
  }
  ctx.restore();
  return art;
}

// --- Edge overlays ------------------------------------------------------------------------------

/** Inward distance (0 at the edge, up to ~2 at the opposite vertex) for a given diamond edge. */
function edgeDistance(dir: EdgeDir, nx: number, ny: number): number {
  switch (dir) {
    case 'ne':
      return 1 - (nx - ny);
    case 'se':
      return 1 - (nx + ny);
    case 'sw':
      return 1 - (ny - nx);
    case 'nw':
      return 1 + nx + ny;
  }
}

/** Position along the edge (for wobble noise). */
function edgeAlong(dir: EdgeDir, nx: number, ny: number): number {
  return dir === 'ne' || dir === 'sw' ? nx + ny : nx - ny;
}

export type FringeMaterial = 'grass' | 'sand' | 'forest' | 'hills' | 'rock';

const FRINGE_RAMPS: Record<FringeMaterial, Ramp> = {
  grass: GRASS,
  sand: SAND,
  forest: FOREST_FLOOR,
  hills: HILL_GROUND,
  rock: ROCK_GROUND,
};

/** A feathered, noisy band of `material` hugging one edge of the tile, to blend into a neighbour. */
export function makeFringe(material: FringeMaterial, dir: EdgeDir, seed: number): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  const ramp = FRINGE_RAMPS[material];
  const baseWidth = material === 'sand' ? 0.34 : material === 'grass' ? 0.3 : 0.26;
  paintTilePixels(art, (p, out) => {
    const e = edgeDistance(dir, p.nx, p.ny);
    const along = edgeAlong(dir, p.nx, p.ny);
    const wob = (valueNoise(along * 5.5 + 11, e * 1.5, seed) - 0.5) * 0.3 + (fbm(p.lx * 0.4, p.ly * 0.7, seed + 5, 2) - 0.5) * 0.22;
    const width = baseWidth + wob;
    const a = 1 - smoothstep(width * 0.35, width, e);
    if (a <= 0.003) {
      out[3] = 0;
      return;
    }
    const n = fbm(p.lx * 0.06, p.ly * 0.11, seed + 900, 3);
    rampColor(ramp, Math.min(1, Math.max(0, (n - 0.5) * 1.5 * (1 - smoothstep(0.55, 1, p.d) * 0.75) + 0.5)), out);
    out[3] = a;
  });
  addGrain(art, 4, seed + 31);
  return art;
}

/** Dark damp band for land tiles that touch water. */
export function makeWetEdge(dir: EdgeDir, seed: number): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  paintTilePixels(art, (p, out) => {
    const e = edgeDistance(dir, p.nx, p.ny);
    const along = edgeAlong(dir, p.nx, p.ny);
    const wob = (valueNoise(along * 6 + 3, e * 1.5, seed) - 0.5) * 0.2;
    const a = (1 - smoothstep(0.02, 0.34 + wob, e)) * 0.3;
    out[0] = 46;
    out[1] = 62;
    out[2] = 66;
    out[3] = a;
  });
  return art;
}

/** Foam band on water tiles next to land: bright thin line plus a soft wash. */
export function makeFoamEdge(dir: EdgeDir, seed: number): Art {
  const art = createArt(TILE_FRAME_W, TILE_FRAME_H);
  paintTilePixels(art, (p, out) => {
    const e = edgeDistance(dir, p.nx, p.ny);
    const along = edgeAlong(dir, p.nx, p.ny);
    const wob = (valueNoise(along * 7 + 5, e * 2, seed) - 0.5) * 0.16;
    const line = Math.exp(-Math.pow((e - (0.1 + wob)) / 0.045, 2));
    const wash = 1 - smoothstep(0.0, 0.34 + wob * 1.5, e);
    const breakup = smoothstep(0.25, 0.65, valueNoise(along * 9 + 40, 0.5, seed + 7));
    const a = Math.min(1, line * (0.55 + breakup * 0.45) * 0.95 + wash * 0.34);
    out[0] = 250;
    out[1] = 254;
    out[2] = 255;
    out[3] = a;
  });
  return art;
}

export { TILE_FRAME_H, TILE_FRAME_W, TILE_HH, TILE_HW };

/** Lay a blanket of snow over an existing ground tile texture (patchy, with the ground showing through). */
export function applySnow(art: Art, seed: number, cover = 0.9): Art {
  const { canvas, ctx } = art;
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      if (d[i + 3] === 0) continue;
      const lx = (px + 0.5) / 2;
      const ly = (py + 0.5) / 2;
      const n = fbm(lx * 0.09, ly * 0.16, seed, 3) * 0.7 + valueNoise(lx * 0.7, ly * 1.1, seed + 3) * 0.3;
      const a = smoothstep(1 - cover - 0.1, 1 - cover + 0.12, n) * 0.96;
      if (a <= 0) continue;
      const shade = 0.93 + (valueNoise(lx * 0.4, ly * 0.7, seed + 8) - 0.5) * 0.14;
      const r = 244 * shade;
      const g = 248 * shade;
      const b = 255 * shade;
      d[i] = d[i]! * (1 - a) + r * a;
      d[i + 1] = d[i + 1]! * (1 - a) + g * a;
      d[i + 2] = d[i + 2]! * (1 - a) + b * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return art;
}
