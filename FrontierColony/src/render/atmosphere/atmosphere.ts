/**
 * Atmosphere: day/night ambient light, night lights, weather and cloud shadows.
 *
 * Cost model (important under software GL): by day with clear weather everything here is invisible and
 * free. At night / in weather there is exactly one full-screen multiply quad (the ambient colour), plus a
 * handful of small additive glow sprites and capped pooled particles.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import type { GameState } from '../../sim';
import { P } from '../entities/isoMath';
import type { EntityLayer } from '../entities/entityLayer';
import type { TextureSet } from '../textures';
import { lerp } from '../util/noise';
import { ambientColor, isNeutral, lightStrength, rgbToHex, type Rgb } from './daylight';
import { lightPointsFor } from './lightPoints';
import { WeatherFx } from './weatherFx';

const LIGHT_POOL = 180;

interface LightSprite {
  s: Sprite;
}

export class Atmosphere {
  private readonly ambient = new Sprite(Texture.WHITE);
  private readonly glow = new Container();
  private readonly cloudLayer: Container;
  private readonly flashSprite = new Sprite(Texture.WHITE);
  private readonly weather: WeatherFx;
  private readonly lights: LightSprite[] = [];
  private lightCount = 0;
  private color: Rgb = [1, 1, 1];
  private droughtLevel = 0;
  private readonly occupied = new Set<number>();
  /** Current night-light strength 0..1 (for fixtures). */
  light = 0;

  constructor(stage: Container, tex: TextureSet) {
    this.weather = new WeatherFx(tex);
    this.cloudLayer = this.weather.clouds;
    this.ambient.blendMode = 'multiply';
    this.ambient.visible = false;
    this.flashSprite.tint = 0xe8f0ff;
    this.flashSprite.visible = false;
    for (let i = 0; i < LIGHT_POOL; i++) {
      const s = new Sprite(tex.fx.glow);
      s.blendMode = 'add';
      s.visible = false;
      this.glow.addChild(s);
      this.lights.push({ s });
    }
    stage.addChild(this.cloudLayer, this.ambient, this.glow, this.weather.screen, this.flashSprite);
  }

  /** Drought strength currently applied (smoothed, 0..1). */
  get drought(): number {
    return this.droughtLevel;
  }

  update(args: {
    state: Readonly<GameState>;
    dt: number;
    world: Container;
    screenW: number;
    screenH: number;
    view: { x0: number; y0: number; x1: number; y1: number };
    entities: EntityLayer;
  }): void {
    const { state, dt, world, screenW, screenH, view, entities } = args;
    const hour = state.time.timeOfDay;
    const droughtOn = state.activeEvents.some((e) => e.kind === 'drought') ? 1 : 0;
    this.droughtLevel += (droughtOn - this.droughtLevel) * (1 - Math.exp(-dt / 4));
    if (this.droughtLevel < 0.005) this.droughtLevel = 0;

    // world-anchored layers follow the camera
    for (const c of [this.cloudLayer, this.glow]) {
      c.position.copyFrom(world.position);
      c.scale.copyFrom(world.scale);
    }

    this.weather.update(state.weather.current, state.weather.intensity, dt, screenW, screenH, view);

    // ambient colour (smoothed so weather changes fade) plus lightning
    const target = ambientColor(hour, state.weather.current, state.weather.intensity, this.droughtLevel);
    const k = 1 - Math.exp(-dt / 0.9);
    this.color = [lerp(this.color[0], target[0], k), lerp(this.color[1], target[1], k), lerp(this.color[2], target[2], k)];
    const flash = this.weather.lightning;
    const c: Rgb = flash > 0 ? [lerp(this.color[0], 1, flash * 0.85), lerp(this.color[1], 1, flash * 0.85), lerp(this.color[2], 1, flash * 0.9)] : this.color;
    const neutral = isNeutral(c);
    this.ambient.visible = !neutral;
    if (!neutral) {
      this.ambient.tint = rgbToHex(c);
      this.ambient.width = screenW;
      this.ambient.height = screenH;
    }
    this.flashSprite.visible = flash > 0.02;
    if (this.flashSprite.visible) {
      this.flashSprite.width = screenW;
      this.flashSprite.height = screenH;
      this.flashSprite.alpha = flash * 0.32;
    }

    // night lights
    this.light = lightStrength(hour) * (state.weather.current === 'storm' ? 1 : 1);
    this.updateLights(state, entities, view, hour);
  }

  private updateLights(state: Readonly<GameState>, entities: EntityLayer, view: { x0: number; y0: number; x1: number; y1: number }, hour: number): void {
    const strength = this.light;
    if (strength < 0.03) {
      for (let i = 0; i < this.lightCount; i++) this.lights[i]!.s.visible = false;
      this.lightCount = 0;
      return;
    }
    this.occupied.clear();
    for (const s of state.settlers) {
      if (s.homeId !== null) this.occupied.add(s.homeId);
      if (s.workplaceId !== null) this.occupied.add(s.workplaceId);
    }
    const anyone = state.settlers.length > 0;
    const t = performance.now() / 1000;
    let n = 0;
    const margin = 120;
    for (const v of entities.buildingViews()) {
      const x = v.root.position.x;
      const y = v.root.position.y;
      if (x < view.x0 - margin || x > view.x1 + margin || y < view.y0 - margin - 120 || y > view.y1 + margin) continue;
      const b = state.buildings.find((bb) => bb.id === v.id);
      if (!b || b.status !== 'complete') continue;
      const occupied = b.type === 'townCenter' ? anyone : this.occupied.has(b.id);
      for (const lp of lightPointsFor(b.type)) {
        if (lp.needsOccupant && !occupied) continue;
        if (n >= LIGHT_POOL) break;
        const s = this.lights[n++]!.s;
        const p = P(lp.u, lp.v, lp.h);
        s.visible = true;
        s.position.set(x + p.x, y + p.y);
        const ph = x * 0.013 + lp.u * 3;
        switch (lp.kind) {
          case 'window':
            s.tint = 0xffc97a;
            s.scale.set(0.42 * lp.size);
            s.alpha = strength * (0.85 + 0.1 * Math.sin(t * 2.1 + ph));
            break;
          case 'pool':
            s.tint = 0xffb45a;
            s.scale.set(1.1 * lp.size, 0.5 * lp.size);
            s.alpha = strength * 0.3;
            break;
          case 'forge':
            s.tint = 0xff7a30;
            s.scale.set(0.75 * lp.size);
            s.alpha = strength * (0.8 + 0.2 * Math.sin(t * 9 + ph));
            break;
          default: {
            const f = 0.82 + 0.18 * Math.sin(t * 11 + ph) + 0.1 * Math.sin(t * 23 + ph * 2);
            s.tint = 0xff9a40;
            s.scale.set(0.62 * lp.size * (0.9 + 0.2 * f));
            s.alpha = strength * f;
          }
        }
      }
    }
    for (let i = n; i < this.lightCount; i++) this.lights[i]!.s.visible = false;
    this.lightCount = n;
    void hour;
  }
}
