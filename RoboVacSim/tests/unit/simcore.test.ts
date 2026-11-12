import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/sim/config';
import { DirtField } from '../../src/sim/cleaning/DirtField';
import { SimClock } from '../../src/sim/core/clock';
import { Rng } from '../../src/sim/core/rng';
import { wrapAngle } from '../../src/sim/core/math';
import { DockStation } from '../../src/sim/dock/DockStation';
import { GridGeometry } from '../../src/sim/mapping/GridGeometry';
import { COMMAND_RULES, MODE_TRANSITIONS, canCommand, canTransition } from '../../src/sim/mission/transitions';
import type { RobotMode } from '../../src/sim/mission/types';
import { Resources } from '../../src/sim/resources/Resources';
import { RobotBody } from '../../src/sim/robot/RobotBody';
import { ROBOT } from '../../src/sim/robot/robotSpec';
import { Simulation } from '../../src/sim/Simulation';
import { WorldModel } from '../../src/sim/world/WorldModel';
import { testLayout } from './helpers/testLayout';

describe('state machine guards', () => {
  it('rejects incompatible commands with a reason', () => {
    expect(canCommand('cleaning', 'start').ok).toBe(false);
    expect(canCommand('cleaning', 'manual').ok).toBe(false);
    expect(canCommand('cleaning', 'manual').reason).toMatch(/Stop the mission/);
    expect(canCommand('idle', 'resume').ok).toBe(false);
    expect(canCommand('paused', 'resume').ok).toBe(true);
    expect(canCommand('charging', 'dock').ok).toBe(false);
    expect(canCommand('idle', 'pause').ok).toBe(false);
    expect(canCommand('returning', 'diagnostic').ok).toBe(false);
  });

  it('every mode can be stopped or is already idle, and pause is reversible', () => {
    const modes = Object.keys(MODE_TRANSITIONS) as RobotMode[];
    for (const m of modes) {
      if (m === 'idle') continue;
      expect(canCommand(m, 'stop').ok).toBe(true);
      if (COMMAND_RULES.pause.allowed.includes(m)) expect(canTransition('paused', m)).toBe(true);
    }
    expect(canTransition('charging', 'cleaning')).toBe(false);
    expect(canTransition('manual', 'cleaning')).toBe(false);
  });

  it('controller blocks invalid commands end-to-end', () => {
    const sim = new Simulation(testLayout(), { seed: 1 });
    expect(sim.command({ type: 'resume' }).ok).toBe(false);
    expect(sim.command({ type: 'start', settings: { kind: 'rooms', cleanMode: 'vacuum', suction: 'standard', water: 'low', passes: 1, rooms: [] } }).ok).toBe(false);
    sim.res.soc = 0.1;
    expect(sim.command({ type: 'start', settings: { kind: 'whole', cleanMode: 'vacuum', suction: 'standard', water: 'low', passes: 1, rooms: [] } }).reason).toMatch(/Battery/);
  });
});

describe('clock', () => {
  it('converts real time to fixed steps with speed scaling and pause', () => {
    const c = new SimClock(0.02);
    expect(c.advance(0.1)).toBe(5);
    c.speed = 10;
    expect(c.advance(0.1)).toBe(50);
    c.speed = 0.5;
    let n = 0;
    for (let i = 0; i < 10; i++) n += c.advance(0.02);
    expect(n).toBe(5);
    c.paused = true;
    expect(c.advance(1)).toBe(0);
  });

  it('clamps huge frame gaps', () => {
    const c = new SimClock(0.02);
    expect(c.advance(5)).toBe(5); // clamped to 0.1 s real
  });
});

describe('resources', () => {
  it('integrates energy in simulated time', () => {
    const cfg = mergeConfig(DEFAULT_CONFIG, { battery: { capacityWh: 30 } });
    const r = new Resources(cfg);
    // Idle draw = base + lidar = 5 W. 30 Wh * 0.1 = 3 Wh -> 2160 s at 5 W.
    for (let t = 0; t < 2160; t += 0.5) r.step(0.5, { speed: 0, turnRate: 0, drag: 1, lidarOn: true, brushesOn: false, suction: null, mopping: false, charging: false });
    expect(r.soc).toBeCloseTo(0.9, 3);
  });

  it('suction level changes power draw and charging tapers above 80 %', () => {
    const r = new Resources(DEFAULT_CONFIG);
    r.step(1, { speed: 0.28, turnRate: 0, drag: 1, lidarOn: true, brushesOn: true, suction: 'quiet', mopping: false, charging: false });
    const quiet = r.power.total;
    r.step(1, { speed: 0.28, turnRate: 0, drag: 1, lidarOn: true, brushesOn: true, suction: 'max', mopping: false, charging: false });
    expect(r.power.total - quiet).toBeCloseTo(DEFAULT_CONFIG.battery.suctionPower.max - DEFAULT_CONFIG.battery.suctionPower.quiet, 6);
    r.soc = 0.5;
    r.step(1, { speed: 0, turnRate: 0, drag: 1, lidarOn: false, brushesOn: false, suction: null, mopping: false, charging: true });
    const bulk = r.power.charge;
    r.soc = 0.95;
    r.step(1, { speed: 0, turnRate: 0, drag: 1, lidarOn: false, brushesOn: false, suction: null, mopping: false, charging: true });
    expect(r.power.charge).toBeLessThan(bulk * 0.5);
  });

  it('dock service cycle empties the bin and exchanges water', () => {
    const r = new Resources(DEFAULT_CONFIG);
    const d = new DockStation(DEFAULT_CONFIG);
    r.dustbin = 120;
    r.cleanWater = 20;
    r.dirtyWater = 90;
    d.dock(0, { emptyBin: true, washMop: true, water: true, dry: true });
    const phases = new Set<string>();
    for (let t = 0; t < 120; t += 0.1) {
      d.step(0.1, t, r);
      phases.add(d.phase);
    }
    expect([...phases]).toEqual(expect.arrayContaining(['charging', 'dustExtraction', 'mopWash', 'waterTransfer', 'drying', 'ready']));
    expect(r.dustbin).toBeCloseTo(0, 6);
    expect(d.dustBag).toBeCloseTo(120, 6);
    expect(r.cleanWater).toBeCloseTo(DEFAULT_CONFIG.water.tankCapacity, 3);
    expect(r.dirtyWater).toBeCloseTo(0, 3);
    expect(d.serviceComplete).toBe(true);
  });
});

describe('grid geometry & world model', () => {
  it('round-trips world <-> grid coordinates', () => {
    const g = GridGeometry.fromBounds({ x: -1, y: 2, w: 8, h: 5 }, 0.05, 0.5);
    const rng = new Rng(3);
    for (let k = 0; k < 200; k++) {
      const x = rng.range(-1.4, 7.4);
      const y = rng.range(1.6, 7.4);
      const idx = g.indexAt(x, y);
      expect(idx).toBeGreaterThanOrEqual(0);
      const c = g.centerOf(idx);
      expect(Math.abs(c.x - x)).toBeLessThanOrEqual(0.025 + 1e-9);
      expect(Math.abs(c.y - y)).toBeLessThanOrEqual(0.025 + 1e-9);
    }
    expect(g.indexAt(-10, 0)).toBe(-1);
  });

  it('ray casts hit walls at the correct distance and respect sensor height', () => {
    const w = new WorldModel(testLayout(), 0.05);
    // From (2, 2) looking -x: west wall interior face at x = 0.1.
    expect(w.raycast(2, 2, -1, 0, 6, 0.09)).toBeCloseTo(1.9, 6);
    // Table top (above 0.7 m) is invisible at LiDAR height; its legs are visible.
    const toTop = w.raycast(2.2, 1.5, 0, 1, 1.5, 0.09);
    expect(Number.isFinite(toTop) ? toTop : 99).toBeGreaterThan(0.6);
    expect(w.surfaceAt(5, 2)).toBe('tile');
    expect(w.surfaceAt(1, 1)).toBe('hardwood');
  });

  it('robot collision stops the body at walls and fires the bumper', () => {
    const w = new WorldModel(testLayout(), 0.05);
    const b = new RobotBody(DEFAULT_CONFIG.robot, new Rng(1));
    b.setPose(1.0, 2.0, Math.PI);
    let bumped = false;
    for (let i = 0; i < 400; i++) {
      b.step(0.02, 0.3, 0, w, 1);
      bumped ||= b.bumped;
    }
    expect(bumped).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(0.1 + ROBOT.radius - 1e-3);
  });

  it('cliff sensors stop the robot before it drives over a drop', () => {
    const layout = testLayout();
    layout.cliffs.push({ id: 'c', rect: { x: 2.5, y: 0.1, w: 1.0, h: 1.0 } });
    const w = new WorldModel(layout, 0.05);
    const b = new RobotBody(DEFAULT_CONFIG.robot, new Rng(1));
    b.setPose(1.5, 0.6, 0);
    let cliff = false;
    for (let i = 0; i < 400; i++) {
      b.step(0.02, 0.3, 0, w, 1);
      cliff ||= b.cliffTriggered;
    }
    expect(cliff).toBe(true);
    // Front cliff sensors sit 2.5 cm behind the bumper: they stop at the edge, the shell may overhang
    // slightly, the wheels (at x = 0) stay far from the drop.
    expect(b.x + ROBOT.cliffSensors[0].x).toBeLessThan(2.5 + 0.01);
    expect(b.x + ROBOT.radius).toBeLessThan(2.5 + 0.035);
  });
});

describe('cleaning model', () => {
  it('carpet is harder to vacuum than hardwood, higher suction cleans more', () => {
    const layout = testLayout();
    layout.rugs.push({ id: 'r', rect: { x: 0.5, y: 2.0, w: 1.0, h: 1.5 }, floor: 'carpet', color: '#777' });
    const w = new WorldModel(layout, 0.05);
    const pick = (x: number, y: number, suction: 'quiet' | 'max') => {
      const d = new DirtField(w, DEFAULT_CONFIG.cleaning);
      const idx = w.grid.indexAt(x, y);
      d.dust[idx] = 1;
      d.clean(x - ROBOT.mainBrushX, y, 0, { mode: 'vacuum', suction, water: 'medium', vacuumOn: true, mopOn: false, speed: 0.28, binFill: 0, padWetness: 0, padSoil: 0 }, { solids: 0, liquid: 0, stain: 0, newArea: 0 });
      return 1 - d.dust[idx];
    };
    expect(pick(1.0, 2.6, 'max')).toBeLessThan(pick(2.0, 1.2, 'max'));
    expect(pick(2.0, 1.2, 'quiet')).toBeLessThan(pick(2.0, 1.2, 'max'));
  });

  it('a pass is counted once per entry, not every step', () => {
    const w = new WorldModel(testLayout(), 0.05);
    const d = new DirtField(w, DEFAULT_CONFIG.cleaning);
    const out = { solids: 0, liquid: 0, stain: 0, newArea: 0 };
    const ctx = { mode: 'vacuum' as const, suction: 'standard' as const, water: 'medium' as const, vacuumOn: true, mopOn: false, speed: 0.1, binFill: 0, padWetness: 0, padSoil: 0 };
    for (let i = 0; i < 50; i++) d.clean(2, 2, 0, ctx, out);
    expect(d.passes[w.grid.indexAt(2 + ROBOT.mainBrushX, 2)]).toBe(1);
  });

  it('wrapAngle stays in (-pi, pi]', () => {
    for (const a of [0, 3.5, -3.5, 10, -10, Math.PI, -Math.PI]) {
      const r = wrapAngle(a);
      expect(r).toBeGreaterThan(-Math.PI - 1e-12);
      expect(r).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });
});
