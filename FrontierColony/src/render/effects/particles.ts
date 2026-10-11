/**
 * Pooled sprite particles. A fixed pool of sprites is allocated up front; spawning takes a free slot
 * and updating only touches live ones, so no per-frame allocation happens in steady state.
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { TextureSet } from '../textures';

interface Particle {
  sprite: Sprite;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  alpha0: number;
  alpha1: number;
  spin: number;
  /** Fade in over this fraction of the life. */
  fadeIn: number;
}

const POOL_SIZE = 900;

export interface EmitOptions {
  vx?: number;
  vy?: number;
  gravity?: number;
  drag?: number;
  life?: number;
  size0?: number;
  size1?: number;
  alpha0?: number;
  alpha1?: number;
  spin?: number;
  tint?: number;
  rotation?: number;
  fadeIn?: number;
}

export class Particles {
  private readonly pool: Particle[] = [];
  private cursor = 0;
  private readonly tex: TextureSet;

  constructor(layer: Container, tex: TextureSet) {
    this.tex = tex;
    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = new Sprite(tex.fx.dot);
      sprite.visible = false;
      layer.addChild(sprite);
      this.pool.push({ sprite, alive: false, x: 0, y: 0, vx: 0, vy: 0, gravity: 0, drag: 0, age: 0, life: 1, size0: 1, size1: 1, alpha0: 1, alpha1: 0, spin: 0, fadeIn: 0 });
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
      p.sprite.visible = false;
    }
  }

  emit(texture: Texture, x: number, y: number, o: EmitOptions = {}): void {
    // find a free slot starting at the cursor (ring buffer: overwrite the oldest when full)
    let p: Particle | null = null;
    for (let i = 0; i < POOL_SIZE; i++) {
      const c = this.pool[(this.cursor + i) % POOL_SIZE]!;
      if (!c.alive) {
        p = c;
        this.cursor = (this.cursor + i + 1) % POOL_SIZE;
        break;
      }
    }
    if (!p) {
      p = this.pool[this.cursor]!;
      this.cursor = (this.cursor + 1) % POOL_SIZE;
    }
    p.alive = true;
    p.x = x;
    p.y = y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.age = 0;
    p.life = o.life ?? 0.8;
    p.size0 = o.size0 ?? 1;
    p.size1 = o.size1 ?? p.size0;
    p.alpha0 = o.alpha0 ?? 1;
    p.alpha1 = o.alpha1 ?? 0;
    p.spin = o.spin ?? 0;
    p.fadeIn = o.fadeIn ?? 0;
    const s = p.sprite;
    s.texture = texture;
    s.tint = o.tint ?? 0xffffff;
    s.rotation = o.rotation ?? 0;
    s.position.set(x, y);
    s.scale.set(p.size0);
    s.alpha = p.alpha0;
    s.visible = true;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      const k = p.age / p.life;
      if (p.drag > 0) {
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d;
        p.vy *= d;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const s = p.sprite;
      s.position.set(p.x, p.y);
      s.scale.set(p.size0 + (p.size1 - p.size0) * k);
      let a = p.alpha0 + (p.alpha1 - p.alpha0) * k;
      if (p.fadeIn > 0 && k < p.fadeIn) a *= k / p.fadeIn;
      s.alpha = a;
      if (p.spin !== 0) s.rotation += p.spin * dt;
    }
  }

  // --- ready-made bursts -----------------------------------------------------------------------

  woodChips(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 40 + Math.random() * 50;
      this.emit(this.tex.fx.chip, x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        gravity: 260,
        life: 0.55 + Math.random() * 0.3,
        size0: 0.9 + Math.random() * 0.5,
        alpha0: 1,
        alpha1: 0.2,
        spin: (Math.random() - 0.5) * 18,
        tint: Math.random() < 0.5 ? 0xe2b57c : 0xb98650,
        rotation: Math.random() * 6,
      });
    }
  }

  stoneChips(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 35 + Math.random() * 55;
      this.emit(this.tex.fx.chip, x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        gravity: 280,
        life: 0.5 + Math.random() * 0.3,
        size0: 0.7 + Math.random() * 0.5,
        alpha1: 0.1,
        spin: (Math.random() - 0.5) * 20,
        tint: Math.random() < 0.5 ? 0xb9b6b0 : 0x8a8884,
        rotation: Math.random() * 6,
      });
    }
    this.dust(x, y + 1, 0xcfc8bc, 2);
  }

  dust(x: number, y: number, tint = 0xd9cbb0, n = 3, size = 0.5): void {
    for (let i = 0; i < n; i++) {
      this.emit(this.tex.fx.puff, x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 3, {
        vx: (Math.random() - 0.5) * 16,
        vy: -6 - Math.random() * 10,
        drag: 1.2,
        life: 0.7 + Math.random() * 0.4,
        size0: size * 0.5,
        size1: size * (1 + Math.random() * 0.6),
        alpha0: 0.55,
        alpha1: 0,
        tint,
        fadeIn: 0.15,
      });
    }
  }

  sparks(x: number, y: number, n = 4, tint = 0xffd36b): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const sp = 40 + Math.random() * 60;
      this.emit(this.tex.fx.spark, x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        gravity: 200,
        life: 0.3 + Math.random() * 0.25,
        size0: 0.55,
        size1: 0.1,
        tint,
        alpha1: 0.2,
      });
    }
  }

  smoke(x: number, y: number, strength = 1): void {
    this.emit(this.tex.fx.puff, x + (Math.random() - 0.5) * 2, y, {
      vx: 4 + Math.random() * 5,
      vy: -13 - Math.random() * 6,
      drag: 0.15,
      life: 2.6 + Math.random() * 1.2,
      size0: 0.28,
      size1: 0.95 + strength * 0.2,
      alpha0: 0.5 * Math.min(1, strength),
      alpha1: 0,
      tint: 0xe8e4de,
      fadeIn: 0.12,
    });
  }

  leaves(x: number, y: number, n = 5, tint = 0x74b24f): void {
    for (let i = 0; i < n; i++) {
      this.emit(this.tex.fx.leaf, x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 8, {
        vx: (Math.random() - 0.5) * 28,
        vy: -10 - Math.random() * 14,
        gravity: 55,
        drag: 0.8,
        life: 0.9 + Math.random() * 0.6,
        size0: 0.8 + Math.random() * 0.4,
        alpha1: 0,
        spin: (Math.random() - 0.5) * 8,
        tint: i % 2 ? tint : 0x4f8a3c,
        rotation: Math.random() * 6,
      });
    }
  }

  /** Celebratory burst: stars and a puff of dust. */
  celebrate(x: number, y: number): void {
    const cols = [0xffe28a, 0xffffff, 0xffb86b, 0x9be7ff];
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 70;
      this.emit(this.tex.fx.spark, x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6 - 30,
        gravity: 90,
        drag: 0.6,
        life: 0.9 + Math.random() * 0.7,
        size0: 0.45 + Math.random() * 0.5,
        size1: 0.1,
        tint: cols[i % cols.length]!,
        alpha1: 0,
      });
    }
    this.dust(x, y + 6, 0xe8dcc4, 6, 0.9);
  }

  zzz(x: number, y: number): void {
    this.emit(this.tex.fx.z, x, y, {
      vx: 7,
      vy: -14,
      life: 1.9,
      size0: 0.6,
      size1: 1.1,
      alpha0: 0,
      alpha1: 0,
      fadeIn: 0.25,
    });
  }
}
