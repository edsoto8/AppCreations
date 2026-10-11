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
    const items = [...this.items].sort((a, b) => b.art.canvas.height - a.art.canvas.height || b.art.canvas.width - a.art.canvas.width);
    const pages: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; x: number; y: number; rowH: number }[] = [];
    const placements: { key: string; art: Art; page: number; x: number; y: number }[] = [];

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
      const w = it.art.canvas.width;
      const h = it.art.canvas.height;
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
      page.ctx.drawImage(it.art.canvas, page.x, page.y);
      placements.push({ key: it.key, art: it.art, page: pageIndex, x: page.x, y: page.y });
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
          addressMode: 'clamp-to-edge',
        }),
    );
    for (const s of sources) s.style.lodMaxClamp = 3;

    const textures = new Map<string, Texture>();
    for (const p of placements) {
      const w = p.art.canvas.width / TEX_SCALE;
      const h = p.art.canvas.height / TEX_SCALE;
      textures.set(
        p.key,
        new Texture({
          source: sources[p.page]!,
          frame: new Rectangle(p.x / TEX_SCALE, p.y / TEX_SCALE, w, h),
          defaultAnchor: { x: p.art.ax / p.art.w, y: p.art.ay / p.art.h },
        }),
      );
    }
    return { textures, pages: pages.map((p) => p.canvas), sources };
  }
}
