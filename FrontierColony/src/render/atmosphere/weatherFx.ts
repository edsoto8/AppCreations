/**
 * Screen-space weather: rain streaks with ground splashes, drifting snow, storm lightning and
 * world-anchored cloud shadows. Everything is pooled with hard caps; counts scale with intensity and
 * ease in and out so weather never pops.
 */
import { Container, Sprite } from 'pixi.js';
import type { WeatherKind } from '../../sim';
import type { TextureSet } from '../textures';
import { clamp, lerp } from '../util/noise';

const RAIN_CAP = 420;
const SNOW_CAP = 260;
const SPLASH_CAP = 90;
const CLOUD_COUNT = 5;

interface Drop {
  s: Sprite;
  x: number;
  y: number;
  speed: number;
  landY: number;
}

interface Flake {
  s: Sprite;
  x: number;
  y: number;
  speed: number;
  phase: number;
  sway: number;
}

interface Splash {
  s: Sprite;
  age: number;
  alive: boolean;
}

interface Cloud {
  s: Sprite;
  x: number;
  y: number;
  speed: number;
}

export class WeatherFx {
  /** Screen-space particles (rain, snow, splashes). */
  readonly screen = new Container();
  /** World-space cloud shadows (transformed with the camera by the caller). */
  readonly clouds = new Container();
  /** 0..1 white flash from lightning. */
  flash = 0;

  private readonly drops: Drop[] = [];
  private readonly flakes: Flake[] = [];
  private readonly splashes: Splash[] = [];
  private readonly cloudList: Cloud[] = [];
  private rainAmt = 0;
  private snowAmt = 0;
  private cloudAmt = 0;
  private stormAmt = 0;
  private nextFlash = 8;
  private flashStep = 0;
  private flashClock = 0;
  private clock = 0;
  private splashCursor = 0;

  constructor(tex: TextureSet) {
    for (let i = 0; i < RAIN_CAP; i++) {
      const s = new Sprite(tex.fx.streak);
      s.visible = false;
      s.alpha = 0.5;
      this.screen.addChild(s);
      this.drops.push({ s, x: Math.random() * 1600, y: Math.random() * 900, speed: 0.8 + Math.random() * 0.5, landY: 0 });
    }
    for (let i = 0; i < SPLASH_CAP; i++) {
      const s = new Sprite(tex.fx.ring);
      s.visible = false;
      s.tint = 0xdfeeff;
      this.screen.addChild(s);
      this.splashes.push({ s, age: 1, alive: false });
    }
    for (let i = 0; i < SNOW_CAP; i++) {
      const s = new Sprite(tex.fx.dot);
      s.visible = false;
      s.scale.set(0.18 + Math.random() * 0.34);
      s.alpha = 0.55 + Math.random() * 0.4;
      this.screen.addChild(s);
      this.flakes.push({ s, x: Math.random() * 1600, y: Math.random() * 900, speed: 28 + Math.random() * 46, phase: Math.random() * 6.28, sway: 8 + Math.random() * 18 });
    }
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const s = new Sprite(tex.fx.cloud);
      s.tint = 0x142038;
      s.visible = false;
      s.scale.set(2.2 + Math.random() * 1.2, 2 + Math.random() * 0.9);
      this.clouds.addChild(s);
      this.cloudList.push({ s, x: Math.random() * 2000, y: Math.random() * 1200, speed: 10 + Math.random() * 12 });
    }
  }

  /** Current brightness lift from the lightning flash, 0..1. */
  get lightning(): number {
    return this.flash;
  }

  update(kind: WeatherKind, intensity: number, dt: number, screenW: number, screenH: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    this.clock += dt;
    const k = clamp(intensity, 0, 1);
    const ease = 1 - Math.exp(-dt / 1.6);
    const rainT = kind === 'rain' ? 0.35 + 0.65 * k : kind === 'storm' ? 1 : 0;
    const snowT = kind === 'snow' ? 0.3 + 0.7 * k : 0;
    const cloudT = kind === 'cloudy' ? 0.5 + 0.5 * k : kind === 'rain' ? 0.7 : kind === 'storm' ? 1 : kind === 'snow' ? 0.4 : 0;
    this.rainAmt += (rainT - this.rainAmt) * ease;
    this.snowAmt += (snowT - this.snowAmt) * ease;
    this.cloudAmt += (cloudT - this.cloudAmt) * ease;
    this.stormAmt += ((kind === 'storm' ? 1 : 0) - this.stormAmt) * ease;
    if (this.rainAmt < 0.01) this.rainAmt = 0;
    if (this.snowAmt < 0.01) this.snowAmt = 0;
    if (this.cloudAmt < 0.01) this.cloudAmt = 0;
    if (this.stormAmt < 0.01) this.stormAmt = 0;

    this.updateRain(dt, screenW, screenH);
    this.updateSnow(dt, screenW, screenH);
    this.updateClouds(dt, view);
    this.updateLightning(dt);
    this.updateSplashes(dt);
  }

  private updateRain(dt: number, w: number, h: number): void {
    const n = Math.floor(RAIN_CAP * this.rainAmt * (0.45 + 0.55 * this.stormAmt));
    const wind = lerp(-120, -300, this.stormAmt);
    const fall = lerp(640, 900, this.stormAmt);
    const angle = Math.atan2(-wind, fall);
    for (let i = 0; i < RAIN_CAP; i++) {
      const d = this.drops[i]!;
      if (i >= n) {
        d.s.visible = false;
        continue;
      }
      if (!d.s.visible) {
        d.s.visible = true;
        d.x = Math.random() * (w + 200);
        d.y = -Math.random() * h;
        d.landY = h * (0.3 + Math.random() * 0.75);
      }
      d.y += fall * d.speed * dt;
      d.x += wind * d.speed * dt;
      if (d.y >= d.landY) {
        if (d.landY < h) this.spawnSplash(d.x, d.landY);
        d.y = -20 - Math.random() * 60;
        d.x = Math.random() * (w + 240);
        d.landY = h * (0.3 + Math.random() * 0.75);
      }
      d.s.position.set(d.x, d.y);
      d.s.rotation = angle;
      d.s.scale.set(1, 0.7 + this.stormAmt * 0.6);
      d.s.alpha = 0.32 + 0.2 * this.stormAmt;
    }
  }

  private spawnSplash(x: number, y: number): void {
    const sp = this.splashes[this.splashCursor]!;
    this.splashCursor = (this.splashCursor + 1) % SPLASH_CAP;
    sp.alive = true;
    sp.age = 0;
    sp.s.position.set(x, y);
    sp.s.visible = true;
  }

  private updateSplashes(dt: number): void {
    for (const sp of this.splashes) {
      if (!sp.alive) continue;
      sp.age += dt / 0.32;
      if (sp.age >= 1) {
        sp.alive = false;
        sp.s.visible = false;
        continue;
      }
      sp.s.scale.set(0.35 + sp.age * 0.7);
      sp.s.alpha = (1 - sp.age) * 0.55;
    }
  }

  private updateSnow(dt: number, w: number, h: number): void {
    const n = Math.floor(SNOW_CAP * this.snowAmt);
    for (let i = 0; i < SNOW_CAP; i++) {
      const f = this.flakes[i]!;
      if (i >= n) {
        f.s.visible = false;
        continue;
      }
      if (!f.s.visible) {
        f.s.visible = true;
        f.x = Math.random() * w;
        f.y = -Math.random() * h * 0.5;
      }
      f.y += f.speed * dt;
      f.x += Math.sin(this.clock * 0.9 + f.phase) * f.sway * dt - 14 * dt;
      if (f.y > h + 10) {
        f.y = -10;
        f.x = Math.random() * (w + 60);
      }
      if (f.x < -20) f.x = w + 10;
      f.s.position.set(f.x, f.y);
    }
  }

  private updateClouds(dt: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const n = this.cloudAmt > 0 ? CLOUD_COUNT : 0;
    const alpha = 0.2 * this.cloudAmt + 0.1 * this.stormAmt;
    const vw = view.x1 - view.x0;
    const vh = view.y1 - view.y0;
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const c = this.cloudList[i]!;
      if (i >= n) {
        c.s.visible = false;
        continue;
      }
      if (!c.s.visible) {
        c.s.visible = true;
        c.x = view.x0 + Math.random() * vw;
        c.y = view.y0 + Math.random() * vh;
      }
      c.x += c.speed * dt * (1 + this.stormAmt);
      if (c.x - 300 > view.x1) {
        c.x = view.x0 - 400;
        c.y = view.y0 + Math.random() * vh;
      } else if (c.x + 500 < view.x0) {
        c.x = view.x1 + 100;
      }
      if (c.y < view.y0 - 200) c.y = view.y1 + 100;
      if (c.y > view.y1 + 300) c.y = view.y0 - 100;
      c.s.position.set(c.x, c.y);
      c.s.alpha = alpha;
    }
  }

  private updateLightning(dt: number): void {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.6);
    if (this.stormAmt < 0.5) return;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0 && this.flashStep === 0) {
      this.flashStep = 1;
      this.flashClock = 0;
      this.flash = 1;
      this.nextFlash = 5 + Math.random() * 9;
    }
    if (this.flashStep > 0) {
      this.flashClock += dt;
      if (this.flashStep === 1 && this.flashClock > 0.14) {
        this.flash = 0.75;
        this.flashStep = 2;
      } else if (this.flashStep === 2 && this.flashClock > 0.32) {
        this.flashStep = 0;
      }
    }
  }
}
