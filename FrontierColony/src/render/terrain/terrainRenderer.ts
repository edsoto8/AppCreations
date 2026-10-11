/**
 * Owns the chunk grid: builds chunks lazily as they come into view, rebuilds only the chunks whose
 * tiles changed (detected by diffing against `world.revision`), culls the rest and animates the water.
 */
import type { WorldState } from '../../sim';
import { MAX_ELEVATION, Terrain } from '../../sim';
import { ELEVATION_STEP } from '../../shared/iso';
import type { DepthLayer } from '../depthLayer';
import type { Layers } from '../layers';
import type { TextureSet } from '../textures';
import { buildChunk, clearChunk, createChunk, type Chunk } from './chunkBuilder';
import { CHUNK_SIZE, TerrainModel } from './model';

export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAX_BUILT_CHUNKS = 64;
/** Chunks (re)built per frame beyond the ones needed this very frame. */
const PREFETCH_BUDGET = 2;

export class TerrainRenderer {
  model: TerrainModel | null = null;
  private chunks: Chunk[] = [];
  private cols = 0;
  private rows = 0;
  private frame = 0;
  private readonly layers: Layers;
  private readonly tex: TextureSet;
  private readonly depth: DepthLayer;

  constructor(layers: Layers, tex: TextureSet, depth: DepthLayer) {
    this.layers = layers;
    this.tex = tex;
    this.depth = depth;
  }

  /** Rebuild everything for a new or loaded world. */
  setWorld(world: Readonly<WorldState>): void {
    this.clear();
    this.model = new TerrainModel(world);
    this.cols = Math.ceil(world.width / CHUNK_SIZE);
    this.rows = Math.ceil(world.height / CHUNK_SIZE);
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const chunk = createChunk(cx, cy, cy * this.cols + cx);
        chunk.ground.visible = false;
        chunk.fx.visible = false;
        this.layers.ground.addChild(chunk.ground);
        this.layers.waterFx.addChild(chunk.fx);
        this.approximateBounds(chunk, world.width, world.height);
        this.chunks.push(chunk);
      }
    }
  }

  private clear(): void {
    for (const c of this.chunks) {
      clearChunk(c);
      c.ground.destroy();
      c.fx.destroy();
    }
    this.chunks = [];
    this.model = null;
  }

  destroy(): void {
    this.clear();
  }

  private approximateBounds(c: Chunk, w: number, h: number): void {
    const x0 = c.cx * CHUNK_SIZE;
    const y0 = c.cy * CHUNK_SIZE;
    const x1 = Math.min(w, x0 + CHUNK_SIZE);
    const y1 = Math.min(h, y0 + CHUNK_SIZE);
    c.x0 = (x0 - y1) * 32 - 40;
    c.x1 = (x1 - y0) * 32 + 40;
    c.y0 = (x0 + y0) * 16 - MAX_ELEVATION * ELEVATION_STEP - 130;
    c.y1 = (x1 + y1) * 16 + 40;
  }

  /** Detect changed tiles and mark their chunks (and bordering chunks) dirty. */
  sync(world: Readonly<WorldState>): void {
    const model = this.model;
    if (!model || model.revision === world.revision) return;
    const w = model.width;
    model.sync(world, (i, structural, prevT, prevL) => {
      const x = i % w;
      const y = (i - x) / w;
      this.markDirty(x, y, structural);
      this.noteFelled(model, x, y, i, prevT, prevL);
    });
  }

  /** Called when a forest tile loses trees (chopped) so the renderer can play a falling-tree animation. */
  onTreeFelled: ((x: number, y: number, species: number, seed: number) => void) | null = null;

  private noteFelled(model: TerrainModel, x: number, y: number, i: number, prevT: number, prevL: number): void {
    if (!this.onTreeFelled || prevT !== Terrain.Forest || prevL <= 0) return;
    const t = model.terrain[i]!;
    const l = model.level[i]!;
    if ((t === Terrain.Forest && l < prevL) || t === Terrain.Grass) this.onTreeFelled(x, y, model.species(x, y), x * 31 + y * 17);
  }

  /** Patch single tiles from `tileChanged` sim events (resource-only changes don't bump the revision). */
  syncTiles(world: Readonly<WorldState>, tiles: readonly { x: number; y: number }[]): void {
    const model = this.model;
    if (!model) return;
    for (const t of tiles) {
      model.syncTile(world, t.x, t.y, (i, structural, prevT, prevL) => {
        const x = i % model.width;
        const y = Math.floor(i / model.width);
        this.markDirty(x, y, structural);
        this.noteFelled(model, x, y, i, prevT, prevL);
      });
    }
  }

  private markDirty(x: number, y: number, structural: boolean): void {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    this.dirtyChunk(cx, cy);
    if (!structural) return;
    const lx = x - cx * CHUNK_SIZE;
    const ly = y - cy * CHUNK_SIZE;
    const nx = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
    const ny = ly === 0 ? -1 : ly === CHUNK_SIZE - 1 ? 1 : 0;
    if (nx) this.dirtyChunk(cx + nx, cy);
    if (ny) this.dirtyChunk(cx, cy + ny);
    if (nx && ny) this.dirtyChunk(cx + nx, cy + ny);
  }

  private dirtyChunk(cx: number, cy: number): void {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    this.chunks[cy * this.cols + cx]!.dirty = true;
  }

  private rebuild(c: Chunk): void {
    if (!this.model) return;
    clearChunk(c);
    buildChunk(c, this.model, this.tex, this.depth);
  }

  /**
   * Cull and (re)build. `view` is the visible world rectangle; chunks within a margin of it are kept
   * built so panning never shows a hole. `immediate` builds everything needed right now.
   */
  update(view: ViewRect, immediate = false): void {
    if (!this.model) return;
    this.frame++;
    const margin = 260;
    const nearX0 = view.x0 - margin;
    const nearY0 = view.y0 - margin;
    const nearX1 = view.x1 + margin;
    const nearY1 = view.y1 + margin;
    let budget = immediate ? Infinity : PREFETCH_BUDGET;
    const needNow: Chunk[] = [];
    const prefetch: Chunk[] = [];
    for (const c of this.chunks) {
      const inView = c.x1 >= view.x0 && c.x0 <= view.x1 && c.y1 >= view.y0 && c.y0 <= view.y1;
      const near = c.x1 >= nearX0 && c.x0 <= nearX1 && c.y1 >= nearY0 && c.y0 <= nearY1;
      if (inView) {
        needNow.push(c);
      } else if (near) {
        prefetch.push(c);
      } else if (c.shown) {
        this.hide(c);
      }
    }
    for (const c of needNow) {
      if (!c.built || c.dirty) this.rebuild(c);
      this.show(c);
    }
    for (const c of prefetch) {
      if ((!c.built || c.dirty) && budget > 0) {
        this.rebuild(c);
        budget--;
      }
      if (c.built) this.show(c);
      else if (c.shown) this.hide(c);
    }
    this.evict();
  }

  private show(c: Chunk): void {
    c.lastShownFrame = this.frame;
    if (c.shown) return;
    c.shown = true;
    c.ground.visible = true;
    c.fx.visible = true;
    for (const s of c.sorted) this.depth.place(s);
  }

  private hide(c: Chunk): void {
    if (!c.shown) return;
    c.shown = false;
    c.ground.visible = false;
    c.fx.visible = false;
    for (const s of c.sorted) this.depth.remove(s);
  }

  private evict(): void {
    let built = 0;
    for (const c of this.chunks) if (c.built) built++;
    if (built <= MAX_BUILT_CHUNKS) return;
    const candidates = this.chunks.filter((c) => c.built && !c.shown).sort((a, b) => a.lastShownFrame - b.lastShownFrame);
    for (const c of candidates) {
      if (built <= MAX_BUILT_CHUNKS) break;
      clearChunk(c);
      c.dirty = true;
      built--;
    }
  }

  /** Animate shimmer and foam in the visible chunks. */
  animate(timeSec: number): void {
    for (const c of this.chunks) {
      if (!c.shown) continue;
      for (const s of c.shimmers) {
        const k = 0.5 + 0.5 * Math.sin(timeSec * s.speed + s.phase);
        const a = k * k * k;
        s.sprite.alpha = a * 0.75;
        s.sprite.position.x = s.baseX + Math.sin(timeSec * 0.35 + s.phase) * 3;
        s.sprite.scale.x = 0.7 + k * 0.5;
      }
      for (const f of c.foams) {
        const k = Math.sin(timeSec * 1.2 + f.phase);
        f.sprite.alpha = 0.6 + 0.36 * k;
        const off = 0.9 + 1.5 * (0.5 + 0.5 * Math.sin(timeSec * 1.2 + f.phase - 0.6));
        f.sprite.position.set(f.baseX + f.dx * off, f.baseY + f.dy * off);
      }
    }
  }
}
