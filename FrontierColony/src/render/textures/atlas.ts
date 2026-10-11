/**
 * Texture atlas packer. Every procedural texture is drawn on its own canvas, then packed (shelf
 * packing) into a few shared pages so all sprites of a page batch into one draw call. Mip-maps are
 * on, so entries get generous padding to stop neighbours bleeding at low zoom.
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { TEX_SCALE, type Art } from './canvas';

const PAGE_SIZE = 2048;
/** Padding between entries in device pixels. */
const PAD = 10;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box (device px) of pixels that are not almost transparent. */
function opaqueBox(art: Art): Box {
  const W = art.canvas.width;
  const H = art.canvas.height;
  const data = art.ctx.getImageData(0, 0, W, H).data;
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3]! > 6) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 2, h: 2 };
  // one device pixel of slack so edge anti-aliasing is never clipped
  const x0 = Math.max(0, minX - 1);
  const y0 = Math.max(0, minY - 1);
  const x1 = Math.min(W - 1, maxX + 1);
  const y1 = Math.min(H - 1, maxY + 1);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

interface Pending {
  key: string;
  art: Art;
}

export class AtlasBuilder {
  private readonly items: Pending[] = [];
  private readonly keys = new Set<string>();

  add(key: string, art: Art): void {
    if (this.keys.has(key)) throw new Error(`duplicate atlas key ${key}`);
    this.keys.add(key);
    this.items.push({ key, art });
  }

  /** Packs everything; returns textures by key and the page canvases (for debugging). */
  build(): { textures: Map<string, Texture>; pages: HTMLCanvasElement[]; sources: CanvasSource[] } {
    // Trim every entry to its opaque bounding box: sprites are rasterised as full quads, so transparent
    // margins cost fill rate (a lone sapling would otherwise pay for a 92×96 px quad).
    const trimmed = this.items.map((it) => ({ key: it.key, art: it.art, box: opaqueBox(it.art) }));
    const items = trimmed.sort((a, b) => b.box.h - a.box.h || b.box.w - a.box.w);
    const pages: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; x: number; y: number; rowH: number }[] = [];
    const placements: { key: string; art: Art; box: Box; page: number; x: number; y: number }[] = [];

    const newPage = () => {
      const canvas = document.createElement('canvas');
      canvas.width = PAGE_SIZE;
      canvas.height = PAGE_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas is not available');
      pages.push({ canvas, ctx, x: PAD, y: PAD, rowH: 0 });
    };
    newPage();

    for (const it of items) {
      const w = it.box.w;
      const h = it.box.h;
      if (w + PAD * 2 > PAGE_SIZE || h + PAD * 2 > PAGE_SIZE) throw new Error(`atlas item ${it.key} too large`);
      let pageIndex = pages.length - 1;
      let page = pages[pageIndex]!;
      if (page.x + w + PAD > PAGE_SIZE) {
        page.x = PAD;
        page.y += page.rowH + PAD;
        page.rowH = 0;
      }
      if (page.y + h + PAD > PAGE_SIZE) {
        newPage();
        pageIndex = pages.length - 1;
        page = pages[pageIndex]!;
      }
      page.ctx.drawImage(it.art.canvas, it.box.x, it.box.y, w, h, page.x, page.y, w, h);
      placements.push({ key: it.key, art: it.art, box: it.box, page: pageIndex, x: page.x, y: page.y });
      page.x += w + PAD;
      page.rowH = Math.max(page.rowH, h);
    }

    const sources = pages.map(
      (p) =>
        new CanvasSource({
          resource: p.canvas,
          resolution: TEX_SCALE,
          autoGenerateMipmaps: true,
          scaleMode: 'linear',
          mipmapFilter: 'linear',
          addressMode: 'clamp-to-edge',
        }),
    );
    for (const s of sources) s.style.lodMaxClamp = 3;

    const textures = new Map<string, Texture>();
    for (const p of placements) {
      const w = p.box.w / TEX_SCALE;
      const h = p.box.h / TEX_SCALE;
      // anchor relative to the trimmed frame (may fall outside it)
      const ax = (p.art.ax * TEX_SCALE - p.box.x) / p.box.w;
      const ay = (p.art.ay * TEX_SCALE - p.box.y) / p.box.h;
      textures.set(
        p.key,
        new Texture({
          source: sources[p.page]!,
          frame: new Rectangle(p.x / TEX_SCALE, p.y / TEX_SCALE, w, h),
          defaultAnchor: { x: ax, y: ay },
        }),
      );
    }
    return { textures, pages: pages.map((p) => p.canvas), sources };
  }
}
