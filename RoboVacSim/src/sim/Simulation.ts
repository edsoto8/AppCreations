import { DEFAULT_CONFIG, SURFACE, mergeConfig, type DeepPartial, type SimConfig } from './config';
import { SimClock } from './core/clock';
import { Emitter } from './core/events';
import { TAU } from './core/math';
import { Rng } from './core/rng';
import { DIRT_KINDS, DirtField, type PassResult } from './cleaning/DirtField';
import { DockStation } from './dock/DockStation';
import { RobotMap } from './mapping/RobotMap';
import { RobotController } from './mission/RobotController';
import type { Command, CommandResult, MissionState } from './mission/types';
import { Navigator } from './navigation/Navigator';
import { Resources } from './resources/Resources';
import { RobotBody } from './robot/RobotBody';
import { ROBOT } from './robot/robotSpec';
import { FrontSensor } from './sensors/FrontSensor';
import { Lidar } from './sensors/Lidar';
import { WallSensor } from './sensors/WallSensor';
import type { DirtKind, HouseLayout, Vec2 } from './world/types';
import { WorldModel } from './world/WorldModel';

export interface LogEntry {
  id: number;
  time: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface SimEvents extends Record<string, unknown> {
  log: LogEntry;
  layout: HouseLayout;
  missionEnd: MissionState;
}

/** Accumulated animation state for renderers (pure numbers, read every frame). */
export interface AnimAccumulators {
  mainBrushAngle: number;
  sideBrushAngle: number;
  mopAngle: number;
  mopLowered: number;
  suction: number;
  dustbinOpen: number;
}

export interface Stats {
  distance: number;
  areaCleaned: number;
  missionTime: number;
  bumps: number;
  cliffEvents: number;
  replans: number;
}

/**
 * The whole simulation. Deterministic for a given layout + config.seed + command sequence.
 * Rendering never mutates it except through the command / editing API.
 */
export class Simulation {
  readonly cfg: SimConfig;
  readonly clock: SimClock;
  readonly events = new Emitter<SimEvents>();
  layout: HouseLayout;
  world: WorldModel;
  readonly body: RobotBody;
  readonly lidar: Lidar;
  readonly front: FrontSensor;
  readonly wall = new WallSensor();
  readonly map: RobotMap;
  readonly nav: Navigator;
  readonly dirt: DirtField;
  readonly res: Resources;
  readonly dock: DockStation;
  readonly ctrl: RobotController;
  readonly anim: AnimAccumulators = { mainBrushAngle: 0, sideBrushAngle: 0, mopAngle: 0, mopLowered: 0, suction: 0, dustbinOpen: 0 };
  readonly stats: Stats = { distance: 0, areaCleaned: 0, missionTime: 0, bumps: 0, cliffEvents: 0, replans: 0 };
  /** Past trajectory (x, y pairs). */
  readonly trail: Float32Array;
  trailCount = 0;
  private trailHead = 0;
  readonly logs: LogEntry[] = [];
  private logId = 1;
  private readonly pass: PassResult = { solids: 0, liquid: 0, stain: 0, newArea: 0 };
  private surfaceTimer = 0;
  private frontSamples = 0;
  private lastTrail: Vec2 = { x: NaN, y: NaN };
  /** Simulation step cost (ms) moving average, for the perf overlay. */
  stepMs = 0;
  disposed = false;

  constructor(layout: HouseLayout, config: DeepPartial<SimConfig> = {}) {
    this.cfg = mergeConfig(DEFAULT_CONFIG, config);
    this.layout = structuredClone(layout);
    const rng = new Rng(this.cfg.seed);
    this.clock = new SimClock(this.cfg.stepDt);
    this.world = new WorldModel(this.layout, this.cfg.mapping.cellSize);
    this.body = new RobotBody(this.cfg.robot, rng.fork('body'));
    this.lidar = new Lidar(this.cfg.lidar, rng.fork('lidar'));
    this.front = new FrontSensor();
    this.map = new RobotMap(this.world.grid, this.cfg.mapping);
    this.nav = new Navigator(this.map, this.cfg.navigation);
    this.dirt = new DirtField(this.world, this.cfg.cleaning);
    this.dirt.seed(this.layout, this.cfg.seed);
    this.res = new Resources(this.cfg);
    this.dock = new DockStation(this.cfg);
    this.trail = new Float32Array(8000 * 2);
    this.ctrl = new RobotController(this.cfg, this.body, this.map, this.nav, this.res, this.dock, this.world, {
      log: (level, message) => this.log(level, message),
      dirtPasses: () => this.dirt.passes,
      resetPasses: () => {
        this.dirt.resetPasses();
        this.stats.areaCleaned = 0;
        this.stats.missionTime = 0;
      },
      lidarRays: () => this.lidar.totalRays,
      frontSamples: () => this.frontSamples,
      openDirection: () => this.openDirection(),
      frontNearest: () => this.front.nearest,
      wallGap: () => this.wall,
      onMissionEnd: (m) => this.events.emit('missionEnd', m),
    });
    const d = this.layout.dock;
    this.body.setPose(d.x, d.y, d.theta);
    this.dock.dock(0, { emptyBin: false, washMop: false, water: false, dry: false });
    this.ctrl.docked = true;
    this.ctrl.setMode('charging');
    this.syncZones();
    this.log('info', `Scenario "${this.layout.name}" loaded (seed ${this.cfg.seed})`);
  }

  log(level: LogEntry['level'], message: string): void {
    const e: LogEntry = { id: this.logId++, time: this.clock.time, level, message };
    this.logs.push(e);
    if (this.logs.length > 300) this.logs.shift();
    this.events.emit('log', e);
  }

  // ------------------------------------------------------------------ stepping

  get paused(): boolean {
    return this.ctrl.mode === 'paused';
  }

  /** Advance by real elapsed time; runs as many fixed steps as the speed multiplier requires. */
  advance(realDt: number): number {
    if (this.disposed) return 0;
    this.clock.paused = this.paused;
    const n = this.clock.advance(realDt);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.step();
    if (n > 0) this.stepMs = this.stepMs * 0.9 + ((performance.now() - t0) / n) * 0.1;
    return n;
  }

  /** Run `seconds` of simulated time immediately (tests / fast-forward). */
  runFor(seconds: number, until?: () => boolean): number {
    const steps = Math.round(seconds / this.cfg.stepDt);
    for (let i = 0; i < steps; i++) {
      if (this.paused) return i;
      this.step();
      if (until && until()) return i + 1;
    }
    return steps;
  }

  /** One fixed simulation step. Does nothing while paused (state is frozen). */
  step(): void {
    if (this.paused || this.disposed) return;
    const dt = this.cfg.stepDt;
    const time = this.clock.time;
    const b = this.body;
    const ctrl = this.ctrl;

    ctrl.update(dt, time);
    if (this.paused) return;

    const surface = this.world.surfaceAt(b.x, b.y) ?? 'hardwood';
    const drag = SURFACE[surface].drag;
    const px = b.x;
    const py = b.y;
    b.step(dt, ctrl.v, ctrl.w, this.world, drag);
    const moved = Math.hypot(b.x - px, b.y - py);
    this.stats.distance += moved;
    if (b.bumped) {
      this.stats.bumps++;
      this.map.markLowObstacle(b.bumpX, b.bumpY, 0.035);
    }
    if (b.cliffTriggered) {
      this.stats.cliffEvents++;
      this.map.markCliff(b.cliffX, b.cliffY);
      if (this.stats.cliffEvents % 20 === 1) this.log('warn', 'Cliff sensor triggered — drop-off marked on map');
    }

    // Sensors -> map
    this.lidar.spinning = ctrl.act.lidar;
    this.lidar.step(dt, b.x, b.y, b.theta, this.world);
    this.map.integrateLidar(this.lidar.stepRays, this.lidar.rayCount);
    this.map.markRobotFootprint(b.x, b.y);
    this.wall.step(b.x, b.y, b.theta, this.world);
    if (this.front.step(dt, b.x, b.y, b.theta, this.world)) {
      this.frontSamples++;
      this.integrateFrontSensor();
    }
    this.surfaceTimer += dt;
    if (this.surfaceTimer >= 0.2) {
      this.surfaceTimer = 0;
      const ahead = 0.25;
      this.map.senseSurface(b.x + Math.cos(b.theta) * ahead, b.y + Math.sin(b.theta) * ahead, 0.4, (x, y) => {
        const idx = this.world.grid.indexAt(x, y);
        const c = idx >= 0 ? this.world.surface[idx] : 255;
        return c;
      });
    }
    this.map.update(dt);

    // Cleaning
    const act = ctrl.act;
    const res = this.res;
    let wet = res.padWetness;
    if (act.mop) wet = res.dispenseWater(dt, act.water, Math.abs(b.v) > 0.02);
    const cleaningMode = ctrl.mode === 'cleaning' || ctrl.mode === 'recovering' || (ctrl.mode === 'manual' && act.vacuum);
    if (cleaningMode && (act.vacuum || act.mop)) {
      const r = this.dirt.clean(
        b.x,
        b.y,
        b.theta,
        { mode: ctrl.cleanMode, suction: act.suction ?? 'standard', water: act.water, vacuumOn: act.vacuum, mopOn: act.mop && this.anim.mopLowered > 0.8, speed: b.v, binFill: res.binFill, padWetness: wet, padSoil: res.padSoil },
        this.pass,
      );
      res.collect(r.solids, r.liquid, r.stain);
      this.stats.areaCleaned += r.newArea;
    }

    // Resources & dock
    const charging = ctrl.docked && this.dock.robotDocked;
    res.step(dt, {
      speed: Math.abs(b.v),
      turnRate: Math.abs(b.w),
      drag,
      lidarOn: act.lidar,
      brushesOn: act.brushes,
      suction: act.suction,
      mopping: act.mop,
      charging,
    });
    this.dock.step(dt, time, res);
    if (ctrl.mission && ctrl.isMissionActive()) this.stats.missionTime += dt;

    // Animation accumulators
    const an = this.anim;
    if (act.brushes) {
      an.mainBrushAngle += dt * 32;
      an.sideBrushAngle += dt * 14;
    }
    an.suction += ((act.suction ? 1 : 0) - an.suction) * Math.min(1, dt * 3);
    an.mopLowered += ((act.mop ? 1 : 0) - an.mopLowered) * Math.min(1, dt * 2.5);
    if (an.mopLowered > 0.5 || (this.dock.phase === 'mopWash' && charging)) an.mopAngle += dt * (this.dock.phase === 'mopWash' ? 16 : 9);

    // Trajectory
    if (!(Math.hypot(b.x - this.lastTrail.x, b.y - this.lastTrail.y) < 0.08)) {
      this.lastTrail = { x: b.x, y: b.y };
      const h = this.trailHead;
      this.trail[h * 2] = b.x;
      this.trail[h * 2 + 1] = b.y;
      this.trailHead = (h + 1) % (this.trail.length / 2);
      this.trailCount = Math.min(this.trailCount + 1, this.trail.length / 2);
    }
    this.stats.replans = this.nav.replans;
    this.clock.tick();
  }

  /** Iterate the trajectory in chronological order. */
  forEachTrail(fn: (x: number, y: number) => void): void {
    const cap = this.trail.length / 2;
    const start = this.trailCount < cap ? 0 : this.trailHead;
    for (let k = 0; k < this.trailCount; k++) {
      const i = (start + k) % cap;
      fn(this.trail[i * 2], this.trail[i * 2 + 1]);
    }
  }

  private integrateFrontSensor(): void {
    const f = this.front;
    const b = this.body;
    const ox = b.x + Math.cos(b.theta) * (ROBOT.radius - 0.02);
    const oy = b.y + Math.sin(b.theta) * (ROBOT.radius - 0.02);
    for (let k = 0; k < f.rays; k++) {
      const a = b.theta - f.halfFov + (2 * f.halfFov * k) / (f.rays - 1);
      // Free space up to the detection (or full range) clears stale low-obstacle memory.
      const rr = f.rayRange[k];
      const range = Number.isFinite(rr) ? Math.max(0, rr - 0.04) : f.range;
      this.map.clearLowAlong(ox, oy, ox + Math.cos(a) * range, oy + Math.sin(a) * range);
    }
    for (const d of f.detections) this.map.markLowObstacle(d.x, d.y, 0.025);
  }

  /** Direction (robot frame) of the longest LiDAR return, used by recovery behaviours. */
  private openDirection(): number {
    const r = this.lidar.scanRanges;
    const n = r.length;
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < n; i += 4) {
      // Score = min range over a ±20° window (a gap must be wide enough to fit through).
      let mn = Infinity;
      for (let k = -20; k <= 20; k += 4) {
        const v = r[(i + k + n) % n];
        mn = Math.min(mn, Number.isNaN(v) ? this.cfg.lidar.range : v);
      }
      if (mn > bestScore) {
        bestScore = mn;
        best = i;
      }
    }
    const a = (best / n) * TAU;
    return a > Math.PI ? a - TAU : a;
  }

  // ------------------------------------------------------------------ commands & editing

  command(c: Command): CommandResult {
    const r = this.ctrl.command(c);
    if (!r.ok) this.log('warn', `Command "${c.type}" rejected: ${r.reason}`);
    if (r.ok && c.type === 'start') this.syncZones();
    return r;
  }

  /** User zones go straight into the robot's costmap (they are drawn on the robot's app map). */
  syncZones(): void {
    const mopOnly = this.ctrl.mission && this.ctrl.isMissionActive() && this.ctrl.mission.settings.cleanMode === 'mop';
    const zones = this.layout.zones.filter((z) => z.kind === 'noGo' || (mopOnly && z.kind === 'noMop')).map((z) => z.rect);
    this.map.setNoGo(zones);
  }

  /**
   * Apply an edit to the environment. The ground-truth world is rebuilt; the robot's map is NOT —
   * it has to perceive the change with its sensors.
   */
  editLayout(mutate: (l: HouseLayout) => void): void {
    const next = structuredClone(this.layout);
    mutate(next);
    this.layout = next;
    this.world = new WorldModel(next, this.cfg.mapping.cellSize);
    this.dirt.rebind(this.world);
    this.ctrl.setWorld(this.world);
    this.syncZones();
    this.events.emit('layout', next);
  }

  spill(kind: DirtKind, x: number, y: number, radius = 0.35): void {
    const amount = { dust: 12, crumbs: 25, hair: 4, liquid: 180, stain: 0.9 }[kind];
    this.dirt.addPatch({ kind, x, y, radius, amount }, new Rng(this.clock.steps + 7));
    this.log('info', `Spilled ${kind} at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  clearMap(): void {
    this.map.occ.reset();
    this.map.lowObstacles.fill(0);
    this.map.cliffs.fill(0);
    this.map.knownSurface.fill(255);
    this.map.visited.fill(0);
    this.map.update(0, true);
    this.lidar.clearCloud();
    this.log('info', 'Robot map cleared — the next mission will re-explore');
  }

  dispose(): void {
    this.disposed = true;
    this.events.clear();
  }

  // ------------------------------------------------------------------ telemetry

  coverage(): { percent: number; cleaned: number; target: number } {
    const m = this.ctrl.mission;
    const region = m?.region;
    const passes = this.dirt.passes;
    const cleanable = this.world.coverageTarget;
    let target = 0;
    let cleaned = 0;
    for (let i = 0; i < passes.length; i++) {
      if (!cleanable[i]) continue;
      if (region ? !region[i] : this.world.roomIndex[i] < 0) continue;
      target++;
      if (passes[i] > 0) cleaned++;
    }
    const a = this.world.grid.cellSize ** 2;
    return { percent: target ? (cleaned / target) * 100 : 0, cleaned: cleaned * a, target: target * a };
  }

  dirtSummary(): { remaining: Record<DirtKind, number>; removed: Record<DirtKind, number>; initial: Record<DirtKind, number> } {
    const remaining = {} as Record<DirtKind, number>;
    for (const k of DIRT_KINDS) remaining[k] = this.dirt.total(k);
    return { remaining, removed: { ...this.dirt.removed }, initial: { ...this.dirt.initialTotals } };
  }
}
