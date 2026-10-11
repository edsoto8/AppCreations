/**
 * Hover highlight, tile / building selection outlines, placement ghost and the optional map overlays.
 * Everything here is drawn with a handful of Graphics objects that are only redrawn when their input
 * changes; pulsing is done through alpha so it costs nothing per frame.
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { BUILDING_DEFS, TERRAIN_DEFS, Terrain, type GameState, type TilePos } from '../../sim';
import { tileToScreen } from '../../shared/iso';
import type { OverlayMode, PlacementGhost, Selection } from '../../shared/types';
import type { Layers } from '../layers';
import type { TerrainModel } from '../terrain/model';
import type { TextureSet } from '../textures';
import { setTex } from '../util/sprite';
import { buildingTexture } from './buildingTextures';

/** Diamond for a w×h block of tiles whose top vertex is at (0,0). */
function diamondPoints(w: number, h: number, inset = 0): number[] {
  const hw = 32;
  const hh = 16;
  // vertices: top, right, bottom, left of the block
  const top = { x: 0, y: 0 };
  const right = { x: w * hw, y: w * hh };
  const bottom = { x: (w - h) * hw, y: (w + h) * hh };
  const left = { x: -h * hw, y: h * hh };
  const cx = (top.x + bottom.x) / 2;
  const cy = (top.y + bottom.y) / 2;
  const mv = (p: { x: number; y: number }) => {
    const dx = cx - p.x;
    const dy = cy - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return [p.x + (dx / len) * inset, p.y + (dy / len) * inset * 0.5];
  };
  return [...mv(top), ...mv(right), ...mv(bottom), ...mv(left)];
}

export class Overlays {
  private readonly hover = new Graphics();
  private readonly selection = new Graphics();
  private readonly ghostTiles = new Graphics();
  private readonly ghostBuilding = new Sprite();
  private readonly path = new Graphics();
  private readonly mapOverlay = new Graphics();
  private readonly root = new Container();

  private hoverTile: TilePos | null = null;
  private selected: Selection | null = null;
  private ghost: PlacementGhost | null = null;
  private overlayMode: OverlayMode = 'none';
  private overlayKey = '';
  private selectionKey = '';
  private ghostKey = '';

  private readonly tex: TextureSet;

  constructor(layers: Layers, tex: TextureSet) {
    this.tex = tex;
    this.hover.visible = false;
    this.selection.visible = false;
    this.ghostBuilding.alpha = 0.7;
    this.root.addChild(this.mapOverlay, this.hover, this.selection, this.path, this.ghostTiles, this.ghostBuilding);
    layers.overlays.addChild(this.root);
    this.drawHover();
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  setHover(tile: TilePos | null): void {
    this.hoverTile = tile;
  }

  setSelection(sel: Selection | null): void {
    this.selected = sel;
    this.selectionKey = '';
  }

  setGhost(ghost: PlacementGhost | null): void {
    this.ghost = ghost;
    this.ghostKey = '';
  }

  setMode(mode: OverlayMode): void {
    this.overlayMode = mode;
    this.overlayKey = '';
  }

  private drawHover(): void {
    const g = this.hover;
    g.clear();
    const pts = diamondPoints(1, 1);
    g.poly(pts).fill({ color: 0xffffff, alpha: 0.1 });
    for (const [w, a] of [
      [7, 0.06],
      [4.5, 0.12],
      [2.5, 0.22],
    ] as const) {
      g.poly(pts).stroke({ width: w, color: 0xfff6d8, alpha: a, join: 'round' });
    }
    g.poly(pts).stroke({ width: 1.3, color: 0xffffff, alpha: 0.95, join: 'round' });
  }

  update(state: Readonly<GameState>, model: TerrainModel, timeSec: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const world = state.world;
    // hover (hidden while a placement ghost is showing)
    if (this.hoverTile && !this.ghost && model.inBounds(this.hoverTile.x, this.hoverTile.y)) {
      const e = model.elevAt(this.hoverTile.x, this.hoverTile.y);
      const p = tileToScreen(this.hoverTile.x, this.hoverTile.y, e);
      this.hover.position.set(p.x, p.y);
      this.hover.visible = true;
      this.hover.alpha = 0.82 + 0.18 * Math.sin(timeSec * 4);
    } else this.hover.visible = false;

    // selection
    const sel = this.selected;
    let selKey = 'none';
    if (sel?.kind === 'tile') selKey = `t${sel.x},${sel.y}`;
    else if (sel?.kind === 'building') {
      const b = state.buildings.find((bb) => bb.id === sel.id);
      selKey = b ? `b${b.id}` : 'none';
    }
    if (selKey !== this.selectionKey) {
      this.selectionKey = selKey;
      const g = this.selection;
      g.clear();
      if (sel?.kind === 'tile' && model.inBounds(sel.x, sel.y)) {
        const e = model.elevAt(sel.x, sel.y);
        const p = tileToScreen(sel.x, sel.y, e);
        g.position.set(p.x, p.y);
        this.strokeSelection(g, 1, 1);
        g.visible = true;
      } else if (sel?.kind === 'building') {
        const b = state.buildings.find((bb) => bb.id === sel.id);
        if (b) {
          const e = this.footprintElevation(model, b.origin.x, b.origin.y, b.footprint.w, b.footprint.h);
          const p = tileToScreen(b.origin.x, b.origin.y, e);
          g.position.set(p.x, p.y);
          this.strokeSelection(g, b.footprint.w, b.footprint.h);
          g.visible = true;
        } else g.visible = false;
      } else g.visible = false;
    }
    if (this.selection.visible) this.selection.alpha = 0.78 + 0.22 * Math.sin(timeSec * 3.4);

    // placement ghost
    const gh = this.ghost;
    if (!gh) {
      this.ghostTiles.visible = false;
      this.ghostBuilding.visible = false;
      this.ghostKey = '';
    } else {
      const key = `${gh.buildingType}@${gh.origin.x},${gh.origin.y}:${gh.ok}:${gh.tiles.map((t) => (t.ok ? 1 : 0)).join('')}`;
      if (key !== this.ghostKey) {
        this.ghostKey = key;
        this.drawGhost(gh, model);
      }
      this.ghostTiles.visible = true;
      this.ghostBuilding.visible = true;
      this.ghostTiles.alpha = 0.75 + 0.25 * Math.sin(timeSec * 5);
      this.ghostBuilding.alpha = 0.62 + 0.1 * Math.sin(timeSec * 5);
    }

    // map overlays (redrawn when the mode, the world or the covered region changes)
    const m = 192;
    const bucket = [
      this.overlayMode,
      world.revision,
      Math.floor(view.x0 / 128),
      Math.floor(view.y0 / 128),
      Math.floor(view.x1 / 128),
      Math.floor(view.y1 / 128),
      this.overlayMode === 'resources' ? Math.floor(timeSec / 1.5) : 0,
    ].join(':');
    if (bucket !== this.overlayKey) {
      this.overlayKey = bucket;
      this.drawMapOverlay(state, model, { x0: view.x0 - m, y0: view.y0 - m, x1: view.x1 + m, y1: view.y1 + m });
    }
  }

  /** Dotted route preview for the selected settler: from its feet through the remaining waypoints. */
  updatePath(model: TerrainModel, path: readonly TilePos[] | null, start: { x: number; y: number } | null, timeSec: number): void {
    const g = this.path;
    g.clear();
    if (!path || path.length === 0 || !start) return;
    let px = start.x;
    let py = start.y;
    const spacing = 10;
    let carry = (timeSec * 16) % spacing;
    const n = Math.min(path.length, 80);
    for (let i = 0; i < n; i++) {
      const t = path[i]!;
      if (!model.inBounds(t.x, t.y)) break;
      const q = tileToScreen(t.x + 0.5, t.y + 0.5, model.elevAt(t.x, t.y));
      const dx = q.x - px;
      const dy = q.y - py;
      const len = Math.hypot(dx, dy);
      let d = carry;
      while (d < len) {
        const f = d / len;
        g.circle(px + dx * f, py + dy * f, 1.7).fill({ color: 0xffe08a, alpha: 0.9 });
        d += spacing;
      }
      carry = d - len;
      px = q.x;
      py = q.y;
    }
    const last = path[Math.min(path.length, n) - 1]!;
    if (model.inBounds(last.x, last.y)) {
      const p = tileToScreen(last.x, last.y, model.elevAt(last.x, last.y));
      const pts = diamondPoints(1, 1, 3).map((v, i) => v + (i % 2 === 0 ? p.x : p.y));
      g.poly(pts).stroke({ width: 1.6, color: 0xffe08a, alpha: 0.5 + 0.4 * Math.sin(timeSec * 5), join: 'round' });
    }
  }

  private strokeSelection(g: Graphics, w: number, h: number): void {
    const pts = diamondPoints(w, h, 1);
    g.poly(pts).fill({ color: 0xffd45e, alpha: 0.12 });
    for (const [width, a] of [
      [8, 0.08],
      [5, 0.16],
      [3, 0.3],
    ] as const) {
      g.poly(pts).stroke({ width, color: 0xffc94a, alpha: a, join: 'round' });
    }
    g.poly(pts).stroke({ width: 1.6, color: 0xfff1b8, alpha: 1, join: 'round' });
    // corner ticks
    for (let i = 0; i < 4; i++) {
      const x = pts[i * 2]!;
      const y = pts[i * 2 + 1]!;
      g.circle(x, y, 2.6).fill({ color: 0xffe9a0, alpha: 1 });
    }
  }

  private footprintElevation(model: TerrainModel, ox: number, oy: number, w: number, h: number): number {
    let e = 0;
    for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + w; x++) e = Math.max(e, model.elevAt(x, y));
    return e;
  }

  private drawGhost(gh: PlacementGhost, model: TerrainModel): void {
    const g = this.ghostTiles;
    g.clear();
    for (const t of gh.tiles) {
      if (!model.inBounds(t.x, t.y)) continue;
      const e = model.elevAt(t.x, t.y);
      const p = tileToScreen(t.x, t.y, e);
      const pts = diamondPoints(1, 1, 0.5).map((v, i) => v + (i % 2 === 0 ? p.x : p.y));
      g.poly(pts).fill({ color: t.ok ? 0x74e082 : 0xe85d5d, alpha: 0.42 });
      g.poly(pts).stroke({ width: 1.5, color: t.ok ? 0xc8ffd0 : 0xffc2c2, alpha: 0.9, join: 'round' });
    }
    const def = BUILDING_DEFS[gh.buildingType];
    const { w, h } = def.footprint;
    const e = this.footprintElevation(model, gh.origin.x, gh.origin.y, w, h);
    const c = tileToScreen(gh.origin.x + w / 2, gh.origin.y + h / 2, e);
    this.ghostBuilding.position.set(c.x, c.y);
    setTex(this.ghostBuilding, buildingTexture(this.tex, gh.buildingType, 0, 3));
    this.ghostBuilding.tint = gh.ok ? 0xd8ffe0 : 0xffa8a8;
  }

  private drawMapOverlay(state: Readonly<GameState>, model: TerrainModel, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const g = this.mapOverlay;
    g.clear();
    if (this.overlayMode === 'none') return;
    const world = state.world;
    // tile range covering the view (generous: elevation shifts things up to ~6 levels)
    const corners = [
      [view.x0, view.y0],
      [view.x1, view.y0],
      [view.x0, view.y1 + 90],
      [view.x1, view.y1 + 90],
    ] as const;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [sx, sy] of corners) {
      const tx = (sy / 16 + sx / 32) / 2;
      const ty = (sy / 16 - sx / 32) / 2;
      minX = Math.min(minX, tx);
      maxX = Math.max(maxX, tx);
      minY = Math.min(minY, ty);
      maxY = Math.max(maxY, ty);
    }
    const x0 = Math.max(0, Math.floor(minX) - 1);
    const x1 = Math.min(world.width - 1, Math.ceil(maxX) + 1);
    const y0 = Math.max(0, Math.floor(minY) - 1);
    const y1 = Math.min(world.height - 1, Math.ceil(maxY) + 1);
    const shape = diamondPoints(1, 1, 1.5);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * world.width + x;
        const t = world.terrain[i] as Terrain;
        let color = -1;
        let alpha = 0.32;
        if (this.overlayMode === 'resources') {
          const res = world.resource[i] ?? 0;
          if (res > 0) {
            color = t === Terrain.Forest ? 0x3fd06a : 0xcfd8e4;
            alpha = 0.22 + Math.min(0.3, res / 160);
          }
        } else if (this.overlayMode === 'buildable') {
          const ok = TERRAIN_DEFS[t]?.buildable && !(world.building[i] ?? 0);
          color = ok ? 0x6be07c : 0xd85a5a;
          alpha = ok ? 0.26 : 0.12;
        }
        if (color < 0) continue;
        const p = tileToScreen(x, y, model.elevAt(x, y));
        const pts = shape.map((v, k) => v + (k % 2 === 0 ? p.x : p.y));
        g.poly(pts).fill({ color, alpha });
      }
    }
  }
}
