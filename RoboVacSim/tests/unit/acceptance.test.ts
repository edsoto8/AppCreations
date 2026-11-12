import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { buildTelemetry } from '../../src/sim/telemetry';
import type { MissionSettings } from '../../src/sim/mission/types';
import { ROBOT } from '../../src/sim/robot/robotSpec';
import { testLayout } from './helpers/testLayout';

const settings = (over: Partial<MissionSettings> = {}): MissionSettings => ({
  kind: 'whole',
  cleanMode: 'vacuum',
  suction: 'standard',
  water: 'medium',
  passes: 1,
  rooms: [],
  ...over,
});

function runUntil(sim: Simulation, pred: () => boolean, maxSeconds: number): boolean {
  const steps = Math.round(maxSeconds / sim.cfg.stepDt);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (pred()) return true;
  }
  return false;
}

/** Bring the sim to a state where the robot has a complete map and sits in room A. */
function mappedSim(seed = 3): Simulation {
  const sim = new Simulation(testLayout(), { seed });
  expect(sim.command({ type: 'start', settings: settings({ kind: 'mapping' }) }).ok).toBe(true);
  expect(runUntil(sim, () => sim.ctrl.mission?.phase === 'completed', 600)).toBe(true);
  return sim;
}

describe('Acceptance 1: progressive mapping without omniscience', () => {
  it('builds the map incrementally from LiDAR and never knows space outside the house', () => {
    const sim = new Simulation(testLayout(), { seed: 1 });
    expect(sim.map.occ.knownArea()).toBe(0);
    sim.runFor(0.5);
    const initial = sim.map.occ.knownArea();
    expect(initial).toBeGreaterThan(1);
    // From the dock the robot cannot see into room B (behind the partition wall).
    const g = sim.map.geom;
    const roomBCenter = g.indexAt(6.2, 1.0);
    expect(sim.map.occ.isUnknown(roomBCenter)).toBe(true);
    sim.command({ type: 'start', settings: settings({ kind: 'mapping' }) });
    const samples: number[] = [];
    for (let t = 0; t < 12; t++) {
      sim.runFor(5);
      samples.push(sim.map.occ.knownArea());
    }
    // Known area grows (monotonic within noise) and eventually covers room B.
    expect(samples[samples.length - 1]).toBeGreaterThan(initial * 1.5);
    runUntil(sim, () => sim.ctrl.mission?.phase === 'completed', 600);
    expect(sim.map.occ.isFree(roomBCenter)).toBe(true);
    // Outside the exterior walls stays unknown (rays stop at walls).
    expect(sim.map.occ.isUnknown(g.indexAt(-0.4, 2))).toBe(true);
    expect(sim.map.occ.knownArea()).toBeLessThan(7.4 * 4.4);
  });
});

describe('Acceptance 2 & 3: path planning, following and dynamic replanning', () => {
  it('plans and follows an obstacle-free path between rooms', () => {
    const sim = mappedSim();
    sim.command({ type: 'manual', enable: true });
    sim.command({ type: 'manual', enable: false });
    const goal = { x: 6.0, y: 1.0 };
    expect(sim.nav.start({ points: [goal], mode: 'goto', speed: 0.3, label: 'test' }, sim.body.x, sim.body.y)).toBe(true);
    let bumps = 0;
    const ok = runUntilNav(sim, () => (bumps += sim.body.bumped ? 1 : 0));
    expect(ok).toBe('arrived');
    expect(Math.hypot(sim.body.x - goal.x, sim.body.y - goal.y)).toBeLessThan(0.25);
    expect(bumps).toBe(0);
  });

  it('detects a newly dropped obstacle and replans around it', () => {
    const sim = mappedSim();
    sim.command({ type: 'manual', enable: true });
    sim.command({ type: 'manual', enable: false });
    const goal = { x: 3.4, y: 1.0 };
    // Drive across room A along y = 1.0.
    expect(sim.nav.start({ points: [goal], mode: 'goto', speed: 0.3, label: 'test' }, sim.body.x, sim.body.y)).toBe(true);
    sim.runFor(1.5);
    const replansBefore = sim.nav.replans;
    // Drop a box right on the route ahead of the robot.
    sim.editLayout((l) => l.obstacles.push({ id: 'drop', kind: 'box', x: 2.4, y: 1.0, rotation: 0, w: 0.4, d: 0.4, h: 0.3 }));
    let minClear = Infinity;
    const res = runUntilNav(sim, () => {
      const dx = Math.max(Math.abs(sim.body.x - 2.4) - 0.2, 0);
      const dy = Math.max(Math.abs(sim.body.y - 1.0) - 0.2, 0);
      minClear = Math.min(minClear, Math.hypot(dx, dy));
    });
    expect(res).toBe('arrived');
    expect(sim.nav.replans).toBeGreaterThan(replansBefore);
    // The robot body never overlapped the box.
    expect(minClear).toBeGreaterThan(ROBOT.radius - 0.005);
    // The box is now in the robot's map: some cells along its boundary are occupied.
    const g = sim.map.geom;
    let seen = 0;
    for (let y = 0.75; y <= 1.25; y += 0.025)
      for (let x = 2.15; x <= 2.65; x += 0.025) {
        const idx = g.indexAt(x, y);
        if (sim.map.occ.isOccupied(idx) || sim.map.lowObstacles[idx] === 1) seen++;
      }
    expect(seen).toBeGreaterThan(5);
  });
});

function runUntilNav(sim: Simulation, each: () => void, maxSeconds = 120): string {
  for (let i = 0; i < maxSeconds / sim.cfg.stepDt; i++) {
    // Drive the navigator directly (robot is idle, controller does not override nav commands).
    const b = sim.body;
    const cmd = sim.nav.update({ x: b.x, y: b.y, theta: b.theta, v: b.v, bumped: b.bumped, bumpAngle: b.bumpAngle, cliff: b.cliffTriggered, frontNearest: sim.front.nearest, wallSide: Infinity, wallDiagonal: Infinity, openDirection: 0, dt: sim.cfg.stepDt });
    b.step(sim.cfg.stepDt, cmd.v, cmd.w, sim.world, 1);
    sim.lidar.step(sim.cfg.stepDt, b.x, b.y, b.theta, sim.world);
    sim.map.integrateLidar(sim.lidar.stepRays, sim.lidar.rayCount);
    sim.map.markRobotFootprint(b.x, b.y);
    if (b.bumped) sim.map.markLowObstacle(b.bumpX, b.bumpY);
    sim.map.update(sim.cfg.stepDt);
    each();
    if (sim.nav.state !== 'active') return sim.nav.state;
  }
  return 'timeout';
}

describe('Acceptance 4, 5, 10: cleaning simulation and complete mission', () => {
  it('removes dirt only under the footprint, progressively, and completes the mission', () => {
    const sim = new Simulation(testLayout(), { seed: 5 });
    const far = sim.world.grid.indexAt(6.6, 0.4);
    const initial = sim.dirt.remainingSolids();
    sim.command({ type: 'start', settings: settings() });
    const samples: number[] = [];
    let sawCleaning = false;
    let farBefore = 0;
    const done = runUntil(
      sim,
      () => {
        if (sim.ctrl.mode === 'cleaning' && !sawCleaning) {
          sawCleaning = true;
          farBefore = sim.dirt.dust[far];
        }
        if (sim.clock.steps % 2500 === 0) samples.push(sim.dirt.remainingSolids());
        return sim.ctrl.mission?.phase === 'completed';
      },
      3600,
    );
    expect(done).toBe(true);
    expect(sawCleaning).toBe(true);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-6);
    expect(sim.dirt.remainingSolids()).toBeLessThan(initial * 0.5);
    expect(farBefore).toBeGreaterThan(0);
    // Dirt went into the dustbin (mass conservation).
    const removed = sim.dirt.removed.dust + sim.dirt.removed.crumbs + sim.dirt.removed.hair;
    expect(sim.res.dustbin + sim.dock.dustBag).toBeCloseTo(removed, 3);
    expect(sim.coverage().percent).toBeGreaterThan(90);
    expect(sim.ctrl.docked).toBe(true);
  });

  it('vacuum and mop modes behave differently', () => {
    const vac = mappedSim(11);
    const mop = mappedSim(11);
    const liquid0 = vac.dirt.total('liquid');
    const stain0 = vac.dirt.total('stain');
    const dust0 = vac.dirt.total('dust');
    vac.command({ type: 'start', settings: settings({ kind: 'rooms', rooms: ['roomB'], cleanMode: 'vacuum' }) });
    mop.command({ type: 'start', settings: settings({ kind: 'rooms', rooms: ['roomB'], cleanMode: 'mop', water: 'high' }) });
    expect(runUntil(vac, () => vac.ctrl.mission?.phase === 'completed', 1800)).toBe(true);
    expect(runUntil(mop, () => mop.ctrl.mission?.phase === 'completed', 1800)).toBe(true);
    // Vacuum: picks dust, leaves liquid & stains.
    expect(vac.dirt.total('liquid')).toBeCloseTo(liquid0, 6);
    expect(vac.dirt.total('stain')).toBeCloseTo(stain0, 6);
    expect(vac.dirt.removed.dust).toBeGreaterThan(0);
    // Mop: removes liquid & stains, consumes water, does not fill the dustbin.
    expect(mop.dirt.total('liquid')).toBeLessThan(liquid0 * 0.3);
    expect(mop.dirt.total('stain')).toBeLessThan(stain0 * 0.8);
    expect(mop.res.waterUsed).toBeGreaterThan(5);
    expect(mop.dirt.removed.crumbs).toBe(0);
    expect(dust0).toBeGreaterThan(0);
  });
});

describe('Acceptance 6: restricted zones', () => {
  it('never enters a no-go zone', () => {
    const layout = testLayout();
    const zone = { x: 5.0, y: 0.6, w: 1.2, h: 1.0 };
    layout.zones.push({ id: 'z1', kind: 'noGo', rect: zone });
    const sim = new Simulation(layout, { seed: 9 });
    sim.command({ type: 'start', settings: settings() });
    let minDist = Infinity;
    const done = runUntil(
      sim,
      () => {
        const b = sim.body;
        const dx = Math.max(zone.x - b.x, 0, b.x - (zone.x + zone.w));
        const dy = Math.max(zone.y - b.y, 0, b.y - (zone.y + zone.h));
        minDist = Math.min(minDist, Math.hypot(dx, dy));
        return sim.ctrl.mission?.phase === 'completed';
      },
      3600,
    );
    expect(done).toBe(true);
    // The whole footprint stays outside (center at least ~radius away).
    expect(minDist).toBeGreaterThan(ROBOT.radius - 0.01);
    // And the zone was not cleaned.
    const idx = sim.world.grid.indexAt(5.6, 1.1);
    expect(sim.dirt.passes[idx]).toBe(0);
  });
});

describe('Acceptance 7, 8, 9: low battery -> dock -> charge -> resume', () => {
  it('returns to dock on low battery, charges, and resumes the remaining plan', () => {
    const sim = new Simulation(testLayout(), { seed: 21 });
    sim.command({ type: 'start', settings: settings() });
    expect(runUntil(sim, () => sim.ctrl.mission?.phase === 'coverage' && (sim.ctrl.mission?.tasksDone ?? 0) > 8, 1800)).toBe(true);
    // Drain the battery to just below the return threshold.
    sim.res.soc = 0.19;
    expect(runUntil(sim, () => sim.ctrl.mode === 'returning', 5)).toBe(true);
    const m = sim.ctrl.mission!;
    expect(m.phase).toBe('rechargeReturn');
    expect(m.resumeReason).toBe('battery');
    const remembered = m.tasks.length;
    expect(remembered).toBeGreaterThan(0);
    expect(runUntil(sim, () => sim.ctrl.docked, 300)).toBe(true);
    expect(['maintenance', 'charging']).toContain(sim.ctrl.mode);
    expect(m.phase).toBe('recharging');
    const docked = sim.ctrl.docked;
    expect(docked).toBe(true);
    // Robot is on the contacts.
    expect(Math.hypot(sim.body.x - sim.layout.dock.x, sim.body.y - sim.layout.dock.y)).toBeLessThan(0.01);
    const socAtDock = sim.res.soc;
    sim.runFor(60);
    expect(sim.res.soc).toBeGreaterThan(socAtDock);
    expect(m.tasks.length).toBe(remembered);
    // Charges to the resume threshold, undocks and continues the saved plan.
    expect(runUntil(sim, () => sim.ctrl.mode === 'cleaning', 4000)).toBe(true);
    expect(sim.res.soc).toBeGreaterThanOrEqual(sim.cfg.battery.resumeThreshold - 0.01);
    expect(m.rechargeCount).toBe(1);
    expect(m.phase).toBe('coverage');
    expect(m.tasks.length).toBeLessThanOrEqual(remembered);
    expect(m.tasks.length).toBeGreaterThanOrEqual(remembered - 1);
    expect(runUntil(sim, () => m.phase === 'completed', 3600)).toBe(true);
  });
});

describe('Acceptance 11 & 12: pause freezes everything; speed scales all systems equally', () => {
  it('pausing freezes the full simulation state', () => {
    const sim = new Simulation(testLayout(), { seed: 4 });
    sim.command({ type: 'start', settings: settings() });
    sim.runFor(60);
    expect(sim.command({ type: 'pause' }).ok).toBe(true);
    const snap = JSON.stringify([sim.body.x, sim.body.y, sim.body.theta, sim.res.energyWh, sim.dirt.remainingSolids(), sim.clock.time, sim.lidar.totalRays, sim.lidar.turretAngle, sim.anim, sim.dock.phase, sim.stats]);
    for (let i = 0; i < 100; i++) sim.advance(0.05);
    sim.runFor(10);
    const after = JSON.stringify([sim.body.x, sim.body.y, sim.body.theta, sim.res.energyWh, sim.dirt.remainingSolids(), sim.clock.time, sim.lidar.totalRays, sim.lidar.turretAngle, sim.anim, sim.dock.phase, sim.stats]);
    expect(after).toBe(snap);
    expect(sim.command({ type: 'resume' }).ok).toBe(true);
    sim.advance(0.05);
    expect(sim.clock.time).toBeGreaterThan(JSON.parse(snap)[5]);
  });

  it('simulation speed changes the rate of simulated time, not the physics', () => {
    const a = new Simulation(testLayout(), { seed: 8 });
    const b = new Simulation(testLayout(), { seed: 8 });
    a.command({ type: 'start', settings: settings() });
    b.command({ type: 'start', settings: settings() });
    a.clock.speed = 1;
    b.clock.speed = 5;
    for (let i = 0; i < 1000; i++) a.advance(1 / 50);
    for (let i = 0; i < 200; i++) b.advance(1 / 50);
    expect(a.clock.steps).toBe(b.clock.steps);
    expect(b.body.x).toBe(a.body.x);
    expect(b.res.energyWh).toBe(a.res.energyWh);
    expect(b.dirt.remainingSolids()).toBe(a.dirt.remainingSolids());
    expect(b.lidar.totalRays).toBe(a.lidar.totalRays);
  });
});

describe('Acceptance 13, 14, 15: determinism, disposal, telemetry agreement', () => {
  it('reset with the same seed reproduces the scenario exactly; a different seed differs', () => {
    const run = (seed: number) => {
      const s = new Simulation(testLayout(), { seed });
      const d0 = s.dirt.remainingSolids();
      s.command({ type: 'start', settings: settings() });
      s.runFor(120);
      return { d0, x: s.body.x, y: s.body.y, e: s.res.energyWh, d: s.dirt.remainingSolids() };
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42).d0).not.toBe(run(43).d0);
  });

  it('dispose releases subscriptions and stops stepping', () => {
    const sim = new Simulation(testLayout(), { seed: 1 });
    let logs = 0;
    sim.events.on('log', () => logs++);
    sim.dispose();
    sim.command({ type: 'start', settings: settings() });
    expect(logs).toBe(0);
    expect(sim.advance(1)).toBe(0);
  });

  it('dashboard telemetry agrees with simulation state', () => {
    const sim = new Simulation(testLayout(), { seed: 2 });
    sim.command({ type: 'start', settings: settings() });
    sim.runFor(200);
    const t = buildTelemetry(sim);
    expect(t.battery).toBe(sim.res.soc);
    expect(t.mode).toBe(sim.ctrl.mode);
    expect(t.pose.x).toBe(sim.body.x);
    expect(t.distance).toBe(sim.stats.distance);
    expect(t.dustbinG).toBe(sim.res.dustbin);
    expect(t.coverage).toBeCloseTo(sim.coverage().percent, 9);
    expect(t.mission?.tasksLeft).toBe((sim.ctrl.mission?.tasks.length ?? 0) + (sim.ctrl.currentTask ? 1 : 0));
    expect(t.dirtRemovedG).toBeCloseTo(sim.dirt.removed.dust + sim.dirt.removed.crumbs + sim.dirt.removed.hair, 9);
    expect(t.time).toBe(sim.clock.time);
    expect(JSON.parse(JSON.stringify(t))).toBeTruthy();
  });
});
