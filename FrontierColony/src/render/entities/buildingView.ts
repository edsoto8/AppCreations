/**
 * One building: the baked art sprite plus dynamic extras. A finished building shows its output buffers
 * (log piles, ore, crates, baskets), chimney smoke and farm growth. A construction site shows a
 * staked pad, a faint blueprint, the building rising from the ground, scaffolding and delivered
 * material piles.
 */
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Building, GameState, ResourceType } from '../../sim';
import type { TextureSet } from '../textures';
import { buildingHeight, buildingTexture, farmStage, pileLevel } from './buildingTextures';
import { P } from './isoMath';
import { fixturesFor } from '../atmosphere/lightPoints';
import type { Particles } from '../effects/particles';
import { setTex } from '../util/sprite';

export interface BuildingFx {
  particles: Particles;
}

export class BuildingView {
  readonly id: number;
  readonly type: Building['type'];
  readonly root = new Container();
  private readonly pad: Sprite;
  private readonly blueprint: Sprite;
  private readonly base: Sprite;
  private readonly scaffold = new Graphics();
  private readonly skirt = new Graphics();
  private readonly snowSprite = new Sprite();
  private snowTexKey = '';
  private readonly fixtures: { base: Sprite; flame: Sprite; u: number; v: number; kind: 'campfire' | 'torch'; phase: number }[] = [];
  private drop = -1;
  readonly w: number;
  readonly h: number;
  private readonly piles: Sprite[] = [];
  private readonly tex: TextureSet;
  private key = '';
  private status: Building['status'] | '' = '';
  private smokeAt = 0;
  private pop = 0;
  seen = true;
  /** Tallest visible point above the ground (px), for effects and hit tests. */
  height = 40;

  constructor(b: Building, tex: TextureSet) {
    this.id = b.id;
    this.type = b.type;
    this.tex = tex;
    this.w = b.footprint.w;
    this.h = b.footprint.h;
    this.pad = new Sprite(tex.pads[Math.min(3, Math.max(1, Math.max(b.footprint.w, b.footprint.h))) as 1 | 2 | 3]);
    this.pad.visible = false;
    this.blueprint = new Sprite();
    this.blueprint.alpha = 0.22;
    this.blueprint.tint = 0xa8d4ff;
    this.blueprint.visible = false;
    this.base = new Sprite();
    for (let i = 0; i < 3; i++) {
      const s = new Sprite();
      s.visible = false;
      this.piles.push(s);
    }
    this.snowSprite.visible = false;
    this.root.addChild(this.skirt, this.pad, this.blueprint, this.base, this.snowSprite, this.scaffold, ...this.piles);
    for (const f of fixturesFor(b.type)) {
      const base = new Sprite(f.kind === 'campfire' ? tex.fx.campfire : tex.fx.torch);
      const p = P(f.u, f.v, 0);
      base.position.set(p.x, p.y);
      const flame = new Sprite(tex.fx.flame);
      flame.position.set(p.x, p.y - (f.kind === 'campfire' ? 9 : 31));
      flame.scale.set(f.kind === 'campfire' ? 1.2 : 0.7);
      flame.blendMode = 'add';
      this.root.addChild(base, flame);
      this.fixtures.push({ base, flame, u: f.u, v: f.v, kind: f.kind, phase: Math.random() * 6.28 });
    }
    this.height = buildingHeight(b.type);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  /** Earth skirt down to the lowest footprint tile when the ground is uneven (px of drop). */
  setDrop(px: number): void {
    if (px === this.drop) return;
    this.drop = px;
    const g = this.skirt;
    g.clear();
    if (px <= 0) return;
    const hu = this.w / 2;
    const hv = this.h / 2;
    const l = P(-hu, hv, 0);
    const b = P(hu, hv, 0);
    const r = P(hu, -hv, 0);
    g.poly([l.x, l.y, b.x, b.y, b.x, b.y + px, l.x, l.y + px]).fill(0x86684c).stroke({ width: 1, color: 0x4a3828, alpha: 0.5 });
    g.poly([b.x, b.y, r.x, r.y, r.x, r.y + px, b.x, b.y + px]).fill(0x6a503a).stroke({ width: 1, color: 0x4a3828, alpha: 0.5 });
  }

  /** Brightness flash + scale pop when a site becomes a finished building. */
  update(b: Building, state: Readonly<GameState>, timeSec: number, dt: number, fx: BuildingFx, stockFill: number, snow: number, light: number): void {
    const c = b.construction;
    const building = b.status === 'construction' && c !== null;
    const repair = building && c.kind === 'repair';
    const progress = c ? c.progress : 1;
    const season = state.time.season;
    const stage = b.type === 'farm' ? farmStage(b.productionProgress, season) : 0;
    const outW = b.output.wood;
    const outS = b.output.stone;
    const outF = b.output.food;
    const outT = b.output.tools;
    const delW = c ? c.delivered.wood : 0;
    const delS = c ? c.delivered.stone : 0;
    const delT = c ? c.delivered.tools : 0;
    const key = [b.status, c?.kind ?? '', Math.round(progress * 40), stage, pileLevel(outW, [1, 6, 14, 26]), pileLevel(outS, [1, 6, 14, 26]), pileLevel(outF, [1, 5, 12]), pileLevel(outT, [1, 3, 6]), Math.round(stockFill * 6), pileLevel(delW, [1, 12, 24]), pileLevel(delS, [1, 6, 14]), pileLevel(delT, [1, 2, 4])].join('|');

    if (this.status !== '' && this.status !== b.status && b.status === 'complete') this.pop = 0.5;
    this.status = b.status;

    if (key !== this.key) {
      this.key = key;
      this.rebuild(b, building, repair, progress, stage, { outW, outS, outF, outT, delW, delS, delT }, stockFill);
    }

    // celebratory pop
    if (this.pop > 0) {
      this.pop = Math.max(0, this.pop - dt);
      const k = this.pop / 0.5;
      const s = 1 + Math.sin(k * Math.PI) * 0.045;
      this.base.scale.set(s);
      this.base.tint = k > 0.4 ? 0xfff2cc : 0xffffff;
    } else if (this.base.scale.x !== 1) {
      this.base.scale.set(1);
      this.base.tint = 0xffffff;
    }

    // winter: crossfade the snow-roofed variant over the base art
    const sea = this.tex.seasonal;
    if (sea && !building && snow > 0.02 && b.type !== 'farm') {
      const snowTex = snowTexture(sea.buildingsSnow, b.type, b.id);
      if (snowTex) {
        const key = `${b.type}:${b.id % 3}`;
        if (key !== this.snowTexKey) {
          this.snowTexKey = key;
          setTex(this.snowSprite, snowTex);
        }
        this.snowSprite.visible = true;
        this.snowSprite.alpha = Math.min(1, snow * 1.15);
      }
    } else this.snowSprite.visible = false;

    // fixtures: flames flicker, brighter after dark
    for (const f of this.fixtures) {
      const flick = 0.85 + 0.15 * Math.sin(timeSec * 11 + f.phase) + 0.08 * Math.sin(timeSec * 23 + f.phase * 2);
      const base = f.kind === 'campfire' ? 0.35 : 0.3;
      f.flame.alpha = (base + (1 - base) * light) * Math.min(1, flick);
      const sc = (f.kind === 'campfire' ? 1.0 : 0.62) * (0.7 + 0.5 * light) * flick;
      f.flame.scale.set(sc * (1 + 0.06 * Math.sin(timeSec * 17 + f.phase)), sc * flick);
      f.flame.rotation = Math.sin(timeSec * 5 + f.phase) * 0.08;
    }

    // chimney smoke
    if (!building && timeSec > this.smokeAt) this.smoke(b, state, timeSec, fx);
  }

  private smoke(b: Building, state: Readonly<GameState>, timeSec: number, fx: BuildingFx): void {
    let x = 0;
    let y = 0;
    let strength = 0;
    const hour = state.time.timeOfDay;
    if (b.type === 'house') {
      // hearth burns in the mornings, evenings and all winter
      const cold = state.time.season === 'winter' || state.time.season === 'autumn';
      const cosy = hour < 9 || hour > 16.5;
      strength = cold ? 1 : cosy ? 0.7 : 0.2;
      x = -2;
      y = -66;
    } else if (b.type === 'workshop') {
      strength = b.productionProgress > 0.01 ? 1.2 : 0.3;
      x = 31;
      y = -68;
    } else return;
    this.smokeAt = timeSec + (strength > 0.9 ? 0.5 : strength > 0.5 ? 0.9 : 2.2);
    fx.particles.smoke(this.root.x + x, this.root.y + y, strength);
  }

  private rebuild(
    b: Building,
    building: boolean,
    repair: boolean,
    progress: number,
    stage: number,
    o: { outW: number; outS: number; outF: number; outT: number; delW: number; delS: number; delT: number },
    stockFill: number,
  ): void {
    const tex = this.tex;
    const full = buildingTexture(tex, b.type, b.id, stage);
    const w = b.footprint.w;
    const h = b.footprint.h;
    for (const p of this.piles) p.visible = false;
    this.scaffold.clear();
    const hu = w / 2;
    const hv = h / 2;
    const H = buildingHeight(b.type);

    if (building && !repair) {
      // staked pad, a timber-coloured shell that gives way to the finished building, scaffolding,
      // and the materials delivered so far
      const p = progress;
      const ss = (e0: number, e1: number, x: number): number => {
        const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      this.pad.visible = true;
      this.blueprint.visible = b.type !== 'farm' && p > 0.02;
      setTex(this.blueprint, full);
      this.blueprint.tint = 0xc9a56c;
      this.blueprint.alpha = 0.82 * ss(0.02, 0.2, p) * (1 - ss(0.4, 0.92, p));
      this.base.visible = p > 0.3 || b.type === 'farm';
      setTex(this.base, full);
      this.base.tint = 0xffffff;
      this.base.alpha = b.type === 'farm' ? 0.25 + 0.75 * p : ss(0.3, 0.98, p);
      if (b.type !== 'farm') this.drawScaffold(hu, hv, 0.55 + 0.45 * p, H);
      this.placePile(0, tex.piles.planks, pileLevel(o.delW, [1, 12, 24]), -hu * 0.5, hv + 0.28);
      this.placePile(1, tex.piles.stones, pileLevel(o.delS, [1, 6, 14]), hu + 0.3, hv * 0.2);
      this.placePile(2, tex.piles.crates, pileLevel(o.delT, [1, 2, 4]), -hu - 0.1, hv * 0.55);
      return;
    }

    this.pad.visible = false;
    this.blueprint.visible = false;
    this.base.alpha = 1;
    this.base.visible = true;
    setTex(this.base, full);
    if (repair) this.drawScaffold(hu, hv, 0.35 + 0.65 * (1 - Math.abs(progress - 0.5) * 2), H, true);

    switch (b.type) {
      case 'lumberCamp':
        this.placePile(0, tex.piles.logs, pileLevel(o.outW, [1, 6, 14, 26]), 0.62, -0.38);
        break;
      case 'mine':
        this.placePile(0, tex.piles.stones, pileLevel(o.outS, [1, 6, 14, 26]), 0.82, 0.7);
        break;
      case 'farm':
        this.placePile(0, tex.piles.produce, pileLevel(o.outF, [1, 5, 12]), 1.58, 1.1);
        break;
      case 'workshop':
        this.placePile(0, tex.piles.crates, pileLevel(o.outT, [1, 3, 6]), 1.2, -0.25);
        break;
      case 'storage':
        this.placePile(0, tex.piles.crates, Math.min(3, Math.round(stockFill * 3.4)), 1.05, 1.0);
        break;
      default:
        break;
    }
  }

  private placePile(slot: number, set: Texture[], level: number, u: number, v: number): void {
    const s = this.piles[slot]!;
    if (level <= 0) {
      s.visible = false;
      return;
    }
    setTex(s, set[Math.min(level, set.length) - 1]!);
    const p = P(u, v, 0);
    s.position.set(p.x, p.y);
    s.visible = true;
  }

  /** Light scaffolding: corner poles, a couple of rails on the visible sides and a ladder. */
  private drawScaffold(hu: number, hv: number, progress: number, buildingH: number, repair = false): void {
    const g = this.scaffold;
    const top = Math.max(16, 16 + progress * (buildingH * 0.75));
    const x0 = -hu - 0.06;
    const x1 = hu + 0.06;
    const y0 = -hv - 0.06;
    const y1 = hv + 0.06;
    const pole = (u: number, v: number, hh: number): void => {
      const a = P(u, v, 0);
      const b = P(u, v, hh);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2.4, color: 0x3a281c, alpha: 0.9 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.2, color: 0xc29a62 });
    };
    pole(x0, y1, top);
    pole(x1, y1, top);
    pole(x1, y0, top);
    const rails = Math.min(3, Math.max(1, Math.floor(top / 18)));
    for (let i = 1; i <= rails; i++) {
      const hh = (i / rails) * (top - 3);
      const a = P(x0, y1, hh);
      const b = P(x1, y1, hh);
      const c = P(x1, y0, hh);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).stroke({ width: 2, color: 0x3a281c, alpha: 0.85 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).stroke({ width: 1, color: 0xd2ac72 });
    }
    if (!repair) {
      const d0 = P(x0, y1, 2);
      const d1 = P(x1, y1, top * 0.8);
      g.moveTo(d0.x, d0.y).lineTo(d1.x, d1.y).stroke({ width: 1.1, color: 0xd2ac72, alpha: 0.8 });
    }
  }
}

function snowTexture(set: NonNullable<TextureSet['seasonal']>['buildingsSnow'], type: Building['type'], id: number): Texture | null {
  switch (type) {
    case 'house':
      return set.house[id % set.house.length]!;
    case 'townCenter':
      return set.townCenter;
    case 'storage':
      return set.storage;
    case 'workshop':
      return set.workshop;
    case 'lumberCamp':
      return set.lumberCamp;
    case 'mine':
      return set.mine;
    case 'well':
      return set.well;
    default:
      return null;
  }
}

export function totalOf(r: Record<ResourceType, number>): number {
  return r.wood + r.stone + r.food + r.water + r.tools;
}
