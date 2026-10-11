/**
 * Settlers and buildings. Both live in the depth-sorted `objects` layer next to trees and raised
 * terrain; their zIndex comes from `isoDepth`. M3 / M4 replace the simple art with animated sprites,
 * the structure (views keyed by entity id, updated from GameState each frame) stays.
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { BUILDING_DEFS, type Building, type GameState, type Settler } from '../../sim';
import { isoDepth, tileToScreen } from '../../shared/iso';
import type { Selection } from '../../shared/types';
import type { DepthLayer } from '../depthLayer';
import type { TerrainModel } from '../terrain/model';
import type { TextureSet } from '../textures';
import { clamp } from '../util/noise';
import { buildingHeight, drawBuilding } from './buildingArt';
import { P } from './isoDraw';

const SKIN = [0xf6d5b8, 0xeac09a, 0xd9a577, 0xc58c5e, 0xa9714a, 0x8a5636, 0x6c4129, 0xf2cdbd];
const HAIR = [0x2b1d16, 0x4a3022, 0x70492d, 0xa8742f, 0xd6b25e, 0xb5502f, 0x8c8c90, 0xe8e0d0];
const SHIRT = [0xd9604f, 0x4f86c6, 0x6aa84f, 0xe0b040, 0x9b6bc4, 0xe8e2d2, 0x3f9d95, 0xd9814f];

interface SettlerView {
  id: number;
  root: Container;
  body: Container;
  ring: Sprite;
  phase: number;
  x: number;
  y: number;
  seen: boolean;
}

interface BuildingView {
  id: number;
  root: Container;
  g: Graphics;
  key: string;
  seen: boolean;
}

export interface SettlerHit {
  id: number;
  dist: number;
}

export class EntityLayer {
  private readonly settlers = new Map<number, SettlerView>();
  private readonly buildings = new Map<number, BuildingView>();
  private selection: Selection | null = null;

  private readonly depth: DepthLayer;
  private readonly tex: TextureSet;
  private readonly model: () => TerrainModel | null;

  constructor(depth: DepthLayer, tex: TextureSet, model: () => TerrainModel | null) {
    this.depth = depth;
    this.tex = tex;
    this.model = model;
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel;
  }

  clear(): void {
    for (const v of this.settlers.values()) v.root.destroy({ children: true });
    for (const v of this.buildings.values()) v.root.destroy({ children: true });
    this.settlers.clear();
    this.buildings.clear();
  }

  destroy(): void {
    this.clear();
  }

  /** Smoothed ground height (in levels) at a continuous world position. */
  sampleElevation(px: number, py: number): number {
    const m = this.model();
    if (!m) return 0;
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const e00 = m.elevAt(x0, y0);
    const e10 = m.elevAt(x0 + 1, y0);
    const e01 = m.elevAt(x0, y0 + 1);
    const e11 = m.elevAt(x0 + 1, y0 + 1);
    return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
  }

  update(state: Readonly<GameState>, alpha: number, timeSec: number): void {
    this.updateBuildings(state);
    this.updateSettlers(state, alpha, timeSec);
  }

  // --- buildings -------------------------------------------------------------------------------

  private updateBuildings(state: Readonly<GameState>): void {
    const m = this.model();
    if (!m) return;
    for (const v of this.buildings.values()) v.seen = false;
    for (const b of state.buildings) {
      let v = this.buildings.get(b.id);
      if (!v) {
        const root = new Container();
        const g = new Graphics();
        root.addChild(g);
        this.depth.place(root);
        v = { id: b.id, root, g, key: '', seen: true };
        this.buildings.set(b.id, v);
      }
      v.seen = true;
      const w = b.footprint.w;
      const h = b.footprint.h;
      let e = 0;
      for (let y = b.origin.y; y < b.origin.y + h; y++) for (let x = b.origin.x; x < b.origin.x + w; x++) e = Math.max(e, m.elevAt(x, y));
      const c = tileToScreen(b.origin.x + w / 2, b.origin.y + h / 2, e);
      v.root.position.set(c.x, c.y);
      this.depth.setDepth(v.root, isoDepth(b.origin.x + w / 2, b.origin.y + h / 2) + 0.5);
      const progress = b.construction ? b.construction.progress : 1;
      const ripe = b.type === 'farm' ? clamp(b.productionProgress, 0, 1) : 1;
      const key = `${b.status}:${Math.round(progress * 24)}:${Math.round(ripe * 4)}:${e}`;
      if (key !== v.key) {
        v.key = key;
        v.g.clear();
        this.drawFoundation(v.g, m, b, e);
        drawBuilding(v.g, b.type, w, h, b.status === 'construction', progress, ripe);
      }
    }
    for (const [id, v] of this.buildings) {
      if (!v.seen) {
        v.root.destroy({ children: true });
        this.buildings.delete(id);
      }
    }
  }

  /** When a building stands on uneven ground, draw a stone plinth down to the lowest tile. */
  private drawFoundation(g: Graphics, m: TerrainModel, b: Building, top: number): void {
    let low = top;
    for (let y = b.origin.y; y < b.origin.y + b.footprint.h; y++) for (let x = b.origin.x; x < b.origin.x + b.footprint.w; x++) low = Math.min(low, m.elevAt(x, y));
    if (low >= top) return;
    const drop = (top - low) * 12;
    const hu = b.footprint.w / 2;
    const hv = b.footprint.h / 2;
    const l = P(-hu, hv, 0);
    const bt = P(hu, hv, 0);
    const r = P(hu, -hv, 0);
    g.poly([l.x, l.y, bt.x, bt.y, bt.x, bt.y + drop, l.x, l.y + drop]).fill(0x866c52).stroke({ width: 1, color: 0x4a443c, alpha: 0.5 });
    g.poly([bt.x, bt.y, r.x, r.y, r.x, r.y + drop, bt.x, bt.y + drop]).fill(0x6a5340).stroke({ width: 1, color: 0x4a443c, alpha: 0.5 });
  }

  // --- settlers --------------------------------------------------------------------------------

  private makeSettler(s: Settler): SettlerView {
    const root = new Container();
    const shadow = new Sprite(this.tex.softShadow);
    shadow.scale.set(0.62);
    const body = new Container();
    const legs = new Sprite(this.tex.settler.legs);
    legs.y = 0;
    const torso = new Sprite(this.tex.settler.torso);
    torso.tint = SHIRT[s.appearance.shirt % SHIRT.length] ?? 0xffffff;
    torso.y = -5.5;
    const head = new Sprite(this.tex.settler.head);
    head.tint = SKIN[s.appearance.skin % SKIN.length] ?? 0xf0c8a8;
    head.y = -12.5;
    const hair = new Sprite(this.tex.settler.hair);
    hair.tint = HAIR[s.appearance.hair % HAIR.length] ?? 0x4a3022;
    hair.y = -12.5;
    body.addChild(legs, torso, head, hair);
    const ring = new Sprite(this.tex.selectionRing);
    ring.visible = false;
    root.addChild(ring, shadow, body);
    this.depth.place(root);
    return { id: s.id, root, body, ring, phase: (s.id * 1.7) % 6.28, x: s.pos.x, y: s.pos.y, seen: true };
  }

  private updateSettlers(state: Readonly<GameState>, alpha: number, timeSec: number): void {
    for (const v of this.settlers.values()) v.seen = false;
    const selId = this.selection?.kind === 'settler' ? this.selection.id : -1;
    for (const s of state.settlers) {
      let v = this.settlers.get(s.id);
      if (!v) {
        v = this.makeSettler(s);
        this.settlers.set(s.id, v);
      }
      v.seen = true;
      const x = s.prevPos.x + (s.pos.x - s.prevPos.x) * alpha;
      const y = s.prevPos.y + (s.pos.y - s.prevPos.y) * alpha;
      v.x = x;
      v.y = y;
      const e = this.sampleElevation(x, y);
      const p = tileToScreen(x, y, e);
      const moving = Math.hypot(s.pos.x - s.prevPos.x, s.pos.y - s.prevPos.y) > 1e-4;
      const bob = moving ? Math.abs(Math.sin(timeSec * 11 + v.phase)) * 1.8 : Math.sin(timeSec * 1.6 + v.phase) * 0.35;
      v.body.y = -bob;
      v.root.position.set(p.x, p.y);
      // never sink behind the tile top we are standing on
      this.depth.setDepth(v.root, Math.max(isoDepth(x, y), Math.floor(x) + Math.floor(y) + 0.6) + 0.02);
      v.ring.visible = s.id === selId;
      if (v.ring.visible) v.ring.scale.set(0.92 + 0.06 * Math.sin(timeSec * 4));
    }
    for (const [id, v] of this.settlers) {
      if (!v.seen) {
        v.root.destroy({ children: true });
        this.settlers.delete(id);
      }
    }
  }

  // --- hit testing -----------------------------------------------------------------------------

  /** Closest settler under the world-pixel point, or null. */
  hitSettler(wx: number, wy: number): SettlerHit | null {
    let best: SettlerHit | null = null;
    for (const v of this.settlers.values()) {
      const px = v.root.position.x;
      const py = v.root.position.y;
      const dx = wx - px;
      const dy = wy - (py - 11);
      if (Math.abs(dx) <= 9 && dy >= -17 && dy <= 15) {
        const dist = Math.hypot(dx, dy);
        if (!best || dist < best.dist) best = { id: v.id, dist };
      }
    }
    return best;
  }

  /** Front-most building whose silhouette contains the world-pixel point, or null. */
  hitBuilding(state: Readonly<GameState>, wx: number, wy: number): number | null {
    const m = this.model();
    if (!m) return null;
    let best: { id: number; depth: number } | null = null;
    for (const b of state.buildings) {
      const v = this.buildings.get(b.id);
      if (!v) continue;
      const def = BUILDING_DEFS[b.type];
      const hu = def.footprint.w / 2;
      const hv = def.footprint.h / 2;
      const H = b.status === 'construction' ? 34 : buildingHeight(b.type);
      const lx = wx - v.root.position.x;
      const ly = wy - v.root.position.y;
      const poly = [P(-hu, hv, 0), P(hu, hv, 0), P(hu, -hv, 0), P(hu, -hv, H), P(-hu, -hv, H), P(-hu, hv, H)];
      if (pointInConvex(poly, lx, ly)) {
        const depth = v.root.zIndex;
        if (!best || depth > best.depth) best = { id: b.id, depth };
      }
    }
    return best ? best.id : null;
  }
}

function pointInConvex(poly: { x: number; y: number }[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}
