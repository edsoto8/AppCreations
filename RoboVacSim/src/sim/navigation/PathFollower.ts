import type { Vec2 } from '../world/types';

export interface FollowerParams {
  /** Pure-pursuit lookahead distance along the path (m). */
  lookahead: number;
  maxV: number;
  maxW: number;
  /** Done when within this distance of the final point (m). */
  goalTolerance: number;
  /** Heading error (rad) above which the robot stops and rotates in place. */
  rotateInPlaceAngle: number;
  /** Linear speed ramps down inside this distance to the final point (m). */
  slowdownRadius: number;
}

export interface FollowerOutput {
  v: number;
  w: number;
  done: boolean;
  target: Vec2;
  segmentIndex: number;
  /** Signed lateral distance to the path (m), positive = robot is LEFT of the path direction. */
  crossTrackError: number;
}

export const DEFAULT_FOLLOWER_PARAMS: FollowerParams = {
  lookahead: 0.25,
  maxV: 0.3,
  maxW: 1.8,
  goalTolerance: 0.06,
  rotateInPlaceAngle: 0.6,
  slowdownRadius: 0.3,
};

/** Rotation gain (rad/s per rad of heading error) while turning in place. */
const K_ROT = 2.5;
/** Minimum creeping speed near the goal so the robot never stalls short of it (m/s). */
const MIN_V = 0.04;
/** Minimum in-place rotation speed (rad/s). */
const MIN_W = 0.25;

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Pure-pursuit path follower with rotate-in-place for large heading errors.
 *
 * Progress is tracked as arc length `s` along the polyline and only ever increases: each update
 * projects the robot onto the path within a bounded window ahead of the current progress. The
 * lookahead target is the point at s + lookahead, clamped to the final point (never skipped).
 * Speed scales down with heading error and inside slowdownRadius of the goal.
 * `update` is allocation-free (returns the same output object every call).
 */
export class PathFollower {
  readonly params: FollowerParams;
  private _path: Vec2[] = [];
  private cum: Float64Array = new Float64Array(1);
  private total = 0;
  private s = 0;
  private seg = 0;
  private rotating = false;
  private finished = false;
  private readonly out: FollowerOutput = {
    v: 0,
    w: 0,
    done: true,
    target: { x: 0, y: 0 },
    segmentIndex: 0,
    crossTrackError: 0,
  };

  constructor(params?: Partial<FollowerParams>) {
    this.params = { ...DEFAULT_FOLLOWER_PARAMS, ...params };
  }

  get path(): Vec2[] {
    return this._path;
  }

  /** Arc-length progress along the path (m). */
  get progress(): number {
    return this.s;
  }

  /** Total path length (m). */
  get length(): number {
    return this.total;
  }

  setPath(path: Vec2[]): void {
    this._path = path.map((p) => ({ x: p.x, y: p.y }));
    const n = this._path.length;
    this.cum = new Float64Array(Math.max(1, n));
    for (let k = 1; k < n; k++) {
      const a = this._path[k - 1];
      const b = this._path[k];
      this.cum[k] = this.cum[k - 1] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    this.total = n > 0 ? this.cum[n - 1] : 0;
    this.s = 0;
    this.seg = 0;
    this.rotating = false;
    this.finished = n === 0;
  }

  update(x: number, y: number, theta: number): FollowerOutput {
    const out = this.out;
    const p = this.params;
    const path = this._path;
    const n = path.length;
    out.v = 0;
    out.w = 0;
    if (n === 0 || this.finished) {
      out.done = true;
      if (n > 0) {
        out.target.x = path[n - 1].x;
        out.target.y = path[n - 1].y;
      }
      out.segmentIndex = Math.max(0, n - 2);
      out.crossTrackError = 0;
      return out;
    }

    this.project(x, y);
    out.segmentIndex = this.seg;
    out.crossTrackError = this.crossTrack(x, y);

    const goal = path[n - 1];
    const dGoal = Math.hypot(goal.x - x, goal.y - y);
    const remainingAlong = this.total - this.s;
    if (dGoal <= p.goalTolerance && remainingAlong <= p.lookahead + p.goalTolerance) {
      this.finished = true;
      out.done = true;
      out.target.x = goal.x;
      out.target.y = goal.y;
      return out;
    }
    out.done = false;

    this.pointAt(Math.min(this.total, this.s + p.lookahead), out.target);
    let tx = out.target.x - x;
    let ty = out.target.y - y;
    let ld = Math.hypot(tx, ty);
    if (ld < 1e-6) {
      // Robot sits on the lookahead point (e.g. projected onto the end): aim at the goal itself.
      tx = goal.x - x;
      ty = goal.y - y;
      ld = Math.hypot(tx, ty);
    }
    const alpha = ld < 1e-9 ? 0 : wrapAngle(Math.atan2(ty, tx) - theta);
    const absA = Math.abs(alpha);

    if (absA > p.rotateInPlaceAngle || (this.rotating && absA > p.rotateInPlaceAngle * 0.5)) {
      this.rotating = true;
      const wMag = Math.min(p.maxW, Math.max(MIN_W, K_ROT * absA));
      out.w = alpha >= 0 ? wMag : -wMag;
      out.v = 0;
      return out;
    }
    this.rotating = false;

    // Linear speed: heading-error and goal slowdown.
    let v = p.maxV * Math.max(0.2, Math.cos(alpha) * (1 - (0.5 * absA) / Math.max(1e-6, p.rotateInPlaceAngle)));
    const distToEnd = Math.max(dGoal, remainingAlong);
    if (distToEnd < p.slowdownRadius) {
      v = Math.min(v, Math.max(Math.min(MIN_V, p.maxV), (p.maxV * distToEnd) / p.slowdownRadius));
    }
    // Pure pursuit curvature κ = 2 sin α / L.
    const kappa = (2 * Math.sin(alpha)) / Math.max(ld, 1e-3);
    let w = v * kappa;
    if (Math.abs(w) > p.maxW) {
      w = Math.sign(w) * p.maxW;
      v = Math.abs(w / kappa);
    }
    out.v = v;
    out.w = w;
    return out;
  }

  /** Distance from the robot to its projection on the path plus the path length still ahead. */
  remainingDistance(x: number, y: number): number {
    if (this._path.length === 0) return 0;
    const px = this.pointAtX(this.s);
    const py = this.pointAtY(this.s);
    return Math.hypot(px - x, py - y) + (this.total - this.s);
  }

  /** Advances the monotonic progress `s` to the closest point within a window ahead. */
  private project(x: number, y: number): void {
    const path = this._path;
    const n = path.length;
    if (n < 2) {
      this.s = 0;
      this.seg = 0;
      return;
    }
    const window = this.s + 2 * this.params.lookahead + 0.5;
    let bestD = Infinity;
    let bestS = this.s;
    let bestSeg = this.seg;
    for (let k = this.seg; k < n - 1; k++) {
      if (this.cum[k] > window) break;
      const a = path[k];
      const b = path[k + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      let t = L2 > 1e-12 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let sk = this.cum[k] + t * (this.cum[k + 1] - this.cum[k]);
      if (sk < this.s) sk = this.s; // monotonic
      if (sk > window) sk = window;
      const px = this.pointAtX(sk);
      const py = this.pointAtY(sk);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < bestD - 1e-12) {
        bestD = d;
        bestS = sk;
        bestSeg = k;
      }
    }
    if (bestS >= this.s) {
      this.s = bestS;
      this.seg = bestSeg;
    }
    // Normalise the segment index (skip zero-length / completed segments).
    while (this.seg < n - 2 && this.cum[this.seg + 1] <= this.s && this.cum[this.seg + 1] < this.total) this.seg++;
  }

  private crossTrack(x: number, y: number): number {
    const path = this._path;
    if (path.length < 2) return 0;
    const a = path[this.seg];
    const b = path[this.seg + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) return 0;
    return (dx * (y - a.y) - dy * (x - a.x)) / L;
  }

  private segFor(s: number): number {
    const n = this._path.length;
    let k = Math.min(this.seg, Math.max(0, n - 2));
    while (k > 0 && this.cum[k] > s) k--;
    while (k < n - 2 && this.cum[k + 1] < s) k++;
    return k;
  }

  private pointAt(s: number, out: Vec2): Vec2 {
    out.x = this.pointAtX(s);
    out.y = this.pointAtY(s);
    return out;
  }

  private pointAtX(s: number): number {
    return this.interp(s, true);
  }

  private pointAtY(s: number): number {
    return this.interp(s, false);
  }

  private interp(s: number, isX: boolean): number {
    const path = this._path;
    const n = path.length;
    if (n === 1) return isX ? path[0].x : path[0].y;
    const k = this.segFor(s);
    const a = path[k];
    const b = path[k + 1];
    const L = this.cum[k + 1] - this.cum[k];
    let t = L > 1e-12 ? (s - this.cum[k]) / L : 1;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return isX ? a.x + t * (b.x - a.x) : a.y + t * (b.y - a.y);
  }
}
