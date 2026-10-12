/**
 * IsoRenderer: ties the terrain chunks, camera, input, entities and overlays together behind the
 * GameRenderer contract. See layers.ts for the scene graph and terrain/ for the chunked terrain.
 */
import { Application } from 'pixi.js';
import { MAX_ELEVATION, Terrain, getBuildingAt, inBounds, tileIndex, type GameState, type TilePos } from '../sim';
import { pickTile, tileToScreen } from '../shared/iso';
import type { OverlayMode, PlacementGhost, Selection } from '../shared/types';
import { Atmosphere } from './atmosphere/atmosphere';
import { seasonLook } from './atmosphere/seasons';
import { SeasonalBaker } from './textures/seasonal';
import { Camera } from './camera';
import { DepthLayer } from './depthLayer';
import { Effects } from './effects/effects';
import { EntityLayer } from './entities/entityLayer';
import { Overlays } from './entities/overlays';
import { InputController } from './input';
import { createLayers, type Layers } from './layers';
import type { OccRec } from './terrain/occluders';
import { TerrainRenderer } from './terrain/terrainRenderer';
import type { TextureSet } from './textures';
import type { CameraState, FrameInfo, GameRenderer, PointerButton, RendererCallbacks } from './types';

export interface RenderStats {
  /** Exponential moving average of the CPU time spent inside render(), in ms. */
  cpuMs: number;
  frames: number;
}

export class IsoRenderer implements GameRenderer {
  readonly stats: RenderStats = { cpuMs: 0, frames: 0 };
  readonly tex: TextureSet;

  private readonly layers: Layers = createLayers();
  private readonly camera = new Camera();
  private readonly depth: DepthLayer;
  private readonly terrain: TerrainRenderer;
  private readonly entities: EntityLayer;
  private readonly effects: Effects;
  private readonly atmosphere: Atmosphere;
  private readonly baker = new SeasonalBaker();
  private readonly overlays: Overlays;
  private readonly input: InputController;

  private state: Readonly<GameState> | null = null;
  private hover: TilePos | null = null;
  private selection: Selection | null = null;
  private needsImmediateBuild = true;
  private destroyed = false;
  private lastRevision = -1;
  /** Clock for character animation: frozen while paused, faster at higher game speeds. */
  private animTime = 0;
  private suppressFell = false;
  private bakeTimer = 0;

  private readonly app: Application;
  private readonly callbacks: RendererCallbacks;

  constructor(app: Application, callbacks: RendererCallbacks, tex: TextureSet) {
    this.app = app;
    this.callbacks = callbacks;
    this.tex = tex;
    app.stage.eventMode = 'none';
    app.stage.addChild(this.layers.world);
    this.depth = new DepthLayer(this.layers.objects);
    this.terrain = new TerrainRenderer(this.layers, tex, this.depth, app.renderer);
    this.entities = new EntityLayer(this.depth, tex, () => this.terrain.model);
    this.effects = new Effects(this.layers, this.depth, tex, this.entities.locator());
    this.entities.attachEffects(this.effects);
    this.terrain.onTreeFelled = (x, y, species, seed) => {
      if (this.suppressFell) return;
      const p = this.entities.locator().tilePx(x + 0.5, y + 0.5);
      this.effects.fell.start(p.x, p.y, x + y + 1, species, seed);
    };
    this.overlays = new Overlays(this.layers, tex);
    this.atmosphere = new Atmosphere(app.stage, tex);
    // seasonal art is drawn in the background a few milliseconds at a time (never in the render loop)
    const bakeSome = (): void => {
      if (this.destroyed || this.baker.done) return;
      const set = this.baker.step(10);
      if (set) this.tex.seasonal = set;
      else this.bakeTimer = window.setTimeout(bakeSome, 40);
    };
    this.bakeTimer = window.setTimeout(bakeSome, 1500);
    this.input = new InputController(app.canvas, this.camera, {
      onHover: (pos) => this.handleHover(pos),
      onClick: (pos, button) => this.handleClick(pos, button),
    });
    this.camera.setViewport(app.screen.width, app.screen.height);
  }

  // --- GameRenderer ----------------------------------------------------------------------------

  setWorld(state: Readonly<GameState>): void {
    this.state = state;
    const w = state.world;
    this.entities.clear();
    this.effects.clear();
    this.terrain.setWorld(w);
    this.depth.setSize(w.width, w.height);
    this.camera.setMap(w.width, w.height);
    this.lastRevision = w.revision;
    this.needsImmediateBuild = true;
    this.setHoverTile(null);
    const tc = state.buildings.find((b) => b.type === 'townCenter');
    const tx = tc ? tc.origin.x + tc.footprint.w / 2 : w.width / 2;
    const ty = tc ? tc.origin.y + tc.footprint.h / 2 : w.height / 2;
    const p = tileToScreen(tx, ty, this.terrain.model?.elevAt(Math.floor(tx), Math.floor(ty)) ?? 0);
    this.camera.jumpTo(p.x, p.y - 10);
  }

  render(state: Readonly<GameState>, frame: FrameInfo): void {
    if (this.destroyed) return;
    const t0 = performance.now();
    if (!this.terrain.model) this.setWorld(state);
    this.state = state;
    const cam = this.camera;
    cam.setViewport(this.app.screen.width, this.app.screen.height);
    cam.update(Math.min(frame.frameMs, 100) / 1000);
    cam.applyTo(this.layers.world, this.app.renderer.resolution);

    // Structural changes bump world.revision (full diff); resource-only changes (trees felled, rock
    // quarried) arrive as tileChanged events and patch just those tiles.
    // A wildfire turns forest into grass in one go: show flames and scorched ground instead of tumbling trees.
    let burned: { x: number; y: number }[] | null = null;
    if (frame.events.some((e) => e.type === 'randomEvent' && e.kind === 'wildfire')) {
      burned = [];
      for (const e of frame.events) if (e.type === 'tileChanged') burned.push(e);
    }
    this.suppressFell = burned !== null;
    if (state.world.revision !== this.lastRevision) {
      this.terrain.sync(state.world);
      this.lastRevision = state.world.revision;
    }
    if (frame.events.length > 0) {
      const changed: { x: number; y: number }[] = [];
      for (const e of frame.events) if (e.type === 'tileChanged') changed.push(e);
      if (changed.length > 0) this.terrain.syncTiles(state.world, changed);
    }
    this.suppressFell = false;
    if (burned && burned.length > 0) this.effects.startFire(burned);
    this.effects.handle(frame.events);

    const view = cam.viewRect(0);
    this.terrain.update(view, this.needsImmediateBuild, cam.zoom, frame.frameMs);
    this.needsImmediateBuild = false;
    const time = frame.nowMs / 1000;
    this.terrain.animate(time);
    const frameDt = Math.min(frame.frameMs, 100) / 1000;
    this.animTime += frame.speed === 0 ? 0 : frameDt * Math.min(2, Math.sqrt(frame.speed));
    const look = seasonLook(state.time, this.atmosphere.drought, state.weather.current, state.weather.intensity);
    this.terrain.setLook(look);
    this.entities.update(state, frame.alpha, time, frameDt, cam.zoom, this.animTime, look.snow, this.atmosphere.light);
    // baked trees, rocks and hills that stand in front of a settler or building are redrawn over it
    const stamp = this.terrain.beginOccluders();
    const wanted: OccRec[] = [];
    this.entities.forEachBox((x0, y0, x1, y1, z) => this.terrain.collectOccluders(x0, y0, x1, y1, z, stamp, wanted));
    this.terrain.endOccluders(wanted, stamp);
    this.atmosphere.update({ state, dt: frameDt, world: this.layers.world, screenW: this.app.screen.width, screenH: this.app.screen.height, view, entities: this.entities, fires: this.effects.activeFires() });

    this.effects.update(frame.speed === 0 ? frameDt * 0.35 : frameDt);

    if (cam.moved && this.input.lastPointer) this.handleHover(this.input.lastPointer);
    const model = this.terrain.model;
    if (model) {
      this.overlays.update(state, model, time, view);
      const sel = this.selection;
      const settler = sel?.kind === 'settler' ? state.settlers.find((st) => st.id === sel.id) : undefined;
      this.overlays.updatePath(model, settler ? settler.path : null, settler ? this.entities.settlerPx(settler.id) : null, time);
    }
    cam.moved = false;

    this.app.render();
    const dt = performance.now() - t0;
    this.stats.cpuMs = this.stats.frames === 0 ? dt : this.stats.cpuMs * 0.95 + dt * 0.05;
    this.stats.frames++;
  }

  setPlacementGhost(ghost: PlacementGhost | null): void {
    this.overlays.setGhost(ghost);
  }

  setSelection(selection: Selection | null): void {
    this.selection = selection;
    this.overlays.setSelection(selection);
    this.entities.setSelection(selection);
  }

  setOverlay(overlay: OverlayMode): void {
    this.overlays.setMode(overlay);
  }

  centerOn(tile: TilePos | { x: number; y: number }, opts?: { animate?: boolean }): void {
    const m = this.terrain.model;
    const e = m ? this.entities.sampleElevation(tile.x, tile.y) : 0;
    const p = tileToScreen(tile.x, tile.y, e);
    if (opts?.animate) this.camera.glideTo(p.x, p.y - 8);
    else this.camera.jumpTo(p.x, p.y - 8);
  }

  zoomBy(factor: number): void {
    this.camera.zoomAtScreen(factor, this.camera.viewWidth / 2, this.camera.viewHeight / 2);
  }

  getCamera(): CameraState {
    return { centerX: this.camera.x, centerY: this.camera.y, zoom: this.camera.zoom };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearTimeout(this.bakeTimer);
    this.input.destroy();
    this.entities.destroy();
    this.overlays.destroy();
    this.terrain.destroy();
    this.app.destroy({ removeView: true }, { children: true });
    this.tex.destroy();
  }

  // --- picking & input -------------------------------------------------------------------------

  /** Tile under a world-pixel point, honouring elevation and tall mountain peaks. */
  private pickTileWorld(wx: number, wy: number): TilePos | null {
    const state = this.state;
    const m = this.terrain.model;
    if (!state || !m) return null;
    const w = state.world;
    // Mountain peaks stand far above their tile: if the point is inside a peak's silhouette, pick that tile.
    const base = pickTile(wx, wy, MAX_ELEVATION, (x, y) => (m.inBounds(x, y) ? m.elev[m.index(x, y)]! : null));
    for (let k = 4; k >= 1; k--) {
      const fx = base.x + k;
      const fy = base.y + k;
      if (!m.inBounds(fx, fy)) continue;
      const i = m.index(fx, fy);
      if (m.terrain[i] !== Terrain.Mountain || m.level[i] === 0) continue;
      const c = tileToScreen(fx + 0.5, fy + 0.5, m.elev[i]!);
      const top = 78;
      const dy = c.y + 4 - wy;
      if (dy < -4 || dy > top) continue;
      const half = 36 * Math.pow(1 - Math.max(0, dy) / top, 0.8);
      if (Math.abs(wx - c.x) < half) return { x: fx, y: fy };
    }
    return inBounds(w, base.x, base.y) ? { x: base.x, y: base.y } : null;
  }

  private setHoverTile(tile: TilePos | null): void {
    const same = tile === this.hover || (tile !== null && this.hover !== null && tile.x === this.hover.x && tile.y === this.hover.y);
    if (same) return;
    this.hover = tile;
    this.overlays.setHover(tile);
    this.callbacks.onTileHover(tile ? { x: tile.x, y: tile.y } : null);
  }

  private handleHover(pos: { x: number; y: number } | null): void {
    if (!pos) {
      this.setHoverTile(null);
      return;
    }
    const w = this.camera.screenToWorld(pos.x, pos.y);
    this.setHoverTile(this.pickTileWorld(w.x, w.y));
  }

  private handleClick(pos: { x: number; y: number }, button: PointerButton): void {
    const state = this.state;
    if (!state) return;
    const w = this.camera.screenToWorld(pos.x, pos.y);
    const settler = this.entities.hitSettler(w.x, w.y);
    if (settler) return this.callbacks.onSettlerClick(settler.id, button);
    const building = this.entities.hitBuilding(state, w.x, w.y);
    if (building !== null) return this.callbacks.onBuildingClick(building, button);
    const tile = this.pickTileWorld(w.x, w.y);
    if (!tile) return;
    const b = getBuildingAt(state, tile.x, tile.y);
    if (b) return this.callbacks.onBuildingClick(b.id, button);
    this.callbacks.onTileClick(tile, button);
  }
}

export { tileIndex };
