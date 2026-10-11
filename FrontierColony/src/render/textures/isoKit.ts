/**
 * Canvas isometric kit used to bake building art. Surfaces (walls, roof slopes, tops) are drawn in
 * their own flat 2D space and mapped onto the iso parallelogram with an affine transform, so planks,
 * shingles, windows and doors come out correctly skewed without any per-pixel work.
 */
import { createArt, type Art } from './canvas';
import { css, mixRgb, shadeRgb, type RGB } from '../util/color';
import { mulberry32 } from '../util/noise';

export interface Pt {
  x: number;
  y: number;
}

export class Kit {
  readonly art: Art;
  readonly ctx: CanvasRenderingContext2D;
  readonly ax: number;
  readonly ay: number;
  /** Winter variant: roofs and tops get a blanket of snow. */
  snow = false;

  /** w × h footprint in tiles; maxH = tallest point in px above the ground. */
  constructor(w: number, h: number, maxH: number, pad = 12) {
    const W = (w + h) * 32 + pad * 2;
    const H = (w + h) * 16 + maxH + pad * 2 + 8;
    this.ax = W / 2;
    this.ay = pad + maxH + (w + h) * 8;
    this.art = createArt(W, H, this.ax, this.ay);
    this.ctx = this.art.ctx;
  }

  /** Local (u, v tiles; hh px) → canvas. */
  P(u: number, v: number, hh: number): Pt {
    return { x: this.ax + (u - v) * 32, y: this.ay + (u + v) * 16 - hh };
  }

  poly(pts: Pt[]): void {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    c.closePath();
  }

  /**
   * Draw inside a parallelogram. `o` is the origin corner, `a` the edge vector for local +x and `b`
   * for local +y. Local units are pixels along each edge (w = |a|, h = |b|). Content is clipped to it.
   */
  surface(o: Pt, a: Pt, b: Pt, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, outline = 0.5): void {
    const c = this.ctx;
    const w = Math.hypot(a.x, a.y);
    const h = Math.hypot(b.x, b.y);
    c.save();
    this.poly([o, { x: o.x + a.x, y: o.y + a.y }, { x: o.x + a.x + b.x, y: o.y + a.y + b.y }, { x: o.x + b.x, y: o.y + b.y }]);
    c.clip();
    c.transform(a.x / w, a.y / w, b.x / h, b.y / h, o.x, o.y);
    draw(c, w, h);
    c.restore();
    if (outline > 0) {
      this.poly([o, { x: o.x + a.x, y: o.y + a.y }, { x: o.x + a.x + b.x, y: o.y + a.y + b.y }, { x: o.x + b.x, y: o.y + b.y }]);
      c.lineWidth = 0.9;
      c.strokeStyle = css([30, 22, 26], outline);
      c.stroke();
    }
  }

  /** Wall on the +v side (faces screen lower-left): u in [u0,u1], heights [h0,h1]. */
  wallLeft(u0: number, u1: number, v: number, h0: number, h1: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, outline = 0.5): void {
    const o = this.P(u0, v, h1);
    const e = this.P(u1, v, h1);
    this.surface(o, { x: e.x - o.x, y: e.y - o.y }, { x: 0, y: h1 - h0 }, draw, outline);
  }

  /** Wall on the +u side (faces screen lower-right): v in [v0,v1]. Local x runs towards screen right. */
  wallRight(u: number, v0: number, v1: number, h0: number, h1: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, outline = 0.5): void {
    const o = this.P(u, v1, h1);
    const e = this.P(u, v0, h1);
    this.surface(o, { x: e.x - o.x, y: e.y - o.y }, { x: 0, y: h1 - h0 }, draw, outline);
  }

  /** Horizontal top face. Local x along +u, local y along +v. */
  top(u0: number, u1: number, v0: number, v1: number, hh: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, outline = 0.5): void {
    const o = this.P(u0, v0, hh);
    const a = this.P(u1, v0, hh);
    const b = this.P(u0, v1, hh);
    this.surface(o, { x: a.x - o.x, y: a.y - o.y }, { x: b.x - o.x, y: b.y - o.y }, draw, outline);
  }

  /** Soft contact shadow below the footprint (blurred, so it never reads as a hard-edged box). */
  groundShadow(u0: number, u1: number, v0: number, v1: number, alpha = 0.3): void {
    const c = this.ctx;
    c.save();
    // draw the shape far off-canvas and let its blurred shadow land on the art
    const off = 4000;
    c.shadowColor = css([24, 30, 52], Math.min(1, alpha * 0.55));
    c.shadowBlur = 9 * 2;
    c.shadowOffsetX = off * 2;
    c.shadowOffsetY = 0;
    const pts = [this.P(u0 - 0.1, v0 - 0.1, 0), this.P(u1 + 0.22, v0 - 0.1, 0), this.P(u1 + 0.22, v1 + 0.22, 0), this.P(u0 - 0.1, v1 + 0.22, 0)].map((p) => ({ x: p.x - off, y: p.y }));
    this.poly(pts);
    c.fillStyle = '#000';
    c.fill();
    c.restore();
  }

  /** Axis-aligned prism with per-face painters. */
  box(
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    h0: number,
    h1: number,
    paint: { left: (c: CanvasRenderingContext2D, w: number, h: number) => void; right: (c: CanvasRenderingContext2D, w: number, h: number) => void; top: (c: CanvasRenderingContext2D, w: number, h: number) => void },
    outline = 0.5,
  ): void {
    this.wallLeft(u0, u1, v1, h0, h1, paint.left, outline);
    this.wallRight(u1, v0, v1, h0, h1, paint.right, outline);
    this.top(u0, u1, v0, v1, h1, paint.top, outline);
  }
}

// --- Painters (local flat space) ----------------------------------------------------------------

export function solid(color: RGB, shade = 1, grad = 0.14): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const top = shadeRgb(color, shade * (1 + grad * 0.5));
    const bot = shadeRgb(color, shade * (1 - grad));
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(top, 1));
    g.addColorStop(1, css(bot, 1));
    c.fillStyle = g;
    c.fillRect(-1, -1, w + 2, h + 2);
  };
}

export function compose(...fns: ((c: CanvasRenderingContext2D, w: number, h: number) => void)[]): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    for (const f of fns) f(c, w, h);
  };
}

/** Vertical plank lines. */
export function planks(n: number, dark = 0.2, seed = 1): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const rng = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w;
      c.fillStyle = css([0, 0, 0], rng() * 0.07);
      c.fillRect(x0, 0, w / n, h);
      c.fillStyle = css([0, 0, 0], dark);
      c.fillRect(x0, 0, 0.7, h);
      c.fillStyle = css([255, 240, 210], 0.1);
      c.fillRect(x0 + 0.8, 0, 0.5, h);
    }
    // knots
    for (let i = 0; i < n * 0.8; i++) {
      c.fillStyle = css([0, 0, 0], 0.14);
      c.beginPath();
      c.ellipse(rng() * w, rng() * h, 0.9, 1.5, 0, 0, Math.PI * 2);
      c.fill();
    }
  };
}

/** Horizontal clapboard / log courses. */
export function courses(rowH: number, dark = 0.18): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    for (let y = rowH; y < h; y += rowH) {
      c.fillStyle = css([0, 0, 0], dark);
      c.fillRect(0, y, w, 0.8);
      c.fillStyle = css([255, 245, 220], 0.1);
      c.fillRect(0, y + 0.8, w, 0.6);
    }
  };
}

/** Rows of rounded shingles / tiles (rows run along local x). */
export function shingles(rowH: number, colW: number, color: RGB, seed = 3, round = true): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const rng = mulberry32(seed);
    const rows = Math.ceil(h / rowH) + 1;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const off = r % 2 === 0 ? 0 : colW / 2;
      for (let x = -colW; x < w + colW; x += colW) {
        const tone = 0.88 + rng() * 0.24;
        const col = shadeRgb(color, tone);
        c.fillStyle = css(col, 1);
        c.beginPath();
        if (round) {
          c.moveTo(x + off, y);
          c.lineTo(x + off + colW, y);
          c.lineTo(x + off + colW, y + rowH * 0.62);
          c.quadraticCurveTo(x + off + colW / 2, y + rowH * 1.35, x + off, y + rowH * 0.62);
        } else {
          c.rect(x + off, y, colW, rowH);
        }
        c.closePath();
        c.fill();
        c.strokeStyle = css(shadeRgb(color, 0.5), 0.55);
        c.lineWidth = 0.6;
        c.stroke();
      }
      // shadow under each row
      const g = c.createLinearGradient(0, y + rowH * 0.7, 0, y + rowH * 1.3);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.16)');
      c.fillStyle = g;
      c.fillRect(0, y + rowH * 0.7, w, rowH * 0.6);
    }
  };
}

/** Irregular stone blocks. */
export function stones(color: RGB, seed = 5, size = 6): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const rng = mulberry32(seed);
    c.fillStyle = css(shadeRgb(color, 0.7), 1);
    c.fillRect(-1, -1, w + 2, h + 2);
    for (let y = 0; y < h + size; y += size * 0.8) {
      let x = -(rng() * size);
      while (x < w) {
        const bw = size * (0.9 + rng() * 0.9);
        const tone = 0.86 + rng() * 0.3;
        c.fillStyle = css(shadeRgb(color, tone), 1);
        c.beginPath();
        c.roundRect(x + 0.4, y + 0.4, bw - 0.8, size * 0.8 - 0.8, 1.2);
        c.fill();
        c.fillStyle = css([255, 255, 255], 0.12);
        c.fillRect(x + 0.8, y + 0.7, bw - 1.6, 0.8);
        x += bw;
      }
    }
  };
}

export function ao(top = 0.12, bottom = 0.22): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css([0, 0, 0], top));
    g.addColorStop(0.25, css([0, 0, 0], 0));
    g.addColorStop(0.75, css([0, 0, 0], 0));
    g.addColorStop(1, css([0, 0, 0], bottom));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };
}

/** Horizontal gradient overlay (for light falling across a wall). */
export function sweep(from: number, to: number): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, css([255, 244, 220], from));
    g.addColorStop(1, css([20, 20, 40], to));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };
}

export function rect(x: number, y: number, w: number, h: number, color: RGB, alpha = 1, r = 0): (c: CanvasRenderingContext2D) => void {
  return (c) => {
    c.fillStyle = css(color, alpha);
    c.beginPath();
    if (r > 0) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
    c.fill();
  };
}

/** Framed window with cross bars and optional shutters / flower box. */
export function windowPane(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, opts: { shutters?: RGB; flowers?: boolean; glass?: RGB } = {}): void {
  const glass = opts.glass ?? [150, 196, 220];
  if (opts.shutters) {
    c.fillStyle = css(opts.shutters, 1);
    c.fillRect(x - w * 0.42, y, w * 0.38, h);
    c.fillRect(x + w * 1.04, y, w * 0.38, h);
    c.fillStyle = css([0, 0, 0], 0.22);
    c.fillRect(x - w * 0.42, y + h * 0.3, w * 0.38, 0.6);
    c.fillRect(x + w * 1.04, y + h * 0.3, w * 0.38, 0.6);
  }
  c.fillStyle = css([64, 44, 34], 1);
  c.fillRect(x - 1, y - 1, w + 2, h + 2);
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, css(mixRgb(glass, [255, 255, 255], 0.5), 1));
  g.addColorStop(1, css(shadeRgb(glass, 0.75), 1));
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.fillStyle = css([64, 44, 34], 1);
  c.fillRect(x + w / 2 - 0.4, y, 0.8, h);
  c.fillRect(x, y + h / 2 - 0.4, w, 0.8);
  c.fillStyle = css([255, 255, 255], 0.35);
  c.fillRect(x + 0.6, y + 0.6, w * 0.25, 0.9);
  if (opts.flowers) {
    c.fillStyle = css([112, 76, 50], 1);
    c.fillRect(x - 1, y + h, w + 2, 2.2);
    const cols: RGB[] = [[238, 98, 112], [250, 214, 90], [244, 244, 236]];
    for (let i = 0; i < 5; i++) {
      c.fillStyle = css([70, 130, 64], 1);
      c.fillRect(x + (i / 5) * w, y + h - 1.2, 1.4, 1.6);
      c.fillStyle = css(cols[i % 3]!, 1);
      c.beginPath();
      c.arc(x + 0.8 + (i / 5) * w, y + h - 1.6, 1.1, 0, Math.PI * 2);
      c.fill();
    }
  }
}

export function door(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: RGB, arch = true): void {
  c.fillStyle = css([40, 28, 24], 1);
  c.beginPath();
  c.moveTo(x - 1, y + h);
  c.lineTo(x - 1, y + (arch ? w * 0.5 : 0));
  if (arch) c.arc(x + w / 2, y + w * 0.5, w / 2 + 1, Math.PI, 0);
  else c.lineTo(x + w + 1, y);
  c.lineTo(x + w + 1, y + h);
  c.fill();
  const g = c.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, css(shadeRgb(color, 1.1), 1));
  g.addColorStop(1, css(shadeRgb(color, 0.82), 1));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x, y + h);
  c.lineTo(x, y + (arch ? w * 0.5 : 0));
  if (arch) c.arc(x + w / 2, y + w * 0.5, w / 2, Math.PI, 0);
  else c.lineTo(x + w, y);
  c.lineTo(x + w, y + h);
  c.fill();
  c.fillStyle = css([0, 0, 0], 0.18);
  c.fillRect(x + w / 2 - 0.3, y + (arch ? 0 : 0), 0.6, h);
  c.fillStyle = css([236, 200, 110], 1);
  c.beginPath();
  c.arc(x + w * 0.78, y + h * 0.58, 0.8, 0, Math.PI * 2);
  c.fill();
}

/** Faceted rock surface (cliffs, mine mound). */
export function facets(color: RGB, seed = 1, n = 30): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const rng = mulberry32(seed);
    c.fillStyle = css(shadeRgb(color, 0.8), 1);
    c.fillRect(-1, -1, w + 2, h + 2);
    for (let i = 0; i < n; i++) {
      const cx = rng() * w;
      const cy = rng() * h;
      const r = 5 + rng() * 11;
      const tone = 0.74 + rng() * 0.5;
      c.fillStyle = css(shadeRgb(color, tone), 1);
      c.beginPath();
      const pts = 5 + Math.floor(rng() * 3);
      for (let k = 0; k < pts; k++) {
        const a = (k / pts) * Math.PI * 2 + rng() * 0.5;
        const rr = r * (0.7 + rng() * 0.5);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.8;
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      c.fill();
      c.strokeStyle = css([20, 18, 24], 0.28);
      c.lineWidth = 0.8;
      c.stroke();
      // lit upper-left edge
      c.strokeStyle = css([255, 250, 240], 0.16);
      c.beginPath();
      c.moveTo(cx - r * 0.6, cy - r * 0.1);
      c.lineTo(cx - r * 0.1, cy - r * 0.6);
      c.stroke();
    }
  };
}

/** Snow blanket over a roof slope (local y runs down the slope from the ridge). */
export function snowBlanket(cover = 0.84): (c: CanvasRenderingContext2D, w: number, h: number) => void {
  return (c, w, h) => {
    const bottom = h * cover;
    c.beginPath();
    c.moveTo(-2, -2);
    c.lineTo(w + 2, -2);
    c.lineTo(w + 2, bottom);
    const n = Math.max(3, Math.round(w / 7));
    for (let i = n; i >= 0; i--) {
      const x = (i / n) * w;
      c.quadraticCurveTo(x + w / n / 2, bottom + 3.2, x, bottom - (i % 2) * 1.6);
    }
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, bottom + 3);
    g.addColorStop(0, css([252, 253, 255], 1));
    g.addColorStop(0.7, css([232, 240, 252], 1));
    g.addColorStop(1, css([188, 206, 232], 1));
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = css([150, 172, 208], 0.5);
    c.lineWidth = 0.8;
    c.stroke();
  };
}
