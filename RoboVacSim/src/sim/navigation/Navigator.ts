import type { SimConfig } from '../config';
import { wrapAngle } from '../core/math';
import { COST_UNKNOWN } from '../mapping/Costmap';
import { ROBOT } from '../robot/robotSpec';
import type { RobotMap } from '../mapping/RobotMap';
import type { Vec2 } from '../world/types';
import { AStarPlanner } from './AStar';
import { PathFollower } from './PathFollower';

export type NavState = 'idle' | 'active' | 'arrived' | 'failed';
export type NavFailure = 'noPath' | 'stuck' | 'blocked' | null;
export type RecoveryKind = 'backup' | 'rotate' | 'escape' | null;

export interface NavRequest {
  /** Either a single goal point (A* planned), or a polyline to track exactly (approached via A*). */
  points: Vec2[];
  mode: 'goto' | 'track';
  speed: number;
  tolerance?: number;
  allowUnknown?: boolean;
  /** Label shown in telemetry, e.g. "Lane 12/40". */
  label: string;
}

export interface NavInputs {
  x: number;
  y: number;
  theta: number;
  v: number;
  bumped: boolean;
  bumpAngle: number;
  cliff: boolean;
  /** Nearest front-sensor return (m), Infinity if clear. */
  frontNearest: number;
  /** Longest-range LiDAR direction (robot frame, rad) for recovery rotation. */
  openDirection: number;
  dt: number;
}

export interface NavEvent {
  type: 'replan' | 'detour' | 'recovery' | 'skip' | 'fail' | 'arrive';
  message: string;
}

/**
 * Navigation executive. Owns the current path and turns it into (v, w) commands every step:
 *   plan (A*) -> follow (pure pursuit) -> validate path against the live costmap -> replan / detour
 *   -> reflexes for bumper & cliff -> stuck detection -> recovery behaviours -> failure reporting.
 */
export class Navigator {
  state: NavState = 'idle';
  failure: NavFailure = null;
  request: NavRequest | null = null;
  /** Current full path being followed (world points). */
  path: Vec2[] = [];
  readonly planner: AStarPlanner;
  readonly follower = new PathFollower();
  recovery: RecoveryKind = null;
  recoveryAttempts = 0;
  bumpsOnGoal = 0;
  replans = 0;
  /** True if part of a tracked polyline had to be skipped. */
  partial = false;
  lastEvent: NavEvent | null = null;
  readonly events: NavEvent[] = [];
  private validateTimer = 0;
  private lastCostmapVersion = -1;
  private stuckTimer = 0;
  private stuckRef = { x: 0, y: 0, remaining: Infinity };
  private stallTime = 0;
  private recoveryTarget = 0;
  private recoveryProgress = 0;
  private recoveryTimer = 0;
  private readonly out = { v: 0, w: 0 };
  private lastSeg = 0;

  constructor(
    private readonly map: RobotMap,
    private readonly cfg: SimConfig['navigation'],
  ) {
    this.planner = new AStarPlanner(map.geom);
  }

  start(req: NavRequest, x: number, y: number): boolean {
    this.request = req;
    this.state = 'active';
    this.failure = null;
    this.recovery = null;
    this.recoveryAttempts = 0;
    this.bumpsOnGoal = 0;
    this.partial = false;
    this.stuckTimer = 0;
    this.stallTime = 0;
    this.stuckRef = { x, y, remaining: Infinity };
    this.follower.params.maxV = req.speed;
    this.follower.params.goalTolerance = req.tolerance ?? 0.06;
    return this.buildPath(x, y);
  }

  cancel(): void {
    this.state = 'idle';
    this.request = null;
    this.path = [];
    this.recovery = null;
  }

  private emit(type: NavEvent['type'], message: string): void {
    this.lastEvent = { type, message };
    this.events.push(this.lastEvent);
    if (this.events.length > 50) this.events.shift();
  }

  /** Plan from the robot to the request (goto) or to the polyline start + polyline (track). */
  private buildPath(x: number, y: number): boolean {
    const req = this.request;
    if (!req) return false;
    this.map.update(0, true);
    const cm = this.map.costmap;
    const start = { x, y };
    if (req.mode === 'goto') {
      const res = this.planner.plan(cm, start, req.points[0], { allowUnknown: req.allowUnknown, goalTolerance: req.tolerance ?? 0.2 });
      if (!res.ok) return this.fail('noPath', `No path to ${req.label} (${res.reason ?? 'unknown'})`);
      this.setPath(res.path);
      return true;
    }
    // Track mode: approach the first polyline point that is reachable.
    const pts = req.points;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const d = Math.hypot(p.x - x, p.y - y);
      let approach: Vec2[];
      if (d < 0.12) approach = [start];
      else {
        const res = this.planner.plan(cm, start, p, { allowUnknown: req.allowUnknown, goalTolerance: 0.08 });
        if (!res.ok) {
          this.partial = true;
          continue;
        }
        approach = res.path;
      }
      this.setPath([...approach, ...pts.slice(k + 1)]);
      return true;
    }
    return this.fail('noPath', `${req.label} unreachable`);
  }

  private setPath(p: Vec2[]): void {
    this.path = dedupe(p);
    this.follower.setPath(this.path);
    this.lastSeg = 0;
    this.lastCostmapVersion = this.map.costmapVersion;
    this.validateTimer = 0;
  }

  private fail(f: Exclude<NavFailure, null>, msg: string): false {
    this.state = 'failed';
    this.failure = f;
    this.path = [];
    this.emit('fail', msg);
    return false;
  }

  /**
   * Returns the index of the first point on the remaining path whose approaching segment is blocked,
   * or -1 if the remaining path is clear (checked up to `horizon` meters ahead).
   */
  private firstBlocked(x: number, y: number, seg: number, horizon: number): number {
    const cm = this.map.costmap;
    const allowUnknown = this.request?.allowUnknown ?? false;
    let prev: Vec2 = { x, y };
    let travelled = 0;
    // Skip the first few cm: the robot itself may sit in an inflated band after a bump.
    for (let k = seg + 1; k < this.path.length && travelled < horizon; k++) {
      const p = this.path[k];
      const len = Math.hypot(p.x - prev.x, p.y - prev.y);
      const from = travelled < 0.2 && len > 0.2 ? { x: prev.x + ((p.x - prev.x) * 0.15) / len, y: prev.y + ((p.y - prev.y) * 0.15) / len } : prev;
      if (len > 1e-6 && !this.segmentSafe(from, p, allowUnknown)) return k;
      travelled += len;
      prev = p;
    }
    return -1;
  }

  /**
   * Execution-time safety check: a cell is unsafe only if the robot footprint centred there would
   * actually touch a mapped obstacle (distance < radius) — deliberately less conservative than the
   * planning band (radius + margin), so map noise on wall-hugging paths does not trigger detours.
   */
  private cellSafe(idx: number, allowUnknown: boolean): boolean {
    const cm = this.map.costmap;
    if (!allowUnknown && cm.cost[idx] === COST_UNKNOWN) return false;
    return cm.obstacleDistance[idx] >= ROBOT.radius + 0.004;
  }

  private segmentSafe(a: Vec2, b: Vec2, allowUnknown: boolean): boolean {
    const g = this.map.geom;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / (g.cellSize * 0.5)));
    for (let k = 0; k <= n; k++) {
      const idx = g.indexAt(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
      if (idx < 0 || !this.cellSafe(idx, allowUnknown)) return false;
    }
    return true;
  }

  /** Detour: re-plan to the first traversable point after the blockage, keeping the rest of the path. */
  private detour(x: number, y: number, blockedIdx: number): boolean {
    const req = this.request!;
    this.replans++;
    if (req.mode === 'goto') {
      const ok = this.buildPath(x, y);
      if (ok) this.emit('replan', `Obstacle on route — replanned to ${req.label}`);
      return ok;
    }
    const cm = this.map.costmap;
    const rest = densify(this.path.slice(blockedIdx - 1), 0.1);
    // Candidate rejoin points after the blocked section.
    for (let k = 1; k < rest.length; k++) {
      const p = rest[k];
      const idx = cm.geom.indexAt(p.x, p.y);
      if (idx < 0 || !this.cellSafe(idx, req.allowUnknown ?? false)) continue;
      const res = this.planner.plan(cm, { x, y }, p, { allowUnknown: req.allowUnknown, goalTolerance: 0.05, maxExpansions: 60000 });
      if (res.ok && pathLength(res.path) < 3 * Math.hypot(p.x - x, p.y - y) + 2.5) {
        this.setPath([...res.path, ...rest.slice(k + 1)]);
        this.emit('detour', `Obstacle detected — detouring (${req.label})`);
        if (k > 2) this.partial = true;
        return true;
      }
    }
    this.partial = true;
    this.emit('skip', `${req.label}: remainder blocked, skipping`);
    this.state = 'arrived';
    return false;
  }

  private startRecovery(kind: Exclude<RecoveryKind, null>, inp: NavInputs, reason: string): void {
    this.recovery = kind;
    this.recoveryProgress = 0;
    this.recoveryTimer = 0;
    if (kind === 'rotate' || kind === 'escape') {
      // Turn toward the most open direction seen by the LiDAR (bounded to +-120 deg).
      const a = Math.max(-2.1, Math.min(2.1, wrapAngle(inp.openDirection)));
      this.recoveryTarget = Math.abs(a) < 0.5 ? (a >= 0 ? 0.9 : -0.9) : a;
    }
    this.emit('recovery', reason);
  }

  /** Execute the active recovery manoeuvre. Returns true while still recovering. */
  private runRecovery(inp: NavInputs): boolean {
    const out = this.out;
    this.recoveryTimer += inp.dt;
    if (this.recovery === 'backup' || this.recovery === 'escape') {
      out.v = -0.1;
      out.w = 0;
      this.recoveryProgress += Math.abs(inp.v) * inp.dt;
      const target = this.recovery === 'escape' ? 0.15 : 0.07;
      if (this.recoveryProgress >= target || this.recoveryTimer > 2.5) {
        if (this.recovery === 'escape') {
          this.recovery = 'rotate';
          this.recoveryProgress = 0;
          this.recoveryTimer = 0;
        } else this.recovery = null;
      }
      return true;
    }
    if (this.recovery === 'rotate') {
      out.v = 0;
      const remaining = this.recoveryTarget - this.recoveryProgress;
      out.w = Math.sign(remaining) * 1.2;
      this.recoveryProgress += out.w * inp.dt;
      if (Math.abs(remaining) < 0.05 || this.recoveryTimer > 4) this.recovery = null;
      return true;
    }
    return false;
  }

  update(inp: NavInputs): { v: number; w: number } {
    const out = this.out;
    out.v = 0;
    out.w = 0;
    if (this.state !== 'active' || !this.request) return out;
    const req = this.request;

    // Reflexes: bumper / cliff -> mark & back off.
    if (inp.bumped || inp.cliff) {
      this.bumpsOnGoal++;
      if (this.bumpsOnGoal > 8) {
        this.fail('blocked', `${req.label}: repeated collisions`);
        return out;
      }
      this.startRecovery('backup', inp, inp.cliff ? 'Cliff detected — backing off' : 'Bumper hit — backing off');
    }

    if (this.recovery) {
      if (this.runRecovery(inp)) return out;
      // Recovery finished: rebuild the plan from here.
      if (!this.buildPath(inp.x, inp.y)) {
        if (req.mode === 'track' && this.failure === 'noPath') {
          this.state = 'arrived';
          this.partial = true;
          this.failure = null;
        }
        return out;
      }
    }

    // Periodic path validation against the latest costmap.
    this.validateTimer += inp.dt;
    if (this.validateTimer >= 0.2 && this.map.costmapVersion !== this.lastCostmapVersion) {
      this.validateTimer = 0;
      this.lastCostmapVersion = this.map.costmapVersion;
      const blocked = this.firstBlocked(inp.x, inp.y, this.lastSeg, 2.5);
      if (blocked >= 0) {
        if (!this.detour(inp.x, inp.y, blocked)) return out;
      }
    }

    const f = this.follower.update(inp.x, inp.y, inp.theta);
    this.lastSeg = Math.max(0, f.segmentIndex);
    if (f.done) {
      this.state = 'arrived';
      this.emit('arrive', `Reached ${req.label}`);
      return out;
    }
    out.v = f.v;
    out.w = f.w;
    if (inp.frontNearest < 0.3 && out.v > 0.12) out.v = 0.12;

    // Stuck detection: commanded motion without progress.
    if (Math.abs(out.v) > 0.05 && Math.abs(inp.v) < 0.015) this.stallTime += inp.dt;
    else this.stallTime = Math.max(0, this.stallTime - inp.dt);
    this.stuckTimer += inp.dt;
    if (this.stuckTimer >= this.cfg.stuckTimeout) {
      const remaining = this.follower.remainingDistance(inp.x, inp.y);
      const moved = Math.hypot(inp.x - this.stuckRef.x, inp.y - this.stuckRef.y);
      const progressed = this.stuckRef.remaining - remaining;
      if (moved < this.cfg.stuckMinProgress && progressed < this.cfg.stuckMinProgress) this.stallTime = 99;
      this.stuckTimer = 0;
      this.stuckRef = { x: inp.x, y: inp.y, remaining };
    }
    if (this.stallTime > 3) {
      this.stallTime = 0;
      this.recoveryAttempts++;
      if (this.recoveryAttempts > this.cfg.maxRecoveryAttempts) {
        this.fail('stuck', `${req.label}: stuck after ${this.cfg.maxRecoveryAttempts} recovery attempts`);
        return out;
      }
      this.startRecovery('escape', inp, `No progress — recovery manoeuvre ${this.recoveryAttempts}/${this.cfg.maxRecoveryAttempts}`);
      out.v = 0;
      out.w = 0;
    }
    return out;
  }

  /** Remaining path from the robot (for drawing). */
  remainingPath(x: number, y: number): Vec2[] {
    if (this.state !== 'active' || this.path.length === 0) return [];
    return [{ x, y }, ...this.path.slice(this.lastSeg + 1)];
  }

  remainingDistance(x: number, y: number): number {
    return this.state === 'active' ? this.follower.remainingDistance(x, y) : 0;
  }
}

function dedupe(p: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-4) out.push({ x: q.x, y: q.y });
  }
  return out;
}

/** Resample a polyline so consecutive points are at most `step` apart. */
export function densify(p: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < p.length; k++) {
    const a = p[k];
    out.push(a);
    const b = p[k + 1];
    if (!b) break;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(len / step);
    for (let s = 1; s < n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  }
  return out;
}

export function pathLength(p: Vec2[]): number {
  let s = 0;
  for (let k = 1; k < p.length; k++) s += Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y);
  return s;
}
