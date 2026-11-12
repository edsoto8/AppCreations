import { SURFACE } from './config';
import { MISSION_LABEL, MODE_LABEL, type MissionPhase, type MissionKind, type RobotMode } from './mission/types';
import type { DockPhase } from './dock/DockStation';
import type { Simulation } from './Simulation';
import type { DiagStep } from './mission/RobotController';

/**
 * Plain, serialisable snapshot of everything the dashboard shows. Built from simulation state only
 * (never from the renderer), at a throttled rate, so UI values always agree with the simulation.
 */
export interface Telemetry {
  time: number;
  speed: number;
  mode: RobotMode;
  modeLabel: string;
  docked: boolean;
  error: string | null;
  battery: number;
  batteryWh: number;
  powerW: number;
  chargeW: number;
  power: { base: number; lidar: number; drive: number; brushes: number; suction: number; mop: number };
  pose: { x: number; y: number; theta: number };
  velocity: { v: number; w: number };
  dustbin: number;
  dustbinG: number;
  cleanWater: number;
  cleanWaterMl: number;
  dirtyWater: number;
  padSoil: number;
  distance: number;
  areaCleaned: number;
  coverage: number;
  coverageTarget: number;
  dirtRemovedG: number;
  liquidRemovedMl: number;
  dirtRemainingG: number;
  missionTime: number;
  eta: number;
  mission: null | {
    id: number;
    kind: MissionKind;
    kindLabel: string;
    phase: MissionPhase;
    pass: number;
    passes: number;
    tasksDone: number;
    tasksPlanned: number;
    tasksLeft: number;
    tasksSkipped: number;
    rechargeCount: number;
    resumeReason: string | null;
    cleanMode: string;
    result: string | null;
  };
  target: string;
  targetPoint: { x: number; y: number } | null;
  nav: { state: string; replans: number; recovery: string | null; lastEvent: string | null };
  sensors: {
    lidarRays: number;
    lidarRate: number;
    lidarSpinning: boolean;
    bumper: boolean;
    bumps: number;
    cliffEvents: number;
    cliffNow: boolean;
    frontNearest: number;
    wallGap: number;
    surface: string;
    mapKnownArea: number;
  };
  dock: { phase: DockPhase; progress: number; cleanTank: number; dirtyTank: number; dustBag: number };
  suction: string;
  water: string;
  diag: DiagStep[];
  simStepMs: number;
}

export function buildTelemetry(sim: Simulation): Telemetry {
  const c = sim.ctrl;
  const b = sim.body;
  const r = sim.res;
  const m = c.mission;
  const cov = sim.coverage();
  const removed = sim.dirt.removed;
  const surface = sim.world.surfaceAt(b.x, b.y);
  const cfg = sim.cfg;
  return {
    time: sim.clock.time,
    speed: sim.clock.speed,
    mode: c.mode,
    modeLabel: MODE_LABEL[c.mode],
    docked: c.docked,
    error: c.errorMessage,
    battery: r.soc,
    batteryWh: r.energyWh,
    powerW: r.power.total,
    chargeW: r.power.charge,
    power: { base: r.power.base, lidar: r.power.lidar, drive: r.power.drive, brushes: r.power.brushes, suction: r.power.suction, mop: r.power.mop },
    pose: { x: b.x, y: b.y, theta: b.theta },
    velocity: { v: b.v, w: b.w },
    dustbin: r.binFill,
    dustbinG: r.dustbin,
    cleanWater: r.cleanWaterFrac,
    cleanWaterMl: r.cleanWater,
    dirtyWater: r.dirtyWaterFrac,
    padSoil: r.padSoil,
    distance: sim.stats.distance,
    areaCleaned: cov.cleaned,
    coverage: cov.percent,
    coverageTarget: cov.target,
    dirtRemovedG: removed.dust + removed.crumbs + removed.hair,
    liquidRemovedMl: removed.liquid,
    dirtRemainingG: sim.dirt.remainingSolids(),
    missionTime: sim.stats.missionTime,
    eta: c.estimateRemaining(),
    mission: m
      ? {
          id: m.id,
          kind: m.settings.kind,
          kindLabel: MISSION_LABEL[m.settings.kind],
          phase: m.phase,
          pass: m.pass,
          passes: m.settings.passes,
          tasksDone: m.tasksDone,
          tasksPlanned: m.tasksPlanned,
          tasksLeft: m.tasks.length + (c.currentTask ? 1 : 0),
          tasksSkipped: m.tasksSkipped,
          rechargeCount: m.rechargeCount,
          resumeReason: m.resumeReason,
          cleanMode: m.settings.cleanMode,
          result: m.result,
        }
      : null,
    target: c.targetLabel,
    targetPoint: c.targetPoint ? { ...c.targetPoint } : null,
    nav: { state: sim.nav.state, replans: sim.nav.replans, recovery: sim.nav.recovery, lastEvent: sim.nav.lastEvent?.message ?? null },
    sensors: {
      lidarRays: sim.lidar.totalRays,
      lidarRate: sim.lidar.spinning ? cfg.lidar.raysPerRevolution * cfg.lidar.spinHz : 0,
      lidarSpinning: sim.lidar.spinning,
      bumper: b.bumperCompression > 0.5,
      bumps: sim.stats.bumps,
      cliffEvents: sim.stats.cliffEvents,
      cliffNow: b.cliffTriggered,
      frontNearest: sim.front.nearest,
      wallGap: sim.wall.side,
      surface: surface ? SURFACE[surface].label : '—',
      mapKnownArea: sim.map.occ.knownArea(),
    },
    dock: {
      phase: sim.dock.phase,
      progress: sim.dock.phaseProgress,
      cleanTank: sim.dock.cleanTank / cfg.dock.cleanTankCapacity,
      dirtyTank: sim.dock.dirtyTank / cfg.dock.dirtyTankCapacity,
      dustBag: sim.dock.dustBag / cfg.dock.dustBagCapacity,
    },
    suction: c.suction,
    water: c.water,
    diag: c.diag.map((d) => ({ ...d })),
    simStepMs: sim.stepMs,
  };
}
