import type { CleanMode, SimConfig, SuctionLevel, WaterLevel } from '../config';
import { clamp, wrapAngle } from '../core/math';
import type { DockStation } from '../dock/DockStation';
import type { RobotMap } from '../mapping/RobotMap';
import { findFrontiers, type Frontier } from '../navigation/Frontier';
import type { Navigator } from '../navigation/Navigator';
import type { Resources } from '../resources/Resources';
import { DOCK } from '../robot/robotSpec';
import type { RobotBody } from '../robot/RobotBody';
import type { Vec2 } from '../world/types';
import type { WorldModel } from '../world/WorldModel';
import { buildRegion, effectiveRegion, erodeSpecks, planEdgeTasks, planLaneTasks, uncoveredMask } from './MissionPlanner';
import { canCommand, canTransition } from './transitions';
import {
  MISSION_LABEL,
  MODE_LABEL,
  type CleanTask,
  type Command,
  type CommandResult,
  type ManualInput,
  type MissionPhase,
  type MissionSettings,
  type MissionState,
  type ResumeReason,
  type RobotMode,
} from './types';

export interface Actuators {
  lidar: boolean;
  vacuum: boolean;
  brushes: boolean;
  suction: SuctionLevel | null;
  mop: boolean;
  water: WaterLevel;
}

export interface DiagStep {
  name: string;
  status: 'pending' | 'running' | 'pass' | 'fail';
  detail: string;
}

export interface ControllerHooks {
  log: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
  dirtPasses: () => Uint8Array;
  resetPasses: () => void;
  lidarRays: () => number;
  frontSamples: () => number;
  /** Most open LiDAR direction (robot frame). */
  openDirection: () => number;
  frontNearest: () => number;
  onMissionEnd: (m: MissionState) => void;
}

type DockStage = 'align' | 'approach' | 'settle';

/**
 * High-level robot behaviour: a finite state machine over RobotMode with explicit transition
 * guards (see transitions.ts). It never reads ground truth geometry: it plans on the RobotMap and
 * reacts to sensor flags provided by the body (bumper, cliff) and the sensors.
 */
export class RobotController {
  mode: RobotMode = 'idle';
  private pausedFrom: RobotMode = 'idle';
  private activeBeforeRecovery: RobotMode = 'cleaning';
  mission: MissionState | null = null;
  docked = true;
  errorMessage: string | null = null;
  /** Live-adjustable cleaning settings. */
  suction: SuctionLevel = 'standard';
  water: WaterLevel = 'medium';
  manual: ManualInput = { forward: 0, turn: 0, vacuum: false };
  readonly act: Actuators = { lidar: true, vacuum: false, brushes: false, suction: null, mop: false, water: 'medium' };
  v = 0;
  w = 0;
  currentTask: CleanTask | null = null;
  /** Human-readable navigation target. */
  targetLabel = '—';
  targetPoint: Vec2 | null = null;
  diag: DiagStep[] = [];
  /** Current cleaning mode in use (mission or manual). */
  cleanMode: CleanMode = 'vacuum';
  private missionIds = 1;
  private postUndock: 'mission' | 'diagnostic' | 'none' = 'none';
  private phaseBeforeReturn: MissionPhase = 'coverage';
  private undockDist = 0;
  private dockStage: DockStage = 'align';
  private dockAttempts = 0;
  private dockStageTime = 0;
  private resourceTimer = 0;
  private frontierTimer = 0;
  private exploreTime = 0;
  private currentFrontier: Frontier | null = null;
  private diagIndex = 0;
  private diagTime = 0;
  private diagAccum = 0;
  private diagRef = 0;
  private returnFailures = 0;
  private time = 0;
  private stepsInMode = 0;

  constructor(
    private readonly cfg: SimConfig,
    private readonly body: RobotBody,
    private readonly map: RobotMap,
    readonly nav: Navigator,
    private readonly res: Resources,
    private readonly dock: DockStation,
    private world: WorldModel,
    private readonly hooks: ControllerHooks,
  ) {}

  /** Replace the world reference after layout edits (rooms/region lookups only). */
  setWorld(world: WorldModel): void {
    this.world = world;
  }

  // ---------------------------------------------------------------- commands

  command(c: Command): CommandResult {
    const guard = canCommand(this.mode, c.type);
    if (!guard.ok) return guard;
    switch (c.type) {
      case 'start':
        return this.startMission(c.settings);
      case 'pause':
        this.pausedFrom = this.mode;
        this.setMode('paused');
        this.hooks.log('info', 'Paused — simulation state frozen');
        return { ok: true };
      case 'resume':
        this.setMode(this.pausedFrom);
        this.hooks.log('info', `Resumed (${MODE_LABEL[this.mode]})`);
        return { ok: true };
      case 'stop':
        this.stopAll('Stopped by user');
        return { ok: true };
      case 'dock':
        if (this.docked) return { ok: false, reason: 'Already docked' };
        if (this.mission && this.isMissionActive()) this.endMission('aborted', 'Returned to dock by user');
        this.goHome();
        return { ok: true };
      case 'manual':
        if (c.enable) {
          this.nav.cancel();
          this.setMode('manual');
          this.manual = { forward: 0, turn: 0, vacuum: false };
          this.hooks.log('info', 'Manual drive enabled (WASD / arrow keys)');
        } else if (this.mode === 'manual') {
          this.setMode(this.docked ? 'charging' : 'idle');
          this.hooks.log('info', 'Manual drive disabled');
        }
        return { ok: true };
      case 'diagnostic':
        this.diag = DIAG_STEPS.map((name) => ({ name, status: 'pending', detail: '' }));
        this.diagIndex = 0;
        this.diagTime = 0;
        if (this.docked) {
          this.postUndock = 'diagnostic';
          this.beginUndock();
        } else this.setMode('diagnostic');
        this.hooks.log('info', 'Diagnostic self-test started');
        return { ok: true };
      case 'clearError':
        this.errorMessage = null;
        this.setMode(this.docked ? 'charging' : 'idle');
        return { ok: true };
    }
  }

  private startMission(settings: MissionSettings): CommandResult {
    if (settings.kind === 'rooms' && settings.rooms.length === 0) return { ok: false, reason: 'Select at least one room' };
    if (settings.kind === 'spot' && !settings.spot) return { ok: false, reason: 'Pick a spot on the map first' };
    if (this.res.soc < this.cfg.battery.lowThreshold + 0.05) return { ok: false, reason: 'Battery too low — let the robot charge first' };
    if (settings.cleanMode !== 'vacuum' && this.res.cleanWater < 10) return { ok: false, reason: 'Robot water tank empty — dock to refill' };
    const { mask, area } = buildRegion(this.world, settings);
    if (area < 0.05) return { ok: false, reason: 'Selected area is empty' };
    this.mission = {
      id: this.missionIds++,
      settings: { ...settings, rooms: [...settings.rooms] },
      phase: 'starting',
      pass: 1,
      tasks: [],
      tasksPlanned: 0,
      tasksDone: 0,
      tasksSkipped: 0,
      touchups: 0,
      startedAt: this.time,
      endedAt: null,
      resumeReason: null,
      rechargeCount: 0,
      region: mask,
      regionArea: area,
      badFrontiers: [],
      result: null,
    };
    this.suction = settings.suction;
    this.water = settings.water;
    this.cleanMode = settings.cleanMode;
    this.errorMessage = null;
    this.exploreTime = 0;
    this.currentTask = null;
    this.hooks.resetPasses();
    this.hooks.log('info', `${MISSION_LABEL[settings.kind]} started (${settings.cleanMode}, ${settings.suction}, ${settings.passes} pass${settings.passes > 1 ? 'es' : ''})`);
    if (this.docked) {
      this.postUndock = 'mission';
      this.beginUndock();
    } else this.beginMission();
    return { ok: true };
  }

  isMissionActive(): boolean {
    const p = this.mission?.phase;
    return !!p && p !== 'completed' && p !== 'aborted' && p !== 'failed';
  }

  private stopAll(reason: string): void {
    this.nav.cancel();
    if (this.mission && this.isMissionActive()) this.endMission('aborted', reason);
    this.currentTask = null;
    this.targetLabel = '—';
    this.targetPoint = null;
    if (this.mode === 'docking' || this.mode === 'undocking') this.docked = false;
    this.setMode(this.docked ? 'charging' : 'idle');
    this.hooks.log('info', reason);
  }

  private endMission(phase: 'completed' | 'aborted' | 'failed', result: string): void {
    const m = this.mission;
    if (!m) return;
    m.phase = phase;
    m.result = result;
    m.endedAt = this.time;
    this.currentTask = null;
    this.hooks.onMissionEnd(m);
  }

  // ---------------------------------------------------------------- mode helpers

  setMode(next: RobotMode): void {
    if (next === this.mode) return;
    if (!canTransition(this.mode, next)) {
      this.hooks.log('warn', `Blocked invalid transition ${this.mode} → ${next}`);
      return;
    }
    this.mode = next;
    this.stepsInMode = 0;
  }

  private beginUndock(): void {
    this.undockDist = 0;
    this.setMode('undocking');
    this.dock.undock(this.time);
    this.targetLabel = 'Back off dock';
  }

  private beginMission(): void {
    const m = this.mission;
    if (!m) return;
    if (m.settings.kind === 'mapping') return this.enterExploring();
    const known = this.map.knownFraction(m.region);
    const frontiers = this.relevantFrontiers();
    if (known < 0.9 || frontiers.length > 0) return this.enterExploring();
    this.startCleaningPhases();
  }

  private enterExploring(): void {
    const m = this.mission!;
    m.phase = 'exploring';
    this.currentFrontier = null;
    this.nav.cancel();
    this.setMode('mapping');
    this.hooks.log('info', 'Exploring: building the map from LiDAR scans (frontier exploration)');
  }

  private startCleaningPhases(): void {
    const m = this.mission!;
    const k = m.settings.kind;
    if (k === 'whole' || k === 'rooms' || k === 'edge') this.enterPhase('edges');
    else this.enterPhase('coverage');
  }

  private enterPhase(phase: MissionPhase): void {
    const m = this.mission!;
    m.phase = phase;
    this.setMode('cleaning');
    this.map.update(0, true);
    const region = effectiveRegion(this.map, m.region, m.settings);
    const here = { x: this.body.x, y: this.body.y };
    let tasks: CleanTask[] = [];
    if (phase === 'edges') {
      tasks = planEdgeTasks(this.map, region, m.pass);
      this.hooks.log('info', `Edge cleaning: ${tasks.length} wall-following loop(s)`);
    } else if (phase === 'coverage') {
      tasks = planLaneTasks(this.map, region, m.pass, this.cfg.navigation, here, m.settings.kind === 'spot' ? 'spot' : 'lane');
      this.hooks.log('info', `Coverage pass ${m.pass}/${m.settings.passes}: ${tasks.length} boustrophedon lanes planned`);
    } else if (phase === 'touchup') {
      const un = uncoveredMask(this.map, region, this.hooks.dirtPasses(), m.pass);
      erodeSpecks(un.mask, this.map.geom.width);
      tasks = planLaneTasks(this.map, un.mask, m.pass, this.cfg.navigation, here).filter((t) => t.length >= 0.15);
      m.touchups++;
      this.hooks.log('info', `Touch-up: ${tasks.length} lanes over ${un.area.toFixed(1)} m² of missed floor`);
    }
    m.tasks = tasks;
    m.tasksPlanned += tasks.length;
    this.currentTask = null;
    if (tasks.length === 0) this.phaseComplete();
  }

  private phaseComplete(): void {
    const m = this.mission!;
    const s = m.settings;
    if (m.phase === 'edges') {
      if (s.kind === 'edge') return this.finishCleaning();
      return this.enterPhase('coverage');
    }
    if (m.phase === 'coverage' || m.phase === 'touchup') {
      if (s.kind !== 'spot' && m.touchups < 2 * m.pass) {
        const region = effectiveRegion(this.map, m.region, s);
        const un = uncoveredMask(this.map, region, this.hooks.dirtPasses(), m.pass);
        const n = erodeSpecks(un.mask, this.map.geom.width);
        const area = n * this.map.geom.cellSize ** 2;
        if (area > Math.max(0.3, m.regionArea * 0.02)) return this.enterPhase('touchup');
      }
      if (m.pass < s.passes) {
        m.pass++;
        m.touchups = 2 * (m.pass - 1);
        return this.enterPhase('coverage');
      }
      return this.finishCleaning();
    }
  }

  private finishCleaning(): void {
    const m = this.mission!;
    m.phase = 'homeReturn';
    this.hooks.log('success', 'Cleaning plan finished — returning to dock');
    this.goHome();
  }

  private goHome(): void {
    this.nav.cancel();
    this.currentTask = null;
    this.returnFailures = 0;
    this.setMode('returning');
    this.startReturnNav();
  }

  private approachPose(): Vec2 {
    const d = this.world.layout.dock;
    return { x: d.x - Math.cos(d.theta) * DOCK.approachDistance, y: d.y - Math.sin(d.theta) * DOCK.approachDistance };
  }

  private startReturnNav(): void {
    const p = this.approachPose();
    this.targetLabel = 'Dock';
    this.targetPoint = p;
    const allowUnknown = this.returnFailures > 0;
    this.nav.start({ points: [p], mode: 'goto', speed: this.cfg.robot.maxSpeed * 0.9, tolerance: 0.12, allowUnknown, label: 'dock approach' }, this.body.x, this.body.y);
  }

  /** Low battery / full bin / water: park the plan and go service at the dock. */
  private checkResources(): void {
    const m = this.mission;
    if (!m || !this.isMissionActive() || m.phase === 'rechargeReturn' || m.phase === 'homeReturn') return;
    const d = this.world.layout.dock;
    const distHome = Math.hypot(this.body.x - d.x, this.body.y - d.y) * 1.6 + 1;
    const needed = this.res.energyForTravel(distHome) / this.cfg.battery.capacityWh;
    const soc = this.res.soc;
    let reason: ResumeReason = null;
    if (soc <= Math.max(this.cfg.battery.lowThreshold, needed + 0.05)) reason = 'battery';
    else if (this.act.vacuum && this.res.binFill >= 0.98) reason = 'dustbin';
    else if (this.cleanMode !== 'vacuum' && this.res.cleanWater < 1) reason = 'water';
    else if (this.cleanMode !== 'vacuum' && this.res.dirtyWaterFrac >= 0.98) reason = 'dirtyWater';
    if (!reason) return;
    // Remember the remaining part of the current task so it resumes where it stopped.
    if (this.currentTask) {
      const t = this.currentTask;
      if (t.kind !== 'edge' && t.points.length === 2) {
        const a = t.points[0];
        const b = t.points[1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const u = len > 0 ? clamp(((this.body.x - a.x) * (b.x - a.x) + (this.body.y - a.y) * (b.y - a.y)) / (len * len), 0, 1) : 0;
        t.points = [{ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, b];
        t.length = len * (1 - u);
      }
      m.tasks.unshift(t);
      this.currentTask = null;
    }
    this.phaseBeforeReturn = m.phase === 'exploring' ? 'exploring' : m.phase;
    m.phase = 'rechargeReturn';
    m.resumeReason = reason;
    const label = { battery: `Battery low (${Math.round(soc * 100)}%)`, dustbin: 'Dustbin full', water: 'Clean water tank empty', dirtyWater: 'Dirty water tank full' }[reason];
    this.hooks.log('warn', `${label} — saving progress (${m.tasks.length} tasks left) and returning to dock`);
    this.goHome();
  }

  // ---------------------------------------------------------------- per-step update

  update(dt: number, time: number): void {
    this.time = time;
    this.stepsInMode++;
    this.v = 0;
    this.w = 0;
    if (this.mode === 'paused') return;

    // Battery exhausted anywhere off the dock = hard stop.
    if (!this.docked && this.res.soc <= 0.001 && this.mode !== 'error') {
      this.nav.cancel();
      if (this.mission && this.isMissionActive()) this.endMission('failed', 'Battery depleted');
      this.fault('Battery depleted — robot shut down');
    }

    this.resourceTimer += dt;
    if (this.resourceTimer >= 1) {
      this.resourceTimer = 0;
      if (this.mode === 'cleaning' || this.mode === 'mapping') this.checkResources();
    }

    switch (this.mode) {
      case 'idle':
      case 'error':
        break;
      case 'undocking':
        this.updateUndock(dt);
        break;
      case 'mapping':
        this.updateExploring(dt);
        break;
      case 'cleaning':
        this.updateCleaning();
        break;
      case 'returning':
        this.updateReturning();
        break;
      case 'docking':
        this.updateDocking(dt);
        break;
      case 'maintenance':
      case 'charging':
        this.updateDocked();
        break;
      case 'manual':
        this.updateManual();
        break;
      case 'recovering':
        this.driveNav(dt);
        if (!this.nav.recovery) this.setMode(this.activeBeforeRecovery);
        break;
      case 'diagnostic':
        this.updateDiagnostic(dt);
        break;
    }
    this.updateActuators();
  }

  private fault(msg: string): void {
    this.errorMessage = msg;
    this.nav.cancel();
    if (canTransition(this.mode, 'error')) this.setMode('error');
    else this.mode = 'error';
    this.hooks.log('error', msg);
  }

  /** Run the navigator for this step and expose recovery as a real mode transition. */
  private driveNav(dt: number): void {
    const b = this.body;
    const cmd = this.nav.update({
      x: b.x,
      y: b.y,
      theta: b.theta,
      v: b.v,
      bumped: b.bumped,
      bumpAngle: b.bumpAngle,
      cliff: b.cliffTriggered,
      frontNearest: this.hooks.frontNearest(),
      openDirection: this.hooks.openDirection(),
      dt,
    });
    this.v = cmd.v;
    this.w = cmd.w;
    if (this.nav.recovery === 'escape' || (this.nav.recovery === 'rotate' && this.mode !== 'recovering')) {
      if (this.mode === 'cleaning' || this.mode === 'mapping' || this.mode === 'returning') {
        this.activeBeforeRecovery = this.mode;
        this.setMode('recovering');
      }
    }
  }

  private updateUndock(dt: number): void {
    // Reverse straight off the base plate, ignoring the costmap (the dock is right in front of us).
    this.v = -0.12;
    this.undockDist += Math.abs(this.body.v) * dt;
    if (this.undockDist >= 0.45 || this.stepsInMode > 400) {
      this.docked = false;
      this.v = 0;
      if (this.postUndock === 'mission') {
        const m = this.mission;
        if (m && m.phase === 'recharging') this.resumeMission();
        else this.beginMission();
      } else if (this.postUndock === 'diagnostic') this.setMode('diagnostic');
      else this.setMode('idle');
      this.postUndock = 'none';
    }
  }

  private resumeMission(): void {
    const m = this.mission!;
    m.resumeReason = null;
    m.rechargeCount++;
    m.phase = this.phaseBeforeReturn;
    this.hooks.log('info', `Resuming mission: ${m.tasks.length} remaining tasks (${m.phase})`);
    if (m.phase === 'exploring') this.enterExploring();
    else this.setMode('cleaning');
  }

  private relevantFrontiers(): Frontier[] {
    const m = this.mission;
    this.map.update(0, true);
    const all = findFrontiers(this.map.occ, this.map.costmap, 8);
    const bad = m?.badFrontiers ?? [];
    const notBad = all.filter((f) => !bad.some((b) => Math.hypot(b.x - f.target.x, b.y - f.target.y) < 0.4));
    if (!m || m.settings.kind === 'whole' || m.settings.kind === 'mapping') {
      return notBad.filter((f) => this.world.roomAt(f.centroid.x, f.centroid.y) >= 0 || this.world.roomAt(f.target.x, f.target.y) >= 0);
    }
    // Room/spot/edge missions: only frontiers inside (or touching) the target region, unless most of it is unknown.
    if (this.map.knownFraction(m.region) < 0.5) return notBad;
    const g = this.map.geom;
    return notBad.filter((f) => {
      for (let k = 0; k < f.cells.length; k += 3) if (m.region[f.cells[k]]) return true;
      const idx = g.indexAt(f.target.x, f.target.y);
      return idx >= 0 && m.region[idx] === 1;
    });
  }

  private pickFrontier(): Frontier | null {
    const fs = this.relevantFrontiers();
    if (fs.length === 0) return null;
    const field = this.nav.planner.distanceField(this.map.costmap, { x: this.body.x, y: this.body.y });
    let best: Frontier | null = null;
    let bestScore = Infinity;
    for (const f of fs) {
      const idx = this.map.geom.indexAt(f.target.x, f.target.y);
      const d = idx >= 0 ? field[idx] : Infinity;
      if (!Number.isFinite(d)) continue;
      const score = d - Math.min(f.size, 60) * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    if (!best) {
      // Everything left is unreachable: blacklist them so we stop trying.
      for (const f of fs) this.mission?.badFrontiers.push(f.target);
    }
    return best;
  }

  private updateExploring(dt: number): void {
    const m = this.mission!;
    this.exploreTime += dt;
    this.frontierTimer += dt;
    const navDone = this.nav.state !== 'active';
    if (this.nav.state === 'failed' && this.currentFrontier) {
      m.badFrontiers.push(this.currentFrontier.target);
      this.hooks.log('warn', 'Frontier unreachable — blacklisted');
    } else if (this.nav.state === 'arrived' && this.currentFrontier) {
      // We stood at the frontier and scanned it: if it is still a frontier, it cannot be observed
      // (e.g. unknown cells behind a surface) — never select it again.
      m.badFrontiers.push(this.currentFrontier.target);
    }
    if (navDone) this.currentFrontier = null;
    // Re-check whether the current frontier is still unexplored every second.
    let stale = false;
    if (!navDone && this.currentFrontier && this.frontierTimer >= 1) {
      this.frontierTimer = 0;
      const t = this.currentFrontier.target;
      stale = !this.relevantFrontiers().some((f) => Math.hypot(f.target.x - t.x, f.target.y - t.y) < 0.6);
    }
    if (navDone || stale) {
      const f = this.exploreTime > 1800 ? null : this.pickFrontier();
      if (!f) {
        this.currentFrontier = null;
        this.nav.cancel();
        this.hooks.log('success', `Map complete: ${this.map.occ.knownArea().toFixed(1)} m² explored`);
        if (m.settings.kind === 'mapping') {
          m.phase = 'homeReturn';
          this.goHome();
        } else this.startCleaningPhases();
        return;
      }
      this.currentFrontier = f;
      this.targetLabel = `Frontier (${f.size} cells)`;
      this.targetPoint = f.target;
      if (!this.nav.start({ points: [f.target], mode: 'goto', speed: this.cfg.robot.maxSpeed, tolerance: 0.25, label: 'frontier' }, this.body.x, this.body.y)) {
        m.badFrontiers.push(f.target);
        this.currentFrontier = null;
      }
    }
    this.driveNav(dt);
  }

  private updateCleaning(): void {
    const m = this.mission;
    if (!m) return this.setMode('idle');
    const dt = this.cfg.stepDt;
    if (!this.currentTask || this.nav.state !== 'active') {
      if (this.currentTask) {
        if (this.nav.state === 'failed') {
          m.tasksSkipped++;
          this.hooks.log('warn', `Task skipped: ${this.nav.lastEvent?.message ?? 'unreachable'}`);
        } else {
          m.tasksDone++;
          if (this.nav.partial) m.tasksSkipped += 0;
        }
        this.currentTask = null;
      }
      const next = m.tasks.shift();
      if (!next) return this.phaseComplete();
      this.currentTask = next;
      const speed = next.kind === 'edge' ? this.cfg.robot.edgeSpeed : this.cfg.robot.cleaningSpeed;
      const label = next.kind === 'edge' ? 'edge loop' : `${next.kind} ${m.tasksDone + m.tasksSkipped + 1}/${m.tasksPlanned}`;
      this.targetLabel = label;
      this.targetPoint = next.points[next.points.length - 1];
      this.nav.start({ points: next.points, mode: 'track', speed, tolerance: 0.05, label }, this.body.x, this.body.y);
      if (this.nav.state !== 'active') return; // failed immediately; handled next step
    }
    this.driveNav(dt);
  }

  private updateReturning(): void {
    const dt = this.cfg.stepDt;
    if (this.nav.state === 'arrived') {
      this.dockStage = 'align';
      this.dockStageTime = 0;
      this.dockAttempts = 0;
      this.setMode('docking');
      this.hooks.log('info', 'At dock approach point — aligning with IR beacon');
      return;
    }
    if (this.nav.state === 'failed' || this.nav.state === 'idle') {
      this.returnFailures++;
      if (this.returnFailures > 3) {
        if (this.mission && this.isMissionActive()) this.endMission('failed', 'Could not reach dock');
        return this.fault('Cannot find a path back to the dock');
      }
      this.hooks.log('warn', `Return path blocked — retrying (${this.returnFailures}/3)`);
      this.startReturnNav();
    }
    this.driveNav(dt);
  }

  private updateDocking(dt: number): void {
    // Final docking uses the dock's IR beacon (modelled as the known dock pose) for precise alignment.
    const d = this.world.layout.dock;
    const b = this.body;
    this.dockStageTime += dt;
    this.targetLabel = 'Docking';
    if (this.dockStage === 'align') {
      // Line up on the dock axis: first face the approach point if we are off-axis, then face the dock.
      const ex = b.x - d.x;
      const ey = b.y - d.y;
      const along = ex * Math.cos(d.theta) + ey * Math.sin(d.theta);
      const lateral = -ex * Math.sin(d.theta) + ey * Math.cos(d.theta);
      if (Math.abs(lateral) > 0.03 && along < -0.3) {
        const ax = d.x + Math.cos(d.theta) * along;
        const ay = d.y + Math.sin(d.theta) * along;
        const head = Math.atan2(ay - b.y, ax - b.x);
        const err = wrapAngle(head - b.theta);
        this.w = clamp(err * 3, -1.2, 1.2);
        this.v = Math.abs(err) < 0.15 ? Math.min(0.1, Math.abs(lateral)) : 0;
        if (this.dockStageTime > 15) this.retryDock('alignment timeout');
        return;
      }
      const err = wrapAngle(d.theta - b.theta);
      this.w = clamp(err * 3, -1.2, 1.2);
      if (Math.abs(err) < 0.02) {
        this.dockStage = 'approach';
        this.dockStageTime = 0;
      }
      return;
    }
    if (this.dockStage === 'approach') {
      const ex = d.x - b.x;
      const ey = d.y - b.y;
      const along = ex * Math.cos(d.theta) + ey * Math.sin(d.theta);
      const lateral = -ex * Math.sin(d.theta) + ey * Math.cos(d.theta);
      const headingErr = wrapAngle(d.theta - b.theta);
      this.v = clamp(along * 0.6, 0.03, 0.12);
      this.w = clamp(headingErr * 3 + lateral * 4, -0.8, 0.8);
      if (b.bumped) return this.retryDock('contact misaligned');
      if (along <= 0.004) {
        this.v = 0;
        this.w = 0;
        this.dockStage = 'settle';
        this.dockStageTime = 0;
      }
      if (this.dockStageTime > 20) this.retryDock('approach timeout');
      return;
    }
    // settle: contacts engaged
    if (this.dockStageTime > 0.3) this.onDocked();
  }

  private retryDock(why: string): void {
    this.dockAttempts++;
    if (this.dockAttempts > 3) return this.fault(`Docking failed (${why})`);
    this.hooks.log('warn', `Docking retry ${this.dockAttempts}: ${why}`);
    this.setMode('returning');
    this.startReturnNav();
  }

  private onDocked(): void {
    const d = this.world.layout.dock;
    // Snap onto the contacts (mechanical guides on the base plate centre the robot).
    this.body.setPose(d.x, d.y, d.theta);
    this.docked = true;
    this.nav.cancel();
    const m = this.mission;
    const usedMop = (m && m.settings.cleanMode !== 'vacuum') || this.res.padSoil > 0.05;
    const finished = !m || !this.isMissionActive() || m.phase === 'homeReturn';
    this.dock.dock(this.time, {
      emptyBin: this.res.dustbin > 0.5,
      washMop: !!usedMop,
      water: !!usedMop || this.res.cleanWaterFrac < 0.95,
      dry: !!usedMop && finished,
    });
    this.hooks.log('success', 'Docked — charging started');
    if (m && m.phase === 'homeReturn') {
      this.endMission('completed', 'Mission completed');
      this.hooks.log('success', `Mission completed in ${formatDuration(this.time - m.startedAt)}`);
    } else if (m && m.phase === 'rechargeReturn') {
      m.phase = 'recharging';
    }
    this.setMode(this.dock.busy || this.dock.phase === 'charging' ? 'maintenance' : 'charging');
  }

  private updateDocked(): void {
    this.targetLabel = '—';
    this.targetPoint = null;
    const busy = this.dock.busy;
    if (busy && this.mode !== 'maintenance') this.setMode('maintenance');
    if (!busy && this.mode === 'maintenance' && this.dock.phase !== 'charging') this.setMode('charging');
    if (this.mode === 'maintenance' && this.dock.phase === 'charging' && this.dock.phaseProgress >= 1) this.setMode('charging');
    const m = this.mission;
    if (m && m.phase === 'recharging' && this.dock.serviceComplete) {
      const needCharge = m.resumeReason === 'battery';
      const ready = needCharge ? this.res.soc >= this.cfg.battery.resumeThreshold : this.res.soc >= this.cfg.battery.lowThreshold + 0.1;
      if (ready) {
        this.hooks.log('info', `Recharged to ${Math.round(this.res.soc * 100)}% — resuming mission`);
        this.postUndock = 'mission';
        this.beginUndock();
      }
    }
  }

  private updateManual(): void {
    const mi = this.manual;
    this.v = clamp(mi.forward, -1, 1) * this.cfg.robot.maxSpeed * 0.85;
    this.w = clamp(mi.turn, -1, 1) * this.cfg.robot.maxTurnRate * 0.6;
    if (this.docked) {
      const d = this.world.layout.dock;
      if (Math.hypot(this.body.x - d.x, this.body.y - d.y) > 0.03) {
        this.docked = false;
        this.dock.undock(this.time);
      }
    }
  }

  private updateDiagnostic(dt: number): void {
    const step = this.diag[this.diagIndex];
    if (!step) {
      const failed = this.diag.filter((s) => s.status === 'fail').length;
      this.hooks.log(failed ? 'warn' : 'success', `Self-test finished: ${this.diag.length - failed}/${this.diag.length} passed`);
      this.setMode('idle');
      return;
    }
    if (step.status === 'pending') {
      step.status = 'running';
      this.diagTime = 0;
      this.diagAccum = 0;
      this.diagRef = this.diagIndex === 0 ? this.hooks.lidarRays() : this.diagIndex === 2 ? this.body.odometer : this.diagIndex === 8 ? this.hooks.frontSamples() : 0;
    }
    this.diagTime += dt;
    const finish = (ok: boolean, detail: string) => {
      step.status = ok ? 'pass' : 'fail';
      step.detail = detail;
      this.diagIndex++;
    };
    switch (this.diagIndex) {
      case 0:
        if (this.diagTime >= 1.5) {
          const rays = this.hooks.lidarRays() - this.diagRef;
          finish(rays > 1000, `${rays} rays in 1.5 s (${(rays / 1.5).toFixed(0)}/s)`);
        }
        break;
      case 1:
        this.w = 1.2;
        this.diagAccum += Math.abs(this.body.w) * dt;
        if (this.diagAccum >= Math.PI * 2 || this.diagTime > 10) finish(this.diagAccum >= Math.PI * 2 * 0.98, `Rotated ${((this.diagAccum * 180) / Math.PI).toFixed(0)}° in ${this.diagTime.toFixed(1)} s`);
        break;
      case 2:
        this.v = this.diagTime < 1.2 ? 0.12 : this.diagTime < 2.4 ? -0.12 : 0;
        if (this.diagTime >= 2.6) {
          const d = this.body.odometer - this.diagRef;
          finish(d > 0.2, `Odometry ${(d * 100).toFixed(1)} cm (fwd + back)`);
        }
        break;
      case 3:
      case 4:
      case 5:
        if (this.diagTime >= 2) finish(true, this.diagIndex === 4 ? `Fan draw ${this.res.power.suction.toFixed(0)} W` : 'Motor current nominal');
        break;
      case 6: {
        let floorOk = 0;
        for (let k = 0; k < 6; k++) {
          const p = this.body.cliffSensorWorld(k, this.body.x, this.body.y, this.body.theta);
          if (!this.world.isCliff(p.x, p.y)) floorOk++;
        }
        finish(floorOk === 6, `${floorOk}/6 sensors see floor`);
        break;
      }
      case 7:
        finish(!this.body.bumped, this.body.bumped ? 'Bumper pressed' : 'Bumper switch released');
        break;
      case 8:
        if (this.diagTime >= 1) {
          const n = this.hooks.frontSamples() - this.diagRef;
          finish(n >= 5, `${n} structured-light frames`);
        }
        break;
      default:
        this.diagIndex++;
    }
  }

  private updateActuators(): void {
    const a = this.act;
    a.water = this.water;
    a.lidar = this.mode !== 'error' || this.errorMessage === null;
    a.vacuum = false;
    a.brushes = false;
    a.suction = null;
    a.mop = false;
    const cleaningNow = this.mode === 'cleaning' || (this.mode === 'recovering' && this.activeBeforeRecovery === 'cleaning');
    if (cleaningNow) {
      a.vacuum = this.cleanMode !== 'mop';
      a.brushes = a.vacuum;
      a.suction = a.vacuum ? this.suction : null;
      a.mop = this.cleanMode !== 'vacuum' && this.mopAllowedHere();
    } else if (this.mode === 'manual') {
      a.vacuum = this.manual.vacuum;
      a.brushes = this.manual.vacuum;
      a.suction = this.manual.vacuum ? this.suction : null;
    } else if (this.mode === 'diagnostic') {
      a.brushes = this.diagIndex === 3;
      a.suction = this.diagIndex === 4 ? 'turbo' : null;
      a.mop = this.diagIndex === 5;
    }
  }

  /** Mop pads lift on carpets/rugs (sensed) and inside no-mop zones. */
  private mopAllowedHere(): boolean {
    const idx = this.map.geom.indexAt(this.body.x, this.body.y);
    if (idx >= 0 && this.map.isKnownSoftFloor(idx)) return false;
    for (const z of this.world.layout.zones) {
      if (z.kind !== 'noMop') continue;
      const r = z.rect;
      if (this.body.x > r.x - 0.15 && this.body.x < r.x + r.w + 0.15 && this.body.y > r.y - 0.15 && this.body.y < r.y + r.h + 0.15) return false;
    }
    return true;
  }

  /** Estimated remaining mission time (s). */
  estimateRemaining(): number {
    const m = this.mission;
    if (!m || !this.isMissionActive()) return 0;
    let len = 0;
    for (const t of m.tasks) len += t.length + 0.25;
    if (this.currentTask) len += this.nav.remainingDistance(this.body.x, this.body.y);
    const futurePasses = m.settings.passes - m.pass;
    const laneLen = m.regionArea / this.cfg.navigation.laneSpacing;
    len += futurePasses * laneLen * 0.8;
    let t = (len / this.cfg.robot.cleaningSpeed) * 1.35;
    if (m.phase === 'exploring') t += laneLen * m.settings.passes / this.cfg.robot.cleaningSpeed;
    // Recharge estimate if the battery will not last.
    const watts = 40;
    const need = (t * watts) / 3600;
    const avail = (this.res.soc - this.cfg.battery.lowThreshold) * this.cfg.battery.capacityWh;
    if (need > avail) t += ((this.cfg.battery.resumeThreshold - this.cfg.battery.lowThreshold) * this.cfg.battery.capacityWh * 3600) / this.cfg.battery.chargePower;
    return t + 30;
  }
}

const DIAG_STEPS = [
  'LiDAR spin & ranging',
  'IMU / rotation 360°',
  'Drive wheels & odometry',
  'Brush motors',
  'Suction fan',
  'Mop lift actuator',
  'Cliff sensors',
  'Bumper switch',
  'Structured-light camera',
];

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m ${sec.toString().padStart(2, '0')}s`;
}
