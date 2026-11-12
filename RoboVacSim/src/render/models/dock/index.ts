import { Color, Group, type Vector3 } from 'three';
import { ROBOT } from '../../../sim/robot/robotSpec';
import type { DockAnimState, DockModel, DockPhase } from '../types';
import { createBuildContext } from '../shared/context';
import { lutPoint, samplePath } from '../shared/geometry';
import { ParticleStream, type ParticlePath } from '../shared/ParticleStream';
import { PartRegistry } from '../shared/PartRegistry';
import type { ModelQuality } from '../shared/quality';
import { buildBasePlate, buildDockContacts, buildDryingVents, buildWashTray } from './base';
import { DOCK_PARTS } from './descriptions';
import { StatusDisplay } from './display';
import { buildPowerSupply, buildPumps, buildSuctionDuct, buildVacuumMotor, CLEAN_HOSE, DIRTY_HOSE, DUST_PATH } from './internals';
import { TRAY, VENT_Z } from './layout';
import {
  buildDustBag,
  buildFascia,
  buildFrontPanel,
  buildHousing,
  buildLightStrip,
  buildSidePanels,
  buildTank,
  buildTopLid,
  WATER_MAX_H,
} from './tower';

export type { ModelQuality } from '../shared/quality';

export interface DockModelOptions {
  quality?: ModelQuality;
}

interface PhaseStyle {
  color: Color;
  /** Base intensity of the light strip. */
  level: number;
  /** Pulse depth (0 = steady). */
  pulse: number;
  /** Texture scroll speed (flowing animation). */
  flow: number;
  /** CSS colour for the display accent. */
  accent: string;
}

const STYLES: Record<DockPhase, PhaseStyle> = {
  idle: { color: new Color(0.75, 0.82, 0.9), level: 0.35, pulse: 0, flow: 0, accent: '#9fb3c4' },
  charging: { color: new Color(0.08, 0.95, 0.72), level: 0.9, pulse: 0.55, flow: 0, accent: '#25e3b5' },
  dustExtraction: { color: new Color(0.35, 0.55, 1), level: 1.2, pulse: 0, flow: 0.9, accent: '#6f9bff' },
  mopWash: { color: new Color(0.1, 0.78, 1), level: 1.1, pulse: 0, flow: 0.6, accent: '#3cc9ff' },
  waterTransfer: { color: new Color(0.15, 0.38, 1), level: 1.1, pulse: 0, flow: 0.7, accent: '#4b7bff' },
  drying: { color: new Color(1, 0.5, 0.16), level: 0.9, pulse: 0.25, flow: 0, accent: '#ff9a4a' },
  ready: { color: new Color(0.2, 1, 0.38), level: 1.1, pulse: 0, flow: 0, accent: '#4dff7a' },
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export function createDockModel(opts?: DockModelOptions): DockModel {
  const ctx = createBuildContext(opts?.quality);
  const { mats, q } = ctx;
  const root = new Group();
  root.name = 'DockModel';

  const display = new StatusDisplay(ctx.track);
  const plate = buildBasePlate(ctx);
  const tray = buildWashTray(ctx);
  const vents = buildDryingVents(ctx);
  const contacts = buildDockContacts(ctx);
  const housing = buildHousing(ctx);
  const front = buildFrontPanel(ctx);
  const sides = buildSidePanels(ctx);
  const fascia = buildFascia(ctx, display);
  const strip = buildLightStrip(ctx);
  const lid = buildTopLid(ctx);
  const clean = buildTank(ctx, 1);
  const dirty = buildTank(ctx, -1);
  const bag = buildDustBag(ctx);
  const duct = buildSuctionDuct(ctx);
  const motor = buildVacuumMotor(ctx);
  const pumps = buildPumps(ctx);
  const psu = buildPowerSupply(ctx);
  root.add(
    plate.root, tray.root, vents.root, contacts.root, housing.root, front.root, sides.root, fascia.root, strip.root,
    lid.root, clean.root, dirty.root, bag.root, duct.root, motor.root, pumps.root, psu.root,
  );

  // ---- particles --------------------------------------------------------------------------------
  const sprite = ctx.tex.get('sprite');
  const dustLut = samplePath(DUST_PATH, 96);
  const cleanLut = samplePath(CLEAN_HOSE, 64);
  const dirtyLut = samplePath(DIRTY_HOSE, 64);
  const dustPath: ParticlePath = (p, a, b, c, out: Vector3) => {
    lutPoint(dustLut, p, out);
    const spread = Math.max(0, 1 - p * 6);
    out.z += (b - 0.5) * 0.17 * spread + (c - 0.5) * 0.018 * (1 - spread);
    out.x += (a - 0.5) * 0.014 * (1 - spread);
    if (p > 0.88) {
      const k = (p - 0.88) / 0.12;
      out.x += (a - 0.5) * 0.13 * k;
      out.z += (b - 0.5) * 0.08 * k;
      out.y += (c - 0.5) * 0.09 * k;
    }
  };
  const sprayPath: ParticlePath = (p, a, b, c, out: Vector3) => {
    const nozzle = a < 0.33 ? 1 : a < 0.66 ? -1 : 0;
    const sz = nozzle * (TRAY.z - 0.008);
    const dir = nozzle === 0 ? (b < 0.5 ? 1 : -1) : nozzle;
    const tz = dir * ROBOT.mopZ + (c - 0.5) * 0.07 * (nozzle === 0 ? 1 : 0.6);
    const tx = ROBOT.mopX + (b - 0.5) * 0.08;
    out.set(ROBOT.mopX + (tx - ROBOT.mopX) * p, 0.004 + Math.sin(p * Math.PI) * 0.011, sz + (tz - sz) * p);
  };
  const dryPath: ParticlePath = (p, a, b, c, out: Vector3) => {
    const s = c < 0.5 ? 1 : -1;
    const x = -0.15 + a * 0.1;
    out.set(x + Math.sin(p * 6 + b * 6) * 0.004, 0.006 + p * 0.07, s * (VENT_Z - p * 0.03 + (b - 0.5) * 0.012));
  };
  const hosePath = (lut: Float32Array): ParticlePath => (p, a, _b, c, out: Vector3) => {
    lutPoint(lut, p, out);
    out.x += (a - 0.5) * 0.004;
    out.z += (c - 0.5) * 0.004;
  };
  const streams = {
    dust: new ParticleStream({ count: 240 * q.particles, color: 0xf0e6d4, size: 0.0065, opacity: 0.95, speed: 0.55, speedJitter: 0.5, sprite }, dustPath, ctx.track),
    spray: new ParticleStream({ count: 120 * q.particles, color: 0x9fe4ff, size: 0.003, opacity: 0.9, speed: 1.8, speedJitter: 0.4, sprite }, sprayPath, ctx.track),
    dry: new ParticleStream({ count: 90 * q.particles, color: 0xffa060, size: 0.006, opacity: 0.5, speed: 0.45, speedJitter: 0.5, sprite, fade: 0.8 }, dryPath, ctx.track),
    cleanFlow: new ParticleStream({ count: 50 * q.particles, color: 0x7fd8ff, size: 0.0035, opacity: 0.95, speed: 0.7, speedJitter: 0.15, sprite }, hosePath(cleanLut), ctx.track),
    dirtyFlow: new ParticleStream({ count: 50 * q.particles, color: 0xd8a868, size: 0.0035, opacity: 0.95, speed: 0.7, speedJitter: 0.15, sprite }, hosePath(dirtyLut), ctx.track),
  };
  for (const s of Object.values(streams)) root.add(s.points);

  // ---- parts ------------------------------------------------------------------------------------
  const registry = new PartRegistry();
  const register = (id: string, object: Group): void => {
    const info = DOCK_PARTS[id];
    registry.addPart(id, info.name, info.description, object);
  };
  register('basePlate', plate.root);
  register('washTray', tray.root);
  register('dryingVents', vents.root);
  register('chargingContacts', contacts.root);
  register('suctionDuct', duct.root);
  register('vacuumMotor', motor.root);
  register('dustBag', bag.root);
  register('cleanTank', clean.root);
  register('dirtyTank', dirty.root);
  register('pumps', pumps.root);
  register('powerSupply', psu.root);
  register('statusDisplay', fascia.root);
  register('lightStrip', strip.root);
  register('frontPanel', front.root);
  register('sidePanels', sides.root);
  register('dockHousing', housing.root);
  register('topLid', lid.root);
  registry.markDynamic(mats.lightStrip);
  registry.markDynamic(mats.contactGlow);
  registry.markDynamic(mats.warmGlow);

  const cutawayHide = [housing.nearHalf, front.near, sides.left, lid.near];
  const stripTex = ctx.tex.get('strip');
  const stripColor = new Color(0, 0, 0);
  let motorSpeed = 0;
  let motorAngle = 0;
  let scrubSpeed = 0;
  let scrubAngle = 0;
  let contactLevel = 0;
  let warmLevel = 0;
  let readyFlash = 0;
  let lastPhase: DockPhase = 'idle';

  return {
    root,
    parts: registry.parts,

    update(state: DockAnimState, time: number, dt: number): void {
      const phase = state.phase;
      const style = STYLES[phase];
      if (phase !== lastPhase) {
        lastPhase = phase;
        readyFlash = phase === 'ready' ? 1 : 0;
      }
      const k = Math.min(1, dt * 4);
      // Light strip.
      const pulse = 1 - style.pulse * (0.5 + 0.5 * Math.cos(time * 2.6));
      stripColor.lerp(style.color, k);
      readyFlash = Math.max(0, readyFlash - dt * 0.8);
      mats.lightStrip.emissive.copy(stripColor);
      mats.lightStrip.emissiveIntensity = style.level * pulse + readyFlash * 0.8;
      stripTex.offset.x = (stripTex.offset.x - dt * style.flow) % 1;

      // Charging contacts glow.
      const charging = phase === 'charging' && state.robotDocked;
      contactLevel += ((charging ? 1 : 0) - contactLevel) * k;
      mats.contactGlow.emissiveIntensity = contactLevel * (0.8 + 0.7 * (0.5 + 0.5 * Math.sin(time * 3)));

      // Drying warm air.
      const drying = phase === 'drying';
      warmLevel += ((drying ? 1 : 0) - warmLevel) * Math.min(1, dt * 1.5);
      mats.warmGlow.emissiveIntensity = warmLevel * (1.3 + 0.25 * Math.sin(time * 7) + 0.15 * Math.sin(time * 17));

      // Mechanics.
      motorSpeed += ((phase === 'dustExtraction' ? 1 : 0) - motorSpeed) * Math.min(1, dt * 1.6);
      motorAngle = (motorAngle + motorSpeed * dt * 90) % (Math.PI * 2);
      motor.impeller.rotation.y = motorAngle;
      scrubSpeed += ((phase === 'mopWash' ? 1 : 0) - scrubSpeed) * Math.min(1, dt * 2.5);
      scrubAngle = (scrubAngle + scrubSpeed * dt * 14) % (Math.PI * 2);
      tray.scrubber.rotation.z = scrubAngle;

      // Levels.
      const cw = clamp01(state.cleanWater);
      const dw = clamp01(state.dirtyWater);
      clean.water.visible = cw > 0.005;
      clean.water.scale.y = Math.max(0.0005, cw * WATER_MAX_H);
      dirty.water.visible = dw > 0.005;
      dirty.water.scale.y = Math.max(0.0005, dw * WATER_MAX_H);
      const fill = clamp01(state.dustBag);
      bag.dust.visible = fill > 0.01;
      bag.dust.scale.y = Math.max(0.0005, fill * 0.1);
      const puff = 1 + motorSpeed * 0.035 * (0.6 + 0.4 * Math.sin(time * 9));
      bag.bag.scale.set(puff, puff, puff);

      // Particles.
      streams.dust.update(dt, phase === 'dustExtraction' ? 1 : 0);
      streams.spray.update(dt, phase === 'mopWash' ? 1 : 0);
      streams.cleanFlow.update(dt, phase === 'mopWash' ? 1 : 0);
      streams.dirtyFlow.update(dt, phase === 'waterTransfer' ? 1 : 0);
      streams.dry.update(dt, drying ? 1 : 0);

      display.update(state.statusText, state.robotBattery, style.accent);
      registry.syncDynamic();
    },

    setPanelsOpen(amount: number): void {
      const t = smooth(amount);
      front.slide.position.set(-0.17 * t, 0.07 * t, 0);
      sides.left.position.set(0, 0.07 * t, 0.17 * t);
      sides.right.position.set(0, 0.07 * t, -0.17 * t);
    },

    setCutaway(on: boolean): void {
      for (const o of cutawayHide) o.visible = !on;
      housing.caps.visible = on;
    },

    highlight(partId: string | null): void {
      registry.highlight(partId);
    },

    dispose(): void {
      registry.dispose();
      ctx.track.dispose();
      root.clear();
    },
  };
}
