/**
 * Owns the chunk grid: builds chunks lazily as they come into view, rebuilds only the chunks whose
 * tiles changed (detected by diffing against `world.revision`), culls the rest and animates the water.
 */
import { Container, MeshSimple, RenderTexture, Texture, type Renderer, type Sprite } from 'pixi.js';
import type { WorldState } from '../../sim';
import { MAX_ELEVATION, Terrain } from '../../sim';
import { ELEVATION_STEP } from '../../shared/iso';
import { NEUTRAL_LOOK, type SeasonLook } from '../atmosphere/seasons';
import type { DepthLayer } from '../depthLayer';
import type { Layers } from '../layers';
import type { TextureSet } from '../textures';
import { buildChunk, clearChunk, createChunk, destroyBake, destroyMesh, type Chunk } from './chunkBuilder';
import { OccIndex, Occluders, type OccRec } from './occluders';
import { CHUNK_SIZE, TerrainModel } from './model';

export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAX_BUILT_CHUNKS = 40;
/** Width of the columns the baked mesh is cut into (its outline follows the content skyline). */
const STRIP = 32;
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
  private readonly renderer: Renderer;
  /** Ground chunks are baked into one texture each while zoomed out; live sprites when zoomed in. */
  private liveGround = false;
  private bakeRes = 1;
  private hiRes = 1.25;
  private readonly occluders: Occluders;
  /**
   * Pixi keeps one shared shader for textured meshes and leaves it bound to the texture of the mesh drawn
   * last; destroying that render texture then logs a BindGroup warning. This degenerate, off-screen mesh is
   * drawn after every chunk so the shader always ends the frame bound to a texture that is never destroyed.
   */
  private readonly parking: MeshSimple;
  private look: SeasonLook = NEUTRAL_LOOK;

  constructor(layers: Layers, tex: TextureSet, depth: DepthLayer, renderer: Renderer) {
    this.layers = layers;
    this.tex = tex;
    this.depth = depth;
    this.renderer = renderer;
    this.hiRes = Math.min(1.5, Math.max(1.25, renderer.resolution));
    this.bakeRes = this.hiRes;
    this.occluders = new Occluders(depth);
    layers.ground.sortableChildren = true;
    this.parking = new MeshSimple({
      texture: Texture.WHITE,
      vertices: new Float32Array([-60000, -60000, -59999, -60000, -59999, -59999, -60000, -59999]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.parking.geometry.batchMode = 'no-batch';
    layers.labels.addChild(this.parking);
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
        this.layers.waterFx.addChild(chunk.fx);
        this.approximateBounds(chunk, world.width, world.height);
        this.chunks.push(chunk);
      }
    }
  }

  private clear(): void {
    this.occluders.reset();
    for (const c of this.chunks) {
      clearChunk(c);
      c.records = null;
      destroyBake(c);
      c.ground.destroy();
      c.fx.destroy();
    }
    this.chunks = [];
    this.model = null;
  }

  destroy(): void {
    this.clear();
    this.occluders.destroy();
    destroyMesh(this.parking);
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

  /** Set the seasonal palette; chunks re-skin gradually (one per frame) as it changes. */
  setLook(look: SeasonLook): void {
    this.look = look;
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
    this.dropRecords(c);
    clearChunk(c);
    const baked = !this.liveGround;
    buildChunk(c, this.model, this.tex, this.depth, this.look, baked);
    if (baked) this.bake(c);
    else this.goLive(c);
  }

  private dropRecords(c: Chunk): void {
    if (c.records) this.occluders.releaseAll(c.records.records);
    c.records = null;
  }

  /**
   * Render the whole chunk (flat tiles, then every depth-sorted object) into one texture and show it
   * through a mesh that follows the outline of the content, so the GPU shades each pixel about once
   * instead of once per overlapping tree, rock and tile quad. Settlers and buildings stay live sprites;
   * `collectOccluders` redraws the few baked objects that must stand in front of them.
   */
  private bake(c: Chunk): void {
    const res = this.bakeRes;
    const sorted = c.sorted;
    // outline of the content, one column per STRIP pixels
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    const rects: number[] = [];
    const take = (s: Sprite): void => {
      const t = s.texture;
      const w = t.width;
      const h = t.height;
      const a = t.defaultAnchor;
      const ax = a ? a.x : 0;
      const ay = a ? a.y : 0;
      const sx = s.scale.x;
      const sy = s.scale.y;
      const xa = -ax * w * sx;
      const xb = (1 - ax) * w * sx;
      const ya = -ay * h * sy;
      const yb = (1 - ay) * h * sy;
      const x0 = s.x + Math.min(xa, xb);
      const x1 = s.x + Math.max(xa, xb);
      const y0 = s.y + Math.min(ya, yb);
      const y1 = s.y + Math.max(ya, yb);
      rects.push(x0, y0, x1, y1);
      if (x0 < bx0) bx0 = x0;
      if (y0 < by0) by0 = y0;
      if (x1 > bx1) bx1 = x1;
      if (y1 > by1) by1 = y1;
    };
    const flat = c.ground.children as Sprite[];
    for (const s of flat) take(s);
    const flatCount = rects.length;
    for (const s of sorted) take(s);
    if (!Number.isFinite(bx0)) {
      c.mode = 'baked';
      return;
    }
    const rx = Math.floor(bx0) - 1;
    const ry = Math.floor(by0) - 1;
    // whole device pixels, so the mesh maps texels exactly
    const rw = Math.ceil((Math.ceil(bx1) + 1 - rx) * res) / res;
    const rh = Math.ceil((Math.ceil(by1) + 1 - ry) * res) / res;
    c.bx = rx;
    c.by = ry;
    const n = Math.ceil(rw / STRIP);
    const top = new Float32Array(n).fill(Infinity);
    const bot = new Float32Array(n).fill(-Infinity);
    for (let k = 0; k < rects.length; k += 4) {
      const i0 = Math.max(0, Math.floor((rects[k]! - rx) / STRIP));
      const i1 = Math.min(n - 1, Math.floor((rects[k + 2]! - rx - 0.001) / STRIP));
      for (let i = i0; i <= i1; i++) {
        if (rects[k + 1]! < top[i]!) top[i] = rects[k + 1]!;
        if (rects[k + 3]! > bot[i]!) bot[i] = rects[k + 3]!;
      }
    }

    if (!c.rt) {
      c.rt = RenderTexture.create({ width: rw, height: rh, resolution: res, autoGenerateMipmaps: false, scaleMode: 'linear' });
    } else if (c.rt.width !== rw || c.rt.height !== rh || c.res !== res) {
      c.rt.resize(rw, rh, res);
    }
    c.res = res;
    // scratch scene: flat tiles first, then the sorted objects
    const box = new Container();
    box.sortableChildren = true;
    for (const s of sorted) box.addChild(s);
    c.ground.addChild(box);
    if (c.ground.parent) c.ground.parent.removeChild(c.ground);
    c.ground.position.set(-rx, -ry);
    c.ground.visible = true;
    this.renderer.render({ container: c.ground, target: c.rt, clear: true });

    // keep a light-weight record of every baked object for occluder redraws
    const index = new OccIndex();
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]!;
      const k = flatCount + i * 4;
      const rec: OccRec = { tex: s.texture, x: s.x, y: s.y, z: s.zIndex, sx: s.scale.x, sy: s.scale.y, tint: s.tint, x0: rects[k]!, y0: rects[k + 1]!, x1: rects[k + 2]!, y1: rects[k + 3]!, stamp: 0, occ: null };
      index.add(rec);
    }
    c.records = index;
    c.ground.removeChild(box);
    box.destroy({ children: true });
    for (const ch of c.ground.removeChildren()) ch.destroy();
    c.sorted = [];

    // skyline mesh: four vertices per column
    const verts = new Float32Array(n * 8);
    const uvs = new Float32Array(n * 8);
    const idx = new Uint32Array(n * 6);
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      if (top[i]! > bot[i]!) continue;
      const xa = rx + i * STRIP;
      const xb = Math.min(rx + rw, xa + STRIP);
      const ya = top[i]!;
      const yb = bot[i]!;
      const o = cnt * 8;
      verts.set([xa, ya, xb, ya, xb, yb, xa, yb], o);
      uvs.set([(xa - rx) / rw, (ya - ry) / rh, (xb - rx) / rw, (ya - ry) / rh, (xb - rx) / rw, (yb - ry) / rh, (xa - rx) / rw, (yb - ry) / rh], o);
      const v = cnt * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], cnt * 6);
      cnt++;
    }
    destroyMesh(c.bake);
    const mesh = new MeshSimple({ texture: c.rt, vertices: verts.subarray(0, cnt * 8), uvs: uvs.subarray(0, cnt * 8), indices: idx.subarray(0, cnt * 6) });
    mesh.geometry.batchMode = 'no-batch';
    mesh.zIndex = c.cx + c.cy;
    mesh.visible = c.shown;
    this.layers.ground.addChild(mesh);
    c.bake = mesh;
    c.mode = 'baked';
  }

  /** Keep the chunk as live sprites (crisp when zoomed in). */
  private goLive(c: Chunk): void {
    c.ground.position.set(0, 0);
    c.ground.zIndex = -1;
    this.layers.ground.addChild(c.ground);
    c.ground.visible = c.shown;
    if (c.bake) c.bake.visible = false;
    c.mode = 'live';
  }

  /**
   * Baked objects that overlap the world rectangle and sort after `z` (they must be redrawn over an
   * entity standing there). Records are appended to `out`; see Occluders.
   */
  collectOccluders(x0: number, y0: number, x1: number, y1: number, z: number, stamp: number, out: OccRec[]): void {
    for (const c of this.chunks) {
      if (!c.shown || c.mode !== 'baked' || !c.records) continue;
      if (c.x1 < x0 || c.x0 > x1 || c.y1 < y0 || c.y0 > y1) continue;
      c.records.query(x0, y0, x1, y1, z, stamp, out);
    }
  }

  beginOccluders(): number {
    return this.occluders.begin();
  }

  endOccluders(wanted: readonly OccRec[], stamp: number): void {
    this.occluders.end(wanted, stamp);
  }

  /**
   * Cull and (re)build. `view` is the visible world rectangle; chunks within a margin of it are kept
   * built so panning never shows a hole. `immediate` builds everything needed right now.
   */
  update(view: ViewRect, immediate = false, zoom = 1, frameMs = 16): void {
    if (!this.model) return;
    this.frame++;
    const wantLive = this.liveGround ? zoom > 1.25 : zoom > 1.45;
    const modeChanged = wantLive !== this.liveGround;
    this.liveGround = wantLive;
    // far out, pictures are baked at a lower resolution (there are many more of them on screen)
    const lowRes = this.bakeRes < this.hiRes ? zoom < 0.68 : zoom < 0.55;
    this.bakeRes = lowRes ? 0.6 : this.hiRes;
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
    const stale = (c: Chunk): boolean => !c.built || c.dirty || (modeChanged && c.mode !== 'none') || (c.mode === 'live') !== wantLive || (c.mode === 'baked' && c.res !== this.bakeRes);
    const lookKey = this.look.key + (this.tex.seasonal ? '+' : '-');
    // season re-skins rebuild whole chunks: at most one every third frame (two when frames are already slow)
    let lookBudget = immediate ? Infinity : frameMs > 40 ? 2 : this.frame % 3 === 0 ? 1 : 0;
    // a chunk that was never built is built at once (no holes); changed ones are redone a couple per frame
    let redo = immediate ? Infinity : 2;
    for (const c of needNow) {
      if (!c.built) this.rebuild(c);
      else if (stale(c)) {
        if (redo > 0) {
          redo--;
          this.rebuild(c);
        }
      } else if (c.lookKey !== lookKey && lookBudget > 0) {
        lookBudget--;
        this.rebuild(c);
      }
      this.show(c);
    }
    for (const c of prefetch) {
      if (stale(c) && budget > 0) {
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
    if (c.mode === 'live') {
      c.ground.visible = true;
      for (const s of c.sorted) this.depth.place(s);
    } else if (c.bake) c.bake.visible = true;
    c.fx.visible = true;
  }

  private hide(c: Chunk): void {
    if (!c.shown) return;
    c.shown = false;
    c.ground.visible = false;
    if (c.bake) c.bake.visible = false;
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
      this.dropRecords(c);
      clearChunk(c);
      destroyBake(c);
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
