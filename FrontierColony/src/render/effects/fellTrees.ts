/** Felled-tree animation: a tree shakes, topples and fades while its tile loses a tree. */
import { Sprite } from 'pixi.js';
import type { DepthLayer } from '../depthLayer';
import type { TextureSet } from '../textures';
import type { Particles } from './particles';
import { setTex } from '../util/sprite';

interface Fall {
  sprite: Sprite;
  age: number;
  dir: number;
  x: number;
  y: number;
  leaves: boolean;
  landed: boolean;
}

const SHAKE = 0.5;
const FALL = 0.7;
const FADE = 0.45;

export class FellTrees {
  private readonly active: Fall[] = [];
  private readonly spare: Sprite[] = [];

  private readonly depth: DepthLayer;
  private readonly tex: TextureSet;
  private readonly particles: Particles;

  constructor(depth: DepthLayer, tex: TextureSet, particles: Particles) {
    this.depth = depth;
    this.tex = tex;
    this.particles = particles;
  }

  clear(): void {
    for (const f of this.active) {
      this.depth.remove(f.sprite);
      f.sprite.destroy();
    }
    this.active.length = 0;
  }

  /** species 0 oak, 1 pine, 2 birch. (x, y) is the tile-centre world pixel, `z` its depth key. */
  start(x: number, y: number, z: number, species: number, seed: number): void {
    if (this.active.length > 14) return;
    const arr = species === 0 ? this.tex.trees.oak : species === 1 ? this.tex.trees.pine : this.tex.trees.birch;
    const sprite = this.spare.pop() ?? new Sprite();
    setTex(sprite, arr[0]![seed % arr[0]!.length]!);
    sprite.position.set(x, y + 1);
    sprite.rotation = 0;
    sprite.alpha = 1;
    sprite.zIndex = z + 0.05;
    this.depth.place(sprite);
    this.active.push({ sprite, age: 0, dir: seed % 2 === 0 ? 1 : -1, x, y, leaves: false, landed: false });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i]!;
      f.age += dt;
      const s = f.sprite;
      if (f.age < SHAKE) {
        const k = f.age / SHAKE;
        s.rotation = Math.sin(f.age * 46) * 0.06 * k;
        if (!f.leaves && k > 0.2) {
          f.leaves = true;
          this.particles.leaves(f.x, f.y - 30, 6);
        }
      } else if (f.age < SHAKE + FALL) {
        const k = (f.age - SHAKE) / FALL;
        s.rotation = f.dir * 1.52 * k * k;
      } else {
        if (!f.landed) {
          f.landed = true;
          this.particles.dust(f.x + f.dir * 22, f.y + 4, 0xd9cbb0, 4, 0.7);
          this.particles.leaves(f.x + f.dir * 18, f.y - 6, 5);
        }
        const k = (f.age - SHAKE - FALL) / FADE;
        s.alpha = Math.max(0, 1 - k);
        if (k >= 1) {
          this.depth.remove(s);
          this.spare.push(s);
          this.active.splice(i, 1);
        }
      }
    }
  }
}
