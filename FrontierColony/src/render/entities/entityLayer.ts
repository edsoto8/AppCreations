/**
 * Settlers and buildings. Both live in the depth-sorted objects layer next to trees and raised
 * terrain (see depthLayer.ts); views are keyed by entity id and updated from GameState every frame.
 */
import type { Container } from 'pixi.js';
import { BUILDING_DEFS, getStorageCapacity, type GameState, type Settler } from '../../sim';
import { tileToScreen } from '../../shared/iso';
import type { Selection } from '../../shared/types';
import { buildingDepth, settlerDepth } from '../depthKeys';
import type { DepthLayer } from '../depthLayer';
import type { Effects, Locator } from '../effects/effects';
import type { TerrainModel } from '../terrain/model';
import type { TextureSet } from '../textures';
import { clamp } from '../util/noise';
import { BuildingView } from './buildingView';
import { buildingHeight } from './buildingTextures';
import { P, pointInConvex } from './isoMath';
import { SettlerView, type SettlerEffectsHook } from './settlerView';

export interface SettlerHit {
  id: number;
  dist: number;
}

export class EntityLayer {
  private readonly settlers = new Map<number, SettlerView>();
  private readonly buildings = new Map<number, BuildingView>();
  private selection: Selection | null = null;
  private effects: Effects | null = null;
  private zoom = 1;
  private snow = 0;
  private light = 0;

  private readonly depth: DepthLayer;
  private readonly tex: TextureSet;
  private readonly model: () => TerrainModel | null;
  readonly hook: SettlerEffectsHook;

  constructor(depth: DepthLayer, tex: TextureSet, model: () => TerrainModel | null) {
    this.depth = depth;
    this.tex = tex;
    this.model = model;
    this.hook = {
      strike: (kind, x, y) => {
        const fx = this.effects;
        if (!fx) return;
        switch (kind) {
          case 'chopping':
            fx.particles.woodChips(x, y - 2, 4);
            break;
          case 'mining':
            fx.particles.stoneChips(x, y - 2, 5);
            break;
          case 'building':
            fx.particles.sparks(x, y - 4, 3, 0xffe29a);
            fx.particles.dust(x, y + 2, 0xd9cbb0, 1, 0.4);
            break;
          case 'crafting':
            fx.particles.sparks(x, y - 4, 4, 0xffa95a);
            break;
          case 'farming':
            fx.particles.dust(x, y + 2, 0x9a7650, 2, 0.45);
            break;
          default:
            break;
        }
      },
      zzz: (x, y) => this.effects?.particles.zzz(x, y),
    };
  }

  buildingViews(): IterableIterator<BuildingView> {
    return this.buildings.values();
  }

  /** World-pixel box and depth of every visible settler and building (to redraw baked objects in front of them). */
  forEachBox(cb: (x0: number, y0: number, x1: number, y1: number, z: number) => void): void {
    for (const v of this.settlers.values()) {
      if (v.hidden) continue;
      const x = v.root.position.x;
      const y = v.root.position.y;
      cb(x - 16, y - 46, x + 16, y + 10, v.root.zIndex);
    }
    for (const v of this.buildings.values()) {
      const x = v.root.position.x;
      const y = v.root.position.y;
      const hw = (v.w + v.h) * 16 + 8;
      const hh = (v.w + v.h) * 8;
      cb(x - hw, y - hh - v.height - 28, x + hw, y + hh + 24, v.root.zIndex);
      for (const f of v.fixtures) {
        const fx = f.node.position.x;
        const fy = f.node.position.y;
        cb(fx - 14, fy - 42, fx + 14, fy + 8, f.node.zIndex);
      }
    }
  }

  attachEffects(fx: Effects): void {
    this.effects = fx;
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel;
  }

  clear(): void {
    for (const v of this.settlers.values()) v.destroy();
    for (const v of this.buildings.values()) v.destroy();
    this.settlers.clear();
    this.buildings.clear();
  }

  destroy(): void {
    this.clear();
  }

  locator(): Locator {
    return {
      tilePx: (x, y) => tileToScreen(x, y, this.sampleElevation(x, y)),
      building: (id) => {
        const v = this.buildings.get(id);
        if (!v) return null;
        return { x: v.root.position.x, y: v.root.position.y, height: v.height, w: v.w, h: v.h };
      },
      settler: (id) => {
        const v = this.settlers.get(id);
        return v ? { x: v.root.position.x, y: v.root.position.y } : null;
      },
    };
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

  /** World pixel of a settler's feet (null when unknown). */
  settlerPx(id: number): { x: number; y: number } | null {
    const v = this.settlers.get(id);
    return v ? { x: v.root.position.x, y: v.root.position.y } : null;
  }

  update(state: Readonly<GameState>, alpha: number, timeSec: number, dt: number, zoom: number, animTime: number, snow = 0, light = 0): void {
    this.zoom = zoom;
    this.snow = snow;
    this.light = light;
    this.updateBuildings(state, timeSec, dt);
    this.updateSettlers(state, alpha, timeSec, animTime);
  }

  // --- buildings -------------------------------------------------------------------------------

  private updateBuildings(state: Readonly<GameState>, timeSec: number, dt: number): void {
    const m = this.model();
    const fx = this.effects;
    if (!m || !fx) return;
    for (const v of this.buildings.values()) v.seen = false;
    // overall stock fill (for the storage crates)
    const cap = Math.max(1, getStorageCapacity(state));
    const st = state.colony.stock;
    const fill = clamp(Math.max(st.wood, st.stone, st.food, st.tools) / cap, 0, 1);
    for (const b of state.buildings) {
      let v = this.buildings.get(b.id);
      if (!v) {
        v = new BuildingView(b, this.tex);
        this.buildings.set(b.id, v);
        this.depth.place(v.root);
      }
      v.seen = true;
      const w = b.footprint.w;
      const h = b.footprint.h;
      let hi = 0;
      let lo = 99;
      for (let y = b.origin.y; y < b.origin.y + h; y++) {
        for (let x = b.origin.x; x < b.origin.x + w; x++) {
          const e = m.elevAt(x, y);
          if (e > hi) hi = e;
          if (e < lo) lo = e;
        }
      }
      const c = tileToScreen(b.origin.x + w / 2, b.origin.y + h / 2, hi);
      v.root.position.set(c.x, c.y);
      v.setDrop((hi - lo) * 12);
      this.depth.setDepth(v.root, buildingDepth(b.origin.x, b.origin.y, w, h));
      v.update(b, state, timeSec, dt, fx, fill, this.snow, this.light);
      v.placeFixtures((node, z) => this.depth.setDepth(node, z));
    }
    for (const [id, v] of this.buildings) {
      if (!v.seen) {
        v.destroy();
        this.buildings.delete(id);
      }
    }
  }

  // --- settlers --------------------------------------------------------------------------------

  private updateSettlers(state: Readonly<GameState>, alpha: number, timeSec: number, animTime: number): void {
    const fx = this.effects;
    if (!fx) return;
    for (const v of this.settlers.values()) v.seen = false;
    const selId = this.selection?.kind === 'settler' ? this.selection.id : -1;
    for (const s of state.settlers) {
      let v = this.settlers.get(s.id);
      if (!v) {
        v = new SettlerView(s, this.tex);
        this.settlers.set(s.id, v);
        this.depth.place(v.root);
      }
      v.seen = true;
      const x = s.prevPos.x + (s.pos.x - s.prevPos.x) * alpha;
      const y = s.prevPos.y + (s.pos.y - s.prevPos.y) * alpha;
      const moved = Math.hypot(x - v.x, y - v.y);
      const e = this.sampleElevation(x, y);
      const p = tileToScreen(x, y, e);
      v.root.position.set(p.x, p.y);
      this.depth.setDepth(v.root, settlerDepth(x, y));

      const kind = s.activity.kind;
      let indoors = false;
      const homeId = s.activity.indoorsBuildingId;
      if (homeId !== null) {
        const b = this.buildings.get(homeId);
        if (b) {
          indoors = true;
          if (kind === 'sleeping' && timeSec > v.nextZ) {
            v.nextZ = timeSec + 2.2;
            fx.particles.zzz(b.root.position.x + 6, b.root.position.y - b.height * 0.7);
          }
        }
      }
      v.update(s, x, y, moved > 1 ? 0 : moved, animTime, this.zoom, indoors, this.hook, p.x, p.y, timeSec);
      v.setSelected(s.id === selId, timeSec);
    }
    for (const [id, v] of this.settlers) {
      if (!v.seen) {
        v.destroy();
        this.settlers.delete(id);
      }
    }
  }

  // --- hit testing -----------------------------------------------------------------------------

  /** Closest settler under the world-pixel point, or null. */
  hitSettler(wx: number, wy: number): SettlerHit | null {
    let best: SettlerHit | null = null;
    for (const v of this.settlers.values()) {
      if (v.hidden) continue;
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
    let best: { id: number; depth: number } | null = null;
    for (const b of state.buildings) {
      const v = this.buildings.get(b.id);
      if (!v) continue;
      const def = BUILDING_DEFS[b.type];
      const hu = def.footprint.w / 2;
      const hv = def.footprint.h / 2;
      const H = b.status === 'construction' ? 40 : buildingHeight(b.type);
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

export type { Container, Settler };
