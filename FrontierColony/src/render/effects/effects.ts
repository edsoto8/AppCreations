/** Gameplay feedback: maps SimEvents (and tile changes) onto particles, floating text and tree falls. */
import { Container, Sprite } from 'pixi.js';
import type { SimEvent } from '../../sim';
import type { DepthLayer } from '../depthLayer';
import type { Layers } from '../layers';
import type { TextureSet } from '../textures';
import { FellTrees } from './fellTrees';
import { FloatText } from './floatText';
import { Particles } from './particles';

export interface Locator {
  /** World pixel of the centre of a tile (continuous tile coords allowed). */
  tilePx(x: number, y: number): { x: number; y: number };
  /** Footprint centre on the ground and the approximate roof height of a building. */
  building(id: number): { x: number; y: number; height: number; w: number; h: number } | null;
  settler(id: number): { x: number; y: number } | null;
}

interface Fire {
  x: number;
  y: number;
  age: number;
  burn: number;
  next: number;
}

interface Scar {
  sprite: Sprite;
  age: number;
}

interface Arrival {
  id: number;
  age: number;
  greeted: boolean;
  next: number;
}

/** Seconds a wildfire tile burns, then stays charred before the ground recovers. */
const BURN = 22;
const SCAR_HOLD = 70;
const SCAR_FADE = 110;

export class Effects {
  readonly particles: Particles;
  readonly floats: FloatText;
  readonly fell: FellTrees;
  private readonly loc: Locator;
  private readonly tex: TextureSet;
  private readonly scarLayer: Container;
  private readonly fires: Fire[] = [];
  private readonly scars: Scar[] = [];
  private readonly arrivals: Arrival[] = [];

  constructor(layers: Layers, depth: DepthLayer, tex: TextureSet, loc: Locator) {
    this.tex = tex;
    this.scarLayer = layers.decals;
    this.particles = new Particles(layers.effects, tex);
    this.floats = new FloatText(layers.labels, tex);
    this.fell = new FellTrees(depth, tex, this.particles);
    this.loc = loc;
  }

  clear(): void {
    for (const sc of this.scars) sc.sprite.destroy();
    this.scars.length = 0;
    this.fires.length = 0;
    this.arrivals.length = 0;
    this.particles.clear();
    this.floats.clear();
    this.fell.clear();
  }

  /** Burning tiles (world px) for the night-light pass. */
  activeFires(): readonly Fire[] {
    return this.fires;
  }

  /** Start a wildfire over these tiles: flames and smoke now, charred ground that slowly recovers. */
  startFire(tiles: readonly { x: number; y: number }[]): void {
    for (const t of tiles) {
      const p = this.loc.tilePx(t.x + 0.5, t.y + 0.5);
      this.fires.push({ x: p.x, y: p.y, age: -Math.random() * 3, burn: BURN * (0.7 + Math.random() * 0.6), next: 0 });
      const sprite = new Sprite(this.tex.fx.ash[(t.x * 7 + t.y * 3) % this.tex.fx.ash.length]!);
      sprite.position.set(p.x, p.y);
      sprite.alpha = 0;
      this.scarLayer.addChild(sprite);
      this.scars.push({ sprite, age: -Math.random() * 3 });
    }
  }

  private updateFires(dt: number): void {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]!;
      f.age += dt;
      if (f.age < 0) continue;
      if (f.age > f.burn) {
        this.fires.splice(i, 1);
        continue;
      }
      f.next -= dt;
      const intensity = Math.min(1, f.age / 3) * (1 - Math.max(0, (f.age - f.burn * 0.7) / (f.burn * 0.3)));
      if (f.next <= 0) {
        f.next = 0.1 + Math.random() * 0.1;
        const n = 1 + (intensity > 0.6 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          this.particles.flame(f.x + (Math.random() - 0.5) * 36, f.y + (Math.random() - 0.5) * 12 - 4, 0.7 + intensity * 0.7);
        }
        if (Math.random() < 0.5) this.particles.darkSmoke(f.x, f.y - 16);
        if (Math.random() < 0.12) this.particles.sparks(f.x, f.y - 10, 2, 0xff9a40);
      }
    }
    for (let i = this.scars.length - 1; i >= 0; i--) {
      const sc = this.scars[i]!;
      sc.age += dt;
      if (sc.age < 0) continue;
      const a = sc.age < 6 ? sc.age / 6 : sc.age < SCAR_HOLD ? 1 : 1 - (sc.age - SCAR_HOLD) / SCAR_FADE;
      sc.sprite.alpha = Math.max(0, a) * 0.92;
      if (a <= 0) {
        sc.sprite.destroy();
        this.scars.splice(i, 1);
      }
    }
  }

  private updateArrivals(dt: number): void {
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      const a = this.arrivals[i]!;
      a.age += dt;
      if (a.age > 7) {
        this.arrivals.splice(i, 1);
        continue;
      }
      const p = this.loc.settler(a.id);
      if (!p) continue;
      if (!a.greeted) {
        a.greeted = true;
        this.particles.sparks(p.x, p.y - 16, 10, 0xfff1b0);
        this.floats.spawn(p.x, p.y - 44, 'Newcomer!', null, 0xfff1b0);
      }
      a.next -= dt;
      if (a.next <= 0) {
        a.next = 0.22;
        this.particles.dust(p.x, p.y + 1, 0xd9cbb0, 1, 0.38);
      }
    }
  }

  update(dt: number): void {
    this.updateFires(dt);
    this.updateArrivals(dt);
    this.particles.update(dt);
    this.floats.update(dt);
    this.fell.update(dt);
  }

  handle(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'resourceGathered': {
          const p = this.loc.tilePx(e.x + 0.5, e.y + 0.5);
          this.floats.resource(p.x, p.y - 30, e.resource, e.amount);
          if (e.resource === 'stone') this.particles.stoneChips(p.x, p.y - 8, 4);
          break;
        }
        case 'resourceProduced': {
          const b = this.loc.building(e.buildingId);
          if (b) this.floats.resource(b.x, b.y - b.height - 6, e.resource, e.amount);
          break;
        }
        case 'constructionWork': {
          const b = this.loc.building(e.buildingId);
          if (b) {
            const rx = (Math.random() - 0.5) * b.w * 30;
            this.particles.sparks(b.x + rx, b.y - b.height * 0.35, 3, 0xffe29a);
            this.particles.dust(b.x + rx, b.y - 4, 0xd9cbb0, 2, 0.45);
          }
          break;
        }
        case 'buildingPlaced': {
          const b = this.loc.building(e.buildingId);
          if (b) this.particles.dust(b.x, b.y, 0xd9cbb0, 7, 0.8);
          break;
        }
        case 'buildingCompleted':
        case 'buildingRepaired': {
          const b = this.loc.building(e.buildingId);
          if (b) this.particles.celebrate(b.x, b.y - b.height * 0.6);
          break;
        }
        case 'buildingDamaged': {
          const b = this.loc.building(e.buildingId);
          if (b) {
            this.particles.dust(b.x, b.y - b.height * 0.6, 0xcdbfa6, 8, 1);
            this.particles.woodChips(b.x, b.y - b.height * 0.7, 10);
            this.particles.darkSmoke(b.x, b.y - b.height * 0.7);
          }
          break;
        }
        case 'settlerArrived':
          this.arrivals.push({ id: e.settlerId, age: 0, greeted: false, next: 0 });
          break;
        case 'buildingRemoved': {
          const b = this.loc.building(e.buildingId);
          if (b) this.particles.dust(b.x, b.y - 6, 0xcdbfa6, 8, 0.9);
          break;
        }
        default:
          break;
      }
    }
  }
}
