/** Pooled "+2 wood" style floating labels: an icon plus a number that drift up and fade out. */
import { Container, Sprite, Text, type Texture } from 'pixi.js';
import type { ResourceType } from '../../sim';
import type { TextureSet } from '../textures';

interface Floater {
  root: Container;
  icon: Sprite;
  label: Text;
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
}

const POOL = 28;
const LIFE = 1.5;

export class FloatText {
  private readonly pool: Floater[] = [];
  private readonly tex: TextureSet;
  private cursor = 0;

  constructor(layer: Container, tex: TextureSet) {
    this.tex = tex;
    for (let i = 0; i < POOL; i++) {
      const root = new Container();
      root.visible = false;
      const icon = new Sprite(tex.resIcons.wood);
      const label = new Text({
        text: '',
        style: { fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif', fontSize: 13, fontWeight: '700', fill: 0xfff6dc, stroke: { color: 0x2a1e18, width: 3, join: 'round' } },
        resolution: 2,
      });
      label.anchor.set(0, 0.5);
      icon.anchor.set(0.5);
      root.addChild(icon, label);
      layer.addChild(root);
      this.pool.push({ root, icon, label, alive: false, age: 0, life: LIFE, x: 0, y: 0 });
    }
  }

  clear(): void {
    for (const f of this.pool) {
      f.alive = false;
      f.root.visible = false;
    }
  }

  /** Spawn a label at world pixel (x, y). */
  spawn(x: number, y: number, text: string, icon: Texture | null, tint = 0xfff6dc): void {
    const f = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % POOL;
    f.alive = true;
    f.age = 0;
    f.life = LIFE;
    f.x = x;
    f.y = y;
    f.label.text = text;
    f.label.style.fill = tint;
    if (icon) {
      f.icon.texture = icon;
      f.icon.visible = true;
      f.icon.position.set(-4, 0);
      f.label.position.set(4, 0);
      f.root.pivot.set(0, 0);
    } else {
      f.icon.visible = false;
      f.label.position.set(-f.label.width / 2, 0);
    }
    f.root.position.set(x, y);
    f.root.alpha = 0;
    f.root.visible = true;
  }

  resource(x: number, y: number, resource: ResourceType, amount: number, prefix = '+'): void {
    this.spawn(x, y, `${prefix}${Math.round(amount * 10) / 10}`, this.tex.resIcons[resource]);
  }

  update(dt: number): void {
    for (const f of this.pool) {
      if (!f.alive) continue;
      f.age += dt;
      if (f.age >= f.life) {
        f.alive = false;
        f.root.visible = false;
        continue;
      }
      const k = f.age / f.life;
      f.root.position.y = f.y - 26 * (1 - Math.pow(1 - k, 2));
      f.root.alpha = k < 0.12 ? k / 0.12 : k > 0.7 ? (1 - k) / 0.3 : 1;
      const s = k < 0.12 ? 0.8 + (k / 0.12) * 0.3 : 1.1 - 0.1 * Math.min(1, (k - 0.12) * 4);
      f.root.scale.set(s);
    }
  }
}
