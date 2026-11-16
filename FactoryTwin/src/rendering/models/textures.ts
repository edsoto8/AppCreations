import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Procedural CanvasTextures. Everything is drawn locally (no network, no font downloads).
 * Fonts use the generic `sans-serif` family available on every platform.
 */

export const FONT = 'Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif';

/** Small deterministic PRNG (mulberry32) so procedural textures look the same on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return { canvas, ctx };
}

export function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat = false,
): CanvasTexture {
  const { canvas, ctx } = makeCanvas(w, h);
  draw(ctx, w, h);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function once<T>(fn: () => T): () => T {
  let v: T | undefined;
  return () => (v === undefined ? (v = fn()) : v);
}

export interface LabelOptions {
  bg?: string;
  fg?: string;
  border?: string;
  width?: number;
  height?: number;
  /** Font size as a fraction of canvas height. */
  size?: number;
  sub?: string;
  stripe?: string;
}

const labelCache = new Map<string, CanvasTexture>();

/** A painted sign / label. Cached by text + options. */
export function labelTexture(text: string, o: LabelOptions = {}): CanvasTexture {
  const key = JSON.stringify([text, o]);
  const hit = labelCache.get(key);
  if (hit) return hit;
  const w = o.width ?? 512;
  const h = o.height ?? 128;
  const tex = canvasTexture(w, h, (ctx) => {
    if (o.bg) {
      ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, w, h);
    } else ctx.clearRect(0, 0, w, h);
    if (o.stripe) {
      ctx.fillStyle = o.stripe;
      ctx.fillRect(0, h * 0.88, w, h * 0.07);
    }
    if (o.border) {
      ctx.strokeStyle = o.border;
      ctx.lineWidth = Math.max(4, h * 0.05);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    }
    ctx.fillStyle = o.fg ?? '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = Math.round(h * (o.size ?? (o.sub ? 0.44 : 0.6)));
    ctx.font = `bold ${size}px ${FONT}`;
    let s = size;
    while (ctx.measureText(text).width > w * 0.9 && s > 8) {
      s -= 2;
      ctx.font = `bold ${s}px ${FONT}`;
    }
    ctx.fillText(text, w / 2, o.sub ? h * 0.38 : h / 2 + s * 0.04);
    if (o.sub) {
      ctx.font = `${Math.round(h * 0.2)}px ${FONT}`;
      ctx.fillText(o.sub, w / 2, h * 0.7);
    }
  });
  labelCache.set(key, tex);
  return tex;
}

/** Conveyor belt: dark rubber with lighter chevrons pointing +u. One tile = BELT_TILE metres. */
export const BELT_TILE = 0.5;
export const beltTexture = once(() =>
  canvasTexture(
    128,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = '#26292c';
      ctx.fillRect(0, 0, w, h);
      const rnd = seeded(7);
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.03})`;
        ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
      }
      ctx.strokeStyle = '#4a4f55';
      ctx.lineWidth = 7;
      ctx.lineJoin = 'miter';
      for (const x0 of [10, 74]) {
        ctx.beginPath();
        ctx.moveTo(x0, 6);
        ctx.lineTo(x0 + 26, h / 2);
        ctx.lineTo(x0, h - 6);
        ctx.stroke();
      }
    },
    true,
  ),
);

/** Yellow/black hazard stripes along u (use world-space UVs for diagonal stripes). */
export const hazardTexture = once(() =>
  canvasTexture(
    64,
    8,
    (ctx, w, h) => {
      ctx.fillStyle = '#f5c400';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#151515';
      ctx.fillRect(w / 2, 0, w / 2, h);
    },
    true,
  ),
);

/** Wire-mesh panel cell (alpha-tested). One tile = 0.1 m. */
export const wireTexture = once(() => {
  const tex = canvasTexture(
    32,
    32,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, 3);
      ctx.fillRect(0, 0, 3, h);
    },
    true,
  );
  return tex;
});
