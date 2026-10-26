/**
 * Signed distance primitives used to sculpt the fox.
 *
 * Every primitive works in its own orthonormal local frame so it can be oriented freely.
 * Distances are negative inside. Some primitives (ellipsoid, scaled cones, the cupped ear)
 * are close bounds rather than exact distances, which is fine for meshing and blending.
 */

export type V3 = [number, number, number];

export const v3 = {
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: V3, b: V3, t: number): V3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  mirrorX: (a: V3): V3 => [-a[0], a[1], a[2]],
};

/** Axis-aligned bounds used to skip primitives that cannot affect a sample. */
export interface Aabb {
  min: V3;
  max: V3;
}

export abstract class Primitive {
  /** Conservative bounds of the solid (padded by the caller's blend radius). */
  abstract readonly bounds: Aabb;
  abstract eval(x: number, y: number, z: number): number;

  /** Distance from a point to this primitive's bounds (0 inside). */
  boundsDistance(x: number, y: number, z: number): number {
    const b = this.bounds;
    const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
    const dy = Math.max(b.min[1] - y, 0, y - b.max[1]);
    const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

/** Orthonormal frame: origin plus three axes stored as rows (world -> local is a dot product). */
class Frame {
  constructor(
    readonly o: V3,
    readonly ax: V3,
    readonly ay: V3,
    readonly az: V3,
  ) {}

  /** Builds a frame whose Y axis points along `dir`, with X as close to `hint` as possible. */
  static fromYAxis(origin: V3, dir: V3, hint: V3 = [1, 0, 0]): Frame {
    const ay = v3.norm(dir);
    let h = hint;
    if (Math.abs(v3.dot(h, ay)) > 0.98) h = [0, 0, 1];
    const az = v3.norm(v3.cross(h, ay));
    const ax = v3.cross(ay, az);
    return new Frame(origin, ax, ay, az);
  }

  static fromEuler(origin: V3, rx: number, ry: number, rz: number): Frame {
    // Rotation R = Ry * Rx * Rz applied to the canonical axes.
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    const rot = (v: V3): V3 => {
      // Rz
      let x = v[0] * cz - v[1] * sz;
      let y = v[0] * sz + v[1] * cz;
      let z = v[2];
      // Rx
      const y2 = y * cx - z * sx;
      const z2 = y * sx + z * cx;
      y = y2;
      z = z2;
      // Ry
      const x3 = x * cy + z * sy;
      const z3 = -x * sy + z * cy;
      x = x3;
      return [x, y, z3];
    };
    return new Frame(origin, rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1]));
  }
}

function sphereBounds(c: V3, r: number): Aabb {
  return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
}

function mergeBounds(a: Aabb, b: Aabb): Aabb {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Ellipsoid (Inigo Quilez's bound). Optional Euler rotation in radians. */
export class Ellipsoid extends Primitive {
  readonly bounds: Aabb;
  private readonly f: Frame;

  constructor(
    readonly center: V3,
    readonly radii: V3,
    rotation: V3 = [0, 0, 0],
  ) {
    super();
    this.f = Frame.fromEuler(center, rotation[0], rotation[1], rotation[2]);
    this.bounds = sphereBounds(center, Math.max(radii[0], radii[1], radii[2]));
  }

  eval(x: number, y: number, z: number): number {
    const f = this.f;
    const px = x - f.o[0], py = y - f.o[1], pz = z - f.o[2];
    const lx = px * f.ax[0] + py * f.ax[1] + pz * f.ax[2];
    const ly = px * f.ay[0] + py * f.ay[1] + pz * f.ay[2];
    const lz = px * f.az[0] + py * f.az[1] + pz * f.az[2];
    const [rx, ry, rz] = this.radii;
    const k0 = Math.sqrt((lx / rx) ** 2 + (ly / ry) ** 2 + (lz / rz) ** 2);
    const k1 = Math.sqrt((lx / (rx * rx)) ** 2 + (ly / (ry * ry)) ** 2 + (lz / (rz * rz)) ** 2);
    if (k1 < 1e-9) return -Math.min(rx, ry, rz);
    return (k0 * (k0 - 1)) / k1;
  }
}

/**
 * Cone with spherical caps between two points (Inigo Quilez's round cone).
 * `cross` squashes the cross-section: [lateral, depth] scale relative to the radius.
 */
export class RoundCone extends Primitive {
  readonly bounds: Aabb;
  private readonly f: Frame;
  private readonly h: number;
  private readonly ca: number;
  private readonly cb: number;
  private readonly sMin: number;

  constructor(
    readonly a: V3,
    readonly b: V3,
    readonly ra: number,
    readonly rb: number,
    readonly cross: [number, number] = [1, 1],
    lateralHint: V3 = [1, 0, 0],
  ) {
    super();
    const axis = v3.sub(b, a);
    this.h = Math.max(v3.len(axis), 1e-6);
    this.f = Frame.fromYAxis(a, axis, lateralHint);
    const bb = (ra - rb) / this.h;
    this.cb = Math.max(-0.999, Math.min(0.999, bb));
    this.ca = Math.sqrt(1 - this.cb * this.cb);
    this.sMin = Math.min(cross[0], cross[1], 1);
    const s = Math.max(cross[0], cross[1], 1);
    this.bounds = mergeBounds(sphereBounds(a, ra * s), sphereBounds(b, rb * s));
  }

  eval(x: number, y: number, z: number): number {
    const f = this.f;
    const px = x - f.o[0], py = y - f.o[1], pz = z - f.o[2];
    const lx = (px * f.ax[0] + py * f.ax[1] + pz * f.ax[2]) / this.cross[0];
    const ly = px * f.ay[0] + py * f.ay[1] + pz * f.ay[2];
    const lz = (px * f.az[0] + py * f.az[1] + pz * f.az[2]) / this.cross[1];
    const qx = Math.sqrt(lx * lx + lz * lz);
    const qy = ly;
    const a = this.ca, b = this.cb, h = this.h;
    const k = -b * qx + a * qy;
    let d: number;
    if (k < 0) d = Math.sqrt(qx * qx + qy * qy) - this.ra;
    else if (k > a * h) d = Math.sqrt(qx * qx + (qy - h) * (qy - h)) - this.rb;
    else d = qx * a + qy * b - this.ra;
    return d * this.sMin;
  }
}

/** Exact sphere. */
export class Sphere extends Primitive {
  readonly bounds: Aabb;
  constructor(
    readonly center: V3,
    readonly radius: number,
  ) {
    super();
    this.bounds = sphereBounds(center, radius);
  }
  eval(x: number, y: number, z: number): number {
    const c = this.center;
    return Math.hypot(x - c[0], y - c[1], z - c[2]) - this.radius;
  }
}

export interface EarFrame {
  base: V3;
  /** Unit vector from base to tip. */
  up: V3;
  /** Unit vector the ear opening faces. */
  front: V3;
  /** Unit vector across the ear (up x front). */
  side: V3;
  height: number;
  halfWidth: number;
}

/**
 * Large, cupped fox ear: a rounded isosceles triangle, extruded to a thin shell and bent so the
 * edges curl forward around a hollow inner surface.
 */
export class Ear extends Primitive {
  readonly bounds: Aabb;
  readonly frame: EarFrame;

  constructor(
    base: V3,
    tip: V3,
    frontHint: V3,
    readonly halfWidth: number,
    readonly halfThickness: number,
    readonly cup: number,
    readonly rounding: number,
  ) {
    super();
    const up = v3.norm(v3.sub(tip, base));
    const height = v3.len(v3.sub(tip, base));
    const front = v3.norm(v3.sub(frontHint, v3.scale(up, v3.dot(frontHint, up))));
    const side = v3.cross(up, front);
    this.frame = { base, up, front, side, height, halfWidth };
    const r = Math.max(height, halfWidth) + cup + halfThickness;
    this.bounds = mergeBounds(sphereBounds(base, halfWidth + cup + 0.01), sphereBounds(tip, r * 0.25 + 0.01));
    this.bounds = mergeBounds(this.bounds, sphereBounds(v3.lerp(base, tip, 0.5), r * 0.6));
  }

  eval(x: number, y: number, z: number): number {
    const fr = this.frame;
    const px = x - fr.base[0], py = y - fr.base[1], pz = z - fr.base[2];
    const u = px * fr.side[0] + py * fr.side[1] + pz * fr.side[2];
    const v = px * fr.up[0] + py * fr.up[1] + pz * fr.up[2];
    let w = px * fr.front[0] + py * fr.front[1] + pz * fr.front[2];
    const H = fr.height;
    // Ear width narrows with height; the cup deepens toward the base and flattens at the tip.
    const t = Math.min(Math.max(v / H, 0), 1);
    const halfW = Math.max(fr.halfWidth * (1 - t), 1e-4);
    const un = Math.min(Math.abs(u) / halfW, 1.4);
    w -= this.cup * (1 - t * 0.85) * un * un;
    // Convex (slightly bulged) triangle edges: widen the middle a little.
    const bulge = 1 + 0.18 * Math.sin(Math.PI * t);
    const d2 = sdTriangleIsosceles(u / bulge, H - v, fr.halfWidth, H) - this.rounding;
    // Thin shell that thickens slightly toward the base.
    const ht = this.halfThickness * (1.35 - 0.6 * t);
    const wx = d2;
    const wy = Math.abs(w) - ht;
    const inside = Math.min(Math.max(wx, wy), 0);
    const ox = Math.max(wx, 0), oy = Math.max(wy, 0);
    return inside + Math.sqrt(ox * ox + oy * oy);
  }
}

/** 2D isosceles triangle with apex at the origin and base at y = qy (Inigo Quilez). */
function sdTriangleIsosceles(px: number, py: number, qx: number, qy: number): number {
  px = Math.abs(px);
  const qq = qx * qx + qy * qy;
  const ta = Math.min(Math.max((px * qx + py * qy) / qq, 0), 1);
  const ax = px - qx * ta, ay = py - qy * ta;
  const tb = Math.min(Math.max(px / qx, 0), 1);
  const bx = px - qx * tb, by = py - qy;
  const s = -Math.sign(qy);
  const d1 = ax * ax + ay * ay;
  const d2 = bx * bx + by * by;
  const s1 = s * (px * qy - py * qx);
  const s2 = s * (py - qy);
  const dd = Math.min(d1, d2);
  const ss = Math.min(s1, s2);
  return -Math.sqrt(dd) * Math.sign(ss);
}

/** Polynomial smooth minimum. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Polynomial smooth maximum. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}
