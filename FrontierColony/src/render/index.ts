/**
 * PixiJS v8 renderer.
 *
 * M1 stub — replaced by Graphics Engineer. Draws terrain as flat-shaded iso diamonds (raised by
 * elevation), buildings as boxes, settlers as dots, plus hover/selection/ghost outlines, with
 * drag-to-pan and wheel zoom. It already honours the full `GameRenderer` contract.
 */
import { Application, Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
import {
  BUILDING_DEFS,
  MAX_ELEVATION,
  Terrain,
  getBuildingAt,
  getSettler,
  inBounds,
  tileIndex,
  type GameState,
  type TilePos,
} from '../sim';
import { ELEVATION_STEP, pickTile, tileToScreen } from '../shared/iso';
import type { OverlayMode, PlacementGhost, Selection } from '../shared/types';
import type { CameraState, CreateRenderer, FrameInfo, GameRenderer, PointerButton, RendererCallbacks } from './types';

export type { GameRenderer, RendererCallbacks, FrameInfo, CameraState, CreateRenderer } from './types';

const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.DeepWater]: 0x2f5d8a,
  [Terrain.ShallowWater]: 0x4f8fbf,
  [Terrain.Sand]: 0xd8c690,
  [Terrain.Grass]: 0x77a95a,
  [Terrain.Forest]: 0x3f7a3a,
  [Terrain.Hills]: 0x9a8f7d,
  [Terrain.Mountain]: 0x7d7a78,
};

const BUILDING_COLORS: Record<string, number> = {
  townCenter: 0xb5651d,
  house: 0xc98b5a,
  farm: 0xd9c25b,
  lumberCamp: 0x8b5a2b,
  mine: 0x6f6f6f,
  well: 0x5b8fb9,
  storage: 0xa0784f,
  workshop: 0x9c6b98,
};

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD_PX = 5;

function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Points of the top face of a box covering [x0,x1]×[y0,y1] at height h (pixels above elevation e). */
function diamond(x0: number, y0: number, x1: number, y1: number, e: number, liftPx = 0): number[] {
  const pts = [tileToScreen(x0, y0, e), tileToScreen(x1, y0, e), tileToScreen(x1, y1, e), tileToScreen(x0, y1, e)];
  return pts.flatMap((p) => [p.x, p.y - liftPx]);
}

export const createRenderer: CreateRenderer = async (host, callbacks) => {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: 0x1b2433,
    antialias: true,
    autoStart: false,
    preference: 'webgl',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  app.ticker.stop();
  app.canvas.setAttribute('data-testid', 'game-canvas');
  host.appendChild(app.canvas);
  return new StubRenderer(app, callbacks);
};

class StubRenderer implements GameRenderer {
  private readonly world = new Container();
  private readonly terrain = new Graphics();
  private readonly buildings = new Graphics();
  private readonly settlers = new Graphics();
  private readonly overlay = new Graphics();
  private state: Readonly<GameState> | null = null;
  private terrainRevision = -1;
  private buildingsKey = '';
  private ghost: PlacementGhost | null = null;
  private selection: Selection | null = null;
  private hover: TilePos | null = null;
  private zoom = 1;
  private destroyed = false;
  private drag: { startX: number; startY: number; worldX: number; worldY: number; moved: boolean } | null = null;
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  };
  private readonly onContextMenu = (e: Event) => e.preventDefault();

  private readonly app: Application;
  private readonly callbacks: RendererCallbacks;

  constructor(app: Application, callbacks: RendererCallbacks) {
    this.app = app;
    this.callbacks = callbacks;
    this.world.addChild(this.terrain, this.buildings, this.settlers, this.overlay);
    app.stage.addChild(this.world);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', this.handleDown, this);
    app.stage.on('pointermove', this.handleMove, this);
    app.stage.on('pointerup', this.handleUp, this);
    app.stage.on('pointerupoutside', () => (this.drag = null));
    app.stage.on('pointerleave', () => this.setHover(null));
    app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    app.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  setWorld(state: Readonly<GameState>): void {
    this.state = state;
    this.terrainRevision = -1;
    this.buildingsKey = '';
    const tc = state.buildings.find((b) => b.type === 'townCenter');
    const w = state.world;
    this.centerOn(tc ? { x: tc.origin.x + tc.footprint.w / 2, y: tc.origin.y + tc.footprint.h / 2 } : { x: w.width / 2, y: w.height / 2 });
  }

  render(state: Readonly<GameState>, frame: FrameInfo): void {
    if (this.destroyed) return;
    this.state = state;
    if (state.world.revision !== this.terrainRevision) {
      this.drawTerrain(state);
      this.terrainRevision = state.world.revision;
    }
    this.drawBuildings(state);
    this.drawSettlers(state, frame.alpha);
    this.drawOverlay(state);
    this.app.render();
  }

  setPlacementGhost(ghost: PlacementGhost | null): void {
    this.ghost = ghost;
  }

  setSelection(selection: Selection | null): void {
    this.selection = selection;
  }

  setOverlay(_overlay: OverlayMode): void {
    // M1 stub: overlays are not drawn yet.
  }

  centerOn(tile: { x: number; y: number }): void {
    const p = tileToScreen(tile.x, tile.y);
    this.world.position.set(this.app.screen.width / 2 - p.x * this.zoom, this.app.screen.height / 2 - p.y * this.zoom);
  }

  zoomBy(factor: number): void {
    this.zoomAt(factor, this.app.screen.width / 2, this.app.screen.height / 2);
  }

  getCamera(): CameraState {
    return {
      centerX: (this.app.screen.width / 2 - this.world.position.x) / this.zoom,
      centerY: (this.app.screen.height / 2 - this.world.position.y) / this.zoom,
      zoom: this.zoom,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.app.destroy({ removeView: true }, { children: true });
  }

  // --- camera & input ---------------------------------------------------------------------

  private zoomAt(factor: number, sx: number, sy: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const wx = (sx - this.world.position.x) / this.zoom;
    const wy = (sy - this.world.position.y) / this.zoom;
    this.zoom = next;
    this.world.scale.set(next);
    this.world.position.set(sx - wx * next, sy - wy * next);
  }

  private tileAtGlobal(gx: number, gy: number): TilePos | null {
    const state = this.state;
    if (!state) return null;
    const local = this.world.toLocal({ x: gx, y: gy });
    const w = state.world;
    const t = pickTile(local.x, local.y, MAX_ELEVATION, (x, y) =>
      inBounds(w, x, y) ? (w.elevation[tileIndex(w, x, y)] ?? 0) : null,
    );
    return inBounds(w, t.x, t.y) ? t : null;
  }

  private setHover(tile: TilePos | null): void {
    const same = tile === this.hover || (tile && this.hover && tile.x === this.hover.x && tile.y === this.hover.y);
    if (same) return;
    this.hover = tile;
    this.callbacks.onTileHover(tile);
  }

  private handleDown(e: FederatedPointerEvent): void {
    this.drag = { startX: e.global.x, startY: e.global.y, worldX: this.world.position.x, worldY: this.world.position.y, moved: false };
  }

  private handleMove(e: FederatedPointerEvent): void {
    const d = this.drag;
    if (d && e.buttons !== 0) {
      const dx = e.global.x - d.startX;
      const dy = e.global.y - d.startY;
      if (d.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        d.moved = true;
        this.world.position.set(d.worldX + dx, d.worldY + dy);
      }
    }
    this.setHover(this.tileAtGlobal(e.global.x, e.global.y));
  }

  private handleUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved || !this.state) return;
    const button: PointerButton = e.button === 2 ? 'right' : 'left';
    const local = this.world.toLocal(e.global);
    // Settlers first (closest within a small radius), then buildings, then the tile.
    let best: { id: number; dist: number } | null = null;
    for (const s of this.state.settlers) {
      const p = this.settlerScreen(s.pos.x, s.pos.y);
      const dist = Math.hypot(p.x - local.x, p.y - 8 - local.y);
      if (dist < 12 && (!best || dist < best.dist)) best = { id: s.id, dist };
    }
    if (best) return this.callbacks.onSettlerClick(best.id, button);
    const tile = this.tileAtGlobal(e.global.x, e.global.y);
    if (!tile) return;
    const building = getBuildingAt(this.state, tile.x, tile.y);
    if (building) return this.callbacks.onBuildingClick(building.id, button);
    this.callbacks.onTileClick(tile, button);
  }

  // --- drawing -----------------------------------------------------------------------------

  private elevationAt(x: number, y: number): number {
    const w = this.state?.world;
    if (!w) return 0;
    const tx = Math.min(w.width - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(w.height - 1, Math.max(0, Math.floor(y)));
    return w.elevation[tileIndex(w, tx, ty)] ?? 0;
  }

  private settlerScreen(x: number, y: number) {
    return tileToScreen(x, y, this.elevationAt(x, y));
  }

  private drawTerrain(state: Readonly<GameState>): void {
    const g = this.terrain;
    const w = state.world;
    g.clear();
    // Back-to-front by diagonal so raised tiles overlap the ones behind them.
    for (let d = 0; d <= w.width + w.height - 2; d++) {
      for (let x = Math.max(0, d - w.height + 1); x <= Math.min(d, w.width - 1); x++) {
        const y = d - x;
        const i = tileIndex(w, x, y);
        const terrain = w.terrain[i] ?? Terrain.Grass;
        const e = w.elevation[i] ?? 0;
        const base = TERRAIN_COLORS[terrain] ?? 0xff00ff;
        const color = shade(base, ((x * 7 + y * 13) % 5) * 0.015 + 0.95);
        if (e > 0) {
          // Side walls down to ground level.
          const top = [tileToScreen(x, y + 1, e), tileToScreen(x + 1, y + 1, e), tileToScreen(x + 1, y, e)];
          const drop = e * ELEVATION_STEP;
          const [l, b, r] = top as [typeof top[0], typeof top[0], typeof top[0]];
          g.poly([l.x, l.y, b.x, b.y, b.x, b.y + drop, l.x, l.y + drop]).fill(shade(base, 0.7));
          g.poly([b.x, b.y, r.x, r.y, r.x, r.y + drop, b.x, b.y + drop]).fill(shade(base, 0.55));
        }
        g.poly(diamond(x, y, x + 1, y + 1, e)).fill(color);
        if (terrain === Terrain.Forest && (w.resource[i] ?? 0) > 0) {
          const c = tileToScreen(x + 0.5, y + 0.5, e);
          g.poly([c.x, c.y - 22, c.x + 8, c.y + 2, c.x - 8, c.y + 2]).fill(0x2a5a2a);
        }
      }
    }
  }

  private drawBuildings(state: Readonly<GameState>): void {
    const key = state.buildings
      .map((b) => `${b.id}:${b.status}:${b.construction ? Math.round(b.construction.progress * 20) : 20}`)
      .join('|');
    if (key === this.buildingsKey) return;
    this.buildingsKey = key;
    const g = this.buildings;
    g.clear();
    const sorted = [...state.buildings].sort(
      (a, b) => a.origin.x + a.origin.y + a.footprint.w + a.footprint.h - (b.origin.x + b.origin.y + b.footprint.w + b.footprint.h),
    );
    for (const b of sorted) {
      const e = this.elevationAt(b.origin.x, b.origin.y);
      const x0 = b.origin.x + 0.1;
      const y0 = b.origin.y + 0.1;
      const x1 = b.origin.x + b.footprint.w - 0.1;
      const y1 = b.origin.y + b.footprint.h - 0.1;
      const progress = b.construction ? b.construction.progress : 1;
      const height = (b.type === 'farm' ? 4 : 10 + 10 * Math.min(b.footprint.w, b.footprint.h)) * Math.max(0.15, progress);
      const color = BUILDING_COLORS[b.type] ?? 0xffffff;
      const l = tileToScreen(x0, y1, e);
      const bt = tileToScreen(x1, y1, e);
      const r = tileToScreen(x1, y0, e);
      g.poly([l.x, l.y, bt.x, bt.y, bt.x, bt.y - height, l.x, l.y - height]).fill(shade(color, 0.75));
      g.poly([bt.x, bt.y, r.x, r.y, r.x, r.y - height, bt.x, bt.y - height]).fill(shade(color, 0.6));
      g.poly(diamond(x0, y0, x1, y1, e, height)).fill(color);
      if (b.status === 'construction') {
        g.poly(diamond(x0, y0, x1, y1, e, height)).stroke({ width: 1, color: 0xffe08a, alpha: 0.9 });
      }
    }
  }

  private drawSettlers(state: Readonly<GameState>, alpha: number): void {
    const g = this.settlers;
    g.clear();
    const order = [...state.settlers].sort((a, b) => a.pos.x + a.pos.y - (b.pos.x + b.pos.y));
    for (const s of order) {
      const x = s.prevPos.x + (s.pos.x - s.prevPos.x) * alpha;
      const y = s.prevPos.y + (s.pos.y - s.prevPos.y) * alpha;
      const p = this.settlerScreen(x, y);
      g.ellipse(p.x, p.y, 6, 3).fill({ color: 0x000000, alpha: 0.25 });
      g.circle(p.x, p.y - 8, 5).fill(0xf2e6d0).stroke({ width: 1.5, color: 0x3b2f2f });
    }
  }

  private drawOverlay(state: Readonly<GameState>): void {
    const g = this.overlay;
    g.clear();
    const w = state.world;
    const outline = (x: number, y: number, color: number, width = 2) => {
      if (!inBounds(w, x, y)) return;
      g.poly(diamond(x, y, x + 1, y + 1, w.elevation[tileIndex(w, x, y)] ?? 0)).stroke({ width, color, alpha: 0.9 });
    };
    if (this.ghost) {
      for (const t of this.ghost.tiles) {
        if (!inBounds(w, t.x, t.y)) continue;
        const e = w.elevation[tileIndex(w, t.x, t.y)] ?? 0;
        g.poly(diamond(t.x, t.y, t.x + 1, t.y + 1, e)).fill({ color: t.ok ? 0x6ee36e : 0xe35d5d, alpha: 0.45 });
      }
    } else if (this.hover) {
      outline(this.hover.x, this.hover.y, 0xffffff, 1.5);
    }
    const sel = this.selection;
    if (sel?.kind === 'tile') outline(sel.x, sel.y, 0xffd54a);
    if (sel?.kind === 'building') {
      const b = state.buildings.find((bb) => bb.id === sel.id);
      if (b) {
        const def = BUILDING_DEFS[b.type];
        const e = this.elevationAt(b.origin.x, b.origin.y);
        g.poly(diamond(b.origin.x, b.origin.y, b.origin.x + def.footprint.w, b.origin.y + def.footprint.h, e)).stroke({
          width: 2,
          color: 0xffd54a,
        });
      }
    }
    if (sel?.kind === 'settler') {
      const s = getSettler(state, sel.id);
      if (s) {
        const p = this.settlerScreen(s.pos.x, s.pos.y);
        g.ellipse(p.x, p.y, 10, 5).stroke({ width: 2, color: 0xffd54a });
      }
    }
  }
}
