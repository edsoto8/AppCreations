/**
 * Canvas-2D helpers used to synthesise every texture in the game. Art is authored in *logical*
 * pixels (a tile diamond is 64×32) and rasterised at TEX_SCALE× so zooming in stays crisp and
 * zooming out can be mip-mapped smoothly.
 */
import { clamp } from '../util/noise';

export const TEX_SCALE = 2;

export interface Art {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Logical size. */
  w: number;
  h: number;
  /** Anchor in logical pixels (where the sprite's world position sits inside the art). */
  ax: number;
  ay: number;
}

export function createArt(w: number, h: number, ax = w / 2, ay = h / 2): Art {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * TEX_SCALE);
  canvas.height = Math.ceil(h * TEX_SCALE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.scale(TEX_SCALE, TEX_SCALE);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { canvas, ctx, w, h, ax, ay };
}

/** Tile art frame (logical): 64×32 diamond plus a little bleed on each side. */
export const TILE_FRAME_W = 70;
export const TILE_FRAME_H = 36;
export const TILE_CX = TILE_FRAME_W / 2;
export const TILE_CY = TILE_FRAME_H / 2;
/** Half sizes of the true tile diamond. */
export const TILE_HW = 32;
export const TILE_HH = 16;
/** The painted diamond is inflated slightly so neighbouring tiles overlap and leave no hairline gaps. */
export const BLEED = 1.5;

export function diamondPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

/** Clip drawing to the (inflated) tile diamond. Call inside ctx.save()/restore(). */
export function clipTileDiamond(ctx: CanvasRenderingContext2D, inflate = BLEED): void {
  diamondPath(ctx, TILE_CX, TILE_CY, TILE_HW + inflate * 2, TILE_HH + inflate);
  ctx.clip();
}

export interface PixelInfo {
  /** Logical coordinates inside the art. */
  lx: number;
  ly: number;
  /** Device pixel coordinates. */
  px: number;
  py: number;
  /** Diamond metric: 0 at the centre, 1 on the true tile border. */
  d: number;
  /** Normalised offsets from the centre (-1..1 across the diamond). */
  nx: number;
  ny: number;
}

/**
 * Fill the tile diamond pixel by pixel. `fn` writes r,g,b (0..255) into `out`, and may set out[3]
 * (alpha 0..1, default 1). Edge pixels are anti-aliased by coverage.
 */
export function paintTilePixels(art: Art, fn: (p: PixelInfo, out: [number, number, number, number]) => void): void {
  const { canvas, ctx } = art;
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const out: [number, number, number, number] = [0, 0, 0, 1];
  const hw = TILE_HW + BLEED * 2;
  const hh = TILE_HH + BLEED;
  const info: PixelInfo = { lx: 0, ly: 0, px: 0, py: 0, d: 0, nx: 0, ny: 0 };
  for (let py = 0; py < H; py++) {
    const ly = (py + 0.5) / TEX_SCALE;
    const ny = (ly - TILE_CY) / TILE_HH;
    for (let px = 0; px < W; px++) {
      const lx = (px + 0.5) / TEX_SCALE;
      const nx = (lx - TILE_CX) / TILE_HW;
      const dInfl = Math.abs(lx - TILE_CX) / hw + Math.abs(ly - TILE_CY) / hh;
      if (dInfl > 1.04) continue;
      // coverage across the border (≈1px wide ramp)
      const cover = clamp((1 - dInfl) * hh * TEX_SCALE + 0.5, 0, 1);
      if (cover <= 0) continue;
      info.lx = lx;
      info.ly = ly;
      info.px = px;
      info.py = py;
      info.nx = nx;
      info.ny = ny;
      info.d = Math.abs(nx) + Math.abs(ny);
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      fn(info, out);
      const i = (py * W + px) * 4;
      data[i] = clamp(out[0], 0, 255);
      data[i + 1] = clamp(out[1], 0, 255);
      data[i + 2] = clamp(out[2], 0, 255);
      data[i + 3] = clamp(out[3] * cover * 255, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Radial-gradient soft blob (used for shadows and glows). */
export function softBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  innerAlpha = 1,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, color.replace(/[\d.]+\)$/, `${innerAlpha})`));
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Adds a faint per-pixel brightness grain to everything already drawn (keeps alpha). */
export function addGrain(art: Art, amount: number, seed: number): void {
  const { canvas, ctx } = art;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let s = seed >>> 0 || 1;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const n = ((s >>> 8) / 16777216 - 0.5) * amount;
    d[i] = clamp(d[i]! + n, 0, 255);
    d[i + 1] = clamp(d[i + 1]! + n, 0, 255);
    d[i + 2] = clamp(d[i + 2]! + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}
