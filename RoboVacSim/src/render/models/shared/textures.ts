import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { Disposables } from './Disposables';
import { createRng } from './rng';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Canvas2D {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: Ctx2D;
}

/** Creates a 2D canvas in the browser (DOM canvas, else OffscreenCanvas). Returns null in headless envs. */
export function createCanvas2D(width: number, height: number): Canvas2D | null {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  return null;
}

export type TextureName =
  | 'brushed'
  | 'speckle'
  | 'microfiber'
  | 'fabric'
  | 'dust'
  | 'pcb'
  | 'antislip'
  | 'hatch'
  | 'sprite'
  | 'paper'
  | 'strip'
  | 'grille';

interface TextureSpec {
  /** Size relative to the quality texture size. */
  scale: number;
  color: boolean;
  repeat: [number, number];
  clamp?: boolean;
  draw: (ctx: Ctx2D, w: number, h: number, rnd: () => number) => void;
}

function noisePixels(ctx: Ctx2D, w: number, h: number, fn: (x: number, y: number) => number): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, fn(x, y)));
      const i = (y * w + x) * 4;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const SPECS: Record<TextureName, TextureSpec> = {
  /** Brushed / machined metal roughness: fine streaks along U. */
  brushed: {
    scale: 1, color: false, repeat: [1, 3],
    draw(ctx, w, h, rnd) {
      const rows = new Float32Array(h);
      for (let y = 0; y < h; y++) rows[y] = rnd();
      const cols = new Float32Array(w);
      for (let x = 0; x < w; x++) cols[x] = rnd();
      noisePixels(ctx, w, h, (x, y) => {
        const streak = rows[y] * 0.7 + rows[(y + 1) % h] * 0.3;
        const along = Math.sin((x / w) * Math.PI * 2 * (3 + rows[y] * 5)) * 0.08;
        return 168 + streak * 70 + along * 60 + (cols[x] - 0.5) * 10 + (rnd() - 0.5) * 18;
      });
    },
  },
  /** Fine moulded-plastic grain for roughness variation. */
  speckle: {
    scale: 0.5, color: false, repeat: [6, 6],
    draw(ctx, w, h, rnd) {
      noisePixels(ctx, w, h, () => 222 + (rnd() - 0.5) * 46);
    },
  },
  /** Microfiber mop pad: quilted concentric stitching on soft pile. */
  microfiber: {
    scale: 1, color: true, repeat: [1, 1], clamp: true,
    draw(ctx, w, h, rnd) {
      const cx = w / 2;
      const cy = h / 2;
      noisePixels(ctx, w, h, (x, y) => {
        const r = Math.hypot(x - cx, y - cy) / (w / 2);
        const a = Math.atan2(y - cy, x - cx);
        const quilt = Math.abs(Math.sin(r * Math.PI * 7 + a * 0.5));
        const stitch = quilt < 0.08 ? -46 : 0;
        const rib = Math.sin(a * 24) * Math.exp(-Math.pow((r - 0.45) * 8, 2)) * 10;
        return 214 + (rnd() - 0.5) * 34 + stitch + rib - (r > 0.94 ? 40 : 0);
      });
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(176, 196, 214, 1)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  /** Non-woven filter bag fabric. */
  fabric: {
    scale: 0.5, color: true, repeat: [2, 2],
    draw(ctx, w, h, rnd) {
      ctx.fillStyle = '#e9e3d4';
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 0.6;
      for (let i = 0; i < w * 6; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const a = rnd() * Math.PI;
        const l = 3 + rnd() * 10;
        ctx.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(150,140,120,0.25)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
    },
  },
  /** Collected dust / debris. */
  dust: {
    scale: 0.5, color: true, repeat: [2, 2],
    draw(ctx, w, h, rnd) {
      ctx.fillStyle = '#7a7268';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < w * 3; i++) {
        const shade = 70 + rnd() * 110;
        ctx.fillStyle = `rgba(${shade + 10},${shade},${shade - 12},${0.25 + rnd() * 0.5})`;
        const r = 0.5 + rnd() * 2.5;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(40,36,30,0.5)';
      for (let i = 0; i < w / 4; i++) {
        ctx.beginPath();
        const x = rnd() * w;
        const y = rnd() * h;
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + rnd() * 20, y + rnd() * 20, x - rnd() * 20, y + rnd() * 30, x + rnd() * 30, y + rnd() * 30);
        ctx.stroke();
      }
    },
  },
  /** Black solder-mask PCB with gold traces, pads and silkscreen. */
  pcb: {
    scale: 1, color: true, repeat: [7, 7],
    draw(ctx, w, h, rnd) {
      ctx.fillStyle = '#0d1311';
      ctx.fillRect(0, 0, w, h);
      const g = w / 64;
      for (let i = 0; i < 140; i++) {
        ctx.strokeStyle = rnd() > 0.25 ? 'rgba(150,120,60,0.55)' : 'rgba(60,90,80,0.6)';
        ctx.lineWidth = Math.max(1, g * (0.25 + rnd() * 0.4));
        let x = Math.round(rnd() * 64) * g;
        let y = Math.round(rnd() * 64) * g;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
          const dir = Math.floor(rnd() * 4);
          const len = (2 + Math.floor(rnd() * 10)) * g;
          if (dir === 0) x += len;
          else if (dir === 1) y += len;
          else if (dir === 2) { x += len; y += len; }
          else { x -= len; y += len; }
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(200,170,90,0.9)';
        ctx.beginPath();
        ctx.arc(x, y, g * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(210,180,100,0.85)';
      for (let i = 0; i < 60; i++) {
        ctx.fillRect(Math.round(rnd() * 60) * g, Math.round(rnd() * 60) * g, g * (0.6 + rnd()), g * 0.6);
      }
      ctx.strokeStyle = 'rgba(230,230,225,0.65)';
      ctx.lineWidth = Math.max(1, g * 0.15);
      for (let i = 0; i < 14; i++) {
        ctx.strokeRect(Math.round(rnd() * 56) * g, Math.round(rnd() * 56) * g, (3 + rnd() * 6) * g, (2 + rnd() * 5) * g);
      }
    },
  },
  /** Anti-slip diamond texture for the dock floor. */
  antislip: {
    scale: 0.5, color: false, repeat: [24, 24],
    draw(ctx, w, h) {
      noisePixels(ctx, w, h, (x, y) => {
        const u = (x / w) * 4;
        const v = (y / h) * 4;
        const fu = u - Math.floor(u) - 0.5;
        const fv = v - Math.floor(v) - 0.5;
        const d = Math.abs(fu) + Math.abs(fv);
        return d < 0.28 ? 235 : d < 0.34 ? 150 : 90;
      });
    },
  },
  /** Section-cut hatch for cutaway caps. */
  hatch: {
    scale: 0.25, color: true, repeat: [8, 8],
    draw(ctx, w, h) {
      ctx.fillStyle = '#3a0f0c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e2523d';
      ctx.lineWidth = w / 10;
      for (let i = -w; i < w * 2; i += w / 3) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.stroke();
      }
    },
  },
  /** Soft round particle sprite. */
  sprite: {
    scale: 0, color: true, repeat: [1, 1], clamp: true,
    draw(ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  /** HEPA filter media. */
  paper: {
    scale: 0.5, color: true, repeat: [1, 3],
    draw(ctx, w, h, rnd) {
      noisePixels(ctx, w, h, (x) => 226 + (rnd() - 0.5) * 30 + Math.sin(x * 0.7) * 4);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(246, 240, 222)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  /** Light-strip emissive profile: bright core with slow travelling waves (scrolled for flow phases). */
  strip: {
    scale: 0.5, color: true, repeat: [2, 1],
    draw(ctx, w, h) {
      for (let x = 0; x < w; x++) {
        const v = 0.62 + 0.38 * Math.pow(0.5 + 0.5 * Math.sin((x / w) * Math.PI * 6), 3);
        const c = Math.round(v * 255);
        ctx.fillStyle = `rgb(${c},${c},${c})`;
        ctx.fillRect(x, 0, 1, h);
      }
    },
  },
  /** Perforated speaker/vent grille alpha (white = solid). */
  grille: {
    scale: 0.25, color: false, repeat: [10, 4],
    draw(ctx, w, h) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#000000';
      const n = 4;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          ctx.beginPath();
          ctx.arc(((i + 0.5 + (j % 2) * 0.5) / n) * w, ((j + 0.5) / n) * h, (w / n) * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
};

/** Lazily generated, cached procedural textures for one model instance. */
export class TextureLibrary {
  private readonly cache = new Map<TextureName, Texture>();

  constructor(
    private readonly size: number,
    private readonly track: Disposables,
  ) {}

  get(name: TextureName): Texture {
    const hit = this.cache.get(name);
    if (hit) return hit;
    const spec = SPECS[name];
    const px = spec.scale === 0 ? 64 : Math.max(32, Math.round(this.size * spec.scale));
    const c = createCanvas2D(px, px);
    let tex: Texture;
    if (c) {
      spec.draw(c.ctx, px, px, createRng(name.length * 7919 + px));
      tex = new CanvasTexture(c.canvas);
    } else {
      const data = new Uint8Array([200, 200, 200, 255]);
      tex = new DataTexture(data, 1, 1);
    }
    tex.name = name;
    if (spec.color) tex.colorSpace = SRGBColorSpace;
    const wrap = spec.clamp ? ClampToEdgeWrapping : RepeatWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.repeat.set(spec.repeat[0], spec.repeat[1]);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.track.track(tex);
    this.cache.set(name, tex);
    return tex;
  }
}
