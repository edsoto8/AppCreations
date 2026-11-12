import * as THREE from 'three';

export type HouseQuality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_SETTINGS: Record<HouseQuality, { texSize: number; anisotropy: number; details: boolean; smallShadows: boolean }> = {
  low: { texSize: 512, anisotropy: 2, details: false, smallShadows: false },
  medium: { texSize: 1024, anisotropy: 4, details: true, smallShadows: false },
  high: { texSize: 1024, anisotropy: 8, details: true, smallShadows: true },
  ultra: { texSize: 2048, anisotropy: 16, details: true, smallShadows: true },
};

export type TexKey =
  | 'hardwood'
  | 'hardwoodRough'
  | 'tile'
  | 'tileRough'
  | 'carpet'
  | 'rug'
  | 'woodGrain'
  | 'fabric'
  | 'stone';

/** World size (meters) covered by one repeat of the floor textures (floor UVs are in meters). */
export const TEX_METERS = { hardwood: 2.4, tile: 1.2, carpet: 0.6 } as const;

const COLOR_KEYS: ReadonlySet<TexKey> = new Set(['hardwood', 'tile', 'carpet', 'rug', 'woodGrain', 'fabric', 'stone']);

/** Mulberry32 seeded RNG so textures are identical every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

const gray = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

/** Draw `fn` at offsets so that anything crossing the canvas edge wraps around (seamless tiling). */
function wrapped(size: number, fn: (dx: number, dy: number) => void) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy);
}

// ------------------------------------------------------------------------------------------------
// Generators. Each returns [colorCanvas, optional roughnessCanvas].
// ------------------------------------------------------------------------------------------------

function genHardwood(size: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const [c, ctx] = canvas(size);
  const [rc, rctx] = canvas(size);
  const r = rng(1234);
  const px = size / TEX_METERS.hardwood; // pixels per meter
  const plankW = 0.2 * px;
  const rows = Math.round(size / plankW);
  const ph = size / rows;
  rctx.fillStyle = gray(118);
  rctx.fillRect(0, 0, size, size);
  for (let row = 0; row < rows; row++) {
    const y = row * ph;
    let x = -r() * 1.2 * px;
    while (x < size) {
      const len = (0.9 + r() * 0.8) * px;
      const hue = 30 + r() * 6;
      const sat = 30 + r() * 10;
      const light = 50 + r() * 9;
      const draw = (dx: number) => {
        const x0 = x + dx;
        ctx.fillStyle = `hsl(${hue},${sat}%,${light}%)`;
        ctx.fillRect(x0, y, len, ph);
        // Grain: long wavy streaks along the plank.
        const streaks = 14 + Math.floor(r() * 10);
        const gr = rng(Math.floor(x * 31 + row * 977));
        for (let k = 0; k < streaks; k++) {
          const sy = y + gr() * ph;
          const amp = 0.6 + gr() * 2.2;
          const freq = (2 + gr() * 6) / len;
          const phase = gr() * 6.28;
          ctx.strokeStyle = gr() < 0.6 ? `hsla(${hue - 4},${sat + 6}%,${light - 14}%,${0.1 + gr() * 0.16})` : `hsla(${hue + 3},${sat}%,${light + 10}%,${0.08 + gr() * 0.1})`;
          ctx.lineWidth = 0.6 + gr() * 1.6 * (size / 1024);
          ctx.beginPath();
          for (let t = 0; t <= 1.0001; t += 0.05) {
            const xx = x0 + t * len;
            const yy = Math.min(y + ph - 1, Math.max(y + 1, sy + Math.sin(t * len * freq * 6.28 + phase) * amp));
            if (t === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
        if (gr() < 0.18) {
          // A small knot.
          const kx = x0 + (0.2 + gr() * 0.6) * len;
          const ky = y + (0.3 + gr() * 0.4) * ph;
          const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, ph * 0.22);
          grad.addColorStop(0, `hsla(${hue - 6},${sat + 10}%,${light - 24}%,0.75)`);
          grad.addColorStop(1, `hsla(${hue - 6},${sat}%,${light - 10}%,0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(kx, ky, ph * 0.32, ph * 0.16, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Plank end seam + roughness variation.
        ctx.fillStyle = 'rgba(40,26,16,0.55)';
        ctx.fillRect(x0, y, Math.max(1, size / 1024) * 1.4, ph);
        rctx.fillStyle = gray(100 + r() * 40);
        rctx.fillRect(x0 + 2, y + 1, len - 3, ph - 2);
        rctx.fillStyle = gray(220);
        rctx.fillRect(x0, y, Math.max(1.5, size / 600), ph);
      };
      draw(0);
      if (x + len > size) draw(-size);
      x += len;
    }
    // Long-side seam.
    ctx.fillStyle = 'rgba(35,22,14,0.6)';
    ctx.fillRect(0, y, size, Math.max(1, size / 700));
    rctx.fillStyle = gray(225);
    rctx.fillRect(0, y, size, Math.max(1.5, size / 600));
  }
  return [c, rc];
}

function genTile(size: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const [c, ctx] = canvas(size);
  const [rc, rctx] = canvas(size);
  const r = rng(77);
  const n = 2; // 2 x 2 tiles of 0.6 m
  const t = size / n;
  const grout = Math.max(2, (0.004 / TEX_METERS.tile) * size);
  ctx.fillStyle = '#b8b2a8';
  ctx.fillRect(0, 0, size, size);
  rctx.fillStyle = gray(235);
  rctx.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * t + grout / 2;
      const y = j * t + grout / 2;
      const s = t - grout;
      const l = 89 + r() * 4;
      ctx.fillStyle = `hsl(${36 + r() * 8}, ${8 + r() * 6}%, ${l}%)`;
      ctx.fillRect(x, y, s, s);
      // Soft marble veining.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, s, s);
      ctx.clip();
      for (let v = 0; v < 7; v++) {
        ctx.strokeStyle = `rgba(120,112,104,${0.05 + r() * 0.1})`;
        ctx.lineWidth = (0.6 + r() * 2.2) * (size / 1024);
        ctx.beginPath();
        let vx = x + r() * s;
        let vy = y;
        ctx.moveTo(vx, vy);
        for (let k = 0; k < 10; k++) {
          vx += (r() - 0.35) * s * 0.18;
          vy += s * 0.1;
          ctx.lineTo(vx, vy);
        }
        ctx.stroke();
      }
      for (let k = 0; k < 400; k++) {
        ctx.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
        ctx.fillRect(x + r() * s, y + r() * s, 2, 2);
      }
      ctx.restore();
      rctx.fillStyle = gray(34 + r() * 12);
      rctx.fillRect(x, y, s, s);
    }
  }
  return [c, rc];
}

function genCarpet(size: number): [HTMLCanvasElement, null] {
  const [c, ctx] = canvas(size);
  const r = rng(99);
  ctx.fillStyle = gray(222);
  ctx.fillRect(0, 0, size, size);
  // Low-frequency mottling.
  for (let k = 0; k < 60; k++) {
    const x = r() * size;
    const y = r() * size;
    const rad = size * (0.05 + r() * 0.12);
    wrapped(size, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      const v = r() < 0.5 ? 200 : 240;
      g.addColorStop(0, gray(v, 0.18));
      g.addColorStop(1, gray(v, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  // Fibres: many short strokes.
  const fibres = Math.floor(size * size * 0.06);
  const lw = Math.max(1, size / 1024);
  for (let k = 0; k < fibres; k++) {
    const x = r() * size;
    const y = r() * size;
    const a = r() * Math.PI * 2;
    const len = (2 + r() * 4) * lw;
    const v = 160 + r() * 95;
    ctx.strokeStyle = gray(v, 0.55);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  return [c, null];
}

/** Rug pattern (non-repeating, neutral; tinted by the material color). */
function genRug(size: number): [HTMLCanvasElement, null] {
  const [c, ctx] = canvas(size);
  const r = rng(5);
  ctx.fillStyle = gray(236);
  ctx.fillRect(0, 0, size, size);
  const b = size * 0.07;
  ctx.fillStyle = gray(120);
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = gray(236);
  ctx.fillRect(b, b, size - 2 * b, size - 2 * b);
  // Border motifs.
  ctx.fillStyle = gray(190);
  const step = size / 24;
  for (let i = 0; i < 24; i++) {
    for (const [x, y] of [
      [i * step + step / 2, b / 2],
      [i * step + step / 2, size - b / 2],
      [b / 2, i * step + step / 2],
      [size - b / 2, i * step + step / 2],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y - b * 0.3);
      ctx.lineTo(x + b * 0.3, y);
      ctx.lineTo(x, y + b * 0.3);
      ctx.lineTo(x - b * 0.3, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.strokeStyle = gray(150);
  ctx.lineWidth = size * 0.008;
  ctx.strokeRect(b * 1.35, b * 1.35, size - 2.7 * b, size - 2.7 * b);
  // Field lattice.
  const cells = 7;
  const fs = (size - 3 * b) / cells;
  ctx.strokeStyle = gray(200);
  ctx.lineWidth = size * 0.004;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const cx = 1.5 * b + (i + 0.5) * fs;
      const cy = 1.5 * b + (j + 0.5) * fs;
      ctx.beginPath();
      ctx.moveTo(cx, cy - fs / 2);
      ctx.lineTo(cx + fs / 2, cy);
      ctx.lineTo(cx, cy + fs / 2);
      ctx.lineTo(cx - fs / 2, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = gray(185);
      ctx.beginPath();
      ctx.arc(cx, cy, fs * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Central medallion.
  const m = size / 2;
  ctx.fillStyle = gray(160);
  ctx.beginPath();
  ctx.ellipse(m, m, size * 0.17, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = gray(225);
  ctx.beginPath();
  ctx.ellipse(m, m, size * 0.11, size * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = gray(140);
  ctx.beginPath();
  ctx.ellipse(m, m, size * 0.04, size * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();
  // Woven texture noise.
  const lw = Math.max(1, size / 1024);
  for (let k = 0; k < size * size * 0.02; k++) {
    ctx.fillStyle = gray(r() < 0.5 ? 255 : 0, 0.05);
    ctx.fillRect(r() * size, r() * size, 2 * lw, lw);
  }
  return [c, null];
}

function genWoodGrain(size: number): [HTMLCanvasElement, null] {
  const [c, ctx] = canvas(size);
  const r = rng(42);
  ctx.fillStyle = gray(236);
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 90; k++) {
    const y0 = r() * size;
    const amp = 2 + r() * 10;
    const freq = 1 + Math.floor(r() * 3);
    const ph = r() * 6.28;
    ctx.strokeStyle = gray(150 + r() * 70, 0.12 + r() * 0.22);
    ctx.lineWidth = (0.6 + r() * 2.4) * (size / 512);
    wrapped(size, (_dx, dy) => {
      ctx.beginPath();
      for (let x = 0; x <= size; x += size / 64) {
        const y = y0 + dy + Math.sin((x / size) * Math.PI * 2 * freq + ph) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }
  return [c, null];
}

function genFabric(size: number): [HTMLCanvasElement, null] {
  const [c, ctx] = canvas(size);
  const r = rng(7);
  ctx.fillStyle = gray(232);
  ctx.fillRect(0, 0, size, size);
  const pitch = Math.max(2, size / 128);
  for (let y = 0; y < size; y += pitch) {
    ctx.fillStyle = gray(205 + r() * 30, 0.5);
    ctx.fillRect(0, y, size, pitch / 2);
  }
  for (let x = 0; x < size; x += pitch) {
    ctx.fillStyle = gray(215 + r() * 30, 0.35);
    ctx.fillRect(x, 0, pitch / 2, size);
  }
  for (let k = 0; k < size * size * 0.01; k++) {
    ctx.fillStyle = gray(r() < 0.5 ? 255 : 170, 0.25);
    ctx.fillRect(r() * size, r() * size, 1.5, 1.5);
  }
  return [c, null];
}

function genStone(size: number): [HTMLCanvasElement, null] {
  const [c, ctx] = canvas(size);
  const r = rng(3);
  ctx.fillStyle = gray(238);
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < size * size * 0.012; k++) {
    const v = r();
    ctx.fillStyle = v < 0.5 ? gray(150 + r() * 60, 0.5) : gray(255, 0.6);
    const s = (0.5 + r() * 2) * (size / 512);
    ctx.fillRect(r() * size, r() * size, s, s);
  }
  return [c, null];
}

const GENERATORS: Record<TexKey, (size: number) => HTMLCanvasElement> = {
  hardwood: (s) => genHardwood(s)[0],
  hardwoodRough: (s) => genHardwood(s)[1],
  tile: (s) => genTile(s)[0],
  tileRough: (s) => genTile(s)[1],
  carpet: (s) => genCarpet(s)[0],
  rug: (s) => genRug(s)[0],
  woodGrain: (s) => genWoodGrain(Math.max(256, s / 2))[0],
  fabric: (s) => genFabric(Math.max(256, s / 2))[0],
  stone: (s) => genStone(Math.max(256, s / 2))[0],
};

const REPEAT: Partial<Record<TexKey, number>> = {
  hardwood: 1 / TEX_METERS.hardwood,
  hardwoodRough: 1 / TEX_METERS.hardwood,
  tile: 1 / TEX_METERS.tile,
  tileRough: 1 / TEX_METERS.tile,
  carpet: 1 / TEX_METERS.carpet,
  fabric: 2,
};

/** Lazily generated, shared procedural textures. One instance per HouseView. */
export class TextureLibrary {
  private readonly textures = new Map<TexKey, THREE.CanvasTexture>();
  private quality: HouseQuality;
  /** Canvas cache shared by hardwood/tile pairs (color + roughness generated together). */
  private pairCache = new Map<string, HTMLCanvasElement>();

  constructor(quality: HouseQuality) {
    this.quality = quality;
  }

  get(key: TexKey): THREE.CanvasTexture {
    let t = this.textures.get(key);
    if (!t) {
      t = new THREE.CanvasTexture(this.generate(key));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      const rep = REPEAT[key] ?? 1;
      t.repeat.set(rep, rep);
      t.colorSpace = COLOR_KEYS.has(key) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = QUALITY_SETTINGS[this.quality].anisotropy;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      this.textures.set(key, t);
    }
    return t;
  }

  setQuality(q: HouseQuality): void {
    if (q === this.quality) return;
    const sizeChanged = QUALITY_SETTINGS[q].texSize !== QUALITY_SETTINGS[this.quality].texSize;
    this.quality = q;
    this.pairCache.clear();
    for (const [key, t] of this.textures) {
      if (sizeChanged) {
        t.dispose();
        t.image = this.generate(key);
      }
      t.anisotropy = QUALITY_SETTINGS[q].anisotropy;
      t.needsUpdate = true;
    }
    this.pairCache.clear();
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.pairCache.clear();
  }

  private generate(key: TexKey): HTMLCanvasElement {
    const size = QUALITY_SETTINGS[this.quality].texSize;
    if (key === 'hardwood' || key === 'hardwoodRough' || key === 'tile' || key === 'tileRough') {
      const cacheKey = `${key}@${size}`;
      const cached = this.pairCache.get(cacheKey);
      if (cached) return cached;
      const pair = key.startsWith('hardwood') ? genHardwood(size) : genTile(size);
      const base = key.startsWith('hardwood') ? 'hardwood' : 'tile';
      this.pairCache.set(`${base}@${size}`, pair[0]);
      this.pairCache.set(`${base}Rough@${size}`, pair[1]);
      return key.endsWith('Rough') ? pair[1] : pair[0];
    }
    return GENERATORS[key](size);
  }
}
